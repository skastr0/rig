import * as Os from "node:os";
import * as Path from "node:path";
import { Effect, Schema } from "effect";
import { FileSystem } from "@effect/platform";
import { configError } from "./configErrors.js";
import { ConfigError } from "./errors.js";

export const defaultConfigFileName = "system-config.json";
export const defaultConfigSource = `./${defaultConfigFileName}`;
export const defaultGitHubConfigPath = defaultConfigFileName;
export const defaultGitHubConfigRef = "HEAD";

const lowerHex = (value: string): string => value.toLowerCase();

const Sha256Digest = Schema.transform(
  Schema.String.pipe(
    Schema.pattern(/^[0-9a-fA-F]{64}$/, {
      message: () => 'expected "#sha256=<64 hex characters>"',
    }),
  ),
  Schema.String,
  {
    strict: true,
    decode: lowerHex,
    encode: (value) => value,
  },
);

const GitCommitSha = Schema.transform(
  Schema.String.pipe(
    Schema.pattern(/^[0-9a-fA-F]{40}$/, {
      message: () => "expected a full 40-character Git commit SHA",
    }),
  ),
  Schema.String,
  {
    strict: true,
    decode: lowerHex,
    encode: (value) => value,
  },
);

export interface RemoteConfigIntegrity {
  readonly algorithm: "sha256";
  readonly expected: string;
}

export interface GitHubCommitPin {
  readonly provider: "github";
  readonly ref: string;
}

export interface LocalConfigSource {
  readonly _tag: "local";
  readonly path: string;
}

export interface HttpsConfigSource {
  readonly _tag: "https";
  readonly url: string;
  readonly integrity?: RemoteConfigIntegrity;
  readonly pin?: GitHubCommitPin;
}

export interface GitHubConfigSource {
  readonly _tag: "github";
  readonly owner: string;
  readonly repo: string;
  readonly path: string;
  readonly ref: string;
  readonly rawUrl: string;
  readonly integrity?: RemoteConfigIntegrity;
  readonly pin?: GitHubCommitPin;
}

export type ConfigSource = LocalConfigSource | HttpsConfigSource | GitHubConfigSource;
export type RemoteConfigSource = HttpsConfigSource | GitHubConfigSource;

const urlProtocolPattern = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//;
const githubShorthandPrefix = "gh:";
const githubRawBaseUrl = "https://raw.githubusercontent.com";
const githubOwnerPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const githubRepoPattern = /^[A-Za-z0-9._-]+$/;
const githubShorthandExpectation = `Use "gh:owner/repo", "gh:owner/repo/path/to/config.json", or pin with "gh:owner/repo@<40-char-commit>[/path/to/config.json]". Bare repositories default to "${defaultGitHubConfigPath}" at repository ${defaultGitHubConfigRef}. Private repos load via authenticated \`gh api\` when the GitHub CLI is available.`;

const encodeGitHubPath = (pathSegments: readonly string[]): string =>
  pathSegments.map((segment) => encodeURIComponent(segment)).join("/");

const parseSha256Digest = (
  sourceInput: string,
  fragment: string,
): Effect.Effect<RemoteConfigIntegrity, ConfigError> => {
  const prefix = "sha256=";
  if (!fragment.startsWith(prefix)) {
    return Effect.fail(
      configError({
        code: "integrity_invalid",
        message: `Invalid remote config integrity fragment: expected "#sha256=<64 hex characters>", observed "#${fragment}".`,
        path: sourceInput,
      }),
    );
  }

  const candidate = fragment.slice(prefix.length);

  return Schema.decodeUnknown(Sha256Digest)(candidate).pipe(
    Effect.mapError(() =>
      configError({
        code: "integrity_invalid",
        message: `Invalid remote config integrity fragment: expected "#sha256=<64 hex characters>", observed "#${fragment}".`,
        path: sourceInput,
      }),
    ),
    Effect.map((expected) => ({
      algorithm: "sha256" as const,
      expected,
    })),
  );
};

const splitGitHubRemoteMetadata = (
  sourceInput: string,
): Effect.Effect<
  {
    readonly sourceWithoutIntegrity: string;
    readonly integrity: RemoteConfigIntegrity | undefined;
  },
  ConfigError
> => {
  const hashIndex = sourceInput.indexOf("#");

  if (hashIndex === -1) {
    return Effect.succeed({
      sourceWithoutIntegrity: sourceInput,
      integrity: undefined,
    });
  }

  return parseSha256Digest(sourceInput, sourceInput.slice(hashIndex + 1)).pipe(
    Effect.map((integrity) => ({
      sourceWithoutIntegrity: sourceInput.slice(0, hashIndex),
      integrity,
    })),
  );
};

