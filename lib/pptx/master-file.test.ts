import { readFileSync } from "node:fs";
import { join } from "node:path";

import { strFromU8, strToU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { sampleDocument } from "../deck/sample";
import { exportPptx } from "./export";
import { keptPresentation, masterFile } from "./master-file";
import { unzipMasterParts } from "./read";

const winlab = () =>
  new Map(
    Object.entries(
      unzipSync(readFileSync(join(process.cwd(), "template", "winlab.pptx")))
    )
  );

describe("masterFile", () => {
  it("keeps the masters and what they use, and nothing a deck carried", () => {
    const parts = winlab();
    // A chart and its workbook, comments and document properties, as an
    // imported file would bring them.
    parts.set("ppt/charts/chart1.xml", strToU8("<c:chartSpace/>"));
    parts.set("ppt/embeddings/Book1.xlsx", strToU8("secret"));
    parts.set("ppt/comments/modernComment_1.xml", strToU8("<p188:cmLst/>"));
    parts.set("docProps/app.xml", strToU8("<Properties>Company</Properties>"));
    parts.set(
      "ppt/_rels/presentation.xml.rels",
      strToU8(
        strFromU8(parts.get("ppt/_rels/presentation.xml.rels")!).replace(
          "</Relationships>",
          '<Relationship Id="rId900" Type="http://schemas.microsoft.com/office/2015/10/relationships/commentAuthors" Target="commentAuthors.xml"/></Relationships>'
        )
      )
    );
    parts.set("ppt/commentAuthors.xml", strToU8("<p:cmAuthorLst/>"));
    const kept = unzipSync(masterFile(parts).bytes);
    const names = Object.keys(kept);
    for (const gone of [
      "ppt/charts/chart1.xml",
      "ppt/embeddings/Book1.xlsx",
      "ppt/comments/modernComment_1.xml",
      "ppt/commentAuthors.xml",
      "docProps/app.xml",
    ]) {
      expect(names).not.toContain(gone);
    }
    expect(names.some((name) => name.startsWith("ppt/slides/"))).toBe(false);
    expect(names).toContain("ppt/slideMasters/slideMaster1.xml");
    expect(names).toContain("ppt/slideLayouts/slideLayout5.xml");
    expect(names).toContain("ppt/theme/theme1.xml");
    expect(names.some((name) => name.startsWith("ppt/media/"))).toBe(true);
    expect(strFromU8(kept["ppt/_rels/presentation.xml.rels"])).not.toContain(
      "commentAuthors"
    );
    expect(strFromU8(kept["[Content_Types].xml"])).not.toMatch(
      /app\.xml|slides\/slide/
    );
  });

  it("gives slides relationship ids past every one the presentation has", () => {
    const parts = unzipMasterParts(
      readFileSync(join(process.cwd(), "template", "winlab.pptx"))
    );
    // As PowerPoint numbers them after a hundred slides.
    const rels = strFromU8(parts.get("ppt/_rels/presentation.xml.rels")!);
    parts.set(
      "ppt/_rels/presentation.xml.rels",
      strToU8(rels.replace(/Id="rId1"/, 'Id="rId102"'))
    );
    parts.set(
      "ppt/presentation.xml",
      strToU8(
        strFromU8(parts.get("ppt/presentation.xml")!).replace(
          /r:id="rId1"/,
          'r:id="rId102"'
        )
      )
    );
    const doc = sampleDocument();
    for (let i = 0; i < 5; i++) {
      doc.slides.push({ id: `sl_extra${i}`, title: `${i}`, shapes: [] });
    }
    const out = unzipSync(exportPptx(doc, new Map(), masterFile(parts).bytes));
    const ids = [
      ...strFromU8(out["ppt/_rels/presentation.xml.rels"]).matchAll(
        /\bId="([^"]+)"/g
      ),
    ].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(strFromU8(out["ppt/presentation.xml"])).toMatch(
      /<\/p:sldMasterIdLst>(<p:notesMasterIdLst>.*?<\/p:notesMasterIdLst>)?<p:sldIdLst>/
    );
  });

  it("keeps only the master lists, sizes and text style of the presentation", () => {
    const xml =
      '<?xml version="1.0"?><p:presentation xmlns:p="p" saveSubsetFonts="1">' +
      '<p:sldMasterIdLst><p:sldMasterId id="1" r:id="rId1"/></p:sldMasterIdLst>' +
      '<p:sldIdLst><p:sldId id="256" r:id="rId9"/></p:sldIdLst>' +
      '<p:sldSz cx="1" cy="2"/><p:notesSz cx="3" cy="4"/>' +
      '<p:custShowLst><p:custShow name="secret"/></p:custShowLst>' +
      '<p:modifyVerifier cryptProviderType="rsaAES" hashData="SECRET_HASH"/>' +
      "<p:defaultTextStyle><a:lvl1pPr/></p:defaultTextStyle>" +
      '<p:extLst><p:ext uri="a"/></p:extLst><p:extLst><p:ext uri="SECRET_EXT"/></p:extLst>' +
      "</p:presentation>";
    const kept = keptPresentation(xml);
    expect(kept).not.toMatch(/SECRET|sldIdLst|custShow|modifyVerifier|extLst/);
    expect(kept).toBe(
      '<?xml version="1.0"?><p:presentation xmlns:p="p" saveSubsetFonts="1">' +
        '<p:sldMasterIdLst><p:sldMasterId id="1" r:id="rId1"/></p:sldMasterIdLst>' +
        '<p:sldSz cx="1" cy="2"/><p:notesSz cx="3" cy="4"/>' +
        "<p:defaultTextStyle><a:lvl1pPr/></p:defaultTextStyle></p:presentation>"
    );
  });
});
