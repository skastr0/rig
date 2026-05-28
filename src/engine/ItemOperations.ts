import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import type {
  DirInstall,
  SymlinkInstall,
  SystemItem,
  TimeoutInput as ItemTimeoutInput,
} from "../schema/config.js";
import type { BrewService } from "../services/BrewService.js";
import type { GitService } from "../services/GitService.js";
import type { ShellResult, ShellService } from "../services/ShellService.js";
import type { BrewError, FileSystemInstallError, GitError, ShellError } from "../errors.js";
import { expandPath } from "../utils.js";
import type { ExecutorOptions, ItemCheckResult } from "./Executor.js";
import { installInspection } from "./InstallInspection.js";
import type { ItemExecutionOperations } from "./ExecutionBranches.js";

const {
  checkDirInstall,
  checkSkillsInstall,
  checkSymlinkInstall,
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
} = installInspection;

export const emitVerbose = (options: ExecutorOptions | undefined, message: string): void => {
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

export const checkItem = (
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
  if (!item.update) {
    return Effect.void;
  }
  return runShellCommand(item.name, item.update, shell, item.timeout, options).pipe(Effect.asVoid);
};

export const itemExecutionOperations: ItemExecutionOperations = {
  emitVerbose,
  isSymlinkInstall,
  toFileSystemInstallError,
  getSymlinkLinkPath,
  getShellUpdatePreview,
  getManagedUpdatePreview,
  getManagedUpdateDetail,
  getManagedUpdatePreviewSteps,
  getInstallPreview,
  getExecutionDetail,
  updateItem,
  updateSymlinkItem,
  installItem,
};
