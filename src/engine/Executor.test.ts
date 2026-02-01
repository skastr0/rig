import { describe, it, expect } from "vitest";
import { Effect, Layer } from "effect";
import { FileSystem } from "@effect/platform";
import { Executor, ExecutorLive, type ExecutionResult } from "./Executor.js";
import { topologicalSort } from "./Planner.js";
import { ShellService, type ShellResult } from "../services/ShellService.js";
import { BackupService, type BackupResult } from "../services/BackupService.js";
import { GitService } from "../services/GitService.js";
import type { SystemItem } from "../schema/config.js";

const makeItem = (
  name: string,
  opts?: {
    dependsOn?: string[];
    group?: string;
    backup?: string;
    onCheck?: "exit-code" | "path-exists";
  },
): SystemItem => ({
  name,
  check: `which ${name}`,
  install: `brew install ${name}`,
  dependsOn: opts?.dependsOn,
  group: opts?.group,
  backup: opts?.backup,
  onCheck: opts?.onCheck,
});

const mockShellService = (installedItems: Set<string>): ShellService => ({
  run: (command) =>
    Effect.gen(function* () {
      if (command.startsWith("which ")) {
        const item = command.replace("which ", "");
        if (installedItems.has(item)) {
          return { stdout: `/usr/bin/${item}`, stderr: "", exitCode: 0 };
        }
        return yield* Effect.fail({
          _tag: "ShellError" as const,
          command,
          exitCode: 1,
          stderr: `${item} not found`,
        });
      }

      if (command.startsWith("brew install ")) {
        const item = command.replace("brew install ", "");
        installedItems.add(item);
        return { stdout: `Installed ${item}`, stderr: "", exitCode: 0 };
      }

      return { stdout: "", stderr: "", exitCode: 0 };
    }) as Effect.Effect<
      ShellResult,
      { _tag: "ShellError"; command: string; exitCode: number; stderr: string }
    >,

  exec: (_command, _args) =>
    Effect.succeed({ stdout: "", stderr: "", exitCode: 0 }) as Effect.Effect<
      ShellResult,
      { _tag: "ShellError"; command: string; exitCode: number; stderr: string }
    >,
});

const mockBackupService: BackupService = {
  backup: (path) =>
    Effect.succeed({
      source: path,
      destination: `/backup/${path}`,
      skipped: false,
    } as BackupResult),
};

const mockGitService: GitService = {
  clone: () => Effect.void as any,
};

const mockFileSystem = {
  exists: () => Effect.succeed(false),
} as unknown as FileSystem.FileSystem;

const createTestLayer = (installedItems: Set<string>) =>
  Layer.mergeAll(
    Layer.succeed(ShellService, mockShellService(installedItems)),
    Layer.succeed(BackupService, mockBackupService),
    Layer.succeed(GitService, mockGitService),
    Layer.succeed(FileSystem.FileSystem, mockFileSystem),
    ExecutorLive,
  );

describe("Executor", () => {
  it("should skip already installed items", async () => {
    const installed = new Set(["a", "b"]);
    const items = [makeItem("a"), makeItem("b")];
    const plan = await Effect.runPromise(topologicalSort(items));

    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const executor = yield* Executor;
        return yield* executor.execute(plan);
      }).pipe(Effect.provide(createTestLayer(installed))),
    );

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.action === "skipped")).toBe(true);
  });

  it("should install missing items", async () => {
    const installed = new Set<string>();
    const items = [makeItem("a")];
    const plan = await Effect.runPromise(topologicalSort(items));

    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const executor = yield* Executor;
        return yield* executor.execute(plan);
      }).pipe(Effect.provide(createTestLayer(installed))),
    );

    expect(results).toHaveLength(1);
    expect(results[0].action).toBe("installed");
    expect(installed.has("a")).toBe(true);
  });

  it("should respect dry run option", async () => {
    const installed = new Set<string>();
    const items = [makeItem("a")];
    const plan = await Effect.runPromise(topologicalSort(items));

    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const executor = yield* Executor;
        return yield* executor.execute(plan, { dryRun: true });
      }).pipe(Effect.provide(createTestLayer(installed))),
    );

    expect(results).toHaveLength(1);
    expect(results[0].action).toBe("skipped");
    expect(results[0].status).toBe("missing");
    expect(installed.has("a")).toBe(false);
  });

  it("should call onProgress callback", async () => {
    const installed = new Set<string>();
    const items = [makeItem("a")];
    const plan = await Effect.runPromise(topologicalSort(items));

    const progressResults: ExecutionResult[] = [];

    await Effect.runPromise(
      Effect.gen(function* () {
        const executor = yield* Executor;
        return yield* executor.execute(plan, {
          onProgress: (result) => progressResults.push(result),
        });
      }).pipe(Effect.provide(createTestLayer(installed))),
    );

    expect(progressResults).toHaveLength(1);
    expect(progressResults[0].name).toBe("a");
    expect(progressResults[0].action).toBe("installed");
  });

  it("should execute levels sequentially", async () => {
    const installed = new Set<string>();
    const items = [
      makeItem("c", { dependsOn: ["b"] }),
      makeItem("b", { dependsOn: ["a"] }),
      makeItem("a"),
    ];
    const plan = await Effect.runPromise(topologicalSort(items));

    const executionOrder: string[] = [];

    await Effect.runPromise(
      Effect.gen(function* () {
        const executor = yield* Executor;
        return yield* executor.execute(plan, {
          onProgress: (result) => executionOrder.push(result.name),
        });
      }).pipe(Effect.provide(createTestLayer(installed))),
    );

    expect(executionOrder).toEqual(["a", "b", "c"]);
  });
});
