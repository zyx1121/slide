import { describe, expect, it } from "vitest";

import { applyOperations } from "../deck/patch";
import { sampleDocument } from "../deck/sample";
import { followSlide } from "../editor/slides";
import { act, actionOf, typed, type Show } from "./control";

const at = (index: number, blank: Show["blank"] = null): Show => ({
  index,
  blank,
});

describe("presenting", () => {
  it("reads a clicker's keys and the usual ones", () => {
    for (const key of ["ArrowRight", "ArrowDown", "PageDown", "Enter", " "]) {
      expect(actionOf(key)).toEqual({ kind: "step", by: 1 });
    }
    for (const key of ["ArrowLeft", "ArrowUp", "PageUp", "Backspace"]) {
      expect(actionOf(key)).toEqual({ kind: "step", by: -1 });
    }
    expect(actionOf(" ", true)).toEqual({ kind: "step", by: -1 });
    expect(actionOf("Home")).toEqual({ kind: "first" });
    expect(actionOf("End")).toEqual({ kind: "last" });
    expect(actionOf("b")).toEqual({ kind: "blank", blank: "black" });
    expect(actionOf(".")).toEqual({ kind: "blank", blank: "black" });
    expect(actionOf("w")).toEqual({ kind: "blank", blank: "white" });
    expect(actionOf("x")).toBeNull();
  });

  it("goes to a slide by its number typed before Enter", () => {
    let state = typed("", "1");
    expect(state).toEqual({ digits: "1", action: null });
    state = typed(state.digits, "2");
    state = typed(state.digits, "Enter");
    expect(state).toEqual({ digits: "", action: { kind: "goto", index: 11 } });
    // Without digits, Enter steps on; another key forgets the digits.
    expect(typed("", "Enter").action).toEqual({ kind: "step", by: 1 });
    expect(typed("4", "ArrowLeft")).toEqual({
      digits: "",
      action: { kind: "step", by: -1 },
    });
  });

  it("moves within the deck, and a blank screen lifts before it moves", () => {
    expect(act(at(0), 3, { kind: "step", by: -1 })).toEqual(at(0));
    expect(act(at(2), 3, { kind: "step", by: 1 })).toEqual(at(2));
    expect(act(at(1), 3, { kind: "last" })).toEqual(at(2));
    expect(act(at(1), 3, { kind: "goto", index: 40 })).toEqual(at(2));
    const black = act(at(1), 3, { kind: "blank", blank: "black" });
    expect(black).toEqual(at(1, "black"));
    expect(act(black, 3, { kind: "blank", blank: "black" })).toEqual(at(1));
    expect(act(black, 3, { kind: "blank", blank: "white" })).toEqual(
      at(1, "white")
    );
    expect(act(black, 3, { kind: "step", by: 1 })).toEqual(at(1));
  });

  it("stays on the same slide when the deck changes elsewhere", () => {
    const before = applyOperations(sampleDocument(), [
      {
        op: "add",
        path: "/slides/-",
        value: { id: "sl_second", title: "", shapes: [] },
      },
    ]).document;
    const inserted = applyOperations(before, [
      {
        op: "add",
        path: "/slides/0",
        value: { id: "sl_agent", title: "", shapes: [] },
      },
    ]).document;
    expect(followSlide(before, inserted, 1)).toBe(2);
    const removed = applyOperations(before, [
      { op: "remove", path: "/slides/1" },
    ]).document;
    expect(followSlide(before, removed, 1)).toBe(0);
  });
});
