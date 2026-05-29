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

export interface FilterableOption {
  readonly name: string;
  readonly description?: string;
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

export const filterOptions = <TOption extends FilterableOption>(
  options: readonly TOption[],
  query: string,
): TOption[] => {
  const normalizedQuery = query.trim().toLowerCase();

  if (normalizedQuery.length === 0) {
    return [...options];
  }

  return options.filter((option) => {
    const haystack = `${option.name} ${option.description ?? ""}`.toLowerCase();
    return haystack.includes(normalizedQuery);
  });
};

const dependencyTreeRoots = (summary: SelectionSummary): readonly SystemItem[] =>
  summary.analysis.selectedItems.filter(
    (item) => summary.analysis.reasons.get(item.name)?.type === "direct",
  );

const dependencyChildren = (
  item: SystemItem,
  selectedItemMap: ReadonlyMap<string, SystemItem>,
): readonly SystemItem[] =>
  (item.dependsOn ?? []).flatMap((dependencyName) => {
    const dependency = selectedItemMap.get(dependencyName);
    return dependency ? [dependency] : [];
  });

const formatTreeItem = (
  item: SystemItem,
  summary: SelectionSummary,
  expanded: Set<string>,
  ancestors: ReadonlySet<string>,
  prefix: string,
  isLast: boolean,
): readonly string[] => {
  const connector = isLast ? "\\- " : "+- ";
  const reason = formatReasonBadge(summary.analysis.reasons.get(item.name));
  const status = ancestors.has(item.name) ? "cycle" : expanded.has(item.name) ? "shared" : reason;
  const line = `${prefix}${connector}${item.name} (${status})`;

  if (ancestors.has(item.name) || expanded.has(item.name)) {
    return [line];
  }

  expanded.add(item.name);

  const childPrefix = `${prefix}${isLast ? "   " : "|  "}`;
  const nextAncestors = new Set(ancestors);
  nextAncestors.add(item.name);
  const children = dependencyChildren(item, summary.analysis.itemMap);

  return [
    line,
    ...children.flatMap((child, index) =>
      formatTreeItem(
        child,
        summary,
        expanded,
        nextAncestors,
        childPrefix,
        index === children.length - 1,
      ),
    ),
  ];
};

export const formatDependencyTreeLines = (summary: SelectionSummary): readonly string[] => {
  if (summary.analysis.selectedItems.length === 0) {
    return ["No items selected for this profile/tag set."];
  }

  const roots = dependencyTreeRoots(summary);
  const expanded = new Set<string>();
  const treeLines = roots.flatMap((root, index) =>
    formatTreeItem(root, summary, expanded, new Set(), "", index === roots.length - 1),
  );

  return [`Dependency tree (${summary.analysis.selectedItems.length} items)`, ...treeLines];
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
