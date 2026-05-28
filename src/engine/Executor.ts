import { Context, Effect, Layer, Ref, Deferred } from "effect";
import { FileSystem } from "@effect/platform";
import type {
  SystemItem,
  DirInstall,
  SymlinkInstall,
  TimeoutInput as ItemTimeoutInput,
} from "../schema/config.js";
import type { PlanResult } from "./Planner.js";
import { ShellService, type ShellResult } from "../services/ShellService.js";
import { BackupService } from "../services/BackupService.js";
import { GitService } from "../services/GitService.js";
import { BrewService } from "../services/BrewService.js";
import { ShellError, GitError, BrewError, BackupError, FileSystemInstallError } from "../errors.js";
import { expandPath } from "../utils.js";
import { installInspection } from "./InstallInspection.js";
import {
  executeCheckedItem,
  type ExecuteItemError,
  type ItemExecutionOperations,
  type ItemExecutionServices,
} from "./ExecutionBranches.js";

export type ItemStatus = "installed" | "missing" | "error" | "blocked";
export type ItemAction =
  | "skipped"
  | "installed"
  | "updated"
  | "would_update"
  | "failed"
  | "timed_out"
  | "blocked";

export interface ExecutionPreview {
  readonly label: string;
  readonly steps: readonly string[];
}

export interface ExecutionResult {
  readonly name: string;
  readonly status: ItemStatus;
  readonly action: ItemAction;
  readonly backed_up?: string;
  readonly detail?: string;
  readonly preview?: ExecutionPreview;
  readonly error?: string;
}

export type InspectionStatus = "installed" | "missing" | "updateable" | "blocked" | "error";

export interface InspectionResult {
  readonly name: string;
  readonly status: InspectionStatus;
  readonly detail?: string;
  readonly reason?: string;
}

interface ReadyInspectionResult extends InspectionResult {
  readonly readyForExecution: boolean;
}

export interface InspectionOptions {
  readonly verbose?: boolean;
  readonly onVerbose?: (message: string) => void;
}

export interface ExecutorOptions {
  readonly dryRun?: boolean;
  readonly update?: boolean;
  readonly verbose?: boolean;
  readonly onProgress?: (result: ExecutionResult) => void;
  readonly onVerbose?: (message: string) => void;
}

export interface Executor {
  readonly execute: (
    plan: PlanResult,
    options?: ExecutorOptions,
  ) => Effect.Effect<
    readonly ExecutionResult[],
    never,
    ShellService | BackupService | GitService | BrewService | FileSystem.FileSystem
  >;
  readonly inspect: (
    plan: PlanResult,
    options?: InspectionOptions,
  ) => Effect.Effect<readonly InspectionResult[], never, ShellService | FileSystem.FileSystem>;
}

export const Executor = Context.GenericTag<Executor>("Executor");

const {
  checkDirInstall,
  checkSkillsInstall,
  checkSymlinkInstall,
  getCheckDescription,
  getExecutionDetail,
  getInstallPreview,
  getManagedUpdateDetail,
  getManagedUpdatePreview,
  getManagedUpdatePreviewSteps,
  getShellUpdatePreview,
  getSkillsAddArgs,
  getSymlinkDisplayTarget,
  getSymlinkLinkPath,
  getSymlinkTargetForCreate,
  isBrewInstall,
  isDirInstall,
  isGitInstall,
  isSkillsInstall,
  isSymlinkInstall,
  mapFileSystemError,
  normalizeManagedPath,
  toFileSystemInstallError,
} = installInspection;

export type ItemCheckResult =
  | { type: "installed" }
  | { type: "missing" }
  | { type: "needs_update"; reason: string };

const emitVerbose = (options: ExecutorOptions | undefined, message: string): void => {
  if (options?.verbose) {
    options.onVerbose?.(message);
  }
};

const emitCommandStream = (
  itemName: string,
  stream: "stdout" | "stderr",
  output: string,
  options: ExecutorOptions | undefined,
): void => {
  const normalized = output.trimEnd();
  if (normalized.trim().length === 0) {
    return;
  }

  for (const line of normalized.split(/\r?\n/)) {
    emitVerbose(options, `[${itemName}] ${stream}: ${line}`);
  }
};

const emitCommandOutput = (
  itemName: string,
  result: ShellResult,
  options: ExecutorOptions | undefined,
): void => {
  emitCommandStream(itemName, "stdout", result.stdout, options);
  emitCommandStream(itemName, "stderr", result.stderr, options);
};

const toTimeoutOptions = (
  timeout: ItemTimeoutInput | undefined,
): { timeout: ItemTimeoutInput } | undefined => (timeout === undefined ? undefined : { timeout });

const runShellCommand = (
  itemName: string,
  command: string,
  shell: ShellService,
  timeout: SystemItem["timeout"],
  options: ExecutorOptions | undefined,
): Effect.Effect<ShellResult, ShellError> =>
  shell
    .run(command, toTimeoutOptions(timeout))
    .pipe(Effect.tap((result) => Effect.sync(() => emitCommandOutput(itemName, result, options))));

