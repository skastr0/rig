import { Context, Effect, Layer, Ref, Deferred } from "effect";
import { FileSystem } from "@effect/platform";
import * as Path from "node:path";
import type {
  SystemItem,
  GitInstall,
  BrewInstall,
  DirInstall,
  SymlinkInstall,
  SkillsInstall,
  TimeoutInput as ItemTimeoutInput,
} from "../schema/config.js";
import type { PlanResult } from "./Planner.js";
import { ShellService, type ShellResult } from "../services/ShellService.js";
import { BackupService } from "../services/BackupService.js";
import { GitService } from "../services/GitService.js";
import { BrewService } from "../services/BrewService.js";
import { ShellError, GitError, BrewError, BackupError, FileSystemInstallError } from "../errors.js";
import { expandPath } from "../utils.js";

export type ItemStatus = "installed" | "missing" | "error" | "blocked";
export type ItemAction =
  | "skipped"
  | "installed"
  | "updated"
  | "would_update"
  | "failed"
  | "timed_out"
  | "blocked";

export interface ExecutionPreview {
  readonly label: string;
  readonly steps: readonly string[];
}

export interface ExecutionResult {
  readonly name: string;
  readonly status: ItemStatus;
  readonly action: ItemAction;
  readonly backed_up?: string;
  readonly detail?: string;
  readonly preview?: ExecutionPreview;
  readonly error?: string;
}

export type InspectionStatus = "installed" | "missing" | "updateable" | "blocked" | "error";

export interface InspectionResult {
  readonly name: string;
  readonly status: InspectionStatus;
  readonly detail?: string;
  readonly reason?: string;
}

interface ReadyInspectionResult extends InspectionResult {
  readonly readyForExecution: boolean;
}

export interface InspectionOptions {
  readonly verbose?: boolean;
  readonly onVerbose?: (message: string) => void;
}

export interface ExecutorOptions {
  readonly dryRun?: boolean;
  readonly update?: boolean;
  readonly verbose?: boolean;
  readonly onProgress?: (result: ExecutionResult) => void;
  readonly onVerbose?: (message: string) => void;
}

export interface Executor {
  readonly execute: (
    plan: PlanResult,
    options?: ExecutorOptions,
  ) => Effect.Effect<
    readonly ExecutionResult[],
    never,
    ShellService | BackupService | GitService | BrewService | FileSystem.FileSystem
  >;
  readonly inspect: (
    plan: PlanResult,
    options?: InspectionOptions,
  ) => Effect.Effect<readonly InspectionResult[], never, ShellService | FileSystem.FileSystem>;
}

export const Executor = Context.GenericTag<Executor>("Executor");

const isGitInstall = (install: SystemItem["install"]): install is GitInstall =>
  typeof install === "object" && install.source === "git";

const isBrewInstall = (install: SystemItem["install"]): install is BrewInstall =>
  typeof install === "object" && install.source === "brew";

const isDirInstall = (install: SystemItem["install"]): install is DirInstall =>
  typeof install === "object" && install.source === "dir";

const isSymlinkInstall = (install: SystemItem["install"]): install is SymlinkInstall =>
  typeof install === "object" && install.source === "symlink";

const isSkillsInstall = (install: SystemItem["install"]): install is SkillsInstall =>
  typeof install === "object" && install.source === "skills";

const formatCommand = (command: string, args: readonly string[] = []): string =>
  args.length > 0 ? `${command} ${args.join(" ")}` : command;

const normalizeManagedPath = (path: string): string =>
  Path.normalize(Path.resolve(expandPath(path)));

const normalizeSymlinkTargetForComparison = (linkPath: string, target: string): string =>
  Path.normalize(
    Path.resolve(
      Path.dirname(linkPath),
      Path.isAbsolute(expandPath(target)) ? expandPath(target) : target,
    ),
  );

const getSymlinkLinkPath = (install: SymlinkInstall): string => normalizeManagedPath(install.path);

const getSymlinkDisplayTarget = (install: SymlinkInstall): string =>
  normalizeSymlinkTargetForComparison(getSymlinkLinkPath(install), install.target);

const getSymlinkTargetForCreate = (target: string): string => {
  const expandedTarget = expandPath(target);
  return Path.isAbsolute(expandedTarget)
    ? Path.normalize(Path.resolve(expandedTarget))
    : Path.normalize(target);
};

