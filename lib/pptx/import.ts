// A .pptx as a deck document: the reverse of export.ts. Slides keep their
// title; rectangles, rounded rectangles, ellipses, text boxes, text
// placeholders, lines, connectors with their glue and pictures come across
// as shapes, groups are flattened. Anything else is skipped and counted in
// the report: tables, charts, freeforms without text, pictures in formats
// the editor cannot draw.
import { newId } from "../ids";
import {
  DeckDocument,
  SCHEMA_VERSION,
  type Shape,
  type Slide,
  type TextBody,
} from "../deck/schema";
import { DECK_TITLE_MAX, SHAPE_TEXT_MAX, SLIDE_TEXT_MAX } from "../deck/limits";
import { readColor, readColorMap, readTheme, type Theme } from "./color";
import {
  child,
  children,
  type El,
  type ElementBudget,
  MAX_IMPORT_ELEMENTS,
  num,
  parseXml,
  path,
  PptxError,
  relationships,
  textOf,
  unzipPptx,
} from "./read";

/** Stores a picture's bytes; null when its format is not one the editor draws. */
export type SaveImage = (
  bytes: Uint8Array
) => Promise<{ sha256: string } | null>;

export type ImportReport = {
  slides: number;
  shapes: number;
  /** What was left out, by kind, and how many. */
  skipped: Record<string, number>;
};

export type ImportResult = { document: DeckDocument; report: ImportReport };

type Paragraph = TextBody["paragraphs"][number];
type Run = Paragraph["runs"][number];
type Box = { x: number; y: number; w: number; h: number; rotation: number };
/** Maps a box in a group's child space onto the slide. */
type Place = (box: Box) => Box;

const EMU = 6350;
const MAX_SLIDES = 500;
/** How long an import may read before it gives up. */
const TIME_BUDGET_MS = 20_000;
/** The most text an imported deck may hold: 500 slides' worth is too much. */
const DECK_TEXT_MAX = 2_000_000;

const shapeTextLength = (body: TextBody) =>
  body.paragraphs.reduce(
    (sum, p) => sum + p.runs.reduce((n, r) => n + r.text.length, 0),
    0
  );

function slideTextLength(slide: Slide): number {
  let length = slide.title.length;
  for (const shape of slide.shapes) {
    if (shape.kind !== "line" && shape.kind !== "image" && shape.text) {
      length += shapeTextLength(shape.text);
    }
  }
  return length;
}

/** Cuts a text body down to `budget` characters, dropping what follows. */
function cutText(body: TextBody, budget: number): TextBody {
  let left = budget;
  const paragraphs: TextBody["paragraphs"] = [];
  for (const paragraph of body.paragraphs) {
    const runs = [];
    for (const run of paragraph.runs) {
      if (left <= 0) break;
      runs.push({ ...run, text: run.text.slice(0, left) });
      left -= Math.min(left, run.text.length);
    }
    paragraphs.push({ ...paragraph, runs });
    if (left <= 0) break;
  }
  return { ...body, paragraphs };
}

/**
 * Holds a slide to the schema's text limits (SHAPE_TEXT_MAX a shape,
 * SLIDE_TEXT_MAX a slide), cutting text past them. True when it cut any.
 */
function capText(slide: Slide): boolean {
  let cut = false;
  let left = SLIDE_TEXT_MAX - slide.title.length;
  for (const shape of slide.shapes) {
    if (shape.kind === "line" || shape.kind === "image" || !shape.text)
      continue;
    const length = shapeTextLength(shape.text);
    const allowed = Math.max(0, Math.min(SHAPE_TEXT_MAX, left));
    if (length > allowed) {
      shape.text = cutText(shape.text, allowed);
      cut = true;
    }
    left -= Math.min(length, allowed);
  }
  return cut;
}
const MAX_SHAPES = 1000;

/** Level defaults from a master's text style: size, bullet and color. */
type LevelStyle = {
  size?: number;
  bullet?: "bullet" | "number" | "none";
  color?: string;
};

type Placeholder = {
  type: string;
  idx?: string;
  xfrm?: El;
  /** Its own list style: what text in it inherits, level by level. */
  lstStyle?: El;
  /** From the slide master rather than the layout. */
  master: boolean;
};

