import { describe, it, expect } from "vitest";
import { Effect, Layer } from "effect";
import { FileSystem } from "@effect/platform";
import { Executor, ExecutorLive, type ExecutionResult } from "./Executor.js";
import { topologicalSort } from "./Planner.js";
import { ShellService } from "../services/ShellService.js";
import { BackupService, type BackupResult } from "../services/BackupService.js";
import { GitService } from "../services/GitService.js";
import { BrewService, BrewServiceLive } from "../services/BrewService.js";
import type { SystemItem } from "../schema/config.js";
import { ShellError } from "../errors.js";

const makeItem = (
  name: string,
  opts?: {
    dependsOn?: string[];
    group?: string;
    backup?: string;
    onCheck?: "exit-code" | "path-exists";
    update?: string;
  },
): SystemItem => ({
  name,
  check: `which ${name}`,
  install: `brew install ${name}`,
  update: opts?.update,
  dependsOn: opts?.dependsOn,
  group: opts?.group,
  backup: opts?.backup,
  onCheck: opts?.onCheck,
});

const makeBrewItem = (
  name: string,
  opts?: {
    dependsOn?: string[];
    group?: string;
    formula?: string;
    cask?: string;
    tap?: string;
    args?: string[];
  },
): SystemItem => ({
  name,
  check: `which ${name}`,
  install: opts?.cask
    ? {
        source: "brew",
        cask: opts.cask,
        tap: opts.tap,
        args: opts.args,
      }
    : {
        source: "brew",
        formula: opts?.formula ?? name,
        tap: opts?.tap,
        args: opts?.args,
      },
  dependsOn: opts?.dependsOn,
  group: opts?.group,
});

