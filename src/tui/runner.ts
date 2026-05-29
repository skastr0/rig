import { Effect } from "effect";
import type { CliOptions } from "../cli.js";
import type { ConfigSource } from "../configSource.js";
import { resolveExecutionMode } from "../executionMode.js";
import { Executor, type ExecutionResult } from "../engine/Executor.js";
import { topologicalSort } from "../engine/Planner.js";
import type { SystemItem } from "../schema/config.js";
import { formatExecutionResultLog, summarizeSelection, type LogKind } from "./model.js";

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

export const executeInteractivePlan = (
  input: InteractiveCommandInput,
  request: InteractiveRunRequest,
  emit: (line: PendingLogLine) => void,
) =>
  Effect.gen(function* () {
    const selection = summarizeSelection(input.items, request.profile, request.tags);
    const plan = yield* topologicalSort(selection.analysis.selectedItems);
    const executionMode = resolveExecutionMode(input.configSource, {
      dryRun: request.dryRun,
      apply: request.apply,
    });
    const executor = yield* Executor;

    emit({
      kind: "system",
      message: `${request.dryRun ? "previewing" : "running"} ${plan.sorted.length} items`,
    });

    const results = yield* executor.execute(plan, {
      dryRun: executionMode.dryRun,
      update: request.update,
      verbose: request.verbose,
      onVerbose: (message) => emit({ kind: "verbose", message }),
      onProgress: (result) =>
        emit({
          kind: result.action === "failed" || result.action === "timed_out" ? "error" : "progress",
          message: formatExecutionResultLog(result),
          itemName: result.name,
        }),
    });

    return { results } satisfies InteractiveRunSummary;
  });
