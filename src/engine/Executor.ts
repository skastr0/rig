import { Context, Effect, Layer, Ref, Deferred } from "effect";
import { FileSystem } from "@effect/platform";
import type {
  SystemItem,
  GitInstall,
  BrewInstall,
  TimeoutInput as ItemTimeoutInput,
} from "../schema/config.js";
import type { PlanResult } from "./Planner.js";
import { ShellService, type ShellResult } from "../services/ShellService.js";
import { BackupService } from "../services/BackupService.js";
import { GitService } from "../services/GitService.js";
import { BrewService } from "../services/BrewService.js";
import { ShellError, GitError, BrewError, BackupError } from "../errors.js";
import { expandPath } from "../utils.js";

export type ItemStatus = "installed" | "missing" | "error" | "blocked";
export type ItemAction =
  | "skipped"
  | "installed"
  | "updated"
  | "would_update"
  | "failed"
  | "timed_out"
  | "blocked";

export interface ExecutionResult {
  readonly name: string;
  readonly status: ItemStatus;
  readonly action: ItemAction;
  readonly backed_up?: string;
  readonly error?: string;
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
}

export const Executor = Context.GenericTag<Executor>("Executor");

const isGitInstall = (install: SystemItem["install"]): install is GitInstall =>
  typeof install === "object" && install.source === "git";

const isBrewInstall = (install: SystemItem["install"]): install is BrewInstall =>
  typeof install === "object" && install.source === "brew";

const formatCommand = (command: string, args: readonly string[] = []): string =>
  args.length > 0 ? `${command} ${args.join(" ")}` : command;

const getInstallCommands = (install: SystemItem["install"]): readonly string[] => {
  if (typeof install === "string") {
    return [install];
  }

  if (isBrewInstall(install)) {
    const commands: string[] = [];
    if (install.tap) {
      commands.push(formatCommand("brew", ["tap", install.tap]));
    }

    if (install.formula) {
      commands.push(formatCommand("brew", ["install", install.formula, ...(install.args ?? [])]));
      return commands;
    }

    if (install.cask) {
      commands.push(
        formatCommand("brew", ["install", "--cask", install.cask, ...(install.args ?? [])]),
      );
      return commands;
    }

    return commands;
  }

  if (isGitInstall(install)) {
    const targetPath = expandPath(install.path);

    if (install.sparse && install.sparse.length > 0) {
      const cloneArgs = ["clone", "--filter=blob:none", "--no-checkout"];
      if (install.branch) {
        cloneArgs.push("-b", install.branch);
      }
      cloneArgs.push(install.repo, targetPath);

      return [
        formatCommand("git", cloneArgs),
        formatCommand("git", ["-C", targetPath, "sparse-checkout", "init", "--cone"]),
        formatCommand("git", ["-C", targetPath, "sparse-checkout", "set", ...install.sparse]),
        formatCommand("git", ["-C", targetPath, "checkout"]),
      ];
    }

    const cloneArgs = ["clone"];
    if (install.branch) {
      cloneArgs.push("-b", install.branch);
    }
    cloneArgs.push(install.repo, targetPath);

    return [formatCommand("git", cloneArgs)];
  }

  return [];
};

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

const checkItem = (
  item: SystemItem,
  shell: ShellService,
): Effect.Effect<boolean, ShellError, FileSystem.FileSystem> => {
  const checkMode = item.onCheck ?? "exit-code";

  if (checkMode === "path-exists") {
    return Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const expandedPath = expandPath(item.check);
      return yield* fs.exists(expandedPath).pipe(Effect.catchAll(() => Effect.succeed(false)));
    });
  }

  return shell.run(item.check, toTimeoutOptions(item.timeout)).pipe(
    Effect.map(() => true),
    Effect.catchAll((error) => (error.timedOut ? Effect.fail(error) : Effect.succeed(false))),
  );
};

const installItem = (
  item: SystemItem,
  shell: ShellService,
  git: GitService,
  brew: BrewService,
  options: ExecutorOptions | undefined,
): Effect.Effect<void, ShellError | GitError | BrewError, ShellService> => {
  if (isGitInstall(item.install)) {
    return git.clone(item.install, toTimeoutOptions(item.timeout));
  }

  if (isBrewInstall(item.install)) {
    return brew.install(item.install, toTimeoutOptions(item.timeout));
  }

  return runShellCommand(item.name, item.install, shell, item.timeout, options).pipe(Effect.asVoid);
};