type Context = {
  parts: Map<string, Uint8Array>;
  theme: Theme;
  colorMap: Map<string, string>;
  /** Canvas px per EMU, and where the slide sits on the canvas. */
  k: number;
  dx: number;
  dy: number;
  bodyStyle: LevelStyle[];
  otherStyle: LevelStyle[];
  /** What text in a shape that is not a placeholder starts from. */
  shapeStyle: LevelStyle[];
  placeholders: Placeholder[];
  rels: Map<string, { target: string; type: string; external: boolean }>;
  saveImage: SaveImage;
  pictures: Map<string, string | null>;
  skip: (kind: string) => void;
};

const clean = (text: string) => text.replace(/\u0000/g, "");
const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));
const coord = (value: number) =>
  Math.round(clamp(value, -10000, 10000) * 100) / 100;
const length = (value: number) =>
  Math.round(clamp(value, 0, 10000) * 100) / 100;

function readLevels(
  style: El | undefined,
  ctx: Pick<Context, "theme" | "colorMap" | "k">
): LevelStyle[] {
  const levels: LevelStyle[] = [];
  for (let i = 1; i <= 9; i++) {
    const pPr = child(style, `a:lvl${i}pPr`);
    const rPr = child(pPr, "a:defRPr");
    const sz = num(rPr, "sz");
    levels.push({
      size: sz !== undefined ? (sz / 50) * ctx.k : undefined,
      bullet: child(pPr, "a:buNone")
        ? "none"
        : child(pPr, "a:buChar")
          ? "bullet"
          : child(pPr, "a:buAutoNum")
            ? "number"
            : undefined,
      color: readColor(child(rPr, "a:solidFill"), ctx.theme, ctx.colorMap),
    });
  }
  return levels;
}

/** Level styles laid over each other: later ones win where they say something. */
function mergeLevels(...layers: (LevelStyle[] | undefined)[]): LevelStyle[] {
  const out: LevelStyle[] = Array.from({ length: 9 }, () => ({}));
  for (const layer of layers) {
    layer?.forEach((level, i) => {
      if (level.size !== undefined) out[i].size = level.size;
      if (level.bullet !== undefined) out[i].bullet = level.bullet;
      if (level.color !== undefined) out[i].color = level.color;
    });
  }
  return out;
}

/** Sizes and bullets only: a shape's own style gives its text color. */
const withoutColor = (levels: LevelStyle[]): LevelStyle[] =>
  levels.map(({ size, bullet }) => ({ size, bullet }));

/** A shape's box from its <a:xfrm>, on the canvas. */
function boxOf(xfrm: El | undefined, ctx: Context, place: Place): Box | null {
  const off = child(xfrm, "a:off");
  const ext = child(xfrm, "a:ext");
  if (!off || !ext) return null;
  return place({
    x: (num(off, "x") ?? 0) / EMU,
    y: (num(off, "y") ?? 0) / EMU,
    w: (num(ext, "cx") ?? 0) / EMU,
    h: (num(ext, "cy") ?? 0) / EMU,
    rotation: (num(xfrm, "rot") ?? 0) / 60000,
  });
}

/** The slide's own placement: EMU to canvas px, centered for other sizes. */
function slidePlace(ctx: Context): Place {
  return (box) => ({
    x: box.x * ctx.k + ctx.dx,
    y: box.y * ctx.k + ctx.dy,
    w: box.w * ctx.k,
    h: box.h * ctx.k,
    rotation: box.rotation,
  });
}

/** A group's placement: its children's space mapped onto its own box. */
function groupPlace(group: El, outer: Place): Place {
  const xfrm = path(group, "p:grpSpPr", "a:xfrm");
  const off = child(xfrm, "a:off");
  const ext = child(xfrm, "a:ext");
  const chOff = child(xfrm, "a:chOff");
  const chExt = child(xfrm, "a:chExt");
  if (!off || !ext || !chOff || !chExt) return outer;
  const sx = (num(ext, "cx") ?? 0) / Math.max(1, num(chExt, "cx") ?? 1);
  const sy = (num(ext, "cy") ?? 0) / Math.max(1, num(chExt, "cy") ?? 1);
  const ox = (num(off, "x") ?? 0) / EMU;
  const oy = (num(off, "y") ?? 0) / EMU;
  const cx = (num(chOff, "x") ?? 0) / EMU;
  const cy = (num(chOff, "y") ?? 0) / EMU;
  return (box) =>
    outer({
      x: ox + (box.x - cx) * sx,
      y: oy + (box.y - cy) * sy,
      w: box.w * sx,
      h: box.h * sy,
      rotation: box.rotation,
    });
}

