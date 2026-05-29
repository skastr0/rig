import type { SystemItem } from "../schema/config.js";

export interface SelectionOptions {
  readonly profile: string;
  readonly tags: readonly string[];
  readonly only: readonly string[];
}

export interface DirectSelectionReason {
  readonly type: "direct";
  readonly profile: string;
  readonly matchedOnly: boolean;
  readonly matchedTags: readonly string[];
}

export interface DependencySelectionReason {
  readonly type: "dependency";
  readonly rootProfile: string;
  readonly path: readonly string[];
  readonly crossesProfile: boolean;
}

export type SelectionReason = DirectSelectionReason | DependencySelectionReason;

export interface SelectionAnalysis {
  readonly itemMap: ReadonlyMap<string, SystemItem>;
  readonly matchedNames: ReadonlySet<string>;
  readonly options: SelectionOptions;
  readonly reasons: ReadonlyMap<string, SelectionReason>;
  readonly selectedItems: readonly SystemItem[];
  readonly selectedNames: ReadonlySet<string>;
}

interface PendingSelection {
  readonly item: SystemItem;
  readonly path: readonly string[];
  readonly rootProfile: string;
}

const getDirectSelectionReason = (
  item: SystemItem,
  options: SelectionOptions,
): DirectSelectionReason | undefined => {
  if (!item.profiles.includes(options.profile)) {
    return undefined;
  }

  const onlyMatched = options.only.length === 0 || options.only.includes(item.name);
  if (!onlyMatched) {
    return undefined;
  }

  const matchedTags =
    options.tags.length === 0 ? [] : item.tags.filter((tag) => options.tags.includes(tag));

  if (options.tags.length > 0 && matchedTags.length === 0) {
    return undefined;
  }

  return {
    type: "direct",
    profile: options.profile,
    matchedOnly: options.only.includes(item.name),
    matchedTags,
  };
};

const collectDirectSelections = (
  items: readonly SystemItem[],
  options: SelectionOptions,
): {
  readonly matchedNames: Set<string>;
  readonly pending: PendingSelection[];
  readonly reasons: Map<string, SelectionReason>;
} => {
  const matchedNames = new Set<string>();
  const reasons = new Map<string, SelectionReason>();
  const pending: PendingSelection[] = [];

  for (const item of items) {
    const reason = getDirectSelectionReason(item, options);
    if (!reason) {
      continue;
    }

    matchedNames.add(item.name);
    reasons.set(item.name, reason);
    pending.push({ item, path: [item.name], rootProfile: options.profile });
  }

  return { matchedNames, pending, reasons };
};

const expandDependencySelections = (
  pending: PendingSelection[],
  itemMap: ReadonlyMap<string, SystemItem>,
  selectedNames: Set<string>,
  reasons: Map<string, SelectionReason>,
): void => {
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current?.item.dependsOn) {
      continue;
    }

    for (const dependencyName of current.item.dependsOn) {
      if (selectedNames.has(dependencyName)) {
        continue;
      }

      const dependency = itemMap.get(dependencyName);
      if (!dependency) {
        continue;
      }

      const dependencyPath = [...current.path, dependencyName];

      selectedNames.add(dependencyName);
      reasons.set(dependencyName, {
        type: "dependency",
        rootProfile: current.rootProfile,
        path: dependencyPath,
        crossesProfile: !dependency.profiles.includes(current.rootProfile),
      });
      pending.push({ item: dependency, path: dependencyPath, rootProfile: current.rootProfile });
    }
  }
};

export const collectAvailableProfiles = (items: readonly SystemItem[]): readonly string[] =>
  [...new Set(items.flatMap((item) => item.profiles))].sort();

export const collectAvailableTags = (
  items: readonly SystemItem[],
  profile?: string,
): readonly string[] =>
  [
    ...new Set(
      items
        .filter((item) => profile === undefined || item.profiles.includes(profile))
        .flatMap((item) => item.tags),
    ),
  ].sort();

export const analyzeSelection = (
  items: readonly SystemItem[],
  options: SelectionOptions,
): SelectionAnalysis => {
  const itemMap = new Map(items.map((item) => [item.name, item]));
  const directSelections = collectDirectSelections(items, options);

  if (directSelections.pending.length === 0) {
    return {
      itemMap,
      matchedNames: directSelections.matchedNames,
      options,
      reasons: directSelections.reasons,
      selectedItems: [],
      selectedNames: new Set<string>(),
    };
  }

  const selectedNames = new Set(directSelections.matchedNames);
  expandDependencySelections(
    directSelections.pending,
    itemMap,
    selectedNames,
    directSelections.reasons,
  );

  return {
    itemMap,
    matchedNames: directSelections.matchedNames,
    options,
    reasons: directSelections.reasons,
    selectedItems: items.filter((item) => selectedNames.has(item.name)),
    selectedNames,
  };
};

export const selectItems = (
  items: readonly SystemItem[],
  options: SelectionOptions,
): readonly SystemItem[] => analyzeSelection(items, options).selectedItems;
