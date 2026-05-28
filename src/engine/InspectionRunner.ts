import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import type { SystemItem } from "../schema/config.js";
import { ShellService } from "../services/ShellService.js";
import type {
  InspectionOptions,
  InspectionResult,
  InspectionStatus,
  ItemCheckResult,
} from "./Executor.js";
import type { PlanResult } from "./Planner.js";
import { formatError } from "./ExecutionErrors.js";
import { checkItem, emitVerbose } from "./ItemOperations.js";
import { installInspection } from "./InstallInspection.js";

const { getCheckDescription, getExecutionDetail, getManagedUpdateDetail, isSymlinkInstall } =
  installInspection;

interface ReadyInspectionResult extends InspectionResult {
  readonly readyForExecution: boolean;
}

const formatInspectionBlockedReason = (
  blockedBy: readonly { readonly name: string; readonly status: InspectionStatus }[],
): string => {
  const detail = blockedBy
    .map((dependency) => `${dependency.name} (${dependency.status})`)
    .join(", ");

  return blockedBy.length === 1
    ? `Blocked by dependency that is not ready: ${detail}`
    : `Blocked by dependencies that are not ready: ${detail}`;
};

const toInspectionResult = (
  item: SystemItem,
  itemState: ItemCheckResult,
): ReadyInspectionResult => {
  if (itemState.type === "installed" && item.update) {
    return {
      name: item.name,
      status: "updateable",
      detail: item.update,
      reason: "Update command configured for this installed item.",
      readyForExecution: true,
    };
  }

  if (itemState.type === "installed") {
    return {
      name: item.name,
      status: "installed",
      readyForExecution: true,
    };
  }

  if (itemState.type === "needs_update") {
    const detail = isSymlinkInstall(item.install)
      ? getManagedUpdateDetail(item.install)
      : undefined;

    return {
      name: item.name,
      status: "updateable",
      reason: itemState.reason,
      readyForExecution: false,
      ...(detail === undefined ? {} : { detail }),
    };
  }

  const detail = getExecutionDetail(item.install);

  return {
    name: item.name,
    status: "missing",
    readyForExecution: false,
    ...(detail === undefined ? {} : { detail }),
  };
};

const inspectLevel = (
  level: readonly SystemItem[],
  inspectionByName: ReadonlyMap<string, ReadyInspectionResult>,
  options: InspectionOptions | undefined,
): Effect.Effect<readonly ReadyInspectionResult[], never, ShellService | FileSystem.FileSystem> =>
  Effect.forEach(
    level,
    (item): Effect.Effect<ReadyInspectionResult, never, ShellService | FileSystem.FileSystem> => {
      const blockedBy = (item.dependsOn ?? [])
        .map((dependencyName) => inspectionByName.get(dependencyName))
        .filter(
          (dependency): dependency is ReadyInspectionResult =>
            dependency !== undefined && !dependency.readyForExecution,
        )
        .map((dependency) => ({ name: dependency.name, status: dependency.status }));

      if (blockedBy.length > 0) {
        return Effect.succeed<ReadyInspectionResult>({
          name: item.name,
          status: "blocked",
          reason: formatInspectionBlockedReason(blockedBy),
          readyForExecution: false,
        });
      }

      return Effect.gen(function* () {
        const shell = yield* ShellService;

        emitVerbose(options, `[${item.name}] status check: ${getCheckDescription(item)}`);

        const itemState = yield* checkItem(item, shell).pipe(
          Effect.mapError((error) => formatError(error)),
        );

        return toInspectionResult(item, itemState);
      }).pipe(
        Effect.catchAll((reason) =>
          Effect.succeed<ReadyInspectionResult>({
            name: item.name,
            status: "error",
            reason,
            readyForExecution: false,
          }),
        ),
      );
    },
    { concurrency: "unbounded" },
  );

const stripInspectionReadiness = ({
  readyForExecution: _ready,
  ...result
}: ReadyInspectionResult): InspectionResult => result;

export const inspectPlan = (
  plan: PlanResult,
  options: InspectionOptions | undefined,
): Effect.Effect<readonly InspectionResult[], never, ShellService | FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const inspectionByName = new Map<string, ReadyInspectionResult>();
    const results: InspectionResult[] = [];

    for (const level of plan.levels) {
      const levelResults = yield* inspectLevel(level, inspectionByName, options);

      for (const result of levelResults) {
        inspectionByName.set(result.name, result);
      }

      results.push(...levelResults.map(stripInspectionReadiness));
    }

    return results;
  });
