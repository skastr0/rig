import { Context, Effect, Layer, Ref, Deferred } from "effect";
import { FileSystem } from "@effect/platform";
import type { SystemItem, GitInstall, BrewInstall } from "../schema/config.js";
import type { PlanResult } from "./Planner.js";
import { ShellService } from "../services/ShellService.js";
import { BackupService } from "../services/BackupService.js";
import { GitService } from "../services/GitService.js";
import { BrewService } from "../services/BrewService.js";
import { ShellError, GitError, BrewError, BackupError } from "../errors.js";
import { expandPath } from "../utils.js";

export type ItemStatus = "installed" | "missing" | "error";

export interface ExecutionResult {
  readonly name: string;
  readonly status: ItemStatus;
  readonly action: "skipped" | "installed" | "updated" | "would_update" | "failed";
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

const checkItem = (
  item: SystemItem,
  shell: ShellService,
): Effect.Effect<boolean, never, FileSystem.FileSystem> => {
  const checkMode = item.onCheck ?? "exit-code";

  if (checkMode === "path-exists") {
    return Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const expandedPath = expandPath(item.check);
      return yield* fs.exists(expandedPath).pipe(Effect.catchAll(() => Effect.succeed(false)));
    });
  }

  return shell.run(item.check).pipe(
    Effect.map(() => true),
    Effect.catchAll(() => Effect.succeed(false)),
  );
};

const installItem = (
  item: SystemItem,
  shell: ShellService,
  git: GitService,
  brew: BrewService,
): Effect.Effect<void, ShellError | GitError | BrewError, ShellService> => {
  if (isGitInstall(item.install)) {
    return git.clone(item.install);
  }

  if (isBrewInstall(item.install)) {
    return brew.install(item.install);
  }

  return shell.run(item.install).pipe(Effect.asVoid);
};

const updateItem = (
  item: SystemItem,
  shell: ShellService,
): Effect.Effect<void, ShellError, ShellService> => {
  // Update command is always a string (git updates handled via install strategy)
  if (!item.update) {
    return Effect.void;
  }
  return shell.run(item.update).pipe(Effect.asVoid);
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
          yield* updateItem(item, shell);

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

      yield* installItem(item, shell, git, brew);

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

const formatError = (error: ShellError | GitError | BrewError | BackupError): string => {
  switch (error._tag) {
    case "ShellError":
      return `Command "${error.command}" failed with exit code ${error.exitCode}: ${formatReason(error.stderr, "No stderr output")}`;
    case "GitError":
      return `Git error for ${error.repo}: ${formatReason(error.reason, "No reason provided")}`;
    case "BrewError":
      return `Brew error for ${error.formula_or_cask}: ${formatReason(error.reason, "No reason provided")}`;
    case "BackupError":
      return `Backup error for ${error.path}: ${formatReason(error.reason, "No reason provided")}`;
  }
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
        // Catch errors per-item and convert to ExecutionResult with error
        Effect.catchAll((error) => {
          const result: ExecutionResult = {
            name: item.name,
            status: "error",
            action: "failed",
            error: formatError(error),
          };
          options?.onProgress?.(result);
          emitVerbose(options, `[${item.name}] failure: ${result.error ?? "Unknown failure"}`);
          return Effect.succeed(result);
        }),
      ),
    { concurrency: "unbounded" },
  );

export const ExecutorLive = Layer.succeed(
  Executor,
  Executor.of({
    execute: (plan, options) =>
      Effect.gen(function* () {
        const groupLocks = yield* Ref.make(new Map<string, Deferred.Deferred<void>>());
        const results: ExecutionResult[] = [];

        for (const level of plan.levels) {
          const levelResults = yield* executeLevel(level, options, groupLocks);
          results.push(...levelResults);

          const failed = levelResults.find((r) => r.action === "failed");
          if (failed) {
            break;
          }
        }

        return results;
      }),
  }),
);
