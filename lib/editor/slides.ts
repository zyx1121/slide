// Edits to the slide list: a blank slide, a copy of one, moving and
// deleting. Each is one patch, so one undo step, guarded like every edit.
import type { Operation } from "../deck/patch";
import type { Slide } from "../deck/schema";
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
            format: "slide.winlab.tw/shapes",
            version: 1,
            shapes: slide.shapes,
          },
          0
        )
      : [];
  return { ...slide, id: newId("sl"), shapes };
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
