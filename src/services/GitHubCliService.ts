import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Context, Effect, Layer } from "effect";
import { configError } from "../configErrors.js";
import { ConfigError } from "../errors.js";

const execFileAsync = promisify(execFile);
const defaultTimeoutMs = 10_000;

export interface GitHubCliRawResult {
  readonly stdout: string;
  readonly stderr: string;
}

export interface GitHubCliService {
  /**
   * Fetch raw file bytes via authenticated `gh api` (Accept: application/vnd.github.raw).
   * endpoint is the GitHub REST path, e.g. `repos/owner/repo/contents/path?ref=sha`.
   */
  readonly rawContents: (
    endpoint: string,
    options?: { readonly timeoutMs?: number },
  ) => Effect.Effect<string, ConfigError>;
}

export class GitHubCli extends Context.Tag("GitHubCli")<GitHubCli, GitHubCliService>() {}

const isCommandNotFound = (error: unknown): boolean =>
  error instanceof Error && "code" in error && String(error.code) === "ENOENT";

const formatCliFailure = (error: unknown): string => {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const stderr =
    "stderr" in error && typeof error.stderr === "string" ? error.stderr.trim() : undefined;
  return stderr && stderr.length > 0 ? stderr : error.message;
};

export const GitHubCliLive = Layer.succeed(
  GitHubCli,
  GitHubCli.of({
    rawContents: (endpoint, options) =>
      Effect.tryPromise({
        try: async () => {
          const timeoutMs = options?.timeoutMs ?? defaultTimeoutMs;
          const { stdout, stderr } = await execFileAsync(
            "gh",
            ["api", "-H", "Accept: application/vnd.github.raw", endpoint],
            {
              encoding: "utf8",
              timeout: timeoutMs,
              maxBuffer: 10 * 1024 * 1024,
            },
          );

          return {
            stdout: typeof stdout === "string" ? stdout : String(stdout),
            stderr: typeof stderr === "string" ? stderr : String(stderr),
          } satisfies GitHubCliRawResult;
        },
        catch: (error) => {
          if (isCommandNotFound(error)) {
            return configError({
              code: "github_cli_unavailable",
              message:
                "GitHub CLI (`gh`) not found on PATH. Install it and run `gh auth login` for private repos, or use a public raw HTTPS URL.",
              path: endpoint,
            });
          }

          return configError({
            code: "github_cli_failed",
            message: `GitHub CLI request failed: ${formatCliFailure(error)}`,
            path: endpoint,
          });
        },
      }).pipe(Effect.map((result) => result.stdout)),
  }),
);

/** Test double that always fails as if `gh` is missing. */
export const GitHubCliUnavailableLive = Layer.succeed(
  GitHubCli,
  GitHubCli.of({
    rawContents: (endpoint) =>
      Effect.fail(
        configError({
          code: "github_cli_unavailable",
          message:
            "GitHub CLI (`gh`) not found on PATH. Install it and run `gh auth login` for private repos, or use a public raw HTTPS URL.",
          path: endpoint,
        }),
      ),
  }),
);

export const GitHubCliTest = (impl: GitHubCliService): Layer.Layer<GitHubCli> =>
  Layer.succeed(GitHubCli, GitHubCli.of(impl));
