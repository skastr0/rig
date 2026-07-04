import { describe, it, expect } from "vitest";
import { Effect, Layer } from "effect";
import { FileSystem } from "@effect/platform";
import * as Path from "node:path";
import { Executor, ExecutorLive, type ExecutionResult } from "./Executor.js";
import { topologicalSort } from "./Planner.js";
import { ShellService } from "../services/ShellService.js";
import { createLineBuffer } from "../services/LineBuffer.js";
import { BackupService, type BackupResult } from "../services/BackupService.js";
import { GitService } from "../services/GitService.js";
import { BrewService, BrewServiceLive } from "../services/BrewService.js";
import type { SystemItem } from "../schema/config.js";
import { BrewError, GitError, ShellError } from "../errors.js";
import { expandPath } from "../utils.js";

const makeItem = (
  name: string,
  opts?: {
    dependsOn?: string[];
    group?: string;
    backup?: string;
    onCheck?: "exit-code" | "path-exists";
    update?: string;
    timeout?: number;
  },
): SystemItem => ({
  name,
  profiles: ["macbook"],
  tags: ["test"],
  check: `which ${name}`,
  install: `brew install ${name}`,
  update: opts?.update,
  dependsOn: opts?.dependsOn,
  group: opts?.group,
  backup: opts?.backup,
  onCheck: opts?.onCheck,
  timeout: opts?.timeout,
});

const makeScriptItem = (
  name: string,
  opts?: {
    check?: string;
    cwd?: string;
    script?: string;
    timeout?: number;
    update?: SystemItem["update"];
  },
): SystemItem => ({
  name,
  profiles: ["macbook"],
  tags: ["test"],
  check: opts?.check ?? `which ${name}`,
  install: {
    source: "script",
    interpreter: "zsh",
    script: opts?.script ?? "echo install",
    ...(opts?.cwd === undefined ? {} : { cwd: opts.cwd }),
  },
  ...(opts?.update === undefined ? {} : { update: opts.update }),
  ...(opts?.timeout === undefined ? {} : { timeout: opts.timeout }),
});

const emitBufferedShellOutput = (
  options: Parameters<ShellService["run"]>[1] | undefined,
  stdoutChunks: readonly string[],
  stderrChunks: readonly string[] = [],
): void => {
  const errors: unknown[] = [];
  const onCallbackError = (error: unknown): void => {
    errors.push(error);
  };
  const stdoutLines = createLineBuffer(options?.onStdoutLine, onCallbackError);
  const stderrLines = createLineBuffer(options?.onStderrLine, onCallbackError);

  for (const chunk of stdoutChunks) {
    options?.onStdout?.(chunk);
    stdoutLines.push(chunk);
  }

  for (const chunk of stderrChunks) {
    options?.onStderr?.(chunk);
    stderrLines.push(chunk);
  }

  stdoutLines.flush();
  stderrLines.flush();

  if (errors.length > 0) {
    throw errors[0];
  }
};

const makeBrewItem = (
  name: string,
  opts?: {
    dependsOn?: string[];
    group?: string;
    formula?: string;
    cask?: string;
    tap?: string;
    args?: string[];
    timeout?: number;
  },
): SystemItem => ({
  name,
  profiles: ["macbook"],
  tags: ["test"],
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
  timeout: opts?.timeout,
});

const makeDirItem = (name: string, path: string): SystemItem => ({
  name,
  profiles: ["macbook"],
  tags: ["test"],
  check: path,
  onCheck: "path-exists",
  install: {
    source: "dir",
    path,
  },
});

const makeSymlinkItem = (
  name: string,
  path: string,
  target: string,
  opts?: {
    backup?: string;
  },
): SystemItem => ({
  name,
  profiles: ["macbook"],
  tags: ["test"],
  check: path,
  onCheck: "path-exists",
  install: {
    source: "symlink",
    path,
    target,
  },
  backup: opts?.backup,
});

const makeSkillsItem = (
  name: string,
  opts?: {
    package?: string;
    repo?: string;
    ref?: string;
    path?: string;
    skills?: string[];
    agents?: string[];
    mode?: "copy" | "symlink";
    group?: string;
    timeout?: number;
  },
): SystemItem => ({
  name,
  profiles: ["macbook"],
  tags: ["test"],
  install: {
    source: "skills",
    package: opts?.package ?? "skills@1.5.1",
    repo: opts?.repo ?? "vercel-labs/agent-skills",
    ref: opts?.ref ?? "0123456789abcdef0123456789abcdef01234567",
    path: opts?.path,
    skills: opts?.skills ?? ["frontend-design"],
    agents: opts?.agents ?? ["codex"],
    mode: opts?.mode,
  },
  group: opts?.group,
  timeout: opts?.timeout,
});

type MockFsNode =
  | { type: "Directory" }
  | { type: "File" }
  | { type: "SymbolicLink"; target: string };

const normalizeTestPath = (path: string): string => Path.normalize(Path.resolve(expandPath(path)));

