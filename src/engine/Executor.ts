import { Context, Effect, Layer, Ref, Deferred } from "effect"
import { FileSystem } from "@effect/platform"
import type { SystemItem, GitInstall } from "../schema/config.js"
import type { PlanResult } from "./Planner.js"
import { ShellService } from "../services/ShellService.js"
import { BackupService } from "../services/BackupService.js"
import { GitService } from "../services/GitService.js"
import { ShellError, GitError, BackupError } from "../errors.js"
import { expandPath } from "../utils.js"

export type ItemStatus = "installed" | "missing" | "error"

export interface ExecutionResult {
  readonly name: string
  readonly status: ItemStatus
  readonly action: "skipped" | "installed" | "failed"
  readonly backed_up?: string
  readonly error?: string
}

export interface ExecutorOptions {
  readonly dryRun?: boolean
  readonly onProgress?: (result: ExecutionResult) => void
}

export interface Executor {
  readonly execute: (
    plan: PlanResult,
    options?: ExecutorOptions
  ) => Effect.Effect<
    readonly ExecutionResult[],
    never,
    ShellService | BackupService | GitService | FileSystem.FileSystem
  >
}

export const Executor = Context.GenericTag<Executor>("Executor")

const isGitInstall = (install: string | GitInstall): install is GitInstall =>
  typeof install === "object" && install.source === "git"

const checkItem = (
  item: SystemItem,
  shell: ShellService
): Effect.Effect<boolean, never, FileSystem.FileSystem> => {
  const checkMode = item.onCheck ?? "exit-code"

  if (checkMode === "path-exists") {
    return Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const expandedPath = expandPath(item.check)
      return yield* fs.exists(expandedPath).pipe(Effect.catchAll(() => Effect.succeed(false)))
    })
  }

  return shell.run(item.check).pipe(
    Effect.map(() => true),
    Effect.catchAll(() => Effect.succeed(false))
  )
}

const installItem = (
  item: SystemItem,
  shell: ShellService,
  git: GitService
): Effect.Effect<void, ShellError | GitError, ShellService> => {
  if (isGitInstall(item.install)) {
    return git.clone(item.install)
  }

  return shell.run(item.install).pipe(Effect.asVoid)
}

type LockResult =
  | { type: "wait"; lock: Deferred.Deferred<void> }
  | { type: "acquired"; lock: Deferred.Deferred<void> }

const acquireGroupLock = (
  group: string | undefined,
  groupLocks: Ref.Ref<Map<string, Deferred.Deferred<void>>>
): Effect.Effect<Deferred.Deferred<void> | null> =>
  Effect.gen(function* () {
    if (!group) return null

    // Create our lock before the atomic operation
    const myLock = yield* Deferred.make<void>()

    // Atomically check-and-set to avoid race condition
    const result: LockResult = yield* Ref.modify(groupLocks, (locks) => {
      const existingLock = locks.get(group)
      if (existingLock) {
        // Return existing lock to wait on, don't modify state
        return [{ type: "wait", lock: existingLock } as LockResult, locks] as const
      }
      // No existing lock, set ours atomically
      const newLocks = new Map(locks).set(group, myLock)
      return [{ type: "acquired", lock: myLock } as LockResult, newLocks] as const
    })

    if (result.type === "wait") {
      // Wait for existing lock to complete
      yield* Deferred.await(result.lock)
      // Retry acquisition
      return yield* acquireGroupLock(group, groupLocks)
    }

    return result.lock
  })

const releaseGroupLock = (
  group: string | undefined,
  lock: Deferred.Deferred<void> | null,
  groupLocks: Ref.Ref<Map<string, Deferred.Deferred<void>>>
): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (!group || !lock) return

    // Remove our lock from the map
    yield* Ref.update(groupLocks, (locks) => {
      const newLocks = new Map(locks)
      // Only remove if it's still our lock
      if (newLocks.get(group) === lock) {
        newLocks.delete(group)
      }
      return newLocks
    })

    // Signal completion to any waiters
    yield* Deferred.succeed(lock, undefined)
  })

const executeItem = (
  item: SystemItem,
  options: ExecutorOptions | undefined,
  groupLocks: Ref.Ref<Map<string, Deferred.Deferred<void>>>
): Effect.Effect<
  ExecutionResult,
  ShellError | GitError | BackupError,
  ShellService | BackupService | GitService | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const shell = yield* ShellService
    const backup = yield* BackupService
    const git = yield* GitService

    // Acquire group lock atomically
    const lock = yield* acquireGroupLock(item.group, groupLocks)

    const executeWithLock = Effect.gen(function* () {
      const isInstalled = yield* checkItem(item, shell)

      if (isInstalled) {
        options?.onProgress?.({
          name: item.name,
          status: "installed",
          action: "skipped",
        })
        return {
          name: item.name,
          status: "installed" as const,
          action: "skipped" as const,
        }
      }

      if (options?.dryRun) {
        options?.onProgress?.({
          name: item.name,
          status: "missing",
          action: "skipped",
        })
        return {
          name: item.name,
          status: "missing" as const,
          action: "skipped" as const,
        }
      }

      let backedUp: string | undefined

      if (item.backup) {
        const backupResult = yield* backup.backup(item.backup)
        if (!backupResult.skipped) {
          backedUp = backupResult.destination
        }
      }

      yield* installItem(item, shell, git)

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
          }

      options?.onProgress?.(result)
      return result
    })

    // Use ensuring to always release the lock, even on failure/interruption
    return yield* executeWithLock.pipe(
      Effect.ensuring(releaseGroupLock(item.group, lock, groupLocks))
    )
  })

const formatError = (error: ShellError | GitError | BackupError): string => {
  switch (error._tag) {
    case "ShellError":
      return `Command failed (${error.exitCode}): ${error.stderr}`
    case "GitError":
      return `Git error for ${error.repo}: ${error.reason}`
    case "BackupError":
      return `Backup error for ${error.path}: ${error.reason}`
  }
}

const executeLevel = (
  items: readonly SystemItem[],
  options: ExecutorOptions | undefined,
  groupLocks: Ref.Ref<Map<string, Deferred.Deferred<void>>>
): Effect.Effect<
  readonly ExecutionResult[],
  never,
  ShellService | BackupService | GitService | FileSystem.FileSystem
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
          }
          options?.onProgress?.(result)
          return Effect.succeed(result)
        })
      ),
    { concurrency: "unbounded" }
  )

export const ExecutorLive = Layer.succeed(
  Executor,
  Executor.of({
    execute: (plan, options) =>
      Effect.gen(function* () {
        const groupLocks = yield* Ref.make(new Map<string, Deferred.Deferred<void>>())
        const results: ExecutionResult[] = []

        for (const level of plan.levels) {
          const levelResults = yield* executeLevel(level, options, groupLocks)
          results.push(...levelResults)

          const failed = levelResults.find((r) => r.action === "failed")
          if (failed) {
            break
          }
        }

        return results
      }),
  })
)
