import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import * as Path from "node:path";
import type {
  BrewInstall,
  DirInstall,
  GitInstall,
  SkillsInstall,
  SymlinkInstall,
  SystemItem,
} from "../schema/config.js";
import { FileSystemInstallError } from "../errors.js";
import { expandPath } from "../utils.js";
import type { ExecutionPreview, ItemCheckResult } from "./Executor.js";

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

const getSkillsSourceRef = (install: SkillsInstall): string => install.repo;

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

const getDirInstallPreviewSteps = (install: DirInstall): readonly string[] => [
  `create directory ${normalizeManagedPath(install.path)}`,
];

const getSymlinkInstallPreviewSteps = (install: SymlinkInstall): readonly string[] => [
  `create symlink ${getSymlinkLinkPath(install)} -> ${getSymlinkDisplayTarget(install)}`,
];

const getBrewInstallPreviewSteps = (install: BrewInstall): readonly string[] => {
  const commands: string[] = [];
  if (install.tap) {
    commands.push(formatCommand("brew", ["tap", install.tap]));
  }

  if (install.formula) {
    return [
      ...commands,
      formatCommand("brew", ["install", install.formula, ...(install.args ?? [])]),
    ];
  }

  if (install.cask) {
    return [
      ...commands,
      formatCommand("brew", ["install", "--cask", install.cask, ...(install.args ?? [])]),
    ];
  }

  return commands;
};

const getGitInstallPreviewSteps = (install: GitInstall): readonly string[] => {
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
};

const getInstallPreviewSteps = (install: SystemItem["install"]): readonly string[] => {
  if (typeof install === "string") return [install];
  if (isDirInstall(install)) return getDirInstallPreviewSteps(install);
  if (isSymlinkInstall(install)) return getSymlinkInstallPreviewSteps(install);
  if (isBrewInstall(install)) return getBrewInstallPreviewSteps(install);
  if (isGitInstall(install)) return getGitInstallPreviewSteps(install);
  if (isSkillsInstall(install)) return [getSkillsAddCommand(install)];
  return [];
};

const getInstallPreview = (install: SystemItem["install"]): ExecutionPreview => ({
  label:
    typeof install === "string"
      ? "shell install command"
      : `structured install (${install.source})`,
  steps: getInstallPreviewSteps(install),
});

const getManagedUpdatePreviewSteps = (install: SymlinkInstall): readonly string[] => [
  `update symlink ${getSymlinkLinkPath(install)} -> ${getSymlinkDisplayTarget(install)}`,
];

const getManagedUpdatePreview = (install: SymlinkInstall): ExecutionPreview => ({
  label: "structured update (symlink)",
  steps: getManagedUpdatePreviewSteps(install),
});

const getExecutionDetail = (install: SystemItem["install"]): string | undefined =>
  isDirInstall(install) || isSymlinkInstall(install) || isSkillsInstall(install)
    ? getInstallPreviewSteps(install)[0]
    : undefined;

const getManagedUpdateDetail = (install: SymlinkInstall): string =>
  getManagedUpdatePreviewSteps(install)[0]!;

const getShellUpdatePreview = (command: string): ExecutionPreview => ({
  label: "shell update command",
  steps: [command],
});

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

interface SymlinkInspection {
  readonly linkPath: string;
  readonly targetPath: string;
  readonly parentPath: string;
}

const getSymlinkInspection = (install: SymlinkInstall): SymlinkInspection => {
  const linkPath = getSymlinkLinkPath(install);
  return {
    linkPath,
    targetPath: getSymlinkDisplayTarget(install),
    parentPath: Path.dirname(linkPath),
  };
};

const pathExists = (
  fs: FileSystem.FileSystem,
  path: string,
  context: string,
): Effect.Effect<boolean, FileSystemInstallError> =>
  fs.exists(path).pipe(Effect.mapError(mapFileSystemError(path, context)));

const rejectMissingSymlinkTarget = (
  fs: FileSystem.FileSystem,
  inspection: SymlinkInspection,
): Effect.Effect<void, FileSystemInstallError> =>
  Effect.gen(function* () {
    const exists = yield* pathExists(
      fs,
      inspection.targetPath,
      `Failed to inspect symlink target for "${inspection.linkPath}"`,
    );

    if (!exists) {
      return yield* Effect.fail(
        toFileSystemInstallError(
          inspection.linkPath,
          `Symlink target "${inspection.targetPath}" does not exist. Create the target first or update install.target.`,
        ),
      );
    }
  });

