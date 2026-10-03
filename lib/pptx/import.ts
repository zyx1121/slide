// A .pptx as a deck document: the reverse of export.ts. Slides keep their
// title; rectangles, rounded rectangles, ellipses, text boxes, text
// placeholders, lines, connectors with their glue and pictures come across
// as shapes, groups are flattened. Anything else is skipped and counted in
// the report: tables, charts, freeforms without text, pictures in formats
// the editor cannot draw.
import { newId } from "../ids";
import {
  DeckDocument,
  PresetGeometry,
  SCHEMA_VERSION,
  type Shape,
  type Slide,
  type TextBody,
} from "../deck/schema";
import { DECK_TITLE_MAX, SHAPE_TEXT_MAX, SLIDE_TEXT_MAX } from "../deck/limits";
import { formatPath, type PathCommand, PATH_UNITS } from "../deck/path";
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
    bold?: boolean;
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
      if (rPr?.attrs.b === "1" || (defaults.bold && rPr?.attrs.b !== "0"))
        out.bold = true;
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
type Fraction = { x: number; y: number };

/**
 * The free ends of a line in its box: corner to corner, or `along` two
 * points given as fractions of the box (a freeform's one segment).
 */
function freeEnds(
  box: Box,
  flipH: boolean,
  flipV: boolean,
  along: [Fraction, Fraction] = [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ]
) {
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
  const [from, to] = along;
  return {
    start: at(from.x * box.w, from.y * box.h),
    end: at(to.x * box.w, to.y * box.h),
  };
}

/**
 * A freeform that is one straight segment (a moveTo and a lnTo), as two
 * points in fractions of its box; null for any other freeform.
 */