const GLOBAL_SKILLS_PATH_BY_AGENT = new Map<string, string>([
  ["adal", "~/.adal/skills"],
  ["amp", "~/.config/agents/skills"],
  ["antigravity", "~/.gemini/antigravity/skills"],
  ["augment", "~/.augment/skills"],
  ["bob", "~/.bob/skills"],
  ["claude-code", "~/.claude/skills"],
  ["cline", "~/.agents/skills"],
  ["codebuddy", "~/.codebuddy/skills"],
  ["codex", "~/.codex/skills"],
  ["command-code", "~/.commandcode/skills"],
  ["continue", "~/.continue/skills"],
  ["cortex", "~/.snowflake/cortex/skills"],
  ["crush", "~/.config/crush/skills"],
  ["cursor", "~/.cursor/skills"],
  ["deepagents", "~/.deepagents/agent/skills"],
  ["droid", "~/.factory/skills"],
  ["firebender", "~/.firebender/skills"],
  ["gemini-cli", "~/.gemini/skills"],
  ["github-copilot", "~/.copilot/skills"],
  ["goose", "~/.config/goose/skills"],
  ["iflow-cli", "~/.iflow/skills"],
  ["junie", "~/.junie/skills"],
  ["kilo", "~/.kilocode/skills"],
  ["kimi-cli", "~/.config/agents/skills"],
  ["kiro-cli", "~/.kiro/skills"],
  ["kode", "~/.kode/skills"],
  ["mcpjam", "~/.mcpjam/skills"],
  ["mistral-vibe", "~/.vibe/skills"],
  ["mux", "~/.mux/skills"],
  ["neovate", "~/.neovate/skills"],
  ["openclaw", "~/.openclaw/skills"],
  ["opencode", "~/.config/opencode/skills"],
  ["openhands", "~/.openhands/skills"],
  ["pi", "~/.pi/agent/skills"],
  ["pochi", "~/.pochi/skills"],
  ["qoder", "~/.qoder/skills"],
  ["qwen-code", "~/.qwen/skills"],
  ["replit", "~/.config/agents/skills"],
  ["roo", "~/.roo/skills"],
  ["trae", "~/.trae/skills"],
  ["trae-cn", "~/.trae-cn/skills"],
  ["universal", "~/.config/agents/skills"],
  ["warp", "~/.agents/skills"],
  ["windsurf", "~/.codeium/windsurf/skills"],
  ["zencoder", "~/.zencoder/skills"],
]);

const getGlobalSkillsRoot = (agent: string): string | undefined =>
  GLOBAL_SKILLS_PATH_BY_AGENT.get(agent);

const getSkillPath = (agent: string, skill: string): string | undefined => {
  const root = getGlobalSkillsRoot(agent);
  return root === undefined ? undefined : normalizeManagedPath(Path.join(root, skill, "SKILL.md"));
};

const getSkillsSourceRef = (install: SkillsInstall): string => {
  // npx skills add accepts org/repo or https://github.com/org/repo
  // It does NOT accept /tree/<sha> for commit pinning — that format
  // makes git try --branch <sha> which fails for commit hashes.
  // Just pass the repo directly; the skills CLI resolves it correctly.
  return install.repo;
};

const getSkillsAddArgs = (install: SkillsInstall): readonly string[] => [
  "DISABLE_TELEMETRY=1",
  "npx",
  "--yes",
  install.package,
  "add",
  getSkillsSourceRef(install),
  ...install.skills.flatMap((skill) => ["--skill", skill]),
  ...install.agents.flatMap((agent) => ["--agent", agent]),
  "--global",
  ...(install.mode === "symlink" ? [] : ["--copy"]),
  "--yes",
];

const getSkillsAddCommand = (install: SkillsInstall): string =>
  formatCommand("env", getSkillsAddArgs(install));

const describePathType = (type: string): string => {
  switch (type) {
    case "Directory":
      return "directory";
    case "File":
      return "file";
    case "SymbolicLink":
      return "symlink";
    default:
      return type.toLowerCase();
  }
};

const formatUnknownError = (error: unknown): string => {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = error.message;
    if (typeof message === "string" && message.trim().length > 0) {
      return message;
    }
  }

  return String(error);
};

const toFileSystemInstallError = (path: string, reason: string): FileSystemInstallError =>
  new FileSystemInstallError({ path, reason });

const mapFileSystemError =
  (path: string, context: string) =>
  (error: unknown): FileSystemInstallError =>
    toFileSystemInstallError(path, `${context}: ${formatUnknownError(error)}`);

const getCheckDescription = (item: SystemItem): string => {
  if (isDirInstall(item.install)) {
    return normalizeManagedPath(item.install.path);
  }

  if (isSymlinkInstall(item.install)) {
    return `${getSymlinkLinkPath(item.install)} -> ${getSymlinkDisplayTarget(item.install)}`;
  }

  if (isSkillsInstall(item.install)) {
    const install = item.install;
    return install.agents
      .flatMap((agent) =>
        install.skills.map((skill) => getSkillPath(agent, skill) ?? `${agent}:${skill}`),
      )
      .join(", ");
  }

  return item.check ?? "";
};

type ItemCheckResult =
  | { type: "installed" }
  | { type: "missing" }
  | { type: "needs_update"; reason: string };

