import type { ExecutionResult } from "../engine/Executor.js";
import { installInspection } from "../engine/InstallInspection.js";
import {
  analyzeSelection,
  collectAvailableProfiles,
  collectAvailableTags,
  type SelectionAnalysis,
  type SelectionReason,
} from "../engine/Selection.js";
import type { SystemItem } from "../schema/config.js";

export type TuiStage = "profile" | "tags" | "review" | "running" | "done";
export type LogKind = "system" | "progress" | "preview" | "output" | "verbose" | "error";

export interface ProfileRow {
  readonly name: string;
  readonly description: string;
  readonly itemCount: number;
  readonly tagCount: number;
}

export interface TagRow {
  readonly name: string;
  readonly selected: boolean;
  readonly itemCount: number;
}

export interface SelectionSummary {
  readonly analysis: SelectionAnalysis;
  readonly directCount: number;
  readonly dependencyCount: number;
}

export interface TuiLogLine {
  readonly id: number;
  readonly kind: LogKind;
  readonly message: string;
  readonly itemName?: string;
}

const formatCount = (count: number, singular: string, plural = `${singular}s`): string =>
  `${count} ${count === 1 ? singular : plural}`;

const itemsForProfile = (items: readonly SystemItem[], profile: string): readonly SystemItem[] =>
  items.filter((item) => item.profiles.includes(profile));

export const buildProfileRows = (items: readonly SystemItem[]): readonly ProfileRow[] =>
  collectAvailableProfiles(items).map((profile) => {
    const profileItems = itemsForProfile(items, profile);
    const profileTags = collectAvailableTags(items, profile);

    return {
      name: profile,
      description: `${formatCount(profileItems.length, "item")} across ${formatCount(profileTags.length, "tag")}`,
      itemCount: profileItems.length,
      tagCount: profileTags.length,
    };
  });

export const buildTagRows = (
  items: readonly SystemItem[],
  profile: string,
  selectedTags: ReadonlySet<string>,
): readonly TagRow[] =>
  collectAvailableTags(items, profile).map((tag) => ({
    name: tag,
    selected: selectedTags.has(tag),
    itemCount: itemsForProfile(items, profile).filter((item) => item.tags.includes(tag)).length,
  }));

export const summarizeSelection = (
  items: readonly SystemItem[],
  profile: string,
  tags: readonly string[],
  only: readonly string[] = [],
): SelectionSummary => {
  const analysis = analyzeSelection(items, { profile, tags, only });
  let directCount = 0;
  let dependencyCount = 0;

  for (const reason of analysis.reasons.values()) {
    if (reason.type === "direct") {
      directCount += 1;
      continue;
    }

    dependencyCount += 1;
  }

  return { analysis, directCount, dependencyCount };
};

export const getItemPreviewLines = (
  item: SystemItem | undefined,
  includeUpdate: boolean,
): readonly string[] => {
  if (!item) {
    return [];
  }

  const installPreview = installInspection.getInstallPreview(item.install);
  const previews = [
    installPreview,
    ...(includeUpdate && item.update ? [installInspection.getUpdatePreview(item.update)] : []),
  ];

  return previews.flatMap((preview) => [
    preview.label,
    ...preview.steps.map((step) => `  ${step}`),
  ]);
};

export const formatReasonBadge = (reason: SelectionReason | undefined): string => {
  if (!reason) {
    return "not selected";
  }

  if (reason.type === "direct") {
    return "direct";
  }

  return "dependency";
};

export const formatExecutionResultLog = (result: ExecutionResult): string => {
  const detail = result.detail ? ` (${result.detail})` : "";
  const error = result.error ? `: ${result.error.trim()}` : "";

  return `${result.name}: ${result.action}${detail}${error}`;
};

export const formatExecutionPreviewLogs = (result: ExecutionResult): readonly string[] => {
  if (!result.preview) {
    return [];
  }

  return [
    `${result.name}: ${result.preview.label}`,
    ...result.preview.steps.map((step) => `${result.name}: ${step}`),
  ];
};

export const filterLogsByItem = (
  logs: readonly TuiLogLine[],
  itemName: string | undefined,
): readonly TuiLogLine[] => {
  if (itemName === undefined) {
    return logs;
  }

  return logs.filter((log) => log.itemName === undefined || log.itemName === itemName);
};
