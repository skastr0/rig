import type { ConfigSource } from "../configSource.js";
import {
  formatConfigSource,
  formatRemoteConfigIntegrity,
  formatRemoteConfigPin,
} from "../configSource.js";
import type { ExecutionMode } from "../executionMode.js";
import type { PlanResult } from "./Planner.js";
import type { ExecutionPreview, ExecutionResult, InspectionResult } from "./Executor.js";
import { installInspection } from "./InstallInspection.js";

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

type ReporterColors = typeof colors;
type ReporterLog = (message: string) => void;

interface ProgressDisplay {
  readonly icon: string;
  readonly color: string;
  readonly actionText: string;
}

const progressDisplayFor = (
  result: Pick<ExecutionResult, "action" | "status">,
  c: ReporterColors,
): ProgressDisplay => {
  switch (result.action) {
    case "installed":
      return { icon: symbols.check, color: c.green, actionText: "installed" };
    case "updated":
      return { icon: symbols.check, color: c.green, actionText: "updated" };
    case "would_update":
      return { icon: symbols.dot, color: c.yellow, actionText: "would update" };
    case "skipped":
      return result.status === "installed"
        ? { icon: symbols.check, color: c.dim, actionText: "already installed" }
        : { icon: symbols.dot, color: c.yellow, actionText: "would install" };
    case "timed_out":
      return { icon: symbols.cross, color: c.red, actionText: "timed out" };
    case "blocked":
      return { icon: symbols.dot, color: c.yellow, actionText: "blocked by dependency" };
    case "failed":
      return { icon: symbols.cross, color: c.red, actionText: "failed" };
  }
};

const formatBackupInfo = (backedUp: string | undefined, c: ReporterColors): string =>
  backedUp ? ` ${c.dim}(backed up)${c.reset}` : "";

const formatDetailInfo = (detail: string | undefined, c: ReporterColors): string =>
  detail ? ` ${c.dim}(${detail})${c.reset}` : "";

const actionsWithFailureReasons = new Set<ExecutionResult["action"]>([
  "failed",
  "timed_out",
  "blocked",
]);

const printsFailureReason = (action: ExecutionResult["action"]): boolean =>
  actionsWithFailureReasons.has(action);

interface InspectionStatusDisplay {
  readonly icon: string;
  readonly color: string;
  readonly label: string;
  readonly includeDetail: boolean;
}

const inspectionStatusDisplayFor = (
  status: InspectionResult["status"],
  c: ReporterColors,
): InspectionStatusDisplay => {
  switch (status) {
    case "installed":
      return { icon: symbols.check, color: c.green, label: "installed", includeDetail: true };
    case "missing":
      return { icon: symbols.dot, color: c.yellow, label: "missing", includeDetail: true };
    case "updateable":
      return { icon: symbols.arrow, color: c.cyan, label: "updateable", includeDetail: true };
    case "blocked":
      return { icon: symbols.dot, color: c.yellow, label: "blocked", includeDetail: false };
    case "error":
      return { icon: symbols.cross, color: c.red, label: "error", includeDetail: false };
  }
};

interface InspectionGroups {
  readonly installed: readonly InspectionResult[];
  readonly missing: readonly InspectionResult[];
  readonly updateable: readonly InspectionResult[];
  readonly blocked: readonly InspectionResult[];
  readonly errored: readonly InspectionResult[];
}

const groupInspectionResults = (results: readonly InspectionResult[]): InspectionGroups => ({
  installed: results.filter((result) => result.status === "installed"),
  missing: results.filter((result) => result.status === "missing"),
  updateable: results.filter((result) => result.status === "updateable"),
  blocked: results.filter((result) => result.status === "blocked"),
  errored: results.filter((result) => result.status === "error"),
});

const printInspectionRow = (
  result: InspectionResult,
  c: ReporterColors,
  log: ReporterLog,
): void => {
  const display = inspectionStatusDisplayFor(result.status, c);
  const detailInfo = display.includeDetail ? formatDetailInfo(result.detail, c) : "";

  log(
    `  ${display.color}${display.icon}${c.reset} ${result.name} ${c.dim}${symbols.arrow}${c.reset} ${display.label}${detailInfo}`,
  );

  if (result.reason) {
    log(`    ${c.dim}${symbols.arrow}${c.reset} ${result.reason}`);
  }
};

const printSummaryCount = (
  count: number,
  display: Pick<InspectionStatusDisplay, "color" | "icon" | "label">,
  c: ReporterColors,
  log: ReporterLog,
): void => {
  if (count > 0) {
    log(`  ${display.color}${display.icon}${c.reset} ${count} ${display.label}`);
  }
};

