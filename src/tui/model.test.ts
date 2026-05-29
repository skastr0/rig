import { describe, expect, it } from "vitest";
import type { SystemItem } from "../schema/config.js";
import {
  buildProfileRows,
  buildTagRows,
  filterOptions,
  filterLogsByItem,
  formatDependencyTreeLines,
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

  it("summarizes direct and dependency counts for a profile", () => {
    const summary = summarizeSelection(
      [
        makeItem("tailscale", { profiles: ["macbook", "server-home"], tags: ["network"] }),
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
    expect(formatReasonBadge(summary.analysis.reasons.get("tailscale"))).toBe("dependency");
  });

  it("applies --only as part of interactive summaries", () => {
    const summary = summarizeSelection(
      [
        makeItem("homebrew", { tags: ["brew"] }),
        makeItem("ripgrep", { tags: ["brew", "dev"], dependsOn: ["homebrew"] }),
        makeItem("ffmpeg", { tags: ["brew", "media"], dependsOn: ["homebrew"] }),
      ],
      "macbook",
      ["brew"],
      ["ripgrep"],
    );

    expect(summary.analysis.selectedItems.map((item) => item.name)).toEqual([
      "homebrew",
      "ripgrep",
    ]);
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

  it("filters selector options by name or description", () => {
    const options = [
      { name: "macbook", description: "Daily workstation" },
      { name: "server-home", description: "Matrix services" },
    ];

    expect(filterOptions(options, "matrix")).toEqual([options[1]]);
    expect(filterOptions(options, "MAC")).toEqual([options[0]]);
    expect(filterOptions(options, "")).toEqual(options);
  });

  it("formats selected items as a dependency tree", () => {
    const summary = summarizeSelection(
      [
        makeItem("homebrew", { profiles: ["server-home"], tags: ["brew"] }),
        makeItem("orbstack", {
          profiles: ["server-home"],
          tags: ["containers"],
          dependsOn: ["homebrew"],
        }),
        makeItem("tailscale", {
          profiles: ["server-home"],
          tags: ["networking"],
          dependsOn: ["homebrew"],
        }),
        makeItem("continuwuity", {
          profiles: ["server-home"],
          tags: ["server"],
          dependsOn: ["orbstack", "tailscale"],
        }),
      ],
      "server-home",
      ["server"],
    );

    expect(formatDependencyTreeLines(summary)).toEqual([
      "Dependency tree (4 items)",
      "\\- continuwuity (direct)",
      "   +- orbstack (dependency)",
      "   |  \\- homebrew (dependency)",
      "   \\- tailscale (dependency)",
      "      \\- homebrew (shared)",
    ]);
  });
});
