import { Cause, Effect } from "effect";
import { BunRuntime } from "@effect/platform-bun";
import { runCli, type CliOptions } from "./cli.js";
import { resolveConfigSource } from "./configSource.js";
import { resolveExecutionMode } from "./executionMode.js";
import { ConfigService } from "./services/ConfigService.js";
import { AppLayer } from "./services/AppLayer.js";
import { topologicalSort } from "./engine/Planner.js";
import { Executor } from "./engine/Executor.js";
import { createReporter, type WhyReport } from "./engine/Reporter.js";
import {
  analyzeSelection,
  type SelectionAnalysis,
  type SelectionReason,
} from "./engine/Selection.js";
import {
  ConfigError,
  ValidationError,
  CycleError,
  ShellError,
  GitError,
  BrewError,
  BackupError,
  FileSystemInstallError,
} from "./errors.js";

const formatItemList = (items: readonly string[]): string => items.join(", ");

const printInitSuccess = (path: string, docsPath: string): void => {
  console.log(`\nCreated starter config at ${path}`);
  console.log("Edit the example item or replace it with your own items.");
  console.log(`Docs: ${docsPath}\n`);
};

const formatSelectionReason = (
  itemName: string,
  reason: SelectionReason,
  selection: SelectionAnalysis,
): readonly string[] => {
  switch (reason.type) {
    case "default":
      return ["Selected by default because no --only or --tags filters are active."];
    case "filter": {
      const clauses: string[] = [];

      if (reason.onlyMatched) {
        clauses.push(`it matched --only (${itemName})`);
      }

      if (reason.matchedTags.length > 0) {
        clauses.push(`it matched --tags (${formatItemList(reason.matchedTags)})`);
      }

      const lines = [`Selected because ${clauses.join(" and ")}.`];

      if (selection.options.only.length > 0) {
        lines.push(`Active --only filter: ${formatItemList(selection.options.only)}`);
      }

      if (selection.options.tags.length > 0) {
        lines.push(`Active --tags filter: ${formatItemList(selection.options.tags)}`);
      }

      return lines;
    }
    case "dependency": {
      const depender = reason.path[reason.path.length - 2];
      const rootSelection = reason.path[0];
      const lines = [
        `Selected because it is required as a dependency of "${depender}".`,
        `Dependency path: ${reason.path.join(" -> ")}`,
      ];

      if (rootSelection && rootSelection !== depender) {
        lines.push(`Root selected item: ${rootSelection}`);
      }

      return lines;
    }
  }
};

const formatWhyNotSelected = (
  itemName: string,
  selection: SelectionAnalysis,
): readonly string[] => {
  const item = selection.itemMap.get(itemName);
  const lines = ["Item exists in the resolved config but is not selected by the active filters."];

  if (!item) {
    return lines;
  }

  if (selection.options.only.length > 0 && !selection.options.only.includes(itemName)) {
    lines.push(`--only currently selects: ${formatItemList(selection.options.only)}`);
  }

  if (selection.options.tags.length > 0) {
    const itemTags = item.tags ?? [];
    const matchingTags = itemTags.filter((tag) => selection.options.tags.includes(tag));

    if (matchingTags.length === 0) {
      lines.push(
        itemTags.length === 0
          ? `Item has no tags, so it cannot match --tags: ${formatItemList(selection.options.tags)}`
          : `Item tags (${formatItemList(itemTags)}) do not match --tags: ${formatItemList(selection.options.tags)}`,
      );
    }
  }

  return lines;
};

const buildWhyReport = (
  itemName: string,
  selection: SelectionAnalysis,
): Effect.Effect<WhyReport, ValidationError> => {
  const item = selection.itemMap.get(itemName);
  if (!item) {
    const availableItems = [...selection.itemMap.keys()].sort();
    return Effect.fail(
      new ValidationError({
        issues: [
          `Unknown item "${itemName}". Available items: ${availableItems.length > 0 ? formatItemList(availableItems) : "none"}`,
        ],
      }),
    );
  }

  const reason = selection.reasons.get(itemName);

  return Effect.succeed({
    itemName,
    selected: reason !== undefined,
    lines: reason
      ? formatSelectionReason(itemName, reason, selection)
      : formatWhyNotSelected(itemName, selection),
  });
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
    return `Git error for ${error.repo}: ${error.reason}${error.command ? `\n  Command: ${error.command}` : ""}${error.exitCode !== undefined ? `\n  Exit code: ${error.exitCode}` : ""}${error.stderr ? `\n  ${error.stderr}` : ""}`;
  }
  if (error instanceof BrewError) {
    return `Brew error for ${error.formula_or_cask}: ${error.reason}${error.command ? `\n  Command: ${error.command}` : ""}${error.exitCode !== undefined ? `\n  Exit code: ${error.exitCode}` : ""}${error.stderr ? `\n  ${error.stderr}` : ""}`;
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

    if (options.init) {
      const configSource = yield* resolveConfigSource(options.config);

      if (configSource._tag !== "local") {
        return yield* Effect.fail(
          new ConfigError({
            message:
              "Starter config generation only supports local file paths. Pass a local path or omit the config source to use ./system-config.json.",
            path: options.config,
          }),
        );
      }

      const result = yield* configService.writeStarterConfig(configSource.path);

      yield* Effect.sync(() => {
        printInitSuccess(result.path, result.docsPath);
      });

      return;
    }

    const executor = yield* Executor;

    const configSource = yield* resolveConfigSource(options.config);
    const readOnlyIntrospection = options.status || options.why !== undefined;
    const executionMode = readOnlyIntrospection
      ? undefined
      : resolveExecutionMode(configSource, options);

    reporter.printConfigSource(configSource, executionMode);

    const config = yield* configService.load(configSource, options.profile);
    const selection = analyzeSelection(config.items, options);

    if (options.why !== undefined) {
      const whyReport = yield* buildWhyReport(options.why, selection);
      reporter.printWhy(whyReport);

      if (!options.status) {
        return;
      }
    }

    const items = selection.selectedItems;

    if (items.length === 0) {
      yield* Effect.log(
        readOnlyIntrospection ? "No items selected by the active filters" : "No items to process",
      );
      return;
    }

    const plan = yield* topologicalSort(items);

    if (options.status) {
      const statusResults = yield* executor.inspect(plan, {
        verbose: options.verbose,
        onVerbose: reporter.printVerbose,
      });

      reporter.printStatus(statusResults);
      return;
    }

    reporter.printPlan(plan, executionMode?.dryRun);

    const executeOptions = {
      ...(executionMode ? { dryRun: executionMode.dryRun } : {}),
      update: options.update,
      verbose: options.verbose,
      onProgress: reporter.printProgress,
      onVerbose: reporter.printVerbose,
    };

    const results = yield* executor.execute(plan, executeOptions);

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
