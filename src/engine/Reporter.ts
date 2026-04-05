import type { ConfigSource } from "../configSource.js";
import {
  formatConfigSource,
  formatRemoteConfigIntegrity,
  formatRemoteConfigPin,
} from "../configSource.js";
import type { ExecutionMode } from "../executionMode.js";
import type { PlanResult } from "./Planner.js";
import type { ExecutionPreview, ExecutionResult } from "./Executor.js";

const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
};

const symbols = {
  check: "✓",
  cross: "✗",
  arrow: "→",
  dot: "•",
};

const formatFailureReason = (error: string | undefined): string => {
  const trimmed = error?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : "Unknown failure";
};

const printPreview = (
  preview: ExecutionPreview,
  c: typeof colors,
  log: (message: string) => void,
): void => {
  log(`    ${c.cyan}${symbols.arrow}${c.reset} ${preview.label}`);

  for (const step of preview.steps) {
    log(`      ${c.dim}${step}${c.reset}`);
  }
};

export interface Reporter {
  readonly printConfigSource: (source: ConfigSource, executionMode?: ExecutionMode) => void;
  readonly printPlan: (plan: PlanResult, dryRun?: boolean) => void;
  readonly printProgress: (result: ExecutionResult) => void;
  readonly printSummary: (results: readonly ExecutionResult[]) => void;
  readonly printVerbose: (message: string) => void;
}

