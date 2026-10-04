// Edits to the slide list: a blank slide, a copy of one, moving and
// deleting. Each is one patch, so one undo step, guarded like every edit.
import type { Operation } from "../deck/patch";
import type { DeckDocument, Slide } from "../deck/schema";
import { newId } from "../ids";
import { pasteShapes } from "./clipboard";

/** A slide with only the template's title and number. */
export const blankSlide = (): Slide => ({
  id: newId("sl"),
  title: "",
  shapes: [],
});

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
          0
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
