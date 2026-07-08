import { ConfigError } from "./errors.js";

/**
 * Structured domain codes for config resolution/load failures.
 * `message` remains the human-facing surface; `code` is machine-stable.
 */
export type ConfigErrorCode =
  | "not_found"
  | "access_failed"
  | "read_failed"
  | "write_failed"
  | "already_exists"
  | "source_invalid"
  | "unsupported_protocol"
  | "integrity_invalid"
  | "integrity_mismatch"
  | "remote_fetch_failed"
  | "remote_timeout"
  | "remote_pin_unresolved"
  | "github_cli_unavailable"
  | "github_cli_failed"
  | "github_load_failed"
  | "invalid_json"
  | "schema_invalid"
  | "validation_failed"
  | "discovery_failed"
  | "user_config_invalid"
  | "init_remote_rejected";

export const configError = (input: {
  readonly code: ConfigErrorCode;
  readonly message: string;
  readonly path?: string;
}): ConfigError =>
  new ConfigError({
    message: input.message,
    ...(input.path !== undefined ? { path: input.path } : {}),
    code: input.code,
  });
