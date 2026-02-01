import { Effect } from "effect";
import { BunRuntime } from "@effect/platform-bun";
import { runCli, type CliOptions } from "./cli.js";
import { ConfigService } from "./services/ConfigService.js";
import { AppLayer } from "./services/AppLayer.js";
import { topologicalSort } from "./engine/Planner.js";
import { Executor } from "./engine/Executor.js";
import { createReporter } from "./engine/Reporter.js";
import type { SystemItem } from "./schema/config.js";
import {
  ConfigError,
  ValidationError,
  CycleError,
  ShellError,
  GitError,
  BackupError,
} from "./errors.js";

const filterItems = (items: readonly SystemItem[], options: CliOptions): readonly SystemItem[] => {
  let filtered = items;

  if (options.only.length > 0) {
    const onlySet = new Set(options.only);
    filtered = filtered.filter((item) => onlySet.has(item.name));
  }

  if (options.tags.length > 0) {
    const tagsSet = new Set(options.tags);
    filtered = filtered.filter((item) => item.tags?.some((tag) => tagsSet.has(tag)));
  }

  return filtered;
};

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
  return String(error);
};

const handler = (options: CliOptions) =>
  Effect.gen(function* () {
    const reporter = createReporter();
    const configService = yield* ConfigService;
    const executor = yield* Executor;

    const config = yield* configService.load(options.config, options.profile);
    const items = filterItems(config.items, options);

    if (items.length === 0) {
      yield* Effect.log("No items to process");
      return;
    }

    const plan = yield* topologicalSort(items);

    reporter.printPlan(plan, options.dryRun);

    const results = yield* executor.execute(plan, {
      dryRun: options.dryRun,
      onProgress: reporter.printProgress,
    });

    reporter.printSummary(results);
  }).pipe(
    Effect.catchAll((error) =>
      Effect.sync(() => {
        console.error(`\n${formatError(error)}\n`);
        process.exit(1);
      }),
    ),
  );

const program = runCli(handler)(process.argv).pipe(Effect.provide(AppLayer));

BunRuntime.runMain(program);