const resolveGitHubRepoAndPin = (
  sourceInput: string,
  repoWithMaybePin: string,
): Effect.Effect<
  {
    readonly repo: string;
    readonly ref: string;
    readonly pin: GitHubCommitPin | undefined;
  },
  ConfigError
> => {
  const atIndex = repoWithMaybePin.indexOf("@");

  if (atIndex === -1) {
    return Effect.succeed({
      repo: repoWithMaybePin,
      ref: defaultGitHubConfigRef,
      pin: undefined,
    });
  }

  const repo = repoWithMaybePin.slice(0, atIndex);
  const observedRef = repoWithMaybePin.slice(atIndex + 1);

  return Schema.decodeUnknown(GitCommitSha)(observedRef).pipe(
    Effect.mapError(() =>
      configError({
        code: "source_invalid",
        message: `Invalid GitHub config source: immutable GitHub pins must be full 40-character commit SHAs. Expected a Git commit SHA, observed "${observedRef}". ${githubShorthandExpectation}`,
        path: sourceInput,
      }),
    ),
    Effect.map((normalizedRef) => ({
      repo,
      ref: normalizedRef,
      pin: {
        provider: "github" as const,
        ref: normalizedRef,
      },
    })),
  );
};

const invalidGitHub = (sourceInput: string, detail: string): ConfigError =>
  configError({
    code: "source_invalid",
    message: `Invalid GitHub config source: ${detail}. ${githubShorthandExpectation}`,
    path: sourceInput,
  });

const resolveGitHubConfigSource = (
  sourceInput: string,
): Effect.Effect<GitHubConfigSource, ConfigError> =>
  Effect.gen(function* () {
    const { sourceWithoutIntegrity, integrity } = yield* splitGitHubRemoteMetadata(sourceInput);
    const shorthandBody = sourceWithoutIntegrity.slice(githubShorthandPrefix.length);

    if (shorthandBody.length === 0) {
      return yield* Effect.fail(invalidGitHub(sourceInput, "missing owner and repository"));
    }

    if (shorthandBody.includes("?") || shorthandBody.includes("#")) {
      return yield* Effect.fail(
        invalidGitHub(
          sourceInput,
          "query strings and fragments are not supported in GitHub shorthand",
        ),
      );
    }

    const [owner, repoWithMaybePin, ...pathSegments] = shorthandBody.split("/");

    if (!owner) {
      return yield* Effect.fail(
        invalidGitHub(sourceInput, "missing owner before the repository name"),
      );
    }

    if (!githubOwnerPattern.test(owner)) {
      return yield* Effect.fail(
        invalidGitHub(sourceInput, `"${owner}" is not a valid GitHub owner`),
      );
    }

    if (!repoWithMaybePin) {
      return yield* Effect.fail(
        invalidGitHub(sourceInput, "missing repository name after the owner"),
      );
    }

    const { repo, ref, pin } = yield* resolveGitHubRepoAndPin(sourceInput, repoWithMaybePin);

    if (!repo) {
      return yield* Effect.fail(
        invalidGitHub(sourceInput, "missing repository name after the owner"),
      );
    }

    if (!githubRepoPattern.test(repo)) {
      return yield* Effect.fail(
        invalidGitHub(sourceInput, `"${repo}" is not a valid GitHub repository name`),
      );
    }

    const resolvedPathSegments =
      pathSegments.length === 0 ? [defaultGitHubConfigPath] : pathSegments;

    if (
      resolvedPathSegments.some(
        (segment) => segment.length === 0 || segment === "." || segment === "..",
      )
    ) {
      return yield* Effect.fail(
        invalidGitHub(
          sourceInput,
          'file paths cannot contain empty segments, "." / ".." segments, or trailing slashes',
        ),
      );
    }

    const path = resolvedPathSegments.join("/");

    return {
      _tag: "github" as const,
      owner,
      repo,
      path,
      ref,
      rawUrl: `${githubRawBaseUrl}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${ref}/${encodeGitHubPath(resolvedPathSegments)}`,
      ...(integrity ? { integrity } : {}),
      ...(pin ? { pin } : {}),
    };
  });

export const isRemoteConfigSource = (source: ConfigSource): source is RemoteConfigSource =>
  source._tag === "https" || source._tag === "github";

