import { describe, expect, it, vi } from "vitest";
import { handleRigKey, type RigKeyboardActions, type RigKeyboardState } from "./keyboard.js";

const baseState = {
  running: false,
  stage: "tags",
  filterActive: false,
  filterQuery: "",
} satisfies RigKeyboardState;

const makeActions = (): RigKeyboardActions => ({
  exit: vi.fn(),
  cancel: vi.fn(),
  back: vi.fn(),
  toggleTag: vi.fn(),
  toggleVerbose: vi.fn(),
  toggleUpdate: vi.fn(),
  preview: vi.fn(),
  run: vi.fn(),
  startFilter: vi.fn(),
  finishFilter: vi.fn(),
  clearFilter: vi.fn(),
  appendFilter: vi.fn(),
  deleteFilter: vi.fn(),
});

describe("TUI keyboard handling", () => {
  it("uses escape and backspace as back navigation outside filter mode", () => {
    const actions = makeActions();

    handleRigKey({ name: "escape" }, baseState, actions);
    handleRigKey({ name: "backspace" }, baseState, actions);

    expect(actions.back).toHaveBeenCalledTimes(2);
  });

  it("starts and edits selector filtering", () => {
    const actions = makeActions();

    handleRigKey({ name: "g" }, baseState, actions);
    handleRigKey({ name: "s" }, { ...baseState, filterActive: true, filterQuery: "" }, actions);
    handleRigKey(
      { name: "backspace" },
      { ...baseState, filterActive: true, filterQuery: "s" },
      actions,
    );
    handleRigKey(
      { name: "escape" },
      { ...baseState, filterActive: true, filterQuery: "server" },
      actions,
    );

    expect(actions.startFilter).toHaveBeenCalledTimes(1);
    expect(actions.appendFilter).toHaveBeenCalledWith("s");
    expect(actions.deleteFilter).toHaveBeenCalledTimes(1);
    expect(actions.clearFilter).toHaveBeenCalledTimes(1);
  });
});
