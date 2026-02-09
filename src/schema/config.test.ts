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
});
