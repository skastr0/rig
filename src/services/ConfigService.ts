import { createHash } from "node:crypto";
import { Context, Effect, Either, Layer, Schema } from "effect";
import { FileSystem } from "@effect/platform";
import { configError } from "../configErrors.js";
import {
  configSourceLocation,
  formatGitHubShorthand,
  formatRemoteConfigIntegrity,
  formatRemoteConfigPin,
  githubContentsApiEndpoint,
  isRemoteConfigSource,
  type ConfigSource,
  type GitHubConfigSource,
  type HttpsConfigSource,
  type RemoteConfigSource,
} from "../configSource.js";
import { ConfigError } from "../errors.js";
import { SystemConfig, SystemItem } from "../schema/config.js";
import { renderStarterConfig, starterConfigDocsPath } from "../starterConfig.js";
import { GitHubCli } from "./GitHubCliService.js";

const remoteConfigTimeoutMs = 10_000;

const sha256Digest = (content: string): string =>
  createHash("sha256").update(content).digest("hex");

export interface ResolvedConfig {
  readonly items: readonly SystemItem[];
}

export interface StarterConfigWriteResult {
  readonly path: string;
  readonly content: string;
  readonly docsPath: string;
}

export interface ConfigService {
  readonly load: (
    source: ConfigSource,
  ) => Effect.Effect<ResolvedConfig, ConfigError, FileSystem.FileSystem | GitHubCli>;
  readonly writeStarterConfig: (
    path: string,
  ) => Effect.Effect<StarterConfigWriteResult, ConfigError, FileSystem.FileSystem>;
}

export const ConfigService = Context.GenericTag<ConfigService>("ConfigService");

const loadLocalConfigContent = (configPath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    const exists = yield* fs.exists(configPath).pipe(
      Effect.mapError(() =>
        configError({
          code: "access_failed",
          message: "Failed to access config file",
          path: configPath,
        }),
      ),
    );

    if (!exists) {
      return yield* Effect.fail(
        configError({
          code: "not_found",
          message: "Config file not found",
          path: configPath,
        }),
      );
    }

    return yield* fs.readFileString(configPath).pipe(
      Effect.mapError(() =>
        configError({
          code: "read_failed",
          message: "Failed to read config file",
          path: configPath,
        }),
      ),
    );
  });

const rejectExistingLocalConfigTarget = (configPath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    const exists = yield* fs.exists(configPath).pipe(
      Effect.mapError(() =>
        configError({
          code: "access_failed",
          message: "Failed to access config file",
          path: configPath,
        }),
      ),
    );

    if (exists) {
      return yield* Effect.fail(
        configError({
          code: "already_exists",
          message:
            "Config file already exists. Choose a different path or edit the existing file instead of re-running --init.",
          path: configPath,
        }),
      );
    }
  });

const writeStarterConfigContent = (configPath: string, content: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    yield* fs.writeFileString(configPath, content).pipe(
      Effect.mapError(() =>
        configError({
          code: "write_failed",
          message: "Failed to write starter config file",
          path: configPath,
        }),
      ),
    );
  });

const mapRemoteFetchFailure = (url: string, error: unknown): ConfigError => {
  if (error instanceof ConfigError) {
    return error;
  }

  if (error instanceof Error && error.name === "AbortError") {
    return configError({
      code: "remote_timeout",
      message: `Remote config request timed out after ${remoteConfigTimeoutMs}ms`,
      path: url,
    });
  }

  return configError({
    code: "remote_fetch_failed",
    message: `Failed to fetch remote config: ${error instanceof Error ? error.message : String(error)}`,
    path: url,
  });
};

const verifyRemoteConfigIntegrity = (
  source: RemoteConfigSource,
  content: string,
): Effect.Effect<void, ConfigError> => {
  if (!source.integrity) {
    return Effect.void;
  }

  const observedDigest = sha256Digest(content);
  const observedIntegrity = `sha256:${observedDigest}`;

  if (observedDigest === source.integrity.expected) {
    return Effect.void;
  }

  return Effect.fail(
    configError({
      code: "integrity_mismatch",
      message: `Remote config integrity mismatch: expected ${formatRemoteConfigIntegrity(source.integrity)}, observed ${observedIntegrity}`,
      path: configSourceLocation(source),
    }),
  );
};

