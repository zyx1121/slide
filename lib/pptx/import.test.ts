import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { sampleDocument } from "../deck/sample";
import type { DeckDocument, Shape } from "../deck/schema";
import { exportPptx } from "./export";
import { importPptx } from "./import";
import {
  MAX_IMPORT_ELEMENTS,
  MAX_PART_BYTES,
  MAX_XML_ELEMENTS,
  PptxError,
} from "./read";
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

  it("refuses an XML part with too many elements", async () => {
    const many = zipSync({
      "ppt/presentation.xml": strToU8(
        `<p:presentation>${"<a/>".repeat(MAX_XML_ELEMENTS)}</p:presentation>`
      ),
    });
    expect(
      await importPptx(many, saveImage).catch((e: PptxError) => e.code)
    ).toBe("too-large");
  });

  it("reads a slide listed twice once, and holds text to the limits", async () => {
    const doc = richDeck();
    doc.slides = [
      {
        id: "sl_long",
        title: "",
        shapes: [
          {
            id: "tx_long",
            kind: "text",
            x: 0,
            y: 0,
            w: 100,
            h: 100,
            text: { paragraphs: [{ runs: [{ text: "x".repeat(4000) }] }] },
          },
        ],
      },
    ];
    const parts = unzipSync(exportPptx(doc, new Map()));
    // List the one slide twice, and make its text longer than a shape may hold.
    const presentation = strFromU8(parts["ppt/presentation.xml"]).replace(
      /(<p:sldId [^>]*\/>)/,
      '$1<p:sldId id="999" r:id="rId101"/>'
    );
    parts["ppt/presentation.xml"] = strToU8(presentation);
    parts["ppt/slides/slide1.xml"] = strToU8(
      strFromU8(parts["ppt/slides/slide1.xml"]).replace(
        "x".repeat(4000),
        "x".repeat(9000)
      )
    );
    const { document, report } = await importPptx(zipSync(parts), saveImage);
    expect(document.slides).toHaveLength(1);
    expect(report.skipped).toEqual({
      "repeated slide": 1,
      "text over the limit": 1,
    });
    const shape = document.slides[0].shapes[0];
    expect(
      shape.kind === "text" && shape.text.paragraphs[0].runs[0].text.length
    ).toBe(5000);
  });

  it("refuses many capped slides that add up to too many elements", async () => {
    const parts = unzipSync(exportPptx(richDeck(), new Map()));
    // Slides just under the per-part cap, enough of them to pass the total.
    const count = Math.ceil(MAX_IMPORT_ELEMENTS / MAX_XML_ELEMENTS) + 1;
    const filler = "<a/>".repeat(MAX_XML_ELEMENTS - 100);
    const ids: string[] = [];
    const rels: string[] = [];
    for (let n = 1; n <= count; n++) {
      parts[`ppt/slides/slide${n}.xml`] = strToU8(
        `<p:sld><p:cSld><p:spTree>${filler}</p:spTree></p:cSld></p:sld>`
      );
      ids.push(`<p:sldId id="${300 + n}" r:id="rIdX${n}"/>`);
      rels.push(
        `<Relationship Id="rIdX${n}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${n}.xml"/>`
      );
    }
    parts["ppt/presentation.xml"] = strToU8(
      strFromU8(parts["ppt/presentation.xml"]).replace(
        /<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/,
        `<p:sldIdLst>${ids.join("")}</p:sldIdLst>`
      )
    );
    parts["ppt/_rels/presentation.xml.rels"] = strToU8(
      strFromU8(parts["ppt/_rels/presentation.xml.rels"]).replace(
        "</Relationships>",
        `${rels.join("")}</Relationships>`
      )
    );
    const before = process.memoryUsage().heapUsed;
    const failed = await importPptx(zipSync(parts), saveImage).catch(
      (e: PptxError) => e.code
    );
    expect(failed).toBe("too-large");
    // Slide trees are let go as the import goes: far below the 2 GB heap.
    expect(process.memoryUsage().heapUsed - before).toBeLessThan(1_000_000_000);
    // Parsing the 2 million elements first takes a few seconds on CI.
  }, 30_000);
});
