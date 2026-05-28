import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import type { DirInstall } from "../schema/config.js";
import type { ItemCheckResult } from "./Executor.js";
import {
  describePathType,
  mapFileSystemError,
  normalizeManagedPath,
  toFileSystemInstallError,
} from "./InstallInspectionCore.js";
import type { FileSystemInstallError } from "../errors.js";

export const getDirInstallPreviewSteps = (install: DirInstall): readonly string[] => [
  `create directory ${normalizeManagedPath(install.path)}`,
];

export const checkDirInstall = (
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
