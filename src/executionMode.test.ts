import { describe, expect, it } from "vitest";
import { resolveExecutionMode } from "./executionMode.js";

describe("resolveExecutionMode", () => {
  it("keeps local configs applying by default", () => {
    expect(
      resolveExecutionMode(
        { _tag: "local", path: "./system-config.json" },
        { dryRun: false, apply: false },
      ),
    ).toEqual({ _tag: "local_apply", dryRun: false });
  });

  it("defaults remote configs to preview mode", () => {
    expect(
      resolveExecutionMode(
        { _tag: "https", url: "https://example.com/system-config.json" },
        { dryRun: false, apply: false },
      ),
    ).toEqual({
      _tag: "remote_preview",
      dryRun: true,
      applyRequested: false,
    });
  });

  it("allows remote configs to apply only when --apply is present", () => {
    expect(
      resolveExecutionMode(
        { _tag: "https", url: "https://example.com/system-config.json" },
        { dryRun: false, apply: true },
      ),
    ).toEqual({ _tag: "remote_apply", dryRun: false });
  });

  it("keeps remote configs in preview when --dry-run is set", () => {
    expect(
      resolveExecutionMode(
        { _tag: "https", url: "https://example.com/system-config.json" },
        { dryRun: true, apply: true },
      ),
    ).toEqual({
      _tag: "remote_preview",
      dryRun: true,
      applyRequested: true,
    });
  });
});
