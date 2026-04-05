import { describe, expect, it } from "vitest";
import { Effect, Exit } from "effect";
import { defaultGitHubConfigPath, resolveConfigSource } from "./configSource.js";
import { ConfigError } from "./errors.js";

const githubShorthandExpectation = `Use "gh:owner/repo", "gh:owner/repo/path/to/config.json", or pin with "gh:owner/repo@<40-char-commit>[/path/to/config.json]". Bare repositories default to "${defaultGitHubConfigPath}" at repository HEAD.`;
const pinnedCommit = "0123456789abcdef0123456789abcdef01234567";
const integrityDigest = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const expectConfigError = async (sourceInput: string): Promise<ConfigError> => {
  const exit = await Effect.runPromiseExit(resolveConfigSource(sourceInput));

  expect(Exit.isFailure(exit)).toBe(true);

  if (!Exit.isFailure(exit)) {
    throw new Error("Expected config source resolution to fail");
  }

  expect(exit.cause._tag).toBe("Fail");

  if (exit.cause._tag !== "Fail") {
    throw new Error(`Expected a fail cause, received ${exit.cause._tag}`);
  }

  expect(exit.cause.error).toBeInstanceOf(ConfigError);

  if (!(exit.cause.error instanceof ConfigError)) {
    throw new Error("Expected a ConfigError");
  }

  return exit.cause.error;
};

describe("resolveConfigSource", () => {
  it("treats ordinary paths as local sources", async () => {
    await expect(Effect.runPromise(resolveConfigSource("./system-config.json"))).resolves.toEqual({
      _tag: "local",
      path: "./system-config.json",
    });
  });

  it("treats HTTPS URLs as remote sources", async () => {
    await expect(
      Effect.runPromise(resolveConfigSource("https://example.com/system-config.json")),
    ).resolves.toEqual({
      _tag: "https",
      url: "https://example.com/system-config.json",
    });
  });

  it("resolves bare GitHub shorthand to the repository root system config", async () => {
    await expect(
      Effect.runPromise(resolveConfigSource("gh:guilhermecastro/system-setup")),
    ).resolves.toEqual({
      _tag: "https",
      url: `https://raw.githubusercontent.com/guilhermecastro/system-setup/HEAD/${defaultGitHubConfigPath}`,
    });
  });

  it("resolves GitHub shorthand with an explicit config path", async () => {
    await expect(
      Effect.runPromise(resolveConfigSource("gh:guilhermecastro/system-setup/configs/work.json")),
    ).resolves.toEqual({
      _tag: "https",
      url: "https://raw.githubusercontent.com/guilhermecastro/system-setup/HEAD/configs/work.json",
    });
  });

  it("resolves pinned GitHub shorthand to the exact commit URL", async () => {
    await expect(
      Effect.runPromise(
        resolveConfigSource(`gh:guilhermecastro/system-setup@${pinnedCommit}/configs/work.json`),
      ),
    ).resolves.toEqual({
      _tag: "https",
      url: `https://raw.githubusercontent.com/guilhermecastro/system-setup/${pinnedCommit}/configs/work.json`,
      pin: {
        provider: "github",
        ref: pinnedCommit,
      },
    });
  });

  it("records remote integrity fragments without sending them to fetch", async () => {
    await expect(
      Effect.runPromise(
        resolveConfigSource(`https://example.com/system-config.json#sha256=${integrityDigest}`),
      ),
    ).resolves.toEqual({
      _tag: "https",
      url: "https://example.com/system-config.json",
      integrity: {
        algorithm: "sha256",
        expected: integrityDigest,
      },
    });
  });

  it("supports GitHub shorthand with both a commit pin and integrity metadata", async () => {
    await expect(
      Effect.runPromise(
        resolveConfigSource(
          `gh:guilhermecastro/system-setup@${pinnedCommit}#sha256=${integrityDigest}`,
        ),
      ),
    ).resolves.toEqual({
      _tag: "https",
      url: `https://raw.githubusercontent.com/guilhermecastro/system-setup/${pinnedCommit}/${defaultGitHubConfigPath}`,
      pin: {
        provider: "github",
        ref: pinnedCommit,
      },
      integrity: {
        algorithm: "sha256",
        expected: integrityDigest,
      },
    });
  });

  it("rejects GitHub shorthand that omits the repository name", async () => {
    const error = await expectConfigError("gh:guilhermecastro");

    expect(error.message).toBe(
      `Invalid GitHub config source: missing repository name after the owner. ${githubShorthandExpectation}`,
    );
    expect(error.path).toBe("gh:guilhermecastro");
  });

  it("rejects GitHub shorthand paths with trailing slashes", async () => {
    const error = await expectConfigError("gh:guilhermecastro/system-setup/");

    expect(error.message).toBe(
      `Invalid GitHub config source: file paths cannot contain empty segments or trailing slashes. ${githubShorthandExpectation}`,
    );
    expect(error.path).toBe("gh:guilhermecastro/system-setup/");
  });

  it("rejects mutable GitHub ref pins with actionable guidance", async () => {
    const error = await expectConfigError("gh:guilhermecastro/system-setup@main");

    expect(error.message).toBe(
      `Invalid GitHub config source: immutable GitHub pins must be full 40-character commit SHAs. Expected a Git commit SHA, observed "main". ${githubShorthandExpectation}`,
    );
    expect(error.path).toBe("gh:guilhermecastro/system-setup@main");
  });

  it("rejects invalid remote integrity fragments with expected-versus-observed guidance", async () => {
    const error = await expectConfigError("https://example.com/system-config.json#sha256=abc123");

    expect(error.message).toBe(
      'Invalid remote config integrity fragment: expected "#sha256=<64 hex characters>", observed "#sha256=abc123".',
    );
    expect(error.path).toBe("https://example.com/system-config.json#sha256=abc123");
  });

  it("rejects non-HTTPS URL protocols", async () => {
    const error = await expectConfigError("http://example.com/system-config.json");

    expect(error.message).toBe(
      'Unsupported config source protocol "http:". Only local paths, HTTPS URLs, and GitHub shorthand are supported',
    );
    expect(error.path).toBe("http://example.com/system-config.json");
  });
});