const mockShellService = (installedItems: Set<string>): ShellService => ({
  run: (command) =>
    Effect.gen(function* () {
      if (command.startsWith("which ")) {
        const item = command.replace("which ", "");
        if (installedItems.has(item)) {
          return { stdout: `/usr/bin/${item}`, stderr: "", exitCode: 0 };
        }
        return yield* Effect.fail(
          new ShellError({
            command,
            exitCode: 1,
            stderr: `${item} not found`,
          }),
        );
      }

      if (command.startsWith("brew install ")) {
        const item = command.replace("brew install ", "");
        installedItems.add(item);
        return { stdout: `Installed ${item}`, stderr: "", exitCode: 0 };
      }

      if (command.startsWith("brew upgrade ")) {
        const item = command.replace("brew upgrade ", "");
        if (!installedItems.has(item)) {
          return yield* Effect.fail(
            new ShellError({
              command,
              exitCode: 1,
              stderr: `${item} not installed`,
            }),
          );
        }
        return { stdout: `Upgraded ${item}`, stderr: "", exitCode: 0 };
      }

      // Handle generic update commands (e.g., custom scripts)
      if (command.includes("update") || command.includes("upgrade") || command.includes("pull")) {
        return { stdout: `Executed: ${command}`, stderr: "", exitCode: 0 };
      }

      return { stdout: "", stderr: "", exitCode: 0 };
    }),

  exec: (_command, _args) => Effect.succeed({ stdout: "", stderr: "", exitCode: 0 }),
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

const mockBrewService: BrewService = {
  install: () => Effect.void as any,
};

const mockFileSystem = {
  exists: () => Effect.succeed(false),
} as unknown as FileSystem.FileSystem;

const createTestLayer = (installedItems: Set<string>) =>
  Layer.mergeAll(
    Layer.succeed(ShellService, mockShellService(installedItems)),
    Layer.succeed(BackupService, mockBackupService),
    Layer.succeed(GitService, mockGitService),
    Layer.succeed(BrewService, mockBrewService),
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

  it("should emit verbose command output when verbose mode is enabled", async () => {
    const installed = new Set<string>();
    const items = [makeItem("a")];
    const plan = await Effect.runPromise(topologicalSort(items));

    const verboseMessages: string[] = [];

    await Effect.runPromise(
      Effect.gen(function* () {
        const executor = yield* Executor;
        return yield* executor.execute(plan, {
          verbose: true,
          onVerbose: (message) => verboseMessages.push(message),
        });
      }).pipe(Effect.provide(createTestLayer(installed))),
    );

    expect(verboseMessages).toContain("[a] check: which a");
    expect(verboseMessages).toContain("[a] install: brew install a");
  });

  it("should not emit verbose command output when verbose mode is disabled", async () => {
    const installed = new Set<string>();
    const items = [makeItem("a")];
    const plan = await Effect.runPromise(topologicalSort(items));

    const verboseMessages: string[] = [];

    await Effect.runPromise(
      Effect.gen(function* () {
        const executor = yield* Executor;
        return yield* executor.execute(plan, {
          verbose: false,
          onVerbose: (message) => verboseMessages.push(message),
        });
      }).pipe(Effect.provide(createTestLayer(installed))),
    );

    expect(verboseMessages).toHaveLength(0);
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

  // Update mode tests
  describe("update mode", () => {
    it("should run update command when --update flag is set and item has update field", async () => {
      const installed = new Set(["a"]);
      const items = [makeItem("a", { update: "brew upgrade a" })];
      const plan = await Effect.runPromise(topologicalSort(items));

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const executor = yield* Executor;
          return yield* executor.execute(plan, { update: true });
        }).pipe(Effect.provide(createTestLayer(installed))),
      );

      expect(results).toHaveLength(1);
      expect(results[0].action).toBe("updated");
      expect(results[0].name).toBe("a");
    });

    it("should include command and reason when update fails", async () => {
      const shell: ShellService = {
        run: (command) =>
          Effect.gen(function* () {
            if (command.startsWith("which ")) {
              return { stdout: "/usr/bin/a", stderr: "", exitCode: 0 };
            }

            if (command === "claude update") {
              return yield* Effect.fail(
                new ShellError({
                  command,
                  exitCode: 127,
                  stderr: "claude: command not found",
                }),
              );
            }

            return { stdout: "", stderr: "", exitCode: 0 };
          }),
        exec: () => Effect.succeed({ stdout: "", stderr: "", exitCode: 0 }),
      };

      const items = [makeItem("a", { update: "claude update" })];
      const plan = await Effect.runPromise(topologicalSort(items));

      const layer = Layer.mergeAll(
        Layer.succeed(ShellService, shell),
        Layer.succeed(BackupService, mockBackupService),
        Layer.succeed(GitService, mockGitService),
        Layer.succeed(BrewService, mockBrewService),
        Layer.succeed(FileSystem.FileSystem, mockFileSystem),
        ExecutorLive,
      );

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const executor = yield* Executor;
          return yield* executor.execute(plan, { update: true });
        }).pipe(Effect.provide(layer)),
      );

      expect(results).toHaveLength(1);
      expect(results[0].action).toBe("failed");
      expect(results[0].status).toBe("error");
      expect(results[0].error).toContain('Command "claude update" failed with exit code 127');
      expect(results[0].error).toContain("claude: command not found");
    });

    it("should skip update when --update flag is not set", async () => {
      const installed = new Set(["a"]);
      const items = [makeItem("a", { update: "brew upgrade a" })];
      const plan = await Effect.runPromise(topologicalSort(items));

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const executor = yield* Executor;
          return yield* executor.execute(plan, { update: false });
        }).pipe(Effect.provide(createTestLayer(installed))),
      );

      expect(results).toHaveLength(1);
      expect(results[0].action).toBe("skipped");
      expect(results[0].status).toBe("installed");
    });

    it("should skip update when item has no update field", async () => {
      const installed = new Set(["a"]);
      const items = [makeItem("a")]; // No update field
      const plan = await Effect.runPromise(topologicalSort(items));

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const executor = yield* Executor;
          return yield* executor.execute(plan, { update: true });
        }).pipe(Effect.provide(createTestLayer(installed))),
      );

      expect(results).toHaveLength(1);
      expect(results[0].action).toBe("skipped");
      expect(results[0].status).toBe("installed");
    });

    it("should backup before update when backup field is configured", async () => {
      const installed = new Set(["a"]);
      const items = [makeItem("a", { update: "brew upgrade a", backup: "~/.config/a" })];
      const plan = await Effect.runPromise(topologicalSort(items));

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const executor = yield* Executor;
          return yield* executor.execute(plan, { update: true });
        }).pipe(Effect.provide(createTestLayer(installed))),
      );

      expect(results).toHaveLength(1);
      expect(results[0].action).toBe("updated");
      expect(results[0].backed_up).toBe("/backup/~/.config/a");
    });

    it("should show would_update in dry-run with update flag", async () => {
      const installed = new Set(["a"]);
      const items = [makeItem("a", { update: "brew upgrade a" })];
      const plan = await Effect.runPromise(topologicalSort(items));

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const executor = yield* Executor;
          return yield* executor.execute(plan, { update: true, dryRun: true });
        }).pipe(Effect.provide(createTestLayer(installed))),
      );

      expect(results).toHaveLength(1);
      expect(results[0].action).toBe("would_update");
      expect(results[0].status).toBe("installed");
      // Item remains installed (no actual changes in dry-run)
      expect(installed.has("a")).toBe(true);
    });

    it("should install missing items even with --update flag", async () => {
      const installed = new Set<string>();
      const items = [makeItem("a")];
      const plan = await Effect.runPromise(topologicalSort(items));

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const executor = yield* Executor;
          return yield* executor.execute(plan, { update: true });
        }).pipe(Effect.provide(createTestLayer(installed))),
      );

      expect(results).toHaveLength(1);
      expect(results[0].action).toBe("installed");
      expect(installed.has("a")).toBe(true);
    });
  });

  describe("brew install strategy", () => {
    it("serializes brew source items without explicit group", async () => {
      let activeInstalls = 0;
      let maxConcurrentInstalls = 0;

      const shell: ShellService = {
        run: (command) =>
          command.startsWith("which ")
            ? Effect.fail(
                new ShellError({
                  command,
                  exitCode: 1,
                  stderr: "not installed",
                }),
              )
            : Effect.succeed({ stdout: "", stderr: "", exitCode: 0 }),
        exec: () => Effect.succeed({ stdout: "", stderr: "", exitCode: 0 }),
      };

      const brew: BrewService = {
        install: () =>
          Effect.gen(function* () {
            activeInstalls += 1;
            maxConcurrentInstalls = Math.max(maxConcurrentInstalls, activeInstalls);
            yield* Effect.sleep("50 millis");
            activeInstalls -= 1;
          }),
      };

      const plan = await Effect.runPromise(topologicalSort([makeBrewItem("a"), makeBrewItem("b")]));

      const layer = Layer.mergeAll(
        Layer.succeed(ShellService, shell),
        Layer.succeed(BackupService, mockBackupService),
        Layer.succeed(GitService, mockGitService),
        Layer.succeed(BrewService, brew),
        Layer.succeed(FileSystem.FileSystem, mockFileSystem),
        ExecutorLive,
      );

      await Effect.runPromise(
        Effect.gen(function* () {
          const executor = yield* Executor;
          return yield* executor.execute(plan);
        }).pipe(Effect.provide(layer)),
      );

      expect(maxConcurrentInstalls).toBe(1);
    });

    it('uses explicit group for brew source items instead of implicit "brew" group', async () => {
      let activeInstalls = 0;
      let maxConcurrentInstalls = 0;

      const shell: ShellService = {
        run: (command) =>
          Effect.gen(function* () {
            if (command.startsWith("which ")) {
              return yield* Effect.fail(
                new ShellError({
                  command,
                  exitCode: 1,
                  stderr: "not installed",
                }),
              );
            }

            activeInstalls += 1;
            maxConcurrentInstalls = Math.max(maxConcurrentInstalls, activeInstalls);
            yield* Effect.sleep("50 millis");
            activeInstalls -= 1;

            return { stdout: "", stderr: "", exitCode: 0 };
          }),
        exec: () => Effect.succeed({ stdout: "", stderr: "", exitCode: 0 }),
      };

      const brew: BrewService = {
        install: () =>
          Effect.gen(function* () {
            activeInstalls += 1;
            maxConcurrentInstalls = Math.max(maxConcurrentInstalls, activeInstalls);
            yield* Effect.sleep("50 millis");
            activeInstalls -= 1;
          }),
      };

      const items = [makeBrewItem("a", { group: "custom" }), makeItem("b", { group: "custom" })];
      const plan = await Effect.runPromise(topologicalSort(items));

      const layer = Layer.mergeAll(
        Layer.succeed(ShellService, shell),
        Layer.succeed(BackupService, mockBackupService),
        Layer.succeed(GitService, mockGitService),
        Layer.succeed(BrewService, brew),
        Layer.succeed(FileSystem.FileSystem, mockFileSystem),
        ExecutorLive,
      );

      await Effect.runPromise(
        Effect.gen(function* () {
          const executor = yield* Executor;
          return yield* executor.execute(plan);
        }).pipe(Effect.provide(layer)),
      );

      expect(maxConcurrentInstalls).toBe(1);
    });

    it("runs brew source items in parallel with non-brew ungrouped items", async () => {
      let activeInstalls = 0;
      let maxConcurrentInstalls = 0;

      const shell: ShellService = {
        run: (command) =>
          Effect.gen(function* () {
            if (command.startsWith("which ")) {
              return yield* Effect.fail(
                new ShellError({
                  command,
                  exitCode: 1,
                  stderr: "not installed",
                }),
              );
            }

            activeInstalls += 1;
            maxConcurrentInstalls = Math.max(maxConcurrentInstalls, activeInstalls);
            yield* Effect.sleep("50 millis");
            activeInstalls -= 1;

            return { stdout: "", stderr: "", exitCode: 0 };
          }),
        exec: () => Effect.succeed({ stdout: "", stderr: "", exitCode: 0 }),
      };

      const brew: BrewService = {
        install: () =>
          Effect.gen(function* () {
            activeInstalls += 1;
            maxConcurrentInstalls = Math.max(maxConcurrentInstalls, activeInstalls);
            yield* Effect.sleep("50 millis");
            activeInstalls -= 1;
          }),
      };

      const plan = await Effect.runPromise(topologicalSort([makeBrewItem("a"), makeItem("b")]));

      const layer = Layer.mergeAll(
        Layer.succeed(ShellService, shell),
        Layer.succeed(BackupService, mockBackupService),
        Layer.succeed(GitService, mockGitService),
        Layer.succeed(BrewService, brew),
        Layer.succeed(FileSystem.FileSystem, mockFileSystem),
        ExecutorLive,
      );

      await Effect.runPromise(
        Effect.gen(function* () {
          const executor = yield* Executor;
          return yield* executor.execute(plan);
        }).pipe(Effect.provide(layer)),
      );

      expect(maxConcurrentInstalls).toBeGreaterThan(1);
    });

    it("dispatches brew source installs through BrewService instead of shell.run", async () => {
      const shellRunCommands: string[] = [];
      let brewInstallCalls = 0;

      const shell: ShellService = {
        run: (command) =>
          command.startsWith("which ")
            ? Effect.fail(
                new ShellError({
                  command,
                  exitCode: 1,
                  stderr: "not installed",
                }),
              )
            : Effect.sync(() => {
                shellRunCommands.push(command);
                return { stdout: "", stderr: "", exitCode: 0 };
              }),
        exec: () => Effect.succeed({ stdout: "", stderr: "", exitCode: 0 }),
      };

      const brew: BrewService = {
        install: () =>
          Effect.sync(() => {
            brewInstallCalls += 1;
          }),
      };

      const plan = await Effect.runPromise(topologicalSort([makeBrewItem("a")]));

      const layer = Layer.mergeAll(
        Layer.succeed(ShellService, shell),
        Layer.succeed(BackupService, mockBackupService),
        Layer.succeed(GitService, mockGitService),
        Layer.succeed(BrewService, brew),
        Layer.succeed(FileSystem.FileSystem, mockFileSystem),
        ExecutorLive,
      );

      await Effect.runPromise(
        Effect.gen(function* () {
          const executor = yield* Executor;
          return yield* executor.execute(plan);
        }).pipe(Effect.provide(layer)),
      );

      expect(brewInstallCalls).toBe(1);
      expect(shellRunCommands).toHaveLength(0);
    });

    it("invokes tap before install when tap is specified", async () => {
      const execCalls: Array<{ command: string; args: readonly string[] }> = [];

      const shell: ShellService = {
        run: (command) =>
          command.startsWith("which ")
            ? Effect.fail(
                new ShellError({
                  command,
                  exitCode: 1,
                  stderr: "not installed",
                }),
              )
            : Effect.succeed({ stdout: "", stderr: "", exitCode: 0 }),
        exec: (command, args) =>
          Effect.sync(() => {
            execCalls.push({ command, args });
            return { stdout: "", stderr: "", exitCode: 0 };
          }),
      };

      const plan = await Effect.runPromise(
        topologicalSort([
          makeBrewItem("neovim", {
            formula: "custom/tap/neovim",
            tap: "custom/tap",
            args: ["--HEAD"],
          }),
        ]),
      );

      const layer = Layer.mergeAll(
        Layer.succeed(ShellService, shell),
        Layer.succeed(BackupService, mockBackupService),
        Layer.succeed(GitService, mockGitService),
        BrewServiceLive,
        Layer.succeed(FileSystem.FileSystem, mockFileSystem),
        ExecutorLive,
      );

      await Effect.runPromise(
        Effect.gen(function* () {
          const executor = yield* Executor;
          return yield* executor.execute(plan);
        }).pipe(Effect.provide(layer)),
      );

      expect(execCalls).toEqual([
        { command: "brew", args: ["tap", "custom/tap"] },
        { command: "brew", args: ["install", "custom/tap/neovim", "--HEAD"] },
      ]);
    });

    it("passes --cask when installing brew cask items", async () => {
      const execCalls: Array<{ command: string; args: readonly string[] }> = [];

      const shell: ShellService = {
        run: (command) =>
          command.startsWith("which ")
            ? Effect.fail(
                new ShellError({
                  command,
                  exitCode: 1,
                  stderr: "not installed",
                }),
              )
            : Effect.succeed({ stdout: "", stderr: "", exitCode: 0 }),
        exec: (command, args) =>
          Effect.sync(() => {
            execCalls.push({ command, args });
            return { stdout: "", stderr: "", exitCode: 0 };
          }),
      };

      const plan = await Effect.runPromise(
        topologicalSort([makeBrewItem("firefox", { cask: "firefox" })]),
      );

      const layer = Layer.mergeAll(
        Layer.succeed(ShellService, shell),
        Layer.succeed(BackupService, mockBackupService),
        Layer.succeed(GitService, mockGitService),
        BrewServiceLive,
        Layer.succeed(FileSystem.FileSystem, mockFileSystem),
        ExecutorLive,
      );

      await Effect.runPromise(
        Effect.gen(function* () {
          const executor = yield* Executor;
          return yield* executor.execute(plan);
        }).pipe(Effect.provide(layer)),
      );

      expect(execCalls).toEqual([{ command: "brew", args: ["install", "--cask", "firefox"] }]);
    });
  });
});
