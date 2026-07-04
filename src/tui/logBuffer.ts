import type { TuiLogLine } from "./model.js";
import type { PendingLogLine } from "./runner.js";

export const maxStoredLogLines = 1_000;
export const maxRenderedLogLines = 200;
export const maxLogMessageLength = 800;

const truncatedSuffix = " ... [truncated]";
const excessiveSpacePattern = / {8,}/g;

const escapeCode = 0x1b;
const bellCode = 0x07;
const tabCode = 0x09;
const stringTerminatorCode = 0x5c;
const oscIntroducerCode = 0x5d;
const csiIntroducerCode = 0x5b;
const csi8BitCode = 0x9b;

const isAnsiFinalByte = (code: number): boolean => code >= 0x40 && code <= 0x7e;

const isControlCode = (code: number): boolean =>
  code !== tabCode && ((code >= 0x00 && code <= 0x1f) || (code >= 0x7f && code <= 0x9f));

const skipAnsiSequence = (text: string, startIndex: number): number => {
  const nextCode = text.charCodeAt(startIndex + 1);

  if (nextCode === oscIntroducerCode) {
    for (let index = startIndex + 2; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      if (code === bellCode) {
        return index;
      }

      if (code === escapeCode && text.charCodeAt(index + 1) === stringTerminatorCode) {
        return index + 1;
      }
    }

    return text.length - 1;
  }

  if (nextCode === csiIntroducerCode) {
    for (let index = startIndex + 2; index < text.length; index += 1) {
      if (isAnsiFinalByte(text.charCodeAt(index))) {
        return index;
      }
    }

    return text.length - 1;
  }

  return Math.min(startIndex + 1, text.length - 1);
};

const skip8BitCsiSequence = (text: string, startIndex: number): number => {
  for (let index = startIndex + 1; index < text.length; index += 1) {
    if (isAnsiFinalByte(text.charCodeAt(index))) {
      return index;
    }
  }

  return text.length - 1;
};

const stripTerminalControls = (text: string): string => {
  let stripped = "";

  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);

    if (code === escapeCode) {
      index = skipAnsiSequence(text, index);
      continue;
    }

    if (code === csi8BitCode) {
      index = skip8BitCsiSequence(text, index);
      continue;
    }

    if (isControlCode(code)) {
      continue;
    }

    stripped += text[index];
  }

  return stripped;
};

const normalizeWhitespace = (text: string): string =>
  text.replace(/\t/g, "  ").replace(excessiveSpacePattern, "    ");

const truncateLogMessage = (message: string): string => {
  if (message.length <= maxLogMessageLength) {
    return message;
  }

  return `${message.slice(0, maxLogMessageLength - truncatedSuffix.length).trimEnd()}${truncatedSuffix}`;
};

const sanitizeLogLine = (line: string): string | undefined => {
  const cleaned = normalizeWhitespace(stripTerminalControls(line)).trim();
  return cleaned.length === 0 ? undefined : truncateLogMessage(cleaned);
};

const sanitizeLabel = (label: string | undefined): string | undefined => {
  if (label === undefined) {
    return undefined;
  }

  return sanitizeLogLine(label.replace(/\r\n|\r|\n/g, " "));
};

const splitSanitizedMessage = (message: string): readonly string[] =>
  message
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .flatMap((line) => {
      const sanitized = sanitizeLogLine(line);
      return sanitized === undefined ? [] : [sanitized];
    });

const findReplaceableLogIndex = (
  logs: readonly TuiLogLine[],
  coalesceKey: string | undefined,
): number => {
  if (coalesceKey === undefined) {
    return -1;
  }

  for (let index = logs.length - 1; index >= 0; index -= 1) {
    const log = logs[index];
    if (log?.coalesceKey === coalesceKey && log.replaceable === true) {
      return index;
    }
  }

  return -1;
};

const formatLogMessage = (label: string | undefined, message: string): string =>
  label === undefined ? message : `${label} ${message}`;

const toLogLine = (
  line: PendingLogLine,
  id: number,
  message: string,
  replaceable: boolean | undefined,
): TuiLogLine => ({
  kind: line.kind,
  message,
  id,
  ...(line.itemName === undefined ? {} : { itemName: line.itemName }),
  ...(line.coalesceKey === undefined ? {} : { coalesceKey: line.coalesceKey }),
  ...(replaceable === undefined ? {} : { replaceable }),
});

const normalizePendingLogLine = (
  line: PendingLogLine,
): readonly { readonly message: string; readonly replaceable: boolean | undefined }[] => {
  const label = sanitizeLabel(line.label);
  const sanitizedMessages = splitSanitizedMessage(line.message);

  return sanitizedMessages.map((message) => ({
    message: formatLogMessage(label, message),
    replaceable: line.replaceable,
  }));
};

export const appendBufferedLogs = (
  current: readonly TuiLogLine[],
  pending: readonly PendingLogLine[],
  allocateId: () => number,
): readonly TuiLogLine[] => {
  let next = [...current];

  for (const line of pending) {
    const normalizedLines = normalizePendingLogLine(line);

    for (const [index, normalizedLine] of normalizedLines.entries()) {
      const lineDisplayMode = index === 0 ? line.displayMode : "append";
      const replaceIndex =
        lineDisplayMode === "replace" ? findReplaceableLogIndex(next, line.coalesceKey) : -1;

      if (replaceIndex >= 0) {
        const existing = next[replaceIndex];
        if (existing !== undefined) {
          next[replaceIndex] = toLogLine(
            line,
            existing.id,
            normalizedLine.message,
            normalizedLine.replaceable,
          );
          continue;
        }
      }

      next.push(toLogLine(line, allocateId(), normalizedLine.message, normalizedLine.replaceable));
      if (next.length > maxStoredLogLines) {
        next = next.slice(-maxStoredLogLines);
      }
    }
  }

  return next;
};

export const getRenderedLogWindow = (logs: readonly TuiLogLine[]): readonly TuiLogLine[] =>
  logs.length > maxRenderedLogLines ? logs.slice(-maxRenderedLogLines) : logs;
