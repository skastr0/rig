const maxBufferedLineLength = 16_384;

export type LineTerminator = "newline" | "carriage-return" | "flush" | "max-length";
export type LineDisplayMode = "append" | "replace";

export interface BufferedLineEvent {
  readonly terminator: LineTerminator;
  readonly displayMode: LineDisplayMode;
}

export type LineEmitter = (line: string, event: BufferedLineEvent) => void;

export interface LineBuffer {
  readonly push: (chunk: string) => void;
  readonly flush: () => void;
}

export const createLineBuffer = (
  emit: LineEmitter | undefined,
  onCallbackError: (error: unknown) => void,
): LineBuffer => {
  let pending = "";
  let pendingCarriageLine: string | undefined;
  let pendingStartedAfterCarriageReturn = false;

  const emitLine = (
    line: string,
    terminator: LineTerminator,
    displayMode: LineDisplayMode,
  ): void => {
    if (!emit) {
      pending = "";
      return;
    }

    try {
      emit(line, { terminator, displayMode });
    } catch (error) {
      onCallbackError(error);
    }
  };

  const displayModeFor = (terminator: LineTerminator): LineDisplayMode =>
    pendingStartedAfterCarriageReturn || terminator === "carriage-return" ? "replace" : "append";

  const emitPending = (terminator: LineTerminator): void => {
    emitLine(pending, terminator, displayModeFor(terminator));
    pending = "";
    pendingStartedAfterCarriageReturn = false;
  };

  const emitPendingCarriageLine = (
    terminator: LineTerminator,
    displayMode: LineDisplayMode,
  ): void => {
    if (pendingCarriageLine === undefined) {
      return;
    }

    emitLine(pendingCarriageLine, terminator, displayMode);
    pendingCarriageLine = undefined;
  };

  return {
    push: (chunk: string): void => {
      if (!emit) {
        return;
      }

      for (const character of chunk) {
        if (pendingCarriageLine !== undefined) {
          if (character === "\n") {
            emitPendingCarriageLine("newline", "append");
            continue;
          }

          emitPendingCarriageLine("carriage-return", "replace");
          pendingStartedAfterCarriageReturn = true;
        }

        if (character === "\r") {
          pendingCarriageLine = pending;
          pending = "";
          continue;
        }

        if (character === "\n") {
          emitPending("newline");
          continue;
        }

        pending += character;
        if (pending.length >= maxBufferedLineLength) {
          emitPending("max-length");
        }
      }
    },
    flush: (): void => {
      emitPendingCarriageLine("carriage-return", "replace");
      if (pending.length > 0) {
        emitPending("flush");
      }
    },
  };
};