/** Text from a <p:txBody>, with defaults for what it leaves unset. */
function readText(
  txBody: El | undefined,
  ctx: Context,
  defaults: {
    levels?: LevelStyle[];
    color?: string;
    align?: Paragraph["align"];
    anchor?: TextBody["anchor"];
  }
): TextBody | undefined {
  if (!txBody) return undefined;
  const bodyPr = child(txBody, "a:bodyPr");
  const anchor = bodyPr?.attrs.anchor;
  const paragraphs: Paragraph[] = [];
  for (const p of children(txBody, "a:p").slice(0, 500)) {
    const pPr = child(p, "a:pPr");
    const level = clamp(num(pPr, "lvl") ?? 0, 0, 8);
    const style = defaults.levels?.[level];
    const runs: Run[] = [];
    const runStyle = (rPr: El | undefined): Omit<Run, "text"> => {
      const out: Omit<Run, "text"> = {};
      const sz = num(rPr, "sz");
      const size = sz !== undefined ? (sz / 50) * ctx.k : style?.size;
      if (size !== undefined)
        out.size = Math.round(clamp(size, 1, 800) * 100) / 100;
      const color =
        readColor(child(rPr, "a:solidFill"), ctx.theme, ctx.colorMap) ??
        style?.color ??
        defaults.color;
      if (color) out.color = color;
      if (rPr?.attrs.b === "1") out.bold = true;
      if (rPr?.attrs.i === "1") out.italic = true;
      if (rPr?.attrs.u && rPr.attrs.u !== "none") out.underline = true;
      if (rPr?.attrs.strike && rPr.attrs.strike !== "noStrike")
        out.strike = true;
      return out;
    };
    for (const el of p.children) {
      if (el.tag === "a:r" || el.tag === "a:fld") {
        const text = clean(textOf(child(el, "a:t"))).slice(0, 10000);
        if (text) runs.push({ ...runStyle(child(el, "a:rPr")), text });
      } else if (el.tag === "a:br") {
        runs.push({ ...runStyle(child(el, "a:rPr")), text: "\u000b" });
      }
    }
    if (runs.length === 0) {
      // An empty paragraph keeps its size, so the lines below stay put.
      const end = runStyle(child(p, "a:endParaRPr"));
      if (Object.keys(end).length > 0) runs.push({ ...end, text: "" });
    }
    const paragraph: Paragraph = { runs: runs.slice(0, 500) };
    const algn = pPr?.attrs.algn;
    const align =
      algn === "ctr"
        ? "center"
        : algn === "r"
          ? "right"
          : algn === "just" || algn === "dist"
            ? "justify"
            : algn === "l"
              ? "left"
              : defaults.align;
    if (align) paragraph.align = align;
    const bullet = child(pPr, "a:buNone")
      ? "none"
      : child(pPr, "a:buChar")
        ? "bullet"
        : child(pPr, "a:buAutoNum")
          ? "number"
          : style?.bullet;
    if (bullet && bullet !== "none") paragraph.bullet = bullet;
    if (level) paragraph.level = level;
    paragraphs.push(paragraph);
  }
  if (paragraphs.length === 0) return undefined;
  const body: TextBody = { paragraphs };
  const resolved =
    anchor === "ctr"
      ? "middle"
      : anchor === "b"
        ? "bottom"
        : anchor === "t"
          ? "top"
          : defaults.anchor;
  if (resolved) body.anchor = resolved;
  return body;
}

const hasText = (body: TextBody | undefined) =>
  body?.paragraphs.some((p) => p.runs.some((r) => r.text.trim() !== "")) ??
  false;

