import { useKeyboard } from "@opentui/react";
import type { TuiStage } from "./model.js";

interface RigKeyboardState {
  readonly running: boolean;
  readonly stage: TuiStage;
}

interface RigKeyboardActions {
  readonly exit: () => void;
  readonly cancel: () => void;
  readonly back: () => void;
  readonly toggleTag: () => void;
  readonly toggleVerbose: () => void;
  readonly toggleUpdate: () => void;
  readonly preview: () => void;
  readonly run: () => void;
}

const canStartFromStage = (stage: TuiStage): boolean => stage === "review" || stage === "done";

export const useRigKeyboard = (state: RigKeyboardState, actions: RigKeyboardActions): void => {
  useKeyboard((key) => {
    const name = key.name.toLowerCase();

    if (key.ctrl && name === "c") {
      if (state.running) {
        actions.cancel();
      } else {
        actions.exit();
      }
      return;
    }

    if (name === "q" && state.running) {
      actions.cancel();
      return;
    }

    if (name === "q" && !state.running) {
      actions.exit();
      return;
    }

    const unconditionalActions: Record<string, () => void> = {
      v: actions.toggleVerbose,
      b: actions.back,
      space: actions.toggleTag,
    };
    const unconditionalAction = unconditionalActions[name];
    if (unconditionalAction) {
      unconditionalAction();
      return;
    }

    if (name === "u" && !state.running) {
      actions.toggleUpdate();
      return;
    }

    if (!canStartFromStage(state.stage)) {
      return;
    }

    if (name === "p") {
      actions.preview();
      return;
    }

    if (name === "r") {
      actions.run();
    }
  });
};
