import { Cause, Effect } from "effect";
import type { CliOptions } from "./cli.js";
import { resolveConfigSource } from "./configSource.js";
import { resolveExecutionMode, type ExecutionMode } from "./executionMode.js";
import { ConfigService } from "./services/ConfigService.js";
import { topologicalSort, type PlanResult } from "./engine/Planner.js";
import { Executor } from "./engine/Executor.js";
import { createReporter, type Reporter, type WhyReport } from "./engine/Reporter.js";
import {
  analyzeSelection,
  type SelectionAnalysis,
  type SelectionReason,
} from "./engine/Selection.js";
import { ConfigError, ValidationError } from "./errors.js";
import { formatError } from "./errorFormatting.js";

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

const runInitCommand = (options: CliOptions, configService: ConfigService) =>
  Effect.gen(function* () {
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
  });

const loadSelectionContext = (
  options: CliOptions,
  configService: ConfigService,
  reporter: Reporter,
) =>
  Effect.gen(function* () {
    const configSource = yield* resolveConfigSource(options.config);
    const readOnlyIntrospection = options.status || options.why !== undefined;
    const executionMode = readOnlyIntrospection
      ? undefined
      : resolveExecutionMode(configSource, options);

    reporter.printConfigSource(configSource, executionMode);

    const config = yield* configService.load(configSource, options.profile);

    return {
      executionMode,
      readOnlyIntrospection,
      selection: analyzeSelection(config.items, options),
    };
  });

const printWhyIfRequested = (
  options: CliOptions,
  selection: SelectionAnalysis,
  reporter: Reporter,
) =>
  Effect.gen(function* () {
    if (options.why === undefined) {
      return;
    }

    const whyReport = yield* buildWhyReport(options.why, selection);
    reporter.printWhy(whyReport);
  });

const runStatusCommand = (
  options: CliOptions,
  executor: Executor,
  reporter: Reporter,
  plan: PlanResult,
) =>
  Effect.gen(function* () {
    const statusResults = yield* executor.inspect(plan, {
      verbose: options.verbose,
      onVerbose: reporter.printVerbose,
    });

    reporter.printStatus(statusResults);
  });

const runExecutionCommand = (
  options: CliOptions,
  executor: Executor,
  reporter: Reporter,
  plan: PlanResult,
  executionMode: ExecutionMode | undefined,
) =>
  Effect.gen(function* () {
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
  });

const runConfiguredCommand = (
  options: CliOptions,
  configService: ConfigService,
  executor: Executor,
  reporter: Reporter,
) =>
  Effect.gen(function* () {
    const context = yield* loadSelectionContext(options, configService, reporter);

    yield* printWhyIfRequested(options, context.selection, reporter);
    if (options.why !== undefined && !options.status) {
      return;
    }

    const items = context.selection.selectedItems;
    if (items.length === 0) {
      yield* Effect.log(
        context.readOnlyIntrospection
          ? "No items selected by the active filters"
          : "No items to process",
      );
      return;
    }

    const plan = yield* topologicalSort(items);

    if (options.status) {
      yield* runStatusCommand(options, executor, reporter, plan);
      return;
    }

    yield* runExecutionCommand(options, executor, reporter, plan, context.executionMode);
  });

const exitWithMessage = (message: string) =>
  Effect.sync(() => {
    console.error(`\n${message}\n`);
    process.exit(1);
  });

const createHandlerEffect = (options: CliOptions) =>
  Effect.gen(function* () {
    const reporter = createReporter({ verbose: options.verbose });
    const configService = yield* ConfigService;

    if (options.init) {
      yield* runInitCommand(options, configService);
      return;
    }

    const executor = yield* Executor;
    yield* runConfiguredCommand(options, configService, executor, reporter);
  }).pipe(
    Effect.catchAll((error) => exitWithMessage(formatError(error))),
    Effect.catchAllCause((cause) => exitWithMessage(`Unexpected crash:\n${Cause.pretty(cause)}`)),
  );

export const handler = (options: CliOptions): ReturnType<typeof createHandlerEffect> =>
  createHandlerEffect(options);
