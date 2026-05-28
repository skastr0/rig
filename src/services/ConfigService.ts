import { createHash } from "node:crypto";
import { Context, Effect, Layer, Schema } from "effect";
import { FileSystem } from "@effect/platform";
import {
  configSourceLocation,
  formatRemoteConfigIntegrity,
  formatRemoteConfigPin,
  type ConfigSource,
  type HttpsConfigSource,
} from "../configSource.js";
import { ConfigError } from "../errors.js";
import { SystemConfig, SystemItem, type Profile } from "../schema/config.js";
import { renderStarterConfig, starterConfigDocsPath } from "../starterConfig.js";

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
    profile?: string,
  ) => Effect.Effect<ResolvedConfig, ConfigError, FileSystem.FileSystem>;
  readonly writeStarterConfig: (
    path: string,
  ) => Effect.Effect<StarterConfigWriteResult, ConfigError, FileSystem.FileSystem>;
}

export const ConfigService = Context.GenericTag<ConfigService>("ConfigService");

const loadLocalConfigContent = (configPath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    const exists = yield* fs.exists(configPath).pipe(
      Effect.mapError(
        () =>
          new ConfigError({
            message: "Failed to access config file",
            path: configPath,
          }),
      ),
    );
    if (!exists) {
      return yield* Effect.fail(
        new ConfigError({ message: "Config file not found", path: configPath }),
      );
    }

    return yield* fs
      .readFileString(configPath)
      .pipe(
        Effect.mapError(
          () => new ConfigError({ message: "Failed to read config file", path: configPath }),
        ),
      );
  });

const rejectExistingLocalConfigTarget = (configPath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    const exists = yield* fs.exists(configPath).pipe(
      Effect.mapError(
        () =>
          new ConfigError({
            message: "Failed to access config file",
            path: configPath,
          }),
      ),
    );

    if (exists) {
      return yield* Effect.fail(
        new ConfigError({
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
      Effect.mapError(
        () =>
          new ConfigError({
            message: "Failed to write starter config file",
            path: configPath,
          }),
      ),
    );
  });

const toRemoteConfigError = (url: string, error: unknown): ConfigError => {
  if (error instanceof ConfigError) {
    return error;
  }

  if (error instanceof Error && error.name === "AbortError") {
    return new ConfigError({
      message: `Remote config request timed out after ${remoteConfigTimeoutMs}ms`,
      path: url,
    });
  }

  return new ConfigError({
    message: `Failed to fetch remote config: ${error instanceof Error ? error.message : String(error)}`,
    path: url,
  });
};

const pinnedRemoteStatusError = (
  source: HttpsConfigSource,
  pin: NonNullable<HttpsConfigSource["pin"]>,
  observedStatus: string,
): ConfigError =>
  new ConfigError({
    message: `Pinned remote config could not be resolved: expected ${formatRemoteConfigPin(pin)}, observed ${observedStatus}`,
    path: source.url,
  });

const verifyRemoteConfigIntegrity = (source: HttpsConfigSource, content: string): void => {
  if (!source.integrity) {
    return;
  }

  const observedDigest = sha256Digest(content);
  const observedIntegrity = `sha256:${observedDigest}`;

  if (observedDigest !== source.integrity.expected) {
    throw new ConfigError({
      message: `Remote config integrity mismatch: expected ${formatRemoteConfigIntegrity(source.integrity)}, observed ${observedIntegrity}`,
      path: source.url,
    });
  }
};

const loadRemoteConfigContent = (source: HttpsConfigSource) =>
  Effect.tryPromise({
    try: async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), remoteConfigTimeoutMs);

      try {
        const response = await fetch(source.url, { signal: controller.signal });

        if (!response.ok) {
          const statusText = response.statusText ? ` ${response.statusText}` : "";
          const observedStatus = `HTTP ${response.status}${statusText}`;

          throw source.pin
            ? pinnedRemoteStatusError(source, source.pin, observedStatus)
            : new ConfigError({
                message: `Failed to fetch remote config: ${observedStatus}`,
                path: source.url,
              });
        }

        const content = await response.text();

        verifyRemoteConfigIntegrity(source, content);

        return content;
      } finally {
        clearTimeout(timeoutId);
      }
    },
    catch: (error) => toRemoteConfigError(source.url, error),
  });

