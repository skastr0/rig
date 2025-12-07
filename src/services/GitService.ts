import { Context, Effect, Layer } from "effect"
import { GitError } from "../errors.js"
import { ShellService } from "./ShellService.js"
import type { GitInstall } from "../schema/config.js"
import { expandPath } from "../utils.js"

export interface GitService {
  readonly clone: (install: GitInstall) => Effect.Effect<void, GitError, ShellService>
}

export const GitService = Context.GenericTag<GitService>("GitService")

export const GitServiceLive = Layer.succeed(
  GitService,
  GitService.of({
    clone: (install) =>
      Effect.gen(function* () {
        const shell = yield* ShellService
        const targetPath = expandPath(install.path)

        if (install.sparse && install.sparse.length > 0) {
          yield* sparseClone(shell, install, targetPath)
        } else {
          yield* fullClone(shell, install, targetPath)
        }
      }),
  })
)

const fullClone = (
  shell: ShellService,
  install: GitInstall,
  targetPath: string
): Effect.Effect<void, GitError> =>
  Effect.gen(function* () {
    const args = ["clone"]
    if (install.branch) {
      args.push("-b", install.branch)
    }
    args.push(install.repo, targetPath)

    yield* shell.exec("git", args).pipe(
      Effect.mapError(
        () =>
          new GitError({
            repo: install.repo,
            reason: `Failed to clone to ${targetPath}`,
          })
      )
    )
  })

const sparseClone = (
  shell: ShellService,
  install: GitInstall,
  targetPath: string
): Effect.Effect<void, GitError> =>
  Effect.gen(function* () {
    const initArgs = ["clone", "--filter=blob:none", "--no-checkout"]
    if (install.branch) {
      initArgs.push("-b", install.branch)
    }
    initArgs.push(install.repo, targetPath)

    yield* shell.exec("git", initArgs).pipe(
      Effect.mapError(
        () =>
          new GitError({
            repo: install.repo,
            reason: `Failed to initialize sparse clone to ${targetPath}`,
          })
      )
    )

    yield* shell.exec("git", ["sparse-checkout", "init", "--cone"], { cwd: targetPath }).pipe(
      Effect.mapError(
        () =>
          new GitError({
            repo: install.repo,
            reason: "Failed to initialize sparse-checkout",
          })
      )
    )

    yield* shell.exec("git", ["sparse-checkout", "set", ...install.sparse!], { cwd: targetPath }).pipe(
      Effect.mapError(
        () =>
          new GitError({
            repo: install.repo,
            reason: `Failed to set sparse patterns: ${install.sparse!.join(" ")}`,
          })
      )
    )

    yield* shell.exec("git", ["checkout"], { cwd: targetPath }).pipe(
      Effect.mapError(
        () =>
          new GitError({
            repo: install.repo,
            reason: "Failed to checkout sparse files",
          })
      )
    )
  })