const checkGenericItem = (
  item: SystemItem,
  shell: ShellService,
): Effect.Effect<boolean, ShellError, FileSystem.FileSystem> => {
  const checkMode = item.onCheck ?? "exit-code";
  const check = item.check ?? "";

  if (checkMode === "path-exists") {
    return Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const expandedPath = expandPath(check);
      return yield* fs.exists(expandedPath).pipe(Effect.catchAll(() => Effect.succeed(false)));
    });
  }

  return shell.run(check, toTimeoutOptions(item.timeout)).pipe(
    Effect.map(() => true),
    Effect.catchAll((error) => (error.timedOut ? Effect.fail(error) : Effect.succeed(false))),
  );
};

const checkItem = (
  item: SystemItem,
  shell: ShellService,
): Effect.Effect<ItemCheckResult, ShellError | FileSystemInstallError, FileSystem.FileSystem> => {
  if (isDirInstall(item.install)) {
    return checkDirInstall(item.install);
  }

  if (isSymlinkInstall(item.install)) {
    return checkSymlinkInstall(item.install);
  }

  if (isSkillsInstall(item.install)) {
    return checkSkillsInstall(item.install);
  }

  return checkGenericItem(item, shell).pipe(
    Effect.map((isInstalled) => (isInstalled ? { type: "installed" } : { type: "missing" })),
  );
};

const installDirItem = (
  install: DirInstall,
  fs: FileSystem.FileSystem,
): Effect.Effect<void, FileSystemInstallError> => {
  const path = normalizeManagedPath(install.path);
  return fs
    .makeDirectory(path, { recursive: true })
    .pipe(Effect.mapError(mapFileSystemError(path, `Failed to create directory "${path}"`)));
};

const createSymlink = (
  install: SymlinkInstall,
  fs: FileSystem.FileSystem,
): Effect.Effect<void, FileSystemInstallError> => {
  const linkPath = getSymlinkLinkPath(install);
  const rawTarget = getSymlinkTargetForCreate(install.target);
  const displayTarget = getSymlinkDisplayTarget(install);

  return fs
    .symlink(rawTarget, linkPath)
    .pipe(
      Effect.mapError(
        mapFileSystemError(
          linkPath,
          `Failed to create symlink "${linkPath}" -> "${displayTarget}"`,
        ),
      ),
    );
};

const updateSymlinkItem = (
  install: SymlinkInstall,
  fs: FileSystem.FileSystem,
): Effect.Effect<void, FileSystemInstallError> => {
  const linkPath = getSymlinkLinkPath(install);

  return Effect.gen(function* () {
    yield* fs
      .remove(linkPath, { recursive: true })
      .pipe(
        Effect.mapError(
          mapFileSystemError(
            linkPath,
            `Failed to remove existing path at "${linkPath}" before updating symlink`,
          ),
        ),
      );
    yield* createSymlink(install, fs);
  });
};

const installItem = (
  item: SystemItem,
  shell: ShellService,
  git: GitService,
  brew: BrewService,
  fs: FileSystem.FileSystem,
  options: ExecutorOptions | undefined,
): Effect.Effect<
  void,
  ShellError | GitError | BrewError | FileSystemInstallError,
  ShellService
> => {
  if (isGitInstall(item.install)) {
    return git.clone(item.install, toTimeoutOptions(item.timeout));
  }

  if (isBrewInstall(item.install)) {
    return brew.install(item.install, toTimeoutOptions(item.timeout));
  }

  if (isDirInstall(item.install)) {
    return installDirItem(item.install, fs);
  }

  if (isSymlinkInstall(item.install)) {
    return createSymlink(item.install, fs);
  }

  if (isSkillsInstall(item.install)) {
    return shell.exec("env", getSkillsAddArgs(item.install), toTimeoutOptions(item.timeout)).pipe(
      Effect.tap((result) => Effect.sync(() => emitCommandOutput(item.name, result, options))),
      Effect.asVoid,
    );
  }

  return runShellCommand(item.name, item.install, shell, item.timeout, options).pipe(Effect.asVoid);
};

const updateItem = (
  item: SystemItem,
  shell: ShellService,
  options: ExecutorOptions | undefined,
): Effect.Effect<void, ShellError, never> => {
  // Update command is always a string (git updates handled via install strategy)
  if (!item.update) {
    return Effect.void;
  }
  return runShellCommand(item.name, item.update, shell, item.timeout, options).pipe(Effect.asVoid);
};

const itemExecutionOperations: ItemExecutionOperations = {
  emitVerbose,
  isSymlinkInstall,
  toFileSystemInstallError,
  getSymlinkLinkPath,
  getShellUpdatePreview,
  getManagedUpdatePreview,
  getManagedUpdateDetail,
  getManagedUpdatePreviewSteps,
  getInstallPreview,
  getExecutionDetail,
  updateItem,
  updateSymlinkItem,
  installItem,
};

