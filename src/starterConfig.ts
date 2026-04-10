import { Effect, Schema } from "effect";
import { ConfigError } from "./errors.js";
import { SystemConfig } from "./schema/config.js";

export const starterConfigDocsPath = "USAGE.md#your-first-configuration";

const canonicalStarterConfig = {
  items: [
    {
      name: "neovim",
      check: "which nvim",
      install: "brew install neovim",
      group: "brew",
    },
  ],
} satisfies Schema.Schema.Type<typeof SystemConfig>;

const toStarterConfigError = (error: unknown): ConfigError =>
  new ConfigError({
    message: `Starter config schema validation failed: ${error instanceof Error ? error.message : String(error)}`,
  });

export const renderStarterConfig = (): Effect.Effect<string, ConfigError> =>
  Schema.decodeUnknown(SystemConfig)(canonicalStarterConfig).pipe(
    Effect.map((config) => `${JSON.stringify(config, null, 2)}\n`),
    Effect.mapError(toStarterConfigError),
  );