const getInstallPreviewSteps = (install: SystemItem["install"]): readonly string[] => {
  if (typeof install === "string") {
    return [install];
  }

  if (isDirInstall(install)) {
    return [`create directory ${normalizeManagedPath(install.path)}`];
  }

  if (isSymlinkInstall(install)) {
    const linkPath = getSymlinkLinkPath(install);
    const targetPath = getSymlinkDisplayTarget(install);
    return [`create symlink ${linkPath} -> ${targetPath}`];
  }

  if (isBrewInstall(install)) {
    const commands: string[] = [];
    if (install.tap) {
      commands.push(formatCommand("brew", ["tap", install.tap]));
    }

    if (install.formula) {
      commands.push(formatCommand("brew", ["install", install.formula, ...(install.args ?? [])]));
      return commands;
    }

    if (install.cask) {
      commands.push(
        formatCommand("brew", ["install", "--cask", install.cask, ...(install.args ?? [])]),
      );
      return commands;
    }

    return commands;
  }

  if (isGitInstall(install)) {
    const targetPath = expandPath(install.path);

    if (install.sparse && install.sparse.length > 0) {
      const cloneArgs = ["clone", "--filter=blob:none", "--no-checkout"];
      if (install.branch) {
        cloneArgs.push("-b", install.branch);
      }
      cloneArgs.push(install.repo, targetPath);

      return [
        formatCommand("git", cloneArgs),
        formatCommand("git", ["-C", targetPath, "sparse-checkout", "init", "--cone"]),
        formatCommand("git", ["-C", targetPath, "sparse-checkout", "set", ...install.sparse]),
        formatCommand("git", ["-C", targetPath, "checkout"]),
      ];
    }

    const cloneArgs = ["clone"];
    if (install.branch) {
      cloneArgs.push("-b", install.branch);
    }
    cloneArgs.push(install.repo, targetPath);

    return [formatCommand("git", cloneArgs)];
  }

  if (isSkillsInstall(install)) {
    return [getSkillsAddCommand(install)];
  }

  return [];
};

const getInstallPreview = (install: SystemItem["install"]): ExecutionPreview => ({
  label:
    typeof install === "string"
      ? "shell install command"
      : `structured install (${install.source})`,
  steps: getInstallPreviewSteps(install),
});

const getManagedUpdatePreviewSteps = (install: SymlinkInstall): readonly string[] => {
  const linkPath = getSymlinkLinkPath(install);
  const targetPath = getSymlinkDisplayTarget(install);
  return [`update symlink ${linkPath} -> ${targetPath}`];
};

const getManagedUpdatePreview = (install: SymlinkInstall): ExecutionPreview => ({
  label: "structured update (symlink)",
  steps: getManagedUpdatePreviewSteps(install),
});

const getExecutionDetail = (install: SystemItem["install"]): string | undefined => {
  if (isDirInstall(install) || isSymlinkInstall(install) || isSkillsInstall(install)) {
    return getInstallPreviewSteps(install)[0];
  }

  return undefined;
};

const getManagedUpdateDetail = (install: SymlinkInstall): string =>
  getManagedUpdatePreviewSteps(install)[0]!;

const getShellUpdatePreview = (command: string): ExecutionPreview => ({
  label: "shell update command",
  steps: [command],
});

const emitVerbose = (options: ExecutorOptions | undefined, message: string): void => {
  if (options?.verbose) {
    options.onVerbose?.(message);
  }
};

const emitCommandStream = (
  itemName: string,
  stream: "stdout" | "stderr",
  output: string,
  options: ExecutorOptions | undefined,
): void => {
  const normalized = output.trimEnd();
  if (normalized.trim().length === 0) {
    return;
  }

  for (const line of normalized.split(/\r?\n/)) {
    emitVerbose(options, `[${itemName}] ${stream}: ${line}`);
  }
};

const emitCommandOutput = (
  itemName: string,
  result: ShellResult,
  options: ExecutorOptions | undefined,
): void => {
  emitCommandStream(itemName, "stdout", result.stdout, options);
  emitCommandStream(itemName, "stderr", result.stderr, options);
};

const toTimeoutOptions = (
  timeout: ItemTimeoutInput | undefined,
): { timeout: ItemTimeoutInput } | undefined => (timeout === undefined ? undefined : { timeout });

const runShellCommand = (
  itemName: string,
  command: string,
  shell: ShellService,
  timeout: SystemItem["timeout"],
  options: ExecutorOptions | undefined,
): Effect.Effect<ShellResult, ShellError> =>
  shell
    .run(command, toTimeoutOptions(timeout))
    .pipe(Effect.tap((result) => Effect.sync(() => emitCommandOutput(itemName, result, options))));

const checkGenericItem = (
  item: SystemItem,
  shell: ShellService,
): Effect.Effect<boolean, ShellError, FileSystem.FileSystem> => {
  const checkMode = item.onCheck ?? "exit-code";
  const check = item.check ?? "";

  if (checkMode === "path-exists") {
    return Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const expandedPath = expandPath(check);
      return yield* fs.exists(expandedPath).pipe(Effect.catchAll(() => Effect.succeed(false)));
    });
  }

  return shell.run(check, toTimeoutOptions(item.timeout)).pipe(
    Effect.map(() => true),
    Effect.catchAll((error) => (error.timedOut ? Effect.fail(error) : Effect.succeed(false))),
  );
};

