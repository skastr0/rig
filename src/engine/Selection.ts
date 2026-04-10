import type { SystemItem } from "../schema/config.js";

export interface SelectionOptions {
  readonly tags: readonly string[];
  readonly only: readonly string[];
}

export interface DefaultSelectionReason {
  readonly type: "default";
}

export interface FilterSelectionReason {
  readonly type: "filter";
  readonly onlyMatched: boolean;
  readonly matchedTags: readonly string[];
}

export interface DependencySelectionReason {
  readonly type: "dependency";
  readonly path: readonly string[];
}

export type SelectionReason =
  | DefaultSelectionReason
  | FilterSelectionReason
  | DependencySelectionReason;

export interface SelectionAnalysis {
  readonly itemMap: ReadonlyMap<string, SystemItem>;
  readonly matchedNames: ReadonlySet<string>;
  readonly options: SelectionOptions;
  readonly reasons: ReadonlyMap<string, SelectionReason>;
  readonly selectedItems: readonly SystemItem[];
  readonly selectedNames: ReadonlySet<string>;
}

const getDirectSelectionReason = (
  item: SystemItem,
  options: SelectionOptions,
): DefaultSelectionReason | FilterSelectionReason | undefined => {
  if (options.only.length === 0 && options.tags.length === 0) {
    return { type: "default" };
  }

  const onlyMatched = options.only.length === 0 || options.only.includes(item.name);
  if (!onlyMatched) {
    return undefined;
  }

  const matchedTags =
    options.tags.length === 0 ? [] : (item.tags ?? []).filter((tag) => options.tags.includes(tag));

  if (options.tags.length > 0 && matchedTags.length === 0) {
    return undefined;
  }

  return {
    type: "filter",
    onlyMatched: options.only.includes(item.name),
    matchedTags,
  };
};

export const analyzeSelection = (
  items: readonly SystemItem[],
  options: SelectionOptions,
): SelectionAnalysis => {
  const itemMap = new Map(items.map((item) => [item.name, item]));
  const matchedNames = new Set<string>();
  const reasons = new Map<string, SelectionReason>();
  const pending: Array<{ readonly item: SystemItem; readonly path: readonly string[] }> = [];

  for (const item of items) {
    const reason = getDirectSelectionReason(item, options);
    if (!reason) {
      continue;
    }

    matchedNames.add(item.name);
    reasons.set(item.name, reason);
    pending.push({ item, path: [item.name] });
  }

  if (pending.length === 0) {
    return {
      itemMap,
      matchedNames,
      options,
      reasons,
      selectedItems: [],
      selectedNames: new Set<string>(),
    };
  }

  const selectedNames = new Set(matchedNames);

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
        path: dependencyPath,
      });
      pending.push({ item: dependency, path: dependencyPath });
    }
  }

  return {
    itemMap,
    matchedNames,
    options,
    reasons,
    selectedItems: items.filter((item) => selectedNames.has(item.name)),
    selectedNames,
  };
};

export const selectItems = (
  items: readonly SystemItem[],
  options: SelectionOptions,
): readonly SystemItem[] => analyzeSelection(items, options).selectedItems;
