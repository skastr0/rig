import { Effect } from "effect";
import { FileSystem } from "@effect/platform";
import type { SystemItem, SymlinkInstall } from "../schema/config.js";
import type { ShellService } from "../services/ShellService.js";
import type { BackupService } from "../services/BackupService.js";
import type { GitService } from "../services/GitService.js";
import type { BrewService } from "../services/BrewService.js";
import type {
  ShellError,
  GitError,
  BrewError,
  BackupError,
  FileSystemInstallError,
} from "../errors.js";
import type {
  ExecutionPreview,
  ExecutionResult,
  ExecutorOptions,
  ItemAction,
  ItemCheckResult,
  ItemStatus,
} from "./Executor.js";

export type ExecuteItemError =
  | ShellError
  | GitError
  | BrewError
  | BackupError
  | FileSystemInstallError;

export interface ItemExecutionServices {
  readonly shell: ShellService;
  readonly backup: BackupService;
  readonly git: GitService;
  readonly brew: BrewService;
  readonly fs: FileSystem.FileSystem;
}

export interface ItemExecutionOperations {
  readonly emitVerbose: (options: ExecutorOptions | undefined, message: string) => void;
  readonly isSymlinkInstall: (install: SystemItem["install"]) => install is SymlinkInstall;
  readonly toFileSystemInstallError: (path: string, reason: string) => FileSystemInstallError;
  readonly getSymlinkLinkPath: (install: SymlinkInstall) => string;
  readonly getUpdatePreview: (command: NonNullable<SystemItem["update"]>) => ExecutionPreview;
  readonly getManagedUpdatePreview: (install: SymlinkInstall) => ExecutionPreview;
  readonly getManagedUpdateDetail: (install: SymlinkInstall) => string;
  readonly getManagedUpdatePreviewSteps: (install: SymlinkInstall) => readonly string[];
  readonly getInstallPreview: (install: SystemItem["install"]) => ExecutionPreview;
  readonly getExecutionDetail: (install: SystemItem["install"]) => string | undefined;
  readonly updateItem: (
    item: SystemItem,
    shell: ShellService,
    fs: FileSystem.FileSystem,
    options: ExecutorOptions | undefined,
  ) => Effect.Effect<void, ShellError | FileSystemInstallError, never>;
  readonly updateSymlinkItem: (
    install: SymlinkInstall,
    fs: FileSystem.FileSystem,
  ) => Effect.Effect<void, FileSystemInstallError>;
  readonly installItem: (
    item: SystemItem,
    shell: ShellService,
    git: GitService,
    brew: BrewService,
    fs: FileSystem.FileSystem,
    options: ExecutorOptions | undefined,
  ) => Effect.Effect<
    void,
    ShellError | GitError | BrewError | FileSystemInstallError,
    ShellService
  >;
}

const makeExecutionResult = (
  item: SystemItem,
  status: ItemStatus,
  action: ItemAction,
  details: Partial<Omit<ExecutionResult, "name" | "status" | "action">> = {},
): ExecutionResult => ({
  name: item.name,
  status,
  action,
  ...details,
});

const reportExecutionResult = (
  result: ExecutionResult,
  options: ExecutorOptions | undefined,
): ExecutionResult => {
  options?.onProgress?.(result);
  return result;
};

const reportExecutionResultEffect = (
  result: ExecutionResult,
  options: ExecutorOptions | undefined,
): Effect.Effect<ExecutionResult> => Effect.sync(() => reportExecutionResult(result, options));

const backupItem = (
  item: SystemItem,
  backup: BackupService,
  operations: ItemExecutionOperations,
  options: ExecutorOptions | undefined,
): Effect.Effect<string | undefined, BackupError, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    if (!item.backup) {
      return undefined;
    }

    operations.emitVerbose(options, `[${item.name}] backup: ${item.backup}`);
    const backupResult = yield* backup.backup(item.backup);
    return backupResult.skipped ? undefined : backupResult.destination;
  });

const emitPreviewSteps = (
  item: SystemItem,
  verb: "would update" | "would install" | "install" | "update",
  steps: readonly string[],
  operations: ItemExecutionOperations,
  options: ExecutorOptions | undefined,
): void => {
  for (const step of steps) {
    operations.emitVerbose(options, `[${item.name}] ${verb}: ${step}`);
  }
};

const backedUpDetail = (
  backedUp: string | undefined,
): Pick<ExecutionResult, "backed_up"> | undefined =>
  backedUp === undefined ? undefined : { backed_up: backedUp };

const executeInstalledItem = (
  item: SystemItem,
  services: ItemExecutionServices,
  operations: ItemExecutionOperations,
  options: ExecutorOptions | undefined,
): Effect.Effect<
  ExecutionResult,
  ShellError | BackupError | FileSystemInstallError,
  FileSystem.FileSystem
