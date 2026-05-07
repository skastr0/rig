import { Context, Effect, Layer } from "effect";
import { FileSystem } from "@effect/platform";
import * as Path from "node:path";
import * as Os from "node:os";
import { BackupError } from "../errors.js";

export interface BackupResult {
  readonly source: string;
  readonly destination: string;
  readonly skipped: boolean;
}

export interface BackupService {
  readonly backup: (
    path: string,
  ) => Effect.Effect<BackupResult, BackupError, FileSystem.FileSystem>;
}

export const BackupService = Context.GenericTag<BackupService>("BackupService");

const BACKUP_DIR = Path.join(Os.homedir(), ".rig-backups");

const expandPath = (path: string): string =>
  path.startsWith("~/") ? path.replace("~", Os.homedir()) : path;

const normalizePath = (path: string): string => {
  const expanded = expandPath(path);
  const resolved = Path.resolve(expanded);
  return Path.normalize(resolved);
};

const validatePath = (path: string): Effect.Effect<string, BackupError> => {
  const normalized = normalizePath(path);

  // Must be absolute after normalization
  if (!Path.isAbsolute(normalized)) {
    return Effect.fail(
      new BackupError({
        path,
        reason: "Backup path must resolve to an absolute path",
      }),
    );
  }

  // Check for null bytes (path traversal attack vector)
  if (normalized.includes("\0")) {
    return Effect.fail(
      new BackupError({
        path,
        reason: "Backup path contains invalid characters",
      }),
    );
  }

  return Effect.succeed(normalized);
};

export const BackupServiceLive = Layer.succeed(
  BackupService,
  BackupService.of({
    backup: (sourcePath) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;

        // Validate and normalize the source path
        const normalizedPath = yield* validatePath(sourcePath);

        const exists = yield* fs
          .exists(normalizedPath)
          .pipe(Effect.catchAll(() => Effect.succeed(false)));
        if (!exists) {
          return { source: normalizedPath, destination: "", skipped: true };
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const backupRoot = Path.join(BACKUP_DIR, timestamp);
        const fileName = Path.basename(normalizedPath);
        const destination = Path.join(backupRoot, fileName);

        yield* fs.makeDirectory(backupRoot, { recursive: true }).pipe(
          Effect.catchAll((err) =>
            Effect.fail(
              new BackupError({
                path: normalizedPath,
                reason: `Failed to create backup directory: ${err}`,
              }),
            ),
          ),
        );

        const stat = yield* fs.stat(normalizedPath).pipe(
          Effect.catchAll((err) =>
            Effect.fail(
              new BackupError({
                path: normalizedPath,
                reason: `Failed to stat source: ${err}`,
              }),
            ),
          ),
        );

        if (stat.type === "Directory") {
          yield* copyDirectory(fs, normalizedPath, destination);
        } else if (stat.type === "SymbolicLink") {
          // Copy symlinks as symlinks, don't follow them
          const linkTarget = yield* fs
            .readLink(normalizedPath)
            .pipe(Effect.catchAll(() => Effect.succeed(normalizedPath)));
          yield* fs.symlink(linkTarget, destination).pipe(
            Effect.catchAll((err) =>
              Effect.fail(
                new BackupError({
                  path: normalizedPath,
                  reason: `Failed to copy symlink: ${err}`,
                }),
              ),
            ),
          );
        } else {
          yield* fs.copyFile(normalizedPath, destination).pipe(
            Effect.catchAll((err) =>
              Effect.fail(
                new BackupError({
                  path: normalizedPath,
                  reason: `Failed to copy file: ${err}`,
                }),
              ),
            ),
          );
        }

        return { source: normalizedPath, destination, skipped: false };
      }),
  }),
);

const copyDirectory = (
  fs: FileSystem.FileSystem,
  source: string,
  dest: string,
): Effect.Effect<void, BackupError, never> =>
  Effect.gen(function* () {
    yield* fs.makeDirectory(dest, { recursive: true }).pipe(
      Effect.catchAll((err) =>
        Effect.fail(
          new BackupError({
            path: dest,
            reason: `Failed to create directory: ${err}`,
          }),
        ),
      ),
    );

    const entries = yield* fs.readDirectory(source).pipe(
      Effect.catchAll((err) =>
        Effect.fail(
          new BackupError({
            path: source,
            reason: `Failed to read directory: ${err}`,
          }),
        ),
      ),
    );

    yield* Effect.forEach(
      entries,
      (entry) =>
        Effect.gen(function* () {
          const srcPath = Path.join(source, entry);
          const destPath = Path.join(dest, entry);

          const stat = yield* fs.stat(srcPath).pipe(
            Effect.catchAll((err) =>
              Effect.fail(
                new BackupError({
                  path: srcPath,
                  reason: `Failed to stat: ${err}`,
                }),
              ),
            ),
          );

          if (stat.type === "Directory") {
            yield* copyDirectory(fs, srcPath, destPath);
          } else if (stat.type === "SymbolicLink") {
            // Copy symlinks as symlinks, don't follow them
            const linkTarget = yield* fs
              .readLink(srcPath)
              .pipe(Effect.catchAll(() => Effect.succeed(srcPath)));
            yield* fs.symlink(linkTarget, destPath).pipe(
              Effect.catchAll((err) =>
                Effect.fail(
                  new BackupError({
                    path: srcPath,
                    reason: `Failed to copy symlink: ${err}`,
                  }),
                ),
              ),
            );
          } else {
            yield* fs.copyFile(srcPath, destPath).pipe(
              Effect.catchAll((err) =>
                Effect.fail(
                  new BackupError({
                    path: srcPath,
                    reason: `Failed to copy file: ${err}`,
                  }),
                ),
              ),
            );
          }
        }),
      { concurrency: "unbounded" },
    );
  });
