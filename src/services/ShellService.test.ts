import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";
import { ShellError } from "../errors.js";
import { ShellService, ShellServiceLive } from "./ShellService.js";

const maxBufferedLineLength = 16_384;

const runShell = (command: string, options?: Parameters<ShellService["run"]>[1]) =>
  Effect.gen(function* () {
    const shell = yield* ShellService;
    return yield* shell.run(command, options);
  }).pipe(Effect.provide(ShellServiceLive));

describe("ShellServiceLive", () => {
  it("streams stdout and stderr from real child processes", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const result = await Effect.runPromise(
      runShell("printf 'ready\\n'; printf 'warn\\n' >&2", {
        onStdout: (chunk) => stdout.push(chunk),
        onStderr: (chunk) => stderr.push(chunk),
      }),
    );

    expect(result.stdout).toBe("ready\n");
    expect(result.stderr).toBe("warn\n");
    expect(stdout.join("")).toBe("ready\n");
    expect(stderr.join("")).toBe("warn\n");
  });

  it("streams complete stdout and stderr lines while preserving raw chunks", async () => {
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];

    const result = await Effect.runPromise(
      runShell(
        "printf hel; sleep 0.05; printf 'lo\\nlast'; printf wa >&2; sleep 0.05; printf 'rn\\nerr' >&2",
        {
          timeout: 5_000,
          onStdout: (chunk) => stdoutChunks.push(chunk),
          onStderr: (chunk) => stderrChunks.push(chunk),
          onStdoutLine: (line) => stdoutLines.push(line),
          onStderrLine: (line) => stderrLines.push(line),
        },
      ),
    );

    expect(result.stdout).toBe("hello\nlast");
    expect(result.stderr).toBe("warn\nerr");
    expect(stdoutChunks).toEqual(["hel", "lo\nlast"]);
    expect(stderrChunks).toEqual(["wa", "rn\nerr"]);
    expect(stdoutChunks.join("")).toBe("hello\nlast");
    expect(stderrChunks.join("")).toBe("warn\nerr");
    expect(stdoutLines).toEqual(["hello", "last"]);
    expect(stderrLines).toEqual(["warn", "err"]);
  });

  it("treats carriage returns as live line boundaries", async () => {
    const stdoutLines: string[] = [];
    const stdoutDisplayModes: string[] = [];

    await Effect.runPromise(
      runShell("printf 'downloading 10%%\\rdownloading 20%%\\rdone\\n'", {
        onStdoutLine: (line, event) => {
          stdoutLines.push(line);
          stdoutDisplayModes.push(event.displayMode);
        },
      }),
    );

    expect(stdoutLines).toEqual(["downloading 10%", "downloading 20%", "done"]);
    expect(stdoutDisplayModes).toEqual(["replace", "replace", "replace"]);
  });

  it("flushes very long newline-free output in bounded line segments", async () => {
    const stdoutLines: string[] = [];

    await Effect.runPromise(
      runShell("node -e \"process.stdout.write('x'.repeat(17000))\"", {
        onStdoutLine: (line) => stdoutLines.push(line),
      }),
    );

    expect(stdoutLines.map((line) => line.length)).toEqual([
      maxBufferedLineLength,
      17_000 - maxBufferedLineLength,
    ]);
  });

  it("kills the spawned process group when an output callback throws", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "rig-shell-callback-"));
    const marker = join(tempDir, "survived");

    try {
      const exit = await Effect.runPromiseExit(
        runShell(`printf 'ready\\n'; (sleep 1; touch "${marker}") & wait`, {
          timeout: 5_000,
          onStdoutLine: () => {
            throw new Error("line sink failed");
          },
        }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
        expect(exit.cause.error).toBeInstanceOf(ShellError);
        expect((exit.cause.error as ShellError).stderr).toBe(
          "Output callback failed: line sink failed",
        );
      }

      await delay(1_300);
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it.each(["stdout", "stderr"] as const)(
    "kills the spawned process group when a raw %s callback throws",
    async (stream) => {
      const tempDir = mkdtempSync(join(tmpdir(), "rig-shell-raw-callback-"));
      const marker = join(tempDir, "survived");
      const callbackErrorMessage = `raw ${stream} sink failed`;

      try {
        const exit = await Effect.runPromiseExit(
          runShell(
            stream === "stdout"
              ? `printf 'ready\\n'; (sleep 1; touch "${marker}") & wait`
              : `printf 'ready\\n' >&2; (sleep 1; touch "${marker}") & wait`,
            {
              timeout: 5_000,
              ...(stream === "stdout"
                ? {
                    onStdout: () => {
                      throw new Error(callbackErrorMessage);
                    },
                  }
                : {
                    onStderr: () => {
                      throw new Error(callbackErrorMessage);
                    },
                  }),
            },
          ),
        );

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
          expect(exit.cause.error).toBeInstanceOf(ShellError);
          expect((exit.cause.error as ShellError).stderr).toBe(
            `Output callback failed: ${callbackErrorMessage}`,
          );
        }

        await delay(1_300);
        expect(existsSync(marker)).toBe(false);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    },
  );

  it("kills the spawned process group on timeout", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "rig-shell-timeout-"));
    const marker = join(tempDir, "survived");

    try {
      const exit = await Effect.runPromiseExit(
        runShell(`(sleep 1; touch "${marker}") & wait`, { timeout: 100 }),
      );

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
        expect(exit.cause.error).toBeInstanceOf(ShellError);
        expect((exit.cause.error as ShellError).timedOut).toBe(true);
      }

      await delay(1_300);
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("kills the spawned process group when aborted", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "rig-shell-abort-"));
    const marker = join(tempDir, "survived");
    const controller = new AbortController();

    try {
      const exitPromise = Effect.runPromiseExit(
        runShell(`(sleep 1; touch "${marker}") & wait`, { timeout: 5_000 }),
        { signal: controller.signal },
      );

      await delay(100);
      controller.abort();
      const exit = await exitPromise;

      expect(Exit.isFailure(exit)).toBe(true);

      await delay(1_300);
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
