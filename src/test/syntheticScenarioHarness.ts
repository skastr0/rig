import { FileSystem } from "@effect/platform";
import { Effect, Layer } from "effect";
import * as Path from "node:path";
import type { ConfigSource } from "../configSource.js";
import type { ExecutionMode } from "../executionMode.js";
import { resolveExecutionMode } from "../executionMode.js";
import { BrewError, GitError, ShellError } from "../errors.js";
import { Executor, ExecutorLive, type ExecutionResult } from "../engine/Executor.js";
import { topologicalSort, type PlanResult } from "../engine/Planner.js";
import { selectItems, type SelectionOptions } from "../engine/Selection.js";
import type { BrewInstall, GitInstall, SystemItem } from "../schema/config.js";
import { BackupService, type BackupResult } from "../services/BackupService.js";
import { BrewService } from "../services/BrewService.js";
import { GitService } from "../services/GitService.js";
import { ShellService, type ShellResult } from "../services/ShellService.js";
import { expandPath } from "../utils.js";

/**
 * Reusable synthetic scenario harness for selection -> planning -> execution tests.
 *
 * Keep each scenario locally readable: define config items inline in the test, describe only the
 * initial machine state that matters, then assert at the pipeline boundary.
 *
 * Extension points for future contributors:
 * - add a focused item builder below when a new install strategy needs one
 * - extend the matching mock service only where that strategy mutates machine state
 * - prefer exact command or service behaviors over bespoke per-test layers
 */

export type MockFsNode =
  | { readonly type: "Directory" }
  | { readonly type: "File" }
  | { readonly type: "SymbolicLink"; readonly target: string };

export interface SyntheticFailure {
  readonly reason: string;
  readonly exitCode?: number;
  readonly timedOut?: boolean;
  readonly timeoutMs?: number;
}

export interface SyntheticCommandBehavior {
  readonly stdout?: string;
  readonly stderr?: string;
  readonly installItems?: readonly string[];
  readonly fail?: SyntheticFailure;
}

export interface SyntheticBrewBehavior {
  readonly fail?: SyntheticFailure;
}

export interface SyntheticGitBehavior {
  readonly fail?: SyntheticFailure;
  readonly entries?: Readonly<Record<string, MockFsNode>>;
}

export interface SyntheticMachineStateInput {
  readonly installedItems?: readonly string[];
  readonly brewInstalled?: readonly string[];
  readonly fileSystem?: Readonly<Record<string, MockFsNode>>;
  readonly commandBehaviors?: Readonly<Record<string, SyntheticCommandBehavior>>;
  readonly brewBehaviors?: Readonly<Record<string, SyntheticBrewBehavior>>;
  readonly gitBehaviors?: Readonly<Record<string, SyntheticGitBehavior>>;
}

export interface SyntheticMachineSnapshot {
  readonly installedItems: readonly string[];
  readonly brewInstalled: readonly string[];
  readonly gitClones: readonly {
    readonly repo: string;
    readonly path: string;
  }[];
  readonly backups: readonly string[];
  readonly fileSystem: readonly {
    readonly path: string;
    readonly node: MockFsNode;
  }[];
}

interface SyntheticFileSystem extends FileSystem.FileSystem {
  readonly entries: Map<string, MockFsNode>;
  readonly setEntry: (path: string, entry: MockFsNode) => void;
}

export interface SyntheticMachineState {
  readonly installedItems: Set<string>;
  readonly brewInstalled: Set<string>;
  readonly gitClones: Array<{
    readonly repo: string;
    readonly path: string;
  }>;
  readonly backups: string[];
  readonly shellCommands: string[];
  readonly brewOperations: string[];
  readonly gitOperations: Array<{
    readonly repo: string;
    readonly path: string;
  }>;
  readonly fileSystem: SyntheticFileSystem;
}

interface SyntheticMachineRuntimeState extends SyntheticMachineState {
  readonly commandBehaviors: Readonly<Record<string, SyntheticCommandBehavior>>;
  readonly brewBehaviors: Readonly<Record<string, SyntheticBrewBehavior>>;
  readonly gitBehaviors: Readonly<Record<string, SyntheticGitBehavior>>;
}

export interface SyntheticItemOptions {
  readonly dependsOn?: readonly string[];
  readonly tags?: readonly string[];
  readonly group?: string;
  readonly backup?: string;
  readonly update?: string;
  readonly timeout?: number;
}

export interface SyntheticShellItemOptions extends SyntheticItemOptions {
  readonly check?: string;
  readonly onCheck?: "exit-code" | "path-exists";
}

export interface SyntheticBrewItemDefinition {
  readonly formula?: string;
  readonly cask?: string;
  readonly tap?: string;
  readonly args?: readonly string[];
}

