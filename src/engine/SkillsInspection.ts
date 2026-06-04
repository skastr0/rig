import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import * as Path from "node:path";
import type { SkillsInstall } from "../schema/config.js";
import type { FileSystemInstallError } from "../errors.js";
import type { ItemCheckResult } from "./Executor.js";
import {
  formatCommand,
  mapFileSystemError,
  normalizeManagedPath,
  toFileSystemInstallError,
} from "./InstallInspectionCore.js";

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

export const getSkillPath = (agent: string, skill: string): string | undefined => {
  const root = getGlobalSkillsRoot(agent);
  return root === undefined ? undefined : normalizeManagedPath(Path.join(root, skill, "SKILL.md"));
};

const getSkillsSourceRef = (install: SkillsInstall): string => `${install.repo}#${install.ref}`;

export const getSkillsAddArgs = (install: SkillsInstall): readonly string[] => [
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

export const getSkillsAddCommand = (install: SkillsInstall): string =>
  formatCommand("env", getSkillsAddArgs(install));

export const checkSkillsInstall = (
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
