import { describe, expect, it } from "vitest";
import { ConfigError, GitError, ValidationError } from "./errors.js";
import { formatError } from "./errorFormatting.js";

describe("formatError", () => {
  it("formats config errors with their path", () => {
    const error = new ConfigError({
      message: "Config file not found",
      path: "./system-config.json",
    });

    expect(formatError(error)).toBe(
      "Configuration error: Config file not found (./system-config.json)",
    );
  });

  it("formats validation errors as a multi-line issue list", () => {
    const error = new ValidationError({
      issues: ["Missing item name", "Invalid dependency"],
    });

    expect(formatError(error)).toBe("Validation error:\n  Missing item name\n  Invalid dependency");
  });

  it("formats optional command context for tool errors", () => {
    const error = new GitError({
      repo: "https://example.com/repo.git",
      reason: "clone failed",
      command: "git clone https://example.com/repo.git",
      exitCode: 128,
      stderr: "network unavailable",
    });

    expect(formatError(error)).toBe(
      "Git error for https://example.com/repo.git: clone failed\n  Command: git clone https://example.com/repo.git\n  Exit code: 128\n  network unavailable",
    );
  });
});
