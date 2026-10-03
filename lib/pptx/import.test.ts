import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { sampleDocument } from "../deck/sample";
import type { DeckDocument, Shape } from "../deck/schema";
import { exportPptx } from "./export";
import { importPptx } from "./import";
import { MAX_PART_BYTES, PptxError } from "./read";
import { describeSkipped } from "./report";

const PNG_1X1 = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
  ),
  (ch) => ch.charCodeAt(0)
);
const SHA = "a".repeat(64);
const saveImage = async () => ({ sha256: SHA });

/** A deck with every kind the importer takes, on two slides. */
function richDeck(): DeckDocument {
  const doc = sampleDocument();
  return {
    ...doc,
    title: "Round trip 往返",
    slides: [
      doc.slides[0],
      {
        id: "sl_second",
        title: "Second\nslide",
        shapes: [
          {
            id: "sh_oval",
            kind: "ellipse",
            x: 300,
            y: 400,
            w: 320,
            h: 200,
            fill: "#fff2cc",
            stroke: { color: "#ed7d31", width: 4, dash: "dash" },
            text: {
              anchor: "middle",
              paragraphs: [
                {
                  align: "center",
                  runs: [{ text: "橢圓", size: 48, bold: true }],
                },
              ],
            },
          },
          {
            id: "tx_list",
            kind: "text",
            x: 900,
            y: 300,
            w: 700,
            h: 200,
            text: {
              paragraphs: [
                { bullet: "bullet", runs: [{ text: "One", color: "#c00000" }] },
                {
                  bullet: "number",
                  level: 1,
                  runs: [{ text: "Two", italic: true }],
                },
              ],
            },
          },
          {
            id: "im_pic",
            kind: "image",
            x: 100,
            y: 700,
            w: 300,
            h: 200,
            asset: SHA,
          },
          {
            id: "ln_join",
            kind: "line",
            route: "elbow",
            start: { shape: "sh_oval", site: 3 },
            end: { shape: "tx_list", site: 1 },
            stroke: { color: "#000000", width: 3 },
            endArrow: "triangle",
          },
        ],
      },
    ],
  };
}

const boxOf = (shape: Shape) =>
  shape.kind === "line" ? null : [shape.x, shape.y, shape.w, shape.h];

describe("importPptx", () => {
  it("keeps every shape, its position and its text through an export and back", async () => {
    const before = richDeck();
    // Every picture's bytes, so none is exported as an empty frame.
    const shas = before.slides.flatMap((slide) =>
      slide.shapes.flatMap((shape) =>
        shape.kind === "image" ? [shape.asset] : []
      )
    );
    const bytes = exportPptx(
      before,
      new Map(shas.map((sha) => [sha, { mime: "image/png", data: PNG_1X1 }]))
    );
    const { document: after, report } = await importPptx(bytes, saveImage);
    expect(report.skipped).toEqual({});
    expect(after.title).toBe(before.title);
    expect(after.slides.map((s) => s.title)).toEqual(
      before.slides.map((s) => s.title)
    );
    before.slides.forEach((slide, i) => {
      const got = after.slides[i].shapes;
      // Connectors come after the shapes they glue to.
      const want = [
        ...slide.shapes.filter((s) => s.kind !== "line"),
        ...slide.shapes.filter((s) => s.kind === "line"),
      ];
      expect(got.map((s) => s.kind)).toEqual(want.map((s) => s.kind));
      got.forEach((shape, j) => {
        const a = boxOf(shape);
        const b = boxOf(want[j]);
        if (a && b) a.forEach((v, k) => expect(v).toBeCloseTo(b[k], 1));
      });
    });

    const second = after.slides[1].shapes;
    const oval = second.find((s) => s.kind === "ellipse")!;
    const list = second.find((s) => s.kind === "text")!;
    expect(oval).toMatchObject({
      fill: "#fff2cc",
      stroke: { color: "#ed7d31", width: 4, dash: "dash" },
      text: {
        anchor: "middle",
        paragraphs: [
          { align: "center", runs: [{ text: "橢圓", size: 48, bold: true }] },
        ],
      },
    });
    expect(list.kind === "text" && list.text.paragraphs).toMatchObject([
      { bullet: "bullet", runs: [{ text: "One", color: "#c00000" }] },
      { bullet: "number", level: 1, runs: [{ text: "Two", italic: true }] },
    ]);
    const line = second.find((s) => s.kind === "line")!;
    expect(line).toMatchObject({
      route: "elbow",
      start: { shape: oval.id, site: 3 },
      end: { shape: list.id, site: 1 },
      endArrow: "triangle",
    });
    expect(second.find((s) => s.kind === "image")).toMatchObject({
      asset: SHA,
    });
  });

  it("counts pictures it cannot store as left out", async () => {
    const bytes = exportPptx(
      richDeck(),
      new Map([[SHA, { mime: "image/png", data: PNG_1X1 }]])
    );
    const { document, report } = await importPptx(bytes, async () => null);
    expect(report.skipped).toEqual({ "picture format": 1 });
    expect(document.slides[1].shapes.some((s) => s.kind === "image")).toBe(
      false
    );
    expect(describeSkipped(report.skipped)).toContain("不支援格式的圖片");
  });

  it("refuses files that are not .pptx, or unpack too large", async () => {
    const code = (bytes: Uint8Array) =>
      importPptx(bytes, saveImage).catch((e: PptxError) => e.code);
    expect(await code(strToU8("hello"))).toBe("not-pptx");
    expect(await code(zipSync({ "a.txt": strToU8("x") }))).toBe("not-pptx");
    const big = zipSync({
      "ppt/presentation.xml": new Uint8Array(MAX_PART_BYTES + 1),
    });
    expect(await code(big)).toBe("too-large");
  });

  it("refuses XML with a document type, where entity bombs live", async () => {
    const bomb = zipSync({
      "ppt/presentation.xml": strToU8(
        '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><p:presentation>&a;</p:presentation>'
      ),
    });
    expect(
      await importPptx(bomb, saveImage).catch((e: PptxError) => e.code)
    ).toBe("malformed");
  });
});
