import { describe, expect, it } from "vitest";
import {
  appendBufferedLogs,
  getRenderedLogWindow,
  maxLogMessageLength,
  maxRenderedLogLines,
  maxStoredLogLines,
} from "./logBuffer.js";
import type { PendingLogLine } from "./runner.js";

const appendLogs = (pending: readonly PendingLogLine[]) => {
  let id = 1;
  return appendBufferedLogs([], pending, () => {
    const next = id;
    id += 1;
    return next;
  });
};

describe("TUI log buffering", () => {
  it("coalesces carriage-return repaint rows without overwriting settled output", () => {
    const logs = appendLogs([
      {
        kind: "output",
        itemName: "ripgrep",
        coalesceKey: "ripgrep:stdout",
        displayMode: "append",
        message: "[ripgrep] stdout: starting",
      },
      {
        kind: "output",
        itemName: "ripgrep",
        coalesceKey: "ripgrep:stdout",
        displayMode: "replace",
        replaceable: true,
        message: "[ripgrep] stdout: downloading 10%",
      },
      {
        kind: "output",
        itemName: "ripgrep",
        coalesceKey: "ripgrep:stdout",
        displayMode: "replace",
        replaceable: true,
        message: "[ripgrep] stdout: downloading 20%",
      },
      {
        kind: "output",
        itemName: "ripgrep",
        coalesceKey: "ripgrep:stdout",
        displayMode: "replace",
        replaceable: false,
        message: "[ripgrep] stdout: done",
      },
      {
        kind: "output",
        itemName: "ripgrep",
        coalesceKey: "ripgrep:stdout",
        displayMode: "replace",
        replaceable: true,
        message: "[ripgrep] stdout: later 10%",
      },
    ]);

    expect(logs.map((line) => line.message)).toEqual([
      "[ripgrep] stdout: starting",
      "[ripgrep] stdout: done",
      "[ripgrep] stdout: later 10%",
    ]);
    expect(logs.map((line) => line.id)).toEqual([1, 2, 3]);
  });

  it("bounds stored and rendered logs", () => {
    let id = 1;
    const logs = appendBufferedLogs(
      [],
      Array.from({ length: maxStoredLogLines + 5 }, (_, index) => ({
        kind: "output" as const,
        message: `line ${index}`,
      })),
      () => {
        const next = id;
        id += 1;
        return next;
      },
    );

    expect(logs).toHaveLength(maxStoredLogLines);
    expect(logs[0]?.message).toBe("line 5");

    const rendered = getRenderedLogWindow(logs);
    expect(rendered).toHaveLength(maxRenderedLogLines);
    expect(rendered[0]?.message).toBe(`line ${maxStoredLogLines + 5 - maxRenderedLogLines}`);
  });

  it("sanitizes terminal-control output before it becomes a rendered row", () => {
    const logs = appendLogs([
      {
        kind: "output",
        itemName: "ripgrep",
        label: "\u001B[31m[ripgrep] stdout:\u001B[0m",
        message: "\u001B[32mInstalled package\u001B[0m",
      },
      {
        kind: "output",
        itemName: "ripgrep",
        label: "[ripgrep] stdout:",
        message: "\u001B[2K\u001B[?25l      \t     ",
      },
      {
        kind: "error",
        message: "failed\n\n\u001B[31mboom\u001B[0m\n    \t       ",
      },
    ]);

    expect(logs.map((line) => line.message)).toEqual([
      "[ripgrep] stdout: Installed package",
      "failed",
      "boom",
    ]);
  });

  it("caps pathological single-line output", () => {
    const logs = appendLogs([
      {
        kind: "output",
        itemName: "ripgrep",
        label: "[ripgrep] stdout:",
        message: "x".repeat(maxLogMessageLength + 100),
      },
    ]);

    const message = logs[0]?.message ?? "";
    expect(message).toContain("[ripgrep] stdout:");
    expect(message).toContain("[truncated]");
    expect(message.length).toBeLessThanOrEqual(maxLogMessageLength + "[ripgrep] stdout: ".length);
  });
});
