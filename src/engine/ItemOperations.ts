import { FileSystem } from "@effect/platform";
import { Effect } from "effect";
import type {
  DirInstall,
  ScriptCommand,
  SymlinkInstall,
  SystemItem,
  TimeoutInput as ItemTimeoutInput,
} from "../schema/config.js";
import type { BrewService } from "../services/BrewService.js";
import type { GitService } from "../services/GitService.js";
import type { ShellExecutionOptions, ShellResult, ShellService } from "../services/ShellService.js";
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
  getUpdatePreview,
  getSkillsAddArgs,
  getSymlinkDisplayTarget,
  getSymlinkLinkPath,
  getSymlinkTargetForCreate,
  isBrewInstall,
  isDirInstall,
  isGitInstall,
  isScriptCommand,
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

const emitCommandLine = (
  itemName: string,
  stream: "stdout" | "stderr",
  line: string,
  options: ExecutorOptions | undefined,
): void => {
  if (line.trim().length === 0) {
    return;
  }

  options?.onOutput?.({ itemName, stream, line });
  emitVerbose(options, `[${itemName}] ${stream}: ${line}`);
};

const toTimeoutOptions = (
  timeout: ItemTimeoutInput | undefined,
): { timeout: ItemTimeoutInput } | undefined => (timeout === undefined ? undefined : { timeout });

const toCommandOptions = (
  itemName: string,
  timeout: ItemTimeoutInput | undefined,
  cwd: string | undefined,
  executorOptions: ExecutorOptions | undefined,
): ShellExecutionOptions | undefined => {
  const shellOptions = {
    ...(timeout === undefined ? {} : { timeout }),
    ...(cwd === undefined ? {} : { cwd }),
    onStdoutLine: (line: string) => emitCommandLine(itemName, "stdout", line, executorOptions),
    onStderrLine: (line: string) => emitCommandLine(itemName, "stderr", line, executorOptions),
  };

  return shellOptions;
};

const runShellCommand = (
  itemName: string,
  command: string,
  shell: ShellService,
  timeout: SystemItem["timeout"],
  options: ExecutorOptions | undefined,
): Effect.Effect<ShellResult, ShellError> =>
  shell.run(command, toCommandOptions(itemName, timeout, undefined, options));

const scriptFilePrefix = (itemName: string): string =>
  `rig-${itemName.replace(/[^a-zA-Z0-9_.-]/g, "-")}-`;

const runScriptCommand = (
  itemName: string,
  command: ScriptCommand,
  shell: ShellService,
  fs: FileSystem.FileSystem,
  timeout: SystemItem["timeout"],
  options: ExecutorOptions | undefined,
): Effect.Effect<ShellResult, ShellError | FileSystemInstallError> => {
  const scriptContent = command.script.endsWith("\n") ? command.script : `${command.script}\n`;
  const cwd = command.cwd === undefined ? undefined : normalizeManagedPath(command.cwd);

  const prepareCwd =
    cwd === undefined
      ? Effect.void
      : fs
          .makeDirectory(cwd, { recursive: true })
          .pipe(Effect.mapError(mapFileSystemError(cwd, `Failed to prepare script cwd "${cwd}"`)));

  const acquireScriptPath = fs
    .makeTempFile({ prefix: scriptFilePrefix(itemName), suffix: ".sh" })
    .pipe(
      Effect.mapError(
        mapFileSystemError(itemName, `Failed to create temporary script for "${itemName}"`),
      ),
    );

  return Effect.gen(function* () {
    yield* prepareCwd;
    return yield* Effect.acquireUseRelease(
      acquireScriptPath,
      (scriptPath) =>
        Effect.gen(function* () {
          yield* fs
            .writeFileString(scriptPath, scriptContent)
            .pipe(
              Effect.mapError(
                mapFileSystemError(scriptPath, `Failed to write script "${scriptPath}"`),
              ),
            );
          return yield* shell.exec(
            command.interpreter,
            [scriptPath],
            toCommandOptions(itemName, timeout, cwd, options),
          );
        }),
      (scriptPath) => fs.remove(scriptPath).pipe(Effect.catchAll(() => Effect.void)),
    );
  });
};

const checkExecutionFailureExitCodes = new Set([126, 127]);

const isCheckExecutionFailure = (error: ShellError): boolean =>
  error.timedOut === true ||
  error.exitCode < 0 ||
  checkExecutionFailureExitCodes.has(error.exitCode);

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
    Effect.catchAll((error) =>
      isCheckExecutionFailure(error) ? Effect.fail(error) : Effect.succeed(false),
    ),
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
    return git.clone(item.install, toCommandOptions(item.name, item.timeout, undefined, options));
  }

  if (isBrewInstall(item.install)) {
    return brew.install(
      item.install,
      toCommandOptions(item.name, item.timeout, undefined, options),
    );
  }

  if (isDirInstall(item.install)) {
    return installDirItem(item.install, fs);
  }

  if (isSymlinkInstall(item.install)) {
    return createSymlink(item.install, fs);
  }

  if (isSkillsInstall(item.install)) {
    return shell
      .exec(
        "env",
        getSkillsAddArgs(item.install),
        toCommandOptions(item.name, item.timeout, undefined, options),
      )
      .pipe(Effect.asVoid);
  }

  if (isScriptCommand(item.install)) {
    return runScriptCommand(item.name, item.install, shell, fs, item.timeout, options).pipe(
      Effect.asVoid,
    );
  }

  return runShellCommand(item.name, item.install, shell, item.timeout, options).pipe(Effect.asVoid);
};

const updateItem = (
  item: SystemItem,
  shell: ShellService,
  fs: FileSystem.FileSystem,
  options: ExecutorOptions | undefined,
): Effect.Effect<void, ShellError | FileSystemInstallError, never> => {
  if (!item.update) {
    return Effect.void;
  }
  if (isScriptCommand(item.update)) {
    return runScriptCommand(item.name, item.update, shell, fs, item.timeout, options).pipe(
      Effect.asVoid,
    );
  }
  return runShellCommand(item.name, item.update, shell, item.timeout, options).pipe(Effect.asVoid);
};

export const itemExecutionOperations: ItemExecutionOperations = {
  emitVerbose,
  isSymlinkInstall,
  toFileSystemInstallError,
  getSymlinkLinkPath,
  getUpdatePreview,
  getManagedUpdatePreview,
  getManagedUpdateDetail,
  getManagedUpdatePreviewSteps,
  getInstallPreview,
  getExecutionDetail,
  updateItem,
  updateSymlinkItem,
  installItem,
};
