import { createCliRenderer, type SelectOption } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { Effect } from "effect";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hasExecutionFailures } from "../engine/Executor.js";
import { formatError } from "../errorFormatting.js";
import { ConfigError } from "../errors.js";
import { AppRuntime } from "../runtime.js";
import type { SystemItem } from "../schema/config.js";
import { AppHeader, DetailsPane, Footer, SelectorPane } from "./components.js";
import { applyRunLogs, createInitialRunItems, type TuiRunItemState } from "./executionBoard.js";
import {
  buildProfileRows,
  buildTagRows,
  buildDependencyRows,
  filterOptions,
  filterLogsByItem,
  formatReasonBadge,
  getItemPreviewLines,
  summarizeSelection,
  type TuiLogLine,
  type TuiStage,
} from "./model.js";
import { appendBufferedLogs, getRenderedLogWindow } from "./logBuffer.js";
import { tuiPalette as palette } from "./palette.js";
import {
  executeInteractivePlan,
  formatPlanLine,
  type ExecuteInteractiveRun,
  type InteractiveCommandInput,
  type PendingLogLine,
} from "./runner.js";
import { getRunDisabledReason } from "./safety.js";
import { useRigKeyboard } from "./useRigKeyboard.js";

type InteractiveExitCode = 0 | 1 | 130;

export interface InteractiveRigAppProps {
  readonly options: InteractiveCommandInput["options"];
  readonly configSource: InteractiveCommandInput["configSource"];
  readonly items: readonly SystemItem[];
  readonly executeRun: ExecuteInteractiveRun;
  readonly onExit: (exitCode: InteractiveExitCode) => void;
}

const formatTagName = (name: string, selected: boolean): string =>
  `${selected ? "[x]" : "[ ]"} ${name}`;

const clampIndex = (index: number, length: number): number => {
  if (length <= 0) {
    return 0;
  }

  return Math.min(index, length - 1);
};

const selectedTagsFromOptions = (
  availableTags: readonly string[],
  requestedTags: readonly string[],
): ReadonlySet<string> => new Set(requestedTags.filter((tag) => availableTags.includes(tag)));

const buildProfileOptions = (items: readonly SystemItem[]): SelectOption[] =>
  buildProfileRows(items).map((profile) => ({
    name: profile.name,
    description: profile.description,
    value: profile.name,
  }));

