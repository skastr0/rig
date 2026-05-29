import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Effect, Exit, Schema } from "effect";
import { renderStarterConfig } from "../starterConfig.js";
import {
  BrewInstall,
  DirInstall,
  SkillsInstall,
  SymlinkInstall,
  SystemConfig,
  SystemItem,
} from "./config.js";

const decodeBrewInstall = Schema.decodeUnknown(BrewInstall);
const decodeDirInstall = Schema.decodeUnknown(DirInstall);
const decodeSkillsInstall = Schema.decodeUnknown(SkillsInstall);
const decodeSymlinkInstall = Schema.decodeUnknown(SymlinkInstall);
const decodeSystemConfig = Schema.decodeUnknown(SystemConfig);
const decodeSystemItem = Schema.decodeUnknown(SystemItem);

describe("config schema", () => {
  it("accepts formula installs", async () => {
    const parsed = await Effect.runPromise(
      decodeBrewInstall({
        source: "brew",
        formula: "neovim",
      }),
    );

    expect(parsed).toEqual({
      source: "brew",
      formula: "neovim",
    });
  });

  it("accepts cask installs", async () => {
    const parsed = await Effect.runPromise(
      decodeBrewInstall({
        source: "brew",
        cask: "firefox",
      }),
    );

    expect(parsed).toEqual({
      source: "brew",
      cask: "firefox",
    });
  });

  it("accepts formula installs with tap and args", async () => {
    const parsed = await Effect.runPromise(
      decodeBrewInstall({
        source: "brew",
        formula: "custom/tap/formula",
        tap: "custom/tap",
        args: ["--HEAD"],
      }),
    );

    expect(parsed).toEqual({
      source: "brew",
      formula: "custom/tap/formula",
      tap: "custom/tap",
      args: ["--HEAD"],
    });
  });

  it("accepts dir installs", async () => {
    const parsed = await Effect.runPromise(
      decodeDirInstall({
        source: "dir",
        path: "~/.config",
      }),
    );

    expect(parsed).toEqual({
      source: "dir",
      path: "~/.config",
    });
  });

  it("accepts symlink installs", async () => {
    const parsed = await Effect.runPromise(
      decodeSymlinkInstall({
        source: "symlink",
        path: "~/.zshrc",
        target: "~/.dotfiles/.zshrc",
      }),
    );

    expect(parsed).toEqual({
      source: "symlink",
      path: "~/.zshrc",
      target: "~/.dotfiles/.zshrc",
    });
  });

  it("accepts skills installs with multiple skills and agents", async () => {
    const parsed = await Effect.runPromise(
      decodeSkillsInstall({
        source: "skills",
        package: "skills@1.5.1",
        repo: "vercel-labs/agent-skills",
        ref: "0123456789abcdef0123456789abcdef01234567",
        skills: ["frontend-design", "skill-creator"],
        agents: ["codex", "opencode"],
        mode: "copy",
      }),
    );

    expect(parsed).toEqual({
      source: "skills",
      package: "skills@1.5.1",
      repo: "vercel-labs/agent-skills",
      ref: "0123456789abcdef0123456789abcdef01234567",
      skills: ["frontend-design", "skill-creator"],
      agents: ["codex", "opencode"],
      mode: "copy",
    });
  });

  it("allows managed skills installs to omit check", async () => {
    const parsed = await Effect.runPromise(
      decodeSystemItem({
        name: "agent-skills",
        profiles: ["macbook"],
        tags: ["ai", "skills"],
        install: {
          source: "skills",
          package: "skills@1.5.1",
          repo: "vercel-labs/agent-skills",
          ref: "0123456789abcdef0123456789abcdef01234567",
          skills: ["frontend-design"],
          agents: ["codex"],
        },
      }),
    );

    expect(parsed).toEqual({
      name: "agent-skills",
      profiles: ["macbook"],
      tags: ["ai", "skills"],
      install: {
        source: "skills",
        package: "skills@1.5.1",
        repo: "vercel-labs/agent-skills",
        ref: "0123456789abcdef0123456789abcdef01234567",
        skills: ["frontend-design"],
        agents: ["codex"],
      },
    });
  });

  it("accepts per-item timeout values", async () => {
    const parsed = await Effect.runPromise(
      decodeSystemItem({
        name: "neovim",
        profiles: ["macbook"],
        tags: ["editor", "dev"],
        check: "which nvim",
        install: "brew install neovim",
        timeout: 5_000,
      }),
    );

    expect(parsed).toEqual({
      name: "neovim",
      profiles: ["macbook"],
      tags: ["editor", "dev"],
      check: "which nvim",
      install: "brew install neovim",
      timeout: 5_000,
    });
  });

  it("renders the canonical starter config as readable JSON", async () => {
    const starterConfig = await Effect.runPromise(renderStarterConfig());

    expect(starterConfig).toBe(
      `{\n  "items": [\n    {\n      "name": "neovim",\n      "profiles": [\n        "macbook"\n      ],\n      "tags": [\n        "editor",\n        "dev"\n      ],\n      "check": "which nvim",\n      "install": "brew install neovim",\n      "group": "brew"\n    }\n  ]\n}\n`,
    );
  });

  it("starter config output validates against the current schema", async () => {
    const starterConfig = await Effect.runPromise(renderStarterConfig());
    const parsed = JSON.parse(starterConfig) as unknown;

    const decoded = await Effect.runPromise(decodeSystemConfig(parsed));

    expect(decoded).toEqual(parsed);
  });

  it("rejects installs without formula or cask", async () => {
    const exit = await Effect.runPromiseExit(
      decodeBrewInstall({
        source: "brew",
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("rejects installs with both formula and cask", async () => {
    const exit = await Effect.runPromiseExit(
      decodeBrewInstall({
        source: "brew",
        formula: "x",
        cask: "y",
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("rejects unmanaged installs without check", async () => {
    const exit = await Effect.runPromiseExit(
      decodeSystemItem({
        name: "neovim",
        profiles: ["macbook"],
        tags: ["editor", "dev"],
        install: "brew install neovim",
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("rejects skills installs without skills or agents", async () => {
    const exit = await Effect.runPromiseExit(
      decodeSkillsInstall({
        source: "skills",
        package: "skills@1.5.1",
        repo: "vercel-labs/agent-skills",
        ref: "0123456789abcdef0123456789abcdef01234567",
        skills: [],
        agents: [],
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("default config avoids redundant global mise install chains", () => {
    const rawConfig = readFileSync(new URL("../../system-config.json", import.meta.url), "utf8");
    const config = JSON.parse(rawConfig) as {
      items: Array<{
        name: string;
        install: unknown;
        check: string;
        update?: unknown;
      }>;
    };

    const commands = config.items.flatMap((item) =>
      [item.install, item.update].filter((value): value is string => typeof value === "string"),
    );

    expect(commands.some((command) => /mise use -g\b.*&& mise install\b/.test(command))).toBe(
      false,
    );
  });

  it("default config verifies active PATH binaries for mise-managed installs", () => {
    const rawConfig = readFileSync(new URL("../../system-config.json", import.meta.url), "utf8");
    const config = JSON.parse(rawConfig) as {
      items: Array<{
        name: string;
        install: unknown;
        check: string;
      }>;
    };

    const miseManagedItems = config.items.filter(
      (item) =>
        typeof item.install === "string" &&
        item.install.includes("mise use -g") &&
        !item.install.includes("--remove"),
    );

    expect(miseManagedItems.length).toBeGreaterThan(0);

    for (const item of miseManagedItems) {
      expect(item.check, `${item.name} should validate the active PATH binary`).toContain(
        "mise which",
      );
      expect(item.check, `${item.name} should compare command resolution`).toContain("command -v");
    }
  });

  it("default config uses dir sources for bootstrap directories", () => {
    const rawConfig = readFileSync(new URL("../../system-config.json", import.meta.url), "utf8");
    const config = JSON.parse(rawConfig) as {
      items: Array<{
        name: string;
        install: unknown;
      }>;
    };

    const bootstrapItems = config.items.filter(
      (item) => item.name === "projects-root" || item.name === "config-root",
    );

    expect(bootstrapItems).toHaveLength(2);
    expect(bootstrapItems.every((item) => typeof item.install === "object")).toBe(true);
    expect(
      bootstrapItems.every(
        (item) =>
          typeof item.install === "object" &&
          item.install !== null &&
          "source" in item.install &&
          item.install.source === "dir",
      ),
    ).toBe(true);
  });
});
