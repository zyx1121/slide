// Agents edit decks by id: shapes and slides keep their ids for life
// (PLAN.md, Rule 3). These turn an agent's request into a JSON Patch against
// the deck as it is, with id tests in front, so it lands on the same shapes
// or is refused if they moved.
import type { Operation } from "../deck/patch";
import type { DeckDocument, Shape, Slide } from "../deck/schema";
import { newId } from "../ids";
import { guard } from "../editor/guard";
import { deleteOps } from "../editor/ops";
import { duplicateSlide, insertSlideOps } from "../editor/slides";
import type { TemplateId } from "../render/template";

export class WriteError extends Error {}

/** A slide by its 1-based number or its id. */
export function findSlide(document: DeckDocument, slide: number | string) {
  const index =
    typeof slide === "number"
      ? slide - 1
      : document.slides.findIndex((item) => item.id === slide);
  const found = document.slides[index];
  if (!found) throw new WriteError(`no slide ${slide} in the deck`);
  return { slide: found, index };
}

const ID = /^[a-z]+_[0-9a-z_-]{2,48}$/;

const PREFIX: Record<Shape["kind"], string> = {
  rect: "sh",
  roundRect: "sh",
  ellipse: "sh",
  preset: "sh",
  freeform: "sh",
  text: "tx",
  image: "im",
  line: "ln",
};

/**
 * Gives new shapes ids (keeping one the agent chose only when it is free),
 * and points connector ends that name a shape by an id the agent chose at
 * the id it got.
 */
function withIds(shapes: Record<string, unknown>[], taken: Set<string>) {
  const renamed = new Map<string, string>();
  const out: Record<string, unknown>[] = shapes.map((shape) => {
    const kind = shape.kind as Shape["kind"];
    const wanted = typeof shape.id === "string" ? shape.id : undefined;
    // An id the agent chose is kept when it is well formed and free.
    let id =
      wanted && ID.test(wanted) && !taken.has(wanted)
        ? wanted
        : newId(PREFIX[kind] ?? "sh");
    while (taken.has(id)) id = newId(PREFIX[kind] ?? "sh");
    taken.add(id);
    if (wanted) renamed.set(wanted, id);
    return { ...shape, id };
  });
  for (const shape of out) {
    for (const side of ["start", "end"] as const) {
      const end = shape[side] as { shape?: string } | undefined;
      if (end?.shape && renamed.has(end.shape)) {
        shape[side] = { ...end, shape: renamed.get(end.shape) };
      }
    }
  }
  return out;
}

const allIds = (document: DeckDocument) =>
  new Set(
    document.slides.flatMap((slide) => [
      slide.id,
      ...slide.shapes.map((shape) => shape.id),
    ])
  );

export type Planned = {
  ops: Operation[];
  created: string[];
  changed: string[];
};

/** Adds shapes on top of a slide. */
export function addShapes(
  document: DeckDocument,
  slide: number | string,
  shapes: Record<string, unknown>[]
): Planned {
  const { index } = findSlide(document, slide);
  const placed = withIds(shapes, allIds(document));
  return {
    ops: guard(
      document,
      placed.map((shape) => ({
        op: "add",
        path: `/slides/${index}/shapes/-`,
        value: shape,
      }))
    ),
    created: placed.map((shape) => shape.id as string),
    changed: [],
  };
}

/** Fields an update may not set: a shape's id and kind are for life. */
const FIXED = new Set(["id", "kind"]);

/**
 * Sets fields of shapes, by id: each given field replaces the shape's
 * (null removes an optional one), the rest stay.
 */
export function updateShapes(
  document: DeckDocument,
  slide: number | string,
  updates: { id: string; set: Record<string, unknown> }[]
): Planned {
  const { slide: found, index } = findSlide(document, slide);
  const ops: Operation[] = [];
  for (const { id, set } of updates) {
    const at = found.shapes.findIndex((shape) => shape.id === id);
    if (at < 0) throw new WriteError(`no shape ${id} on slide ${index + 1}`);
    const shape = found.shapes[at] as Record<string, unknown>;
    for (const [key, value] of Object.entries(set)) {
      if (FIXED.has(key)) throw new WriteError(`${key} cannot change`);
      if (!/^[a-zA-Z]+$/.test(key))
        throw new WriteError(`unknown field ${key}`);
      const path = `/slides/${index}/shapes/${at}/${key}`;
      if (value === null && key in shape && !["fill", "stroke"].includes(key)) {
        ops.push({ op: "remove", path });
      } else {
        // `add` sets a member whether or not it is there yet (RFC 6902).
        ops.push({ op: "add", path, value });
      }
    }
  }
  return {
    ops: guard(document, ops),
    created: [],
    changed: updates.map((update) => update.id),
  };
}

