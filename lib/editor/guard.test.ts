import { describe, expect, it } from "vitest";

import { DeckError } from "../deck/errors";
import { applyOperations } from "../deck/patch";
import { sampleDocument } from "../deck/sample";
import type { DeckDocument } from "../deck/schema";
import { guard } from "./guard";
import { deleteOps, insertOps, moveOps, reorderOps } from "./ops";
import { newShape } from "./preview";

const doc = sampleDocument();
const slide = doc.slides[0];

function refused(document: DeckDocument, ops: unknown): DeckError {
  try {
    applyOperations(document, ops);
  } catch (error) {
    if (error instanceof DeckError) return error;
    throw error;
  }
  throw new Error("expected the patch to be refused");
}

/** The sample deck with sh_asr gone, as a tab that deleted it sees it. */
function withoutAsr(): DeckDocument {
  return applyOperations(doc, deleteOps(slide, 0, new Set(["sh_asr"])))
    .document;
}

describe("guard", () => {
  it("pins every shape an edit touches, once", () => {
    const ops = guard(doc, moveOps(slide, 0, new Set(["sh_asr"]), 10, 0));
    expect(ops).toEqual([
      { op: "test", path: "/slides/0/id", value: "sl_overview" },
      { op: "test", path: "/slides/0/shapes/1/id", value: "sh_asr" },
      { op: "replace", path: "/slides/0/shapes/1/x", value: 1290 },
      { op: "replace", path: "/slides/0/shapes/1/y", value: 320 },
    ]);
    expect(
      applyOperations(doc, ops).document.slides[0].shapes[1]
    ).toMatchObject({ id: "sh_asr", x: 1290 });
  });

  it("refuses an edit made against a document the server does not have", () => {
    // The tab deleted sh_asr but the save never landed; sh_router now sits
    // at position 1 locally and sh_asr still does on the server.
    const local = withoutAsr();
    const move = moveOps(local.slides[0], 0, new Set(["sh_router"]), 10, 400);
    expect(move[0].path).toBe("/slides/0/shapes/1/x");
    // Unguarded, the patch would move sh_asr on the server.
    expect(
      applyOperations(doc, move).document.slides[0].shapes[1]
    ).toMatchObject({ id: "sh_asr", x: 1290 });
    expect(refused(doc, guard(local, move)).code).toBe("invalid_patch");
  });

  it("follows positions as a patch removes and moves shapes", () => {
    const ids = new Set(["sh_capture", "tx_note"]);
    const removal = guard(doc, deleteOps(slide, 0, ids));
    const after = applyOperations(doc, removal).document.slides[0].shapes;
    expect(after.map((shape) => shape.id)).not.toContain("sh_capture");
    expect(after.map((shape) => shape.id)).not.toContain("tx_note");

    const front = guard(
      doc,
      reorderOps(slide, 0, new Set(["sh_capture", "sh_asr"]), "front")
    );
    const reordered = applyOperations(doc, front).document.slides[0].shapes;
    expect(reordered.slice(-2).map((shape) => shape.id)).toEqual([
      "sh_capture",
      "sh_asr",
    ]);

    // Made against a deck where im_demo went to the back first, both refuse.
    const moved = applyOperations(doc, [
      { op: "move", from: "/slides/0/shapes/6", path: "/slides/0/shapes/0" },
    ]).document;
    expect(refused(moved, removal).code).toBe("invalid_patch");
    expect(refused(moved, front).code).toBe("invalid_patch");
  });

  it("pins only the slide for an insert", () => {
    const shape = newShape("rect", slide);
    expect(guard(doc, insertOps(0, shape))).toEqual([
      { op: "test", path: "/slides/0/id", value: "sl_overview" },
      { op: "add", path: "/slides/0/shapes/-", value: shape },
    ]);
  });

  it("guards undo patches too", () => {
    const edit = applyOperations(
      doc,
      deleteOps(slide, 0, new Set(["sh_router"]))
    );
    const undo = guard(edit.document, edit.inverse);
    expect(applyOperations(edit.document, undo).document).toEqual(doc);
  });
});