function readStroke(
  spPr: El | undefined,
  style: El | undefined,
  ctx: Context
): { color: string; width: number; dash?: "dash" | "dot" | "dashDot" } | null {
  const ln = child(spPr, "a:ln");
  if (child(ln, "a:noFill")) return null;
  const lnRef = child(style, "a:lnRef");
  const color =
    readColor(child(ln, "a:solidFill"), ctx.theme, ctx.colorMap) ??
    (lnRef && (num(lnRef, "idx") ?? 0) > 0
      ? readColor(lnRef, ctx.theme, ctx.colorMap)
      : undefined);
  if (!color) return null;
  const w = num(ln, "w");
  const width =
    Math.round(clamp(((w ?? 12700) / EMU) * ctx.k, 0, 200) * 100) / 100;
  const dashName = child(ln, "a:prstDash")?.attrs.val ?? "solid";
  const dash =
    /dot$/i.test(dashName) && !/dash/i.test(dashName)
      ? "dot"
      : /dashdot/i.test(dashName)
        ? "dashDot"
        : /dash/i.test(dashName)
          ? "dash"
          : undefined;
  return dash ? { color, width, dash } : { color, width };
}

function readFill(
  spPr: El | undefined,
  style: El | undefined,
  ctx: Context
): string | null {
  if (child(spPr, "a:noFill")) return null;
  const solid = readColor(child(spPr, "a:solidFill"), ctx.theme, ctx.colorMap);
  if (solid) return solid;
  const gradient = path(spPr, "a:gradFill", "a:gsLst", "a:gs");
  if (gradient) return readColor(gradient, ctx.theme, ctx.colorMap) ?? null;
  const fillRef = child(style, "a:fillRef");
  if (fillRef && (num(fillRef, "idx") ?? 0) > 0) {
    return readColor(fillRef, ctx.theme, ctx.colorMap) ?? null;
  }
  return null;
}

const ARROWS = new Set(["triangle", "arrow", "stealth", "oval", "diamond"]);

/** A connector end at a fixed point: where the preset's ends land, flipped and turned. */
function freeEnds(box: Box, flipH: boolean, flipV: boolean) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const r = (box.rotation * Math.PI) / 180;
  const at = (lx: number, ly: number) => {
    let x = lx - box.w / 2;
    let y = ly - box.h / 2;
    if (flipH) x = -x;
    if (flipV) y = -y;
    return {
      x: coord(cx + x * Math.cos(r) - y * Math.sin(r)),
      y: coord(cy + x * Math.sin(r) + y * Math.cos(r)),
    };
  };
  return { start: at(0, 0), end: at(box.w, box.h) };
}

type PendingLine = {
  shape: Extract<Shape, { kind: "line" }>;
  st?: { id: string; idx: number };
  end?: { id: string; idx: number };
};

/** One slide's shapes, from its shape tree. */
async function readShapes(
  tree: El,
  ctx: Context,
  place: Place,
  out: Shape[],
  ids: Map<string, Shape>,
  lines: PendingLine[],
  title: { text: string }
): Promise<void> {
  for (const el of tree.children) {
    if (out.length + lines.length >= MAX_SHAPES) {
      ctx.skip("over 1000 shapes");
      return;
    }
    switch (el.tag) {
      case "p:sp":
        await readSp(el, ctx, place, out, ids, lines, title);
        break;
      case "p:pic":
        await readPic(el, ctx, place, out, ids);
        break;
      case "p:cxnSp":
        readLine(el, ctx, place, lines, "p:nvCxnSpPr");
        break;
      case "p:grpSp":
        if (num(path(el, "p:grpSpPr", "a:xfrm"), "rot"))
          ctx.skip("turned group");
        await readShapes(
          el,
          ctx,
          groupPlace(el, place),
          out,
          ids,
          lines,
          title
        );
        break;
      case "p:graphicFrame":
        ctx.skip(
          /table/.test(
            JSON.stringify(path(el, "a:graphic", "a:graphicData")?.attrs ?? {})
          )
            ? "table"
            : "chart or diagram"
        );
        break;
      case "mc:AlternateContent": {
        // Newer content with an older equivalent: read the equivalent.
        const fallback = child(el, "mc:Fallback");
        if (fallback) {
          await readShapes(fallback, ctx, place, out, ids, lines, title);
        } else {
          ctx.skip("embedded content");
        }
        break;
      }
      default:
        break;
    }
  }
}

