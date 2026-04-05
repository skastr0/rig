import { Effect } from "effect";
import { ConfigError } from "./errors.js";

export const defaultConfigSource = "./system-config.json";
export const defaultGitHubConfigPath = "system-config.json";
export const defaultGitHubConfigRef = "HEAD";

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

export type ConfigSource = LocalConfigSource | HttpsConfigSource;

const urlProtocolPattern = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//;
const githubShorthandPrefix = "gh:";
const githubRawBaseUrl = "https://raw.githubusercontent.com";
const githubOwnerPattern = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const githubRepoPattern = /^[A-Za-z0-9._-]+$/;
const githubCommitPinPattern = /^[0-9a-fA-F]{40}$/;
const remoteIntegrityFragmentPattern = /^sha256=([0-9a-fA-F]{64})$/;
const githubShorthandExpectation = `Use "gh:owner/repo", "gh:owner/repo/path/to/config.json", or pin with "gh:owner/repo@<40-char-commit>[/path/to/config.json]". Bare repositories default to "${defaultGitHubConfigPath}" at repository ${defaultGitHubConfigRef}.`;
const remoteIntegrityExpectation = '"#sha256=<64 hex characters>"';

const unsupportedProtocolError = (sourceInput: string, protocol: string): ConfigError =>
  new ConfigError({
    message: `Unsupported config source protocol "${protocol}". Only local paths, HTTPS URLs, and GitHub shorthand are supported`,
    path: sourceInput,
  });

const invalidGitHubConfigSourceError = (sourceInput: string, detail: string): ConfigError =>
  new ConfigError({
    message: `Invalid GitHub config source: ${detail}. ${githubShorthandExpectation}`,
    path: sourceInput,
  });

const invalidRemoteIntegrityError = (sourceInput: string, observedFragment: string): ConfigError =>
  new ConfigError({
    message: `Invalid remote config integrity fragment: expected ${remoteIntegrityExpectation}, observed "#${observedFragment}".`,
    path: sourceInput,
  });

const encodeGitHubPath = (pathSegments: readonly string[]): string =>
  pathSegments.map((segment) => encodeURIComponent(segment)).join("/");

const parseRemoteIntegrity = (sourceInput: string, fragment: string): RemoteConfigIntegrity => {
  const match = remoteIntegrityFragmentPattern.exec(fragment);

  if (!match) {
    throw invalidRemoteIntegrityError(sourceInput, fragment);
  }

  const expected = match[1];

  if (expected === undefined) {
    throw invalidRemoteIntegrityError(sourceInput, fragment);
  }

  return {
    algorithm: "sha256",
    expected: expected.toLowerCase(),
  };
};

const splitGitHubRemoteMetadata = (sourceInput: string) => {
  const hashIndex = sourceInput.indexOf("#");

  if (hashIndex === -1) {
    return {
      sourceWithoutIntegrity: sourceInput,
      integrity: undefined,
    } as const;
  }

  return {
    sourceWithoutIntegrity: sourceInput.slice(0, hashIndex),
    integrity: parseRemoteIntegrity(sourceInput, sourceInput.slice(hashIndex + 1)),
  } as const;
};

const resolveGitHubRepoAndPin = (sourceInput: string, repoWithMaybePin: string) => {
  const atIndex = repoWithMaybePin.indexOf("@");

  if (atIndex === -1) {
    return {
      repo: repoWithMaybePin,
      ref: defaultGitHubConfigRef,
      pin: undefined,
    } as const;
  }

  const repo = repoWithMaybePin.slice(0, atIndex);
  const observedRef = repoWithMaybePin.slice(atIndex + 1);

  if (!githubCommitPinPattern.test(observedRef)) {
    throw invalidGitHubConfigSourceError(
      sourceInput,
      `immutable GitHub pins must be full 40-character commit SHAs. Expected a Git commit SHA, observed "${observedRef}"`,
    );
  }

  const normalizedRef = observedRef.toLowerCase();

  return {
    repo,
    ref: normalizedRef,
    pin: {
      provider: "github",
      ref: normalizedRef,
    },
  } as const;
};

