import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import type { CliOptions } from "../cli.js";
import type { ConfigSource } from "../configSource.js";
import { resolveExecutionMode } from "../executionMode.js";
import { Executor, type ExecutionResult } from "../engine/Executor.js";
import { installInspection } from "../engine/InstallInspection.js";
import { topologicalSort } from "../engine/Planner.js";
import type { SystemItem } from "../schema/config.js";
import type { BackupService } from "../services/BackupService.js";
import type { BrewService } from "../services/BrewService.js";
import type { GitService } from "../services/GitService.js";
import type { ShellService } from "../services/ShellService.js";
import {
  formatExecutionPreviewLogs,
  formatExecutionResultLog,
  summarizeSelection,
  type LogKind,
} from "./model.js";

export interface InteractiveCommandInput {
  readonly options: CliOptions;
  readonly configSource: ConfigSource;
  readonly items: readonly SystemItem[];
}

export interface PendingLogLine {
  readonly kind: LogKind;
  readonly message: string;
  readonly itemName?: string;
}

export interface InteractiveRunRequest {
  readonly profile: string;
  readonly tags: readonly string[];
  readonly only: readonly string[];
  readonly dryRun: boolean;
  readonly update: boolean;
  readonly verbose: boolean;
  readonly apply: boolean;
}

export interface InteractiveRunSummary {
  readonly results: readonly ExecutionResult[];
}

export type ExecuteInteractiveRun = (
  request: InteractiveRunRequest,
  emit: (line: PendingLogLine) => void,
  signal: AbortSignal,
) => Promise<InteractiveRunSummary>;

export const formatPlanLine = (results: readonly ExecutionResult[]): string => {
  const failed = results.filter((result) => result.action === "failed").length;
  const timedOut = results.filter((result) => result.action === "timed_out").length;
  const blocked = results.filter((result) => result.action === "blocked").length;

  if (failed > 0 || timedOut > 0 || blocked > 0) {
    return `completed with ${failed} failed, ${timedOut} timed out, ${blocked} blocked`;
  }

  return `completed ${results.length} items`;
};

const emitExecutionResult = (
  result: ExecutionResult,
  emit: (line: PendingLogLine) => void,
): void => {
  for (const previewLine of formatExecutionPreviewLogs(result)) {
    emit({ kind: "preview", message: previewLine, itemName: result.name });
  }

  emit({
    kind: result.action === "failed" || result.action === "timed_out" ? "error" : "progress",
    message: formatExecutionResultLog(result),
    itemName: result.name,
  });
};

const getRemoteStaticPreviewSteps = (
  item: SystemItem,
  includeUpdate: boolean,
): readonly string[] => {
  const installPreview = installInspection.getInstallPreview(item.install);
  const steps = [
    `check skipped: ${item.check ?? "no check command"}`,
    `${installPreview.label}:`,
    ...installPreview.steps,
  ];

  if (includeUpdate && item.update) {
    const updatePreview = installInspection.getUpdatePreview(item.update);
    steps.push(`${updatePreview.label}:`, ...updatePreview.steps);
  }

  if (includeUpdate && installInspection.isSymlinkInstall(item.install)) {
    const updatePreview = installInspection.getManagedUpdatePreview(item.install);
    steps.push(`${updatePreview.label}:`, ...updatePreview.steps);
  }

  return steps;
};

const makeRemotePreviewResults = (
  items: readonly SystemItem[],
  includeUpdate: boolean,
): readonly ExecutionResult[] =>
  items.map((item) => {
    return {
      name: item.name,
      status: "missing",
      action: "skipped",
      detail: "remote preview; check not executed",
      preview: {
        label: "remote static preview",
        steps: getRemoteStaticPreviewSteps(item, includeUpdate),
      },
    };
  });

export const executeInteractivePlan = (
  input: InteractiveCommandInput,
  request: InteractiveRunRequest,
  emit: (line: PendingLogLine) => void,
): Effect.Effect<
  InteractiveRunSummary,
  unknown,
  Executor | ShellService | BackupService | GitService | BrewService | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const selection = summarizeSelection(input.items, request.profile, request.tags, request.only);
    const plan = yield* topologicalSort(selection.analysis.selectedItems);
    const executionMode = resolveExecutionMode(input.configSource, {
      dryRun: request.dryRun,
      apply: request.apply,
    });

    if (executionMode._tag === "remote_preview") {
      emit({
        kind: "system",
        message: `previewing ${plan.sorted.length} items`,
      });
      emit({
        kind: "system",
        message: "Remote preview is static; checks are not executed without --apply",
      });
      const results = makeRemotePreviewResults(plan.sorted, request.update);
      for (const result of results) {
        emitExecutionResult(result, emit);
      }
      return { results } satisfies InteractiveRunSummary;
    }

    emit({
      kind: "system",
      message: `${executionMode.dryRun ? "previewing" : "running"} ${plan.sorted.length} items`,
    });

    const executor = yield* Executor;

    const results = yield* executor.execute(plan, {
      dryRun: executionMode.dryRun,
      update: request.update,
      verbose: request.verbose,
      onOutput: (output) =>
        emit({
          kind: "output",
          message: `[${output.itemName}] ${output.stream}: ${output.line}`,
          itemName: output.itemName,
        }),
      onVerbose: (message) => emit({ kind: "verbose", message }),
      onProgress: (result) => emitExecutionResult(result, emit),
    });

    return { results } satisfies InteractiveRunSummary;
  });