> => {
  const update = item.update;
  if (!(options?.update && update)) {
    return reportExecutionResultEffect(makeExecutionResult(item, "installed", "skipped"), options);
  }

  if (options?.dryRun) {
    return Effect.sync(() => {
      const preview = operations.getUpdatePreview(update);
      emitPreviewSteps(item, "would update", preview.steps, operations, options);
      return reportExecutionResult(
        makeExecutionResult(item, "installed", "would_update", { preview }),
        options,
      );
    });
  }

  return Effect.gen(function* () {
    const backedUp = yield* backupItem(item, services.backup, operations, options);
    operations.emitVerbose(
      options,
      `[${item.name}] update: ${operations.getUpdatePreview(update).steps.join(" && ")}`,
    );
    yield* operations.updateItem(item, services.shell, services.fs, options);

    return reportExecutionResult(
      makeExecutionResult(item, "installed", "updated", backedUpDetail(backedUp)),
      options,
    );
  });
};

const executeManagedUpdateItem = (
  item: SystemItem,
  reason: string,
  services: ItemExecutionServices,
  operations: ItemExecutionOperations,
  options: ExecutorOptions | undefined,
): Effect.Effect<ExecutionResult, BackupError | FileSystemInstallError, FileSystem.FileSystem> => {
  if (!operations.isSymlinkInstall(item.install)) {
    return Effect.fail(
      operations.toFileSystemInstallError(
        item.name,
        `Unexpected managed update state for item "${item.name}".`,
      ),
    );
  }
  const install = item.install;

  if (!options?.update) {
    return Effect.fail(
      operations.toFileSystemInstallError(operations.getSymlinkLinkPath(install), reason),
    );
  }

  if (options?.dryRun) {
    return Effect.sync(() => {
      const preview = operations.getManagedUpdatePreview(install);
      emitPreviewSteps(item, "would update", preview.steps, operations, options);
      return reportExecutionResult(
        makeExecutionResult(item, "installed", "would_update", {
          detail: operations.getManagedUpdateDetail(install),
          preview,
        }),
        options,
      );
    });
  }

  return Effect.gen(function* () {
    const backedUp = yield* backupItem(item, services.backup, operations, options);
    emitPreviewSteps(
      item,
      "update",
      operations.getManagedUpdatePreviewSteps(install),
      operations,
      options,
    );
    yield* operations.updateSymlinkItem(install, services.fs);

    return reportExecutionResult(
      makeExecutionResult(item, "installed", "updated", backedUpDetail(backedUp)),
      options,
    );
  });
};

const previewMissingItem = (
  item: SystemItem,
  operations: ItemExecutionOperations,
  options: ExecutorOptions | undefined,
): Effect.Effect<ExecutionResult> =>
  Effect.sync(() => {
    const preview = operations.getInstallPreview(item.install);
    const detail = operations.getExecutionDetail(item.install);
    emitPreviewSteps(item, "would install", preview.steps, operations, options);

    return reportExecutionResult(
      makeExecutionResult(item, "missing", "skipped", {
        ...(detail === undefined ? {} : { detail }),
        preview,
      }),
      options,
    );
  });

const installMissingItem = (
  item: SystemItem,
  services: ItemExecutionServices,
  operations: ItemExecutionOperations,
  options: ExecutorOptions | undefined,
): Effect.Effect<ExecutionResult, ExecuteItemError, ShellService | FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const backedUp = yield* backupItem(item, services.backup, operations, options);
    emitPreviewSteps(
      item,
      "install",
      operations.getInstallPreview(item.install).steps,
      operations,
      options,
    );
    yield* operations.installItem(
      item,
      services.shell,
      services.git,
      services.brew,
      services.fs,
      options,
    );

    return reportExecutionResult(
      makeExecutionResult(item, "installed", "installed", backedUpDetail(backedUp)),
      options,
    );
  });

const executeMissingItem = (
  item: SystemItem,
  services: ItemExecutionServices,
  operations: ItemExecutionOperations,
  options: ExecutorOptions | undefined,
): Effect.Effect<ExecutionResult, ExecuteItemError, ShellService | FileSystem.FileSystem> =>
  options?.dryRun
    ? previewMissingItem(item, operations, options)
    : installMissingItem(item, services, operations, options);

export const executeCheckedItem = (
  item: SystemItem,
  itemState: ItemCheckResult,
  services: ItemExecutionServices,
  operations: ItemExecutionOperations,
  options: ExecutorOptions | undefined,
): Effect.Effect<ExecutionResult, ExecuteItemError, ShellService | FileSystem.FileSystem> => {
  switch (itemState.type) {
    case "installed":
      return executeInstalledItem(item, services, operations, options);
    case "needs_update":
      return executeManagedUpdateItem(item, itemState.reason, services, operations, options);
    case "missing":
      return executeMissingItem(item, services, operations, options);
  }
};
