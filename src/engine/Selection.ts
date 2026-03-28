import type { SystemItem } from "../schema/config.js";

export interface SelectionOptions {
  readonly tags: readonly string[];
  readonly only: readonly string[];
}

const matchesFilters = (item: SystemItem, options: SelectionOptions): boolean => {
  if (options.only.length > 0) {
    const onlySet = new Set(options.only);
    if (!onlySet.has(item.name)) {
      return false;
    }
  }

  if (options.tags.length > 0) {
    const tagsSet = new Set(options.tags);
    if (!item.tags?.some((tag) => tagsSet.has(tag))) {
      return false;
    }
  }

  return true;
};

export const selectItems = (
  items: readonly SystemItem[],
  options: SelectionOptions,
): readonly SystemItem[] => {
  const filtered = items.filter((item) => matchesFilters(item, options));

  if (filtered.length === 0) {
    return filtered;
  }

  const itemMap = new Map(items.map((item) => [item.name, item]));
  const selectedNames = new Set(filtered.map((item) => item.name));
  const pending = [...filtered];

  while (pending.length > 0) {
    const item = pending.pop();
    if (!item?.dependsOn) {
      continue;
    }

    for (const dependencyName of item.dependsOn) {
      if (selectedNames.has(dependencyName)) {
        continue;
      }

      const dependency = itemMap.get(dependencyName);
      if (!dependency) {
        continue;
      }

      selectedNames.add(dependencyName);
      pending.push(dependency);
    }
  }

  return items.filter((item) => selectedNames.has(item.name));
};