export const createReporter = (options?: { noColor?: boolean; verbose?: boolean }): Reporter => {
  const c = options?.noColor
    ? (Object.fromEntries(Object.keys(colors).map((k) => [k, ""])) as typeof colors)
    : colors;

  const printConfigSource = (source: ConfigSource, executionMode?: ExecutionMode) => {
    console.log(`\n${c.bold}Config Source:${c.reset} ${formatConfigSource(source)}\n`);

    if (source._tag !== "https") {
      return;
    }

    if (source.pin) {
      console.log(
        `  ${c.cyan}${symbols.arrow}${c.reset} Remote pin: ${formatRemoteConfigPin(source.pin)}`,
      );
    }

    if (source.integrity) {
      console.log(
        `  ${c.cyan}${symbols.arrow}${c.reset} Remote integrity: ${formatRemoteConfigIntegrity(source.integrity)}`,
      );
    }

    if (source.pin || source.integrity) {
      console.log("");
    }

    if (executionMode === undefined) {
      return;
    }

    if (executionMode._tag === "remote_apply") {
      console.log(
        `  ${c.green}${symbols.check}${c.reset} Remote trust: apply enabled by --apply\n`,
      );
      return;
    }

    if (executionMode._tag === "remote_preview") {
      const guidance = executionMode.applyRequested
        ? "--dry-run is active. Re-run with --apply and without --dry-run to execute this remote config."
        : "Remote configs preview by default. Re-run with --apply to execute this config.";

      console.log(`  ${c.yellow}${symbols.dot}${c.reset} Remote trust: preview only`);
      console.log(`    ${c.dim}${symbols.arrow}${c.reset} ${guidance}\n`);
    }
  };

  const printVerbose = (message: string) => {
    if (!options?.verbose) {
      return;
    }

    console.log(`    ${c.dim}${symbols.dot}${c.reset} ${c.dim}${message}${c.reset}`);
  };

  const printPlan = (plan: PlanResult, dryRun = false) => {
    if (dryRun) {
      console.log(`\n${c.bold}Dry Run - Execution Plan:${c.reset}\n`);
    } else {
      console.log(`\n${c.bold}Execution Plan:${c.reset}\n`);
    }

    plan.levels.forEach((level, index) => {
      const levelLabel = `${c.dim}Level ${index + 1}${c.reset}`;
      const items = level.map((item) => item.name).join(", ");
      console.log(`  ${levelLabel}: ${items}`);
    });

    console.log(`\n  ${c.dim}Total: ${plan.sorted.length} items${c.reset}\n`);
  };

  const printProgress = (result: ExecutionResult) => {
    const { name, status, action, backed_up, detail, preview, error } = result;

    let statusIcon: string;
    let statusColor: string;
    let actionText: string;

    switch (action) {
      case "installed":
        statusIcon = symbols.check;
        statusColor = c.green;
        actionText = "installed";
        break;
      case "updated":
        statusIcon = symbols.check;
        statusColor = c.green;
        actionText = "updated";
        break;
      case "would_update":
        statusIcon = symbols.dot;
        statusColor = c.yellow;
        actionText = "would update";
        break;
      case "skipped":
        if (status === "installed") {
          statusIcon = symbols.check;
          statusColor = c.dim;
          actionText = "already installed";
        } else {
          statusIcon = symbols.dot;
          statusColor = c.yellow;
          actionText = "would install";
        }
        break;
      case "timed_out":
        statusIcon = symbols.cross;
        statusColor = c.red;
        actionText = "timed out";
        break;
      case "blocked":
        statusIcon = symbols.dot;
        statusColor = c.yellow;
        actionText = "blocked by dependency";
        break;
      case "failed":
        statusIcon = symbols.cross;
        statusColor = c.red;
        actionText = "failed";
        break;
    }

    const backupInfo = backed_up ? ` ${c.dim}(backed up)${c.reset}` : "";
    const detailInfo = detail ? ` ${c.dim}(${detail})${c.reset}` : "";

    console.log(
      `  ${statusColor}${statusIcon}${c.reset} ${name} ${c.dim}${symbols.arrow}${c.reset} ${actionText}${backupInfo}${detailInfo}`,
    );

    if (preview) {
      printPreview(preview, c, console.log);
    }

    if (action === "failed" || action === "timed_out" || action === "blocked") {
      console.log(
        `    ${statusColor}${symbols.arrow}${c.reset} Reason: ${formatFailureReason(error)}`,
      );
    }
  };

  const printSummary = (results: readonly ExecutionResult[]) => {
    const failedResults = results.filter((r) => r.action === "failed");
    const timedOutResults = results.filter((r) => r.action === "timed_out");
    const blockedResults = results.filter((r) => r.action === "blocked");
    const installed = results.filter((r) => r.action === "installed").length;
    const updated = results.filter((r) => r.action === "updated").length;
    const wouldUpdate = results.filter((r) => r.action === "would_update").length;
    const skipped = results.filter(
      (r) => r.action === "skipped" && r.status === "installed",
    ).length;
    const wouldInstall = results.filter(
      (r) => r.action === "skipped" && r.status === "missing",
    ).length;
    const failed = failedResults.length;
    const timedOut = timedOutResults.length;
    const blocked = blockedResults.length;
    const backedUp = results.filter((r) => r.backed_up).length;

    console.log(`\n${c.bold}Summary:${c.reset}`);

    if (installed > 0) {
      console.log(`  ${c.green}${symbols.check}${c.reset} ${installed} installed`);
    }
    if (updated > 0) {
      console.log(`  ${c.green}${symbols.check}${c.reset} ${updated} updated`);
    }
    if (wouldUpdate > 0) {
      console.log(`  ${c.yellow}${symbols.dot}${c.reset} ${wouldUpdate} would be updated`);
    }
    if (skipped > 0) {
      console.log(`  ${c.dim}${symbols.check}${c.reset} ${skipped} already installed`);
    }
    if (wouldInstall > 0) {
      console.log(`  ${c.yellow}${symbols.dot}${c.reset} ${wouldInstall} would be installed`);
    }
    if (timedOut > 0) {
      console.log(`  ${c.red}${symbols.cross}${c.reset} ${timedOut} timed out`);
      timedOutResults.forEach((result) => {
        console.log(
          `    ${c.red}${symbols.arrow}${c.reset} ${result.name}: ${formatFailureReason(result.error)}`,
        );
      });
    }
    if (failed > 0) {
      console.log(`  ${c.red}${symbols.cross}${c.reset} ${failed} failed`);
      failedResults.forEach((result) => {
        console.log(
          `    ${c.red}${symbols.arrow}${c.reset} ${result.name}: ${formatFailureReason(result.error)}`,
        );
      });
    }
    if (blocked > 0) {
      console.log(`  ${c.yellow}${symbols.dot}${c.reset} ${blocked} blocked by dependencies`);
      blockedResults.forEach((result) => {
        console.log(
          `    ${c.yellow}${symbols.arrow}${c.reset} ${result.name}: ${formatFailureReason(result.error)}`,
        );
      });
    }
    if (backedUp > 0) {
      console.log(`  ${c.cyan}${symbols.arrow}${c.reset} ${backedUp} files backed up`);
    }

    console.log("");
  };

  return { printConfigSource, printPlan, printProgress, printSummary, printVerbose };
};

export const defaultReporter = createReporter();
