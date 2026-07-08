import type { CliOptions } from "../cli.js";
import { isRemoteConfigSource, type ConfigSource } from "../configSource.js";

export const getRunDisabledReason = (
  configSource: ConfigSource,
  options: CliOptions,
): string | undefined => {
  if (options.dryRun) {
    return "--dry-run is active";
  }

  if (isRemoteConfigSource(configSource) && !options.apply) {
    return "remote source requires --apply";
  }

  return undefined;
};