export function InteractiveRigApp({
  options,
  configSource,
  items,
  executeRun,
  onExit,
}: InteractiveRigAppProps) {
  const profileRows = useMemo(() => buildProfileRows(items), [items]);
  const requestedProfileIndex = Math.max(
    0,
    profileRows.findIndex((profile) => profile.name === options.profile),
  );
  const [stage, setStage] = useState<TuiStage>("profile");
  const [selectedIndex, setSelectedIndex] = useState(requestedProfileIndex);
  const [selectedProfileIndex, setSelectedProfileIndex] = useState(requestedProfileIndex);
  const selectedProfile = profileRows[selectedProfileIndex]?.name ?? "";
  const availableTags = useMemo(
    () => buildTagRows(items, selectedProfile, new Set()).map((tag) => tag.name),
    [items, selectedProfile],
  );
  const [selectedTags, setSelectedTags] = useState<ReadonlySet<string>>(() =>
    selectedTagsFromOptions(availableTags, options.tags),
  );
  const [verbose, setVerbose] = useState(options.verbose);
  const [update, setUpdate] = useState(options.update);
  const [running, setRunning] = useState(false);
  const [runExitCode, setRunExitCode] = useState<InteractiveExitCode>(0);
  const [logs, setLogs] = useState<readonly TuiLogLine[]>([]);
  const [runItems, setRunItems] = useState<readonly TuiRunItemState[]>([]);
  const [logsOpen, setLogsOpen] = useState(false);
  const [filterActive, setFilterActive] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const runningRef = useRef(false);
  const sessionExitCodeRef = useRef<InteractiveExitCode>(0);
  const abortControllerRef = useRef<AbortController | undefined>(undefined);
  const pendingLogsRef = useRef<PendingLogLine[]>([]);
  const logFlushTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const nextLogIdRef = useRef(1);
  const runDisabledReason = getRunDisabledReason(configSource, options);
  const canRun = runDisabledReason === undefined;

  useEffect(() => {
    setSelectedTags((previous) => {
      const next = new Set([...previous].filter((tag) => availableTags.includes(tag)));

      for (const requestedTag of options.tags) {
        if (availableTags.includes(requestedTag)) {
          next.add(requestedTag);
        }
      }

      return next;
    });
  }, [availableTags, options.tags]);

  const selectedTagNames = useMemo(() => [...selectedTags].sort(), [selectedTags]);
  const tagRows = useMemo(
    () => buildTagRows(items, selectedProfile, selectedTags),
    [items, selectedProfile, selectedTags],
  );
  const executionSummary = useMemo(
    () => summarizeSelection(items, selectedProfile, selectedTagNames, options.only),
    [items, options.only, selectedProfile, selectedTagNames],
  );
  const selectedItems = executionSummary.analysis.selectedItems;
  const itemOptions = useMemo<SelectOption[]>(
    () => [
      {
        name: "All selected items",
        description: `${selectedItems.length} items`,
        value: undefined,
      },
      ...selectedItems.map((item) => ({
        name: item.name,
        description: formatReasonBadge(executionSummary.analysis.reasons.get(item.name)),
        value: item.name,
      })),
    ],
    [executionSummary.analysis.reasons, selectedItems],
  );

  const baseSelectOptions = useMemo<SelectOption[]>(() => {
    switch (stage) {
      case "profile":
        return buildProfileOptions(items);
      case "tags":
        return tagRows.map((tag) => ({
          name: formatTagName(tag.name, tag.selected),
          description: `${tag.itemCount} matching items`,
          value: tag.name,
        }));
      case "review":
      case "running":
      case "done":
        return itemOptions;
    }
  }, [itemOptions, items, stage, tagRows]);
  const selectOptions = useMemo(
    () => filterOptions(baseSelectOptions, filterQuery),
    [baseSelectOptions, filterQuery],
  );
  const selectedOption = selectOptions[selectedIndex];

  useEffect(() => {
    setSelectedIndex((current) => clampIndex(current, selectOptions.length));
  }, [selectOptions.length]);

  const highlightedProfile =
    stage === "profile"
      ? ((selectedOption?.value as string | undefined) ?? selectedProfile)
      : selectedProfile;
  const previewTagNames = stage === "profile" ? [] : selectedTagNames;
  const previewSummary = useMemo(
    () => summarizeSelection(items, highlightedProfile, previewTagNames, options.only),
    [highlightedProfile, items, options.only, previewTagNames],
  );

  const selectedItemName =
    stage === "review" || stage === "running" || stage === "done"
      ? ((selectedOption?.value as string | undefined) ?? undefined)
      : undefined;
  const selectedItemReason = selectedItemName
    ? executionSummary.analysis.reasons.get(selectedItemName)
    : undefined;
  const selectedItem = selectedItemName
    ? executionSummary.analysis.itemMap.get(selectedItemName)
    : undefined;
  const itemPreviewLines = getItemPreviewLines(selectedItem, update);
  const dependencyRows = useMemo(
    () => buildDependencyRows(previewSummary, selectedItemName),
    [previewSummary, selectedItemName],
  );
  const visibleLogs = useMemo(
    () => getRenderedLogWindow(filterLogsByItem(logs, selectedItemName)),
    [logs, selectedItemName],
  );

  const clearScheduledLogFlush = useCallback(() => {
    if (logFlushTimeoutRef.current !== undefined) {
      clearTimeout(logFlushTimeoutRef.current);
      logFlushTimeoutRef.current = undefined;
    }
  }, []);

  const flushPendingLogs = useCallback(() => {
    clearScheduledLogFlush();

    if (pendingLogsRef.current.length === 0) {
      return;
    }

    const pending = pendingLogsRef.current;
    pendingLogsRef.current = [];
    setRunItems((current) => applyRunLogs(current, pending));
    setLogs((current) =>
      appendBufferedLogs(current, pending, () => {
        const id = nextLogIdRef.current;
        nextLogIdRef.current += 1;
        return id;
      }),
    );
  }, [clearScheduledLogFlush]);

  const appendLog = useCallback(
    (line: PendingLogLine) => {
      pendingLogsRef.current.push(line);
      if (logFlushTimeoutRef.current === undefined) {
        logFlushTimeoutRef.current = setTimeout(flushPendingLogs, 16);
      }
    },
    [flushPendingLogs],
  );

  useEffect(() => () => clearScheduledLogFlush(), [clearScheduledLogFlush]);

  const goBack = useCallback(() => {
    if (logsOpen) {
      setLogsOpen(false);
      return;
    }

    if (running) {
      return;
    }

    if (stage === "tags") {
      setStage("profile");
      setSelectedIndex(selectedProfileIndex);
      return;
    }

    if (stage === "done") {
      setLogsOpen(false);
      setStage("review");
      return;
    }

    if (stage === "review") {
      setStage("tags");
      setSelectedIndex(0);
    }
  }, [logsOpen, running, selectedProfileIndex, stage]);

  const advance = useCallback(() => {
    if (stage === "running" || stage === "done") {
      setLogsOpen(true);
      return;
    }

    if (running) {
      return;
    }

    if (stage === "profile") {
      const profileName = selectedOption?.value as string | undefined;
      const profileIndex = profileRows.findIndex((profile) => profile.name === profileName);

      if (profileIndex < 0) {
        return;
      }

      setSelectedProfileIndex(profileIndex);
      setStage("tags");
      setSelectedIndex(0);
      return;
    }

    if (stage === "tags") {
      setStage("review");
      setSelectedIndex(0);
      return;
    }
  }, [profileRows, running, selectedOption?.value, stage]);

  const toggleTag = useCallback(() => {
    if (running || stage !== "tags") {
      return;
    }

    const tag = selectedOption?.value as string | undefined;
    if (!tag) {
      return;
    }

    setSelectedTags((current) => {
      const next = new Set(current);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      return next;
    });
  }, [running, selectedOption?.value, stage]);

  const recordRunExitCode = useCallback((exitCode: InteractiveExitCode) => {
    if (exitCode === 1 || sessionExitCodeRef.current === 0) {
      sessionExitCodeRef.current = exitCode;
    }
    setRunExitCode(exitCode);
  }, []);

  const finishRun = useCallback(() => {
    flushPendingLogs();
    runningRef.current = false;
    abortControllerRef.current = undefined;
    setRunning(false);
    setStage("done");
  }, [flushPendingLogs]);

  const runSelection = useCallback(
    async (dryRun: boolean, signal: AbortSignal): Promise<void> => {
      try {
        const summary = await executeRun(
          {
            profile: selectedProfile,
            tags: selectedTagNames,
            only: options.only,
            dryRun,
            update,
            verbose,
            apply: options.apply && !dryRun,
          },
          appendLog,
          signal,
        );
        const exitCode = hasExecutionFailures(summary.results) ? 1 : signal.aborted ? 130 : 0;
        recordRunExitCode(exitCode);
        appendLog({
          kind: exitCode === 1 ? "error" : "system",
          message: exitCode === 130 ? "Run cancelled" : formatPlanLine(summary.results),
        });
      } catch (error: unknown) {
        recordRunExitCode(signal.aborted ? 130 : 1);
        setLogsOpen(true);
        appendLog({
          kind: signal.aborted ? "system" : "error",
          message: signal.aborted ? "Run cancelled" : formatError(error),
        });
      } finally {
        finishRun();
      }
    },
    [
      appendLog,
      executeRun,
      finishRun,
      options.apply,
      options.only,
      recordRunExitCode,
      selectedProfile,
      selectedTagNames,
      update,
      verbose,
    ],
  );

  const startRun = useCallback(
    (dryRun: boolean) => {
      if (runningRef.current || selectedItems.length === 0) {
        if (selectedItems.length === 0) {
          appendLog({ kind: "error", message: "No items selected for this profile/tag set" });
        }
        return;
      }

      if (!dryRun && !canRun) {
        appendLog({ kind: "error", message: `Run disabled: ${runDisabledReason}` });
        return;
      }

      clearScheduledLogFlush();
      pendingLogsRef.current = [];
      nextLogIdRef.current = 1;
      setLogsOpen(false);
      setLogs([]);
      setRunItems(
        createInitialRunItems(selectedItems, selectedProfile, executionSummary.analysis.reasons),
      );
      setStage("running");
      setSelectedIndex(0);
      setRunExitCode(0);
      runningRef.current = true;
      setRunning(true);

      const controller = new AbortController();
      abortControllerRef.current = controller;

      const runPromise = runSelection(dryRun, controller.signal);
      runPromise.catch((error: unknown) => {
        recordRunExitCode(1);
        setLogsOpen(true);
        appendLog({ kind: "error", message: formatError(error) });
        finishRun();
      });
    },
    [
      appendLog,
      canRun,
      clearScheduledLogFlush,
      finishRun,
      recordRunExitCode,
      runDisabledReason,
      runSelection,
      executionSummary.analysis.reasons,
      selectedItems.length,
      selectedItems,
      selectedProfile,
    ],
  );

  const cancelRun = useCallback(() => {
    if (!runningRef.current) {
      return;
    }

    appendLog({ kind: "system", message: "Cancellation requested" });
    abortControllerRef.current?.abort();
  }, [appendLog]);

  useRigKeyboard(
    { running, stage, filterActive, filterQuery, logsOpen },
    {
      exit: () => onExit(sessionExitCodeRef.current),
      cancel: cancelRun,
      back: goBack,
      toggleTag,
      toggleVerbose: () => setVerbose((current) => !current),
      toggleUpdate: () => setUpdate((current) => !current),
      preview: () => startRun(true),
      run: () => startRun(false),
      startFilter: () => setFilterActive(true),
      finishFilter: () => setFilterActive(false),
      clearFilter: () => {
        setFilterQuery("");
        setFilterActive(false);
      },
      appendFilter: (character) => setFilterQuery((current) => `${current}${character}`),
      deleteFilter: () => setFilterQuery((current) => current.slice(0, -1)),
    },
  );

  const stageTitle =
    stage === "profile"
      ? "Choose profile"
      : stage === "tags"
        ? "Choose tags"
        : stage === "review"
          ? "Review selection"
          : stage === "running"
            ? "Running"
            : runExitCode === 1
              ? "Run failed"
              : runExitCode === 130
                ? "Run cancelled"
                : sessionExitCodeRef.current === 1
                  ? "Session failed"
                  : sessionExitCodeRef.current === 130
                    ? "Cancelled"
                    : "Run complete";

  return (
    <box
      style={{
        width: "100%",
        height: "100%",
        flexDirection: "column",
        backgroundColor: palette.bg,
        padding: 1,
        gap: 1,
      }}
    >
      <AppHeader configSource={configSource} />

      <box style={{ flexGrow: 1, flexDirection: "row", gap: 1 }}>
        <SelectorPane
          stageTitle={
            filterQuery.length > 0
              ? `${stageTitle} / filter: ${filterQuery}`
              : filterActive
                ? `${stageTitle} / filter`
                : stageTitle
          }
          borderColor={
            sessionExitCodeRef.current === 1
              ? palette.crimson
              : sessionExitCodeRef.current === 130
                ? palette.amber
                : palette.border
          }
          options={selectOptions}
          selectedIndex={selectedIndex}
          onChange={setSelectedIndex}
          onSelect={advance}
        />

        <DetailsPane
          stage={stage}
          profile={highlightedProfile}
          tags={previewTagNames}
          only={options.only}
          selectedCount={previewSummary.analysis.selectedItems.length}
          directCount={previewSummary.directCount}
          dependencyCount={previewSummary.dependencyCount}
          running={running}
          update={update}
          verbose={verbose}
          canRun={canRun}
          runDisabledReason={runDisabledReason}
          selectedItemName={selectedItemName}
          selectedItemReason={selectedItemReason}
          dependencyRows={dependencyRows}
          itemPreviewLines={itemPreviewLines}
          logs={visibleLogs}
          runItems={runItems}
          logsOpen={logsOpen}
        />
      </box>

      <Footer
        stage={stage}
        running={running}
        verbose={verbose}
        update={update}
        canRun={canRun}
        runDisabledReason={runDisabledReason}
        filterActive={filterActive}
        filterQuery={filterQuery}
        logsOpen={logsOpen}
      />
    </box>
  );
}

export const runInteractiveCommand = (
  input: InteractiveCommandInput,
): Effect.Effect<InteractiveExitCode, ConfigError> =>
  Effect.tryPromise({
    try: async () => {
      const renderer = await createCliRenderer({
        exitOnCtrlC: false,
        consoleMode: "disabled",
        backgroundColor: palette.bg,
      });
      const root = createRoot(renderer);

      return await new Promise<InteractiveExitCode>((resolve) => {
        const close = (exitCode: InteractiveExitCode) => {
          root.unmount();
          renderer.stop();
          renderer.destroy();
          resolve(exitCode);
        };

        root.render(
          <InteractiveRigApp
            options={input.options}
            configSource={input.configSource}
            items={input.items}
            executeRun={(request, emit, signal) =>
              AppRuntime.runPromise(executeInteractivePlan(input, request, emit), {
                signal,
              })
            }
            onExit={close}
          />,
        );
      });
    },
    catch: (error) =>
      new ConfigError({
        message: `Interactive TUI failed: ${formatError(error)}`,
      }),
  });
