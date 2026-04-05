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
import { SystemConfig, SystemItem } from "../schema/config.js";

const remoteConfigTimeoutMs = 10_000;

const sha256Digest = (content: string): string =>
  createHash("sha256").update(content).digest("hex");

export interface ResolvedConfig {
  readonly items: readonly SystemItem[];
}

export interface ConfigService {
  readonly load: (
    source: ConfigSource,
    profile?: string,
  ) => Effect.Effect<ResolvedConfig, ConfigError, FileSystem.FileSystem>;
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

    return yield* Schema.decodeUnknown(SystemConfig)(parsed).pipe(
      Effect.mapError(
        (error) =>
          new ConfigError({
            message: `Schema validation failed: ${error.message}`,
            path: sourceLocation,
          }),
      ),
    );
  });

export const ConfigServiceLive = Layer.succeed(
  ConfigService,
  ConfigService.of({
    load: (source, profile) =>
      Effect.gen(function* () {
        const content = yield* source._tag === "https"
          ? loadRemoteConfigContent(source)
          : loadLocalConfigContent(source.path);

        const decodedConfig = yield* decodeConfig(content, source);
        const items = resolveProfile(decodedConfig, profile);

        return { items };
      }),
  }),
);

function resolveProfile(config: SystemConfig, profileName?: string): readonly SystemItem[] {
  const baseItems = config.items;

  if (!profileName || !config.profiles) {
    return baseItems;
  }

  const profile = config.profiles[profileName];
  if (!profile) {
    return baseItems;
  }

  const excludeSet = new Set(profile.exclude ?? []);

  const filteredBase = baseItems.filter((item) => !excludeSet.has(item.name));

  const profileItems = profile.items ?? [];

  return [...filteredBase, ...profileItems];
}
