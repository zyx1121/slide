import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { sampleDocument } from "../deck/sample";
import type { DeckDocument } from "../deck/schema";
import { exportPptx } from "./export";

const doc = sampleDocument();
const PNG_1X1 = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
  ),
  (ch) => ch.charCodeAt(0)
);

describe("exportPptx", () => {
  const parts = unzipSync(exportPptx(doc, new Map()));
  const text = (name: string) => strFromU8(parts[name]);

  it("keeps the template's master and replaces its slides", () => {
    expect(parts["ppt/slideMasters/slideMaster1.xml"]).toBeDefined();
    const slides = Object.keys(parts).filter((name) =>
      /^ppt\/slides\/slide\d+\.xml$/.test(name)
    );
    expect(slides).toHaveLength(doc.slides.length);
    expect(text("ppt/presentation.xml").match(/<p:sldId /g)).toHaveLength(
      doc.slides.length
    );
    expect(
      text("ppt/_rels/presentation.xml.rels").match(/relationships\/slide"/g)
    ).toHaveLength(doc.slides.length);
    expect(text("[Content_Types].xml")).toContain(
      'PartName="/ppt/slides/slide1.xml"'
    );
    expect(text("docProps/core.xml")).toContain(
      `<dc:title>${doc.title}</dc:title>`
    );
  });

  it("puts the title and number in the master's placeholders", () => {
    const slide = text("ppt/slides/slide1.xml");
    expect(slide).toContain('<p:ph type="title"/>');
    expect(slide).toContain(`<a:t>${doc.slides[0].title}</a:t>`);
    expect(slide).toContain('type="slidenum"');
    expect(text("ppt/slides/_rels/slide1.xml.rels")).toContain(
      "slideLayout2.xml"
    );
  });

  it("writes shapes as presets, with Latin and East Asian fonts", () => {
    const slide = text("ppt/slides/slide1.xml");
    expect(slide).toContain('prst="roundRect"');
    expect(slide).toContain('<a:latin typeface="Calibri"/>');
    expect(slide).toContain('<a:ea typeface="Microsoft JhengHei"/>');
    // Runs are marked by their text, so PowerPoint picks the quotes' font
    // as the renderer does: Chinese for 語音辨識, English for Audio capture.
    const runOf = (text: string) => {
      const at = slide.indexOf(`<a:t>${text}</a:t>`);
      return slide.slice(slide.lastIndexOf("<a:rPr ", at), at);
    };
    expect(runOf("語音辨識")).toContain('lang="zh-TW" altLang="en-US"');
    expect(runOf("Audio capture")).toContain('lang="en-US" altLang="zh-TW"');
  });

  it("glues connectors to the shapes' ids and sites", () => {
    const slide = text("ppt/slides/slide1.xml");
    expect(slide).toMatch(/<a:stCxn id="10" idx="[0-3]"\/>/);
    expect(slide).toMatch(/prst="(straight|bent|curved)Connector\d"/);
  });

  it("maps an ellipse's sites to PowerPoint's eight", () => {
    const withEllipse: DeckDocument = {
      ...doc,
      slides: [
        {
          id: "sl_one",
          title: "",
          shapes: [
            { id: "sh_box", kind: "rect", x: 100, y: 100, w: 200, h: 100 },
            { id: "sh_oval", kind: "ellipse", x: 600, y: 100, w: 200, h: 100 },
            {
              id: "ln_join",
              kind: "line",
              route: "straight",
              start: { shape: "sh_box", site: 3 },
              end: { shape: "sh_oval", site: 1 },
              stroke: { color: "#000000", width: 2 },
            },
          ],
        },
      ],
    };
    const slide = strFromU8(
      unzipSync(exportPptx(withEllipse, new Map()))["ppt/slides/slide1.xml"]
    );
    expect(slide).toContain('<a:stCxn id="10" idx="3"/>');
    expect(slide).toContain('<a:endCxn id="11" idx="2"/>');
  });

  it("embeds pictures once and frames the ones it cannot", () => {
    const sha = "b".repeat(64);
    const withPictures: DeckDocument = {
      ...doc,
      slides: [
        {
          id: "sl_one",
          title: "Pictures",
          shapes: [
            {
              id: "im_one",
              kind: "image",
              x: 0,
              y: 0,
              w: 10,
              h: 10,
              asset: sha,
            },
            {
              id: "im_two",
              kind: "image",
              x: 20,
              y: 0,
              w: 10,
              h: 10,
              asset: sha,
            },
            {
              id: "im_gone",
              kind: "image",
              x: 40,
              y: 0,
              w: 10,
              h: 10,
              asset: "c".repeat(64),
            },
          ],
        },
      ],
    };
    const out = unzipSync(
      exportPptx(
        withPictures,
        new Map([[sha, { mime: "image/png", data: PNG_1X1 }]])
      )
    );
    const media = Object.keys(out).filter((name) =>
      name.startsWith("ppt/media/asset-")
    );
    expect(media).toEqual([`ppt/media/asset-${sha.slice(0, 16)}.png`]);
    const slide = strFromU8(out["ppt/slides/slide1.xml"]);
    expect(slide.match(/<p:pic>/g)).toHaveLength(2);
    expect(slide).toContain('name="im_gone"');
  });

  it("escapes text and drops characters XML cannot hold", () => {
    const tricky: DeckDocument = {
      ...doc,
      title: 'A & B <"x">',
      slides: [
        {
          id: "sl_one",
          title: "x\u0001<y>",
          shapes: [],
        },
      ],
    };
    const out = unzipSync(exportPptx(tricky, new Map()));
    expect(strFromU8(out["ppt/slides/slide1.xml"])).toContain(
      "<a:t>x&lt;y&gt;</a:t>"
    );
    expect(strFromU8(out["docProps/core.xml"])).toContain(
      "A &amp; B &lt;&quot;x&quot;&gt;"
    );
  });
});
