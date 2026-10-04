import { describe, expect, it } from "vitest";

import { applyOperations } from "../deck/patch";
import { sampleDocument } from "../deck/sample";
import type { Shape } from "../deck/schema";
import { guard } from "./guard";
import { DEFAULT_STROKE, selectionStyle, styleOps } from "./style";

const doc = sampleDocument();
const slide = doc.slides[0];
const apply = (ops: unknown) => applyOperations(doc, ops).document.slides[0];
const find = (shapes: Shape[], id: string) =>
  shapes.find((shape) => shape.id === id)!;
const ids = (...list: string[]) => new Set(list);

describe("styleOps", () => {
  it("fills the shapes that take a fill and leaves the rest", () => {
    const ops = styleOps(
      slide,
      0,
      ids("sh_capture", "ln_capture_asr", "im_demo"),
      {
        kind: "fill",
        color: "#ffc000",
      }
    );
    expect(ops).toEqual([
      { op: "add", path: "/slides/0/shapes/0/fill", value: "#ffc000" },
    ]);
    expect(find(apply(ops).shapes, "sh_capture")).toMatchObject({
      fill: "#ffc000",
    });
  });

  it("gives an outline to a shape without one, and takes it away", () => {
    // tx_note has no outline; setting a dash gives it the default blue.
    const dashed = styleOps(slide, 0, ids("tx_note"), {
      kind: "stroke",
      dash: "dash",
    });
    expect(find(apply(dashed).shapes, "tx_note")).toMatchObject({
      stroke: { ...DEFAULT_STROKE, dash: "dash" },
    });
    const none = styleOps(slide, 0, ids("sh_asr", "ln_capture_asr"), {
      kind: "noStroke",
    });
    const after = apply(none).shapes;
    expect(find(after, "sh_asr")).toMatchObject({ stroke: null });
    // A connector keeps its stroke.
    expect(find(after, "ln_capture_asr")).toMatchObject({
      stroke: { width: 4 },
    });
  });

  it("styles every run of the selected text, and only what changes", () => {
    const bold = styleOps(slide, 0, ids("sh_capture", "tx_note"), {
      kind: "text",
      bold: true,
      size: 40,
    });
    const after = apply(bold).shapes;
    const capture = find(after, "sh_capture");
    const note = find(after, "tx_note");
    if (capture.kind !== "roundRect" || note.kind !== "text")
      throw new Error("fixture changed");
    expect(capture.text?.paragraphs[0].runs[0]).toMatchObject({
      bold: true,
      size: 40,
    });
    expect(
      note.text.paragraphs[0].runs.map((run) => [run.bold, run.size])
    ).toEqual([
      [true, 40],
      [true, 40],
    ]);
    // "ASR: " was bold already, so it only gets a size.
    expect(
      bold.filter(
        (op) => op.path.includes("/shapes/5/") && op.path.endsWith("/bold")
      )
    ).toHaveLength(1);
  });

  it("aligns paragraphs and anchors text against their defaults", () => {
    // Text in a shape is centered and in the middle already.
    expect(
      styleOps(slide, 0, ids("sh_asr"), { kind: "align", align: "center" })
    ).toEqual([]);
    expect(
      styleOps(slide, 0, ids("sh_asr"), { kind: "anchor", anchor: "middle" })
    ).toEqual([]);
    const top = styleOps(slide, 0, ids("sh_asr", "tx_note"), {
      kind: "anchor",
      anchor: "top",
    });
    expect(top.map((op) => op.path)).toEqual([
      "/slides/0/shapes/1/text/anchor",
    ]);
  });

  it("changes a connector's route and arrowheads", () => {
    const ops = [
      ...styleOps(slide, 0, ids("ln_capture_asr"), {
        kind: "route",
        route: "curved",
      }),
      ...styleOps(slide, 0, ids("ln_capture_asr"), {
        kind: "arrow",
        end: "start",
        head: "oval",
      }),
    ];
    expect(find(apply(ops).shapes, "ln_capture_asr")).toMatchObject({
      route: "curved",
      startArrow: "oval",
      endArrow: "triangle",
    });
    expect(
      applyOperations(doc, guard(doc, ops)).document.slides[0].shapes[3]
    ).toMatchObject({ route: "curved" });
  });
});

describe("selectionStyle", () => {
  it("shows what the selection shares and what is mixed", () => {
    const style = selectionStyle(slide, ids("sh_capture", "sh_asr"));
    expect(style.fill).toBe("#e8f1fe");
    expect(style.stroke).toMatchObject({
      color: "#4f81bd",
      width: 3,
      dash: "solid",
      optional: true,
    });
    expect(style.text).toMatchObject({
      size: 48,
      bold: "mixed",
      align: "center",
      anchor: "middle",
    });
    expect(style.line).toBeUndefined();
  });

  it("offers connector tools only when every pick is a connector", () => {
    expect(
      selectionStyle(slide, ids("ln_capture_asr", "ln_capture_router")).line
    ).toEqual({
      route: "mixed",
      start: "none",
      end: "triangle",
    });
    const mixed = selectionStyle(slide, ids("ln_capture_asr", "sh_asr"));
    expect(mixed.line).toBeUndefined();
    expect(mixed.fill).toBeUndefined();
    expect(mixed.stroke?.optional).toBe(false);
  });

  it("is empty for an empty selection", () => {
    expect(selectionStyle(slide, ids())).toEqual({});
  });
});

describe("bullets and levels", () => {
  it("sets a bullet on every paragraph of the selected text", () => {
    const ops = styleOps(slide, 0, ids("tx_note"), {
      kind: "bullet",
      bullet: "number",
    });
    const note = find(apply(ops).shapes, "tx_note");
    expect(
      note.kind === "text" && note.text.paragraphs.map((p) => p.bullet)
    ).toEqual(
      (
        find(slide.shapes, "tx_note") as Extract<Shape, { kind: "text" }>
      ).text.paragraphs.map(() => "number")
    );
    expect(selectionStyle(apply(ops), ids("tx_note")).text?.bullet).toBe(
      "number"
    );
  });

  it("moves levels one step and stops at the outermost", () => {
    const up = styleOps(slide, 0, ids("tx_note"), { kind: "level", delta: 1 });
    const note = find(apply(up).shapes, "tx_note");
    expect(note.kind === "text" && note.text.paragraphs[0].level).toBe(1);
    expect(
      styleOps(slide, 0, ids("tx_note"), { kind: "level", delta: -1 })
    ).toEqual([]);
  });
});