function readLine(
  el: El,
  ctx: Context,
  place: Place,
  lines: PendingLine[],
  nv: string
): void {
  const spPr = child(el, "p:spPr");
  const xfrm = child(spPr, "a:xfrm");
  const box = boxOf(xfrm, ctx, place);
  if (!box) return;
  const prst = child(spPr, "a:prstGeom")?.attrs.prst ?? "line";
  const route = prst.startsWith("bentConnector")
    ? "elbow"
    : prst.startsWith("curvedConnector")
      ? "curved"
      : "straight";
  const stroke = readStroke(spPr, child(el, "p:style"), ctx) ?? {
    color: "#000000",
    width: 2,
  };
  const ln = child(spPr, "a:ln");
  const head = child(ln, "a:headEnd")?.attrs.type;
  const tail = child(ln, "a:tailEnd")?.attrs.type;
  const ends = freeEnds(
    box,
    xfrm?.attrs.flipH === "1",
    xfrm?.attrs.flipV === "1"
  );
  const shape: Extract<Shape, { kind: "line" }> = {
    id: newId("ln"),
    kind: "line",
    route,
    start: ends.start,
    end: ends.end,
    stroke,
  };
  if (head && ARROWS.has(head))
    shape.startArrow = head as typeof shape.startArrow;
  if (tail && ARROWS.has(tail)) shape.endArrow = tail as typeof shape.endArrow;
  const cNv = path(el, nv, "p:cNvCxnSpPr");
  const glue = (tag: string) => {
    const c = child(cNv, tag);
    const id = c?.attrs.id;
    const idx = num(c, "idx");
    return id !== undefined && idx !== undefined ? { id, idx } : undefined;
  };
  lines.push({ shape, st: glue("a:stCxn"), end: glue("a:endCxn") });
}

/** Placeholders that hold text: the body, a subtitle, a content placeholder. */
const TEXT_PLACEHOLDERS = new Set(["body", "subTitle", "obj"]);

