import { describe, expect, it } from "vitest";
import {
  brewItem,
  dirItem,
  gitItem,
  normalizeSyntheticPath,
  runSyntheticScenario,
  shellItem,
  symlinkItem,
} from "../test/syntheticScenarioHarness.js";

const buildMixedSyntheticConfig = () =>
  [
    dirItem("home-dir", "~/Synthetic/home"),
    gitItem(
      "dotfiles",
      {
        repo: "https://github.com/example/dotfiles.git",
        path: "~/Synthetic/dotfiles",
      },
      {
        tags: ["shell"],
      },
    ),
    shellItem("ripgrep", "brew install ripgrep", {
      tags: ["cli"],
    }),
    brewItem(
      "bat",
      {
        formula: "bat",
      },
      {
        tags: ["cli"],
      },
    ),
    symlinkItem("tool-config", "~/Synthetic/home/.toolrc", "~/Synthetic/templates/toolrc", {
      dependsOn: ["home-dir"],
      tags: ["cli"],
    }),
    dirItem("ignored-docs", "~/Synthetic/docs", {
      tags: ["docs"],
    }),
  ] as const;

describe("execution scenarios", () => {
  it("runs a mixed synthetic config through selection, planning, preview, and apply", async () => {
    const items = buildMixedSyntheticConfig();
    const previewMachine = {
      fileSystem: {
        "~/Synthetic/home": { type: "Directory" },
        "~/Synthetic/templates/toolrc": { type: "File" },
      },
    } as const;
    const applyMachine = {
      fileSystem: {
        "~/Synthetic/templates/toolrc": { type: "File" },
      },
    } as const;

    const preview = await runSyntheticScenario({
      items,
      selection: { tags: ["cli", "shell"] },
      execution: { dryRun: true, verbose: true },
      machine: previewMachine,
    });

    expect(preview.executionMode).toEqual({
      _tag: "local_preview",
      dryRun: true,
    });
    expect(preview.selectedItems.map((item) => item.name)).toEqual([
      "home-dir",
      "dotfiles",
      "ripgrep",
      "bat",
      "tool-config",
    ]);
    expect(preview.plan.levels.map((level) => level.map((item) => item.name))).toEqual([
      ["home-dir", "dotfiles", "ripgrep", "bat"],
      ["tool-config"],
    ]);
    expect(preview.results.map((result) => [result.name, result.action, result.status])).toEqual([
      ["home-dir", "skipped", "installed"],
      ["dotfiles", "skipped", "missing"],
      ["ripgrep", "skipped", "missing"],
      ["bat", "skipped", "missing"],
      ["tool-config", "skipped", "missing"],
    ]);
    expect(preview.verbose).toContain(
      `[tool-config] would install: create symlink ${normalizeSyntheticPath("~/Synthetic/home/.toolrc")} -> ${normalizeSyntheticPath("~/Synthetic/templates/toolrc")}`,
    );
    expect(preview.snapshots.after).toEqual(preview.snapshots.before);

    const apply = await runSyntheticScenario({
      items,
      selection: { tags: ["cli", "shell"] },
      execution: { verbose: true },
      machine: applyMachine,
    });

    expect(apply.executionMode).toEqual({
      _tag: "local_apply",
      dryRun: false,
    });
    expect(apply.results.map((result) => [result.name, result.action, result.status])).toEqual([
      ["home-dir", "installed", "installed"],
      ["dotfiles", "installed", "installed"],
      ["ripgrep", "installed", "installed"],
      ["bat", "installed", "installed"],
      ["tool-config", "installed", "installed"],
    ]);
    expect(apply.machineState.installedItems).toEqual(new Set(["bat", "ripgrep"]));
    expect(apply.machineState.brewInstalled).toEqual(new Set(["bat"]));
    expect(apply.machineState.gitClones).toEqual([
      {
        repo: "https://github.com/example/dotfiles.git",
        path: normalizeSyntheticPath("~/Synthetic/dotfiles"),
      },
    ]);
    expect(
      apply.machineState.fileSystem.entries.get(normalizeSyntheticPath("~/Synthetic/home")),
    ).toEqual({
      type: "Directory",
    });
    expect(
      apply.machineState.fileSystem.entries.get(normalizeSyntheticPath("~/Synthetic/home/.toolrc")),
    ).toEqual({
      type: "SymbolicLink",
      target: normalizeSyntheticPath("~/Synthetic/templates/toolrc"),
    });
  });

  it("blocks only dependents when a prerequisite fails and keeps unrelated lanes running", async () => {
    const scenario = await runSyntheticScenario({
      items: [
        shellItem("bootstrap", "bootstrap install", {
          tags: ["target"],
        }),
        shellItem("dependent", "dependent install", {
          dependsOn: ["bootstrap"],
          tags: ["target"],
        }),
        dirItem("cache-dir", "~/Synthetic/cache"),
        symlinkItem(
          "cache-link",
          "~/Synthetic/home/cache-link",
          "~/Synthetic/templates/cache-target",
          {
            dependsOn: ["cache-dir"],
          },
        ),
      ],
      selection: { only: ["dependent", "cache-link"] },
      machine: {
        fileSystem: {
          "~/Synthetic/templates/cache-target": { type: "File" },
          "~/Synthetic/home": { type: "Directory" },
        },
        commandBehaviors: {
          "bootstrap install": {
            fail: {
              reason: "bootstrap registry unavailable",
              exitCode: 1,
            },
          },
          "dependent install": {
            installItems: ["dependent"],
          },
        },
      },
    });

    expect(scenario.selectedItems.map((item) => item.name)).toEqual([
      "bootstrap",
      "dependent",
      "cache-dir",
      "cache-link",
    ]);
    expect(scenario.plan.levels.map((level) => level.map((item) => item.name))).toEqual([
      ["bootstrap", "cache-dir"],
      ["dependent", "cache-link"],
    ]);
    expect(scenario.results.map((result) => [result.name, result.action, result.status])).toEqual([
      ["bootstrap", "failed", "error"],
      ["cache-dir", "installed", "installed"],
      ["dependent", "blocked", "blocked"],
      ["cache-link", "installed", "installed"],
    ]);
    expect(scenario.results[2]?.error).toContain("bootstrap");
    expect(scenario.machineState.installedItems.has("dependent")).toBe(false);
    expect(
      scenario.machineState.fileSystem.entries.get(
        normalizeSyntheticPath("~/Synthetic/home/cache-link"),
      ),
    ).toEqual({
      type: "SymbolicLink",
      target: normalizeSyntheticPath("~/Synthetic/templates/cache-target"),
    });
  });

  it("defaults remote sources to preview and only mutates state with explicit apply", async () => {
    const items = buildMixedSyntheticConfig();
    const source = {
      _tag: "https",
      url: "https://example.com/synthetic-config.json",
    } as const;
    const previewMachine = {
      fileSystem: {
        "~/Synthetic/home": { type: "Directory" },
        "~/Synthetic/templates/toolrc": { type: "File" },
      },
    } as const;
    const applyMachine = {
      fileSystem: {
        "~/Synthetic/templates/toolrc": { type: "File" },
      },
    } as const;

    const preview = await runSyntheticScenario({
      items,
      selection: { tags: ["cli", "shell"] },
      source,
      machine: previewMachine,
    });

    expect(preview.executionMode).toEqual({
      _tag: "remote_preview",
      dryRun: true,
      applyRequested: false,
    });
    expect(preview.snapshots.after).toEqual(preview.snapshots.before);
    expect(preview.machineState.installedItems.size).toBe(0);
    expect(
      preview.machineState.fileSystem.entries.has(
        normalizeSyntheticPath("~/Synthetic/home/.toolrc"),
      ),
    ).toBe(false);

    const apply = await runSyntheticScenario({
      items,
      selection: { tags: ["cli", "shell"] },
      source,
      execution: { apply: true },
      machine: applyMachine,
    });

    expect(apply.executionMode).toEqual({
      _tag: "remote_apply",
      dryRun: false,
    });
    expect(apply.machineState.installedItems).toEqual(new Set(["bat", "ripgrep"]));
    expect(apply.machineState.gitClones).toHaveLength(1);
    expect(
      apply.machineState.fileSystem.entries.has(normalizeSyntheticPath("~/Synthetic/home/.toolrc")),
    ).toBe(true);
  });
});
