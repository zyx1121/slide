// Edits to the slide list: a blank slide, a copy of one, moving and
// deleting. Each is one patch, so one undo step, guarded like every edit.
import type { Operation } from "../deck/patch";
import type { DeckDocument, Layout, Slide } from "../deck/schema";
import { newId } from "../ids";
import { layoutOf } from "../master/layout";
import { bodyOf, isEmptyText } from "../render/svg";
import { pasteShapes } from "./clipboard";
import { atPlace, bakePlaceholder, placeholderShapes } from "./placeholders";

/** A slide with only its layout's title, number and empty placeholders. */
export const blankSlide = (layout?: Layout): Slide => ({
  id: newId("sl"),
  title: "",
  shapes: placeholderShapes(layout),
});

/**
 * Puts the slide at `index` on layout `to`, as PowerPoint does: a
 * placeholder box the new layout also has stays one, and moves with it if
 * it was where the old layout put it; one it lacks becomes a plain text box
 * that looks as before, or goes if it is empty; the new layout's other
 * placeholders arrive empty, behind the slide's shapes.
 */
export function relayoutOps(
  document: DeckDocument,
  index: number,
  to: number
): Operation[] {
  const slide = document.slides[index];
  const from = layoutOf(document, slide);
  const next = document.master.layouts[to];
  const ops: Operation[] = [
    { op: "add", path: `/slides/${index}/layout`, value: to },
  ];
  const kept = new Set<string>();
  const gone: number[] = [];
  slide.shapes.forEach((shape, i) => {
    if (shape.kind !== "text" || shape.placeholder === undefined) return;
    const path = `/slides/${index}/shapes/${i}`;
    const target = bodyOf(next, shape.placeholder);
    if (!target) {
      if (isEmptyText(shape.text)) gone.push(i);
      else
        ops.push({ op: "replace", path, value: bakePlaceholder(shape, from) });
      return;
    }
    kept.add(shape.placeholder);
    const was = bodyOf(from, shape.placeholder);
    if (was && atPlace(shape, was) && !atPlace(shape, target)) {
      ops.push({
        op: "replace",
        path,
        value: { ...shape, x: target.x, y: target.y, w: target.w, h: target.h },
      });
    }
  });
  // Removed last to first, so each index still names its shape.
  for (const i of gone.reverse()) {
    ops.push({ op: "remove", path: `/slides/${index}/shapes/${i}` });
  }
  const taken = new Set(
    document.slides.flatMap((s) => [s.id, ...s.shapes.map((x) => x.id)])
  );
  const arriving = placeholderShapes(
    { bodies: (next.bodies ?? []).filter((body) => !kept.has(body.key)) },
    taken
  );
  for (const shape of arriving.reverse()) {
    ops.push({ op: "add", path: `/slides/${index}/shapes/0`, value: shape });
  }
  return ops;
}

/**
 * A copy of a slide: new ids for it and every shape, connectors glued to
 * the copies, the same places; speaker notes go with it.
 */
export function duplicateSlide(slide: Slide): Slide {
  const shapes =
    slide.shapes.length > 0
      ? pasteShapes(
          {
            format: "slide/shapes",
            version: 1,
            shapes: slide.shapes,
          },
          0,
          true
        )
      : [];
  return { ...slide, id: newId("sl"), shapes };
}

/**
 * Sets a slide's speaker notes, kept as typed; notes of nothing but
 * whitespace remove them. No operations when nothing would change.
 */
export function notesOps(
  slide: Slide,
  index: number,
  notes: string
): Operation[] {
  const path = `/slides/${index}/notes`;
  if (!notes.trim()) {
    return slide.notes === undefined ? [] : [{ op: "remove", path }];
  }
  if (notes === slide.notes) return [];
  return [
    { op: slide.notes === undefined ? "add" : "replace", path, value: notes },
  ];
}

/**
 * Where the slide at position `index` of `before` is in `after`: the same
 * slide, by id, wherever it went; else the same position, within the deck.
 */
export function followSlide(
  before: DeckDocument,
  after: DeckDocument,
  index: number
): number {
  const id = before.slides[index]?.id;
  const found = id ? after.slides.findIndex((slide) => slide.id === id) : -1;
  return found >= 0 ? found : Math.min(index, after.slides.length - 1);
}

/** Puts a slide at position `at` (0 first). */
export const insertSlideOps = (at: number, slide: Slide): Operation[] => [
  { op: "add", path: `/slides/${at}`, value: slide },
];

export const deleteSlideOps = (index: number): Operation[] => [
  { op: "remove", path: `/slides/${index}` },
];

/** Moves a slide from one position to another. */
export const moveSlideOps = (from: number, to: number): Operation[] =>
  from === to
    ? []
    : [{ op: "move", from: `/slides/${from}`, path: `/slides/${to}` }];
