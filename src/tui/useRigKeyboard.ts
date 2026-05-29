import { useKeyboard } from "@opentui/react";
import { handleRigKey, type RigKeyboardActions, type RigKeyboardState } from "./keyboard.js";

export const useRigKeyboard = (state: RigKeyboardState, actions: RigKeyboardActions): void => {
  useKeyboard((key) => {
    handleRigKey(key, state, actions);
  });
};
