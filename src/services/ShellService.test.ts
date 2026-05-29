import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";
import { ShellError } from "../errors.js";
import { ShellService, ShellServiceLive } from "./ShellService.js";

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
