import { isRemoteConfigSource, type ConfigSource } from "./configSource.js";

export type ExecutionMode =
  | {
      readonly _tag: "local_apply";
      readonly dryRun: false;
    }
  | {
      readonly _tag: "local_preview";
      readonly dryRun: true;
    }
  | {
      readonly _tag: "remote_preview";
      readonly dryRun: true;
      readonly applyRequested: boolean;
    }
  | {
      readonly _tag: "remote_apply";
      readonly dryRun: false;
    };

export interface ExecutionModeOptions {
  readonly dryRun: boolean;
  readonly apply: boolean;
}

export const resolveExecutionMode = (
  source: ConfigSource,
  options: ExecutionModeOptions,
): ExecutionMode => {
  if (isRemoteConfigSource(source)) {
    if (options.dryRun || !options.apply) {
      return {
        _tag: "remote_preview",
        dryRun: true,
        applyRequested: options.apply,
      };
    }

    return {
      _tag: "remote_apply",
      dryRun: false,
    };
  }

  if (options.dryRun) {
    return {
      _tag: "local_preview",
      dryRun: true,
    };
  }

  return {
    _tag: "local_apply",
    dryRun: false,
  };
};
