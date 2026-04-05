import { Cause, Effect } from "effect";
import { BunRuntime } from "@effect/platform-bun";
import { runCli, type CliOptions } from "./cli.js";
import { resolveConfigSource } from "./configSource.js";
import { resolveExecutionMode } from "./executionMode.js";
import { ConfigService } from "./services/ConfigService.js";
import { AppLayer } from "./services/AppLayer.js";
import { topologicalSort } from "./engine/Planner.js";
import { Executor } from "./engine/Executor.js";
import { createReporter } from "./engine/Reporter.js";
import { selectItems } from "./engine/Selection.js";
import {
  ConfigError,
  ValidationError,
  CycleError,
  ShellError,
  GitError,
  BackupError,
  FileSystemInstallError,
} from "./errors.js";

const formatError = (error: unknown): string => {
  if (error instanceof ConfigError) {
    return `Configuration error: ${error.message}${error.path ? ` (${error.path})` : ""}`;
  }
  if (error instanceof ValidationError) {
    return `Validation error:\n  ${error.issues.join("\n  ")}`;
  }
  if (error instanceof CycleError) {
    return `Dependency cycle detected: ${error.cycle.join(" -> ")}`;
  }
  if (error instanceof ShellError) {
    return `Command failed: ${error.command}\n  Exit code: ${error.exitCode}\n  ${error.stderr}`;
  }
  if (error instanceof GitError) {
    return `Git error for ${error.repo}: ${error.reason}`;
  }
  if (error instanceof BackupError) {
    return `Backup error for ${error.path}: ${error.reason}`;
  }
  if (error instanceof FileSystemInstallError) {
    return `Filesystem item error for ${error.path}: ${error.reason}`;
  }
  return String(error);
};

const handler = (options: CliOptions) =>
  Effect.gen(function* () {
    const reporter = createReporter({ verbose: options.verbose });
    const configService = yield* ConfigService;
    const executor = yield* Executor;

    const configSource = yield* resolveConfigSource(options.config);
    const executionMode = resolveExecutionMode(configSource, options);

    reporter.printConfigSource(configSource, executionMode);

    const config = yield* configService.load(configSource, options.profile);
    const items = selectItems(config.items, options);

    if (items.length === 0) {
      yield* Effect.log("No items to process");
      return;
    }

    const plan = yield* topologicalSort(items);

    reporter.printPlan(plan, executionMode.dryRun);

    const results = yield* executor.execute(plan, {
      dryRun: executionMode.dryRun,
      update: options.update,
      verbose: options.verbose,
      onProgress: reporter.printProgress,
      onVerbose: reporter.printVerbose,
    });

    reporter.printSummary(results);
  }).pipe(
    Effect.catchAll((error) =>
      Effect.sync(() => {
        console.error(`\n${formatError(error)}\n`);
        process.exit(1);
      }),
    ),
    Effect.catchAllCause((cause) =>
      Effect.sync(() => {
        console.error(`\nUnexpected crash:\n${Cause.pretty(cause)}\n`);
        process.exit(1);
      }),
    ),
  );

const program = runCli(handler)(process.argv).pipe(Effect.provide(AppLayer));

BunRuntime.runMain(program);