export interface SyntheticBrewItemOptions extends SyntheticItemOptions {
  readonly check?: string;
}

export interface SyntheticGitItemDefinition {
  readonly repo: string;
  readonly path: string;
  readonly branch?: string;
  readonly sparse?: readonly string[];
}

export interface SyntheticScenarioExecutionOptions {
  readonly dryRun?: boolean;
  readonly apply?: boolean;
  readonly update?: boolean;
  readonly verbose?: boolean;
}

export interface SyntheticScenario {
  readonly items: readonly SystemItem[];
  readonly selection?: Partial<SelectionOptions>;
  readonly source?: ConfigSource;
  readonly execution?: SyntheticScenarioExecutionOptions;
  readonly machine?: SyntheticMachineStateInput;
}

export interface SyntheticScenarioRun {
  readonly selectedItems: readonly SystemItem[];
  readonly plan: PlanResult;
  readonly executionMode: ExecutionMode;
  readonly results: readonly ExecutionResult[];
  readonly progress: readonly ExecutionResult[];
  readonly verbose: readonly string[];
  readonly machineState: SyntheticMachineState;
  readonly snapshots: {
    readonly before: SyntheticMachineSnapshot;
    readonly after: SyntheticMachineSnapshot;
  };
}

export const normalizeSyntheticPath = (path: string): string =>
  Path.normalize(Path.resolve(expandPath(path)));

const cloneNode = (node: MockFsNode): MockFsNode => {
  switch (node.type) {
    case "Directory":
      return { type: "Directory" };
    case "File":
      return { type: "File" };
    case "SymbolicLink":
      return { type: "SymbolicLink", target: node.target };
  }
};

