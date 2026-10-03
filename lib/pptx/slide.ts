// One slide of the deck document as PresentationML. Every shape becomes a
// native PowerPoint object: preset geometry for boxes, a picture for an
// image, a connector glued with stCxn and endCxn for a line. Sizes go from
// canvas px to EMU (1 px = 6350 EMU, half a point).
import type { Shape, Slide, TextBody } from "../deck/schema";
import { type Point, routeConnector } from "../render/connector";
import { shapeTextDefaults, type TextShape, titleScale } from "../render/svg";
import { DEFAULT_TEXT } from "../render/template";
import { parsePath, PATH_UNITS } from "../deck/path";
import { connectorGeometry } from "./connector";

/** EMU per canvas px. */
export const EMU = 6350;

type LineShape = Extract<Shape, { kind: "line" }>;
type ImageShape = Extract<Shape, { kind: "image" }>;
type Stroke = NonNullable<LineShape["stroke"]>;

/** The Latin and East Asian fonts every run names. */
export const LATIN_TYPEFACE = "Calibri";
export const EA_TYPEFACE = "Microsoft JhengHei";

// Characters XML 1.0 forbids: C0 controls but tab and newlines, U+FFFE,
// U+FFFF and lone surrogates.
const NOT_XML =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

export function esc(value: string): string {
  return value
    .replace(NOT_XML, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const emu = (px: number) => Math.round(px * EMU);

function color(value: string): string {
  const rgb = value.slice(1, 7).toUpperCase();
  if (value.length === 9) {
    const alpha = Math.round((parseInt(value.slice(7, 9), 16) / 255) * 100000);
    return `<a:srgbClr val="${rgb}"><a:alpha val="${alpha}"/></a:srgbClr>`;
  }
  return `<a:srgbClr val="${rgb}"/>`;
}

const solid = (value: string) => `<a:solidFill>${color(value)}</a:solidFill>`;

const DASHES: Record<string, string> = {
  solid: "solid",
  dash: "dash",
  dot: "sysDot",
  dashDot: "dashDot",
};

function line(stroke: Stroke | null | undefined, ends = ""): string {
  if (!stroke || stroke.width <= 0) return "<a:ln><a:noFill/></a:ln>";
  const dash = DASHES[stroke.dash ?? "solid"];
  return `<a:ln w="${emu(stroke.width)}">${solid(stroke.color)}<a:prstDash val="${dash}"/>${ends}</a:ln>`;
}

function xfrm(
  box: { x: number; y: number; w: number; h: number },
  rotation = 0,
  flipH = false,
  flipV = false
): string {
  const attrs = [
    rotation ? `rot="${Math.round(rotation * 60000)}"` : "",
    flipH ? 'flipH="1"' : "",
    flipV ? 'flipV="1"' : "",
  ]
    .filter(Boolean)
    .join(" ");
  return `<a:xfrm${attrs ? ` ${attrs}` : ""}><a:off x="${emu(box.x)}" y="${emu(box.y)}"/><a:ext cx="${emu(box.w)}" cy="${emu(box.h)}"/></a:xfrm>`;
}

const ALIGN: Record<string, string> = {
  left: "l",
  center: "ctr",
  right: "r",
  justify: "just",
};
const ANCHOR: Record<string, string> = { top: "t", middle: "ctr", bottom: "b" };
/** PowerPoint's indents, in EMU: 0.5 in per level, the bullet's hang. */
const LEVEL_INDENT = 457200;
const BULLET_HANG = 342900;
const NUMBER_HANG = 457200;

type Run = TextBody["paragraphs"][number]["runs"][number];

function runProps(run: Partial<Run>, tag: "a:rPr" | "a:endParaRPr"): string {
  const size = run.size ?? DEFAULT_TEXT.size;
  const attrs = [
    'lang="zh-TW"',
    'altLang="en-US"',
    `sz="${Math.round(size * 50)}"`,
    run.bold ? 'b="1"' : 'b="0"',
    run.italic ? 'i="1"' : "",
    run.underline ? 'u="sng"' : "",
    run.strike ? 'strike="sngStrike"' : "",
    'dirty="0"',
  ]
    .filter(Boolean)
    .join(" ");
  return `<${tag} ${attrs}>${solid(run.color ?? DEFAULT_TEXT.color)}<a:latin typeface="${LATIN_TYPEFACE}"/><a:ea typeface="${EA_TYPEFACE}"/><a:cs typeface="${LATIN_TYPEFACE}"/></${tag}>`;
}

function runsXml(run: Run): string {
  // A vertical tab or newline inside a run is a line break.
  return run.text
    .split(/[\n\u000b]/)
    .map((piece) =>
      piece === ""
        ? ""
        : `<a:r>${runProps(run, "a:rPr")}<a:t>${esc(piece)}</a:t></a:r>`
    )
    .join(`<a:br>${runProps(run, "a:rPr")}</a:br>`);
}

/** A text body as DrawingML, with the defaults the renderer lays it out with. */
export function textBodyXml(
  body: TextBody | undefined,
  defaults: { align: string; anchor: string },
  options: { autofit?: boolean } = {}
): string {
  const anchor = ANCHOR[body?.anchor ?? defaults.anchor];
  const fit = options.autofit ? "<a:spAutoFit/>" : "<a:noAutofit/>";
  const bodyPr = `<a:bodyPr wrap="square" lIns="91440" tIns="45720" rIns="91440" bIns="45720" anchor="${anchor}" rtlCol="0">${fit}</a:bodyPr>`;
  const paragraphs = (body?.paragraphs ?? [{ runs: [] }]).map((paragraph) => {
    const level = paragraph.level ?? 0;
    const bullet = paragraph.bullet ?? "none";
    const hang =
      bullet === "number" ? NUMBER_HANG : bullet === "bullet" ? BULLET_HANG : 0;
    const marL = level * LEVEL_INDENT + hang;
    const align = ALIGN[paragraph.align ?? defaults.align];
    const bu =
      bullet === "bullet"
        ? '<a:buFont typeface="Arial"/><a:buChar char="•"/>'
        : bullet === "number"
          ? '<a:buFont typeface="+mj-lt"/><a:buAutoNum type="arabicPeriod"/>'
          : "<a:buNone/>";
    const pPr = `<a:pPr marL="${marL}" indent="${-hang}" algn="${align}"${level ? ` lvl="${Math.min(level, 8)}"` : ""}>${bu}</a:pPr>`;
    const runs = paragraph.runs.map(runsXml).join("");
    const last = paragraph.runs[paragraph.runs.length - 1] ?? {};
    return `<a:p>${pPr}${runs}${runProps(last, "a:endParaRPr")}</a:p>`;
  });
  return `<p:txBody>${bodyPr}<a:lstStyle/>${paragraphs.join("")}</p:txBody>`;
}

/** A freeform's outline as DrawingML custom geometry over its box. */
function custGeom(d: string): string {
  const pt = ([x, y]: [number, number]) =>
    `<a:pt x="${Math.round(x * 100)}" y="${Math.round(y * 100)}"/>`;
  const TAGS = {
    M: "a:moveTo",
    L: "a:lnTo",
    C: "a:cubicBezTo",
    Q: "a:quadBezTo",
  };
  const commands = (parsePath(d) ?? [])
    .map((c) =>
      c.op === "Z"
        ? "<a:close/>"
        : `<${TAGS[c.op]}>${c.points.map(pt).join("")}</${TAGS[c.op]}>`
    )
    .join("");
  const size = PATH_UNITS * 100;
  return `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="l" t="t" r="r" b="b"/><a:pathLst><a:path w="${size}" h="${size}">${commands}</a:path></a:pathLst></a:custGeom>`;
}

/** The DrawingML preset a shape is drawn as. */
const presetOf = (shape: TextShape): string =>
  shape.kind === "preset"
    ? shape.geometry
    : shape.kind === "text"
      ? "rect"
      : shape.kind;

/**
 * Connection site indices in PowerPoint's presets. Rectangles list top,
 * left, bottom, right, as the document does; an ellipse lists eight sites
 * counterclockwise from the top, so ours are every second one.
 */
export function siteIndex(shape: Shape, site: number): number {
  return shape.kind === "ellipse" ? site * 2 : site;
}

export type SlideParts = {
  xml: string;
  /** Pictures the slide embeds: relationship id and asset. */
  pictures: { rId: string; sha256: string }[];
};

type Context = {
  /** The media part name for an asset, or null when it is not available. */
  media: (sha256: string) => string | null;
};

function boxXml(shape: TextShape, id: number): string {
  const defaults = shapeTextDefaults(shape.kind);
  const geom =
    shape.kind === "roundRect"
      ? `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${Math.round((shape.corner ?? 1 / 6) * 100000)}"/></a:avLst></a:prstGeom>`
      : shape.kind === "freeform"
        ? custGeom(shape.path)
        : `<a:prstGeom prst="${presetOf(shape)}"><a:avLst/></a:prstGeom>`;
  const fill = shape.fill ? solid(shape.fill) : "<a:noFill/>";
  const textBox = shape.kind === "text" ? ' txBox="1"' : "";
  // Text boxes without fill or outline grow with their text, as the editor's do.
  const autofit = shape.kind === "text" && !shape.fill && !shape.stroke;
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${esc(shape.id)}"/><p:cNvSpPr${textBox}/><p:nvPr/></p:nvSpPr><p:spPr>${xfrm(shape, shape.rotation)}${geom}${fill}${line(shape.stroke)}</p:spPr>${textBodyXml(shape.text, defaults, { autofit })}</p:sp>`;
}

/** A crop in DrawingML's thousandths of a percent. */
function srcRect(crop: ImageShape["crop"]): string {
  if (!crop) return "";
  const at = (side: number) => Math.round(side * 100000);
  return `<a:srcRect l="${at(crop.left)}" t="${at(crop.top)}" r="${at(crop.right)}" b="${at(crop.bottom)}"/>`;
}

function pictureXml(shape: ImageShape, id: number, rId: string): string {
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${esc(shape.id)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rId}"/>${srcRect(shape.crop)}<a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(shape, shape.rotation)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${shape.stroke ? line(shape.stroke) : ""}</p:spPr></p:pic>`;
}

function connectorXml(
  shape: LineShape,
  id: number,
  shapes: ReadonlyMap<string, Shape>,
  ids: ReadonlyMap<string, number>
): string {
  // PowerPoint's curved connectors bend where its bent ones do, so a curved
  // connector is stored as its elbow route with a curved preset.
  const route = shape.route === "curved" ? "elbow" : shape.route;
  const points: Point[] = routeConnector({ ...shape, route }, shapes).points;
  const geometry = connectorGeometry(points, shape.route === "curved");
  const glue = (end: LineShape["start"], tag: "a:stCxn" | "a:endCxn") => {
    if (!("shape" in end)) return "";
    const target = shapes.get(end.shape);
    const targetId = ids.get(end.shape);
    if (!target || targetId === undefined) return "";
    return `<${tag} id="${targetId}" idx="${siteIndex(target, end.site)}"/>`;
  };
  const av = geometry.adjust
    .map((value, i) => `<a:gd name="adj${i + 1}" fmla="val ${value}"/>`)
    .join("");
  const head = (kind: string | undefined, tag: "a:headEnd" | "a:tailEnd") =>
    kind && kind !== "none" ? `<${tag} type="${kind}" w="med" len="med"/>` : "";
  const ends =
    head(shape.startArrow, "a:headEnd") + head(shape.endArrow, "a:tailEnd");
  return `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${id}" name="${esc(shape.id)}"/><p:cNvCxnSpPr>${glue(shape.start, "a:stCxn")}${glue(shape.end, "a:endCxn")}</p:cNvCxnSpPr><p:nvPr/></p:nvCxnSpPr><p:spPr>${xfrm(geometry, geometry.rotation, geometry.flipH, geometry.flipV)}<a:prstGeom prst="${geometry.prst}"><a:avLst>${av}</a:avLst></a:prstGeom><a:noFill/>${line(shape.stroke, ends)}</p:spPr></p:cxnSp>`;
}

/**
 * The title placeholder; lines of the title are line breaks in one
 * paragraph. A title the renderer shrank to fit is stored shrunk the same
 * way, since PowerPoint draws the stored scale until the text is edited.
 */
function titleXml(title: string): string {
  if (!title) return "";
  const scale = titleScale(title);
  const bodyPr =
    scale < 1
      ? `<a:bodyPr><a:normAutofit fontScale="${Math.round(scale * 100000)}"/></a:bodyPr>`
      : "<a:bodyPr/>";
  const lines = title.split("\n");
  const rPr = '<a:rPr lang="zh-TW" altLang="en-US" dirty="0"/>';
  const runs = lines
    .map((piece) => (piece ? `<a:r>${rPr}<a:t>${esc(piece)}</a:t></a:r>` : ""))
    .join(`<a:br>${rPr}</a:br>`);
  return `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody>${bodyPr}<a:lstStyle/><a:p>${runs}</a:p></p:txBody></p:sp>`;
}

function slideNumberXml(number: number): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Slide Number"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldNum" sz="quarter" idx="2"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:fld id="{86CB4B4D-7CA3-9044-876B-883B54F8677D}" type="slidenum"><a:rPr lang="en-US"/><a:t>${number}</a:t></a:fld></a:p></p:txBody></p:sp>`;
}

const NS =
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';

/** A slide part and the pictures it embeds. */
export function slideXml(
  slide: Slide,
  number: number,
  context: Context
): SlideParts {
  const shapes = new Map(slide.shapes.map((shape) => [shape.id, shape]));
  // Drawing order ids: 2 and 3 are the placeholders.
  const ids = new Map(slide.shapes.map((shape, i) => [shape.id, 10 + i]));
  const pictures: SlideParts["pictures"] = [];
  const body = slide.shapes.map((shape) => {
    const id = ids.get(shape.id)!;
    switch (shape.kind) {
      case "line":
        return connectorXml(shape, id, shapes, ids);
      case "image": {
        if (!context.media(shape.asset)) {
          // A picture whose bytes are not available becomes an empty frame.
          return boxXml(
            {
              id: shape.id,
              kind: "rect",
              x: shape.x,
              y: shape.y,
              w: shape.w,
              h: shape.h,
              rotation: shape.rotation,
              fill: "#e5e5e5",
              stroke: { color: "#a3a3a3", width: 2 },
            },
            id
          );
        }
        let picture = pictures.find((p) => p.sha256 === shape.asset);
        if (!picture) {
          picture = { rId: `rId${pictures.length + 2}`, sha256: shape.asset };
          pictures.push(picture);
        }
        return pictureXml(shape, id, picture.rId);
      }
      default:
        return boxXml(shape, id);
    }
  });
  const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld ${NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${titleXml(slide.title)}${slideNumberXml(number)}${body.join("")}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
  return { xml, pictures };
}
