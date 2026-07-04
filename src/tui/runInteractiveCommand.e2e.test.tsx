import { expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import type { CliOptions } from "../cli.js";
import type { ExecutionResult } from "../engine/Executor.js";
import type { SystemItem } from "../schema/config.js";
import { InteractiveRigApp } from "./runInteractiveCommand.js";
import type { ExecuteInteractiveRun } from "./runner.js";

const baseOptions = {
  config: "./system-config.json",
  profile: "macbook",
  ci: false,
  init: false,
  dryRun: false,
  apply: false,
  status: false,
  why: undefined,
  tags: ["dev"],
  only: [],
  verbose: false,
  update: false,
} satisfies CliOptions;

const makeItem = (
  name: string,
  options?: Partial<Pick<SystemItem, "dependsOn" | "tags">>,
): SystemItem => ({
  name,
  profiles: ["macbook"],
  tags: options?.tags ?? ["dev"],
  check: `which ${name}`,
  install: `brew install ${name}`,
  dependsOn: options?.dependsOn,
});

const result = (
  name: string,
  action: ExecutionResult["action"],
  status: ExecutionResult["status"],
): ExecutionResult => ({ name, action, status });

const settle = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
};

const pressAndSettle = async (press: () => void): Promise<void> => {
  await act(async () => {
    press();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
};

test("InteractiveRigApp drives preview execution and renders emitted log rows", async () => {
  const requests: Parameters<ExecuteInteractiveRun>[0][] = [];
  const executeRun: ExecuteInteractiveRun = async (request, emit) => {
    requests.push(request);
    emit({ kind: "system", message: "previewing 2 items" });
    emit({
      kind: "output",
      itemName: "ripgrep",
      message: "[ripgrep] stdout: Installing package",
    });
    emit({
      kind: "output",
      itemName: "ripgrep",
      message: "[ripgrep] stdout: Next step",
    });

    return {
      results: [
        result("homebrew", "skipped", "installed"),
        result("ripgrep", "installed", "installed"),
      ],
    };
  };

  const setup = await testRender(
    <InteractiveRigApp
      options={baseOptions}
      configSource={{ _tag: "local", path: "./system-config.json" }}
      items={[
        makeItem("homebrew", { tags: ["brew"] }),
        makeItem("ripgrep", { dependsOn: ["homebrew"] }),
      ]}
      executeRun={executeRun}
      onExit={() => undefined}
    />,
    { width: 130, height: 40 },
  );

  try {
    await settle();
    await setup.waitForFrame(
      (frame) => frame.includes("Choose profile") && frame.includes("macbook"),
    );

    await pressAndSettle(() => setup.mockInput.pressEnter());
    await setup.waitForFrame((frame) => frame.includes("Choose tags") && frame.includes("dev"));

    await pressAndSettle(() => setup.mockInput.pressEnter());
    await setup.waitForFrame(
      (frame) => frame.includes("Review selection") && frame.includes("2 total"),
    );

    await pressAndSettle(() => setup.mockInput.pressKey("p"));

    const frame = await setup.waitForFrame(
      (candidate) =>
        candidate.includes("[ripgrep] stdout: Installing package") &&
        candidate.includes("[ripgrep] stdout: Next step") &&
        candidate.includes("completed 2 items"),
    );

    expect(frame).toContain("Run complete");
    expect(requests).toEqual([
      {
        profile: "macbook",
        tags: ["dev"],
        only: [],
        dryRun: true,
        update: false,
        verbose: false,
        apply: false,
      },
    ]);
  } finally {
    act(() => {
      setup.renderer.destroy();
    });
  }
});
