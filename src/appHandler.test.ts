import { describe, expect, it, vi, afterEach } from "vitest";
import { Effect, Layer } from "effect";
import type { CliOptions } from "./cli.js";
import {
  Executor,
  type ExecutionResult,
  type ExecutorOptions,
  type InspectionResult,
} from "./engine/Executor.js";
import type { PlanResult } from "./engine/Planner.js";
import type { ConfigService } from "./services/ConfigService.js";
import { ConfigService as ConfigServiceTag } from "./services/ConfigService.js";
import { handler } from "./appHandler.js";

const baseOptions = {
  config: "https://example.com/system-config.json",
  profile: "macbook",
  ci: true,
  init: false,
  dryRun: false,
  apply: false,
  status: false,
  why: undefined,
  tags: [],
  only: [],
  verbose: false,
  update: false,
} satisfies CliOptions;

const configService = ConfigServiceTag.of({
  load: () =>
    Effect.succeed({
      items: [
        {
          name: "remote-tool",
          profiles: ["macbook"],
          tags: ["dev"],
          check: "echo should-not-run",
          install: "echo install-preview-only",
          update: "echo update-preview-only",
        },
      ],
    }),
  writeStarterConfig: () =>
    Effect.die("writeStarterConfig should not be called by execution commands"),
} satisfies ConfigService);

const runHandler = async (
  options: CliOptions,
  executor: Executor,
  providedConfigService = configService,
) =>
  Effect.runPromise(
    handler(options).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(ConfigServiceTag, providedConfigService),
          Layer.succeed(Executor, executor),
        ),
      ),
    ),
  );

