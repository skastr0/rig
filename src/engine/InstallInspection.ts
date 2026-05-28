import { checkDirInstall } from "./DirInspection.js";
import {
  getCheckDescription,
  getExecutionDetail,
  getInstallPreview,
  getShellUpdatePreview,
} from "./InstallPreview.js";
import {
  isBrewInstall,
  isDirInstall,
  isGitInstall,
  isSkillsInstall,
  isSymlinkInstall,
  mapFileSystemError,
  normalizeManagedPath,
  toFileSystemInstallError,
} from "./InstallInspectionCore.js";
import { checkSkillsInstall, getSkillsAddArgs } from "./SkillsInspection.js";
import {
  checkSymlinkInstall,
  getManagedUpdateDetail,
  getManagedUpdatePreview,
  getManagedUpdatePreviewSteps,
  getSymlinkDisplayTarget,
  getSymlinkLinkPath,
  getSymlinkTargetForCreate,
} from "./SymlinkInspection.js";

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