async function readSp(
  el: El,
  ctx: Context,
  place: Place,
  out: Shape[],
  ids: Map<string, Shape>,
  lines: PendingLine[],
  title: { text: string }
): Promise<void> {
  const nv = child(el, "p:nvSpPr");
  const ph = path(nv, "p:nvPr", "p:ph");
  const spPr = child(el, "p:spPr");
  const style = child(el, "p:style");
  const prst = child(spPr, "a:prstGeom")?.attrs.prst;
  const numericId = path(nv, "p:cNvPr")?.attrs.id;

  if (ph) {
    const type = ph.attrs.type ?? "obj";
    if (type === "title" || type === "ctrTitle") {
      const body = readText(child(el, "p:txBody"), ctx, {});
      const text = (body?.paragraphs ?? [])
        .map((p) =>
          p.runs
            .map((r) => r.text)
            .join("")
            .replace(/\u000b/g, "\n")
        )
        .join("\n")
        .trim();
      title.text = title.text ? `${title.text}\n${text}` : text;
      return;
    }
    if (["sldNum", "dt", "ftr", "hdr"].includes(type)) return;
    if (!TEXT_PLACEHOLDERS.has(type)) {
      ctx.skip(`placeholder (${type})`);
      return;
    }
    // Text and position come down from the master through the layout:
    // the layout's placeholder by index, then type; the master's by type
    // (content placeholders are the master's body).
    const masterType = type === "obj" || type === "subTitle" ? "body" : type;
    const layoutPh =
      ctx.placeholders.find(
        (p) => !p.master && ph.attrs.idx !== undefined && p.idx === ph.attrs.idx
      ) ?? ctx.placeholders.find((p) => !p.master && p.type === type);
    const masterPh = ctx.placeholders.find(
      (p) => p.master && p.type === masterType
    );
    const base = { theme: ctx.theme, colorMap: ctx.colorMap, k: ctx.k };
    const levels = mergeLevels(
      masterType === "body" ? ctx.bodyStyle : ctx.otherStyle,
      masterPh?.lstStyle && readLevels(masterPh.lstStyle, base),
      layoutPh?.lstStyle && readLevels(layoutPh.lstStyle, base),
      readLevels(path(el, "p:txBody", "a:lstStyle"), base)
    );
    const body = readText(child(el, "p:txBody"), ctx, {
      levels,
      align: "left",
      anchor: "top",
    });
    if (!hasText(body)) return;
    const inherited = layoutPh?.xfrm ? layoutPh : masterPh;
    const box = boxOf(child(spPr, "a:xfrm") ?? inherited?.xfrm, ctx, place);
    if (!box) {
      ctx.skip("placeholder without a position");
      return;
    }
    const shape: Shape = {
      id: newId("sh"),
      kind: "text",
      x: coord(box.x),
      y: coord(box.y),
      w: length(box.w),
      h: length(box.h),
      text: body!,
    };
    if (box.rotation) shape.rotation = clamp(box.rotation, -360, 360);
    out.push(shape);
    if (numericId) ids.set(numericId, shape);
    return;
  }

  if (prst === "line" || prst === "straightConnector1") {
    readLine(el, ctx, place, lines, "p:nvSpPr");
    return;
  }

  const box = boxOf(child(spPr, "a:xfrm"), ctx, place);
  if (!box) return;
  const textBox = path(nv, "p:cNvSpPr")?.attrs.txBox === "1";
  const kind =
    textBox && (!prst || prst === "rect")
      ? "text"
      : prst === "rect" || prst === "roundRect" || prst === "ellipse"
        ? prst
        : null;
  const fontRef = child(style, "a:fontRef");
  const textColor =
    readColor(fontRef, ctx.theme, ctx.colorMap) ??
    ctx.theme.get(ctx.colorMap.get("tx1") ?? "dk1");
  // PowerPoint's own defaults for shape text: top left, unless set.
  const body = readText(child(el, "p:txBody"), ctx, {
    levels: mergeLevels(
      ctx.shapeStyle,
      readLevels(path(el, "p:txBody", "a:lstStyle"), ctx)
    ),
    color: textColor,
    align: kind === "text" ? undefined : "left",
    anchor: kind === "text" ? undefined : "top",
  });

  if (!kind) {
    // Another preset or a freeform: its words are kept in a text box.
    ctx.skip(
      child(spPr, "a:custGeom") ? "freeform" : `shape (${prst ?? "unknown"})`
    );
    if (!hasText(body)) return;
  }
  const base = {
    id: newId("sh"),
    x: coord(box.x),
    y: coord(box.y),
    w: length(box.w),
    h: length(box.h),
    ...(box.rotation ? { rotation: clamp(box.rotation, -360, 360) } : {}),
  };
  let shape: Shape;
  if (!kind || kind === "text") {
    const fill = kind ? readFill(spPr, style, ctx) : null;
    const stroke = kind ? readStroke(spPr, style, ctx) : null;
    shape = {
      ...base,
      kind: "text",
      ...(fill ? { fill } : {}),
      ...(stroke ? { stroke } : {}),
      text: body ?? { paragraphs: [{ runs: [] }] },
    };
  } else {
    const fill = readFill(spPr, style, ctx);
    const stroke = readStroke(spPr, style, ctx);
    const common = {
      ...base,
      fill,
      stroke,
      ...(hasText(body) ? { text: body } : {}),
    };
    if (kind === "roundRect") {
      const gd = children(path(spPr, "a:prstGeom", "a:avLst"), "a:gd").find(
        (g) => g.attrs.name === "adj"
      );
      const adj = Number(/val\s+(-?\d+)/.exec(gd?.attrs.fmla ?? "")?.[1]);
      shape = {
        ...common,
        kind,
        corner: Number.isFinite(adj) ? clamp(adj / 100000, 0, 0.5) : 1 / 6,
      };
    } else {
      shape = { ...common, kind };
    }
  }
  out.push(shape);
  if (numericId) ids.set(numericId, shape);
}

