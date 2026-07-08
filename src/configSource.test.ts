import * as Path from "node:path";
import { describe, expect, it } from "vitest";
import { Effect, Exit, Layer } from "effect";
import { FileSystem } from "@effect/platform";
import {
  defaultConfigFileName,
  defaultGitHubConfigPath,
  discoverDefaultConfigSource,
  loadUserDefaultSource,
  resolveConfigSource,
  resolveConfiguredSource,
  userConfigPath,
} from "./configSource.js";
import { ConfigError } from "./errors.js";

const githubShorthandExpectation = `Use "gh:owner/repo", "gh:owner/repo/path/to/config.json", or pin with "gh:owner/repo@<40-char-commit>[/path/to/config.json]". Bare repositories default to "${defaultGitHubConfigPath}" at repository HEAD. Private repos load via authenticated \`gh api\` when the GitHub CLI is available.`;
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

const createMockFileSystem = (
  existingPaths: ReadonlySet<string>,
  files: Record<string, string> = {},
) =>
  ({
    exists: (path: string) => Effect.succeed(existingPaths.has(path)),
    readFileString: (path: string) => {
      const content = files[path];
      return content === undefined
        ? Effect.fail(new Error(`Missing file: ${path}`))
        : Effect.succeed(content);
    },
  }) as unknown as FileSystem.FileSystem;

