import type { PlanResult } from "./Planner.js";
import type { ExecutionResult } from "./Executor.js";

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

export interface Reporter {
  readonly printPlan: (plan: PlanResult, dryRun?: boolean) => void;
  readonly printProgress: (result: ExecutionResult) => void;
  readonly printSummary: (results: readonly ExecutionResult[]) => void;
}

export const createReporter = (options?: { noColor?: boolean }): Reporter => {
  const c = options?.noColor
    ? (Object.fromEntries(Object.keys(colors).map((k) => [k, ""])) as typeof colors)
    : colors;

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
    const { name, status, action, backed_up } = result;

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
      case "failed":
        statusIcon = symbols.cross;
        statusColor = c.red;
        actionText = "failed";
        break;
    }

    const backupInfo = backed_up ? ` ${c.dim}(backed up)${c.reset}` : "";

    console.log(
      `  ${statusColor}${statusIcon}${c.reset} ${name} ${c.dim}${symbols.arrow}${c.reset} ${actionText}${backupInfo}`,
    );
  };

  const printSummary = (results: readonly ExecutionResult[]) => {
    const installed = results.filter((r) => r.action === "installed").length;
    const updated = results.filter((r) => r.action === "updated").length;
    const skipped = results.filter(
      (r) => r.action === "skipped" && r.status === "installed",
    ).length;
    const wouldInstall = results.filter(
      (r) => r.action === "skipped" && r.status === "missing",
    ).length;
    const failed = results.filter((r) => r.action === "failed").length;
    const backedUp = results.filter((r) => r.backed_up).length;

    console.log(`\n${c.bold}Summary:${c.reset}`);

    if (installed > 0) {
      console.log(`  ${c.green}${symbols.check}${c.reset} ${installed} installed`);
    }
    if (updated > 0) {
      console.log(`  ${c.green}${symbols.check}${c.reset} ${updated} updated`);
    }
    if (skipped > 0) {
      console.log(`  ${c.dim}${symbols.check}${c.reset} ${skipped} already installed`);
    }
    if (wouldInstall > 0) {
      console.log(`  ${c.yellow}${symbols.dot}${c.reset} ${wouldInstall} would be installed`);
    }
    if (failed > 0) {
      console.log(`  ${c.red}${symbols.cross}${c.reset} ${failed} failed`);
    }
    if (backedUp > 0) {
      console.log(`  ${c.cyan}${symbols.arrow}${c.reset} ${backedUp} files backed up`);
    }

    console.log("");
  };

  return { printPlan, printProgress, printSummary };
};

export const defaultReporter = createReporter();
