import { Context, Effect, Layer, Duration } from "effect";
import { ShellError } from "../errors.js";

export interface ShellResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface ShellService {
  /** Run a shell command string (via sh -c). Use for user-configured commands only. */
  readonly run: (
    command: string,
    options?: { timeout?: Duration.DurationInput },
  ) => Effect.Effect<ShellResult, ShellError>;

  /** Execute a command with explicit args (no shell interpolation). Safe from injection. */
  readonly exec: (
    command: string,
    args: readonly string[],
    options?: { timeout?: Duration.DurationInput; cwd?: string },
  ) => Effect.Effect<ShellResult, ShellError>;
}

export const ShellService = Context.GenericTag<ShellService>("ShellService");

const DEFAULT_TIMEOUT_MS = Duration.toMillis("10 minutes");

const formatTimeoutMessage = (timeoutMs: number, stderr: string): string => {
  const details = stderr.trim();
  return details.length > 0
    ? `Timed out after ${timeoutMs}ms: ${details}`
    : `Timed out after ${timeoutMs}ms`;
};

const spawnProcess = (
  args: readonly string[],
  options?: { timeout?: Duration.DurationInput; cwd?: string },
): Effect.Effect<ShellResult, ShellError> =>
  Effect.tryPromise({
    try: async () => {
      const timeoutMs = options?.timeout ? Duration.toMillis(options.timeout) : DEFAULT_TIMEOUT_MS;
      let timedOut = false;

      const proc = Bun.spawn(args as string[], {
        stdout: "pipe",
        stderr: "pipe",
        ...(options?.cwd ? { cwd: options.cwd } : {}),
      });

      const timeoutId = setTimeout(() => {
        timedOut = true;
        proc.kill();
      }, timeoutMs);

      try {
        const exitCode = await proc.exited;
        const stdout = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();

        return { stdout, stderr, exitCode, timedOut, timeoutMs };
      } finally {
        clearTimeout(timeoutId);
      }
    },
    catch: () =>
      new ShellError({
        command: args.join(" "),
        exitCode: -1,
        stderr: "Process execution failed",
      }),
  }).pipe(
    Effect.flatMap((result) =>
      result.timedOut
        ? Effect.fail(
            new ShellError({
              command: args.join(" "),
              exitCode: -1,
              stderr: formatTimeoutMessage(result.timeoutMs, result.stderr),
              timedOut: true,
              timeoutMs: result.timeoutMs,
            }),
          )
        : result.exitCode !== 0
          ? Effect.fail(
              new ShellError({
                command: args.join(" "),
                exitCode: result.exitCode,
                stderr: result.stderr,
              }),
            )
          : Effect.succeed({
              stdout: result.stdout,
              stderr: result.stderr,
              exitCode: result.exitCode,
            }),
    ),
  );

export const ShellServiceLive = Layer.succeed(
  ShellService,
  ShellService.of({
    run: (command, options) => spawnProcess(["sh", "-c", command], options),

    exec: (command, args, options) => spawnProcess([command, ...args], options),
  }),
);
