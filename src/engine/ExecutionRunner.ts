import { FileSystem } from "@effect/platform";
import { Deferred, Effect, Ref } from "effect";
import type { SystemItem } from "../schema/config.js";
import type { PlanResult } from "./Planner.js";
import { BackupService } from "../services/BackupService.js";
import { BrewService } from "../services/BrewService.js";
import { GitService } from "../services/GitService.js";
import { ShellService } from "../services/ShellService.js";
import type {
  BackupError,
  BrewError,
  FileSystemInstallError,
  GitError,
  ShellError,
} from "../errors.js";
import type { ExecutionResult, ExecutorOptions, ItemAction } from "./Executor.js";
import { executeCheckedItem } from "./ExecutionBranches.js";
import { formatError, isTimeoutError, type ExecutionError } from "./ExecutionErrors.js";
import { acquireGroupLock, releaseGroupLock } from "./ExecutionGroupLocks.js";
import { checkItem, emitVerbose, itemExecutionOperations } from "./ItemOperations.js";
import { installInspection } from "./InstallInspection.js";

const { getCheckDescription, isBrewInstall, isSkillsInstall } = installInspection;

const executeItem = (
  item: SystemItem,
  options: ExecutorOptions | undefined,
  groupLocks: Ref.Ref<Map<string, Deferred.Deferred<void>>>,
): Effect.Effect<
  ExecutionResult,
  ShellError | GitError | BrewError | BackupError | FileSystemInstallError,
  ShellService | BackupService | GitService | BrewService | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const services = {
      shell: yield* ShellService,
      backup: yield* BackupService,
      git: yield* GitService,
      brew: yield* BrewService,
      fs: yield* FileSystem.FileSystem,
    };

    const effectiveGroup = isBrewInstall(item.install)
      ? (item.group ?? "brew")
      : isSkillsInstall(item.install)
        ? (item.group ?? "skills")
        : item.group;
    const lock = yield* acquireGroupLock(effectiveGroup, groupLocks);

    const executeWithLock = Effect.gen(function* () {
      emitVerbose(options, `[${item.name}] check: ${getCheckDescription(item)}`);
      const itemState = yield* checkItem(item, services.shell);
      return yield* executeCheckedItem(item, itemState, services, itemExecutionOperations, options);
    });

    return yield* executeWithLock.pipe(
      Effect.ensuring(releaseGroupLock(effectiveGroup, lock, groupLocks)),
    );
  });

const makeExecutionFailureResult = (
  item: SystemItem,
  error: ExecutionError,
  options: ExecutorOptions | undefined,
): ExecutionResult => {
  const result: ExecutionResult = {
    name: item.name,
    status: "error",
    action: isTimeoutError(error) ? "timed_out" : "failed",
    error: formatError(error),
  };

  options?.onProgress?.(result);
  emitVerbose(
    options,
    `[${item.name}] ${result.action === "timed_out" ? "timeout" : "failure"}: ${result.error ?? "Unknown failure"}`,
  );

  return result;
};

const executeLevel = (
  items: readonly SystemItem[],
  options: ExecutorOptions | undefined,
  groupLocks: Ref.Ref<Map<string, Deferred.Deferred<void>>>,
): Effect.Effect<
  readonly ExecutionResult[],
  never,
  ShellService | BackupService | GitService | BrewService | FileSystem.FileSystem
> =>
  Effect.forEach(
    items,
    (item) =>
      executeItem(item, options, groupLocks).pipe(
        Effect.catchAll((error) =>
          Effect.succeed(makeExecutionFailureResult(item, error, options)),
        ),
      ),
    { concurrency: "unbounded" },
  );

const isBlockingAction = (action: ItemAction): boolean =>
  action === "failed" || action === "timed_out" || action === "blocked";

const getBlockingDependencies = (
  item: SystemItem,
  invalidatedItems: ReadonlySet<string>,
): readonly string[] =>
  (item.dependsOn ?? []).filter((dependency) => invalidatedItems.has(dependency));

const formatBlockedReason = (blockedBy: readonly string[]): string =>
  blockedBy.length === 1
    ? `Blocked by unsuccessful dependency: ${blockedBy[0]}`
    : `Blocked by unsuccessful dependencies: ${blockedBy.join(", ")}`;

const makeBlockedResult = (item: SystemItem, blockedBy: readonly string[]): ExecutionResult => ({
  name: item.name,
  status: "blocked",
  action: "blocked",
  error: formatBlockedReason(blockedBy),
});

const orderLevelResults = (
  level: readonly SystemItem[],
  levelResults: readonly ExecutionResult[],
): readonly ExecutionResult[] => {
  const byName = new Map(levelResults.map((result) => [result.name, result]));
  return level.map((item) => byName.get(item.name)!);
};

export const executePlan = (
  plan: PlanResult,
  options: ExecutorOptions | undefined,
): Effect.Effect<
  readonly ExecutionResult[],
  never,
  ShellService | BackupService | GitService | BrewService | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const groupLocks = yield* Ref.make(new Map<string, Deferred.Deferred<void>>());
    const invalidatedItems = new Set<string>();
    const results: ExecutionResult[] = [];

    for (const level of plan.levels) {
      const blockedResults: ExecutionResult[] = [];
      const runnableItems: SystemItem[] = [];

      for (const item of level) {
        const blockedBy = getBlockingDependencies(item, invalidatedItems);
        if (blockedBy.length > 0) {
          blockedResults.push(makeBlockedResult(item, blockedBy));
        } else {
          runnableItems.push(item);
        }
      }

      for (const result of blockedResults) {
        options?.onProgress?.(result);
        emitVerbose(options, `[${result.name}] blocked: ${result.error ?? "Dependency failure"}`);
        invalidatedItems.add(result.name);
      }

      const executedResults = yield* executeLevel(runnableItems, options, groupLocks);

      for (const result of executedResults) {
        if (isBlockingAction(result.action)) {
          invalidatedItems.add(result.name);
        }
      }

      results.push(...orderLevelResults(level, [...blockedResults, ...executedResults]));
    }

    return results;
  });
