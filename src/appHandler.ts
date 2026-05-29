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
  collectAvailableProfiles,
  type SelectionAnalysis,
  type SelectionReason,
} from "./engine/Selection.js";
import { ConfigError, ValidationError } from "./errors.js";
import { formatError } from "./errorFormatting.js";
import type { SystemItem } from "./schema/config.js";

const formatItemList = (items: readonly string[]): string => items.join(", ");

const formatAvailableProfiles = (profiles: readonly string[]): string =>
  profiles.length === 0 ? "none" : formatItemList(profiles);

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
    case "direct": {
      const clauses: string[] = [];

      clauses.push(`it belongs to profile "${reason.profile}"`);

      if (reason.matchedOnly) {
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

  if (!item.profiles.includes(selection.options.profile)) {
    lines.push(
      `Item profiles (${formatItemList(item.profiles)}) do not include active profile "${selection.options.profile}".`,
    );
  }

  if (selection.options.only.length > 0 && !selection.options.only.includes(itemName)) {
    lines.push(`--only currently selects: ${formatItemList(selection.options.only)}`);
  }

  if (selection.options.tags.length > 0) {
    const matchingTags = item.tags.filter((tag) => selection.options.tags.includes(tag));

    if (matchingTags.length === 0) {
      lines.push(
        `Item tags (${formatItemList(item.tags)}) do not match --tags: ${formatItemList(selection.options.tags)}`,
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

const requireHeadlessProfile = (
  options: CliOptions,
  items: readonly SystemItem[],
): Effect.Effect<string, ValidationError> => {
  const availableProfiles = collectAvailableProfiles(items);
  const availableProfilesLine = `Available profiles: ${formatAvailableProfiles(availableProfiles)}.`;

  if (!options.ci) {
    return Effect.fail(
      new ValidationError({
        issues: [
          "Interactive mode is the default for bare rig. Use --ci --profile <name> for headless execution.",
          availableProfilesLine,
        ],
      }),
    );
  }

  if (options.profile === undefined) {
    return Effect.fail(
      new ValidationError({
        issues: [`Headless mode requires --profile <name>.`, availableProfilesLine],
      }),
    );
  }

  if (!availableProfiles.includes(options.profile)) {
    return Effect.fail(
      new ValidationError({
        issues: [`Unknown profile "${options.profile}".`, availableProfilesLine],
      }),
    );
  }

  return Effect.succeed(options.profile);
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
    const statusInspectionMode =
      options.status && configSource._tag === "https"
        ? resolveExecutionMode(configSource, {
            dryRun: false,
            apply: options.apply,
          })
        : undefined;

    reporter.printConfigSource(configSource, executionMode ?? statusInspectionMode);

    if (configSource._tag === "https" && options.status && !options.apply) {
      return yield* Effect.fail(
        new ValidationError({
          issues: [
            "Remote --status executes check commands and requires --apply.",
            "Review the remote config first, then re-run with --apply --status to inspect local state.",
          ],
        }),
      );
    }

    const config = yield* configService.load(configSource);
    const profile = yield* requireHeadlessProfile(options, config.items);

    return {
      executionMode,
      readOnlyIntrospection,
      selection: analyzeSelection(config.items, {
        profile,
        tags: options.tags,
        only: options.only,
      }),
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
    if (executionMode?._tag === "remote_preview") {
      reporter.printStaticPreview(plan, options.update);
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

const isInteractiveTerminal = (): boolean =>
  process.stdin.isTTY === true && process.stdout.isTTY === true;

const runInteractiveCommandIfRequested = (options: CliOptions, configService: ConfigService) =>
  Effect.gen(function* () {
    if (options.ci || options.status || options.why !== undefined || !isInteractiveTerminal()) {
      return false;
    }

    const configSource = yield* resolveConfigSource(options.config);
    const config = yield* configService.load(configSource);
    const availableProfiles = collectAvailableProfiles(config.items);

    if (options.profile !== undefined && !availableProfiles.includes(options.profile)) {
      return yield* Effect.fail(
        new ValidationError({
          issues: [
            `Unknown profile "${options.profile}".`,
            `Available profiles: ${formatAvailableProfiles(availableProfiles)}.`,
          ],
        }),
      );
    }

    const { runInteractiveCommand } = yield* Effect.promise(
      () => import("./tui/runInteractiveCommand.js"),
    );

    yield* runInteractiveCommand({ options, configSource, items: config.items });

    return true;
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

    const handledInteractively = yield* runInteractiveCommandIfRequested(options, configService);
    if (handledInteractively) {
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