const loadHttpsConfigContent = (source: HttpsConfigSource): Effect.Effect<string, ConfigError> =>
  Effect.tryPromise({
    try: async (signal) => {
      const controller = new AbortController();
      const onAbort = () => controller.abort();
      signal.addEventListener("abort", onAbort, { once: true });
      const timeoutId = setTimeout(() => controller.abort(), remoteConfigTimeoutMs);

      try {
        const response = await fetch(source.url, { signal: controller.signal });

        if (!response.ok) {
          const statusText = response.statusText ? ` ${response.statusText}` : "";
          const observedStatus = `HTTP ${response.status}${statusText}`;

          if (source.pin) {
            throw configError({
              code: "remote_pin_unresolved",
              message: `Pinned remote config could not be resolved: expected ${formatRemoteConfigPin(source.pin)}, observed ${observedStatus}`,
              path: source.url,
            });
          }

          throw configError({
            code: "remote_fetch_failed",
            message: `Failed to fetch remote config: ${observedStatus}`,
            path: source.url,
          });
        }

        return await response.text();
      } finally {
        clearTimeout(timeoutId);
        signal.removeEventListener("abort", onAbort);
      }
    },
    catch: (error) => mapRemoteFetchFailure(source.url, error),
  }).pipe(
    Effect.flatMap((content) =>
      verifyRemoteConfigIntegrity(source, content).pipe(Effect.as(content)),
    ),
  );

const loadGitHubConfigContent = (
  source: GitHubConfigSource,
): Effect.Effect<string, ConfigError, GitHubCli> =>
  Effect.gen(function* () {
    const gh = yield* GitHubCli;
    const endpoint = githubContentsApiEndpoint(source);
    const cliResult = yield* gh
      .rawContents(endpoint, { timeoutMs: remoteConfigTimeoutMs })
      .pipe(Effect.either);

    if (Either.isRight(cliResult)) {
      yield* verifyRemoteConfigIntegrity(source, cliResult.right);
      return cliResult.right;
    }

    const cliError = cliResult.left;

    // Fall back to public raw.githubusercontent.com (works without gh for public repos).
    const rawResult = yield* loadHttpsConfigContent({
      _tag: "https",
      url: source.rawUrl,
      ...(source.integrity ? { integrity: source.integrity } : {}),
      ...(source.pin ? { pin: source.pin } : {}),
    }).pipe(Effect.either);

    if (Either.isRight(rawResult)) {
      return rawResult.right;
    }

    const rawError = rawResult.left;
    const shorthand = formatGitHubShorthand(source);

    return yield* Effect.fail(
      configError({
        code: "github_load_failed",
        message: `Failed to load GitHub config ${shorthand}. ${cliError.message} Raw HTTPS fallback also failed: ${rawError.message}. For private repositories, install GitHub CLI and run \`gh auth login\`.`,
        path: source.rawUrl,
      }),
    );
  });

const loadRemoteConfigContent = (
  source: RemoteConfigSource,
): Effect.Effect<string, ConfigError, GitHubCli> =>
  source._tag === "github" ? loadGitHubConfigContent(source) : loadHttpsConfigContent(source);

const decodeConfig = (content: string, source: ConfigSource) =>
  Effect.gen(function* () {
    const sourceLocation = configSourceLocation(source);
    const invalidJsonMessage = isRemoteConfigSource(source)
      ? "Invalid JSON in remote config"
      : "Invalid JSON";

    const parsed = yield* Effect.try({
      try: () => JSON.parse(content) as unknown,
      catch: () =>
        configError({
          code: "invalid_json",
          message: invalidJsonMessage,
          path: sourceLocation,
        }),
    });

    const config = yield* Schema.decodeUnknown(SystemConfig)(parsed).pipe(
      Effect.mapError((error) =>
        configError({
          code: "schema_invalid",
          message: `Schema validation failed: ${error.message}`,
          path: sourceLocation,
        }),
      ),
    );

    yield* validateConfig(config, sourceLocation);

    return config;
  });

