import * as Path from "node:path";
import type {
  BrewInstall,
  DirInstall,
  GitInstall,
  ScriptCommand,
  SkillsInstall,
  SymlinkInstall,
  SystemItem,
} from "../schema/config.js";
import { FileSystemInstallError } from "../errors.js";
import { expandPath } from "../utils.js";

export const isGitInstall = (install: SystemItem["install"]): install is GitInstall =>
  typeof install === "object" && install.source === "git";

export const isBrewInstall = (install: SystemItem["install"]): install is BrewInstall =>
  typeof install === "object" && install.source === "brew";

export const isDirInstall = (install: SystemItem["install"]): install is DirInstall =>
  typeof install === "object" && install.source === "dir";

export const isSymlinkInstall = (install: SystemItem["install"]): install is SymlinkInstall =>
  typeof install === "object" && install.source === "symlink";

export const isSkillsInstall = (install: SystemItem["install"]): install is SkillsInstall =>
  typeof install === "object" && install.source === "skills";

export const isScriptCommand = (
  command: SystemItem["install"] | NonNullable<SystemItem["update"]>,
): command is ScriptCommand => typeof command === "object" && command.source === "script";

export const formatCommand = (command: string, args: readonly string[] = []): string =>
  args.length > 0 ? `${command} ${args.join(" ")}` : command;

export const normalizeManagedPath = (path: string): string =>
  Path.normalize(Path.resolve(expandPath(path)));

export const describePathType = (type: string): string => {
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

export const toFileSystemInstallError = (path: string, reason: string): FileSystemInstallError =>
  new FileSystemInstallError({ path, reason });

export const mapFileSystemError =
  (path: string, context: string): ((error: unknown) => FileSystemInstallError) =>
  (error: unknown): FileSystemInstallError =>
    toFileSystemInstallError(path, `${context}: ${formatUnknownError(error)}`);
