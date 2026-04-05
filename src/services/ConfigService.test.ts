import { createHash } from "node:crypto";
import { describe, expect, it, afterEach, vi } from "vitest";
import { Effect, Exit, Layer } from "effect";
import { FileSystem } from "@effect/platform";
import { ConfigService, ConfigServiceLive } from "./ConfigService.js";
import type { ConfigSource } from "../configSource.js";
import { ConfigError } from "../errors.js";

const pinnedCommit = "0123456789abcdef0123456789abcdef01234567";
const malformedPinnedCommit = "not-a-40-char-commit";

const sha256Digest = (content: string): string =>
  createHash("sha256").update(content).digest("hex");

const createMockFileSystem = (files: Record<string, string> = {}): FileSystem.FileSystem =>
  ({
    exists: (path: string) => Effect.succeed(Object.prototype.hasOwnProperty.call(files, path)),
    readFileString: (path: string) => {
      const content = files[path];

      return content === undefined
        ? Effect.fail(new Error(`Missing file: ${path}`))
        : Effect.succeed(content);
    },
  }) as unknown as FileSystem.FileSystem;

const loadConfig = (source: ConfigSource, files: Record<string, string> = {}, profile?: string) =>
  Effect.gen(function* () {
    const configService = yield* ConfigService;
    return yield* configService.load(source, profile);
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.succeed(FileSystem.FileSystem, createMockFileSystem(files)),
        ConfigServiceLive,
      ),
    ),
  );

const expectConfigError = async (
  effect: Effect.Effect<unknown, ConfigError, never>,
  assertion: (error: ConfigError) => void,
): Promise<void> => {
  const exit = await Effect.runPromiseExit(effect);

  expect(Exit.isFailure(exit)).toBe(true);

  if (!Exit.isFailure(exit)) {
    return;
  }

  const error = exit.cause;

  expect(error._tag).toBe("Fail");

  if (error._tag !== "Fail") {
    return;
  }

  expect(error.error).toBeInstanceOf(ConfigError);

  if (error.error instanceof ConfigError) {
    assertion(error.error);
  }
};

