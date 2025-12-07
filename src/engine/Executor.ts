import { Context, Effect, Layer, Ref } from "effect"
import { FileSystem } from "@effect/platform"
import type { SystemItem, GitInstall } from "../schema/config.js"
import type { PlanResult } from "./Planner.js"
import { ShellService } from "../services/ShellService.js"
import { BackupService } from "../services/BackupService.js"
import { GitService } from "../services/GitService.js"
import { ShellError, GitError } from "../errors.js"

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
    ShellError | GitError,
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
      const expandedPath = item.check.replace(/^~/, process.env["HOME"] ?? "")
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

const executeItem = (
  item: SystemItem,
  options: ExecutorOptions | undefined,
  groupLocks: Ref.Ref<Map<string, Promise<void>>>
): Effect.Effect<
  ExecutionResult,
  ShellError | GitError,
  ShellService | BackupService | GitService | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const shell = yield* ShellService
    const backup = yield* BackupService
    const git = yield* GitService

    const acquireGroupLock = (group: string | undefined) =>
      Effect.gen(function* () {
        if (!group) return

        const locks = yield* Ref.get(groupLocks)
        const existingLock = locks.get(group)

        if (existingLock) {
          yield* Effect.promise(() => existingLock)
        }
      })

    const setGroupLock = (group: string | undefined, promise: Promise<void>) =>
      group
        ? Ref.update(groupLocks, (locks) => new Map(locks).set(group, promise))
        : Effect.void

    yield* acquireGroupLock(item.group)

    let resolveGroupLock: () => void = () => {}
    if (item.group) {
      const lockPromise = new Promise<void>((resolve) => {
        resolveGroupLock = resolve
      })
      yield* setGroupLock(item.group, lockPromise)
    }

    try {
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
    } finally {
      resolveGroupLock()
    }
  })

const executeLevel = (
  items: readonly SystemItem[],
  options: ExecutorOptions | undefined,
  groupLocks: Ref.Ref<Map<string, Promise<void>>>
): Effect.Effect<
  readonly ExecutionResult[],
  ShellError | GitError,
  ShellService | BackupService | GitService | FileSystem.FileSystem
> =>
  Effect.forEach(
    items,
    (item) => executeItem(item, options, groupLocks),
    { concurrency: "unbounded" }
  )

export const ExecutorLive = Layer.succeed(
  Executor,
  Executor.of({
    execute: (plan, options) =>
      Effect.gen(function* () {
        const groupLocks = yield* Ref.make(new Map<string, Promise<void>>())
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
