// The one renderer: a slide of the deck document to an SVG string. The editor
// and the public page inline it; the server rasterizes it for MCP snapshots
// (lib/render/png.ts). Text is laid out by lib/render/text.ts and every run is
// placed explicitly with textLength, so no renderer re-wraps or re-measures.
import {
  type Shape,
  type Slide,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  type TextBody,
} from "../deck/schema";
import { type Point, routeConnector } from "./connector";
import { DEFAULT_TEXT, SLIDE_NUMBER, TITLE } from "./template";
import {
  type Anchor,
  DEFAULT_INSET,
  layoutText,
  type Segment,
  type TextDefaults,
} from "./text";

/** Calibri's metric twin, for Latin runs. */
export const LATIN_FONT = "Carlito";
/** For CJK runs; PowerPoint on Windows uses Microsoft JhengHei instead. */
export const CJK_FONT = "Noto Sans TC";

export type RenderOptions = {
  /** 1-based, drawn in the template's slide number placeholder. */
  slideNumber: number;
  /** The template background's href; null draws a plain white slide. */
  background: string | null;
  /**
   * Leaves out the white base and the background, for a page that draws
   * them in a layer of its own so they are not rebuilt with every edit.
   */
  bare?: boolean;
  /** An image asset's href, or null to draw a placeholder in its place. */
  assetHref?: (sha256: string) => string | null;
};

type Box = { x: number; y: number; w: number; h: number };
type LineShape = Extract<Shape, { kind: "line" }>;
type StrokeSpec = NonNullable<Extract<Shape, { kind: "rect" }>["stroke"]>;

const num = (value: number) => String(Math.round(value * 100) / 100);

// Characters XML forbids (C0 controls but tab and newlines, U+FFFE, U+FFFF,
// lone surrogates): resvg refuses a document that contains one.
const NOT_XML =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

