import { Context, Effect, Layer, Schema } from "effect";
import { FileSystem } from "@effect/platform";
import { ConfigError } from "../errors.js";
import { SystemConfig, SystemItem } from "../schema/config.js";

export interface ResolvedConfig {
  readonly items: readonly SystemItem[];
}

export interface ConfigService {
  readonly load: (
    path: string,
    profile?: string,
  ) => Effect.Effect<ResolvedConfig, ConfigError, FileSystem.FileSystem>;
}

export const ConfigService = Context.GenericTag<ConfigService>("ConfigService");

export const ConfigServiceLive = Layer.succeed(
  ConfigService,
  ConfigService.of({
    load: (configPath, profile) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;

        const exists = yield* fs.exists(configPath).pipe(Effect.orDie);
        if (!exists) {
          return yield* Effect.fail(
            new ConfigError({ message: "Config file not found", path: configPath }),
          );
        }

        const content = yield* fs
          .readFileString(configPath)
          .pipe(
            Effect.mapError(
              () => new ConfigError({ message: "Failed to read config file", path: configPath }),
            ),
          );

        const parsed = yield* Effect.try({
          try: () => JSON.parse(content) as unknown,
          catch: () => new ConfigError({ message: "Invalid JSON", path: configPath }),
        });

        const decodeResult = yield* Schema.decodeUnknown(SystemConfig)(parsed).pipe(
          Effect.mapError(
            (error) =>
              new ConfigError({
                message: `Schema validation failed: ${error.message}`,
                path: configPath,
              }),
          ),
        );

        const items = resolveProfile(decodeResult, profile);

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