const createMockFileSystem = (
  entries: Readonly<Record<string, MockFsNode>> = {},
): SyntheticFileSystem => {
  const state = new Map<string, MockFsNode>();

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
    const normalizedPath = normalizeSyntheticPath(path);
    ensureParentDirectories(normalizedPath);
    state.set(normalizedPath, cloneNode(entry));
  };

  for (const [path, entry] of Object.entries(entries)) {
    setEntry(path, entry);
  }

  return {
    entries: state,
    setEntry,
    exists: (path: string) => Effect.succeed(state.has(normalizeSyntheticPath(path))),
    stat: (path: string) =>
      Effect.gen(function* () {
        const entry = state.get(normalizeSyntheticPath(path));

        if (!entry) {
          return yield* Effect.fail(new Error(`Path not found: ${path}`));
        }

        return { type: entry.type };
      }),
    makeDirectory: (path: string, options?: { recursive?: boolean }) =>
      Effect.sync(() => {
        const normalizedPath = normalizeSyntheticPath(path);

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
        const normalizedPath = normalizeSyntheticPath(path);
        const parentPath = Path.dirname(normalizedPath);
        const parent = state.get(parentPath);

        if (parentPath !== normalizedPath && (!parent || parent.type !== "Directory")) {
          throw new Error(`Parent directory missing: ${parentPath}`);
        }

        if (state.has(normalizedPath)) {
          throw new Error(`Path already exists: ${normalizedPath}`);
        }

        state.set(normalizedPath, {
          type: "SymbolicLink",
          target,
        });
      }),
    readLink: (path: string) =>
      Effect.gen(function* () {
        const entry = state.get(normalizeSyntheticPath(path));

        if (!entry || entry.type !== "SymbolicLink") {
          return yield* Effect.fail(new Error(`Path is not a symlink: ${path}`));
        }

        return entry.target;
      }),
    remove: (path: string, options?: { recursive?: boolean }) =>
      Effect.sync(() => {
        const normalizedPath = normalizeSyntheticPath(path);
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
  } as unknown as SyntheticFileSystem;
};

const buildItem = (
  base: Pick<SystemItem, "name" | "check" | "install"> & {
    readonly onCheck?: "exit-code" | "path-exists";
  },
  options: SyntheticItemOptions = {},
): SystemItem => ({
  name: base.name,
  check: base.check,
  install: base.install,
  ...(base.onCheck ? { onCheck: base.onCheck } : {}),
  ...(options.dependsOn ? { dependsOn: [...options.dependsOn] } : {}),
  ...(options.tags ? { tags: [...options.tags] } : {}),
  ...(options.group ? { group: options.group } : {}),
  ...(options.backup ? { backup: options.backup } : {}),
  ...(options.update ? { update: options.update } : {}),
  ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
});

export const shellItem = (
  name: string,
  install: string,
  options: SyntheticShellItemOptions = {},
): SystemItem =>
  buildItem(
    {
      name,
      check: options.check ?? `which ${name}`,
      install,
      ...(options.onCheck ? { onCheck: options.onCheck } : {}),
    },
    options,
  );

export const brewItem = (
  name: string,
  install: SyntheticBrewItemDefinition,
  options: SyntheticBrewItemOptions = {},
): SystemItem =>
  buildItem(
    {
      name,
      check: options.check ?? `which ${name}`,
      install: {
        source: "brew",
        ...(install.formula ? { formula: install.formula } : {}),
        ...(install.cask ? { cask: install.cask } : {}),
        ...(install.tap ? { tap: install.tap } : {}),
        ...(install.args ? { args: [...install.args] } : {}),
      } satisfies BrewInstall,
    },
    options,
  );

export const dirItem = (
  name: string,
  path: string,
  options: SyntheticItemOptions = {},
): SystemItem =>
  buildItem(
    {
      name,
      check: path,
      onCheck: "path-exists",
      install: {
        source: "dir",
        path,
      },
    },
    options,
  );

export const symlinkItem = (
  name: string,
  path: string,
  target: string,
  options: SyntheticItemOptions = {},
): SystemItem =>
  buildItem(
    {
      name,
      check: path,
      onCheck: "path-exists",
      install: {
        source: "symlink",
        path,
        target,
      },
    },
    options,
  );

export const gitItem = (
  name: string,
  install: SyntheticGitItemDefinition,
  options: SyntheticItemOptions = {},
): SystemItem =>
  buildItem(
    {
      name,
      check: install.path,
      onCheck: "path-exists",
      install: {
        source: "git",
        repo: install.repo,
        path: install.path,
        ...(install.branch ? { branch: install.branch } : {}),
        ...(install.sparse ? { sparse: [...install.sparse] } : {}),
      } satisfies GitInstall,
    },
    options,
  );

export const snapshotSyntheticMachineState = (
  machineState: SyntheticMachineState,
): SyntheticMachineSnapshot => ({
  installedItems: [...machineState.installedItems].sort(),
  brewInstalled: [...machineState.brewInstalled].sort(),
  gitClones: [...machineState.gitClones].sort((left, right) =>
    left.path === right.path
      ? left.repo.localeCompare(right.repo)
      : left.path.localeCompare(right.path),
  ),
  backups: [...machineState.backups].sort(),
  fileSystem: [...machineState.fileSystem.entries.entries()]
    .map(([path, node]) => ({ path, node: cloneNode(node) }))
    .sort((left, right) => left.path.localeCompare(right.path)),
});

const normalizeSelectionOptions = (
  selection: SyntheticScenario["selection"],
): SelectionOptions => ({
  tags: [...(selection?.tags ?? [])],
  only: [...(selection?.only ?? [])],
});

const toShellError = (command: string, failure: SyntheticFailure): ShellError =>
  new ShellError({
    command,
    exitCode: failure.exitCode ?? -1,
    stderr: failure.reason,
    ...(failure.timedOut === undefined ? {} : { timedOut: failure.timedOut }),
    ...(failure.timeoutMs === undefined ? {} : { timeoutMs: failure.timeoutMs }),
  });

const toBrewError = (formulaOrCask: string, failure: SyntheticFailure): BrewError =>
  new BrewError({
    formula_or_cask: formulaOrCask,
    reason: failure.reason,
    ...(failure.timedOut === undefined ? {} : { timedOut: failure.timedOut }),
    ...(failure.timeoutMs === undefined ? {} : { timeoutMs: failure.timeoutMs }),
  });

const toGitError = (repo: string, failure: SyntheticFailure): GitError =>
  new GitError({
    repo,
    reason: failure.reason,
    ...(failure.timedOut === undefined ? {} : { timedOut: failure.timedOut }),
    ...(failure.timeoutMs === undefined ? {} : { timeoutMs: failure.timeoutMs }),
  });

const createSyntheticMachineState = (
  input: SyntheticMachineStateInput = {},
): SyntheticMachineRuntimeState => ({
  installedItems: new Set(input.installedItems ?? []),
  brewInstalled: new Set(input.brewInstalled ?? []),
  gitClones: [],
  backups: [],
  shellCommands: [],
  brewOperations: [],
  gitOperations: [],
  fileSystem: createMockFileSystem(input.fileSystem),
  commandBehaviors: input.commandBehaviors ?? {},
  brewBehaviors: input.brewBehaviors ?? {},
  gitBehaviors: input.gitBehaviors ?? {},
});

const successShellResult = (stdout = "", stderr = ""): ShellResult => ({
  stdout,
  stderr,
  exitCode: 0,
});

const createSyntheticLayer = (machineState: SyntheticMachineRuntimeState) => {
  const shellService: ShellService = {
    run: (command, _options?) =>
      Effect.gen(function* () {
        machineState.shellCommands.push(command);

        if (command.startsWith("which ")) {
          const item = command.replace("which ", "");

          if (machineState.installedItems.has(item)) {
            return successShellResult(`/usr/bin/${item}`);
          }

          return yield* Effect.fail(
            new ShellError({
              command,
              exitCode: 1,
              stderr: `${item} not found`,
            }),
          );
        }

        const behavior = machineState.commandBehaviors[command];
        if (behavior?.fail) {
          return yield* Effect.fail(toShellError(command, behavior.fail));
        }

        if (command.startsWith("brew install ")) {
          const item = command.replace("brew install ", "");
          machineState.installedItems.add(item);
          return successShellResult(`Installed ${item}`);
        }

        if (command.startsWith("brew upgrade ")) {
          const item = command.replace("brew upgrade ", "");
          if (!machineState.installedItems.has(item)) {
            return yield* Effect.fail(
              new ShellError({
                command,
                exitCode: 1,
                stderr: `${item} not installed`,
              }),
            );
          }

          return successShellResult(`Upgraded ${item}`);
        }

        for (const installedItem of behavior?.installItems ?? []) {
          machineState.installedItems.add(installedItem);
        }

        return successShellResult(
          behavior?.stdout ?? `Executed: ${command}`,
          behavior?.stderr ?? "",
        );
      }),
    exec: (_command, _args, _options?) => Effect.succeed(successShellResult()),
  };

  const backupService: BackupService = {
    backup: (path) =>
      Effect.sync(() => {
        machineState.backups.push(path);
        return {
          source: path,
          destination: `/backup/${path}`,
          skipped: false,
        } satisfies BackupResult;
      }),
  };

  const brewService: BrewService = {
    install: (brew, _options?) =>
      Effect.gen(function* () {
        const formulaOrCask = brew.formula ?? brew.cask ?? "unknown";
        machineState.brewOperations.push(formulaOrCask);

        const behavior = machineState.brewBehaviors[formulaOrCask];
        if (behavior?.fail) {
          return yield* Effect.fail(toBrewError(formulaOrCask, behavior.fail));
        }

        machineState.brewInstalled.add(formulaOrCask);
        machineState.installedItems.add(formulaOrCask);
      }),
  };

  const gitService: GitService = {
    clone: (install, _options?) =>
      Effect.gen(function* () {
        const normalizedPath = normalizeSyntheticPath(install.path);
        machineState.gitOperations.push({ repo: install.repo, path: normalizedPath });

        const behavior =
          machineState.gitBehaviors[normalizedPath] ?? machineState.gitBehaviors[install.repo];
        if (behavior?.fail) {
          return yield* Effect.fail(toGitError(install.repo, behavior.fail));
        }

        machineState.gitClones.push({ repo: install.repo, path: normalizedPath });
        machineState.fileSystem.setEntry(install.path, { type: "Directory" });

        for (const [path, entry] of Object.entries(behavior?.entries ?? {})) {
          machineState.fileSystem.setEntry(path, entry);
        }
      }),
  };

  return Layer.mergeAll(
    Layer.succeed(ShellService, shellService),
    Layer.succeed(BackupService, backupService),
    Layer.succeed(BrewService, brewService),
    Layer.succeed(GitService, gitService),
    Layer.succeed(FileSystem.FileSystem, machineState.fileSystem),
    ExecutorLive,
  );
};

export const runSyntheticScenario = async (
  scenario: SyntheticScenario,
): Promise<SyntheticScenarioRun> => {
  const source = scenario.source ?? { _tag: "local", path: "./synthetic-scenario.json" };
  const executionOptions = scenario.execution ?? {};
  const selection = normalizeSelectionOptions(scenario.selection);
  const machineState = createSyntheticMachineState(scenario.machine);
  const executionMode = resolveExecutionMode(source, {
    dryRun: executionOptions.dryRun ?? false,
    apply: executionOptions.apply ?? false,
  });
  const selectedItems = selectItems(scenario.items, selection);
  const plan = await Effect.runPromise(topologicalSort(selectedItems));
  const progress: ExecutionResult[] = [];
  const verbose: string[] = [];
  const before = snapshotSyntheticMachineState(machineState);

  const results = await Effect.runPromise(
    Effect.gen(function* () {
      const executor = yield* Executor;

      return yield* executor.execute(plan, {
        dryRun: executionMode.dryRun,
        ...(executionOptions.update === undefined ? {} : { update: executionOptions.update }),
        ...(executionOptions.verbose === undefined ? {} : { verbose: executionOptions.verbose }),
        onProgress: (result) => progress.push(result),
        onVerbose: (message) => verbose.push(message),
      });
    }).pipe(Effect.provide(createSyntheticLayer(machineState))),
  );

  return {
    selectedItems,
    plan,
    executionMode,
    results,
    progress,
    verbose,
    machineState,
    snapshots: {
      before,
      after: snapshotSyntheticMachineState(machineState),
    },
  };
};