const checkSkillsInstall = (
  install: SkillsInstall,
): Effect.Effect<ItemCheckResult, FileSystemInstallError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    for (const agent of install.agents) {
      if (getGlobalSkillsRoot(agent) === undefined) {
        return yield* Effect.fail(
          toFileSystemInstallError(
            agent,
            `Unsupported skills agent "${agent}". Add its global skills path before using it in a skills install source.`,
          ),
        );
      }

      for (const skill of install.skills) {
        const skillPath = getSkillPath(agent, skill)!;
        const exists = yield* fs
          .exists(skillPath)
          .pipe(
            Effect.mapError(
              mapFileSystemError(skillPath, `Failed to inspect installed skill "${skill}"`),
            ),
          );

        if (!exists) {
          return { type: "missing" };
        }
      }
    }

    return { type: "installed" };
  });

const checkDirInstall = (
  install: DirInstall,
): Effect.Effect<ItemCheckResult, FileSystemInstallError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = normalizeManagedPath(install.path);
    const exists = yield* fs
      .exists(path)
      .pipe(
        Effect.mapError(mapFileSystemError(path, `Failed to inspect directory path "${path}"`)),
      );

    if (!exists) {
      return { type: "missing" };
    }

    const stat = yield* fs
      .stat(path)
      .pipe(
        Effect.mapError(mapFileSystemError(path, `Failed to inspect directory path "${path}"`)),
      );

    if (stat.type === "Directory") {
      return { type: "installed" };
    }

    return yield* Effect.fail(
      toFileSystemInstallError(
        path,
        `Expected directory at "${path}", but found ${describePathType(stat.type)}. Remove or rename the existing path, or choose a different dir path.`,
      ),
    );
  });

const checkSymlinkInstall = (
  install: SymlinkInstall,
): Effect.Effect<ItemCheckResult, FileSystemInstallError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const linkPath = getSymlinkLinkPath(install);
    const targetPath = getSymlinkDisplayTarget(install);
    const parentPath = Path.dirname(linkPath);

    const targetExists = yield* fs
      .exists(targetPath)
      .pipe(
        Effect.mapError(
          mapFileSystemError(targetPath, `Failed to inspect symlink target for "${linkPath}"`),
        ),
      );

    if (!targetExists) {
      return yield* Effect.fail(
        toFileSystemInstallError(
          linkPath,
          `Symlink target "${targetPath}" does not exist. Create the target first or update install.target.`,
        ),
      );
    }

    const parentExists = yield* fs
      .exists(parentPath)
      .pipe(
        Effect.mapError(
          mapFileSystemError(parentPath, `Failed to inspect parent directory for "${linkPath}"`),
        ),
      );

    if (!parentExists) {
      return yield* Effect.fail(
        toFileSystemInstallError(
          linkPath,
          `Parent directory "${parentPath}" is missing for symlink "${linkPath}". Add a dir item or dependency before this symlink.`,
        ),
      );
    }

    const linkExists = yield* fs
      .exists(linkPath)
      .pipe(
        Effect.mapError(
          mapFileSystemError(linkPath, `Failed to inspect symlink path "${linkPath}"`),
        ),
      );

    if (!linkExists) {
      return { type: "missing" };
    }

    const stat = yield* fs
      .stat(linkPath)
      .pipe(
        Effect.mapError(
          mapFileSystemError(linkPath, `Failed to inspect symlink path "${linkPath}"`),
        ),
      );

    if (stat.type === "SymbolicLink") {
      const currentTarget = yield* fs
        .readLink(linkPath)
        .pipe(
          Effect.mapError(
            mapFileSystemError(
              linkPath,
              `Failed to read existing symlink target for "${linkPath}"`,
            ),
          ),
        );
      const normalizedCurrentTarget = normalizeSymlinkTargetForComparison(linkPath, currentTarget);

      if (normalizedCurrentTarget === targetPath) {
        return { type: "installed" };
      }

      return {
        type: "needs_update",
        reason: `Symlink "${linkPath}" points to "${normalizedCurrentTarget}" instead of "${targetPath}". Re-run with --update to replace it, or fix the existing link manually.`,
      };
    }

    return {
      type: "needs_update",
      reason: `Path "${linkPath}" exists as a ${describePathType(stat.type)}, not the desired symlink to "${targetPath}". Re-run with --update to replace it, or move/remove the existing path manually.`,
    };
  });

const checkItem = (
  item: SystemItem,
  shell: ShellService,
): Effect.Effect<ItemCheckResult, ShellError | FileSystemInstallError, FileSystem.FileSystem> => {
  if (isDirInstall(item.install)) {
    return checkDirInstall(item.install);
  }

  if (isSymlinkInstall(item.install)) {
    return checkSymlinkInstall(item.install);
  }

  if (isSkillsInstall(item.install)) {
    return checkSkillsInstall(item.install);
  }

  return checkGenericItem(item, shell).pipe(
    Effect.map((isInstalled) => (isInstalled ? { type: "installed" } : { type: "missing" })),
  );
};

const installDirItem = (
  install: DirInstall,
  fs: FileSystem.FileSystem,
): Effect.Effect<void, FileSystemInstallError> => {
  const path = normalizeManagedPath(install.path);
  return fs
    .makeDirectory(path, { recursive: true })
    .pipe(Effect.mapError(mapFileSystemError(path, `Failed to create directory "${path}"`)));
};