/** Deletes shapes by id; connectors glued to them keep their ends, unglued. */
export function deleteShapes(
  document: DeckDocument,
  slide: number | string,
  ids: string[]
): Planned {
  const { slide: found, index } = findSlide(document, slide);
  const present = new Set(found.shapes.map((shape) => shape.id));
  for (const id of ids) {
    if (!present.has(id))
      throw new WriteError(`no shape ${id} on slide ${index + 1}`);
  }
  const ops = deleteOps(found, index, new Set(ids));
  const unglued = found.shapes
    .filter(
      (shape) =>
        shape.kind === "line" &&
        !ids.includes(shape.id) &&
        [shape.start, shape.end].some(
          (end) => "shape" in end && ids.includes(end.shape)
        )
    )
    .map((shape) => shape.id);
  return { ops: guard(document, ops), created: [], changed: unglued };
}

/** Adds a slide after slide `after` (0 puts it first; by default, last). */
export function addSlide(
  document: DeckDocument,
  input: { after?: number; title?: string; shapes?: Record<string, unknown>[] }
): Planned {
  const position = input.after ?? document.slides.length;
  if (position < 0 || position > document.slides.length) {
    throw new WriteError(`after must be from 0 to ${document.slides.length}`);
  }
  const taken = allIds(document);
  let id = newId("sl");
  while (taken.has(id)) id = newId("sl");
  taken.add(id);
  const shapes = withIds(input.shapes ?? [], taken);
  const slide = { id, title: input.title ?? "", shapes } as unknown as Slide;
  return {
    ops: guard(document, [
      { op: "add", path: `/slides/${position}`, value: slide },
    ]),
    created: [id, ...shapes.map((shape) => shape.id as string)],
    changed: [],
  };
}

export function deleteSlide(
  document: DeckDocument,
  slide: number | string
): Planned {
  const { slide: found, index } = findSlide(document, slide);
  if (document.slides.length === 1) {
    throw new WriteError("a deck keeps at least one slide");
  }
  return {
    ops: guard(document, [{ op: "remove", path: `/slides/${index}` }]),
    created: [],
    changed: [found.id],
  };
}

/** Moves a slide so it becomes slide number `to`. */
export function moveSlide(
  document: DeckDocument,
  slide: number | string,
  to: number
): Planned {
  const { slide: found, index } = findSlide(document, slide);
  if (to < 1 || to > document.slides.length) {
    throw new WriteError(`to must be from 1 to ${document.slides.length}`);
  }
  if (to - 1 === index) throw new WriteError("the slide is already there");
  return {
    ops: guard(document, [
      { op: "move", from: `/slides/${index}`, path: `/slides/${to - 1}` },
    ]),
    created: [],
    changed: [found.id],
  };
}

/** Copies a slide, with new ids for it and its shapes, right after it. */
export function copySlide(
  document: DeckDocument,
  slide: number | string
): Planned {
  const { slide: found, index } = findSlide(document, slide);
  if (document.slides.length >= 500) {
    throw new WriteError("a deck holds at most 500 slides");
  }
  const copy = duplicateSlide(found);
  return {
    ops: guard(document, insertSlideOps(index + 1, copy)),
    created: [copy.id, ...copy.shapes.map((shape) => shape.id)],
    changed: [],
  };
}

/** Renames the deck. */
export function retitle(document: DeckDocument, title: string): Planned {
  const value = title.trim();
  if (!value) throw new WriteError("a deck needs a title");
  if (value === document.title) throw new WriteError("the deck has that title");
  return {
    ops: [{ op: "replace", path: "/title", value }],
    created: [],
    changed: [],
  };
}

/** Puts the deck on another template. */
export function retemplate(
  document: DeckDocument,
  template: TemplateId
): Planned {
  if ((document.template ?? "plain") === template) {
    throw new WriteError(`the deck is already on the ${template} template`);
  }
  return {
    ops: [{ op: "add", path: "/template", value: template }],
    created: [],
    changed: [],
  };
}
