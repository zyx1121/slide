import { describe, expect, it } from "vitest";

import { applyOperations } from "../deck/patch";
import { sampleDocument } from "../deck/sample";
import { DeckDocument, type Shape } from "../deck/schema";
import { BUILTIN_MASTERS, layoutOf } from "../master/layout";
import { renderSlideSvg, textDefaultsOf } from "../render/svg";
import { layoutText } from "../render/text";
import { checkSlide } from "../rules/check";
import { copyShapes, pasteShapes } from "./clipboard";
import { guard } from "./guard";
import { bakePlaceholder, placeholderShapes } from "./placeholders";
import { blankSlide, duplicateSlide, relayoutOps } from "./slides";
import { draftOps } from "./text-session";
import { selectAll } from "./text-edit";

type TextBox = Extract<Shape, { kind: "text" }>;

const winlab = BUILTIN_MASTERS.winlab;
const bullets = layoutOf({ master: winlab }, undefined);

/** A WinLab deck whose one slide is new, its placeholder typed in. */
function deckWith(text?: string) {
  const document = sampleDocument();
  const slide = blankSlide(bullets);
  if (text !== undefined) {
    (slide.shapes[0] as TextBox).text = {
      paragraphs: [{ runs: [{ text }] }],
    };
  }
  document.slides = [slide];
  return DeckDocument.parse(document);
}

describe("a new slide's placeholders", () => {
  it("are the layout's text placeholders, empty, where it puts them", () => {
    const [shape] = blankSlide(bullets).shapes as TextBox[];
    const [body] = bullets.bodies!;
    expect(shape).toMatchObject({
      kind: "text",
      placeholder: body.key,
      x: body.x,
      y: body.y,
      w: body.w,
      h: body.h,
      text: { paragraphs: [{ runs: [] }] },
    });
    expect(placeholderShapes({ bodies: undefined })).toEqual([]);
  });

  it("must name a placeholder of the slide's layout, once", () => {
    const document = deckWith();
    expect(DeckDocument.safeParse(document).success).toBe(true);
    const wrong = structuredClone(document);
    (wrong.slides[0].shapes[0] as TextBox).placeholder = "99";
    expect(DeckDocument.safeParse(wrong).success).toBe(false);
    const twice = structuredClone(document);
    twice.slides[0].shapes.push({ ...twice.slides[0].shapes[0], id: "tx_two" });
    expect(DeckDocument.safeParse(twice).success).toBe(false);
  });
});

describe("placeholder text", () => {
  it("takes the layout's level styles where it sets none", () => {
    const document = deckWith("Capture");
    const shape = document.slides[0].shapes[0] as TextBox;
    const defaults = textDefaultsOf(shape, bullets);
    const [line] = layoutText(shape.text, shape, defaults).lines;
    // WinLab's body: 24 pt, blue, a "●" bullet.
    expect(line.segments[0]).toMatchObject({ size: 48, color: "#3297fc" });
    expect(line.bullet).toMatchObject({ text: "●", color: "#3297fc" });
    // Its own size wins.
    shape.text.paragraphs[0].runs[0].size = 60;
    const [own] = layoutText(shape.text, shape, defaults).lines;
    expect(own.segments[0].size).toBe(60);
  });

  it("is checked at the size it is drawn", () => {
    const document = deckWith("Capture");
    const shape = document.slides[0].shapes[0] as TextBox;
    shape.text.paragraphs[0].runs[0].size = undefined;
    expect(checkSlide(document.slides[0], 0, bullets, null)).toEqual([]);
  });
});

describe("prompts", () => {
  const empty = deckWith();
  const svg = (prompts?: { except?: string | null }) =>
    renderSlideSvg(empty.slides[0], {
      slideNumber: 1,
      layout: bullets,
      ...(prompts ? { prompts } : {}),
    });

  it("show in the editor only, in an empty title and placeholder", () => {
    expect(svg()).not.toContain("按一下");
    const editing = svg({});
    expect(editing).toContain(">按一下以新增標題</text>");
    expect(editing).toContain(">按一下以新增文字</text>");
    expect(editing.match(/stroke-dasharray/g)).toHaveLength(2);
  });

  it("leave out the one being typed in", () => {
    const id = empty.slides[0].shapes[0].id;
    expect(svg({ except: id })).not.toContain("按一下以新增文字");
    expect(svg({ except: "title" })).not.toContain("按一下以新增標題");
  });

  it("go once there is text", () => {
    const filled = renderSlideSvg(deckWith("Capture").slides[0], {
      slideNumber: 1,
      layout: bullets,
      prompts: {},
    });
    expect(filled).not.toContain("按一下以新增文字");
    expect(filled).toContain(">Capture</text>");
  });
});

describe("typing in a placeholder", () => {
  it("keeps it, empty, when its text is all deleted", () => {
    const document = deckWith("Capture");
    const slide = document.slides[0];
    const shape = slide.shapes[0];
    const draft = {
      slide: 0,
      slideId: slide.id,
      target: shape.id,
      body: { paragraphs: [{ runs: [] }] },
      selection: selectAll({ paragraphs: [{ runs: [] }] }),
      composition: null,
      typing: null,
      goal: null,
      dirty: true,
    };
    const ops = draftOps(slide, 0, draft, true);
    const after = applyOperations(document, guard(document, ops)).document;
    expect(after.slides[0].shapes[0]).toMatchObject({
      id: shape.id,
      placeholder: "1",
      text: { paragraphs: [{ runs: [] }] },
    });
  });
});

