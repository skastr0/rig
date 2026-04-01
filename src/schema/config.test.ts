import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Effect, Exit, Schema } from "effect";
import { BrewInstall } from "./config.js";

const decodeBrewInstall = Schema.decodeUnknown(BrewInstall);

describe("BrewInstall schema", () => {
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
});