const printStatusSummary = (
  groups: InspectionGroups,
  c: ReporterColors,
  log: ReporterLog,
): void => {
  log(`\n${c.bold}Status Summary:${c.reset}`);
  printSummaryCount(groups.installed.length, inspectionStatusDisplayFor("installed", c), c, log);
  printSummaryCount(groups.missing.length, inspectionStatusDisplayFor("missing", c), c, log);
  printSummaryCount(groups.updateable.length, inspectionStatusDisplayFor("updateable", c), c, log);
  printSummaryCount(groups.blocked.length, inspectionStatusDisplayFor("blocked", c), c, log);
  printSummaryCount(groups.errored.length, inspectionStatusDisplayFor("error", c), c, log);
  log("");
};

export interface Reporter {
  readonly printConfigSource: (source: ConfigSource, executionMode?: ExecutionMode) => void;
  readonly printPlan: (plan: PlanResult, dryRun?: boolean) => void;
  readonly printStaticPreview: (plan: PlanResult, includeUpdate?: boolean) => void;
  readonly printProgress: (result: ExecutionResult) => void;
  readonly printSummary: (results: readonly ExecutionResult[]) => void;
  readonly printStatus: (results: readonly InspectionResult[]) => void;
  readonly printWhy: (report: WhyReport) => void;
  readonly printVerbose: (message: string) => void;
}

export interface WhyReport {
  readonly itemName: string;
  readonly selected: boolean;
  readonly lines: readonly string[];
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

  const getUpdatePreviews = (item: PlanResult["sorted"][number]): readonly ExecutionPreview[] => [
    ...(item.update ? [installInspection.getUpdatePreview(item.update)] : []),
    ...(installInspection.isSymlinkInstall(item.install)
      ? [installInspection.getManagedUpdatePreview(item.install)]
      : []),
  ];

  const printStaticPreview = (plan: PlanResult, includeUpdate = false) => {
    console.log(`\n${c.bold}Remote Static Preview - Execution Plan:${c.reset}\n`);

    plan.levels.forEach((level, index) => {
      const levelLabel = `${c.dim}Level ${index + 1}${c.reset}`;
      const items = level.map((item) => item.name).join(", ");
      console.log(`  ${levelLabel}: ${items}`);
    });

    console.log(`\n  ${c.dim}Total: ${plan.sorted.length} items${c.reset}`);
    console.log(
      `  ${c.dim}Checks are not executed for remote preview. Use --apply to inspect local state and execute after review.${c.reset}\n`,
    );

    for (const item of plan.sorted) {
      console.log(
        `  ${c.yellow}${symbols.dot}${c.reset} ${item.name} ${c.dim}${symbols.arrow}${c.reset} remote preview`,
      );
      printPreview(
        {
          label: "check command not executed",
          steps: [item.check ?? "no check"],
        },
        c,
        console.log,
      );
      printPreview(installInspection.getInstallPreview(item.install), c, console.log);

      if (includeUpdate) {
        for (const updatePreview of getUpdatePreviews(item)) {
          printPreview(updatePreview, c, console.log);
        }
      }
    }
  };

  const printProgress = (result: ExecutionResult) => {
    const display = progressDisplayFor(result, c);
    const backupInfo = formatBackupInfo(result.backed_up, c);
    const detailInfo = formatDetailInfo(result.detail, c);

    console.log(
      `  ${display.color}${display.icon}${c.reset} ${result.name} ${c.dim}${symbols.arrow}${c.reset} ${display.actionText}${backupInfo}${detailInfo}`,
    );

    if (result.preview) {
      printPreview(result.preview, c, console.log);
    }

    if (printsFailureReason(result.action)) {
      console.log(
        `    ${display.color}${symbols.arrow}${c.reset} Reason: ${formatFailureReason(result.error)}`,
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

  const printStatus = (results: readonly InspectionResult[]) => {
    const groups = groupInspectionResults(results);

    console.log(`\n${c.bold}Status:${c.reset}\n`);

    for (const result of results) {
      printInspectionRow(result, c, console.log);
    }

    printStatusSummary(groups, c, console.log);
  };

  const printWhy = (report: WhyReport) => {
    const heading = report.selected ? "Why Selected" : "Why Not Selected";

    console.log(`\n${c.bold}${heading}:${c.reset} ${report.itemName}\n`);

    for (const line of report.lines) {
      console.log(`  ${c.cyan}${symbols.arrow}${c.reset} ${line}`);
    }

    console.log("");
  };

  return {
    printConfigSource,
    printPlan,
    printStaticPreview,
    printProgress,
    printSummary,
    printStatus,
    printWhy,
    printVerbose,
  };
};

export const defaultReporter = createReporter();
