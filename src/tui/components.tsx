import type { SelectOption } from "@opentui/core";
import { formatConfigSource, type ConfigSource } from "../configSource.js";
import { formatReasonBadge, type TuiLogLine, type TuiStage } from "./model.js";
import { tuiPalette as palette } from "./palette.js";

interface HeaderProps {
  readonly configSource: ConfigSource;
}

interface SelectorPaneProps {
  readonly stageTitle: string;
  readonly options: SelectOption[];
  readonly selectedIndex: number;
  readonly onChange: (index: number) => void;
  readonly onSelect: () => void;
}

interface DetailsPaneProps {
  readonly stage: TuiStage;
  readonly profile: string;
  readonly tags: readonly string[];
  readonly only: readonly string[];
  readonly selectedCount: number;
  readonly directCount: number;
  readonly dependencyCount: number;
  readonly running: boolean;
  readonly update: boolean;
  readonly verbose: boolean;
  readonly canRun: boolean;
  readonly runDisabledReason: string | undefined;
  readonly selectedItemName: string | undefined;
  readonly selectedItemReason: Parameters<typeof formatReasonBadge>[0];
  readonly itemPreviewLines: readonly string[];
  readonly logs: readonly TuiLogLine[];
}

interface FooterProps {
  readonly running: boolean;
  readonly verbose: boolean;
  readonly update: boolean;
  readonly canRun: boolean;
  readonly runDisabledReason: string | undefined;
  readonly filterActive: boolean;
  readonly filterQuery: string;
}

interface LogStreamProps {
  readonly stage: TuiStage;
  readonly previewLines: readonly string[];
  readonly logs: readonly TuiLogLine[];
}

const logColorFor = (kind: TuiLogLine["kind"]): string => {
  switch (kind) {
    case "system":
      return palette.cyan;
    case "progress":
      return palette.text;
    case "preview":
      return palette.amber;
    case "output":
      return palette.text;
    case "verbose":
      return palette.muted;
    case "error":
      return palette.crimson;
  }
};

function LogStream({ stage, previewLines, logs }: LogStreamProps) {
  const showIdlePreview = logs.length === 0 && previewLines.length > 0;

  return (
    <scrollbox
      focused={stage === "running" || stage === "done"}
      stickyScroll
      stickyStart="bottom"
      style={{
        flexGrow: 1,
        border: true,
        borderColor: palette.border,
        backgroundColor: palette.panelRaised,
        padding: 1,
      }}
    >
      {showIdlePreview ? (
        previewLines.map((line, index) => (
          <text key={index} fg={index === 0 ? palette.amber : palette.text} wrapMode="word">
            {line}
          </text>
        ))
      ) : logs.length === 0 ? (
        <text fg={palette.muted} wrapMode="word">
          {stage === "review" || stage === "profile" || stage === "tags"
            ? "Select an item to inspect install/update commands. Press p to preview."
            : "No logs yet."}
        </text>
      ) : (
        logs.map((line) => (
          <text key={line.id} fg={logColorFor(line.kind)} wrapMode="word">
            {line.message}
          </text>
        ))
      )}
    </scrollbox>
  );
}

export function AppHeader({ configSource }: HeaderProps) {
  return (
    <box style={{ height: 3, flexDirection: "column" }}>
      <text fg={palette.amber}>rig / interactive configuration</text>
      <text fg={palette.muted}>{formatConfigSource(configSource)}</text>
    </box>
  );
}

export function SelectorPane({
  stageTitle,
  options,
  selectedIndex,
  onChange,
  onSelect,
}: SelectorPaneProps) {
  return (
    <box
      title={stageTitle}
      style={{
        width: "36%",
        height: "100%",
        border: true,
        borderColor: palette.border,
        backgroundColor: palette.panel,
        padding: 1,
      }}
    >
      <select
        focused
        width="100%"
        height="100%"
        options={options}
        selectedIndex={selectedIndex}
        showScrollIndicator
        wrapSelection
        fastScrollStep={8}
        backgroundColor={palette.panel}
        textColor={palette.text}
        descriptionColor={palette.muted}
        selectedBackgroundColor={palette.amber}
        selectedTextColor={palette.bg}
        selectedDescriptionColor={palette.bg}
        focusedBackgroundColor={palette.panelRaised}
        focusedTextColor={palette.text}
        onChange={onChange}
        onSelect={onSelect}
      />
    </box>
  );
}

export function DetailsPane({
  stage,
  profile,
  tags,
  only,
  selectedCount,
  directCount,
  dependencyCount,
  running,
  update,
  verbose,
  canRun,
  runDisabledReason,
  selectedItemName,
  selectedItemReason,
  itemPreviewLines,
  logs,
}: DetailsPaneProps) {
  const itemLabel = selectedItemName
    ? `${selectedItemName} / ${formatReasonBadge(selectedItemReason)}`
    : "all selected items";

  return (
    <box
      title="Details"
      style={{
        flexGrow: 1,
        height: "100%",
        border: true,
        borderColor: palette.border,
        backgroundColor: palette.panel,
        padding: 1,
        flexDirection: "column",
        gap: 1,
      }}
    >
      <box style={{ flexDirection: "column", height: 10 }}>
        <text fg={palette.cyan}>profile: {profile || "none"}</text>
        <text fg={palette.text}>tags: {tags.length > 0 ? tags.join(", ") : "all"}</text>
        <text fg={palette.text}>only: {only.length > 0 ? only.join(", ") : "all"}</text>
        <text fg={palette.text}>
          selected: {selectedCount} total / {directCount} direct / {dependencyCount} dependencies
        </text>
        <text fg={running ? palette.amber : palette.muted}>
          mode: {running ? "executing" : update ? "update" : "install"} / verbose{" "}
          {verbose ? "on" : "off"}
        </text>
        <text fg={canRun ? palette.muted : palette.crimson}>
          run: {canRun ? "enabled" : (runDisabledReason ?? "disabled")}
        </text>
        <text fg={palette.muted}>item: {itemLabel}</text>
      </box>

      <LogStream stage={stage} previewLines={itemPreviewLines} logs={logs} />
    </box>
  );
}

export function Footer({
  running,
  verbose,
  update,
  canRun,
  runDisabledReason,
  filterActive,
  filterQuery,
}: FooterProps) {
  const runHint = canRun ? "r run" : `r disabled (${runDisabledReason ?? "preview-only"})`;
  const filterHint =
    filterQuery.length > 0
      ? `g filter [${filterQuery}]`
      : filterActive
        ? "g filter [typing]"
        : "g filter";

  return (
    <box
      style={{
        height: 4,
        border: true,
        borderColor: palette.border,
        backgroundColor: palette.panelRaised,
        paddingX: 1,
        flexDirection: "column",
      }}
    >
      <text fg={palette.amber} wrapMode="word">
        {`enter next/select | space tag | ${filterHint} | p preview | ${runHint} | b/esc/backspace back | q quit
v verbose [${verbose ? "x" : " "}] | u update [${update ? "x" : " "}] | ${
          running ? "q/ctrl-c cancel run" : "profile -> tags -> preview/run"
        }`}
      </text>
    </box>
  );
}
