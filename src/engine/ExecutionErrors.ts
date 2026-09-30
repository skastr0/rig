import type { BrewError, GitError } from "../errors.js";
import type { ExecuteItemError } from "./ExecutionBranches.js";

export type ExecutionError = ExecuteItemError;

const formatReason = (reason: string, fallback: string): string => {
  const trimmed = reason.trim();
  return trimmed.length > 0 ? trimmed : fallback;
};

const formatStructuredCommandDetail = (
  error: Pick<GitError | BrewError, "command" | "exitCode" | "stdout" | "stderr">,
): string => {
  const details: string[] = [];

  if (error.command) {
    details.push(`Command: ${error.command}`);
  }

  if (error.exitCode !== undefined && error.exitCode >= 0) {
    details.push(`Exit code: ${error.exitCode}`);
  }

  const stdout = error.stdout?.trim();
  if (stdout && stdout.length > 0) {
    details.push(`Stdout: ${stdout}`);
  }

  const stderr = error.stderr?.trim();
  if (stderr && stderr.length > 0) {
    details.push(`Stderr: ${stderr}`);
  }

  return details.length === 0 ? "" : `\n  ${details.join("\n  ")}`;
};

export const isTimeoutError = (error: ExecutionError): boolean =>
  ("timedOut" in error && error.timedOut === true) || false;

const formatTimeoutSuffix = (timeoutMs: number | undefined): string =>
  timeoutMs === undefined ? "" : ` after ${timeoutMs}ms`;

export const formatError = (error: ExecutionError): string => {
  switch (error._tag) {
    case "ShellError": {
      const stdoutDetail =
        error.stdout === undefined ? "" : formatStructuredCommandDetail({ stdout: error.stdout });
      return error.timedOut
        ? `Command "${error.command}" timed out${formatTimeoutSuffix(error.timeoutMs)}: ${formatReason(error.stderr, "No stderr output")}${stdoutDetail}`
        : `Command "${error.command}" failed with exit code ${error.exitCode}: ${formatReason(error.stderr, "No stderr output")}${stdoutDetail}`;
    }
    case "GitError":
      return error.timedOut
        ? `Git operation for ${error.repo} timed out${formatTimeoutSuffix(error.timeoutMs)}: ${formatReason(error.reason, "No reason provided")}${formatStructuredCommandDetail(error)}`
        : `Git error for ${error.repo}: ${formatReason(error.reason, "No reason provided")}${formatStructuredCommandDetail(error)}`;
    case "BrewError":
      return error.timedOut
        ? `Brew operation for ${error.formula_or_cask} timed out${formatTimeoutSuffix(error.timeoutMs)}: ${formatReason(error.reason, "No reason provided")}${formatStructuredCommandDetail(error)}`
        : `Brew error for ${error.formula_or_cask}: ${formatReason(error.reason, "No reason provided")}${formatStructuredCommandDetail(error)}`;
    case "BackupError":
      return `Backup error for ${error.path}: ${formatReason(error.reason, "No reason provided")}`;
    case "FileSystemInstallError":
      return `Filesystem item error for ${error.path}: ${formatReason(error.reason, "No reason provided")}`;
    case "ItemVerificationError":
      return `Verification failed for ${error.itemName}: ${error.reason}`;
  }
};