const createSymlink = (
  install: SymlinkInstall,
  fs: FileSystem.FileSystem,
): Effect.Effect<void, FileSystemInstallError> => {
  const linkPath = getSymlinkLinkPath(install);
  const rawTarget = getSymlinkTargetForCreate(install.target);
  const displayTarget = getSymlinkDisplayTarget(install);

  return fs
    .symlink(rawTarget, linkPath)
    .pipe(
      Effect.mapError(
        mapFileSystemError(
          linkPath,
          `Failed to create symlink "${linkPath}" -> "${displayTarget}"`,
        ),
      ),
    );
};

const updateSymlinkItem = (
  install: SymlinkInstall,
  fs: FileSystem.FileSystem,
): Effect.Effect<void, FileSystemInstallError> => {
  const linkPath = getSymlinkLinkPath(install);

  return Effect.gen(function* () {
    yield* fs
      .remove(linkPath, { recursive: true })
      .pipe(
        Effect.mapError(
          mapFileSystemError(
            linkPath,
            `Failed to remove existing path at "${linkPath}" before updating symlink`,
          ),
        ),
      );
    yield* createSymlink(install, fs);
  });
};

const installItem = (
  item: SystemItem,
  shell: ShellService,
  git: GitService,
  brew: BrewService,
  fs: FileSystem.FileSystem,
  options: ExecutorOptions | undefined,
): Effect.Effect<
  void,
  ShellError | GitError | BrewError | FileSystemInstallError,
  ShellService
> => {
  if (isGitInstall(item.install)) {
    return git.clone(item.install, toTimeoutOptions(item.timeout));
  }

  if (isBrewInstall(item.install)) {
    return brew.install(item.install, toTimeoutOptions(item.timeout));
  }

  if (isDirInstall(item.install)) {
    return installDirItem(item.install, fs);
  }

  if (isSymlinkInstall(item.install)) {
    return createSymlink(item.install, fs);
  }

  if (isSkillsInstall(item.install)) {
    return shell.exec("env", getSkillsAddArgs(item.install), toTimeoutOptions(item.timeout)).pipe(
      Effect.tap((result) => Effect.sync(() => emitCommandOutput(item.name, result, options))),
      Effect.asVoid,
    );
  }

  return runShellCommand(item.name, item.install, shell, item.timeout, options).pipe(Effect.asVoid);
};

const updateItem = (
  item: SystemItem,
  shell: ShellService,
  options: ExecutorOptions | undefined,
): Effect.Effect<void, ShellError, never> => {
  // Update command is always a string (git updates handled via install strategy)
  if (!item.update) {
    return Effect.void;
  }
  return runShellCommand(item.name, item.update, shell, item.timeout, options).pipe(Effect.asVoid);
};

type LockResult =
  | { type: "wait"; lock: Deferred.Deferred<void> }
  | { type: "acquired"; lock: Deferred.Deferred<void> };

const acquireGroupLock = (
  group: string | undefined,
  groupLocks: Ref.Ref<Map<string, Deferred.Deferred<void>>>,
): Effect.Effect<Deferred.Deferred<void> | null> =>
  Effect.gen(function* () {
    if (!group) return null;

    // Create our lock before the atomic operation
    const myLock = yield* Deferred.make<void>();

    // Atomically check-and-set to avoid race condition
    const result: LockResult = yield* Ref.modify(groupLocks, (locks) => {
      const existingLock = locks.get(group);
      if (existingLock) {
        // Return existing lock to wait on, don't modify state
        return [{ type: "wait", lock: existingLock } as LockResult, locks] as const;
      }
      // No existing lock, set ours atomically
      const newLocks = new Map(locks).set(group, myLock);
      return [{ type: "acquired", lock: myLock } as LockResult, newLocks] as const;
    });

    if (result.type === "wait") {
      // Wait for existing lock to complete
      yield* Deferred.await(result.lock);
      // Retry acquisition
      return yield* acquireGroupLock(group, groupLocks);
    }

    return result.lock;
  });

const releaseGroupLock = (
  group: string | undefined,
  lock: Deferred.Deferred<void> | null,
  groupLocks: Ref.Ref<Map<string, Deferred.Deferred<void>>>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (!group || !lock) return;

    // Remove our lock from the map
    yield* Ref.update(groupLocks, (locks) => {
      const newLocks = new Map(locks);
      // Only remove if it's still our lock
      if (newLocks.get(group) === lock) {
        newLocks.delete(group);
      }
      return newLocks;
    });

    // Signal completion to any waiters
    yield* Deferred.succeed(lock, undefined);
  });

