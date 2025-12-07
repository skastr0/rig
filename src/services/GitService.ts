import { Context, Effect, Layer } from "effect"
import * as Os from "node:os"
import { GitError } from "../errors.js"
import { ShellService } from "./ShellService.js"
import type { GitInstall } from "../schema/config.js"

export interface GitService {
  readonly clone: (install: GitInstall) => Effect.Effect<void, GitError, ShellService>
}

export const GitService = Context.GenericTag<GitService>("GitService")

const expandPath = (path: string): string =>
  path.startsWith("~/") ? path.replace("~", Os.homedir()) : path

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
    const branchArg = install.branch ? `-b ${install.branch}` : ""
    const cmd = `git clone ${branchArg} ${install.repo} ${targetPath}`.trim().replace(/\s+/g, " ")

    yield* shell.run(cmd).pipe(
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
    const branchArg = install.branch ? `-b ${install.branch}` : ""

    const initCmd = `git clone --filter=blob:none --no-checkout ${branchArg} ${install.repo} ${targetPath}`
      .trim()
      .replace(/\s+/g, " ")

    yield* shell.run(initCmd).pipe(
      Effect.mapError(
        () =>
          new GitError({
            repo: install.repo,
            reason: `Failed to initialize sparse clone to ${targetPath}`,
          })
      )
    )

    yield* shell.run(`cd ${targetPath} && git sparse-checkout init --cone`).pipe(
      Effect.mapError(
        () =>
          new GitError({
            repo: install.repo,
            reason: "Failed to initialize sparse-checkout",
          })
      )
    )

    const patterns = install.sparse!.join(" ")
    yield* shell.run(`cd ${targetPath} && git sparse-checkout set ${patterns}`).pipe(
      Effect.mapError(
        () =>
          new GitError({
            repo: install.repo,
            reason: `Failed to set sparse patterns: ${patterns}`,
          })
      )
    )

    yield* shell.run(`cd ${targetPath} && git checkout`).pipe(
      Effect.mapError(
        () =>
          new GitError({
            repo: install.repo,
            reason: "Failed to checkout sparse files",
          })
      )
    )
  })
