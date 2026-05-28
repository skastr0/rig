import type { BrewInstall, GitInstall, SystemItem } from "../schema/config.js";
import { expandPath } from "../utils.js";
import type { ExecutionPreview } from "./Executor.js";
import { getDirInstallPreviewSteps } from "./DirInspection.js";
import {
  formatCommand,
  isBrewInstall,
  isDirInstall,
  isGitInstall,
  isSkillsInstall,
  isSymlinkInstall,
  normalizeManagedPath,
} from "./InstallInspectionCore.js";
import { getSkillPath, getSkillsAddCommand } from "./SkillsInspection.js";
import {
  getSymlinkDisplayTarget,
  getSymlinkInstallPreviewSteps,
  getSymlinkLinkPath,
} from "./SymlinkInspection.js";

export const getCheckDescription = (item: SystemItem): string => {
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

export const getInstallPreview = (install: SystemItem["install"]): ExecutionPreview => ({
  label:
    typeof install === "string"
      ? "shell install command"
      : `structured install (${install.source})`,
  steps: getInstallPreviewSteps(install),
});

export const getExecutionDetail = (install: SystemItem["install"]): string | undefined =>
  isDirInstall(install) || isSymlinkInstall(install) || isSkillsInstall(install)
    ? getInstallPreviewSteps(install)[0]
    : undefined;

export const getShellUpdatePreview = (command: string): ExecutionPreview => ({
  label: "shell update command",
  steps: [command],
});
