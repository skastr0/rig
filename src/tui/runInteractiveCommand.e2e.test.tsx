import { expect, test } from "bun:test";
import { act } from "react";
import { testRender } from "@opentui/react/test-utils";
import type { CliOptions } from "../cli.js";
import type { ExecutionResult } from "../engine/Executor.js";
import type { SystemItem } from "../schema/config.js";
import { maxRenderedLogLines } from "./logBuffer.js";
import { formatExecutionResultLog } from "./model.js";
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

test("InteractiveRigApp drives preview execution, renders item progress, and inspects logs", async () => {
  const requests: Parameters<ExecuteInteractiveRun>[0][] = [];
  const executeRun: ExecuteInteractiveRun = async (request, emit) => {
    requests.push(request);
    emit({ kind: "system", message: "previewing 2 items" });
    emit({
      kind: "output",
      itemName: "ripgrep",
      label: "[ripgrep] stdout:",
      message: "Installing package",
    });
    emit({
      kind: "output",
      itemName: "ripgrep",
      label: "[ripgrep] stdout:",
      message: "Next step",
    });
    emit({
      kind: "progress",
      itemName: "homebrew",
      message: "homebrew: skipped",
      resultAction: "skipped",
      resultStatus: "installed",
    });
    emit({
      kind: "progress",
      itemName: "ripgrep",
      message: "ripgrep: installed",
      resultAction: "installed",
      resultStatus: "installed",
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
    const reviewFrame = await setup.waitForFrame(
      (frame) => frame.includes("Review selection") && frame.includes("2 total"),
    );

    expect(reviewFrame).toContain("dependency map");
    expect(reviewFrame).toContain("homebrew");
    expect(reviewFrame).toContain("required by: ripgrep");
    expect(reviewFrame).not.toContain("Dependency tree");

    await pressAndSettle(() => setup.mockInput.pressKey("p"));

    const boardFrame = await setup.waitForFrame(
      (candidate) =>
        candidate.includes("install board") &&
        candidate.includes("homebrew") &&
        candidate.includes("ripgrep") &&
        candidate.includes("installed  100%"),
    );

    expect(boardFrame).toContain("Run complete");
    expect(boardFrame).not.toContain("[ripgrep] stdout: Installing package");

    await pressAndSettle(() => setup.mockInput.pressArrow("down"));
    await pressAndSettle(() => setup.mockInput.pressArrow("down"));
    await pressAndSettle(() => setup.mockInput.pressEnter());

    const logFrame = await setup.waitForFrame(
      (candidate) =>
        candidate.includes("logs / ripgrep") &&
        candidate.includes("[ripgrep] stdout: Installing package") &&
        candidate.includes("[ripgrep] stdout: Next step"),
    );

    expect(logFrame).toContain("Press b or escape to return to the install board.");

    await pressAndSettle(() => setup.mockInput.pressEscape());
    await setup.waitForFrame(
      (candidate) => candidate.includes("install board") && !candidate.includes("logs / ripgrep"),
    );

    await pressAndSettle(() => setup.mockInput.pressEscape());
    const returnedReviewFrame = await setup.waitForFrame(
      (candidate) =>
        candidate.includes("Review selection") &&
        candidate.includes("dependency map") &&
        candidate.includes("depends on: homebrew"),
    );

    expect(returnedReviewFrame).not.toContain("logs / ripgrep");
    expect(returnedReviewFrame).not.toContain("[ripgrep] stdout: Installing package");
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

test("InteractiveRigApp renders update completion and visible post-check failures", async () => {
  const results: readonly ExecutionResult[] = [
    result("current-tool", "update_completed", "installed"),
    {
      ...result("broken-tool", "failed", "error"),
      error: "Verification failed for broken-tool: Post-operation check did not pass",
    },
    {
      ...result("dependent-tool", "blocked", "blocked"),
      error: "Blocked by unsuccessful dependency: broken-tool",
    },
  ];
  const executeRun: ExecuteInteractiveRun = async (_request, emit) => {
    for (const item of results) {
      emit({
        kind: item.action === "failed" ? "error" : "progress",
        itemName: item.name,
        message: formatExecutionResultLog(item),
        resultAction: item.action,
        resultStatus: item.status,
        resultError: item.error,
      });
    }
    return { results };
  };
  const setup = await testRender(
    <InteractiveRigApp
      options={{ ...baseOptions, update: true }}
      configSource={{ _tag: "local", path: "./system-config.json" }}
      items={[
        makeItem("current-tool"),
        makeItem("broken-tool"),
        makeItem("dependent-tool", { dependsOn: ["broken-tool"] }),
      ]}
      executeRun={executeRun}
      onExit={() => undefined}
    />,
    { width: 160, height: 46 },
  );

  try {
    await settle();
    await pressAndSettle(() => setup.mockInput.pressEnter());
    await setup.waitForFrame((frame) => frame.includes("Choose tags"));
    await pressAndSettle(() => setup.mockInput.pressEnter());
    await setup.waitForFrame((frame) => frame.includes("Review selection"));
    await pressAndSettle(() => setup.mockInput.pressKey("r"));

    const frame = await setup.waitForFrame(
      (candidate) =>
        candidate.includes("current-tool  update completed") &&
        candidate.includes("broken-tool  failed") &&
        candidate.includes("dependent-tool  blocked"),
    );

    expect(frame).toContain("2 need inspection");
    expect(frame).toContain("Verification failed for broken-tool");
    expect(frame).not.toContain("current-tool  updated");

    await pressAndSettle(() => setup.mockInput.pressArrow("down"));
    await pressAndSettle(() => setup.mockInput.pressArrow("down"));
    await pressAndSettle(() => setup.mockInput.pressEnter());
    const logFrame = await setup.waitForFrame((candidate) =>
      candidate.includes("logs / broken-tool"),
    );
    expect(logFrame).toContain("Post-operation check did not pass");
  } finally {
    act(() => {
      setup.renderer.destroy();
    });
  }
});

test("InteractiveRigApp keeps high-volume install logs bounded and coalesces progress rows", async () => {
  const executeRun: ExecuteInteractiveRun = async (_request, emit) => {
    emit({ kind: "system", message: "running noisy install" });

    for (let index = 0; index < 25; index += 1) {
      emit({
        kind: "output",
        itemName: "ripgrep",
        label: "[ripgrep] stdout:",
        coalesceKey: "ripgrep:stdout",
        displayMode: "append",
        message: index % 2 === 0 ? "\u001B[2K\u001B[?25l      \t      " : "        ",
      });
    }

    for (let index = 0; index < maxRenderedLogLines + 40; index += 1) {
      emit({
        kind: "output",
        itemName: "ripgrep",
        label: "[ripgrep] stdout:",
        coalesceKey: "ripgrep:stdout",
        displayMode: "append",
        replaceable: false,
        message: `log ${index}`,
      });
    }

    for (let index = 0; index < 50; index += 1) {
      emit({
        kind: "output",
        itemName: "ripgrep",
        label: "[ripgrep] stdout:",
        coalesceKey: "ripgrep:stdout",
        displayMode: "replace",
        replaceable: true,
        message: `\u001B[32mdownloading ${index}%\u001B[0m`,
      });
    }

    emit({
      kind: "output",
      itemName: "ripgrep",
      label: "[ripgrep] stdout:",
      coalesceKey: "ripgrep:stdout",
      displayMode: "replace",
      replaceable: false,
      message: "download complete",
    });
    emit({
      kind: "progress",
      itemName: "ripgrep",
      message: "ripgrep: installed",
      resultAction: "installed",
      resultStatus: "installed",
    });

    return {
      results: [result("ripgrep", "installed", "installed")],
    };
  };

  const setup = await testRender(
    <InteractiveRigApp
      options={baseOptions}
      configSource={{ _tag: "local", path: "./system-config.json" }}
      items={[makeItem("ripgrep")]}
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
      (frame) => frame.includes("Review selection") && frame.includes("1 total"),
    );

    await pressAndSettle(() => setup.mockInput.pressKey("p"));

    const frame = await setup.waitForFrame(
      (candidate) =>
        candidate.includes("install board") &&
        candidate.includes("ripgrep") &&
        candidate.includes("download complete"),
    );

    expect(frame).toContain("Run complete");
    expect(frame).not.toContain("[ripgrep] stdout: log 0");
    expect(frame).not.toContain("[ripgrep] stdout: downloading 49%");
    expect(frame).not.toContain("[ripgrep] stdout:\n");

    await pressAndSettle(() => setup.mockInput.pressArrow("down"));
    await pressAndSettle(() => setup.mockInput.pressEnter());

    const logFrame = await setup.waitForFrame(
      (candidate) =>
        candidate.includes("logs / ripgrep") &&
        candidate.includes("[ripgrep] stdout: download complete"),
    );

    expect(logFrame).not.toContain("[ripgrep] stdout:\n");
  } finally {
    act(() => {
      setup.renderer.destroy();
    });
  }
});
