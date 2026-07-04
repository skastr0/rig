import { useKeyboard } from "@opentui/react";
import { useRef } from "react";
import { handleRigKey, type RigKeyboardActions, type RigKeyboardState } from "./keyboard.js";

export const useRigKeyboard = (state: RigKeyboardState, actions: RigKeyboardActions): void => {
  const stateRef = useRef(state);
  const actionsRef = useRef(actions);

  stateRef.current = state;
  actionsRef.current = actions;

  useKeyboard((key) => {
    handleRigKey(key, stateRef.current, actionsRef.current);
  });
};