const createMockFileSystem = (
  entries: Record<string, MockFsNode> = {},
): FileSystem.FileSystem & {
  readonly entries: Map<string, MockFsNode>;
} => {
  const state = new Map<string, MockFsNode>();
  let tempFileCounter = 0;

  const ensureParentDirectories = (path: string): void => {
    const parentPath = Path.dirname(path);

    if (parentPath === path) {
      return;
    }

    ensureParentDirectories(parentPath);

    const existingParent = state.get(parentPath);
    if (existingParent && existingParent.type !== "Directory") {
      throw new Error(`Parent path exists as ${existingParent.type}: ${parentPath}`);
    }

    if (!existingParent) {
      state.set(parentPath, { type: "Directory" });
    }
  };

  const setEntry = (path: string, entry: MockFsNode): void => {
    const normalizedPath = normalizeTestPath(path);
    ensureParentDirectories(normalizedPath);
    state.set(normalizedPath, entry);
  };

  for (const [path, entry] of Object.entries(entries)) {
    setEntry(path, entry);
  }

  const fileSystem = {
    entries: state,
    exists: (path: string) => Effect.succeed(state.has(normalizeTestPath(path))),
    stat: (path: string) =>
      Effect.gen(function* () {
        const entry = state.get(normalizeTestPath(path));
        if (!entry) {
          return yield* Effect.fail(new Error(`Path not found: ${path}`));
        }

        return { type: entry.type };
      }),
    makeDirectory: (path: string, options?: { recursive?: boolean }) =>
      Effect.sync(() => {
        const normalizedPath = normalizeTestPath(path);

        if (options?.recursive) {
          ensureParentDirectories(normalizedPath);
        } else {
          const parentPath = Path.dirname(normalizedPath);
          if (parentPath !== normalizedPath) {
            const parent = state.get(parentPath);
            if (!parent || parent.type !== "Directory") {
              throw new Error(`Parent directory missing: ${parentPath}`);
            }
          }
        }

        const existing = state.get(normalizedPath);
        if (existing && existing.type !== "Directory") {
          throw new Error(`Path exists as ${existing.type}: ${normalizedPath}`);
        }

        state.set(normalizedPath, { type: "Directory" });
      }),
    symlink: (target: string, path: string) =>
      Effect.sync(() => {
        const normalizedPath = normalizeTestPath(path);
        const parentPath = Path.dirname(normalizedPath);
        const parent = state.get(parentPath);

        if (parentPath !== normalizedPath && (!parent || parent.type !== "Directory")) {
          throw new Error(`Parent directory missing: ${parentPath}`);
        }

        if (state.has(normalizedPath)) {
          throw new Error(`Path already exists: ${normalizedPath}`);
        }

        state.set(normalizedPath, { type: "SymbolicLink", target });
      }),
    readLink: (path: string) =>
      Effect.gen(function* () {
        const entry = state.get(normalizeTestPath(path));
        if (!entry || entry.type !== "SymbolicLink") {
          return yield* Effect.fail(new Error(`Path is not a symlink: ${path}`));
        }

        return entry.target;
      }),
    remove: (path: string, options?: { recursive?: boolean }) =>
      Effect.sync(() => {
        const normalizedPath = normalizeTestPath(path);
        const entry = state.get(normalizedPath);

        if (!entry) {
          return;
        }

        if (entry.type === "Directory") {
          const prefix = `${normalizedPath}${Path.sep}`;
          const hasChildren = [...state.keys()].some(
            (candidate) => candidate !== normalizedPath && candidate.startsWith(prefix),
          );

          if (hasChildren && !options?.recursive) {
            throw new Error(`Directory not empty: ${normalizedPath}`);
          }

          const candidates = Array.from(state.keys());

          for (const candidate of candidates) {
            if (candidate === normalizedPath || candidate.startsWith(prefix)) {
              state.delete(candidate);
            }
          }

          return;
        }

        state.delete(normalizedPath);
      }),
    writeFileString: (path: string) =>
      Effect.sync(() => {
        const normalizedPath = normalizeTestPath(path);
        ensureParentDirectories(normalizedPath);
        state.set(normalizedPath, { type: "File" });
      }),
    makeTempFile: (options?: { directory?: string; prefix?: string; suffix?: string }) =>
      Effect.sync(() => {
        const rawPath = Path.join(
          options?.directory ?? "/tmp",
          `${options?.prefix ?? ""}${tempFileCounter++}${options?.suffix ?? ""}`,
        );
        const normalizedPath = normalizeTestPath(rawPath);
        ensureParentDirectories(normalizedPath);
        state.set(normalizedPath, { type: "File" });
        return rawPath;
      }),
  };

  return fileSystem as unknown as FileSystem.FileSystem & {
    readonly entries: Map<string, MockFsNode>;
  };
};

