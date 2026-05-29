import type { CliOptions } from "../cli.js";
import type { ConfigSource } from "../configSource.js";

export const getRunDisabledReason = (
  configSource: ConfigSource,
  options: CliOptions,
): string | undefined => {
  if (options.dryRun) {
    return "--dry-run is active";
  }

  if (configSource._tag === "https" && !options.apply) {
    return "remote source requires --apply";
  }

  return undefined;
};