const updateItem = (
  item: SystemItem,
  shell: ShellService,
  options: ExecutorOptions | undefined,
): Effect.Effect<void, ShellError, ShellService> => {
  // Update command is always a string (git updates handled via install strategy)
  if (!item.update) {
    return Effect.void;
  }
  return runShellCommand(item.name, item.update, shell, item.timeout, options).pipe(Effect.asVoid);
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
  ShellError | GitError | BrewError | BackupError,
  ShellService | BackupService | GitService | BrewService | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const shell = yield* ShellService;
    const backup = yield* BackupService;
    const git = yield* GitService;
    const brew = yield* BrewService;

    const effectiveGroup = isBrewInstall(item.install) ? (item.group ?? "brew") : item.group;

    // Acquire group lock atomically
    const lock = yield* acquireGroupLock(effectiveGroup, groupLocks);

    const executeWithLock = Effect.gen(function* () {
      emitVerbose(options, `[${item.name}] check: ${item.check}`);
      const isInstalled = yield* checkItem(item, shell);

      // Case 1: Item is installed
      if (isInstalled) {
        // Check if we should run update
        if (options?.update && item.update) {
          // Case 1a: Dry run - show what would be updated
          if (options?.dryRun) {
            emitVerbose(options, `[${item.name}] would update: ${item.update}`);
            const result: ExecutionResult = {
              name: item.name,
              status: "installed",
              action: "would_update",
            };
            options?.onProgress?.(result);
            return result;
          }

          // Case 1b: Real run - execute update command
          let backedUp: string | undefined;

          if (item.backup) {
            emitVerbose(options, `[${item.name}] backup: ${item.backup}`);
            const backupResult = yield* backup.backup(item.backup);
            if (!backupResult.skipped) {
              backedUp = backupResult.destination;
            }
          }

          emitVerbose(options, `[${item.name}] update: ${item.update}`);
          yield* updateItem(item, shell, options);

          const result: ExecutionResult = backedUp
            ? {
                name: item.name,
                status: "installed",
                action: "updated",
                backed_up: backedUp,
              }
            : {
                name: item.name,
                status: "installed",
                action: "updated",
              };

          options?.onProgress?.(result);
          return result;
        }

        // Case 1c: No update needed - skip
        const result: ExecutionResult = {
          name: item.name,
          status: "installed",
          action: "skipped",
        };
        options?.onProgress?.(result);
        return result;
      }

      // Case 2: Item is missing
      if (options?.dryRun) {
        for (const command of getInstallCommands(item.install)) {
          emitVerbose(options, `[${item.name}] would install: ${command}`);
        }

        const result: ExecutionResult = {
          name: item.name,
          status: "missing",
          action: "skipped",
        };
        options?.onProgress?.(result);
        return result;
      }

      // Install missing item
      let backedUp: string | undefined;

      if (item.backup) {
        emitVerbose(options, `[${item.name}] backup: ${item.backup}`);
        const backupResult = yield* backup.backup(item.backup);
        if (!backupResult.skipped) {
          backedUp = backupResult.destination;
        }
      }

      for (const command of getInstallCommands(item.install)) {
        emitVerbose(options, `[${item.name}] install: ${command}`);
      }

      yield* installItem(item, shell, git, brew, options);

      const result: ExecutionResult = backedUp
        ? {
            name: item.name,
            status: "installed",
            action: "installed",
            backed_up: backedUp,
          }
        : {
            name: item.name,
            status: "installed",
            action: "installed",
          };

      options?.onProgress?.(result);
      return result;
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

type ExecutionError = ShellError | GitError | BrewError | BackupError;

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
        ? `Git operation for ${error.repo} timed out${formatTimeoutSuffix(error.timeoutMs)}: ${formatReason(error.reason, "No reason provided")}`
        : `Git error for ${error.repo}: ${formatReason(error.reason, "No reason provided")}`;
    case "BrewError":
      return error.timedOut
        ? `Brew operation for ${error.formula_or_cask} timed out${formatTimeoutSuffix(error.timeoutMs)}: ${formatReason(error.reason, "No reason provided")}`
        : `Brew error for ${error.formula_or_cask}: ${formatReason(error.reason, "No reason provided")}`;
    case "BackupError":
      return `Backup error for ${error.path}: ${formatReason(error.reason, "No reason provided")}`;
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
