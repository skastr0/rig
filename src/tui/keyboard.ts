import type { TuiStage } from "./model.js";

interface RigKeyInput {
  readonly name: string;
  readonly ctrl?: boolean;
}

export interface RigKeyboardState {
  readonly running: boolean;
  readonly stage: TuiStage;
  readonly filterActive: boolean;
  readonly filterQuery: string;
}

export interface RigKeyboardActions {
  readonly exit: () => void;
  readonly cancel: () => void;
  readonly back: () => void;
  readonly toggleTag: () => void;
  readonly toggleVerbose: () => void;
  readonly toggleUpdate: () => void;
  readonly preview: () => void;
  readonly run: () => void;
  readonly startFilter: () => void;
  readonly finishFilter: () => void;
  readonly clearFilter: () => void;
  readonly appendFilter: (character: string) => void;
  readonly deleteFilter: () => void;
}

const canStartFromStage = (stage: TuiStage): boolean => stage === "review" || stage === "done";

const isPrintableFilterCharacter = (name: string, ctrl: boolean | undefined): boolean =>
  !ctrl && name.length === 1;

const handleCtrlC = (
  name: string,
  key: RigKeyInput,
  state: RigKeyboardState,
  actions: RigKeyboardActions,
): boolean => {
  if (!(key.ctrl && name === "c")) {
    return false;
  }

  if (state.running) {
    actions.cancel();
  } else {
    actions.exit();
  }
  return true;
};

const handleFilterKey = (
  name: string,
  key: RigKeyInput,
  state: RigKeyboardState,
  actions: RigKeyboardActions,
): boolean => {
  if (!state.filterActive) {
    return false;
  }

  const filterActions: Record<string, () => void> = {
    escape: actions.clearFilter,
    enter: actions.finishFilter,
    backspace: () => {
      if (state.filterQuery.length > 0) {
        actions.deleteFilter();
      } else {
        actions.finishFilter();
      }
    },
  };
  const filterAction = filterActions[name];
  if (filterAction) {
    filterAction();
    return true;
  }

  if (isPrintableFilterCharacter(name, key.ctrl)) {
    actions.appendFilter(name);
  }
  return true;
};

const handleQuitKey = (
  name: string,
  state: RigKeyboardState,
  actions: RigKeyboardActions,
): boolean => {
  if (name !== "q") {
    return false;
  }

  if (state.running) {
    actions.cancel();
  } else {
    actions.exit();
  }
  return true;
};

const handleNavigationKey = (
  name: string,
  state: RigKeyboardState,
  actions: RigKeyboardActions,
): boolean => {
  if (name === "g") {
    actions.startFilter();
    return true;
  }

  if ((name === "escape" || name === "backspace") && !state.running) {
    actions.back();
    return true;
  }

  return false;
};

const handleOptionKey = (
  name: string,
  state: RigKeyboardState,
  actions: RigKeyboardActions,
): boolean => {
  const unconditionalActions: Record<string, () => void> = {
    v: actions.toggleVerbose,
    b: actions.back,
    space: actions.toggleTag,
  };
  const unconditionalAction = unconditionalActions[name];
  if (unconditionalAction) {
    unconditionalAction();
    return true;
  }

  if (name === "u" && !state.running) {
    actions.toggleUpdate();
    return true;
  }

  return false;
};

const handleRunKey = (name: string, state: RigKeyboardState, actions: RigKeyboardActions): void => {
  if (!canStartFromStage(state.stage)) {
    return;
  }

  const runActions: Record<string, () => void> = {
    p: actions.preview,
    r: actions.run,
  };
  runActions[name]?.();
};

export const handleRigKey = (
  key: RigKeyInput,
  state: RigKeyboardState,
  actions: RigKeyboardActions,
): void => {
  const name = key.name.toLowerCase();

  if (
    handleCtrlC(name, key, state, actions) ||
    handleFilterKey(name, key, state, actions) ||
    handleQuitKey(name, state, actions) ||
    handleNavigationKey(name, state, actions) ||
    handleOptionKey(name, state, actions)
  ) {
    return;
  }

  handleRunKey(name, state, actions);
};