const executeItem = (
  item: SystemItem,
  options: ExecutorOptions | undefined,
  groupLocks: Ref.Ref<Map<string, Deferred.Deferred<void>>>,
): Effect.Effect<
  ExecutionResult,
  ShellError | GitError | BrewError | BackupError | FileSystemInstallError,
  ShellService | BackupService | GitService | BrewService | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const shell = yield* ShellService;
    const backup = yield* BackupService;
    const git = yield* GitService;
    const brew = yield* BrewService;
    const fs = yield* FileSystem.FileSystem;

    const effectiveGroup = isBrewInstall(item.install)
      ? (item.group ?? "brew")
      : isSkillsInstall(item.install)
        ? (item.group ?? "skills")
        : item.group;

    // Acquire group lock atomically
    const lock = yield* acquireGroupLock(effectiveGroup, groupLocks);

    const executeWithLock = Effect.gen(function* () {
      emitVerbose(options, `[${item.name}] check: ${getCheckDescription(item)}`);
      const itemState = yield* checkItem(item, shell);

      // Case 1: Item is installed
      if (itemState.type === "installed") {
        // Check if we should run update
        if (options?.update && item.update) {
          // Case 1a: Dry run - show what would be updated
          if (options?.dryRun) {
            const preview = getShellUpdatePreview(item.update);

            for (const step of preview.steps) {
              emitVerbose(options, `[${item.name}] would update: ${step}`);
            }

            const result: ExecutionResult = {
              name: item.name,
              status: "installed",
              action: "would_update",
              preview,
            };
            options?.onProgress?.(result);
            return result;
          }

          // Case 1b: Real run - execute update command
          let backedUp: string | undefined;

          if (item.backup) {
            emitVerbose(options, `[${item.name}] backup: ${item.backup}`);
            const backupResult = yield* backup.backup(item.backup);
            if (!backupResult.skipped) {
              backedUp = backupResult.destination;
            }
          }

          emitVerbose(options, `[${item.name}] update: ${item.update}`);
          yield* updateItem(item, shell, options);

          const result: ExecutionResult = backedUp
            ? {
                name: item.name,
                status: "installed",
                action: "updated",
                backed_up: backedUp,
              }
            : {
                name: item.name,
                status: "installed",
                action: "updated",
              };

          options?.onProgress?.(result);
          return result;
        }

        // Case 1c: No update needed - skip
        const result: ExecutionResult = {
          name: item.name,
          status: "installed",
          action: "skipped",
        };
        options?.onProgress?.(result);
        return result;
      }

      if (itemState.type === "needs_update") {
        if (!isSymlinkInstall(item.install)) {
          return yield* Effect.fail(
            toFileSystemInstallError(
              item.name,
              `Unexpected managed update state for item "${item.name}".`,
            ),
          );
        }

        if (!options?.update) {
          return yield* Effect.fail(
            toFileSystemInstallError(getSymlinkLinkPath(item.install), itemState.reason),
          );
        }

        if (options?.dryRun) {
          const preview = getManagedUpdatePreview(item.install);

          for (const step of preview.steps) {
            emitVerbose(options, `[${item.name}] would update: ${step}`);
          }

          const result: ExecutionResult = {
            name: item.name,
            status: "installed",
            action: "would_update",
            detail: getManagedUpdateDetail(item.install),
            preview,
          };
          options?.onProgress?.(result);
          return result;
        }

        let backedUp: string | undefined;

        if (item.backup) {
          emitVerbose(options, `[${item.name}] backup: ${item.backup}`);
          const backupResult = yield* backup.backup(item.backup);
          if (!backupResult.skipped) {
            backedUp = backupResult.destination;
          }
        }

        for (const step of getManagedUpdatePreviewSteps(item.install)) {
          emitVerbose(options, `[${item.name}] update: ${step}`);
        }

        yield* updateSymlinkItem(item.install, fs);

        const result: ExecutionResult = backedUp
          ? {
              name: item.name,
              status: "installed",
              action: "updated",
              backed_up: backedUp,
            }
          : {
              name: item.name,
              status: "installed",
              action: "updated",
            };

        options?.onProgress?.(result);
        return result;
      }

      // Case 2: Item is missing
      if (options?.dryRun) {
        const preview = getInstallPreview(item.install);
        const detail = getExecutionDetail(item.install);

        for (const command of preview.steps) {
          emitVerbose(options, `[${item.name}] would install: ${command}`);
        }

        const result: ExecutionResult = detail
          ? {
              name: item.name,
              status: "missing",
              action: "skipped",
              detail,
              preview,
            }
          : {
              name: item.name,
              status: "missing",
              action: "skipped",
              preview,
            };
        options?.onProgress?.(result);
        return result;
      }

      // Install missing item
      let backedUp: string | undefined;

      if (item.backup) {
        emitVerbose(options, `[${item.name}] backup: ${item.backup}`);
        const backupResult = yield* backup.backup(item.backup);
        if (!backupResult.skipped) {
          backedUp = backupResult.destination;
        }
      }

      const installPreview = getInstallPreview(item.install);

      for (const command of installPreview.steps) {
        emitVerbose(options, `[${item.name}] install: ${command}`);
      }

      yield* installItem(item, shell, git, brew, fs, options);

      const result: ExecutionResult = backedUp
        ? {
            name: item.name,
            status: "installed",
            action: "installed",
            backed_up: backedUp,
          }
        : {
            name: item.name,
            status: "installed",
            action: "installed",
          };

      options?.onProgress?.(result);
      return result;
    });

    // Use ensuring to always release the lock, even on failure/interruption
    return yield* executeWithLock.pipe(
      Effect.ensuring(releaseGroupLock(effectiveGroup, lock, groupLocks)),
    );
  });