export const resolveConfigSource = Effect.fn("resolveConfigSource")(function* (
  sourceInput: string,
) {
  const trimmedSource = sourceInput.trim();
  const normalizedPrefix = trimmedSource.slice(0, githubShorthandPrefix.length).toLowerCase();

  if (normalizedPrefix === githubShorthandPrefix) {
    return yield* resolveGitHubConfigSource(trimmedSource);
  }

  if (!urlProtocolPattern.test(trimmedSource)) {
    return { _tag: "local" as const, path: trimmedSource };
  }

  const url = yield* Effect.try({
    try: () => new URL(trimmedSource),
    catch: () =>
      configError({
        code: "source_invalid",
        message: "Failed to resolve config source",
        path: sourceInput,
      }),
  });

  if (url.protocol !== "https:") {
    return yield* Effect.fail(
      configError({
        code: "unsupported_protocol",
        message: `Unsupported config source protocol "${url.protocol}". Only local paths, HTTPS URLs, and GitHub shorthand are supported`,
        path: sourceInput,
      }),
    );
  }

  const integrity = url.hash
    ? yield* parseSha256Digest(trimmedSource, url.hash.slice(1))
    : undefined;

  url.hash = "";

  return {
    _tag: "https" as const,
    url: url.toString(),
    ...(integrity ? { integrity } : {}),
  };
});

const fileExists = (path: string): Effect.Effect<boolean, ConfigError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    return yield* fs.exists(path).pipe(
      Effect.mapError(() =>
        configError({
          code: "access_failed",
          message: "Failed to access config file during walk-up discovery",
          path,
        }),
      ),
    );
  });

/**
 * Discover the default local config when the user omits a source.
 * Walks from startDir to filesystem root for system-config.json, then tries ~/system-config.json.
 */
export const discoverDefaultConfigSource = Effect.fn("discoverDefaultConfigSource")(function* (
  startDir: string = process.cwd(),
  homeDir: string = Os.homedir(),
) {
  const resolvedStart = Path.resolve(startDir);
  const resolvedHome = Path.resolve(homeDir);
  let currentDir = resolvedStart;

  for (;;) {
    const candidate = Path.join(currentDir, defaultConfigFileName);
    if (yield* fileExists(candidate)) {
      return { _tag: "local" as const, path: candidate };
    }

    const parentDir = Path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  const homeCandidate = Path.join(resolvedHome, defaultConfigFileName);
  if (homeCandidate !== Path.join(resolvedStart, defaultConfigFileName)) {
    if (yield* fileExists(homeCandidate)) {
      return { _tag: "local" as const, path: homeCandidate };
    }
  }

  return yield* Effect.fail(
    configError({
      code: "discovery_failed",
      message: `Config file not found. Walked up from ${resolvedStart} looking for ${defaultConfigFileName}, then checked ${homeCandidate}. Pass an explicit path, HTTPS URL, or gh:owner/repo source.`,
      path: defaultConfigSource,
    }),
  );
});

export const resolveConfiguredSource = (
  sourceInput: string | undefined,
): Effect.Effect<ConfigSource, ConfigError, FileSystem.FileSystem> =>
  sourceInput === undefined ? discoverDefaultConfigSource() : resolveConfigSource(sourceInput);

export const configSourceLocation = (source: ConfigSource): string => {
  switch (source._tag) {
    case "https":
      return source.url;
    case "github":
      return source.rawUrl;
    case "local":
      return source.path;
  }
};

export const formatRemoteConfigIntegrity = (integrity: RemoteConfigIntegrity): string =>
  `${integrity.algorithm}:${integrity.expected}`;

export const formatRemoteConfigPin = (pin: GitHubCommitPin): string => `GitHub commit ${pin.ref}`;

export const formatGitHubShorthand = (source: GitHubConfigSource): string => {
  const pinSuffix = source.pin ? `@${source.pin.ref}` : "";
  const pathSuffix = source.path === defaultGitHubConfigPath ? "" : `/${source.path}`;
  return `gh:${source.owner}/${source.repo}${pinSuffix}${pathSuffix}`;
};

export const formatConfigSource = (source: ConfigSource): string => {
  switch (source._tag) {
    case "https":
      return `remote HTTPS ${source.url}`;
    case "github":
      return `remote GitHub ${formatGitHubShorthand(source)} (${source.rawUrl})`;
    case "local":
      return `local file ${source.path}`;
  }
};

export const githubContentsApiEndpoint = (source: GitHubConfigSource): string => {
  const encodedPath = source.path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const base = `repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}/contents/${encodedPath}`;

  if (source.ref === defaultGitHubConfigRef) {
    return base;
  }

  return `${base}?ref=${encodeURIComponent(source.ref)}`;
};
