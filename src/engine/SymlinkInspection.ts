import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import * as Path from "node:path";
import type { SymlinkInstall } from "../schema/config.js";
import type { FileSystemInstallError } from "../errors.js";
import { expandPath } from "../utils.js";
import type { ExecutionPreview, ItemCheckResult } from "./Executor.js";
import {
  describePathType,
  mapFileSystemError,
  normalizeManagedPath,
  toFileSystemInstallError,
} from "./InstallInspectionCore.js";

const normalizeSymlinkTargetForComparison = (linkPath: string, target: string): string =>
  Path.normalize(
    Path.resolve(
      Path.dirname(linkPath),
      Path.isAbsolute(expandPath(target)) ? expandPath(target) : target,
    ),
  );

export const getSymlinkLinkPath = (install: SymlinkInstall): string =>
  normalizeManagedPath(install.path);

export const getSymlinkDisplayTarget = (install: SymlinkInstall): string =>
  normalizeSymlinkTargetForComparison(getSymlinkLinkPath(install), install.target);

export const getSymlinkTargetForCreate = (target: string): string => {
  const expandedTarget = expandPath(target);
  return Path.isAbsolute(expandedTarget)
    ? Path.normalize(Path.resolve(expandedTarget))
    : Path.normalize(target);
};

export const getSymlinkInstallPreviewSteps = (install: SymlinkInstall): readonly string[] => [
  `create symlink ${getSymlinkLinkPath(install)} -> ${getSymlinkDisplayTarget(install)}`,
];

export const getManagedUpdatePreviewSteps = (install: SymlinkInstall): readonly string[] => [
  `update symlink ${getSymlinkLinkPath(install)} -> ${getSymlinkDisplayTarget(install)}`,
];

export const getManagedUpdatePreview = (install: SymlinkInstall): ExecutionPreview => ({
  label: "structured update (symlink)",
  steps: getManagedUpdatePreviewSteps(install),
});

export const getManagedUpdateDetail = (install: SymlinkInstall): string =>
  getManagedUpdatePreviewSteps(install)[0]!;

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

const rejectMissingSymlinkPath = (
  fs: FileSystem.FileSystem,
  inspection: SymlinkInspection,
  path: string,
  context: string,
  reason: string,
): Effect.Effect<void, FileSystemInstallError> =>
  Effect.gen(function* () {
    const exists = yield* pathExists(fs, path, context);

    if (!exists) {
      return yield* Effect.fail(toFileSystemInstallError(inspection.linkPath, reason));
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

export const checkSymlinkInstall = (
  install: SymlinkInstall,
): Effect.Effect<ItemCheckResult, FileSystemInstallError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const inspection = getSymlinkInspection(install);

    yield* rejectMissingSymlinkPath(
      fs,
      inspection,
      inspection.targetPath,
      `Failed to inspect symlink target for "${inspection.linkPath}"`,
      `Symlink target "${inspection.targetPath}" does not exist. Create the target first or update install.target.`,
    );
    yield* rejectMissingSymlinkPath(
      fs,
      inspection,
      inspection.parentPath,
      `Failed to inspect parent directory for "${inspection.linkPath}"`,
      `Parent directory "${inspection.parentPath}" is missing for symlink "${inspection.linkPath}". Add a dir item or dependency before this symlink.`,
    );

    const linkExists = yield* pathExists(
      fs,
      inspection.linkPath,
      `Failed to inspect symlink path "${inspection.linkPath}"`,
    );

    return linkExists ? yield* inspectExistingSymlinkPath(fs, inspection) : { type: "missing" };
  });
