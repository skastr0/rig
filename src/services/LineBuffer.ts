const maxBufferedLineLength = 16_384;

export interface LineBuffer {
  readonly push: (chunk: string) => void;
  readonly flush: () => void;
}

export const createLineBuffer = (
  emit: ((line: string) => void) | undefined,
  onCallbackError: (error: unknown) => void,
): LineBuffer => {
  let pending = "";
  let skipNextLineFeed = false;

  const emitLine = (line: string): void => {
    if (!emit) {
      pending = "";
      return;
    }

    try {
      emit(line);
    } catch (error) {
      onCallbackError(error);
    }
  };

  const emitPending = (): void => {
    emitLine(pending);
    pending = "";
  };

  return {
    push: (chunk: string): void => {
      if (!emit) {
        return;
      }

      for (const character of chunk) {
        if (skipNextLineFeed) {
          skipNextLineFeed = false;
          if (character === "\n") {
            continue;
          }
        }

        if (character === "\r") {
          emitPending();
          skipNextLineFeed = true;
          continue;
        }

        if (character === "\n") {
          emitPending();
          continue;
        }

        pending += character;
        if (pending.length >= maxBufferedLineLength) {
          emitPending();
        }
      }
    },
    flush: (): void => {
      if (pending.length > 0) {
        emitPending();
      }
    },
  };
};
