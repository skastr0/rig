import { createCliRenderer, type SelectOption } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { Effect } from "effect";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatError } from "../errorFormatting.js";
import { ConfigError } from "../errors.js";
import { AppRuntime } from "../runtime.js";
import type { SystemItem } from "../schema/config.js";
import { AppHeader, DetailsPane, Footer, SelectorPane } from "./components.js";
import {
  buildProfileRows,
  buildTagRows,
  filterOptions,
  filterLogsByItem,
  formatReasonBadge,
  formatDependencyTreeLines,
  getItemPreviewLines,
  summarizeSelection,
  type TuiLogLine,
  type TuiStage,
} from "./model.js";
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

interface InteractiveRigAppProps {
  readonly options: InteractiveCommandInput["options"];
  readonly configSource: InteractiveCommandInput["configSource"];
  readonly items: readonly SystemItem[];
  readonly executeRun: ExecuteInteractiveRun;
  readonly onExit: () => void;
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

function InteractiveRigApp({
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
  const [logs, setLogs] = useState<readonly TuiLogLine[]>([]);
  const [filterActive, setFilterActive] = useState(false);
  const [filterQuery, setFilterQuery] = useState("");
  const runningRef = useRef(false);
  const abortControllerRef = useRef<AbortController | undefined>(undefined);
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
  const idlePreviewLines =
    itemPreviewLines.length > 0 ? itemPreviewLines : formatDependencyTreeLines(previewSummary);
  const visibleLogs = filterLogsByItem(logs, selectedItemName);

  const appendLog = useCallback((line: PendingLogLine) => {
    setLogs((current) => [
      ...current,
      {
        ...line,
        id: current.length + 1,
      },
    ]);
  }, []);

  const goBack = useCallback(() => {
    if (running) {
      return;
    }

    if (stage === "tags") {
      setStage("profile");
      setSelectedIndex(selectedProfileIndex);
      return;
    }

    if (stage === "review" || stage === "done") {
      setStage("tags");
      setSelectedIndex(0);
    }
  }, [running, selectedProfileIndex, stage]);

  const advance = useCallback(() => {
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

  const finishRun = useCallback(() => {
    runningRef.current = false;
    abortControllerRef.current = undefined;
    setRunning(false);
    setStage("done");
  }, []);

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
        appendLog({ kind: "system", message: formatPlanLine(summary.results) });
      } catch (error: unknown) {
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

      setLogs([]);
      setStage("running");
      setSelectedIndex(0);
      runningRef.current = true;
      setRunning(true);

      const controller = new AbortController();
      abortControllerRef.current = controller;

      const runPromise = runSelection(dryRun, controller.signal);
      runPromise.catch((error: unknown) => {
        appendLog({ kind: "error", message: formatError(error) });
        finishRun();
      });
    },
    [appendLog, canRun, finishRun, runDisabledReason, runSelection, selectedItems.length],
  );

  const cancelRun = useCallback(() => {
    if (!runningRef.current) {
      return;
    }

    appendLog({ kind: "system", message: "Cancellation requested" });
    abortControllerRef.current?.abort();
  }, [appendLog]);

  useRigKeyboard(
    { running, stage, filterActive, filterQuery },
    {
      exit: onExit,
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
          itemPreviewLines={idlePreviewLines}
          logs={visibleLogs}
        />
      </box>

      <Footer
        running={running}
        verbose={verbose}
        update={update}
        canRun={canRun}
        runDisabledReason={runDisabledReason}
        filterActive={filterActive}
        filterQuery={filterQuery}
      />
    </box>
  );
}

export const runInteractiveCommand = (
  input: InteractiveCommandInput,
): Effect.Effect<void, ConfigError> =>
  Effect.tryPromise({
    try: async () => {
      const renderer = await createCliRenderer({
        exitOnCtrlC: false,
        consoleMode: "disabled",
        backgroundColor: palette.bg,
      });
      const root = createRoot(renderer);

      await new Promise<void>((resolve) => {
        const close = () => {
          root.unmount();
          renderer.stop();
          renderer.destroy();
          resolve();
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
