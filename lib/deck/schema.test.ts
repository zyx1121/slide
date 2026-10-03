import { describe, expect, it } from "vitest";

import { sampleDocument } from "./sample";
import { DeckDocument, describeIssues } from "./schema";

function issuesOf(document: unknown): string[] {
  const result = DeckDocument.safeParse(document);
  return result.success ? [] : describeIssues(result.error);
}

describe("DeckDocument", () => {
  it("accepts the sample deck as it is", () => {
    expect(issuesOf(sampleDocument())).toEqual([]);
  });

  it("rejects a malformed color, with its path", () => {
    const doc = sampleDocument();
    const shape = doc.slides[0].shapes[0];
    if (shape.kind !== "roundRect") throw new Error("fixture changed");
    shape.fill = "blue";
    expect(issuesOf(doc)).toEqual([
      "slides.0.shapes.0.fill: colors look like #3297fc, or #3297fc80 with alpha",
    ]);
  });

  it("rejects fields the schema does not know", () => {
    const doc = sampleDocument() as unknown as {
      slides: { shapes: Record<string, unknown>[] }[];
    };
    doc.slides[0].shapes[0].shadow = true;
    expect(issuesOf(doc)[0]).toMatch(/^slides\.0\.shapes\.0: .*shadow/);
  });

  it("rejects an unknown shape kind", () => {
    const doc = sampleDocument() as unknown as {
      slides: { shapes: { kind: string }[] }[];
    };
    doc.slides[0].shapes[0].kind = "hexagon";
    expect(issuesOf(doc)).toHaveLength(1);
  });

  it("rejects an id used twice, even across slides", () => {
    const doc = sampleDocument();
    doc.slides.push({ id: "sl_second", title: "", shapes: [] });
    doc.slides[1].shapes.push({ ...doc.slides[0].shapes[2] });
    expect(issuesOf(doc)).toEqual([
      "slides.1.shapes.0.id: id sh_router is already used at slides.0.shapes.2.id",
    ]);
  });

  it("rejects a connector glued to a shape that is not on the slide", () => {
    const doc = sampleDocument();
    const line = doc.slides[0].shapes[3];
    if (line.kind !== "line") throw new Error("fixture changed");
    line.end = { shape: "sh_missing", site: 1 };
    expect(issuesOf(doc)).toEqual([
      "slides.0.shapes.3.end.shape: sh_missing is not a shape on this slide",
    ]);
  });

  it("rejects a connector glued to another line", () => {
    const doc = sampleDocument();
    const line = doc.slides[0].shapes[4];
    if (line.kind !== "line") throw new Error("fixture changed");
    line.end = { shape: "ln_capture_asr", site: 0 };
    expect(issuesOf(doc)).toEqual([
      "slides.0.shapes.4.end.shape: ln_capture_asr is a line; lines attach to shapes only",
    ]);
  });

  it("rejects a site outside 0 to 3 and a deck without slides", () => {
    const doc = sampleDocument();
    const line = doc.slides[0].shapes[3];
    if (line.kind !== "line") throw new Error("fixture changed");
    line.start = { shape: "sh_capture", site: 4 };
    expect(issuesOf(doc)).toHaveLength(1);
    expect(issuesOf({ ...sampleDocument(), slides: [] })).toHaveLength(1);
  });

  it("accepts free connector ends and a blank title-only slide", () => {
    const doc = sampleDocument();
    doc.slides[0].shapes.push({
      id: "ln_free",
      kind: "line",
      route: "straight",
      start: { x: 0, y: 0 },
      end: { x: 100, y: 50 },
      stroke: { color: "#000000", width: 2 },
    });
    doc.slides.push({ id: "sl_blank", title: "", shapes: [] });
    expect(issuesOf(doc)).toEqual([]);
  });
});
