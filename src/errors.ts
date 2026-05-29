import { Data } from "effect";

export class ConfigError extends Data.TaggedError("ConfigError")<{
  readonly message: string;
  readonly path?: string;
}> {}

export class ShellError extends Data.TaggedError("ShellError")<{
  readonly command: string;
  readonly exitCode: number;
  readonly stdout?: string;
  readonly stderr: string;
  readonly timedOut?: boolean;
  readonly timeoutMs?: number;
}> {}

export class GitError extends Data.TaggedError("GitError")<{
  readonly repo: string;
  readonly reason: string;
  readonly command?: string;
  readonly exitCode?: number;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly timedOut?: boolean;
  readonly timeoutMs?: number;
}> {}

export class BrewError extends Data.TaggedError("BrewError")<{
  readonly formula_or_cask: string;
  readonly reason: string;
  readonly command?: string;
  readonly exitCode?: number;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly timedOut?: boolean;
  readonly timeoutMs?: number;
}> {}

export class FileSystemInstallError extends Data.TaggedError("FileSystemInstallError")<{
  readonly path: string;
  readonly reason: string;
}> {}

export class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly issues: readonly string[];
}> {}

export class CycleError extends Data.TaggedError("CycleError")<{
  readonly cycle: readonly string[];
}> {}

export class BackupError extends Data.TaggedError("BackupError")<{
  readonly path: string;
  readonly reason: string;
}> {}