async function readPic(
  el: El,
  ctx: Context,
  place: Place,
  out: Shape[],
  ids: Map<string, Shape>
): Promise<void> {
  const spPr = child(el, "p:spPr");
  const box = boxOf(child(spPr, "a:xfrm"), ctx, place);
  const embed = path(el, "p:blipFill", "a:blip")?.attrs["r:embed"];
  const rel = embed ? ctx.rels.get(embed) : undefined;
  if (!box || !rel || rel.external) {
    ctx.skip("linked picture");
    return;
  }
  let sha256 = ctx.pictures.get(rel.target);
  if (sha256 === undefined) {
    const bytes = ctx.parts.get(rel.target);
    sha256 = bytes ? ((await ctx.saveImage(bytes))?.sha256 ?? null) : null;
    ctx.pictures.set(rel.target, sha256);
  }
  if (!sha256) {
    ctx.skip("picture format");
    return;
  }
  if (child(path(el, "p:blipFill"), "a:srcRect")?.attrs) {
    const crop = child(path(el, "p:blipFill"), "a:srcRect")!.attrs;
    if (Object.values(crop).some((v) => Number(v) !== 0))
      ctx.skip("picture crop");
  }
  const stroke = readStroke(spPr, child(el, "p:style"), ctx);
  const shape: Shape = {
    id: newId("im"),
    kind: "image",
    x: coord(box.x),
    y: coord(box.y),
    w: length(box.w),
    h: length(box.h),
    asset: sha256,
    ...(box.rotation ? { rotation: clamp(box.rotation, -360, 360) } : {}),
    ...(stroke ? { stroke } : {}),
  };
  out.push(shape);
  const numericId = path(el, "p:nvPicPr", "p:cNvPr")?.attrs.id;
  if (numericId) ids.set(numericId, shape);
}

/** Our site (0 top, 1 left, 2 bottom, 3 right) for a PowerPoint site index. */
function siteFor(target: Shape, idx: number): number {
  // An ellipse lists eight sites counterclockwise from the top.
  if (target.kind === "ellipse") return Math.floor(((idx % 8) + 1) / 2) % 4;
  return ((idx % 4) + 4) % 4;
}

function placeholdersOf(tree: El | undefined, master: boolean): Placeholder[] {
  const out: Placeholder[] = [];
  for (const sp of children(tree, "p:sp")) {
    const ph = path(sp, "p:nvSpPr", "p:nvPr", "p:ph");
    if (!ph) continue;
    out.push({
      type: ph.attrs.type ?? "obj",
      idx: ph.attrs.idx,
      xfrm: path(sp, "p:spPr", "a:xfrm"),
      lstStyle: path(sp, "p:txBody", "a:lstStyle"),
      master,
    });
  }
  return out;
}

