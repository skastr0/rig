import type { SelectOption } from "@opentui/core";
import { formatConfigSource, type ConfigSource } from "../configSource.js";
import {
  formatProgressBar,
  spinnerForRunItem,
  statusLabelForRunItem,
  type TuiRunItemState,
} from "./executionBoard.js";
import {
  formatReasonBadge,
  type TuiDependencyRow,
  type TuiLogLine,
  type TuiStage,
} from "./model.js";
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
  readonly dependencyRows: readonly TuiDependencyRow[];
  readonly itemPreviewLines: readonly string[];
  readonly logs: readonly TuiLogLine[];
  readonly runItems: readonly TuiRunItemState[];
  readonly logsOpen: boolean;
}

interface FooterProps {
  readonly stage: TuiStage;
  readonly running: boolean;
  readonly verbose: boolean;
  readonly update: boolean;
  readonly canRun: boolean;
  readonly runDisabledReason: string | undefined;
  readonly filterActive: boolean;
  readonly filterQuery: string;
  readonly logsOpen: boolean;
}

interface LogStreamProps {
  readonly logs: readonly TuiLogLine[];
}

interface DependencyBoardProps {
  readonly rows: readonly TuiDependencyRow[];
  readonly directCount: number;
  readonly dependencyCount: number;
  readonly itemPreviewLines: readonly string[];
}

interface DependencyRowProps {
  readonly row: TuiDependencyRow;
}

interface RunBoardProps {
  readonly items: readonly TuiRunItemState[];
  readonly selectedItemName: string | undefined;
}