type LockResult =
  | { type: "wait"; lock: Deferred.Deferred<void> }
  | { type: "acquired"; lock: Deferred.Deferred<void> };

const acquireGroupLock = (
  group: string | undefined,
  groupLocks: Ref.Ref<Map<string, Deferred.Deferred<void>>>,
): Effect.Effect<Deferred.Deferred<void> | null> =>
  Effect.gen(function* () {
    if (!group) return null;

    // Create our lock before the atomic operation
    const myLock = yield* Deferred.make<void>();

    // Atomically check-and-set to avoid race condition
    const result: LockResult = yield* Ref.modify(groupLocks, (locks) => {
      const existingLock = locks.get(group);
      if (existingLock) {
        // Return existing lock to wait on, don't modify state
        return [{ type: "wait", lock: existingLock } as LockResult, locks] as const;
      }
      // No existing lock, set ours atomically
      const newLocks = new Map(locks).set(group, myLock);
      return [{ type: "acquired", lock: myLock } as LockResult, newLocks] as const;
    });

    if (result.type === "wait") {
      // Wait for existing lock to complete
      yield* Deferred.await(result.lock);
      // Retry acquisition
      return yield* acquireGroupLock(group, groupLocks);
    }

    return result.lock;
  });

const releaseGroupLock = (
  group: string | undefined,
  lock: Deferred.Deferred<void> | null,
  groupLocks: Ref.Ref<Map<string, Deferred.Deferred<void>>>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (!group || !lock) return;

    // Remove our lock from the map
    yield* Ref.update(groupLocks, (locks) => {
      const newLocks = new Map(locks);
      // Only remove if it's still our lock
      if (newLocks.get(group) === lock) {
        newLocks.delete(group);
      }
      return newLocks;
    });

    // Signal completion to any waiters
    yield* Deferred.succeed(lock, undefined);
  });

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
    const services: ItemExecutionServices = {
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

    // Acquire group lock atomically
    const lock = yield* acquireGroupLock(effectiveGroup, groupLocks);

    const executeWithLock = Effect.gen(function* () {
      emitVerbose(options, `[${item.name}] check: ${getCheckDescription(item)}`);
      const itemState = yield* checkItem(item, services.shell);
      return yield* executeCheckedItem(item, itemState, services, itemExecutionOperations, options);
    });

    // Use ensuring to always release the lock, even on failure/interruption
    return yield* executeWithLock.pipe(
      Effect.ensuring(releaseGroupLock(effectiveGroup, lock, groupLocks)),
    );
  });

const formatReason = (reason: string, fallback: string): string => {
  const trimmed = reason.trim();
  return trimmed.length > 0 ? trimmed : fallback;
};

type ExecutionError = ExecuteItemError;

const formatStructuredCommandDetail = (
  error: Pick<GitError | BrewError, "command" | "exitCode" | "stderr">,
): string => {
  const details: string[] = [];

  if (error.command) {
    details.push(`Command: ${error.command}`);
  }

  if (error.exitCode !== undefined && error.exitCode >= 0) {
    details.push(`Exit code: ${error.exitCode}`);
  }

  const stderr = error.stderr?.trim();
  if (stderr && stderr.length > 0) {
    details.push(`Stderr: ${stderr}`);
  }

  return details.length === 0 ? "" : `\n  ${details.join("\n  ")}`;
};

const isTimeoutError = (error: ExecutionError): boolean =>
  ("timedOut" in error && error.timedOut === true) || false;

const formatTimeoutSuffix = (timeoutMs: number | undefined): string =>
  timeoutMs === undefined ? "" : ` after ${timeoutMs}ms`;

const formatError = (error: ExecutionError): string => {
  switch (error._tag) {
    case "ShellError":
      return error.timedOut
        ? `Command "${error.command}" timed out${formatTimeoutSuffix(error.timeoutMs)}: ${formatReason(error.stderr, "No stderr output")}`
        : `Command "${error.command}" failed with exit code ${error.exitCode}: ${formatReason(error.stderr, "No stderr output")}`;
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
  }
};

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
}: ReadyInspectionResult) => result;

const orderLevelResults = (
  level: readonly SystemItem[],
  levelResults: readonly ExecutionResult[],
): readonly ExecutionResult[] => {
  const byName = new Map(levelResults.map((result) => [result.name, result]));
  return level.map((item) => byName.get(item.name)!);
};

export const ExecutorLive = Layer.succeed(
  Executor,
  Executor.of({
    inspect: (plan, options) =>
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
      }),
    execute: (plan, options) =>
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
            emitVerbose(
              options,
              `[${result.name}] blocked: ${result.error ?? "Dependency failure"}`,
            );
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
      }),
  }),
);