interface ItemReference {
  readonly name: string;
  readonly location: string;
}

const collectItemReferences = (
  items: readonly SystemItem[],
  prefix: string,
): readonly ItemReference[] =>
  items.map((item, index) => ({
    name: item.name,
    location: `${prefix}[${index}]`,
  }));

const formatDuplicateItemIssue = (
  name: string,
  contextLabel: string,
  references: readonly ItemReference[],
): string => {
  const locations = references.map((reference) => reference.location).join(", ");

  return `Duplicate item name "${name}" in ${contextLabel} at ${locations}. Rename one of the items so each item name is unique.`;
};

const findDuplicateItemIssues = (
  contextLabel: string,
  references: readonly ItemReference[],
  options?: {
    readonly skipPureBaseDuplicates?: ReadonlySet<string>;
  },
): { readonly issues: readonly string[]; readonly duplicateNames: ReadonlySet<string> } => {
  const referencesByName = new Map<string, ItemReference[]>();

  for (const reference of references) {
    const existing = referencesByName.get(reference.name);
    if (existing) {
      existing.push(reference);
    } else {
      referencesByName.set(reference.name, [reference]);
    }
  }

  const issues: string[] = [];
  const duplicateNames = new Set<string>();

  for (const [name, duplicateReferences] of referencesByName) {
    if (duplicateReferences.length < 2) {
      continue;
    }

    if (options?.skipPureBaseDuplicates?.has(name)) {
      continue;
    }

    duplicateNames.add(name);
    issues.push(formatDuplicateItemIssue(name, contextLabel, duplicateReferences));
  }

  return { issues, duplicateNames };
};

const findDependencyProfileIssues = (items: readonly SystemItem[]): readonly string[] => {
  const itemByName = new Map(items.map((item) => [item.name, item]));
  const issues: string[] = [];

  for (const item of items) {
    for (const dependencyName of item.dependsOn ?? []) {
      const dependency = itemByName.get(dependencyName);
      if (!dependency) {
        continue;
      }

      const missingProfiles = item.profiles.filter(
        (profile) => !dependency.profiles.includes(profile),
      );

      if (missingProfiles.length > 0) {
        issues.push(
          `Item "${item.name}" depends on "${dependencyName}", but "${dependencyName}" is not available in profile(s): ${missingProfiles.join(", ")}. Add those profiles to "${dependencyName}" or remove the dependency.`,
        );
      }
    }
  }

  return issues;
};

const validateConfig = (
  config: SystemConfig,
  sourceLocation: string,
): Effect.Effect<void, ConfigError> => {
  const baseReferences = collectItemReferences(config.items, "items");
  const baseDuplicates = findDuplicateItemIssues("base items", baseReferences);
  const issues = [...baseDuplicates.issues, ...findDependencyProfileIssues(config.items)];

  return issues.length === 0
    ? Effect.void
    : Effect.fail(
        configError({
          code: "validation_failed",
          message: `Config validation failed:\n- ${issues.join("\n- ")}`,
          path: sourceLocation,
        }),
      );
};

export const ConfigServiceLive = Layer.succeed(
  ConfigService,
  ConfigService.of({
    load: (source) =>
      Effect.gen(function* () {
        const content = yield* isRemoteConfigSource(source)
          ? loadRemoteConfigContent(source)
          : loadLocalConfigContent(source.path);

        const decodedConfig = yield* decodeConfig(content, source);

        return { items: decodedConfig.items };
      }),
    writeStarterConfig: (configPath) =>
      Effect.gen(function* () {
        const content = yield* renderStarterConfig();

        yield* decodeConfig(content, { _tag: "local", path: configPath });
        yield* rejectExistingLocalConfigTarget(configPath);
        yield* writeStarterConfigContent(configPath, content);

        return {
          path: configPath,
          content,
          docsPath: starterConfigDocsPath,
        } satisfies StarterConfigWriteResult;
      }),
  }),
);
