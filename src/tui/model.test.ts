import { describe, expect, it } from "vitest";
import type { SystemItem } from "../schema/config.js";
import {
  buildProfileRows,
  buildTagRows,
  filterLogsByItem,
  formatReasonBadge,
  summarizeSelection,
} from "./model.js";

const makeItem = (
  name: string,
  options?: Partial<Pick<SystemItem, "dependsOn" | "profiles" | "tags">>,
): SystemItem => ({
  name,
  profiles: options?.profiles ?? ["macbook"],
  tags: options?.tags ?? ["base"],
  check: `which ${name}`,
  install: `brew install ${name}`,
  dependsOn: options?.dependsOn,
});

describe("TUI model", () => {
  it("builds profile rows from item profiles", () => {
    const rows = buildProfileRows([
      makeItem("homebrew", { profiles: ["macbook", "server-home"], tags: ["brew"] }),
      makeItem("continuwuity", { profiles: ["server-home"], tags: ["server", "matrix"] }),
    ]);

    expect(rows).toEqual([
      {
        name: "macbook",
        description: "1 item across 1 tag",
        itemCount: 1,
        tagCount: 1,
      },
      {
        name: "server-home",
        description: "2 items across 3 tags",
        itemCount: 2,
        tagCount: 3,
      },
    ]);
  });

  it("marks selected tag rows for the active profile", () => {
    const rows = buildTagRows(
      [
        makeItem("homebrew", { tags: ["brew"] }),
        makeItem("ripgrep", { tags: ["brew", "developer"] }),
      ],
      "macbook",
      new Set(["developer"]),
    );

    expect(rows).toEqual([
      { name: "brew", selected: false, itemCount: 2 },
      { name: "developer", selected: true, itemCount: 1 },
    ]);
  });

  it("summarizes direct, dependency, and cross-profile dependency counts", () => {
    const summary = summarizeSelection(
      [
        makeItem("tailscale", { profiles: ["macbook"], tags: ["network"] }),
        makeItem("continuwuity", {
          profiles: ["server-home"],
          tags: ["server"],
          dependsOn: ["tailscale"],
        }),
      ],
      "server-home",
      ["server"],
    );

    expect(summary.directCount).toBe(1);
    expect(summary.dependencyCount).toBe(1);
    expect(summary.crossProfileDependencyCount).toBe(1);
    expect(formatReasonBadge(summary.analysis.reasons.get("tailscale"))).toBe(
      "dependency / cross-profile",
    );
  });

  it("keeps global logs visible while filtering item-specific logs", () => {
    const logs = [
      { id: 1, kind: "system" as const, message: "started" },
      { id: 2, kind: "progress" as const, message: "homebrew skipped", itemName: "homebrew" },
      { id: 3, kind: "progress" as const, message: "ripgrep installed", itemName: "ripgrep" },
    ];

    expect(filterLogsByItem(logs, "ripgrep")).toEqual([logs[0], logs[2]]);
    expect(filterLogsByItem(logs, undefined)).toEqual(logs);
  });
});
