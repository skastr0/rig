import {
  BackupError,
  BrewError,
  ConfigError,
  CycleError,
  FileSystemInstallError,
  GitError,
  ShellError,
  ValidationError,
} from "./errors.js";

interface ErrorFormatter {
  readonly tryFormat: (error: unknown) => string | undefined;
}

const errorFormatter = <TError>(
  matches: (error: unknown) => error is TError,
  format: (error: TError) => string,
): ErrorFormatter => ({
  tryFormat: (error) => (matches(error) ? format(error) : undefined),
});

const formatCommandContext = (error: {
  readonly command?: string;
  readonly exitCode?: number;
  readonly stdout?: string;
  readonly stderr?: string;
}): string =>
  `${error.command ? `\n  Command: ${error.command}` : ""}${error.exitCode !== undefined ? `\n  Exit code: ${error.exitCode}` : ""}${error.stdout ? `\n  stdout:\n${error.stdout}` : ""}${error.stderr ? `\n  stderr:\n${error.stderr}` : ""}`;

const errorFormatters = [
  errorFormatter(
    (error): error is ConfigError => error instanceof ConfigError,
    (error) =>
      `Configuration error: ${error.message}${error.path ? ` (${error.path})` : ""}${error.code ? ` [${error.code}]` : ""}`,
  ),
  errorFormatter(
    (error): error is ValidationError => error instanceof ValidationError,
    (error) => `Validation error:\n  ${error.issues.join("\n  ")}`,
  ),
  errorFormatter(
    (error): error is CycleError => error instanceof CycleError,
    (error) => `Dependency cycle detected: ${error.cycle.join(" -> ")}`,
  ),
  errorFormatter(
    (error): error is ShellError => error instanceof ShellError,
    (error) =>
      `Command failed: ${error.command}\n  Exit code: ${error.exitCode}${error.stdout ? `\n  stdout:\n${error.stdout}` : ""}${error.stderr ? `\n  stderr:\n${error.stderr}` : ""}`,
  ),
  errorFormatter(
    (error): error is GitError => error instanceof GitError,
    (error) => `Git error for ${error.repo}: ${error.reason}${formatCommandContext(error)}`,
  ),
  errorFormatter(
    (error): error is BrewError => error instanceof BrewError,
    (error) =>
      `Brew error for ${error.formula_or_cask}: ${error.reason}${formatCommandContext(error)}`,
  ),
  errorFormatter(
    (error): error is BackupError => error instanceof BackupError,
    (error) => `Backup error for ${error.path}: ${error.reason}`,
  ),
  errorFormatter(
    (error): error is FileSystemInstallError => error instanceof FileSystemInstallError,
    (error) => `Filesystem item error for ${error.path}: ${error.reason}`,
  ),
] as const;

export const formatError = (error: unknown): string => {
  for (const formatter of errorFormatters) {
    const message = formatter.tryFormat(error);
    if (message) {
      return message;
    }
  }

  return String(error);
};