const resolveGitHubConfigSource = (sourceInput: string): HttpsConfigSource => {
  const { sourceWithoutIntegrity, integrity } = splitGitHubRemoteMetadata(sourceInput);
  const shorthandBody = sourceWithoutIntegrity.slice(githubShorthandPrefix.length);

  if (shorthandBody.length === 0) {
    throw invalidGitHubConfigSourceError(sourceInput, "missing owner and repository");
  }

  if (shorthandBody.includes("?") || shorthandBody.includes("#")) {
    throw invalidGitHubConfigSourceError(
      sourceInput,
      "query strings and fragments are not supported in GitHub shorthand",
    );
  }

  const [owner, repoWithMaybePin, ...pathSegments] = shorthandBody.split("/");

  if (!owner) {
    throw invalidGitHubConfigSourceError(sourceInput, "missing owner before the repository name");
  }

  if (!githubOwnerPattern.test(owner)) {
    throw invalidGitHubConfigSourceError(sourceInput, `"${owner}" is not a valid GitHub owner`);
  }

  if (!repoWithMaybePin) {
    throw invalidGitHubConfigSourceError(sourceInput, "missing repository name after the owner");
  }

  const { repo, ref, pin } = resolveGitHubRepoAndPin(sourceInput, repoWithMaybePin);

  if (!repo) {
    throw invalidGitHubConfigSourceError(sourceInput, "missing repository name after the owner");
  }

  if (!githubRepoPattern.test(repo)) {
    throw invalidGitHubConfigSourceError(
      sourceInput,
      `"${repo}" is not a valid GitHub repository name`,
    );
  }

  const resolvedPathSegments = pathSegments.length === 0 ? [defaultGitHubConfigPath] : pathSegments;

  if (resolvedPathSegments.some((segment) => segment.length === 0)) {
    throw invalidGitHubConfigSourceError(
      sourceInput,
      "file paths cannot contain empty segments or trailing slashes",
    );
  }

  return {
    _tag: "https",
    url: `${githubRawBaseUrl}/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${ref}/${encodeGitHubPath(resolvedPathSegments)}`,
    ...(integrity ? { integrity } : {}),
    ...(pin ? { pin } : {}),
  };
};

export const resolveConfigSource = (
  sourceInput: string,
): Effect.Effect<ConfigSource, ConfigError> =>
  Effect.try({
    try: () => {
      const trimmedSource = sourceInput.trim();
      const normalizedPrefix = trimmedSource.slice(0, githubShorthandPrefix.length).toLowerCase();

      if (normalizedPrefix === githubShorthandPrefix) {
        return resolveGitHubConfigSource(trimmedSource);
      }

      if (!urlProtocolPattern.test(trimmedSource)) {
        return { _tag: "local", path: trimmedSource } as const;
      }

      const url = new URL(trimmedSource);

      if (url.protocol === "https:") {
        const integrity = url.hash
          ? parseRemoteIntegrity(trimmedSource, url.hash.slice(1))
          : undefined;

        url.hash = "";

        return {
          _tag: "https",
          url: url.toString(),
          ...(integrity ? { integrity } : {}),
        } as const;
      }

      throw unsupportedProtocolError(trimmedSource, url.protocol);
    },
    catch: (error) =>
      error instanceof ConfigError
        ? error
        : new ConfigError({ message: "Failed to resolve config source", path: sourceInput }),
  });

export const configSourceLocation = (source: ConfigSource): string =>
  source._tag === "https" ? source.url : source.path;

export const formatRemoteConfigIntegrity = (integrity: RemoteConfigIntegrity): string =>
  `${integrity.algorithm}:${integrity.expected}`;

export const formatRemoteConfigPin = (pin: GitHubCommitPin): string => `GitHub commit ${pin.ref}`;

export const formatConfigSource = (source: ConfigSource): string =>
  source._tag === "https" ? `remote HTTPS ${source.url}` : `local file ${source.path}`;