const decodeConfig = (content: string, source: ConfigSource) =>
  Effect.gen(function* () {
    const sourceLocation = configSourceLocation(source);
    const invalidJsonMessage =
      source._tag === "https" ? "Invalid JSON in remote config" : "Invalid JSON";

    const parsed = yield* Effect.try({
      try: () => JSON.parse(content) as unknown,
      catch: () => new ConfigError({ message: invalidJsonMessage, path: sourceLocation }),
    });

    const config = yield* Schema.decodeUnknown(SystemConfig)(parsed).pipe(
      Effect.mapError(
        (error) =>
          new ConfigError({
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
  readonly fromProfile: boolean;
}

const collectItemReferences = (
  items: readonly SystemItem[],
  prefix: string,
  fromProfile: boolean,
): readonly ItemReference[] =>
  items.map((item, index) => ({
    name: item.name,
    location: `${prefix}[${index}]`,
    fromProfile,
  }));

const mergeProfileItems = (
  baseItems: readonly SystemItem[],
  profile: Profile,
): readonly SystemItem[] => {
  const excludeSet = new Set(profile.exclude ?? []);
  const filteredBase = baseItems.filter((item) => !excludeSet.has(item.name));
  const profileItems = profile.items ?? [];

  return [...filteredBase, ...profileItems];
};

const formatDuplicateItemIssue = (
  name: string,
  contextLabel: string,
  references: readonly ItemReference[],
  profileName?: string,
): string => {
  const locations = references.map((reference) => reference.location).join(", ");
  const hasBaseReference = references.some((reference) => !reference.fromProfile);
  const hasProfileReference = references.some((reference) => reference.fromProfile);

  if (profileName && hasBaseReference && hasProfileReference) {
    return `Duplicate item name "${name}" in ${contextLabel} at ${locations}. Rename one item or add "${name}" to profiles.${profileName}.exclude before redefining it.`;
  }

  return `Duplicate item name "${name}" in ${contextLabel} at ${locations}. Rename one of the items so each item name is unique.`;
};

const findDuplicateItemIssues = (
  contextLabel: string,
  references: readonly ItemReference[],
  options?: {
    readonly profileName?: string;
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

    const isPureBaseDuplicate = duplicateReferences.every((reference) => !reference.fromProfile);
    if (isPureBaseDuplicate && options?.skipPureBaseDuplicates?.has(name)) {
      continue;
    }

    duplicateNames.add(name);
    issues.push(
      formatDuplicateItemIssue(name, contextLabel, duplicateReferences, options?.profileName),
    );
  }

  return { issues, duplicateNames };
};

const validateConfig = (
  config: SystemConfig,
  sourceLocation: string,
): Effect.Effect<void, ConfigError> => {
  const baseReferences = collectItemReferences(config.items, "items", false);
  const baseDuplicates = findDuplicateItemIssues("base items", baseReferences);
  const issues = [...baseDuplicates.issues];

  for (const [profileName, profile] of Object.entries(config.profiles ?? {})) {
    const profileReferences = [
      ...baseReferences.filter((reference) => !(profile.exclude ?? []).includes(reference.name)),
      ...collectItemReferences(profile.items ?? [], `profiles.${profileName}.items`, true),
    ];

    const profileDuplicates = findDuplicateItemIssues(
      `profile "${profileName}"`,
      profileReferences,
      {
        profileName,
        skipPureBaseDuplicates: baseDuplicates.duplicateNames,
      },
    );

    issues.push(...profileDuplicates.issues);
  }

  return issues.length === 0
    ? Effect.void
    : Effect.fail(
        new ConfigError({
          message: `Config validation failed:\n- ${issues.join("\n- ")}`,
          path: sourceLocation,
        }),
      );
};

export const ConfigServiceLive = Layer.succeed(
  ConfigService,
  ConfigService.of({
    load: (source, profile) =>
      Effect.gen(function* () {
        const sourceLocation = configSourceLocation(source);
        const content = yield* source._tag === "https"
          ? loadRemoteConfigContent(source)
          : loadLocalConfigContent(source.path);

        const decodedConfig = yield* decodeConfig(content, source);
        const items = yield* resolveProfile(decodedConfig, profile, sourceLocation);

        return { items };
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

function resolveProfile(
  config: SystemConfig,
  profileName: string | undefined,
  sourceLocation: string,
): Effect.Effect<readonly SystemItem[], ConfigError> {
  const baseItems = config.items;

  if (!profileName || !config.profiles) {
    if (!profileName) {
      return Effect.succeed(baseItems);
    }

    return Effect.fail(
      new ConfigError({
        message: `Unknown profile "${profileName}". This config defines no profiles. Remove --profile or add profiles.${profileName}.`,
        path: sourceLocation,
      }),
    );
  }

  const profile = config.profiles[profileName];
  if (!profile) {
    const availableProfiles = Object.keys(config.profiles).sort();
    const availableProfilesMessage =
      availableProfiles.length === 0
        ? "This config defines no profiles."
        : `Available profiles: ${availableProfiles.join(", ")}.`;

    return Effect.fail(
      new ConfigError({
        message: `Unknown profile "${profileName}". ${availableProfilesMessage} Use one of the available profile names or remove --profile.`,
        path: sourceLocation,
      }),
    );
  }

  return Effect.succeed(mergeProfileItems(baseItems, profile));
}
