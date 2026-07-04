import { spawn, type ChildProcess } from "node:child_process";
import { Context, Effect, Layer, Duration } from "effect";
import { ShellError } from "../errors.js";
import { createLineBuffer, type LineBuffer } from "./LineBuffer.js";

export interface ShellResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

export interface ShellExecutionOptions {
  readonly timeout?: Duration.DurationInput;
  readonly cwd?: string;
  readonly onStdout?: (chunk: string) => void;
  readonly onStderr?: (chunk: string) => void;
  readonly onStdoutLine?: (line: string) => void;
  readonly onStderrLine?: (line: string) => void;
}

export interface ShellService {
  /** Run a shell command string (via sh -c). Use for user-configured commands only. */
  readonly run: (
    command: string,
    options?: ShellExecutionOptions,
  ) => Effect.Effect<ShellResult, ShellError>;

  /** Execute a command with explicit args (no shell interpolation). Safe from injection. */
  readonly exec: (
    command: string,
    args: readonly string[],
    options?: ShellExecutionOptions,
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

interface SpawnResult extends ShellResult {
  readonly timedOut: boolean;
  readonly interrupted: boolean;
  readonly timeoutMs: number;
  readonly callbackError?: string;
  readonly killError?: string;
}

const killSignalDelayMs = 1_000;

const formatSignalError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const sendSignal = (pid: number, signal: NodeJS.Signals): string | undefined => {
  try {
    process.kill(pid, signal);
    return undefined;
  } catch (error) {
    return formatSignalError(error);
  }
};

const signalProcessGroup = (proc: ChildProcess, signal: NodeJS.Signals): string | undefined => {
  const pid = proc.pid;

  if (pid === undefined) {
    return proc.kill(signal) ? undefined : `Failed to send ${signal} to child process`;
  }

  const groupError = sendSignal(-pid, signal);
  if (groupError === undefined) {
    return undefined;
  }

  const processError = sendSignal(pid, signal);
  return processError === undefined
    ? undefined
    : `Failed to send ${signal} to process group ${pid}: ${groupError}; fallback process signal failed: ${processError}`;
};

const collectOutput = (
  chunk: Buffer | string,
  append: (text: string) => void,
  emitChunk: ((chunk: string) => void) | undefined,
  emitLine: LineBuffer,
  onCallbackError: (error: unknown) => void,
): void => {
  const text = chunk.toString();
  append(text);
  try {
    emitChunk?.(text);
  } catch (error) {
    onCallbackError(error);
  }
  emitLine.push(text);
};

const spawnProcess = (
  args: readonly string[],
  options?: ShellExecutionOptions,
): Effect.Effect<ShellResult, ShellError> =>
  Effect.async<SpawnResult, ShellError>((resume, signal) => {
    const timeoutMs = options?.timeout ? Duration.toMillis(options.timeout) : DEFAULT_TIMEOUT_MS;
    let completed = false;
    let timedOut = false;
    let interrupted = false;
    let callbackError: string | undefined;
    let killError: string | undefined;

    const [command, ...commandArgs] = args;
    if (!command) {
      resume(
        Effect.fail(
          new ShellError({
            command: "",
            exitCode: -1,
            stderr: "Missing command",
          }),
        ),
      );
      return;
    }

    const proc = spawn(command, commandArgs, {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      ...(options?.cwd ? { cwd: options.cwd } : {}),
    });
    let killEscalationId: ReturnType<typeof setTimeout> | undefined;
    let stdout = "";
    let stderr = "";

    const killProcess = (): void => {
      if (!completed) {
        killError ??= signalProcessGroup(proc, "SIGTERM");
        killEscalationId ??= setTimeout(() => {
          if (!completed) {
            killError ??= signalProcessGroup(proc, "SIGKILL");
          }
        }, killSignalDelayMs);
      }
    };

    const abortProcess = (): void => {
      interrupted = true;
      killProcess();
    };

    const failCallback = (error: unknown): void => {
      callbackError ??= formatSignalError(error);
      killProcess();
    };

    const stdoutLines = createLineBuffer(options?.onStdoutLine, failCallback);
    const stderrLines = createLineBuffer(options?.onStderrLine, failCallback);

    proc.stdout.on("data", (chunk: Buffer | string) =>
      collectOutput(
        chunk,
        (text) => {
          stdout += text;
        },
        options?.onStdout,
        stdoutLines,
        failCallback,
      ),
    );

    proc.stderr.on("data", (chunk: Buffer | string) =>
      collectOutput(
        chunk,
        (text) => {
          stderr += text;
        },
        options?.onStderr,
        stderrLines,
        failCallback,
      ),
    );

    const timeoutId = setTimeout(() => {
      timedOut = true;
      killProcess();
    }, timeoutMs);

    signal.addEventListener("abort", abortProcess, { once: true });
    if (signal.aborted) {
      abortProcess();
    }

    proc.once("error", () => {
      completed = true;
      clearTimeout(timeoutId);
      if (killEscalationId !== undefined) {
        clearTimeout(killEscalationId);
      }
      signal.removeEventListener("abort", abortProcess);
      stdoutLines.flush();
      stderrLines.flush();
      resume(
        Effect.fail(
          new ShellError({
            command: args.join(" "),
            exitCode: -1,
            ...(stdout.length === 0 ? {} : { stdout }),
            stderr: stderr || "Process execution failed",
          }),
        ),
      );
    });

    proc.once("close", (exitCode) => {
      if (completed) {
        return;
      }

      completed = true;
      clearTimeout(timeoutId);
      if (killEscalationId !== undefined) {
        clearTimeout(killEscalationId);
      }
      signal.removeEventListener("abort", abortProcess);
      stdoutLines.flush();
      stderrLines.flush();
      resume(
        Effect.succeed({
          stdout,
          stderr,
          exitCode: exitCode ?? -1,
          timedOut,
          interrupted,
          timeoutMs,
          ...(callbackError === undefined ? {} : { callbackError }),
          ...(killError === undefined ? {} : { killError }),
        }),
      );
    });
  }).pipe(
    Effect.flatMap((result) =>
      result.callbackError !== undefined
        ? Effect.fail(
            new ShellError({
              command: args.join(" "),
              exitCode: -1,
              stdout: result.stdout,
              stderr: `Output callback failed: ${result.callbackError}`,
            }),
          )
        : result.interrupted
          ? Effect.fail(
              new ShellError({
                command: args.join(" "),
                exitCode: -1,
                stdout: result.stdout,
                stderr:
                  result.killError === undefined
                    ? "Process interrupted"
                    : `Process interrupted; ${result.killError}`,
              }),
            )
          : result.timedOut
            ? Effect.fail(
                new ShellError({
                  command: args.join(" "),
                  exitCode: -1,
                  stdout: result.stdout,
                  stderr:
                    result.killError === undefined
                      ? formatTimeoutMessage(result.timeoutMs, result.stderr)
                      : `${formatTimeoutMessage(result.timeoutMs, result.stderr)}; ${result.killError}`,
                  timedOut: true,
                  timeoutMs: result.timeoutMs,
                }),
              )
            : result.exitCode !== 0
              ? Effect.fail(
                  new ShellError({
                    command: args.join(" "),
                    exitCode: result.exitCode,
                    stdout: result.stdout,
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