function straightPath(spPr: El | undefined): [Fraction, Fraction] | null {
  const paths = children(path(spPr, "a:custGeom", "a:pathLst"), "a:path");
  if (paths.length !== 1) return null;
  const [move, to, ...rest] = paths[0].children;
  if (rest.length || move?.tag !== "a:moveTo" || to?.tag !== "a:lnTo") {
    return null;
  }
  const w = num(paths[0], "w") ?? 0;
  const h = num(paths[0], "h") ?? 0;
  const at = (command: El): Fraction => {
    const pt = child(command, "a:pt");
    return {
      x: w > 0 ? clamp((num(pt, "x") ?? 0) / w, 0, 1) : 0,
      y: h > 0 ? clamp((num(pt, "y") ?? 0) / h, 0, 1) : 0,
    };
  };
  return [at(move), at(to)];
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
        if (path(el, "a:graphic", "a:graphicData", "a:tbl")) {
          readTable(el, ctx, place, out);
        } else {
          ctx.skip("chart or diagram");
        }
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

/** PowerPoint's default table style, Medium Style 2 - Accent 1. */
const MEDIUM_STYLE_2 = "{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}";

/** A theme color with a tint, as a table style names it. */
function themeTint(ctx: Context, name: string, tint?: number) {
  const holder: El = {
    tag: "a:solidFill",
    attrs: {},
    text: "",
    children: [
      {
        tag: "a:schemeClr",
        attrs: { val: name },
        text: "",
        children: tint
          ? [
              {
                tag: "a:tint",
                attrs: { val: String(tint) },
                text: "",
                children: [],
              },
            ]
          : [],
      },
    ],
  };
  return readColor(holder, ctx.theme, ctx.colorMap);
}

/**
 * A table as one rectangle per cell, with its text, so its words stay
 * editable. Merged cells span their rows and columns. PowerPoint's default
 * style is drawn (an accent header, banded rows, white rules); cells of other
 * styles keep only their own fills, with a thin rule, and are reported.
 */
function readTable(el: El, ctx: Context, place: Place, out: Shape[]): void {
  const tbl = path(el, "a:graphic", "a:graphicData", "a:tbl")!;
  const frame = boxOf(child(el, "p:xfrm"), ctx, (box) => box);
  if (!frame) {
    ctx.skip("table without a position");
    return;
  }
  const tblPr = child(tbl, "a:tblPr");
  const styled =
    textOf(child(tblPr, "a:tableStyleId")).trim() === MEDIUM_STYLE_2 ||
    !child(tblPr, "a:tableStyleId");
  if (!styled) ctx.skip("table style");
  const firstRow = tblPr?.attrs.firstRow === "1";
  const bandRow = tblPr?.attrs.bandRow === "1";

  const cols = children(child(tbl, "a:tblGrid"), "a:gridCol").map(
    (col) => (num(col, "w") ?? 0) / EMU
  );
  const rows = children(tbl, "a:tr").slice(0, 200);
  // Rows grow with their text in PowerPoint; the frame holds the grown size,
  // so the stated heights are stretched to fill it.
  const stated = rows.map((row) => (num(row, "h") ?? 0) / EMU);
  const total = stated.reduce((a, b) => a + b, 0);
  const stretch = total > 0 && frame.h > total ? frame.h / total : 1;
  const heights = stated.map((h) => h * stretch);
  const xs = [frame.x];
  for (const w of cols) xs.push(xs[xs.length - 1] + w);
  const ys = [frame.y];
  for (const h of heights) ys.push(ys[ys.length - 1] + h);

  const accent = themeTint(ctx, "accent1");
  const light = themeTint(ctx, "lt1") ?? "#ffffff";
  const dark = ctx.theme.get(ctx.colorMap.get("tx1") ?? "dk1") ?? "#000000";
  const rule = styled
    ? { color: light, width: 2 }
    : { color: "#a3a3a3", width: 1 };

  rows.forEach((row, r) => {
    const header = firstRow && r === 0;
    const body = r - (firstRow ? 1 : 0);
    let col = 0;
    for (const tc of children(row, "a:tc")) {
      const span = Math.max(1, num(tc, "gridSpan") ?? 1);
      const rowSpan = Math.max(1, num(tc, "rowSpan") ?? 1);
      const at = col;
      col += 1;
      // Cells covered by a merge hold nothing of their own.
      if (tc.attrs.hMerge === "1" || tc.attrs.vMerge === "1") continue;
      if (at >= cols.length) continue;
      if (out.length >= MAX_SHAPES) {
        ctx.skip("over 1000 shapes");
        return;
      }
      const tcPr = child(tc, "a:tcPr");
      const own = readColor(
        child(tcPr, "a:solidFill"),
        ctx.theme,
        ctx.colorMap
      );
      const styleFill = !styled
        ? undefined
        : header
          ? accent
          : themeTint(
              ctx,
              "accent1",
              bandRow && body % 2 === 0 ? 40000 : 20000
            );
      const fill = child(tcPr, "a:noFill") ? null : (own ?? styleFill ?? null);
      const box = place({
        x: xs[at],
        y: ys[r],
        w: xs[Math.min(at + span, cols.length)] - xs[at],
        h: ys[Math.min(r + rowSpan, rows.length)] - ys[r],
        rotation: 0,
      });
      const anchor = tcPr?.attrs.anchor;
      const text = readText(child(tc, "a:txBody"), ctx, {
        levels: ctx.shapeStyle,
        color: header && styled ? light : dark,
        // The style's header is bold unless a run says otherwise.
        bold: header && styled,
        align: "left",
        anchor: anchor === "ctr" ? "middle" : anchor === "b" ? "bottom" : "top",
      });
      out.push({
        id: newId("sh"),
        kind: "rect",
        x: coord(box.x),
        y: coord(box.y),
        w: length(box.w),
        h: length(box.h),
        fill,
        stroke: rule,
        ...(hasText(text) ? { text: text! } : {}),
      });
    }
  });
}

function readLine(
  el: El,
  ctx: Context,
  place: Place,
  lines: PendingLine[],
  nv: string,
  along?: [Fraction, Fraction]
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
    xfrm?.attrs.flipV === "1",
    along
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

/**
 * A freeform's outline from its <a:pathLst>, in 0 to 1000 units across its
 * box with flips applied, or null when a point is not a plain number (a
 * guide formula) or nothing is drawn. Arcs become cubic curves.
 */
function readFreeform(
  pathLst: El | undefined,
  cx: number,
  cy: number,
  flipH: boolean,
  flipV: boolean
): { path: string; filled: boolean } | null {
  const paths = children(pathLst, "a:path");
  if (paths.length === 0) return null;
  const commands: PathCommand[] = [];
  let filled = false;
  for (const p of paths) {
    // Path coordinates span w and h; without them, the shape's size in EMU.
    const w = num(p, "w") || cx;
    const h = num(p, "h") || cy;
    if (!(w > 0) && !(h > 0)) return null;
    const norm = (x: number, y: number): [number, number] => {
      const u = w > 0 ? clamp((x / w) * PATH_UNITS, 0, PATH_UNITS) : 0;
      const v = h > 0 ? clamp((y / h) * PATH_UNITS, 0, PATH_UNITS) : 0;
      return [flipH ? PATH_UNITS - u : u, flipV ? PATH_UNITS - v : v];
    };
    if (p.attrs.fill !== "none") filled = true;
    let current: [number, number] = [0, 0];
    for (const c of p.children) {
      const pts: [number, number][] = [];
      for (const pt of children(c, "a:pt")) {
        const x = Number(pt.attrs.x);
        const y = Number(pt.attrs.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        pts.push([x, y]);
      }
      const op = {
        "a:moveTo": "M",
        "a:lnTo": "L",
        "a:cubicBezTo": "C",
        "a:quadBezTo": "Q",
      }[c.tag] as "M" | "L" | "C" | "Q" | undefined;
      if (op) {
        if (pts.length !== { M: 1, L: 1, C: 3, Q: 2 }[op]) return null;
        commands.push({ op, points: pts.map(([x, y]) => norm(x, y)) });
        current = pts[pts.length - 1];
      } else if (c.tag === "a:close") {
        commands.push({ op: "Z", points: [] });
      } else if (c.tag === "a:arcTo") {
        const [wR, hR, stAng, swAng] = ["wR", "hR", "stAng", "swAng"].map(
          (name) => Number(c.attrs[name])
        );
        if (![wR, hR, stAng, swAng].every(Number.isFinite)) return null;
        for (const curve of arcCurves(current, wR, hR, stAng, swAng)) {
          commands.push({ op: "C", points: curve.map(([x, y]) => norm(x, y)) });
          current = curve[2];
        }
      }
      if (commands.length > 2000) return null;
    }
  }
  if (commands.length < 2 || commands[0].op !== "M") return null;
  return { path: formatPath(commands), filled };
}

/**
 * Cubic curves along DrawingML's arcTo from `from`: an ellipse of radii wR
 * and hR, from angle stAng through swAng (60,000ths of a degree, measured
 * as seen, so turned into the ellipse's own angles first).
 */
function arcCurves(
  from: [number, number],
  wR: number,
  hR: number,
  stAng: number,
  swAng: number
): [number, number][][] {
  const rad = (a: number) => ((a / 60000) * Math.PI) / 180;
  const param = (a: number) => Math.atan2(wR * Math.sin(a), hR * Math.cos(a));
  const sweep = clamp(rad(swAng), -2 * Math.PI, 2 * Math.PI);
  const t0 = param(rad(stAng));
  let t1 = param(rad(stAng) + sweep);
  if (Math.abs(sweep) >= 2 * Math.PI - 1e-9) t1 = t0 + sweep;
  else if (sweep > 0) while (t1 < t0) t1 += 2 * Math.PI;
  else while (t1 > t0) t1 -= 2 * Math.PI;
  const center = [from[0] - wR * Math.cos(t0), from[1] - hR * Math.sin(t0)];
  const at = (t: number): [number, number] => [
    center[0] + wR * Math.cos(t),
    center[1] + hR * Math.sin(t),
  ];
  const n = Math.max(1, Math.ceil(Math.abs(t1 - t0) / (Math.PI / 2)));
  const step = (t1 - t0) / n;
  const k = (4 / 3) * Math.tan(step / 4);
  const curves: [number, number][][] = [];
  for (let i = 0; i < n; i++) {
    const a = t0 + i * step;
    const b = a + step;
    const p0 = at(a);
    const p3 = at(b);
    curves.push([
      [p0[0] - k * wR * Math.sin(a), p0[1] + k * hR * Math.cos(a)],
      [p3[0] + k * wR * Math.sin(b), p3[1] - k * hR * Math.cos(b)],
      p3,
    ]);
  }
  return curves;
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
  // A freeform drawn as one straight segment is a line, often with an arrow.
  const segment = straightPath(spPr);
  if (segment && !hasText(readText(child(el, "p:txBody"), ctx, {}))) {
    readLine(el, ctx, place, lines, "p:nvSpPr", segment);
    return;
  }

  const box = boxOf(child(spPr, "a:xfrm"), ctx, place);
  if (!box) return;
  const textBox = path(nv, "p:cNvSpPr")?.attrs.txBox === "1";
  const geometry = PresetGeometry.safeParse(prst).data;
  const xfrm = child(spPr, "a:xfrm");
  const freeform = readFreeform(
    path(spPr, "a:custGeom", "a:pathLst"),
    num(child(xfrm, "a:ext"), "cx") ?? 0,
    num(child(xfrm, "a:ext"), "cy") ?? 0,
    xfrm?.attrs.flipH === "1",
    xfrm?.attrs.flipV === "1"
  );
  const kind =
    textBox && (!prst || prst === "rect")
      ? "text"
      : prst === "rect" || prst === "roundRect" || prst === "ellipse"
        ? prst
        : geometry
          ? "preset"
          : freeform
            ? "freeform"
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
    } else if (kind === "preset") {
      shape = { ...common, kind, geometry: geometry! };
    } else if (kind === "freeform") {
      shape = {
        ...common,
        kind,
        // Outlines only (every path fill="none") are not filled.
        fill: freeform!.filled ? common.fill : null,
        path: freeform!.path,
      };
    } else {
      shape = { ...common, kind };
    }
  }
  out.push(shape);
  if (numericId) ids.set(numericId, shape);
}

/**
 * A picture's crop from its <a:srcRect>. Negative sides, which pad the
 * picture with empty space, and crops that keep almost nothing are left out.
 */
function readCrop(
  srcRect: El | undefined,
  ctx: Context
): Extract<Shape, { kind: "image" }>["crop"] {
  const side = (name: string) => (num(srcRect, name) ?? 0) / 100000;
  const [left, top, right, bottom] = ["l", "t", "r", "b"].map(side);
  if ([left, top, right, bottom].every((s) => s === 0)) return undefined;
  if (
    [left, top, right, bottom].some((s) => !(s >= 0)) ||
    left + right > 0.99 ||
    top + bottom > 0.99
  ) {
    ctx.skip("picture crop");
    return undefined;
  }
  const round = (s: number) => Math.round(s * 100000) / 100000;
  return {
    left: round(left),
    top: round(top),
    right: round(right),
    bottom: round(bottom),
  };
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
  const crop = readCrop(child(path(el, "p:blipFill"), "a:srcRect"), ctx);
  const stroke = readStroke(spPr, child(el, "p:style"), ctx);
  const shape: Shape = {
    id: newId("im"),
    kind: "image",
    x: coord(box.x),
    y: coord(box.y),
    w: length(box.w),
    h: length(box.h),
    asset: sha256,
    ...(crop ? { crop } : {}),
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
