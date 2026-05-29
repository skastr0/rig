import { describe, expect, it } from "vitest";
import { Effect, Layer } from "effect";
import type { CliOptions } from "../cli.js";
import { Executor, type ExecutorOptions } from "../engine/Executor.js";
import type { PlanResult } from "../engine/Planner.js";
import type { SystemItem } from "../schema/config.js";
import { executeInteractivePlan, type PendingLogLine } from "./runner.js";

const baseOptions = {
  config: "./system-config.json",
  profile: undefined,
  ci: false,
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

const makeItem = (
  name: string,
  options?: Partial<Pick<SystemItem, "dependsOn" | "tags" | "update">>,
): SystemItem => ({
  name,
  profiles: ["macbook"],
  tags: options?.tags ?? ["base"],
  check: `which ${name}`,
  install: `install ${name}`,
  update: options?.update,
  dependsOn: options?.dependsOn,
});

const runInteractiveScenario = async (request: {
  readonly apply: boolean;
  readonly dryRun: boolean;
  readonly update?: boolean;
}) => {
  const observed: {
    executeCalled: boolean;
    planNames?: readonly string[];
    options?: ExecutorOptions;
    logs: PendingLogLine[];
  } = { executeCalled: false, logs: [] };

  const executor = Executor.of({
    inspect: () => Effect.succeed([]),
    execute: (plan: PlanResult, options?: ExecutorOptions) =>
      Effect.sync(() => {
        observed.executeCalled = true;
        observed.planNames = plan.sorted.map((item) => item.name);
        observed.options = options;
        return [];
      }),
  });

  await Effect.runPromise(
    executeInteractivePlan(
      {
        options: baseOptions,
        configSource: { _tag: "https", url: "https://example.com/system-config.json" },
        items: [
          makeItem("homebrew"),
          makeItem("ripgrep", {
            tags: ["dev"],
            dependsOn: ["homebrew"],
            update: "update ripgrep",
          }),
          makeItem("ffmpeg", { tags: ["media"], dependsOn: ["homebrew"] }),
        ],
      },
      {
        profile: "macbook",
        tags: ["dev", "media"],
        only: ["ripgrep"],
        dryRun: request.dryRun,
        update: request.update ?? false,
        verbose: false,
        apply: request.apply,
      },
      (line) => observed.logs.push(line),
    ).pipe(Effect.provide(Layer.succeed(Executor, executor))),
  );

  return observed;
};

describe("executeInteractivePlan", () => {
  it("preserves --only when building the interactive execution plan", async () => {
    const observed = await runInteractiveScenario({ dryRun: false, apply: true });

    expect(observed.executeCalled).toBe(true);
    expect(observed.planNames).toEqual(["homebrew", "ripgrep"]);
  });

  it("keeps remote interactive execution in preview unless --apply is present", async () => {
    const preview = await runInteractiveScenario({ dryRun: false, apply: false, update: true });
    const apply = await runInteractiveScenario({ dryRun: false, apply: true });

    expect(preview.executeCalled).toBe(false);
    expect(preview.logs.some((line) => line.message.includes("previewing 2 items"))).toBe(true);
    expect(preview.logs.some((line) => line.message.includes("checks are not executed"))).toBe(
      true,
    );
    expect(preview.logs.some((line) => line.message.includes("check skipped: which ripgrep"))).toBe(
      true,
    );
    expect(preview.logs.some((line) => line.message.includes("install ripgrep"))).toBe(true);
    expect(preview.logs.some((line) => line.message.includes("update ripgrep"))).toBe(true);
    expect(apply.executeCalled).toBe(true);
    expect(apply.options?.dryRun).toBe(false);
  });
});