describe("changing a slide's layout", () => {
  const apply = (document: DeckDocument, to: number) =>
    applyOperations(document, guard(document, relayoutOps(document, 0, to)))
      .document;

  it("moves a placeholder in its place to the new layout's", () => {
    const after = apply(deckWith("Capture"), 0);
    const [shape] = after.slides[0].shapes as TextBox[];
    const cover = winlab.layouts[0].bodies!.find((b) => b.key === "1")!;
    expect(after.slides[0].layout).toBe(0);
    expect(shape).toMatchObject({ placeholder: "1", x: cover.x, y: cover.y });
  });

  it("leaves a moved one where it is", () => {
    const document = deckWith("Capture");
    const box = document.slides[0].shapes[0] as TextBox;
    box.x += 40;
    const moved = apply(document, 0).slides[0].shapes[0] as TextBox;
    expect(moved.x).toBe(box.x);
  });

  it("makes one the new layout lacks a plain box that looks the same", () => {
    // Section has no text placeholder.
    const after = apply(deckWith("Capture"), 2);
    const [shape] = after.slides[0].shapes as TextBox[];
    expect(shape.placeholder).toBeUndefined();
    expect(shape.text.paragraphs[0]).toMatchObject({
      bullet: "bullet",
      bulletChar: "●",
      runs: [{ text: "Capture", size: 48, color: "#3297fc" }],
    });
  });

  it("drops an empty one the new layout lacks, as PowerPoint does", () => {
    expect(apply(deckWith(), 2).slides[0].shapes).toEqual([]);
  });

  it("brings the new layout's other placeholders, behind the slide's shapes", () => {
    const document = deckWith("Capture");
    const after = apply(document, 4);
    const keys = after.slides[0].shapes.map((s) =>
      s.kind === "text" ? s.placeholder : undefined
    );
    expect(keys).toEqual(["21", "1"]);
    expect(after.slides[0].shapes[1].id).toBe(document.slides[0].shapes[0].id);
  });
});

describe("copying placeholders", () => {
  it("copies one as a plain box that looks the same", () => {
    const slide = deckWith("Capture").slides[0];
    const clip = copyShapes(slide, new Set([slide.shapes[0].id]), bullets)!;
    const [shape] = clip.shapes as TextBox[];
    expect(shape.placeholder).toBeUndefined();
    expect(shape.text.paragraphs[0].runs[0]).toMatchObject({ size: 48 });
  });

  it("pastes plain boxes, but a slide copied whole keeps them", () => {
    const slide = deckWith("Capture").slides[0];
    const clip = { format: "slide/shapes", version: 1, shapes: slide.shapes };
    const [pasted] = pasteShapes(clip as never, 0) as TextBox[];
    expect(pasted.placeholder).toBeUndefined();
    const [copied] = duplicateSlide(slide).shapes as TextBox[];
    expect(copied.placeholder).toBe("1");
  });

  it("bakes nothing for a box that is no placeholder", () => {
    const shape = deckWith("Capture").slides[0].shapes[0] as TextBox;
    const plain = { ...shape };
    delete plain.placeholder;
    expect(bakePlaceholder(plain as TextBox, bullets)).toEqual(plain);
  });
});

describe("reverting a layout change", () => {
  /** The patch's adds and replaces still hold, as a revert checks first. */
  const stillThere = (
    document: DeckDocument,
    ops: ReturnType<typeof relayoutOps>
  ) =>
    ops.every((op) => {
      if (op.op !== "add" && op.op !== "replace") return true;
      const value = op.path
        .split("/")
        .slice(1)
        .reduce<unknown>(
          (at, key) => (at as Record<string, unknown>)?.[key],
          document
        );
      return JSON.stringify(value) === JSON.stringify(op.value);
    });

  it("finds every value where the change left it", () => {
    for (const [setup, to] of [
      [deckWith("Capture"), 4],
      [deckWith(), 2],
      [deckWith("Capture"), 2],
      [deckWith(), 0],
    ] as const) {
      // A shape that is no placeholder sits on the slide too.
      setup.slides[0].shapes.push({
        id: "tx_free",
        kind: "text",
        x: 10,
        y: 10,
        w: 100,
        h: 40,
        text: { paragraphs: [{ runs: [{ text: "free" }] }] },
      });
      const ops = relayoutOps(setup, 0, to);
      const after = applyOperations(setup, ops).document;
      expect(stillThere(after, ops)).toBe(true);
    }
    // A slide made before placeholders, onto Two Columns.
    const old = sampleDocument();
    const ops = relayoutOps(old, 0, 4);
    expect(stillThere(applyOperations(old, ops).document, ops)).toBe(true);
  });
});

describe("putting a slide on its own layout again", () => {
  it("brings back the placeholders it lacks, and nothing else", () => {
    // A slide made before placeholders, on Title & Bullets.
    const old = sampleDocument();
    const ops = relayoutOps(old, 0, old.master.layout);
    expect(
      ops.every((op) => op.op === "add" && op.path.includes("/shapes/"))
    ).toBe(true);
    const after = applyOperations(old, ops).document;
    expect(after.slides[0].layout).toBeUndefined();
    expect(after.slides[0].shapes[0]).toMatchObject({ placeholder: "1" });
    // Once it has them, there is nothing to do.
    expect(relayoutOps(after, 0, old.master.layout)).toEqual([]);
  });
});
