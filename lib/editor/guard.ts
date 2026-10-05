// Test operations that pin an editor patch to the shapes it was made for.
// Editor patches address slides and shapes by position. Before each
// operation that touches one, a test checks the id at that position, so a
// patch that meets a different document than it was made against is refused
// whole instead of writing to whatever shape sits there now.
import { applyOperation, type Operation } from "fast-json-patch";

import type { DeckDocument } from "../deck/schema";

/** A slide, or a shape on one, and whatever path lies below it. */
const POSITION = /^\/slides\/(\d+)(?:\/shapes\/(\d+))?(?=\/|$)/;
/** A path that is a slide or a shape itself: changing it moves positions. */
const SLOT = /^\/slides\/(\d+|-)(\/shapes\/(\d+|-))?$/;

/** Whether an operation writes into a position rather than changing what is there. */
function inserts(op: Operation, path: string): boolean {
  return (
    (op.op === "add" && path === op.path) ||
    (op.op === "move" && path === op.path)
  );
}

/**
 * The patch with a test before each operation for the id of every slide and
 * shape the operation addresses, as they stand at that point of the patch.
 * A test is not repeated until an operation moves positions.
 */
export function guard(document: DeckDocument, ops: Operation[]): Operation[] {
  let state = structuredClone(document);
  const guarded: Operation[] = [];
  let pinned = new Set<string>();
  const pin = (path: string, value: string) => {
    if (pinned.has(path)) return;
    pinned.add(path);
    guarded.push({ op: "test", path, value });
  };

  for (const op of ops) {
    const paths = op.op === "move" ? [op.from, op.path] : [op.path];
    for (const path of paths) {
      const match = POSITION.exec(path);
      if (!match) continue;
      const at = Number(match[1]);
      // A slide inserted at a position goes after the slide before it.
      if (op.op === "add" && match[2] === undefined && SLOT.test(path)) {
        const before = state.slides[at - 1];
        if (before) pin(`/slides/${at - 1}/id`, before.id);
      }
      const slide = state.slides[at];
      if (!slide) continue;
      pin(`/slides/${match[1]}/id`, slide.id);
      if (match[2] === undefined) continue;
      // Inserting at a position names a gap, not the shape now in it.
      if (inserts(op, path) && SLOT.test(path)) continue;
      const shape = slide.shapes[Number(match[2])];
      if (shape) pin(`/slides/${match[1]}/shapes/${match[2]}/id`, shape.id);
    }
    guarded.push(op);
    // A copy, so a later operation writing into a value added here leaves
    // the patch as it was.
    state = applyOperation(state, structuredClone(op), false, true).newDocument;
    const moves = paths.some((path) => SLOT.test(path) || path.endsWith("/id"));
    if (moves) pinned = new Set();
  }
  return guarded;
}
