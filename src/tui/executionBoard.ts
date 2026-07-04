import type { SystemItem } from "../schema/config.js";
import type { SelectionReason } from "../engine/Selection.js";
import { formatReasonBadge, getInstallSourceLabel } from "./model.js";
import type { PendingLogLine } from "./runner.js";

export type TuiRunItemPhase = "queued" | "running" | "succeeded" | "skipped" | "failed" | "blocked";

export interface TuiRunItemState {
  readonly name: string;
  readonly phase: TuiRunItemPhase;
  readonly progress: number;
  readonly pulse: number;
  readonly logCount: number;
  readonly outputCount: number;
  readonly tags: readonly string[];
  readonly bundle: string;
  readonly source: string;
  readonly reason: string;
  readonly action?: string;
  readonly detail?: string;
  readonly lastMessage?: string;
}

const progressBarWidth = 24;
const brailleFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

export const createInitialRunItems = (
  items: readonly SystemItem[],
  selectedProfile: string,
  reasons: ReadonlyMap<string, SelectionReason>,
): readonly TuiRunItemState[] =>
  items.map((item) => ({
    name: item.name,
    phase: "queued",
    progress: 0,
    pulse: 0,
    logCount: 0,
    outputCount: 0,
    tags: item.tags,
    bundle: item.group ?? selectedProfile,
    source: getInstallSourceLabel(item),
    reason: formatReasonBadge(reasons.get(item.name)),
  }));

const activityText = (line: PendingLogLine): string | undefined => {
  const text = line.message.trim();
  if (text.length === 0) {
    return undefined;
  }

  return text.length > 72 ? `${text.slice(0, 69).trimEnd()}...` : text;
};

const progressIncrementFor = (line: PendingLogLine): number => {
  if (line.kind === "output") {
    return line.displayMode === "replace" ? 2 : 5;
  }

  if (line.kind === "verbose") {
    return 3;
  }

  return 1;
};

const bumpRunningProgress = (item: TuiRunItemState, line: PendingLogLine): TuiRunItemState => {
  const nextProgress = Math.min(92, Math.max(8, item.progress + progressIncrementFor(line)));
  const nextMessage = activityText(line);

  return {
    ...item,
    phase: item.phase === "queued" ? "running" : item.phase,
    progress: nextProgress,
    pulse: item.pulse + 1,
    logCount: item.logCount + 1,
    outputCount: item.outputCount + (line.kind === "output" ? 1 : 0),
    ...(nextMessage === undefined ? {} : { lastMessage: nextMessage }),
  };
};

const phaseForResult = (line: PendingLogLine): TuiRunItemPhase => {
  switch (line.resultAction) {
    case "installed":
    case "updated":
    case "would_update":
      return "succeeded";
    case "skipped":
      return "skipped";
    case "blocked":
      return "blocked";
    case "failed":
    case "timed_out":
      return "failed";
    default:
      return line.kind === "error" ? "failed" : "succeeded";
  }
};

const applyResult = (item: TuiRunItemState, line: PendingLogLine): TuiRunItemState => ({
  ...item,
  phase: phaseForResult(line),
  progress: 100,
  pulse: item.pulse + 1,
  logCount: item.logCount + 1,
  ...(line.resultAction === undefined ? {} : { action: line.resultAction }),
  ...(line.resultDetail === undefined ? {} : { detail: line.resultDetail }),
  ...(line.resultError === undefined ? {} : { lastMessage: line.resultError }),
});

export const applyRunLogs = (
  items: readonly TuiRunItemState[],
  pending: readonly PendingLogLine[],
): readonly TuiRunItemState[] => {
  if (items.length === 0 || pending.length === 0) {
    return items;
  }

  const byName = new Map(items.map((item) => [item.name, item]));

  for (const line of pending) {
    if (line.itemName === undefined) {
      continue;
    }

    const item = byName.get(line.itemName);
    if (item === undefined) {
      continue;
    }

    if (line.resultAction !== undefined || line.kind === "progress" || line.kind === "error") {
      byName.set(line.itemName, applyResult(item, line));
      continue;
    }

    if (line.kind === "output" || line.kind === "verbose") {
      byName.set(line.itemName, bumpRunningProgress(item, line));
    }
  }

  return items.map((item) => byName.get(item.name) ?? item);
};

export const statusLabelForRunItem = (item: TuiRunItemState): string => {
  switch (item.phase) {
    case "queued":
      return "queued";
    case "running":
      return "installing";
    case "succeeded":
      return item.action ?? "done";
    case "skipped":
      return item.action ?? "skipped";
    case "failed":
      return item.action ?? "failed";
    case "blocked":
      return "blocked";
  }
};

export const spinnerForRunItem = (item: TuiRunItemState): string => {
  if (item.phase !== "running") {
    return item.phase === "succeeded" || item.phase === "skipped"
      ? "✓"
      : item.phase === "queued"
        ? "·"
        : "×";
  }

  return brailleFrames[item.pulse % brailleFrames.length] ?? brailleFrames[0];
};

export const formatProgressBar = (progress: number): string => {
  const bounded = Math.max(0, Math.min(100, progress));
  const filled = Math.round((bounded / 100) * progressBarWidth);
  const empty = progressBarWidth - filled;

  return `${"⣿".repeat(filled)}${"·".repeat(empty)}`;
};
