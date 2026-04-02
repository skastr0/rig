import { Context, Effect, Layer } from "effect";
import { GitError } from "../errors.js";
import { ShellService } from "./ShellService.js";
import type { GitInstall, TimeoutInput } from "../schema/config.js";
import { expandPath } from "../utils.js";

export interface GitService {
  readonly clone: (
    install: GitInstall,
    options?: { timeout?: TimeoutInput },
  ) => Effect.Effect<void, GitError, ShellService>;
}

export const GitService = Context.GenericTag<GitService>("GitService");

const mapGitShellError = (
  install: GitInstall,
  reason: string,
  error: { readonly timedOut?: boolean; readonly timeoutMs?: number },
): GitError =>
  new GitError({
    repo: install.repo,
    reason,
    ...(error.timedOut === undefined ? {} : { timedOut: error.timedOut }),
    ...(error.timeoutMs === undefined ? {} : { timeoutMs: error.timeoutMs }),
  });

const withCwdAndTimeout = (cwd: string, timeout: TimeoutInput | undefined) =>
  timeout === undefined ? { cwd } : { cwd, timeout };

export const GitServiceLive = Layer.succeed(
  GitService,
  GitService.of({
    clone: (install, options) =>
      Effect.gen(function* () {
        const shell = yield* ShellService;
        const targetPath = expandPath(install.path);

        if (install.sparse && install.sparse.length > 0) {
          yield* sparseClone(shell, install, targetPath, options);
        } else {
          yield* fullClone(shell, install, targetPath, options);
        }
      }),
  }),
);

const fullClone = (
  shell: ShellService,
  install: GitInstall,
  targetPath: string,
  options?: { timeout?: TimeoutInput },
): Effect.Effect<void, GitError> =>
  Effect.gen(function* () {
    const args = ["clone"];
    if (install.branch) {
      args.push("-b", install.branch);
    }
    args.push(install.repo, targetPath);

    yield* shell
      .exec("git", args, options)
      .pipe(
        Effect.mapError((error) =>
          mapGitShellError(install, `Failed to clone to ${targetPath}`, error),
        ),
      );
  });

const sparseClone = (
  shell: ShellService,
  install: GitInstall,
  targetPath: string,
  options?: { timeout?: TimeoutInput },
): Effect.Effect<void, GitError> =>
  Effect.gen(function* () {
    const initArgs = ["clone", "--filter=blob:none", "--no-checkout"];
    if (install.branch) {
      initArgs.push("-b", install.branch);
    }
    initArgs.push(install.repo, targetPath);

    yield* shell
      .exec("git", initArgs, options)
      .pipe(
        Effect.mapError((error) =>
          mapGitShellError(install, `Failed to initialize sparse clone to ${targetPath}`, error),
        ),
      );

    yield* shell
      .exec(
        "git",
        ["sparse-checkout", "init", "--cone"],
        withCwdAndTimeout(targetPath, options?.timeout),
      )
      .pipe(
        Effect.mapError((error) =>
          mapGitShellError(install, "Failed to initialize sparse-checkout", error),
        ),
      );

    yield* shell
      .exec(
        "git",
        ["sparse-checkout", "set", ...install.sparse!],
        withCwdAndTimeout(targetPath, options?.timeout),
      )
      .pipe(
        Effect.mapError((error) =>
          mapGitShellError(
            install,
            `Failed to set sparse patterns: ${install.sparse!.join(" ")}`,
            error,
          ),
        ),
      );

    yield* shell
      .exec("git", ["checkout"], withCwdAndTimeout(targetPath, options?.timeout))
      .pipe(
        Effect.mapError((error) =>
          mapGitShellError(install, "Failed to checkout sparse files", error),
        ),
      );
  });
