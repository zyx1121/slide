import { describe, expect, it } from "vitest";

import { applyOperations, type Operation } from "../deck/patch";
import { sampleDocument } from "../deck/sample";
import type { DeckDocument } from "../deck/schema";
import {
  EMPTY_HISTORY,
  type History,
  HISTORY_LIMIT,
  historyAfterReload,
  record,
  redo,
  undo,
} from "./history";

function edit(doc: DeckDocument, history: History, ops: Operation[]) {
  const result = applyOperations(doc, ops);
  return {
    doc: result.document,
    history: record(history, {
      ops: result.operations,
      inverse: result.inverse,
      slide: 0,
    }),
  };
}

const rename = (title: string): Operation[] => [
  { op: "replace", path: "/title", value: title },
];

describe("history", () => {
  it("undoes and redoes edits in order", () => {
    const start = sampleDocument();
    const a = edit(start, EMPTY_HISTORY, rename("A"));
    const b = edit(a.doc, a.history, [
      { op: "remove", path: "/slides/0/shapes/6" },
    ]);

    const back = undo(b.history)!;
    const afterUndo = applyOperations(b.doc, back.ops).document;
    expect(afterUndo).toEqual(a.doc);

    const again = undo(back.history)!;
    expect(applyOperations(afterUndo, again.ops).document).toEqual(start);

    const forward = redo(again.history)!;
    expect(applyOperations(start, forward.ops).document).toEqual(a.doc);
    expect(redo(forward.history)?.ops).toEqual(b.history.past[1].ops);
  });

  it("forgets what could be redone once a new edit is made", () => {
    const a = edit(sampleDocument(), EMPTY_HISTORY, rename("A"));
    const back = undo(a.history)!;
    const b = edit(sampleDocument(), back.history, rename("B"));
    expect(b.history.future).toEqual([]);
    expect(redo(b.history)).toBeNull();
    expect(undo(EMPTY_HISTORY)).toBeNull();
  });

  it("keeps the last edits only", () => {
    let history = EMPTY_HISTORY;
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) {
      history = record(history, {
        ops: rename(`T${i}`),
        inverse: [],
        slide: 0,
      });
    }
    expect(history.past).toHaveLength(HISTORY_LIMIT);
    expect(history.past[0].ops).toEqual(rename("T5"));
  });

  it("keeps, restores or clears the history after a reload", () => {
    const step = {
      ops: [{ op: "replace" as const, path: "/title", value: "B" }],
      inverse: [{ op: "replace" as const, path: "/title", value: "A" }],
      slide: 0,
    };
    const before = record(EMPTY_HISTORY, step);
    const after = undo(before)!.history;
    // Nothing lost: the history stands.
    expect(historyAfterReload(after, true, null)).toBe(after);
    // The undo's save was lost and the server has what it started from.
    expect(
      historyAfterReload(after, false, { history: before, fromDocument: true })
    ).toBe(before);
    // Anything else: the steps no longer apply.
    expect(
      historyAfterReload(after, false, { history: before, fromDocument: false })
    ).toBe(EMPTY_HISTORY);
    expect(historyAfterReload(after, false, null)).toBe(EMPTY_HISTORY);
  });
});