const formatReason = (reason: string, fallback: string): string => {
  const trimmed = reason.trim();
  return trimmed.length > 0 ? trimmed : fallback;
};

type ExecutionError = ShellError | GitError | BrewError | BackupError | FileSystemInstallError;

const formatStructuredCommandDetail = (
  error: Pick<GitError | BrewError, "command" | "exitCode" | "stderr">,
): string => {
  const details: string[] = [];

  if (error.command) {
    details.push(`Command: ${error.command}`);
  }

  if (error.exitCode !== undefined && error.exitCode >= 0) {
    details.push(`Exit code: ${error.exitCode}`);
  }

  const stderr = error.stderr?.trim();
  if (stderr && stderr.length > 0) {
    details.push(`Stderr: ${stderr}`);
  }

  return details.length === 0 ? "" : `\n  ${details.join("\n  ")}`;
};

const isTimeoutError = (error: ExecutionError): boolean =>
  ("timedOut" in error && error.timedOut === true) || false;

const formatTimeoutSuffix = (timeoutMs: number | undefined): string =>
  timeoutMs === undefined ? "" : ` after ${timeoutMs}ms`;

const formatError = (error: ExecutionError): string => {
  switch (error._tag) {
    case "ShellError":
      return error.timedOut
        ? `Command "${error.command}" timed out${formatTimeoutSuffix(error.timeoutMs)}: ${formatReason(error.stderr, "No stderr output")}`
        : `Command "${error.command}" failed with exit code ${error.exitCode}: ${formatReason(error.stderr, "No stderr output")}`;
    case "GitError":
      return error.timedOut
        ? `Git operation for ${error.repo} timed out${formatTimeoutSuffix(error.timeoutMs)}: ${formatReason(error.reason, "No reason provided")}${formatStructuredCommandDetail(error)}`
        : `Git error for ${error.repo}: ${formatReason(error.reason, "No reason provided")}${formatStructuredCommandDetail(error)}`;
    case "BrewError":
      return error.timedOut
        ? `Brew operation for ${error.formula_or_cask} timed out${formatTimeoutSuffix(error.timeoutMs)}: ${formatReason(error.reason, "No reason provided")}${formatStructuredCommandDetail(error)}`
        : `Brew error for ${error.formula_or_cask}: ${formatReason(error.reason, "No reason provided")}${formatStructuredCommandDetail(error)}`;
    case "BackupError":
      return `Backup error for ${error.path}: ${formatReason(error.reason, "No reason provided")}`;
    case "FileSystemInstallError":
      return `Filesystem item error for ${error.path}: ${formatReason(error.reason, "No reason provided")}`;
  }
};

const makeExecutionFailureResult = (
  item: SystemItem,
  error: ExecutionError,
  options: ExecutorOptions | undefined,
): ExecutionResult => {
  const result: ExecutionResult = {
    name: item.name,
    status: "error",
    action: isTimeoutError(error) ? "timed_out" : "failed",
    error: formatError(error),
  };

  options?.onProgress?.(result);
  emitVerbose(
    options,
    `[${item.name}] ${result.action === "timed_out" ? "timeout" : "failure"}: ${result.error ?? "Unknown failure"}`,
  );

  return result;
};

const executeLevel = (
  items: readonly SystemItem[],
  options: ExecutorOptions | undefined,
  groupLocks: Ref.Ref<Map<string, Deferred.Deferred<void>>>,
): Effect.Effect<
  readonly ExecutionResult[],
  never,
  ShellService | BackupService | GitService | BrewService | FileSystem.FileSystem
> =>
  Effect.forEach(
    items,
    (item) =>
      executeItem(item, options, groupLocks).pipe(
        Effect.catchAll((error) =>
          Effect.succeed(makeExecutionFailureResult(item, error, options)),
        ),
      ),
    { concurrency: "unbounded" },
  );

const isBlockingAction = (action: ItemAction): boolean =>
  action === "failed" || action === "timed_out" || action === "blocked";

const getBlockingDependencies = (
  item: SystemItem,
  invalidatedItems: ReadonlySet<string>,
): readonly string[] =>
  (item.dependsOn ?? []).filter((dependency) => invalidatedItems.has(dependency));

const formatBlockedReason = (blockedBy: readonly string[]): string =>
  blockedBy.length === 1
    ? `Blocked by unsuccessful dependency: ${blockedBy[0]}`
    : `Blocked by unsuccessful dependencies: ${blockedBy.join(", ")}`;

const makeBlockedResult = (item: SystemItem, blockedBy: readonly string[]): ExecutionResult => ({
  name: item.name,
  status: "blocked",
  action: "blocked",
  error: formatBlockedReason(blockedBy),
});