const mockShellService = (installedItems: Set<string>): ShellService => ({
  run: (command, _options?) =>
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

  exec: (_command, _args, _options?) => Effect.succeed({ stdout: "", stderr: "", exitCode: 0 }),
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
  clone: (_install, _options?) => Effect.void as any,
};

const mockBrewService: BrewService = {
  install: (_brew, _options?) => Effect.void as any,
};

const mockFileSystem = createMockFileSystem();

const createTestLayer = (
  installedItems: Set<string>,
  fileSystem: FileSystem.FileSystem = mockFileSystem,
) =>
  Layer.mergeAll(
    Layer.succeed(ShellService, mockShellService(installedItems)),
    Layer.succeed(BackupService, mockBackupService),
    Layer.succeed(GitService, mockGitService),
    Layer.succeed(BrewService, mockBrewService),
    Layer.succeed(FileSystem.FileSystem, fileSystem),
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
    expect(results[0].preview).toEqual({
      label: "shell install command",
      steps: ["brew install a"],
    });
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

  it("continues unrelated dependency lanes after a failure", async () => {
    const installed = new Set<string>();
    const shell: ShellService = {
      run: (command) =>
        Effect.gen(function* () {
          if (command.startsWith("which ")) {
            const item = command.replace("which ", "");
            if (installed.has(item)) {
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

          if (command === "brew install a") {
            return yield* Effect.fail(
              new ShellError({
                command,
                exitCode: 1,
                stderr: "network unavailable",
              }),
            );
          }

          if (command.startsWith("brew install ")) {
            const item = command.replace("brew install ", "");
            installed.add(item);
            return { stdout: `Installed ${item}`, stderr: "", exitCode: 0 };
          }

          return { stdout: "", stderr: "", exitCode: 0 };
        }),
      exec: () => Effect.succeed({ stdout: "", stderr: "", exitCode: 0 }),
    };

    const items = [
      makeItem("a"),
      makeItem("b"),
      makeItem("c", { dependsOn: ["a"] }),
      makeItem("d", { dependsOn: ["b"] }),
    ];
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
        return yield* executor.execute(plan);
      }).pipe(Effect.provide(layer)),
    );

    expect(results).toEqual([
      expect.objectContaining({ name: "a", action: "failed", status: "error" }),
      expect.objectContaining({ name: "b", action: "installed", status: "installed" }),
      expect.objectContaining({ name: "c", action: "blocked", status: "blocked" }),
      expect.objectContaining({ name: "d", action: "installed", status: "installed" }),
    ]);
    expect(installed.has("b")).toBe(true);
    expect(installed.has("d")).toBe(true);
  });

  it("blocks transitive dependents after an upstream failure", async () => {
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
          : command === "brew install a"
            ? Effect.fail(
                new ShellError({
                  command,
                  exitCode: 1,
                  stderr: "boom",
                }),
              )
            : Effect.succeed({ stdout: "", stderr: "", exitCode: 0 }),
      exec: () => Effect.succeed({ stdout: "", stderr: "", exitCode: 0 }),
    };

    const plan = await Effect.runPromise(
      topologicalSort([
        makeItem("a"),
        makeItem("b", { dependsOn: ["a"] }),
        makeItem("c", { dependsOn: ["b"] }),
      ]),
    );

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
        return yield* executor.execute(plan);
      }).pipe(Effect.provide(layer)),
    );

    expect(results[0]).toEqual(expect.objectContaining({ name: "a", action: "failed" }));
    expect(results[1]).toEqual(expect.objectContaining({ name: "b", action: "blocked" }));
    expect(results[1].error).toContain("a");
    expect(results[2]).toEqual(expect.objectContaining({ name: "c", action: "blocked" }));
    expect(results[2].error).toContain("b");
  });

  it("marks timed out items separately from generic failures", async () => {
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
          : command === "brew install a"
            ? Effect.fail(
                new ShellError({
                  command,
                  exitCode: -1,
                  stderr: "Timed out after 5ms",
                  timedOut: true,
                  timeoutMs: 5,
                }),
              )
            : Effect.succeed({ stdout: "", stderr: "", exitCode: 0 }),
      exec: () => Effect.succeed({ stdout: "", stderr: "", exitCode: 0 }),
    };

    const plan = await Effect.runPromise(
      topologicalSort([makeItem("a"), makeItem("b", { dependsOn: ["a"] })]),
    );

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
        return yield* executor.execute(plan);
      }).pipe(Effect.provide(layer)),
    );

    expect(results[0]).toEqual(expect.objectContaining({ name: "a", action: "timed_out" }));
    expect(results[0].error).toContain("timed out");
    expect(results[1]).toEqual(expect.objectContaining({ name: "b", action: "blocked" }));
  });

  it("blocks dependents only when an updateable dependency is not execution-ready", async () => {
    const installed = new Set(["a"]);
    const fileSystem = createMockFileSystem({
      "~/.dotfiles/.zshrc": { type: "File" },
      "~/.legacy/.zshrc": { type: "File" },
      "~/.zshrc": { type: "SymbolicLink", target: normalizeTestPath("~/.legacy/.zshrc") },
    });
    const plan = await Effect.runPromise(
      topologicalSort([
        makeItem("a", { update: "tool update" }),
        makeSymlinkItem("zshrc", "~/.zshrc", "~/.dotfiles/.zshrc"),
        makeItem("b", { dependsOn: ["a"] }),
        makeItem("c", { dependsOn: ["zshrc"] }),
      ]),
    );

    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const executor = yield* Executor;
        return yield* executor.inspect(plan);
      }).pipe(Effect.provide(createTestLayer(installed, fileSystem))),
    );

    const resultByName = new Map(results.map((result) => [result.name, result]));

    expect(resultByName.get("a")).toEqual(expect.objectContaining({ status: "updateable" }));
    expect(resultByName.get("a")?.reason).toContain("Update command configured");

    expect(resultByName.get("zshrc")).toEqual(expect.objectContaining({ status: "updateable" }));
    expect(resultByName.get("zshrc")?.reason).toContain("Re-run with --update");

    expect(resultByName.get("b")).toEqual(expect.objectContaining({ status: "missing" }));
    expect(resultByName.get("c")).toEqual(expect.objectContaining({ status: "blocked" }));
    expect(resultByName.get("c")?.reason).toContain("zshrc (updateable)");

    expect(installed).toEqual(new Set(["a"]));
    expect(fileSystem.entries.get(normalizeTestPath("~/.zshrc"))).toEqual({
      type: "SymbolicLink",
      target: normalizeTestPath("~/.legacy/.zshrc"),
    });
  });

  it("preserves structured git failure detail in execution results", async () => {
    const item: SystemItem = {
      name: "dotfiles",
      check: "which dotfiles",
      install: {
        source: "git",
        repo: "https://github.com/example/dotfiles.git",
        path: "~/dotfiles",
      },
    };

    const shell: ShellService = {
      run: (command) =>
        command === "which dotfiles"
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

    const git: GitService = {
      clone: () =>
        Effect.fail(
          new GitError({
            repo: "https://github.com/example/dotfiles.git",
            reason: "Failed to clone to /Users/test/dotfiles",
            command: "git clone https://github.com/example/dotfiles.git /Users/test/dotfiles",
            exitCode: 128,
            stderr: "fatal: repository not found",
          }),
        ),
    };

    const plan = await Effect.runPromise(topologicalSort([item]));

    const layer = Layer.mergeAll(
      Layer.succeed(ShellService, shell),
      Layer.succeed(BackupService, mockBackupService),
      Layer.succeed(GitService, git),
      Layer.succeed(BrewService, mockBrewService),
      Layer.succeed(FileSystem.FileSystem, mockFileSystem),
      ExecutorLive,
    );

    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const executor = yield* Executor;
        return yield* executor.execute(plan);
      }).pipe(Effect.provide(layer)),
    );

    expect(results[0]?.action).toBe("failed");
    expect(results[0]?.error).toContain("Git error for https://github.com/example/dotfiles.git");
    expect(results[0]?.error).toContain(
      "Command: git clone https://github.com/example/dotfiles.git /Users/test/dotfiles",
    );
    expect(results[0]?.error).toContain("Exit code: 128");
    expect(results[0]?.error).toContain("Stderr: fatal: repository not found");
  });

  it("preserves structured brew failure detail in execution results", async () => {
    const shell: ShellService = {
      run: (command) =>
        command === "which rg"
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
        Effect.fail(
          new BrewError({
            formula_or_cask: "ripgrep",
            reason: "Failed to install formula ripgrep",
            command: "brew install ripgrep",
            exitCode: 1,
            stderr: "Error: network unavailable",
          }),
        ),
    };

    const plan = await Effect.runPromise(
      topologicalSort([makeBrewItem("rg", { formula: "ripgrep" })]),
    );

    const layer = Layer.mergeAll(
      Layer.succeed(ShellService, shell),
      Layer.succeed(BackupService, mockBackupService),
      Layer.succeed(GitService, mockGitService),
      Layer.succeed(BrewService, brew),
      Layer.succeed(FileSystem.FileSystem, mockFileSystem),
      ExecutorLive,
    );

    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const executor = yield* Executor;
        return yield* executor.execute(plan);
      }).pipe(Effect.provide(layer)),
    );

    expect(results[0]?.action).toBe("failed");
    expect(results[0]?.error).toContain("Brew error for ripgrep");
    expect(results[0]?.error).toContain("Command: brew install ripgrep");
    expect(results[0]?.error).toContain("Exit code: 1");
    expect(results[0]?.error).toContain("Stderr: Error: network unavailable");
  });

  it("passes configured timeout to shell checks and installs", async () => {
    const observedTimeouts: Array<unknown> = [];
    const shell: ShellService = {
      run: (command, options) =>
        Effect.gen(function* () {
          observedTimeouts.push(options?.timeout);

          if (command.startsWith("which ")) {
            return yield* Effect.fail(
              new ShellError({
                command,
                exitCode: 1,
                stderr: "not installed",
              }),
            );
          }

          return { stdout: "", stderr: "", exitCode: 0 };
        }),
      exec: () => Effect.succeed({ stdout: "", stderr: "", exitCode: 0 }),
    };

    const plan = await Effect.runPromise(topologicalSort([makeItem("a", { timeout: 5_000 })]));

    const layer = Layer.mergeAll(
      Layer.succeed(ShellService, shell),
      Layer.succeed(BackupService, mockBackupService),
      Layer.succeed(GitService, mockGitService),
      Layer.succeed(BrewService, mockBrewService),
      Layer.succeed(FileSystem.FileSystem, mockFileSystem),
      ExecutorLive,
    );

    await Effect.runPromise(
      Effect.gen(function* () {
        const executor = yield* Executor;
        return yield* executor.execute(plan);
      }).pipe(Effect.provide(layer)),
    );

    expect(observedTimeouts).toEqual([5_000, 5_000]);
  });

  describe("dir install strategy", () => {
    it("creates missing directories", async () => {
      const fileSystem = createMockFileSystem();
      const plan = await Effect.runPromise(
        topologicalSort([makeDirItem("projects-root", "~/Projects")]),
      );

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const executor = yield* Executor;
          return yield* executor.execute(plan);
        }).pipe(Effect.provide(createTestLayer(new Set<string>(), fileSystem))),
      );

      expect(results).toEqual([
        expect.objectContaining({
          name: "projects-root",
          action: "installed",
          status: "installed",
        }),
      ]);
      expect(fileSystem.entries.get(normalizeTestPath("~/Projects"))).toEqual({
        type: "Directory",
      });
    });

    it("skips when the directory already exists", async () => {
      const fileSystem = createMockFileSystem({
        "~/Projects": { type: "Directory" },
      });
      const plan = await Effect.runPromise(
        topologicalSort([makeDirItem("projects-root", "~/Projects")]),
      );

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const executor = yield* Executor;
          return yield* executor.execute(plan);
        }).pipe(Effect.provide(createTestLayer(new Set<string>(), fileSystem))),
      );

      expect(results).toEqual([
        expect.objectContaining({
          name: "projects-root",
          action: "skipped",
          status: "installed",
        }),
      ]);
    });

    it("emits clear dry-run output for directory creation", async () => {
      const fileSystem = createMockFileSystem();
      const plan = await Effect.runPromise(
        topologicalSort([makeDirItem("projects-root", "~/Projects")]),
      );
      const verboseMessages: string[] = [];

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const executor = yield* Executor;
          return yield* executor.execute(plan, {
            dryRun: true,
            verbose: true,
            onVerbose: (message) => verboseMessages.push(message),
          });
        }).pipe(Effect.provide(createTestLayer(new Set<string>(), fileSystem))),
      );

      expect(results).toEqual([
        expect.objectContaining({
          name: "projects-root",
          action: "skipped",
          status: "missing",
        }),
      ]);
      expect(verboseMessages).toContain(
        `[projects-root] would install: create directory ${normalizeTestPath("~/Projects")}`,
      );
      expect(fileSystem.entries.has(normalizeTestPath("~/Projects"))).toBe(false);
    });

    it("fails with an actionable error when the directory path is occupied", async () => {
      const fileSystem = createMockFileSystem({
        "~/Projects": { type: "File" },
      });
      const plan = await Effect.runPromise(
        topologicalSort([makeDirItem("projects-root", "~/Projects")]),
      );

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const executor = yield* Executor;
          return yield* executor.execute(plan);
        }).pipe(Effect.provide(createTestLayer(new Set<string>(), fileSystem))),
      );

      expect(results[0]).toEqual(
        expect.objectContaining({
          name: "projects-root",
          action: "failed",
          status: "error",
        }),
      );
      expect(results[0].error).toContain("Expected directory");
      expect(results[0].error).toContain("found file");
    });
  });

  describe("symlink install strategy", () => {
    it("creates missing symlinks", async () => {
      const fileSystem = createMockFileSystem({
        "~/.dotfiles/.zshrc": { type: "File" },
      });
      const plan = await Effect.runPromise(
        topologicalSort([makeSymlinkItem("zshrc", "~/.zshrc", "~/.dotfiles/.zshrc")]),
      );

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const executor = yield* Executor;
          return yield* executor.execute(plan);
        }).pipe(Effect.provide(createTestLayer(new Set<string>(), fileSystem))),
      );

      expect(results).toEqual([
        expect.objectContaining({
          name: "zshrc",
          action: "installed",
          status: "installed",
        }),
      ]);
      expect(fileSystem.entries.get(normalizeTestPath("~/.zshrc"))).toEqual({
        type: "SymbolicLink",
        target: normalizeTestPath("~/.dotfiles/.zshrc"),
      });
    });

    it("skips when the desired symlink already exists", async () => {
      const fileSystem = createMockFileSystem({
        "~/.dotfiles/.zshrc": { type: "File" },
        "~/.zshrc": { type: "SymbolicLink", target: normalizeTestPath("~/.dotfiles/.zshrc") },
      });
      const plan = await Effect.runPromise(
        topologicalSort([makeSymlinkItem("zshrc", "~/.zshrc", "~/.dotfiles/.zshrc")]),
      );

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const executor = yield* Executor;
          return yield* executor.execute(plan);
        }).pipe(Effect.provide(createTestLayer(new Set<string>(), fileSystem))),
      );

      expect(results).toEqual([
        expect.objectContaining({
          name: "zshrc",
          action: "skipped",
          status: "installed",
        }),
      ]);
    });

    it("emits clear dry-run output for symlink creation", async () => {
      const fileSystem = createMockFileSystem({
        "~/.dotfiles/.zshrc": { type: "File" },
      });
      const plan = await Effect.runPromise(
        topologicalSort([makeSymlinkItem("zshrc", "~/.zshrc", "~/.dotfiles/.zshrc")]),
      );
      const verboseMessages: string[] = [];

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const executor = yield* Executor;
          return yield* executor.execute(plan, {
            dryRun: true,
            verbose: true,
            onVerbose: (message) => verboseMessages.push(message),
          });
        }).pipe(Effect.provide(createTestLayer(new Set<string>(), fileSystem))),
      );

      expect(results).toEqual([
        expect.objectContaining({
          name: "zshrc",
          action: "skipped",
          status: "missing",
        }),
      ]);
      expect(verboseMessages).toContain(
        `[zshrc] would install: create symlink ${normalizeTestPath("~/.zshrc")} -> ${normalizeTestPath("~/.dotfiles/.zshrc")}`,
      );
      expect(fileSystem.entries.has(normalizeTestPath("~/.zshrc"))).toBe(false);
    });

    it("fails with an actionable error when the symlink target is missing", async () => {
      const fileSystem = createMockFileSystem();
      const plan = await Effect.runPromise(
        topologicalSort([makeSymlinkItem("zshrc", "~/.zshrc", "~/.dotfiles/.zshrc")]),
      );

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const executor = yield* Executor;
          return yield* executor.execute(plan);
        }).pipe(Effect.provide(createTestLayer(new Set<string>(), fileSystem))),
      );

      expect(results[0]).toEqual(
        expect.objectContaining({
          name: "zshrc",
          action: "failed",
          status: "error",
        }),
      );
      expect(results[0].error).toContain("Symlink target");
      expect(results[0].error).toContain("does not exist");
    });

    it("fails without --update when an existing symlink points elsewhere", async () => {
      const fileSystem = createMockFileSystem({
        "~/.dotfiles/.zshrc": { type: "File" },
        "~/.legacy/.zshrc": { type: "File" },
        "~/.zshrc": { type: "SymbolicLink", target: normalizeTestPath("~/.legacy/.zshrc") },
      });
      const plan = await Effect.runPromise(
        topologicalSort([makeSymlinkItem("zshrc", "~/.zshrc", "~/.dotfiles/.zshrc")]),
      );

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const executor = yield* Executor;
          return yield* executor.execute(plan);
        }).pipe(Effect.provide(createTestLayer(new Set<string>(), fileSystem))),
      );

      expect(results[0]).toEqual(
        expect.objectContaining({
          name: "zshrc",
          action: "failed",
          status: "error",
        }),
      );
      expect(results[0].error).toContain("Re-run with --update");
      expect(results[0].error).toContain(normalizeTestPath("~/.legacy/.zshrc"));
    });

    it("updates an existing symlink target when --update is set", async () => {
      const fileSystem = createMockFileSystem({
        "~/.dotfiles/.zshrc": { type: "File" },
        "~/.legacy/.zshrc": { type: "File" },
        "~/.zshrc": { type: "SymbolicLink", target: normalizeTestPath("~/.legacy/.zshrc") },
      });
      const plan = await Effect.runPromise(
        topologicalSort([
          makeSymlinkItem("zshrc", "~/.zshrc", "~/.dotfiles/.zshrc", { backup: "~/.zshrc" }),
        ]),
      );

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const executor = yield* Executor;
          return yield* executor.execute(plan, { update: true });
        }).pipe(Effect.provide(createTestLayer(new Set<string>(), fileSystem))),
      );

      expect(results).toEqual([
        expect.objectContaining({
          name: "zshrc",
          action: "updated",
          status: "installed",
          backed_up: "/backup/~/.zshrc",
        }),
      ]);
      expect(fileSystem.entries.get(normalizeTestPath("~/.zshrc"))).toEqual({
        type: "SymbolicLink",
        target: normalizeTestPath("~/.dotfiles/.zshrc"),
      });
    });
  });

  describe("skills install strategy", () => {
    it("skips when all requested skills exist for all requested agents", async () => {
      const fileSystem = createMockFileSystem({
        "~/.codex/skills/frontend-design/SKILL.md": { type: "File" },
        "~/.codex/skills/skill-creator/SKILL.md": { type: "File" },
        "~/.config/opencode/skills/frontend-design/SKILL.md": { type: "File" },
        "~/.config/opencode/skills/skill-creator/SKILL.md": { type: "File" },
      });
      const plan = await Effect.runPromise(
        topologicalSort([
          makeSkillsItem("agent-skills", {
            skills: ["frontend-design", "skill-creator"],
            agents: ["codex", "opencode"],
          }),
        ]),
      );

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const executor = yield* Executor;
          return yield* executor.execute(plan);
        }).pipe(Effect.provide(createTestLayer(new Set<string>(), fileSystem))),
      );

      expect(results).toEqual([
        expect.objectContaining({
          name: "agent-skills",
          action: "skipped",
          status: "installed",
        }),
      ]);
    });

    it("installs missing skills with telemetry disabled and repeated skill and agent flags", async () => {
      const execCalls: Array<{
        command: string;
        args: readonly string[];
        timeout?: unknown;
      }> = [];
      const fileSystem = createMockFileSystem();
      const shell: ShellService = {
        run: () => Effect.succeed({ stdout: "", stderr: "", exitCode: 0 }),
        exec: (command, args, options) =>
          Effect.sync(() => {
            execCalls.push({ command, args, timeout: options?.timeout });
            return { stdout: "installed", stderr: "", exitCode: 0 };
          }),
      };
      const plan = await Effect.runPromise(
        topologicalSort([
          makeSkillsItem("agent-skills", {
            repo: "https://github.com/vercel-labs/agent-skills",
            path: "skills",
            skills: ["frontend-design", "skill-creator"],
            agents: ["codex", "opencode"],
            timeout: 12_345,
          }),
        ]),
      );
      const layer = Layer.mergeAll(
        Layer.succeed(ShellService, shell),
        Layer.succeed(BackupService, mockBackupService),
        Layer.succeed(GitService, mockGitService),
        Layer.succeed(BrewService, mockBrewService),
        Layer.succeed(FileSystem.FileSystem, fileSystem),
        ExecutorLive,
      );

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const executor = yield* Executor;
          return yield* executor.execute(plan);
        }).pipe(Effect.provide(layer)),
      );

      expect(results).toEqual([
        expect.objectContaining({
          name: "agent-skills",
          action: "installed",
          status: "installed",
        }),
      ]);
      expect(execCalls).toEqual([
        {
          command: "env",
          args: [
            "DISABLE_TELEMETRY=1",
            "npx",
            "--yes",
            "skills@1.5.1",
            "add",
            "https://github.com/vercel-labs/agent-skills#0123456789abcdef0123456789abcdef01234567",
            "--skill",
            "frontend-design",
            "--skill",
            "skill-creator",
            "--agent",
            "codex",
            "--agent",
            "opencode",
            "--global",
            "--copy",
            "--yes",
          ],
          timeout: 12_345,
        },
      ]);
    });

    it("emits clear dry-run output for skills installation", async () => {
      const fileSystem = createMockFileSystem();
      const plan = await Effect.runPromise(
        topologicalSort([
          makeSkillsItem("agent-skills", {
            skills: ["frontend-design"],
            agents: ["codex"],
          }),
        ]),
      );
      const verboseMessages: string[] = [];

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const executor = yield* Executor;
          return yield* executor.execute(plan, {
            dryRun: true,
            verbose: true,
            onVerbose: (message) => verboseMessages.push(message),
          });
        }).pipe(Effect.provide(createTestLayer(new Set<string>(), fileSystem))),
      );

      expect(results).toEqual([
        expect.objectContaining({
          name: "agent-skills",
          action: "skipped",
          status: "missing",
          preview: {
            label: "structured install (skills)",
            steps: [
              "env DISABLE_TELEMETRY=1 npx --yes skills@1.5.1 add vercel-labs/agent-skills#0123456789abcdef0123456789abcdef01234567 --skill frontend-design --agent codex --global --copy --yes",
            ],
          },
        }),
      ]);
      expect(verboseMessages).toContain(
        "[agent-skills] would install: env DISABLE_TELEMETRY=1 npx --yes skills@1.5.1 add vercel-labs/agent-skills#0123456789abcdef0123456789abcdef01234567 --skill frontend-design --agent codex --global --copy --yes",
      );
    });

    it("serializes skills source items without explicit group", async () => {
      let activeInstalls = 0;
      let maxConcurrentInstalls = 0;
      const fileSystem = createMockFileSystem();
      const shell: ShellService = {
        run: () => Effect.succeed({ stdout: "", stderr: "", exitCode: 0 }),
        exec: () =>
          Effect.gen(function* () {
            activeInstalls += 1;
            maxConcurrentInstalls = Math.max(maxConcurrentInstalls, activeInstalls);
            yield* Effect.sleep("50 millis");
            activeInstalls -= 1;
            return { stdout: "", stderr: "", exitCode: 0 };
          }),
      };
      const plan = await Effect.runPromise(
        topologicalSort([
          makeSkillsItem("agent-skills-a", { skills: ["frontend-design"] }),
          makeSkillsItem("agent-skills-b", { skills: ["skill-creator"] }),
        ]),
      );
      const layer = Layer.mergeAll(
        Layer.succeed(ShellService, shell),
        Layer.succeed(BackupService, mockBackupService),
        Layer.succeed(GitService, mockGitService),
        Layer.succeed(BrewService, mockBrewService),
        Layer.succeed(FileSystem.FileSystem, fileSystem),
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

    it("fails with an actionable error for unsupported skills agents", async () => {
      const fileSystem = createMockFileSystem();
      const plan = await Effect.runPromise(
        topologicalSort([makeSkillsItem("agent-skills", { agents: ["unknown-agent"] })]),
      );

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const executor = yield* Executor;
          return yield* executor.execute(plan);
        }).pipe(Effect.provide(createTestLayer(new Set<string>(), fileSystem))),
      );

      expect(results[0]).toEqual(
        expect.objectContaining({
          name: "agent-skills",
          action: "failed",
          status: "error",
        }),
      );
      expect(results[0].error).toContain('Unsupported skills agent "unknown-agent"');
    });
  });

  describe("script install strategy", () => {
    it("executes multiline scripts through an interpreter file without shell string quoting", async () => {
      const execCalls: Array<{
        command: string;
        args: readonly string[];
        timeout?: unknown;
        cwd?: string;
      }> = [];
      const fileSystem = createMockFileSystem();
      const shell: ShellService = {
        run: (command) =>
          command.startsWith("which ")
            ? Effect.fail(new ShellError({ command, exitCode: 1, stderr: "not found" }))
            : Effect.succeed({ stdout: "", stderr: "", exitCode: 0 }),
        exec: (command, args, options) =>
          Effect.sync(() => {
            execCalls.push({
              command,
              args,
              timeout: options?.timeout,
              cwd: options?.cwd,
            });
            return { stdout: "script ok", stderr: "", exitCode: 0 };
          }),
      };
      const plan = await Effect.runPromise(
        topologicalSort([
          makeScriptItem("service", {
            cwd: "~/Synthetic/service",
            script: "echo one\necho two",
            timeout: 12_345,
          }),
        ]),
      );
      const layer = Layer.mergeAll(
        Layer.succeed(ShellService, shell),
        Layer.succeed(BackupService, mockBackupService),
        Layer.succeed(GitService, mockGitService),
        Layer.succeed(BrewService, mockBrewService),
        Layer.succeed(FileSystem.FileSystem, fileSystem),
        ExecutorLive,
      );

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const executor = yield* Executor;
          return yield* executor.execute(plan);
        }).pipe(Effect.provide(layer)),
      );

      expect(results).toEqual([
        expect.objectContaining({
          name: "service",
          action: "installed",
          status: "installed",
        }),
      ]);
      expect(execCalls).toHaveLength(1);
      expect(execCalls[0]?.command).toBe("zsh");
      expect(execCalls[0]?.args).toHaveLength(1);
      expect(execCalls[0]?.args[0]).toContain("rig-service-");
      expect(execCalls[0]?.args[0]).not.toContain("echo one");
      expect(execCalls[0]?.cwd).toBe(normalizeTestPath("~/Synthetic/service"));
      expect(execCalls[0]?.timeout).toBe(12_345);
      expect(fileSystem.entries.has(normalizeTestPath(execCalls[0]?.args[0] ?? ""))).toBe(false);
    });

    it("previews script installs with the script body visible for review", async () => {
      const fileSystem = createMockFileSystem();
      const plan = await Effect.runPromise(
        topologicalSort([
          makeScriptItem("service", {
            cwd: "~/Synthetic/service",
            script: "echo secret\necho ready",
          }),
        ]),
      );
      const verboseMessages: string[] = [];

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const executor = yield* Executor;
          return yield* executor.execute(plan, {
            dryRun: true,
            verbose: true,
            onVerbose: (message) => verboseMessages.push(message),
          });
        }).pipe(Effect.provide(createTestLayer(new Set<string>(), fileSystem))),
      );

      expect(results[0]).toEqual(
        expect.objectContaining({
          name: "service",
          action: "skipped",
          status: "missing",
          preview: {
            label: "structured install (script)",
            steps: [
              "run zsh script (2 lines) in ~/Synthetic/service",
              "script:1: echo secret",
              "script:2: echo ready",
            ],
          },
        }),
      );
      expect(verboseMessages).toContain(
        "[service] would install: run zsh script (2 lines) in ~/Synthetic/service",
      );
      expect(JSON.stringify(results)).toContain("secret");
      expect(verboseMessages.join("\n")).toContain("secret");
    });
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

    it("should run script update commands through interpreter files", async () => {
      const execCalls: Array<{
        command: string;
        args: readonly string[];
        cwd?: string;
      }> = [];
      const fileSystem = createMockFileSystem();
      const shell: ShellService = {
        run: (command) =>
          command.startsWith("which ")
            ? Effect.succeed({ stdout: "/usr/bin/service", stderr: "", exitCode: 0 })
            : Effect.succeed({ stdout: "", stderr: "", exitCode: 0 }),
        exec: (command, args, options) =>
          Effect.sync(() => {
            execCalls.push({ command, args, cwd: options?.cwd });
            return { stdout: "updated", stderr: "", exitCode: 0 };
          }),
      };
      const items = [
        makeScriptItem("service", {
          update: {
            source: "script",
            interpreter: "zsh",
            cwd: "~/Synthetic/service",
            script: "echo update-secret",
          },
        }),
      ];
      const plan = await Effect.runPromise(topologicalSort(items));
      const layer = Layer.mergeAll(
        Layer.succeed(ShellService, shell),
        Layer.succeed(BackupService, mockBackupService),
        Layer.succeed(GitService, mockGitService),
        Layer.succeed(BrewService, mockBrewService),
        Layer.succeed(FileSystem.FileSystem, fileSystem),
        ExecutorLive,
      );

      const results = await Effect.runPromise(
        Effect.gen(function* () {
          const executor = yield* Executor;
          return yield* executor.execute(plan, { update: true });
        }).pipe(Effect.provide(layer)),
      );

      expect(results[0]).toEqual(
        expect.objectContaining({
          name: "service",
          action: "updated",
          status: "installed",
        }),
      );
      expect(execCalls[0]?.command).toBe("zsh");
      expect(execCalls[0]?.args[0]).toContain("rig-service-");
      expect(execCalls[0]?.args[0]).not.toContain("update-secret");
      expect(execCalls[0]?.cwd).toBe(normalizeTestPath("~/Synthetic/service"));
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

    it("should emit successful command output in verbose mode", async () => {
      const shell: ShellService = {
        run: (command, options) => {
          if (command.startsWith("which ")) {
            return Effect.succeed({ stdout: "/usr/bin/a", stderr: "", exitCode: 0 });
          }

          if (command === "tool update") {
            options?.onStdoutLine?.("Updated active version");
            options?.onStderrLine?.("warning: extra install skipped");

            return Effect.succeed({
              stdout: "Updated active version",
              stderr: "warning: extra install skipped",
              exitCode: 0,
            });
          }

          return Effect.succeed({ stdout: "", stderr: "", exitCode: 0 });
        },
        exec: () => Effect.succeed({ stdout: "", stderr: "", exitCode: 0 }),
      };

      const items = [makeItem("a", { update: "tool update" })];
      const plan = await Effect.runPromise(topologicalSort(items));
      const verboseMessages: string[] = [];

      const layer = Layer.mergeAll(
        Layer.succeed(ShellService, shell),
        Layer.succeed(BackupService, mockBackupService),
        Layer.succeed(GitService, mockGitService),
        Layer.succeed(BrewService, mockBrewService),
        Layer.succeed(FileSystem.FileSystem, mockFileSystem),
        ExecutorLive,
      );

      await Effect.runPromise(
        Effect.gen(function* () {
          const executor = yield* Executor;
          return yield* executor.execute(plan, {
            update: true,
            verbose: true,
            onVerbose: (message) => verboseMessages.push(message),
          });
        }).pipe(Effect.provide(layer)),
      );

      expect(verboseMessages).toContain("[a] update: tool update");
      expect(verboseMessages).toContain("[a] stdout: Updated active version");
      expect(verboseMessages).toContain("[a] stderr: warning: extra install skipped");
    });

    it("emits command output from complete shell lines", async () => {
      const shell: ShellService = {
        run: (command, options) => {
          if (command.startsWith("which ")) {
            return Effect.succeed({ stdout: "/usr/bin/a", stderr: "", exitCode: 0 });
          }

          if (command === "tool update") {
            emitBufferedShellOutput(
              options,
              ["Installing", " package\n\nNext", " step"],
              ["warning: cached", " formula\n"],
            );

            return Effect.succeed({
              stdout: "Installing package\n\nNext step",
              stderr: "warning: cached formula\n",
              exitCode: 0,
            });
          }

          return Effect.succeed({ stdout: "", stderr: "", exitCode: 0 });
        },
        exec: () => Effect.succeed({ stdout: "", stderr: "", exitCode: 0 }),
      };

      const items = [makeItem("a", { update: "tool update" })];
      const plan = await Effect.runPromise(topologicalSort(items));
      const output: { itemName: string; stream: "stdout" | "stderr"; line: string }[] = [];

      const layer = Layer.mergeAll(
        Layer.succeed(ShellService, shell),
        Layer.succeed(BackupService, mockBackupService),
        Layer.succeed(GitService, mockGitService),
        Layer.succeed(BrewService, mockBrewService),
        Layer.succeed(FileSystem.FileSystem, mockFileSystem),
        ExecutorLive,
      );

      await Effect.runPromise(
        Effect.gen(function* () {
          const executor = yield* Executor;
          return yield* executor.execute(plan, {
            update: true,
            onOutput: (event) => output.push(event),
          });
        }).pipe(Effect.provide(layer)),
      );

      expect(output).toHaveLength(3);
      expect(output).toContainEqual({
        itemName: "a",
        stream: "stdout",
        line: "Installing package",
      });
      expect(output).toContainEqual({ itemName: "a", stream: "stdout", line: "Next step" });
      expect(output).toContainEqual({
        itemName: "a",
        stream: "stderr",
        line: "warning: cached formula",
      });
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
        install: (_brew, _options?) =>
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
        install: (_brew, _options?) =>
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
        install: (_brew, _options?) =>
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
        install: (_brew, _options?) =>
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

            return { stdout: "", stderr: "", exitCode: 0 };
          }),
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

    it("passes configured timeout to brew source installs", async () => {
      const observedTimeouts: Array<unknown> = [];

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
        install: (_brew, options?) =>
          Effect.sync(() => {
            observedTimeouts.push(options?.timeout);
          }),
      };

      const plan = await Effect.runPromise(topologicalSort([makeBrewItem("a", { timeout: 1234 })]));

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

      expect(observedTimeouts).toEqual([1234]);
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
