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
            id: "sh_blob",
            kind: "freeform",
            x: 900,
            y: 700,
            w: 200,
            h: 150,
            fill: "#e8f1fe",
            stroke: { color: "#3297fc", width: 3 },
            path: "M 0 500 C 0 0 1000 0 1000 500 L 500 1000 Z",
          },
          {
            id: "sh_arrow",
            kind: "preset",
            geometry: "rightArrow",
            x: 500,
            y: 700,
            w: 300,
            h: 120,
            fill: "#3297fc",
            stroke: null,
            text: { paragraphs: [{ runs: [{ text: "next", size: 36 }] }] },
          },
          {
            id: "im_pic",
            kind: "image",
            x: 100,
            y: 700,
            w: 300,
            h: 200,
            asset: SHA,
            crop: { left: 0.1, top: 0, right: 0.25, bottom: 0.05 },
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

  it("sizes shape text from the presentation and master defaults", async () => {
    const doc = richDeck();
    const run = (text: string) => ({ runs: [{ text }] });
    doc.slides = [
      {
        id: "sl_defaults",
        title: "",
        shapes: [
          {
            id: "tx_plain",
            kind: "text",
            x: 0,
            y: 0,
            w: 400,
            h: 100,
            text: { paragraphs: [run("top"), { ...run("under"), level: 1 }] },
          },
        ],
      },
    ];
    const parts = unzipSync(exportPptx(doc, new Map()));
    const level = (n: number, sz: number) =>
      `<a:lvl${n}pPr><a:defRPr sz="${sz}"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:defRPr></a:lvl${n}pPr>`;
    // The presentation sizes both levels; the master sizes only the first.
    const presentation = strFromU8(parts["ppt/presentation.xml"])
      .replace(/<p:defaultTextStyle>[\s\S]*?<\/p:defaultTextStyle>/, "")
      .replace(
        "</p:presentation>",
        `<p:defaultTextStyle>${level(1, 2400)}${level(2, 2000)}</p:defaultTextStyle></p:presentation>`
      );
    parts["ppt/presentation.xml"] = strToU8(presentation);
    const master = strFromU8(parts["ppt/slideMasters/slideMaster1.xml"]);
    expect(master).toContain("<p:otherStyle>");
    parts["ppt/slideMasters/slideMaster1.xml"] = strToU8(
      master.replace(
        /<p:otherStyle>[\s\S]*?<\/p:otherStyle>/,
        `<p:otherStyle>${level(1, 3000)}</p:otherStyle>`
      )
    );
    // Export sizes every run; these runs leave it to the defaults.
    parts["ppt/slides/slide1.xml"] = strToU8(
      strFromU8(parts["ppt/slides/slide1.xml"]).replace(/ sz="\d+"/g, "")
    );
    const { document } = await importPptx(zipSync(parts), saveImage);
    const shape = document.slides[0].shapes[0];
    if (shape.kind !== "text") throw new Error("expected a text box");
    const [top, under] = shape.text.paragraphs.map((p) => p.runs[0]);
    expect(top.size).toBe(60);
    expect(under.size).toBe(40);
    // Colors in those defaults do not reach shapes, which have their own.
    expect(top.color).not.toBe("#FF0000");
  });

  it("leaves out crops that pad a picture or keep almost none of it", async () => {
    const shas = [SHA];
    const exported = unzipSync(
      exportPptx(
        richDeck(),
        new Map(shas.map((sha) => [sha, { mime: "image/png", data: PNG_1X1 }]))
      )
    );
    const name = Object.keys(exported).find((n) =>
      strFromU8(exported[n]).includes("<a:srcRect")
    )!;
    const pictureOf = async (srcRect: string) => {
      const parts = { ...exported };
      parts[name] = strToU8(
        strFromU8(exported[name]).replace(/<a:srcRect [^>]*\/>/, srcRect)
      );
      const { document, report } = await importPptx(zipSync(parts), saveImage);
      const picture = document.slides
        .flatMap((slide) => slide.shapes)
        .find((shape) => shape.kind === "image");
      return { picture, skipped: report.skipped };
    };
    const padded = await pictureOf('<a:srcRect l="-5000" r="10000"/>');
    expect(padded.picture).not.toHaveProperty("crop");
    expect(padded.skipped).toEqual({ "picture crop": 1 });
    const sliver = await pictureOf('<a:srcRect l="60000" r="39500"/>');
    expect(sliver.picture).not.toHaveProperty("crop");
    const kept = await pictureOf('<a:srcRect t="12345"/>');
    expect(kept.picture).toMatchObject({
      crop: { left: 0, top: 0.12345, right: 0, bottom: 0 },
    });
    expect(kept.skipped).toEqual({});
  });

  it("reads a table as a rectangle per cell, merges spanning", async () => {
    const doc = richDeck();
    doc.slides = [{ id: "sl_table", title: "", shapes: [] }];
    const parts = unzipSync(exportPptx(doc, new Map()));
    const cell = (text: string, attrs = "") =>
      `<a:tc${attrs}><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US"/><a:t>${text}</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>`;
    // 3 columns of 100 px, rows of 50 px in a frame 150 px tall: a header
    // cell over two columns, then a cell two rows tall.
    const px = (n: number) => n * 6350;
    const table = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="9" name="Table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="${px(200)}" y="${px(300)}"/><a:ext cx="${px(300)}" cy="${px(150)}"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="1" bandRow="1"><a:tableStyleId>{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}</a:tableStyleId></a:tblPr><a:tblGrid><a:gridCol w="${px(100)}"/><a:gridCol w="${px(100)}"/><a:gridCol w="${px(100)}"/></a:tblGrid><a:tr h="${px(50)}">${cell("Head", ' gridSpan="2"')}${cell("", ' hMerge="1"')}${cell("C")}</a:tr><a:tr h="${px(50)}">${cell("Tall", ' rowSpan="2"')}${cell("b")}${cell("c")}</a:tr><a:tr h="${px(50)}">${cell("", ' vMerge="1"')}${cell("e")}${cell("f")}</a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
    const name = "ppt/slides/slide1.xml";
    parts[name] = strToU8(
      strFromU8(parts[name]).replace("</p:spTree>", `${table}</p:spTree>`)
    );
    const { document, report } = await importPptx(zipSync(parts), saveImage);
    expect(report.skipped).toEqual({});
    const cells = document.slides[0].shapes.filter((s) => s.kind === "rect");
    const summary = cells.map((s) => {
      const run = s.kind === "rect" ? s.text?.paragraphs[0].runs[0] : undefined;
      return [run?.text ?? "", s.x, s.y, s.w, s.h, run?.bold ?? false];
    });
    expect(summary).toEqual([
      ["Head", 200, 300, 200, 50, true],
      ["C", 400, 300, 100, 50, true],
      ["Tall", 200, 350, 100, 100, false],
      ["b", 300, 350, 100, 50, false],
      ["c", 400, 350, 100, 50, false],
      ["e", 300, 400, 100, 50, false],
      ["f", 400, 400, 100, 50, false],
    ]);
    // The default style: the theme's accent behind the header, banded rows.
    const fills = cells.map((s) => (s.kind === "rect" ? s.fill : null));
    expect(fills[0]).toBe(fills[1]);
    expect(fills[3]).not.toBe(fills[5]);
  });

  it("reads a freeform of one straight segment as a line with its arrow", async () => {
    const doc = richDeck();
    doc.slides = [{ id: "sl_free", title: "", shapes: [] }];
    const parts = unzipSync(exportPptx(doc, new Map()));
    const px = (n: number) => n * 6350;
    const freeform = (id: number, flip: string, from: string, to: string) =>
      `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Freeform"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm${flip}><a:off x="${px(100)}" y="${px(200)}"/><a:ext cx="${px(400)}" cy="${px(100)}"/></a:xfrm><a:custGeom><a:pathLst><a:path w="400" h="100"><a:moveTo><a:pt ${from}/></a:moveTo><a:lnTo><a:pt ${to}/></a:lnTo></a:path></a:pathLst></a:custGeom><a:noFill/><a:ln w="34925"><a:solidFill><a:srgbClr val="E8710A"/></a:solidFill><a:tailEnd type="triangle"/></a:ln></p:spPr></p:sp>`;
    const name = "ppt/slides/slide1.xml";
    parts[name] = strToU8(
      strFromU8(parts[name]).replace(
        "</p:spTree>",
        // Top left to bottom right, then the same path flipped: top right
        // to bottom left.
        freeform(20, "", 'x="0" y="0"', 'x="400" y="100"') +
          freeform(21, ' flipH="1"', 'x="0" y="0"', 'x="400" y="100"') +
          "</p:spTree>"
      )
    );
    const { document, report } = await importPptx(zipSync(parts), saveImage);
    expect(report.skipped).toEqual({});
    const lines = document.slides[0].shapes.filter((s) => s.kind === "line");
    expect(lines).toMatchObject([
      {
        route: "straight",
        start: { x: 100, y: 200 },
        end: { x: 500, y: 300 },
        stroke: { color: "#e8710a", width: 5.5 },
        endArrow: "triangle",
      },
      { start: { x: 500, y: 200 }, end: { x: 100, y: 300 } },
    ]);
  });

  it("reads a freeform's outline across its box, arcs as curves, flips applied", async () => {
    const doc = richDeck();
    doc.slides = [{ id: "sl_curve", title: "", shapes: [] }];
    const parts = unzipSync(exportPptx(doc, new Map()));
    const px = (n: number) => n * 6350;
    // A half disc: across the top, then a 180 degree arc back underneath.
    const shape = `<p:sp><p:nvSpPr><p:cNvPr id="30" name="Freeform"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm flipV="1"><a:off x="${px(100)}" y="${px(100)}"/><a:ext cx="${px(200)}" cy="${px(100)}"/></a:xfrm><a:custGeom><a:pathLst><a:path w="200" h="100"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="200" y="0"/></a:lnTo><a:arcTo wR="100" hR="100" stAng="0" swAng="10800000"/><a:close/></a:path></a:pathLst></a:custGeom><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></p:spPr></p:sp>`;
    const name = "ppt/slides/slide1.xml";
    parts[name] = strToU8(
      strFromU8(parts[name]).replace("</p:spTree>", `${shape}</p:spTree>`)
    );
    const { document, report } = await importPptx(zipSync(parts), saveImage);
    expect(report.skipped).toEqual({});
    const got = document.slides[0].shapes[0];
    expect(got).toMatchObject({
      kind: "freeform",
      x: 100,
      y: 100,
      w: 200,
      h: 100,
      fill: "#ff0000",
    });
    const d = got.kind === "freeform" ? got.path : "";
    // Flipped upside down: the top edge is at the bottom, the arc's lowest
    // point (the middle of the box) at the top.
    expect(d.startsWith("M 0 1000 L 1000 1000 C")).toBe(true);
    expect(d).toContain(" 500 0 C");
    expect(d.endsWith("0 1000 Z")).toBe(true);
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
