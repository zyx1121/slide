import { describe, expect, it } from "vitest";

import { sampleDocument } from "./sample";
import { DeckDocument, describeIssues, storedDocumentProblem } from "./schema";

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

  it("rejects U+0000 in any text, which Postgres cannot store", () => {
    const doc = sampleDocument();
    doc.title = "Agent\u0000Sense";
    doc.slides[0].title = "\u0000";
    expect(issuesOf(doc)).toEqual([
      "title: text cannot contain U+0000",
      "slides.0.title: text cannot contain U+0000",
    ]);
  });

  it("rejects fields the schema does not know", () => {
    const doc = sampleDocument() as unknown as {
      slides: { shapes: Record<string, unknown>[] }[];
    };
    doc.slides[0].shapes[0].shadow = true;
    expect(issuesOf(doc)[0]).toMatch(/^slides\.0\.shapes\.0: .*shadow/);
  });

  it("takes a known template, or none", () => {
    const { template: _winlab, ...none } = sampleDocument();
    expect(issuesOf(none)).toEqual([]);
    expect(issuesOf({ ...none, template: "plain" })).toEqual([]);
    expect(issuesOf({ ...none, template: "keynote" })).toHaveLength(1);
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

  it("caps the text one shape and one slide may hold", () => {
    const doc = sampleDocument();
    const box = (id: string, length: number) => ({
      id,
      kind: "text" as const,
      x: 0,
      y: 0,
      w: 100,
      h: 100,
      text: { paragraphs: [{ runs: [{ text: "x".repeat(length) }] }] },
    });
    const one = DeckDocument.safeParse({
      ...doc,
      slides: [{ id: "sl_one", title: "", shapes: [box("tx_big", 5_001)] }],
    });
    expect(one.success).toBe(false);
    expect(describeIssues(one.error!)).toEqual([
      "slides.0.shapes.0.text: a shape holds at most 5000 characters of text",
    ]);
    const many = DeckDocument.safeParse({
      ...doc,
      slides: [
        {
          id: "sl_one",
          title: "x",
          shapes: [0, 1, 2, 3].map((i) => box(`tx_full${i}`, 5_000)),
        },
      ],
    });
    expect(describeIssues(many.error!)).toEqual([
      "slides.0: a slide holds at most 20000 characters of text",
    ]);
  });

  it("says why a stored deck that breaks the schema cannot be edited", () => {
    const doc = sampleDocument();
    expect(storedDocumentProblem(doc)).toBeNull();
    // Ids one character short, as two test decks once had.
    doc.slides[0].shapes[0].id = "sh_p";
    expect(storedDocumentProblem(doc)).toBe(
      "這份簡報有一筆資料不符合格式（slides.0.shapes.0.id: ids look like sh_k4m9x2qa），所以現在不能編輯。請把這段訊息回報給維護者。"
    );
  });
});
