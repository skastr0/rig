import { Context, Effect, Layer } from "effect"
import { FileSystem } from "@effect/platform"
import * as Path from "node:path"
import * as Os from "node:os"

export interface BackupResult {
  readonly source: string
  readonly destination: string
  readonly skipped: boolean
}

export interface BackupService {
  readonly backup: (path: string) => Effect.Effect<BackupResult, never, FileSystem.FileSystem>
}

export const BackupService = Context.GenericTag<BackupService>("BackupService")

const BACKUP_DIR = Path.join(Os.homedir(), ".system-setup-backups")

export const BackupServiceLive = Layer.succeed(
  BackupService,
  BackupService.of({
    backup: (sourcePath) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem

        const exists = yield* fs.exists(sourcePath)
        if (!exists) {
          return { source: sourcePath, destination: "", skipped: true }
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
        const backupRoot = Path.join(BACKUP_DIR, timestamp)
        const fileName = Path.basename(sourcePath)
        const destination = Path.join(backupRoot, fileName)

        yield* fs.makeDirectory(backupRoot, { recursive: true })

        const stat = yield* fs.stat(sourcePath)
        if (stat.type === "Directory") {
          yield* copyDirectory(fs, sourcePath, destination)
        } else {
          yield* fs.copyFile(sourcePath, destination)
        }

        return { source: sourcePath, destination, skipped: false }
      }).pipe(Effect.orDie),
  })
)

const copyDirectory = (
  fs: FileSystem.FileSystem,
  source: string,
  dest: string
): Effect.Effect<void, never, never> =>
  Effect.gen(function* () {
    yield* fs.makeDirectory(dest, { recursive: true })
    const entries = yield* fs.readDirectory(source)

    yield* Effect.forEach(
      entries,
      (entry) =>
        Effect.gen(function* () {
          const srcPath = Path.join(source, entry)
          const destPath = Path.join(dest, entry)
          const stat = yield* fs.stat(srcPath)

          if (stat.type === "Directory") {
            yield* copyDirectory(fs, srcPath, destPath)
          } else {
            yield* fs.copyFile(srcPath, destPath)
          }
        }),
      { concurrency: "unbounded" }
    )
  }).pipe(Effect.orDie)