describe("ConfigService", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("loads local config sources", async () => {
    const result = await Effect.runPromise(
      loadConfig(
        { _tag: "local", path: "./system-config.json" },
        {
          "./system-config.json": JSON.stringify({
            items: [{ name: "neovim", check: "which nvim", install: "brew install neovim" }],
          }),
        },
      ),
    );

    expect(result.items).toEqual([
      { name: "neovim", check: "which nvim", install: "brew install neovim" },
    ]);
  });

  it("loads remote HTTPS config sources", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [{ name: "ripgrep", check: "which rg", install: "brew install ripgrep" }],
        }),
        { status: 200 },
      ),
    );

    vi.stubGlobal("fetch", fetchMock);

    const result = await Effect.runPromise(
      loadConfig({ _tag: "https", url: "https://example.com/system-config.json" }),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/system-config.json",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result.items).toEqual([
      { name: "ripgrep", check: "which rg", install: "brew install ripgrep" },
    ]);
  });

  it("loads pinned remote configs and verifies integrity when requested", async () => {
    const remoteConfig = JSON.stringify({
      items: [{ name: "fd", check: "which fd", install: "brew install fd" }],
    });

    const fetchMock = vi.fn().mockResolvedValue(new Response(remoteConfig, { status: 200 }));

    vi.stubGlobal("fetch", fetchMock);

    const result = await Effect.runPromise(
      loadConfig({
        _tag: "https",
        url: `https://raw.githubusercontent.com/guilhermecastro/system-setup/${pinnedCommit}/system-config.json`,
        pin: {
          provider: "github",
          ref: pinnedCommit,
        },
        integrity: {
          algorithm: "sha256",
          expected: sha256Digest(remoteConfig),
        },
      }),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      `https://raw.githubusercontent.com/guilhermecastro/system-setup/${pinnedCommit}/system-config.json`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result.items).toEqual([{ name: "fd", check: "which fd", install: "brew install fd" }]);
  });

  it("reports remote network failures clearly", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network unavailable")));

    await expectConfigError(
      loadConfig({ _tag: "https", url: "https://example.com/system-config.json" }),
      (error) => {
        expect(error.message).toBe("Failed to fetch remote config: network unavailable");
        expect(error.path).toBe("https://example.com/system-config.json");
      },
    );
  });

  it("rejects invalid JSON from remote sources", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{invalid", { status: 200 })));

    await expectConfigError(
      loadConfig({ _tag: "https", url: "https://example.com/system-config.json" }),
      (error) => {
        expect(error.message).toBe("Invalid JSON in remote config");
        expect(error.path).toBe("https://example.com/system-config.json");
      },
    );
  });

  it("fails closed when remote config integrity does not match", async () => {
    const remoteConfig = JSON.stringify({
      items: [{ name: "ripgrep", check: "which rg", install: "brew install ripgrep" }],
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(remoteConfig, { status: 200 })));

    await expectConfigError(
      loadConfig({
        _tag: "https",
        url: "https://example.com/system-config.json",
        integrity: {
          algorithm: "sha256",
          expected: `${"0".repeat(64)}`,
        },
      }),
      (error) => {
        expect(error.message).toBe(
          `Remote config integrity mismatch: expected sha256:${"0".repeat(64)}, observed sha256:${sha256Digest(remoteConfig)}`,
        );
        expect(error.path).toBe("https://example.com/system-config.json");
      },
    );
  });

  it("surfaces stale pinned GitHub refs with expected-versus-observed status", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response("Not Found", { status: 404, statusText: "Not Found" })),
    );

    await expectConfigError(
      loadConfig({
        _tag: "https",
        url: `https://raw.githubusercontent.com/guilhermecastro/system-setup/${pinnedCommit}/system-config.json`,
        pin: {
          provider: "github",
          ref: pinnedCommit,
        },
      }),
      (error) => {
        expect(error.message).toBe(
          `Pinned remote config could not be resolved: expected GitHub commit ${pinnedCommit}, observed HTTP 404 Not Found`,
        );
        expect(error.path).toBe(
          `https://raw.githubusercontent.com/guilhermecastro/system-setup/${pinnedCommit}/system-config.json`,
        );
      },
    );
  });

  it("surfaces malformed pinned GitHub refs with expected-versus-observed status", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response("Bad Request", { status: 400, statusText: "Bad Request" })),
    );

    await expectConfigError(
      loadConfig({
        _tag: "https",
        url: `https://raw.githubusercontent.com/guilhermecastro/system-setup/${malformedPinnedCommit}/system-config.json`,
        pin: {
          provider: "github",
          ref: malformedPinnedCommit,
        },
      }),
      (error) => {
        expect(error.message).toBe(
          `Pinned remote config could not be resolved: expected GitHub commit ${malformedPinnedCommit}, observed HTTP 400 Bad Request`,
        );
        expect(error.path).toBe(
          `https://raw.githubusercontent.com/guilhermecastro/system-setup/${malformedPinnedCommit}/system-config.json`,
        );
      },
    );
  });

  it("surfaces pinned non-404 HTTP failures with expected-versus-observed status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("Service Unavailable", {
          status: 503,
          statusText: "Service Unavailable",
        }),
      ),
    );

    await expectConfigError(
      loadConfig({
        _tag: "https",
        url: `https://raw.githubusercontent.com/guilhermecastro/system-setup/${pinnedCommit}/system-config.json`,
        pin: {
          provider: "github",
          ref: pinnedCommit,
        },
      }),
      (error) => {
        expect(error.message).toBe(
          `Pinned remote config could not be resolved: expected GitHub commit ${pinnedCommit}, observed HTTP 503 Service Unavailable`,
        );
        expect(error.path).toBe(
          `https://raw.githubusercontent.com/guilhermecastro/system-setup/${pinnedCommit}/system-config.json`,
        );
      },
    );
  });

  it("rejects schema-invalid remote configs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [{}] }), { status: 200 })),
    );

    await expectConfigError(
      loadConfig({ _tag: "https", url: "https://example.com/system-config.json" }),
      (error) => {
        expect(error.message).toContain("Schema validation failed:");
        expect(error.path).toBe("https://example.com/system-config.json");
      },
    );
  });
});
