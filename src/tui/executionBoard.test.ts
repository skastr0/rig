import { describe, expect, it } from "vitest";
import type { SystemItem } from "../schema/config.js";
import { applyRunLogs, createInitialRunItems, formatProgressBar } from "./executionBoard.js";
import type { PendingLogLine } from "./runner.js";

const makeItem = (
  name: string,
  options?: Partial<Pick<SystemItem, "group" | "install" | "tags">>,
): SystemItem => ({
  name,
  profiles: ["macbook"],
  tags: options?.tags ?? ["dev"],
  check: `which ${name}`,
  install: options?.install ?? `brew install ${name}`,
  group: options?.group,
});

describe("execution board model", () => {
  it("creates queued run rows with bundle, source, and tags", () => {
    const rows = createInitialRunItems(
      [makeItem("ripgrep", { group: "developer", tags: ["dev", "search"] })],
      "macbook",
      new Map(),
    );

    expect(rows[0]).toMatchObject({
      name: "ripgrep",
      phase: "queued",
      progress: 0,
      bundle: "developer",
      source: "shell",
      tags: ["dev", "search"],
    });
  });

  it("moves progress forward from installer output and finalizes on result events", () => {
    const initial = createInitialRunItems([makeItem("ripgrep")], "macbook", new Map());
    const output: PendingLogLine = {
      kind: "output",
      itemName: "ripgrep",
      message: "Downloading package",
      displayMode: "append",
    };
    const result: PendingLogLine = {
      kind: "progress",
      itemName: "ripgrep",
      message: "ripgrep: installed",
      resultAction: "installed",
      resultStatus: "installed",
    };

    const running = applyRunLogs(initial, [output]);
    expect(running[0]).toMatchObject({
      phase: "running",
      progress: 8,
      outputCount: 1,
      lastMessage: "Downloading package",
    });

    const settled = applyRunLogs(running, [result]);
    expect(settled[0]).toMatchObject({
      phase: "succeeded",
      progress: 100,
      action: "installed",
    });
  });

  it("marks failed result rows for inspection", () => {
    const initial = createInitialRunItems([makeItem("ripgrep")], "macbook", new Map());
    const failed = applyRunLogs(initial, [
      {
        kind: "error",
        itemName: "ripgrep",
        message: "ripgrep: failed",
        resultAction: "failed",
        resultStatus: "error",
        resultError: "network unavailable",
      },
    ]);

    expect(failed[0]).toMatchObject({
      phase: "failed",
      progress: 100,
      action: "failed",
      lastMessage: "network unavailable",
    });
  });

  it("formats braille progress bars with stable width", () => {
    expect(formatProgressBar(50)).toBe("⣿".repeat(12) + "·".repeat(12));
  });
});