/** A .pptx file as a deck document and a report of what was left out. */
export async function importPptx(
  bytes: Uint8Array,
  saveImage: SaveImage,
  fallbackTitle = "匯入的簡報"
): Promise<ImportResult> {
  const started = Date.now();
  const parts = unzipPptx(bytes);
  // Every part takes its elements from one budget, so a file cannot add
  // up many capped parts into more than the server can hold.
  const budget: ElementBudget = { left: MAX_IMPORT_ELEMENTS };
  const read = (name: string | undefined): El | undefined => {
    const bytes = name ? parts.get(name) : undefined;
    return bytes ? parseXml(bytes, budget) : undefined;
  };
  // Layouts, masters and themes are shared by slides: each is parsed once
  // and kept. A slide's own tree is let go once the slide is read.
  const shared = new Map<string, El>();
  const xml = (name: string | undefined): El | undefined => {
    if (!name) return undefined;
    const cached = shared.get(name);
    if (cached) return cached;
    const el = read(name);
    if (el) shared.set(name, el);
    return el;
  };
  const relsCache = new Map<string, ReturnType<typeof relationships>>();
  const relsOf = (name: string) => {
    let rels = relsCache.get(name);
    if (!rels) {
      rels = relationships(parts, name);
      relsCache.set(name, rels);
    }
    return rels;
  };
  const presentationName = "ppt/presentation.xml";
  const presentation = xml(presentationName)!;
  const presentationRels = relsOf(presentationName);
  const size = child(presentation, "p:sldSz");
  const widthPx = (num(size, "cx") ?? 12192000) / EMU;
  const heightPx = (num(size, "cy") ?? 6858000) / EMU;
  const defaultTextStyle = child(presentation, "p:defaultTextStyle");
  const k = Math.min(1920 / widthPx, 1080 / heightPx);
  const dx = (1920 - widthPx * k) / 2;
  const dy = (1080 - heightPx * k) / 2;

  const skipped: Record<string, number> = {};
  const skip = (kind: string) => {
    skipped[kind] = (skipped[kind] ?? 0) + 1;
  };

  const slideIds = children(child(presentation, "p:sldIdLst"), "p:sldId");
  if (slideIds.length > MAX_SLIDES) skip("over 500 slides");
  const slides: Slide[] = [];
  const pictures = new Map<string, string | null>();
  let shapeCount = 0;

  const seen = new Set<string>();
  let text = 0;
  for (const sldId of slideIds.slice(0, MAX_SLIDES)) {
    if (Date.now() - started > TIME_BUDGET_MS) {
      throw new PptxError("too-large", "the file takes too long to read");
    }
    const rel = presentationRels.get(sldId.attrs["r:id"] ?? "");
    if (!rel || !parts.has(rel.target)) continue;
    // A slide part listed twice would make one small file a huge deck.
    if (seen.has(rel.target)) {
      skip("repeated slide");
      continue;
    }
    seen.add(rel.target);
    const slideXml = read(rel.target)!;
    const rels = relsOf(rel.target);
    const layoutName = [...rels.values()].find((r) =>
      r.type.endsWith("/slideLayout")
    )?.target;
    const layout = xml(layoutName);
    const masterName =
      layoutName &&
      [...relsOf(layoutName).values()].find((r) =>
        r.type.endsWith("/slideMaster")
      )?.target;
    const master = xml(masterName);
    const themeName =
      masterName &&
      [...relsOf(masterName).values()].find((r) => r.type.endsWith("/theme"))
        ?.target;
    const theme = readTheme(xml(themeName));
    const colorMap = readColorMap(child(master, "p:clrMap"));
    const base = { theme, colorMap, k };
    const otherStyle = readLevels(
      path(master, "p:txStyles", "p:otherStyle"),
      base
    );
    const ctx: Context = {
      parts,
      theme,
      colorMap,
      k,
      dx,
      dy,
      bodyStyle: readLevels(path(master, "p:txStyles", "p:bodyStyle"), base),
      otherStyle,
      // The presentation's defaults, then the master's for other text.
      shapeStyle: mergeLevels(
        withoutColor(readLevels(defaultTextStyle, base)),
        withoutColor(otherStyle)
      ),
      placeholders: [
        ...placeholdersOf(path(layout, "p:cSld", "p:spTree"), false),
        ...placeholdersOf(path(master, "p:cSld", "p:spTree"), true),
      ],
      rels,
      saveImage,
      pictures,
      skip,
    };

    const shapes: Shape[] = [];
    const ids = new Map<string, Shape>();
    const lines: PendingLine[] = [];
    const title = { text: "" };
    const tree = path(slideXml, "p:cSld", "p:spTree");
    if (tree)
      await readShapes(tree, ctx, slidePlace(ctx), shapes, ids, lines, title);

    // Connectors last, once the shapes they glue to have ids.
    for (const { shape, st, end } of lines) {
      for (const [side, glue] of [
        ["start", st],
        ["end", end],
      ] as const) {
        const target = glue && ids.get(glue.id);
        if (target && target.kind !== "line") {
          shape[side] = { shape: target.id, site: siteFor(target, glue.idx) };
        }
      }
      shapes.push(shape);
    }
    const slide: Slide = {
      id: newId("sl"),
      title: clean(title.text).slice(0, 500),
      shapes,
    };
    if (capText(slide)) skip("text over the limit");
    shapeCount += shapes.length;
    text += slideTextLength(slide);
    if (text > DECK_TEXT_MAX) {
      skip("text over the limit");
      break;
    }
    slides.push(slide);
  }
  if (slides.length === 0) {
    slides.push({ id: newId("sl"), title: "", shapes: [] });
  }

  const core = read("docProps/core.xml");
  const coreTitle = core ? textOf(child(core, "dc:title")).trim() : "";
  const documentTitle =
    clean(coreTitle || fallbackTitle)
      .trim()
      .slice(0, DECK_TITLE_MAX) || "匯入的簡報";

  const parsed = DeckDocument.safeParse({
    schema: SCHEMA_VERSION,
    title: documentTitle,
    slides,
  });
  if (!parsed.success) {
    throw new PptxError(
      "malformed",
      parsed.error.issues[0]?.message ?? "invalid deck"
    );
  }
  return {
    document: parsed.data,
    report: { slides: slides.length, shapes: shapeCount, skipped },
  };
}
