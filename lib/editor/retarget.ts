// Re-points a guarded editor patch (guard.ts) at the slides and shapes its
// tests pin, wherever they are now. A patch addresses them by position, so
// when a change made elsewhere moved them (the member's agent inserted a
// slide before, or deleted a shape below), the patch would be refused whole
// although what it edits is still there. Walked on the document it is about
// to meet, operation by operation, each test finds its id where it is now
// and the operations after it follow, until one moves positions again (the
// guard pins anew after that). An id that is gone is left where it was: its
// test fails and the patch is refused, as before. An insert past the end of
// a list that got shorter goes to its end, and a slide inserted after
// another follows that one.
import { applyOperation, type Operation } from "fast-json-patch";

import type { DeckDocument } from "../deck/schema";

/** A test of a slide's id, or of a shape's on a slide. */
const PIN = /^\/slides\/(\d+)(?:\/shapes\/(\d+))?\/id$/;
/** A slide, or a shape on one, and whatever path lies below it. */
const POSITION = /^\/slides\/(\d+)(?:\/shapes\/(\d+))?(?=\/|$)/;
/** A path that is a slide or a shape itself: changing it moves positions. */
const SLOT = /^\/slides\/(\d+|-)(\/shapes\/(\d+|-))?$/;

/** An insert's position, kept within the list it goes into. */
function withinList(document: DeckDocument, path: string): string {
  const slot = SLOT.exec(path);
  if (!slot) return path;
  const slide = Number(slot[1]);
  if (slot[2] === undefined) {
    return slide > document.slides.length
      ? `/slides/${document.slides.length}`
      : path;
  }
  const shapes = document.slides[slide]?.shapes;
  return shapes && Number(slot[3]) > shapes.length
    ? `/slides/${slide}/shapes/${shapes.length}`
    : path;
}

export function retarget(
  document: DeckDocument,
  patch: Operation[]
): Operation[] {
  let state = structuredClone(document);
  // Positions as the patch has them, to where they are now.
  const slides = new Map<number, number>();
  const shapes = new Map<string, number>();
  const now = (path: string): string => {
    const match = POSITION.exec(path);
    if (!match) return path;
    const rest = path.slice(match[0].length);
    const slide = slides.get(Number(match[1])) ?? Number(match[1]);
    if (match[2] === undefined) return `/slides/${slide}${rest}`;
    const shape = shapes.get(`${match[1]}/${match[2]}`) ?? Number(match[2]);
    return `/slides/${slide}/shapes/${shape}${rest}`;
  };

  const out: Operation[] = [];
  for (const [k, op] of patch.entries()) {
    const id =
      op.op === "test" && typeof op.value === "string" ? op.value : null;
    const pin = id === null ? null : PIN.exec(op.path);
    if (pin && pin[2] === undefined) {
      const at = state.slides.findIndex((slide) => slide.id === id);
      if (at >= 0) slides.set(Number(pin[1]), at);
    } else if (pin) {
      const slide = state.slides[slides.get(Number(pin[1])) ?? Number(pin[1])];
      const at = slide?.shapes.findIndex((shape) => shape.id === id);
      if (at !== undefined && at >= 0) shapes.set(`${pin[1]}/${pin[2]}`, at);
    }

    let moved: Operation = { ...op, path: now(op.path) };
    if (moved.op === "add") {
      // A slide inserted at a position follows the slide before it.
      const slot = SLOT.exec(op.path);
      const before = slot && !slot[2] ? slides.get(Number(slot[1]) - 1) : null;
      const path =
        before !== null && before !== undefined
          ? `/slides/${before + 1}`
          : moved.path;
      moved = { ...moved, path: withinList(state, path) };
    }
    if (moved.op === "move" || moved.op === "copy") {
      moved = { ...moved, from: now(moved.from) };
    }
    out.push(moved);
    try {
      // A copy, so a later operation writing into a value added here leaves
      // the patch as it was.
      state = applyOperation(
        state,
        structuredClone(moved),
        false,
        true
      ).newDocument;
    } catch {
      // It does not fit here; the rest as it was, to be refused whole.
      return [...out, ...patch.slice(k + 1)];
    }
    const paths =
      op.op === "move" || op.op === "copy" ? [op.from, op.path] : [op.path];
    if (
      op.op !== "test" &&
      paths.some((path) => SLOT.test(path) || path.endsWith("/id"))
    ) {
      slides.clear();
      shapes.clear();
    }
  }
  return out;
}