interface RunItemRowProps {
  readonly item: TuiRunItemState;
  readonly selected: boolean;
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

function LogStream({ logs }: LogStreamProps) {
  return (
    <scrollbox
      key="log-stream"
      focused
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
      {logs.length === 0 ? (
        <text fg={palette.muted} wrapMode="word">
          No logs captured for this item.
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

const formatCompactList = (values: readonly string[], emptyLabel: string, limit = 4): string => {
  if (values.length === 0) {
    return emptyLabel;
  }

  const visible = values.slice(0, limit).join(", ");
  const hidden = values.length - limit;

  return hidden > 0 ? `${visible} +${hidden}` : visible;
};

const formatTagChips = (tags: readonly string[]): string =>
  tags.length === 0
    ? "untagged"
    : tags
        .slice(0, 4)
        .map((tag) => `#${tag}`)
        .join(" ");

const dependencyColorFor = (row: TuiDependencyRow): string =>
  row.reason === "direct" ? palette.cyan : palette.violet;

const dependencyPathLabel = (row: TuiDependencyRow): string =>
  row.reason === "direct" ? "root selection" : `path ${row.path.join(" > ")}`;

function DependencyRow({ row }: DependencyRowProps) {
  const color = dependencyColorFor(row);
  const cursor = row.selected ? ">" : " ";
  const glyph = row.reason === "direct" ? "◆" : "◇";

  return (
    <box
      style={{
        flexDirection: "column",
        backgroundColor: row.selected ? palette.panelRaised : palette.panel,
        paddingX: 1,
        paddingY: 0,
        height: 3,
      }}
    >
      <text fg={color} wrapMode="none">
        {`${cursor} ${glyph} ${row.name}  ${row.reason}  ${formatTagChips(row.tags)}`}
      </text>
      <text fg={palette.muted} wrapMode="none">
        {`  bundle ${row.bundle} / ${row.source} / depends on: ${formatCompactList(row.dependsOn, "none")}`}
      </text>
      <text fg={palette.muted} wrapMode="none">
        {`  ${dependencyPathLabel(row)} / required by: ${formatCompactList(row.dependedOnBy, "none", 3)}`}
      </text>
    </box>
  );
}

function DependencyBoard({
  rows,
  directCount,
  dependencyCount,
  itemPreviewLines,
}: DependencyBoardProps) {
  const selectedRow = rows.find((row) => row.selected);
  const previewLines = itemPreviewLines.slice(0, 2);

  if (rows.length === 0) {
    return (
      <box
        style={{
          flexGrow: 1,
          border: true,
          borderColor: palette.border,
          backgroundColor: palette.panelRaised,
          padding: 1,
        }}
      >
        <text fg={palette.muted} wrapMode="word">
          No items selected for this profile/tag set.
        </text>
      </box>
    );
  }

  return (
    <box style={{ flexGrow: 1, flexDirection: "column", gap: 1 }}>
      <box style={{ height: 3, flexDirection: "column" }}>
        <text fg={palette.cyan}>
          {`dependency map / ${rows.length} items / ${directCount} direct / ${dependencyCount} dependencies`}
        </text>
        <text fg={palette.muted} wrapMode="none">
          {selectedRow
            ? `${selectedRow.name} / ${selectedRow.source} / ${selectedRow.reason}`
            : "resolved install graph"}
        </text>
        <text fg={palette.muted} wrapMode="none">
          {`sources: ${formatCompactList([...new Set(rows.map((row) => row.source))], "none", 6)}`}
        </text>
      </box>

      <scrollbox
        key="dependency-board-scroll"
        style={{
          flexGrow: 1,
          backgroundColor: palette.panelRaised,
          padding: 1,
        }}
      >
        {rows.map((row) => (
          <DependencyRow key={row.name} row={row} />
        ))}
      </scrollbox>

      {previewLines.length > 0 ? (
        <box
          style={{
            height: 5,
            flexDirection: "column",
            border: true,
            borderColor: palette.border,
            backgroundColor: palette.panelRaised,
            paddingX: 1,
            paddingY: 0,
          }}
        >
          <text fg={palette.amber} wrapMode="none">
            {`command preview / ${selectedRow?.name ?? "selection"}`}
          </text>
          {previewLines.map((line, index) => (
            <text key={index} fg={index === 0 ? palette.text : palette.muted} wrapMode="none">
              {line}
            </text>
          ))}
        </box>
      ) : undefined}
    </box>
  );
}

const colorForRunItem = (item: TuiRunItemState): string => {
  switch (item.phase) {
    case "queued":
      return palette.muted;
    case "running":
      return palette.blue;
    case "succeeded":
      return palette.green;
    case "skipped":
      return palette.green;
    case "failed":
      return palette.crimson;
    case "blocked":
      return palette.violet;
  }
};

const formatRunItemMeta = (item: TuiRunItemState): string => {
  const tags = item.tags.slice(0, 3).join(" ");
  const extraTags = item.tags.length > 3 ? ` +${item.tags.length - 3}` : "";
  return `bundle ${item.bundle} / ${item.source} / ${item.reason}${tags ? ` / #${tags}${extraTags}` : ""}`;
};

const formatRunItemActivity = (item: TuiRunItemState): string => {
  if (item.phase === "queued") {
    return "waiting for dependencies";
  }

  if (item.phase === "failed") {
    return item.lastMessage ?? item.detail ?? "failed; inspect logs for details";
  }

  if (item.phase === "blocked") {
    return item.detail ?? "blocked by dependency state";
  }

  return item.lastMessage ?? item.detail ?? `${item.outputCount} installer events captured`;
};

function RunItemRow({ item, selected }: RunItemRowProps) {
  const color = colorForRunItem(item);
  const status = statusLabelForRunItem(item);
  const cursor = selected ? ">" : " ";
  const settledOk = item.phase === "succeeded" || item.phase === "skipped";
  const inspectHint =
    selected && item.logCount > 0
      ? " enter inspect"
      : item.phase === "failed"
        ? " inspect logs"
        : "";

  return (
    <box
      style={{
        flexDirection: "column",
        border: true,
        borderColor: selected ? (settledOk ? palette.green : palette.amber) : color,
        backgroundColor: selected ? palette.panelRaised : palette.panel,
        paddingX: 1,
        paddingY: 0,
        height: 6,
      }}
    >
      <text fg={color} wrapMode="none">
        {`${cursor} ${spinnerForRunItem(item)} ${item.name}  ${status}  ${item.progress}%${inspectHint}`}
      </text>
      <text fg={color} wrapMode="none">
        {`  ${formatProgressBar(item.progress)}`}
      </text>
      <text fg={palette.muted} wrapMode="none">
        {`  ${formatRunItemMeta(item)}`}
      </text>
      <text fg={item.phase === "failed" ? palette.crimson : palette.muted} wrapMode="none">
        {`  ${formatRunItemActivity(item)}`}
      </text>
    </box>
  );
}

function RunBoard({ items, selectedItemName }: RunBoardProps) {
  if (items.length === 0) {
    return (
      <text fg={palette.muted} wrapMode="word">
        Run the selection to see install progress.
      </text>
    );
  }

  const finished = items.filter(
    (item) =>
      item.phase === "succeeded" ||
      item.phase === "skipped" ||
      item.phase === "failed" ||
      item.phase === "blocked",
  ).length;
  const failed = items.filter((item) => item.phase === "failed" || item.phase === "blocked").length;

  return (
    <box style={{ flexGrow: 1, flexDirection: "column", gap: 1 }}>
      <box style={{ height: 3, flexDirection: "column" }}>
        <text fg={failed > 0 ? palette.crimson : palette.cyan}>
          {`install board / ${finished}/${items.length} settled${failed > 0 ? ` / ${failed} need inspection` : ""}`}
        </text>
        <text fg={palette.muted}>Select an item and press enter to inspect its logs.</text>
      </box>
      <scrollbox
        key="run-board-scroll"
        stickyScroll
        stickyStart="bottom"
        style={{
          flexGrow: 1,
          backgroundColor: palette.panelRaised,
          padding: 1,
        }}
      >
        {items.map((item) => (
          <RunItemRow key={item.name} item={item} selected={selectedItemName === item.name} />
        ))}
      </scrollbox>
    </box>
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
  dependencyRows,
  itemPreviewLines,
  logs,
  runItems,
  logsOpen,
}: DetailsPaneProps) {
  const itemLabel = selectedItemName
    ? `${selectedItemName} / ${formatReasonBadge(selectedItemReason)}`
    : "all selected items";
  const showRunBoard = stage === "running" || stage === "done";
  const showLogInspector = showRunBoard && logsOpen && selectedItemName !== undefined;

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
      <box style={{ flexDirection: "column", height: 8 }}>
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

      {showLogInspector ? (
        <box style={{ flexGrow: 1, flexDirection: "column", gap: 1 }}>
          <box style={{ height: 3, flexDirection: "column" }}>
            <text fg={palette.amber}>{`logs / ${selectedItemName}`}</text>
            <text fg={palette.muted}>Press b or escape to return to the install board.</text>
          </box>
          <LogStream logs={logs} />
        </box>
      ) : showRunBoard ? (
        <RunBoard items={runItems} selectedItemName={selectedItemName} />
      ) : (
        <DependencyBoard
          rows={dependencyRows}
          directCount={directCount}
          dependencyCount={dependencyCount}
          itemPreviewLines={itemPreviewLines}
        />
      )}
    </box>
  );
}

export function Footer({
  stage,
  running,
  verbose,
  update,
  canRun,
  runDisabledReason,
  filterActive,
  filterQuery,
  logsOpen,
}: FooterProps) {
  const runHint = canRun ? "r run" : `r disabled (${runDisabledReason ?? "preview-only"})`;
  const isRunStage = stage === "running" || stage === "done";
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
        {`${isRunStage ? "enter inspect logs" : "enter next/select"} | space tag | ${filterHint} | p preview | ${runHint} | ${logsOpen ? "b/esc close logs" : "b/esc/backspace back"} | q quit
v verbose [${verbose ? "x" : " "}] | u update [${update ? "x" : " "}] | ${
          running ? "q/ctrl-c cancel run" : "profile -> tags -> preview/run"
        }`}
      </text>
    </box>
  );
}
