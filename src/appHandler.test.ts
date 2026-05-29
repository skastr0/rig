import { describe, expect, it, vi, afterEach } from "vitest";
import { Effect, Layer } from "effect";
import type { CliOptions } from "./cli.js";
import { Executor, type ExecutorOptions } from "./engine/Executor.js";
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

    await runHandler(baseOptions, executor);

    expect(execute).not.toHaveBeenCalled();
    expect(inspect).not.toHaveBeenCalled();
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
