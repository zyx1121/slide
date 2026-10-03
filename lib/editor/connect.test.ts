import { describe, expect, it } from "vitest";

import { applyOperations } from "../deck/patch";
import { sampleDocument } from "../deck/sample";
import { sitePoint } from "../render/connector";
import { lineEndOps, newLine, snapEnd, withLineEnd } from "./connect";
import { guard } from "./guard";
import { insertOps } from "./ops";

const doc = sampleDocument();
const slide = doc.slides[0];
const capture = slide.shapes.find((shape) => shape.id === "sh_capture")!;
if (capture.kind === "line") throw new Error("sh_capture is a box");

describe("snapEnd", () => {
  it("glues to a site within reach", () => {
    const right = sitePoint(capture, 3).point;
    const snap = snapEnd(slide, { x: right.x + 8, y: right.y - 5 }, 14);
    expect(snap.end).toEqual({ shape: "sh_capture", site: 3 });
    expect(snap.point).toEqual(right);
    expect(snap.sites).toHaveLength(4);
  });

  it("glues to the nearest site of the shape under the pointer", () => {
    const p = { x: capture.x + 20, y: capture.y + capture.h / 2 + 10 };
    expect(snapEnd(slide, p, 14).end).toEqual({
      shape: "sh_capture",
      site: 1,
    });
  });

  it("stays free on empty canvas", () => {
    const snap = snapEnd(slide, { x: 1500.123, y: 1000.456 }, 14);
    expect(snap.end).toEqual({ x: 1500.12, y: 1000.46 });
    expect(snap.shape).toBeNull();
  });

  it("does not glue to the site the other end holds", () => {
    const left = sitePoint(capture, 1).point;
    const snap = snapEnd(slide, left, 14, { shape: "sh_capture", site: 1 });
    expect(snap.end).not.toEqual({ shape: "sh_capture", site: 1 });
  });
});

describe("connectors in the document", () => {
  it("adds a drawn connector the schema accepts", () => {
    const line = newLine({ shape: "sh_capture", site: 3 }, { x: 1700, y: 900 });
    const next = applyOperations(doc, guard(doc, insertOps(0, line)));
    expect(next.document.slides[0].shapes.at(-1)).toMatchObject({
      kind: "line",
      start: { shape: "sh_capture", site: 3 },
      endArrow: "triangle",
    });
  });

  it("moves one end and writes nothing when it lands where it was", () => {
    const line = slide.shapes.find((shape) => shape.kind === "line")!;
    if (line.kind !== "line") throw new Error("a line");
    const free = { x: 100, y: 100 };
    const ops = lineEndOps(slide, 0, line.id, "end", free);
    const next = applyOperations(doc, guard(doc, ops)).document.slides[0];
    expect(next.shapes.find((shape) => shape.id === line.id)).toMatchObject({
      end: free,
    });
    expect(lineEndOps(slide, 0, line.id, "end", line.end)).toEqual([]);
    expect(
      withLineEnd(slide, line.id, "end", free).shapes.find(
        (shape) => shape.id === line.id
      )
    ).toMatchObject({ end: free });
  });
});