function esc(value: string): string {
  return value
    .replace(NOT_XML, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** `#rrggbbaa` as a color and an opacity, which every SVG renderer reads. */
function paint(attr: "fill" | "stroke", color: string): string {
  const rgb = color.slice(0, 7).toLowerCase();
  if (color.length === 9) {
    const alpha = parseInt(color.slice(7, 9), 16) / 255;
    return `${attr}="${rgb}" ${attr}-opacity="${num(alpha)}"`;
  }
  return `${attr}="${rgb}"`;
}

function strokeAttrs(stroke: StrokeSpec | null | undefined): string {
  if (!stroke || stroke.width <= 0) return 'stroke="none"';
  const w = stroke.width;
  const pattern =
    stroke.dash === "dash"
      ? [4, 3]
      : stroke.dash === "dot"
        ? [1, 1]
        : stroke.dash === "dashDot"
          ? [4, 3, 1, 3]
          : undefined;
  const dash = pattern
    ? ` stroke-dasharray="${pattern.map((d) => num(d * w)).join(" ")}"`
    : "";
  return `${paint("stroke", stroke.color)} stroke-width="${num(w)}"${dash}`;
}

function runSvg(segment: Segment, x0: number, y: number): string {
  const attrs = [
    `x="${num(x0 + segment.x)}"`,
    `y="${num(y)}"`,
    `font-size="${num(segment.size)}"`,
    paint("fill", segment.color),
  ];
  if (segment.script === "cjk") {
    attrs.unshift('class="cjk"');
    attrs.push(`font-family="${CJK_FONT}"`);
  }
  if (segment.bold) attrs.push('font-weight="700"');
  // CJK is never slanted: browsers would fake an oblique, resvg would not.
  if (segment.italic && segment.script === "latin") {
    attrs.push('font-style="italic"');
  }
  const decoration = [
    segment.underline && "underline",
    segment.strike && "line-through",
  ]
    .filter(Boolean)
    .join(" ");
  if (decoration) attrs.push(`text-decoration="${decoration}"`);
  if (segment.width > 0) {
    attrs.push(`textLength="${num(segment.width)}" lengthAdjust="spacing"`);
  }
  return `<text xml:space="preserve" ${attrs.join(" ")}>${esc(segment.text)}</text>`;
}

function textSvg(body: TextBody, box: Box, defaults: TextDefaults): string {
  const layout = layoutText(body, box, defaults);
  const parts: string[] = [];
  for (const line of layout.lines) {
    const y = box.y + layout.top + line.baseline;
    if (line.bullet) {
      parts.push(
        runSvg(
          {
            ...line.bullet,
            script: "latin",
            underline: false,
            strike: false,
            width: 0,
          },
          box.x,
          y
        )
      );
    }
    for (const segment of line.segments) parts.push(runSvg(segment, box.x, y));
  }
  return parts.join("");
}

function shapeText(
  body: TextBody | undefined,
  box: Box,
  align: TextDefaults["align"],
  anchor: Anchor
): string {
  if (!body) return "";
  return textSvg(body, box, {
    ...DEFAULT_TEXT,
    bold: false,
    align,
    anchor,
    inset: DEFAULT_INSET,
    wrap: true,
  });
}

function arrowSvg(
  kind: string | undefined,
  tip: Point,
  from: Point,
  stroke: StrokeSpec
): { svg: string; inset: number } {
  if (!kind || kind === "none") return { svg: "", inset: 0 };
  const length = Math.hypot(tip.x - from.x, tip.y - from.y) || 1;
  const d = { x: (tip.x - from.x) / length, y: (tip.y - from.y) / length };
  const n = { x: -d.y, y: d.x };
  const len = Math.max(10, stroke.width * 3);
  const half = Math.max(5, stroke.width * 1.5);
  const at = (along: number, across: number) =>
    `${num(tip.x - d.x * along + n.x * across)},${num(tip.y - d.y * along + n.y * across)}`;
  const fill = paint("fill", stroke.color);
  switch (kind) {
    case "triangle":
      return {
        svg: `<polygon points="${at(0, 0)} ${at(len, half)} ${at(len, -half)}" ${fill}/>`,
        inset: len * 0.9,
      };
    case "stealth":
      return {
        svg: `<polygon points="${at(0, 0)} ${at(len, half)} ${at(len * 0.6, 0)} ${at(len, -half)}" ${fill}/>`,
        inset: len * 0.5,
      };
    case "arrow":
      return {
        svg: `<polyline points="${at(len, half)} ${at(0, 0)} ${at(len, -half)}" fill="none" ${paint("stroke", stroke.color)} stroke-width="${num(stroke.width)}" stroke-linejoin="miter"/>`,
        inset: 0,
      };
    case "oval":
      return {
        svg: `<ellipse cx="${num(tip.x)}" cy="${num(tip.y)}" rx="${num(half)}" ry="${num(half)}" ${fill}/>`,
        inset: 0,
      };
    case "diamond":
      return {
        svg: `<polygon points="${at(-len / 2, 0)} ${at(0, half)} ${at(len / 2, 0)} ${at(0, -half)}" ${fill}/>`,
        inset: 0,
      };
    default:
      return { svg: "", inset: 0 };
  }
}

/** Pulls an end back by `by` along its segment, so a filled head covers it. */
function pullBack(tip: Point, from: Point, by: number): Point {
  const length = Math.hypot(tip.x - from.x, tip.y - from.y);
  if (by <= 0 || length <= by) return tip;
  return {
    x: tip.x - ((tip.x - from.x) / length) * by,
    y: tip.y - ((tip.y - from.y) / length) * by,
  };
}

function lineSvg(line: LineShape, shapes: ReadonlyMap<string, Shape>): string {
  const route = routeConnector(line, shapes);
  const pts = route.points.slice();
  const last = pts.length - 1;
  const endFrom = pts[last - 1];
  const startFrom = pts[1];
  const head = arrowSvg(line.endArrow, pts[last], endFrom, line.stroke);
  const tail = arrowSvg(line.startArrow, pts[0], startFrom, line.stroke);
  pts[last] = pullBack(pts[last], endFrom, head.inset);
  pts[0] = pullBack(pts[0], startFrom, tail.inset);
  const d =
    route.kind === "curve"
      ? `M${num(pts[0].x)},${num(pts[0].y)} C${pts
          .slice(1)
          .map((p) => `${num(p.x)},${num(p.y)}`)
          .join(" ")}`
      : `M${pts.map((p) => `${num(p.x)},${num(p.y)}`).join(" L")}`;
  return `<path d="${d}" fill="none" ${strokeAttrs(line.stroke)} stroke-linejoin="round"/>${tail.svg}${head.svg}`;
}

function shapeSvg(
  shape: Shape,
  shapes: ReadonlyMap<string, Shape>,
  options: RenderOptions
): string {
  if (shape.kind === "line") return lineSvg(shape, shapes);

  const box = { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
  const frame = `x="${num(box.x)}" y="${num(box.y)}" width="${num(box.w)}" height="${num(box.h)}"`;
  let body: string;
  switch (shape.kind) {
    case "rect":
    case "roundRect": {
      const r =
        shape.kind === "roundRect"
          ? (shape.corner ?? 1 / 6) * Math.min(box.w, box.h)
          : 0;
      const radius = r > 0 ? ` rx="${num(r)}" ry="${num(r)}"` : "";
      const fill = shape.fill ? paint("fill", shape.fill) : 'fill="none"';
      body =
        `<rect ${frame}${radius} ${fill} ${strokeAttrs(shape.stroke)}/>` +
        shapeText(shape.text, box, "center", "middle");
      break;
    }
    case "ellipse": {
      const fill = shape.fill ? paint("fill", shape.fill) : 'fill="none"';
      body =
        `<ellipse cx="${num(box.x + box.w / 2)}" cy="${num(box.y + box.h / 2)}" rx="${num(box.w / 2)}" ry="${num(box.h / 2)}" ${fill} ${strokeAttrs(shape.stroke)}/>` +
        shapeText(shape.text, box, "center", "middle");
      break;
    }
    case "text": {
      const frameSvg =
        shape.fill || shape.stroke
          ? `<rect ${frame} ${shape.fill ? paint("fill", shape.fill) : 'fill="none"'} ${strokeAttrs(shape.stroke)}/>`
          : "";
      body = frameSvg + shapeText(shape.text, box, "left", "top");
      break;
    }
    case "image": {
      const href = options.assetHref?.(shape.asset) ?? null;
      body = href
        ? `<image href="${esc(href)}" ${frame} preserveAspectRatio="none"/>`
        : `<rect ${frame} fill="#e5e5e5" stroke="#a3a3a3" stroke-width="2"/>`;
      if (shape.stroke) {
        body += `<rect ${frame} fill="none" ${strokeAttrs(shape.stroke)}/>`;
      }
      break;
    }
  }
  const rotation = shape.rotation ?? 0;
  if (!rotation) return body;
  const cx = num(box.x + box.w / 2);
  const cy = num(box.y + box.h / 2);
  return `<g transform="rotate(${num(rotation)} ${cx} ${cy})">${body}</g>`;
}

/** One slide as a standalone SVG document, 1920 x 1080 user units. */
export function renderSlideSvg(slide: Slide, options: RenderOptions): string {
  const shapes = new Map(slide.shapes.map((shape) => [shape.id, shape]));
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SLIDE_WIDTH} ${SLIDE_HEIGHT}" width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}" font-family="${LATIN_FONT}">`,
  ];
  if (!options.bare) {
    parts.push(
      `<rect width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}" fill="#ffffff"/>`
    );
  }
  if (options.background && !options.bare) {
    parts.push(
      `<image href="${esc(options.background)}" width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}" preserveAspectRatio="none"/>`
    );
  }
  if (slide.title) {
    parts.push(
      textSvg({ paragraphs: [{ runs: [{ text: slide.title }] }] }, TITLE.box, {
        size: TITLE.size,
        color: TITLE.color,
        bold: TITLE.bold,
        align: "center",
        anchor: "middle",
        inset: TITLE.inset,
        wrap: true,
      })
    );
  }
  for (const shape of slide.shapes)
    parts.push(shapeSvg(shape, shapes, options));
  parts.push(
    textSvg(
      { paragraphs: [{ runs: [{ text: String(options.slideNumber) }] }] },
      SLIDE_NUMBER.box,
      {
        size: SLIDE_NUMBER.size,
        color: SLIDE_NUMBER.color,
        bold: SLIDE_NUMBER.bold,
        align: "right",
        anchor: "middle",
        inset: SLIDE_NUMBER.inset,
        wrap: false,
      }
    )
  );
  parts.push("</svg>");
  return parts.join("");
}