const rejectMissingSymlinkParent = (
  fs: FileSystem.FileSystem,
  inspection: SymlinkInspection,
): Effect.Effect<void, FileSystemInstallError> =>
  Effect.gen(function* () {
    const exists = yield* pathExists(
      fs,
      inspection.parentPath,
      `Failed to inspect parent directory for "${inspection.linkPath}"`,
    );

    if (!exists) {
      return yield* Effect.fail(
        toFileSystemInstallError(
          inspection.linkPath,
          `Parent directory "${inspection.parentPath}" is missing for symlink "${inspection.linkPath}". Add a dir item or dependency before this symlink.`,
        ),
      );
    }
  });

const inspectExistingSymlinkTarget = (
  fs: FileSystem.FileSystem,
  inspection: SymlinkInspection,
): Effect.Effect<ItemCheckResult, FileSystemInstallError> =>
  Effect.gen(function* () {
    const currentTarget = yield* fs
      .readLink(inspection.linkPath)
      .pipe(
        Effect.mapError(
          mapFileSystemError(
            inspection.linkPath,
            `Failed to read existing symlink target for "${inspection.linkPath}"`,
          ),
        ),
      );
    const normalizedCurrentTarget = normalizeSymlinkTargetForComparison(
      inspection.linkPath,
      currentTarget,
    );

    if (normalizedCurrentTarget === inspection.targetPath) {
      return { type: "installed" };
    }

    return {
      type: "needs_update",
      reason: `Symlink "${inspection.linkPath}" points to "${normalizedCurrentTarget}" instead of "${inspection.targetPath}". Re-run with --update to replace it, or fix the existing link manually.`,
    };
  });

const inspectExistingSymlinkPath = (
  fs: FileSystem.FileSystem,
  inspection: SymlinkInspection,
): Effect.Effect<ItemCheckResult, FileSystemInstallError> =>
  Effect.gen(function* () {
    const stat = yield* fs
      .stat(inspection.linkPath)
      .pipe(
        Effect.mapError(
          mapFileSystemError(
            inspection.linkPath,
            `Failed to inspect symlink path "${inspection.linkPath}"`,
          ),
        ),
      );

    if (stat.type === "SymbolicLink") {
      return yield* inspectExistingSymlinkTarget(fs, inspection);
    }

    return {
      type: "needs_update",
      reason: `Path "${inspection.linkPath}" exists as a ${describePathType(stat.type)}, not the desired symlink to "${inspection.targetPath}". Re-run with --update to replace it, or move/remove the existing path manually.`,
    };
  });

const checkSymlinkInstall = (
  install: SymlinkInstall,
): Effect.Effect<ItemCheckResult, FileSystemInstallError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const inspection = getSymlinkInspection(install);

    yield* rejectMissingSymlinkTarget(fs, inspection);
    yield* rejectMissingSymlinkParent(fs, inspection);

    const linkExists = yield* pathExists(
      fs,
      inspection.linkPath,
      `Failed to inspect symlink path "${inspection.linkPath}"`,
    );

    return linkExists ? yield* inspectExistingSymlinkPath(fs, inspection) : { type: "missing" };
  });

/** @internal Executor-owned helpers; this module is not exported from the public engine barrel. */
const installInspection = {
  checkDirInstall,
  checkSkillsInstall,
  checkSymlinkInstall,
  getCheckDescription,
  getExecutionDetail,
  getInstallPreview,
  getManagedUpdateDetail,
  getManagedUpdatePreview,
  getManagedUpdatePreviewSteps,
  getShellUpdatePreview,
  getSkillsAddArgs,
  getSymlinkDisplayTarget,
  getSymlinkLinkPath,
  getSymlinkTargetForCreate,
  isBrewInstall,
  isDirInstall,
  isGitInstall,
  isSkillsInstall,
  isSymlinkInstall,
  mapFileSystemError,
  normalizeManagedPath,
  toFileSystemInstallError,
};

export { installInspection };