describe("app handler", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints a static preview for remote configs without executing checks", async () => {
    const output: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      output.push(args.join(" "));
    });

    const execute = vi.fn((_plan: PlanResult, _options?: ExecutorOptions) => Effect.succeed([]));
    const inspect = vi.fn(() => Effect.succeed([]));
    const executor = Executor.of({ execute, inspect });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("Unexpected process exit");
    });

    await runHandler(baseOptions, executor);

    expect(execute).not.toHaveBeenCalled();
    expect(inspect).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(output.some((line) => line.includes("Remote Static Preview"))).toBe(true);
    expect(output.some((line) => line.includes("check command not executed"))).toBe(true);
    expect(output.some((line) => line.includes("echo should-not-run"))).toBe(true);
    expect(output.some((line) => line.includes("echo install-preview-only"))).toBe(true);
  });

  it("prints update commands in remote static preview when --update is requested", async () => {
    const output: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      output.push(args.join(" "));
    });

    const execute = vi.fn((_plan: PlanResult, _options?: ExecutorOptions) => Effect.succeed([]));
    const inspect = vi.fn(() => Effect.succeed([]));
    const executor = Executor.of({ execute, inspect });

    await runHandler({ ...baseOptions, update: true }, executor);

    expect(execute).not.toHaveBeenCalled();
    expect(inspect).not.toHaveBeenCalled();
    expect(output.some((line) => line.includes("echo update-preview-only"))).toBe(true);
  });

  it.each([
    { action: "failed", status: "error", summary: "1 failed" },
    { action: "timed_out", status: "error", summary: "1 timed out" },
    { action: "blocked", status: "blocked", summary: "1 blocked by dependencies" },
  ] satisfies ReadonlyArray<{
    action: ExecutionResult["action"];
    status: ExecutionResult["status"];
    summary: string;
  }>)("exits nonzero after the complete summary for $action results", async (failure) => {
    const output: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      output.push(args.join(" "));
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      expect(output.some((line) => line.includes("Summary:"))).toBe(true);
      expect(output.some((line) => line.includes("1 installed"))).toBe(true);
      expect(output.some((line) => line.includes(failure.summary))).toBe(true);
      expect(output.some((line) => line.includes("independent-tool"))).toBe(true);
      throw new Error("Simulated process exit");
    });
    const results: readonly ExecutionResult[] = [
      { name: "remote-tool", status: failure.status, action: failure.action, error: "failed" },
      { name: "independent-tool", status: "installed", action: "installed" },
    ];
    const execute = vi.fn((_plan: PlanResult, options?: ExecutorOptions) =>
      Effect.sync(() => {
        results.forEach((result) => options?.onProgress?.(result));
        return results;
      }),
    );
    const inspect = vi.fn(() => Effect.succeed([]));

    await expect(
      runHandler({ ...baseOptions, apply: true }, Executor.of({ execute, inspect })),
    ).rejects.toThrow("Simulated process exit");

    expect(execute).toHaveBeenCalledTimes(1);
    expect(inspect).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      "\nExecution failed: one or more items failed, timed out, or were blocked.\n",
    );
  });

  it("keeps all-success execution successful", async () => {
    const output: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      output.push(args.join(" "));
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("Unexpected process exit");
    });
    const results: readonly ExecutionResult[] = [
      { name: "installed-tool", status: "installed", action: "installed" },
      { name: "updated-tool", status: "installed", action: "update_completed" },
      { name: "existing-tool", status: "installed", action: "skipped" },
    ];
    const execute = vi.fn(() => Effect.succeed(results));
    const inspect = vi.fn(() => Effect.succeed([]));

    await runHandler({ ...baseOptions, apply: true }, Executor.of({ execute, inspect }));

    expect(execute).toHaveBeenCalledTimes(1);
    expect(inspect).not.toHaveBeenCalled();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(output.some((line) => line.includes("1 installed"))).toBe(true);
    expect(output.some((line) => line.includes("1 update completed"))).toBe(true);
    expect(output.some((line) => line.includes("1 already installed"))).toBe(true);
  });

  it("exits nonzero after the full status summary when an item check errors", async () => {
    const output: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      output.push(args.join(" "));
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      expect(output.some((line) => line.includes("Status Summary:"))).toBe(true);
      expect(output.some((line) => line.includes("1 installed"))).toBe(true);
      expect(output.some((line) => line.includes("1 error"))).toBe(true);
      expect(output.some((line) => line.includes("1 blocked"))).toBe(true);
      expect(output.some((line) => line.includes("check command exited 127"))).toBe(true);
      throw new Error("Simulated process exit");
    });
    const results: readonly InspectionResult[] = [
      { name: "remote-tool", status: "error", reason: "check command exited 127" },
      { name: "dependent-tool", status: "blocked", reason: "remote-tool is not ready" },
      { name: "independent-tool", status: "installed" },
    ];
    const execute = vi.fn(() => Effect.succeed([]));
    const inspect = vi.fn(() => Effect.succeed(results));

    await expect(
      runHandler({ ...baseOptions, status: true, apply: true }, Executor.of({ execute, inspect })),
    ).rejects.toThrow("Simulated process exit");

    expect(execute).not.toHaveBeenCalled();
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      "\nInspection failed: one or more item checks could not be completed.\n",
    );
  });

  it("keeps missing status results informational when checks complete normally", async () => {
    const output: string[] = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      output.push(args.join(" "));
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("Unexpected process exit");
    });
    const results: readonly InspectionResult[] = [
      { name: "remote-tool", status: "missing" },
      { name: "dependent-tool", status: "blocked", reason: "remote-tool is missing" },
      { name: "current-tool", status: "updateable" },
    ];
    const execute = vi.fn(() => Effect.succeed([]));
    const inspect = vi.fn(() => Effect.succeed(results));

    await runHandler(
      { ...baseOptions, status: true, apply: true },
      Executor.of({ execute, inspect }),
    );

    expect(execute).not.toHaveBeenCalled();
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(exitSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(output.some((line) => line.includes("1 missing"))).toBe(true);
    expect(output.some((line) => line.includes("1 blocked"))).toBe(true);
    expect(output.some((line) => line.includes("1 updateable"))).toBe(true);
  });

  it("requires --apply before remote status can execute checks", async () => {
    const errorOutput: string[] = [];
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation((...args) => {
      errorOutput.push(args.join(" "));
    });
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);

    const load = vi.fn(() =>
      Effect.succeed({
        items: [
          {
            name: "remote-tool",
            profiles: ["macbook"],
            tags: ["dev"],
            check: "echo should-not-run",
            install: "echo install-preview-only",
          },
        ],
      }),
    );
    const remoteConfigService = ConfigServiceTag.of({
      load,
      writeStarterConfig: () =>
        Effect.die("writeStarterConfig should not be called by status commands"),
    } satisfies ConfigService);

    const execute = vi.fn((_plan: PlanResult, _options?: ExecutorOptions) => Effect.succeed([]));
    const inspect = vi.fn(() => Effect.succeed([]));
    const executor = Executor.of({ execute, inspect });

    await runHandler({ ...baseOptions, status: true }, executor, remoteConfigService);

    expect(load).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
    expect(inspect).not.toHaveBeenCalled();
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(
      errorOutput.some((line) => line.includes("Remote --status executes check commands")),
    ).toBe(true);
  });
});