const formatInspectionBlockedReason = (
  blockedBy: readonly { readonly name: string; readonly status: InspectionStatus }[],
): string => {
  const detail = blockedBy
    .map((dependency) => `${dependency.name} (${dependency.status})`)
    .join(", ");

  return blockedBy.length === 1
    ? `Blocked by dependency that is not ready: ${detail}`
    : `Blocked by dependencies that are not ready: ${detail}`;
};

const toInspectionResult = (
  item: SystemItem,
  itemState: ItemCheckResult,
): ReadyInspectionResult => {
  if (itemState.type === "installed" && item.update) {
    return {
      name: item.name,
      status: "updateable",
      detail: item.update,
      reason: "Update command configured for this installed item.",
      readyForExecution: true,
    };
  }

  if (itemState.type === "installed") {
    return {
      name: item.name,
      status: "installed",
      readyForExecution: true,
    };
  }

  if (itemState.type === "needs_update") {
    const detail = isSymlinkInstall(item.install)
      ? getManagedUpdateDetail(item.install)
      : undefined;

    return {
      name: item.name,
      status: "updateable",
      reason: itemState.reason,
      readyForExecution: false,
      ...(detail === undefined ? {} : { detail }),
    };
  }

  const detail = getExecutionDetail(item.install);

  return {
    name: item.name,
    status: "missing",
    readyForExecution: false,
    ...(detail === undefined ? {} : { detail }),
  };
};

const inspectLevel = (
  level: readonly SystemItem[],
  inspectionByName: ReadonlyMap<string, ReadyInspectionResult>,
  options: InspectionOptions | undefined,
): Effect.Effect<readonly ReadyInspectionResult[], never, ShellService | FileSystem.FileSystem> =>
  Effect.forEach(
    level,
    (item): Effect.Effect<ReadyInspectionResult, never, ShellService | FileSystem.FileSystem> => {
      const blockedBy = (item.dependsOn ?? [])
        .map((dependencyName) => inspectionByName.get(dependencyName))
        .filter(
          (dependency): dependency is ReadyInspectionResult =>
            dependency !== undefined && !dependency.readyForExecution,
        )
        .map((dependency) => ({ name: dependency.name, status: dependency.status }));

      if (blockedBy.length > 0) {
        return Effect.succeed<ReadyInspectionResult>({
          name: item.name,
          status: "blocked",
          reason: formatInspectionBlockedReason(blockedBy),
          readyForExecution: false,
        });
      }

      return Effect.gen(function* () {
        const shell = yield* ShellService;

        emitVerbose(options, `[${item.name}] status check: ${getCheckDescription(item)}`);

        const itemState = yield* checkItem(item, shell).pipe(
          Effect.mapError((error) => formatError(error)),
        );

        return toInspectionResult(item, itemState);
      }).pipe(
        Effect.catchAll((reason) =>
          Effect.succeed<ReadyInspectionResult>({
            name: item.name,
            status: "error",
            reason,
            readyForExecution: false,
          }),
        ),
      );
    },
    { concurrency: "unbounded" },
  );

const stripInspectionReadiness = ({
  readyForExecution: _ready,
  ...result
}: ReadyInspectionResult) => result;

const orderLevelResults = (
  level: readonly SystemItem[],
  levelResults: readonly ExecutionResult[],
): readonly ExecutionResult[] => {
  const byName = new Map(levelResults.map((result) => [result.name, result]));
  return level.map((item) => byName.get(item.name)!);
};

export const ExecutorLive = Layer.succeed(
  Executor,
  Executor.of({
    inspect: (plan, options) =>
      Effect.gen(function* () {
        const inspectionByName = new Map<string, ReadyInspectionResult>();
        const results: InspectionResult[] = [];

        for (const level of plan.levels) {
          const levelResults = yield* inspectLevel(level, inspectionByName, options);

          for (const result of levelResults) {
            inspectionByName.set(result.name, result);
          }

          results.push(...levelResults.map(stripInspectionReadiness));
        }

        return results;
      }),
    execute: (plan, options) =>
      Effect.gen(function* () {
        const groupLocks = yield* Ref.make(new Map<string, Deferred.Deferred<void>>());
        const invalidatedItems = new Set<string>();
        const results: ExecutionResult[] = [];

        for (const level of plan.levels) {
          const blockedResults: ExecutionResult[] = [];
          const runnableItems: SystemItem[] = [];

          for (const item of level) {
            const blockedBy = getBlockingDependencies(item, invalidatedItems);
            if (blockedBy.length > 0) {
              blockedResults.push(makeBlockedResult(item, blockedBy));
            } else {
              runnableItems.push(item);
            }
          }

          for (const result of blockedResults) {
            options?.onProgress?.(result);
            emitVerbose(
              options,
              `[${result.name}] blocked: ${result.error ?? "Dependency failure"}`,
            );
            invalidatedItems.add(result.name);
          }

          const executedResults = yield* executeLevel(runnableItems, options, groupLocks);

          for (const result of executedResults) {
            if (isBlockingAction(result.action)) {
              invalidatedItems.add(result.name);
            }
          }

          results.push(...orderLevelResults(level, [...blockedResults, ...executedResults]));
        }

        return results;
      }),
  }),
);
