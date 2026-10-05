// The one renderer: a slide of the deck document to an SVG string. The editor
// and the public page inline it; the server rasterizes it for MCP snapshots
// (lib/render/png.ts). Text is laid out by lib/render/text.ts and every run is
// placed explicitly with textLength, so no renderer re-wraps or re-measures.
import {
  type Fill,
  type Layout,
  type Placeholder,
  type Shape,
  type Slide,
  SLIDE_HEIGHT,
  SLIDE_WIDTH,
  type TextBody,
} from "../deck/schema";
import { type Point, routeConnector } from "./connector";
import { presetPath } from "./preset";
import { parsePath, PATH_UNITS } from "../deck/path";
import {
  DEFAULT_INSET,
  DEFAULT_TEXT,
  layoutText,
  type Segment,
  type TextDefaults,
} from "./text";

/** Calibri's metric twin, for Latin runs. */
export const LATIN_FONT = "Carlito";
/** For CJK runs; PowerPoint on Windows uses Microsoft JhengHei instead. */
export const CJK_FONT = "Noto Sans TC";
/** For emoji on the server; browsers draw their own color emoji instead. */
export const EMOJI_FONT = "Noto Emoji";

export type RenderOptions = {
  /** 1-based, drawn in the layout's slide number placeholder. */
  slideNumber: number;
  /** The slide's layout: background, artwork, title and slide number. */
  layout: Layout;
  /**
   * Leaves out the white base, the background and the artwork, for a page
   * that draws them in a layer of its own (renderBackdropSvg) so they are
   * not rebuilt with every edit.
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
  } else if (segment.script === "emoji") {
    attrs.push(`font-family="${EMOJI_FONT}"`);
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

/** Shapes that hold text: everything but connectors and pictures. */
export type TextShape = Extract<
  Shape,
  { kind: "rect" | "roundRect" | "ellipse" | "preset" | "freeform" | "text" }
>;

export const holdsText = (shape: Shape): shape is TextShape =>
  shape.kind !== "line" && shape.kind !== "image";

/**
 * How a shape's text is laid out: text boxes start at the top left, text in
 * a shape sits in its middle. The editor lays text out with the same values.
 */
export function shapeTextDefaults(kind: TextShape["kind"]): TextDefaults {
  const box = kind === "text";
  return {
    ...DEFAULT_TEXT,
    bold: false,
    align: box ? "left" : "center",
    anchor: box ? "top" : "middle",
    inset: DEFAULT_INSET,
    wrap: true,
  };
}

/** How a title placeholder lays out a title, at its full size. */
export const placeholderText = (placeholder: Placeholder): TextDefaults => ({
  size: placeholder.size,
  color: placeholder.color,
  bold: placeholder.bold,
  align: placeholder.align,
  anchor: placeholder.anchor,
  inset: placeholder.inset,
  wrap: true,
});

/** A placeholder's box. */
export const placeholderBox = (placeholder: Placeholder): Box => ({
  x: placeholder.x,
  y: placeholder.y,
  w: placeholder.w,
  h: placeholder.h,
});

/**
 * The font scales a title may take: titles autofit (normAutofit), so a
 * title too long for its placeholder shrinks instead of wrapping out of it,
 * down to half its size.
 */
export const TITLE_SCALES = [1, 0.9, 0.8, 0.7, 0.6, 0.5];

/** The largest of TITLE_SCALES at which the title fits its placeholder. */
export function titleScale(title: string, placeholder: Placeholder): number {
  const text = placeholderText(placeholder);
  for (const scale of TITLE_SCALES) {
    const layout = layoutText(titleBody(title), placeholderBox(placeholder), {
      ...text,
      size: placeholder.size * scale,
    });
    if (layout.height + 2 * text.inset.y <= placeholder.h + 0.5) {
      return scale;
    }
  }
  return TITLE_SCALES[TITLE_SCALES.length - 1];
}

/** How a title is laid out in its placeholder, shrunk to fit. */
export function titleText(
  title: string,
  placeholder: Placeholder
): TextDefaults {
  return {
    ...placeholderText(placeholder),
    size: placeholder.size * titleScale(title, placeholder),
  };
}

/** A slide title as the text body the title placeholder draws. */
export const titleBody = (title: string): TextBody => ({
  paragraphs: [{ runs: [{ text: title }] }],
});

function shapeText(shape: TextShape, box: Box): string {
  if (!shape.text) return "";
  return textSvg(shape.text, box, shapeTextDefaults(shape.kind));
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
      const [defs, fill] = fillPaint(shape.fill, box);
      body =
        defs +
        `<rect ${frame}${radius} ${fill} ${strokeAttrs(shape.stroke)}/>` +
        shapeText(shape, box);
      break;
    }
    case "ellipse": {
      const [defs, fill] = fillPaint(shape.fill, box);
      body =
        defs +
        `<ellipse cx="${num(box.x + box.w / 2)}" cy="${num(box.y + box.h / 2)}" rx="${num(box.w / 2)}" ry="${num(box.h / 2)}" ${fill} ${strokeAttrs(shape.stroke)}/>` +
        shapeText(shape, box);
      break;
    }
    case "preset": {
      const outline = presetPath(shape.geometry, box);
      const [defs, fill] = fillPaint(shape.fill, box);
      body =
        defs +
        (outline.stroke
          ? `<path d="${outline.fill}" ${fill} stroke="none"/><path d="${outline.stroke}" fill="none" ${strokeAttrs(shape.stroke)}/>`
          : `<path d="${outline.fill}" ${fill} ${strokeAttrs(shape.stroke)}/>`);
      if (shape.flipH || shape.flipV) {
        // Mirrored about the box's center; its text reads as usual.
        const cx = num(box.x + box.w / 2);
        const cy = num(box.y + box.h / 2);
        body = `<g transform="translate(${cx} ${cy}) scale(${shape.flipH ? -1 : 1} ${shape.flipV ? -1 : 1}) translate(${-cx} ${-cy})">${body}</g>`;
      }
      body += shapeText(shape, box);
      break;
    }
    case "freeform": {
      // The outline's 0 to 1000 units stretched over the box.
      const commands = parsePath(shape.path) ?? [];
      const d = commands
        .map((c) =>
          [
            c.op,
            ...c.points.map(
              ([px, py]) =>
                `${num(box.x + (px / PATH_UNITS) * box.w)} ${num(box.y + (py / PATH_UNITS) * box.h)}`
            ),
          ].join(" ")
        )
        .join(" ");
      const [defs, fill] = fillPaint(shape.fill, box);
      body =
        defs +
        `<path d="${d}" ${fill} ${strokeAttrs(shape.stroke)} stroke-linejoin="round"/>` +
        shapeText(shape, box);
      break;
    }
    case "text": {
      const [defs, fill] = fillPaint(shape.fill, box);
      const frameSvg =
        shape.fill || shape.stroke
          ? `${defs}<rect ${frame} ${fill} ${strokeAttrs(shape.stroke)}/>`
          : "";
      body = frameSvg + shapeText(shape, box);
      break;
    }
    case "image": {
      const href = options.assetHref?.(shape.asset) ?? null;
      const crop = shape.crop;
      if (href && crop) {
        // The whole picture, sized so its kept part fills the box, seen
        // through a viewport the size of the box.
        const w = box.w / (1 - crop.left - crop.right);
        const h = box.h / (1 - crop.top - crop.bottom);
        body =
          `<svg ${frame} viewBox="0 0 ${num(box.w)} ${num(box.h)}" preserveAspectRatio="none">` +
          `<image href="${esc(href)}" x="${num(-crop.left * w)}" y="${num(-crop.top * h)}" width="${num(w)}" height="${num(h)}" preserveAspectRatio="none"/></svg>`;
      } else {
        body = href
          ? `<image href="${esc(href)}" ${frame} preserveAspectRatio="none"/>`
          : `<rect ${frame} fill="#e5e5e5" stroke="#a3a3a3" stroke-width="2"/>`;
      }
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

/** A short, stable id for a definition, from what it defines. */
function defId(prefix: string, value: string): string {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  }
  return `${prefix}-${(h >>> 0).toString(36)}`;
}

/**
 * A fill over a box, as SVG definitions to put before the element and the
 * element's fill attribute: one color, or a linear gradient along its angle
 * spanning the box's extent in that direction, as DrawingML does.
 */
function fillPaint(fill: Fill | null | undefined, box: Box): [string, string] {
  if (!fill) return ["", 'fill="none"'];
  if (typeof fill === "string") return ["", paint("fill", fill)];
  const angle = (fill.angle * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const half = (box.w * Math.abs(cos) + box.h * Math.abs(sin)) / 2;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const stops = fill.stops
    .map((stop) => {
      const alpha =
        stop.color.length > 7 ? parseInt(stop.color.slice(7, 9), 16) / 255 : 1;
      return `<stop offset="${num(stop.at)}" stop-color="${stop.color.slice(0, 7)}"${
        alpha < 1 ? ` stop-opacity="${num(alpha)}"` : ""
      }/>`;
    })
    .join("");
  const x1 = num(cx - cos * half);
  const y1 = num(cy - sin * half);
  const x2 = num(cx + cos * half);
  const y2 = num(cy + sin * half);
  // Ids are shared by every SVG on a page, so one names what it defines.
  const id = defId("gr", `${x1} ${y1} ${x2} ${y2} ${stops}`);
  return [
    `<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stops}</linearGradient></defs>`,
    `fill="url(#${id})"`,
  ];
}

/** A background filling the slide. */
function backgroundSvg(fill: Fill): string {
  const [defs, attr] = fillPaint(fill, {
    x: 0,
    y: 0,
    w: SLIDE_WIDTH,
    h: SLIDE_HEIGHT,
  });
  return `${defs}<rect width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}" ${attr}/>`;
}

/** A layout's background and artwork, under the slide's own shapes. */
function backdropParts(layout: Layout, options: RenderOptions): string[] {
  const parts = [
    `<rect width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}" fill="#ffffff"/>`,
  ];
  if (layout.background) parts.push(backgroundSvg(layout.background));
  const shapes = new Map(layout.shapes.map((shape) => [shape.id, shape]));
  for (const shape of layout.shapes) {
    parts.push(shapeSvg(shape, shapes, options));
  }
  return parts;
}

const open = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SLIDE_WIDTH} ${SLIDE_HEIGHT}" width="${SLIDE_WIDTH}" height="${SLIDE_HEIGHT}" font-family="${LATIN_FONT}">`;

/**
 * A layout's background and artwork alone, as a standalone SVG document:
 * the layer a page draws once under bare slides.
 */
export function renderBackdropSvg(
  layout: Layout,
  options: Pick<RenderOptions, "assetHref">
): string {
  return [
    open,
    ...backdropParts(layout, { slideNumber: 0, layout, ...options }),
    "</svg>",
  ].join("");
}

/** One slide as a standalone SVG document, 1920 x 1080 user units. */
export function renderSlideSvg(slide: Slide, options: RenderOptions): string {
  const { layout } = options;
  const shapes = new Map(slide.shapes.map((shape) => [shape.id, shape]));
  const parts = [open];
  if (!options.bare) parts.push(...backdropParts(layout, options));
  if (slide.title && layout.title) {
    parts.push(
      textSvg(
        titleBody(slide.title),
        placeholderBox(layout.title),
        titleText(slide.title, layout.title)
      )
    );
  }
  for (const shape of slide.shapes)
    parts.push(shapeSvg(shape, shapes, options));
  if (layout.number) {
    parts.push(
      textSvg(
        { paragraphs: [{ runs: [{ text: String(options.slideNumber) }] }] },
        placeholderBox(layout.number),
        { ...placeholderText(layout.number), wrap: false }
      )
    );
  }
  parts.push("</svg>");
  return parts.join("");
}