const runDiscovery = (startDir: string, homeDir: string, existingPaths: readonly string[]) =>
  discoverDefaultConfigSource(startDir, homeDir).pipe(
    Effect.provide(
      Layer.succeed(FileSystem.FileSystem, createMockFileSystem(new Set(existingPaths))),
    ),
  );

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

  it("resolves bare GitHub shorthand to a github source with raw fallback URL", async () => {
    await expect(Effect.runPromise(resolveConfigSource("gh:guilhermecastro/rig"))).resolves.toEqual(
      {
        _tag: "github",
        owner: "guilhermecastro",
        repo: "rig",
        path: defaultGitHubConfigPath,
        ref: "HEAD",
        rawUrl: `https://raw.githubusercontent.com/guilhermecastro/rig/HEAD/${defaultGitHubConfigPath}`,
      },
    );
  });

  it("resolves GitHub shorthand with an explicit config path", async () => {
    await expect(
      Effect.runPromise(resolveConfigSource("gh:guilhermecastro/rig/configs/work.json")),
    ).resolves.toEqual({
      _tag: "github",
      owner: "guilhermecastro",
      repo: "rig",
      path: "configs/work.json",
      ref: "HEAD",
      rawUrl: "https://raw.githubusercontent.com/guilhermecastro/rig/HEAD/configs/work.json",
    });
  });

  it("resolves pinned GitHub shorthand to the exact commit URL", async () => {
    await expect(
      Effect.runPromise(
        resolveConfigSource(`gh:guilhermecastro/rig@${pinnedCommit}/configs/work.json`),
      ),
    ).resolves.toEqual({
      _tag: "github",
      owner: "guilhermecastro",
      repo: "rig",
      path: "configs/work.json",
      ref: pinnedCommit,
      rawUrl: `https://raw.githubusercontent.com/guilhermecastro/rig/${pinnedCommit}/configs/work.json`,
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
        resolveConfigSource(`gh:guilhermecastro/rig@${pinnedCommit}#sha256=${integrityDigest}`),
      ),
    ).resolves.toEqual({
      _tag: "github",
      owner: "guilhermecastro",
      repo: "rig",
      path: defaultGitHubConfigPath,
      ref: pinnedCommit,
      rawUrl: `https://raw.githubusercontent.com/guilhermecastro/rig/${pinnedCommit}/${defaultGitHubConfigPath}`,
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
    const error = await expectConfigError("gh:guilhermecastro/rig/");

    expect(error.message).toContain("file paths cannot contain empty segments");
    expect(error.code).toBe("source_invalid");
    expect(error.path).toBe("gh:guilhermecastro/rig/");
  });

  it("rejects GitHub shorthand paths with .. segments", async () => {
    const error = await expectConfigError("gh:guilhermecastro/rig/../secret.json");

    expect(error.message).toContain('".."');
    expect(error.code).toBe("source_invalid");
  });

  it("rejects mutable GitHub ref pins with actionable guidance", async () => {
    const error = await expectConfigError("gh:guilhermecastro/rig@main");

    expect(error.message).toBe(
      `Invalid GitHub config source: immutable GitHub pins must be full 40-character commit SHAs. Expected a Git commit SHA, observed "main". ${githubShorthandExpectation}`,
    );
    expect(error.path).toBe("gh:guilhermecastro/rig@main");
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

describe("discoverDefaultConfigSource", () => {
  it("finds system-config.json in the starting directory", async () => {
    const startDir = "/Users/demo/project";
    const configPath = Path.join(startDir, defaultConfigFileName);

    await expect(
      Effect.runPromise(runDiscovery(startDir, "/Users/demo", [configPath])),
    ).resolves.toEqual({
      _tag: "local",
      path: configPath,
    });
  });

  it("walks up parent directories until it finds system-config.json", async () => {
    const startDir = "/Users/demo/project/packages/app";
    const parentConfig = Path.join("/Users/demo/project", defaultConfigFileName);

    await expect(
      Effect.runPromise(runDiscovery(startDir, "/Users/demo", [parentConfig])),
    ).resolves.toEqual({
      _tag: "local",
      path: parentConfig,
    });
  });

  it("falls back to ~/system-config.json when walk-up finds nothing", async () => {
    const startDir = "/tmp/work";
    const homeDir = "/Users/demo";
    const homeConfig = Path.join(homeDir, defaultConfigFileName);

    await expect(Effect.runPromise(runDiscovery(startDir, homeDir, [homeConfig]))).resolves.toEqual(
      {
        _tag: "local",
        path: homeConfig,
      },
    );
  });

  it("fails when neither walk-up nor home contains the config", async () => {
    const startDir = "/tmp/work";
    const exit = await Effect.runPromiseExit(runDiscovery(startDir, "/Users/demo", []));

    expect(Exit.isFailure(exit)).toBe(true);
    if (!Exit.isFailure(exit) || exit.cause._tag !== "Fail") {
      throw new Error("Expected discovery failure");
    }

    expect(exit.cause.error).toBeInstanceOf(ConfigError);
    if (!(exit.cause.error instanceof ConfigError)) {
      throw new Error("Expected ConfigError");
    }

    expect(exit.cause.error.message).toContain("walked up from");
    expect(exit.cause.error.message).toContain(defaultConfigFileName);
    expect(exit.cause.error.message).toContain(Path.join("/Users/demo", defaultConfigFileName));
    expect(exit.cause.error.message).toContain(userConfigPath("/Users/demo"));
    expect(exit.cause.error.code).toBe("discovery_failed");
  });
});

describe("user config defaultSource", () => {
  it("loads defaultSource from ~/.rig/config.json", async () => {
    const homeDir = "/Users/demo";
    const path = userConfigPath(homeDir);

    await expect(
      Effect.runPromise(
        loadUserDefaultSource(homeDir).pipe(
          Effect.provide(
            Layer.succeed(
              FileSystem.FileSystem,
              createMockFileSystem(new Set([path]), {
                [path]: JSON.stringify({ defaultSource: "gh:skastr0/rig-system-config" }),
              }),
            ),
          ),
        ),
      ),
    ).resolves.toBe("gh:skastr0/rig-system-config");
  });

  it("prefers user defaultSource over walk-up discovery", async () => {
    const homeDir = "/Users/demo";
    const path = userConfigPath(homeDir);
    const localConfig = Path.join("/tmp/work", defaultConfigFileName);

    await expect(
      Effect.runPromise(
        resolveConfiguredSource(undefined, homeDir).pipe(
          Effect.provide(
            Layer.succeed(
              FileSystem.FileSystem,
              createMockFileSystem(new Set([path, localConfig]), {
                [path]: JSON.stringify({ defaultSource: "gh:skastr0/rig-system-config" }),
                [localConfig]: "{}",
              }),
            ),
          ),
        ),
      ),
    ).resolves.toMatchObject({
      _tag: "github",
      owner: "skastr0",
      repo: "rig-system-config",
    });
  });
});
