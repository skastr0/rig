import { describe, expect, it } from "vitest";
import type { CliOptions } from "../cli.js";
import { getRunDisabledReason } from "./safety.js";

const baseOptions = {
  config: "./system-config.json",
  profile: undefined,
  ci: false,
  init: false,
  dryRun: false,
  apply: false,
  status: false,
  why: undefined,
  tags: [],
  only: [],
  verbose: false,
  update: false,
} satisfies CliOptions;

describe("interactive command safety", () => {
  it("disables TUI run when --dry-run is active", () => {
    expect(
      getRunDisabledReason(
        { _tag: "local", path: "./system-config.json" },
        { ...baseOptions, dryRun: true },
      ),
    ).toBe("--dry-run is active");
  });

  it("disables TUI run for remote configs without explicit --apply", () => {
    expect(
      getRunDisabledReason(
        { _tag: "https", url: "https://example.com/system-config.json" },
        baseOptions,
      ),
    ).toBe("remote source requires --apply");
  });

  it("enables TUI run for remote configs only after explicit --apply", () => {
    expect(
      getRunDisabledReason(
        { _tag: "https", url: "https://example.com/system-config.json" },
        { ...baseOptions, apply: true },
      ),
    ).toBeUndefined();
  });
});
