import { describe, expect, it } from "vitest";

import { applyOperations } from "../deck/patch";
import { sampleDocument } from "../deck/sample";
import type { Shape, Slide } from "../deck/schema";
import { guard } from "./guard";
import { newShape } from "./preview";
import { caretAt, selectAll } from "./text-edit";
import {
  draftOps,
  draftSlide,
  fittedHeight,
  shownBody,
  startDraft,
  type TextDraft,
  TITLE_ID,
} from "./text-session";

const doc = sampleDocument();
const slide = doc.slides[0];

function withShape(shape: Shape): Slide {
  return { ...slide, shapes: [...slide.shapes, shape] };
}

function edit(on: Slide, target: string, text: string): TextDraft {
  const draft = startDraft(on, 0, target, selectAll)!;
  return {
    ...draft,
    body: { paragraphs: [{ runs: [{ text }] }] },
    dirty: true,
  };
}

describe("text drafts", () => {
  it("holds no draft for pictures and connectors", () => {
    const picture = slide.shapes.find((shape) => shape.kind === "image")!;
    expect(startDraft(slide, 0, picture.id, selectAll)).toBeNull();
  });

  it("writes the title as one string", () => {
    const draft = edit(slide, TITLE_ID, "New\ntitle");
    const ops = draftOps(slide, 0, draft, false);
    expect(ops).toEqual([
      { op: "replace", path: "/slides/0/title", value: "New\ntitle" },
    ]);
    const next = applyOperations(doc, guard(doc, ops)).document;
    expect(next.slides[0].title).toBe("New\ntitle");
  });

  it("writes nothing when the text did not change", () => {
    const draft = startDraft(slide, 0, TITLE_ID, selectAll)!;
    expect(draftOps(slide, 0, { ...draft, dirty: true }, true)).toEqual([]);
  });

  it("gives a shape without text a text body, and takes an emptied one away", () => {
    const box = newShape("rect", slide);
    const on = withShape(box);
    const typed = draftOps(on, 0, edit(on, box.id, "ASR"), false);
    expect(typed).toEqual([
      {
        op: "add",
        path: `/slides/0/shapes/${on.shapes.length - 1}/text`,
        value: { paragraphs: [{ runs: [{ text: "ASR" }] }] },
      },
    ]);
    const filled: Slide = {
      ...on,
      shapes: on.shapes.map((shape) =>
        shape.id === box.id
          ? { ...shape, text: { paragraphs: [{ runs: [{ text: "x" }] }] } }
          : shape
      ),
    };
    expect(draftOps(filled, 0, edit(filled, box.id, ""), true)).toEqual([
      { op: "remove", path: `/slides/0/shapes/${on.shapes.length - 1}/text` },
    ]);
  });

  it("deletes a text box left empty when editing ends, not while typing", () => {
    const box = newShape("text", slide);
    const on = withShape(box);
    const draft = startDraft(on, 0, box.id, selectAll)!;
    expect(draftOps(on, 0, draft, false)).toEqual([]);
    expect(draftOps(on, 0, draft, true)).toEqual([
      { op: "remove", path: `/slides/0/shapes/${on.shapes.length - 1}` },
    ]);
  });

  it("grows a plain text box with its text and keeps a framed one's height", () => {
    const box = newShape("text", slide) as Extract<Shape, { kind: "text" }>;
    const on = withShape(box);
    const draft = edit(on, box.id, "one\ntwo\nthree");
    const h = fittedHeight(box, draft.body)!;
    expect(h).toBeGreaterThan(box.h * 2);
    expect(draftOps(on, 0, draft, false)).toContainEqual({
      op: "replace",
      path: `/slides/0/shapes/${on.shapes.length - 1}/h`,
      value: h,
    });
    const shown = draftSlide(on, draft).shapes.at(-1)!;
    expect(shown.kind === "text" ? shown.h : null).toBe(h);
    const framed = { ...box, fill: "#ffffff" } as Shape;
    expect(fittedHeight(framed, draft.body)).toBeNull();
  });

  it("shows an IME composition in place of the selection, underlined", () => {
    const draft = edit(slide, TITLE_ID, "ab");
    const shown = shownBody({
      ...draft,
      selection: caretAt({ p: 0, o: 1 }),
      composition: "語",
    });
    expect(shown.body.paragraphs[0].runs).toEqual([
      { text: "a" },
      { text: "語", underline: true },
      { text: "b" },
    ]);
    expect(shown.selection.focus).toEqual({ p: 0, o: 2 });
  });
});
