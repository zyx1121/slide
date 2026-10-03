// WinLab's slide rules as code: the editor's check panel and the MCP tool
// check_deck run this one rule set (PLAN.md, Rule check). Sources: the
// WinLab slide guidelines (winlab:slides) and the QA checklist of the
// winlab-pptx skill. Every violation names its slide, its shape, the rule
// and a message a member can act on.
import type { DeckDocument, Shape, Slide, TextBody } from "../deck/schema";
import { fittedHeight } from "../editor/text-session";
import { PALETTE } from "../editor/palette";
import { routeConnector } from "../render/connector";
import {
  holdsText,
  shapeTextDefaults,
  TITLE_TEXT,
  titleBody,
  titleText,
} from "../render/svg";
import { DEFAULT_TEXT, TITLE } from "../render/template";
import { layoutText, type TextLayout } from "../render/text";

export type Rule =
  | "font-size"
  | "palette"
  | "text-overflow"
  | "title-overflow"
  | "text-overlap"
  | "connector-crosses-text"
  | "low-contrast"
  | "off-slide";

export type Violation = {
  /** 1-based, as members count slides. */
  slide: number;
  slideId: string;
  /** The shape, or null for the slide's title. */
  shape: string | null;
  rule: Rule;
  message: string;
};

/** Readable text: 12 pt to 60 pt (canvas px are half points). */
export const MIN_SIZE = 24;
export const MAX_SIZE = 120;

type Rect = { x: number; y: number; w: number; h: number };
type TextShape = Extract<
  Shape,
  { kind: "rect" | "roundRect" | "ellipse" | "text" }
>;

const pt = (px: number) => Math.round((px / 2) * 10) / 10;
const BACKGROUND = "#ffffff";
const PALETTE_COLORS = new Set(PALETTE.map((color) => color.value));

function luminance(color: string): number {
  const channel = (i: number) => {
    const c = parseInt(color.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** The WCAG contrast ratio of two colors, alpha ignored. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Where a shape's text is drawn on the slide, or null when it has none. */
function textRect(shape: TextShape, layout: TextLayout): Rect | null {
  let left = Infinity;
  let right = -Infinity;
  for (const line of layout.lines) {
    const first = line.segments[0];
    const last = line.segments[line.segments.length - 1];
    if (!first || !last) continue;
    left = Math.min(left, first.x);
    right = Math.max(right, last.x + last.width);
  }
  if (!Number.isFinite(left)) return null;
  return {
    x: shape.x + left,
    y: shape.y + layout.top,
    w: right - left,
    h: layout.height,
  };
}

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Whether segment p-q passes through the inside of a rectangle. */
function segmentCrosses(
  p: { x: number; y: number },
  q: { x: number; y: number },
  r: Rect
): boolean {
  // Liang-Barsky clipping against the rectangle.
  let t0 = 0;
  let t1 = 1;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const edges: [number, number][] = [
    [-dx, p.x - r.x],
    [dx, r.x + r.w - p.x],
    [-dy, p.y - r.y],
    [dy, r.y + r.h - p.y],
  ];
  for (const [a, b] of edges) {
    if (a === 0) {
      if (b <= 0) return false;
    } else {
      const t = b / a;
      if (a < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
    }
  }
  return t1 - t0 > 1e-6;
}

const inset = (r: Rect, by: number): Rect => ({
  x: r.x + by,
  y: r.y + by,
  w: Math.max(0, r.w - 2 * by),
  h: Math.max(0, r.h - 2 * by),
});

const KIND_NAMES: Record<Shape["kind"], string> = {
  rect: "矩形",
  roundRect: "圓角矩形",
  ellipse: "橢圓",
  text: "文字方塊",
  image: "圖片",
  line: "連接線",
};

/** A shape as a member recognizes it: its kind and the start of its text. */
export function describeShape(shape: Shape): string {
  const text =
    holdsText(shape) && shape.text
      ? shape.text.paragraphs
          .map((paragraph) => paragraph.runs.map((run) => run.text).join(""))
          .join(" ")
          .trim()
      : "";
  const chars = Array.from(text);
  const quote = chars.length > 12 ? `${chars.slice(0, 12).join("")}…` : text;
  return quote
    ? `${KIND_NAMES[shape.kind]}「${quote}」`
    : KIND_NAMES[shape.kind];
}

function runsOf(body: TextBody) {
  return body.paragraphs.flatMap((paragraph) =>
    paragraph.runs.filter((run) => run.text.trim() !== "")
  );
}

/** The rule violations of one slide. */
export function checkSlide(slide: Slide, index: number): Violation[] {
  const out: Violation[] = [];
  const add = (shape: string | null, rule: Rule, message: string) =>
    out.push({ slide: index + 1, slideId: slide.id, shape, rule, message });
  const shapes = new Map(slide.shapes.map((shape) => [shape.id, shape]));

  if (slide.title) {
    // The title shrinks to fit, down to half its size; past that it runs
    // into the title rule.
    const fitted = titleText(slide.title);
    const layout = layoutText(titleBody(slide.title), TITLE.box, fitted);
    if (layout.height + 2 * TITLE_TEXT.inset.y > TITLE.box.h + 1) {
      add(
        null,
        "title-overflow",
        "標題太長，縮到一半字級仍放不下，會壓到標題線：縮短標題，細節放進內文。"
      );
    }
  }

  const texts: { shape: TextShape; rect: Rect }[] = [];
  for (const shape of slide.shapes) {
    // Off the slide: nothing of it shows when presenting.
    if (shape.kind !== "line") {
      const outside =
        shape.x + shape.w <= 0 ||
        shape.y + shape.h <= 0 ||
        shape.x >= 1920 ||
        shape.y >= 1080;
      if (outside)
        add(shape.id, "off-slide", "這個物件在投影片外面，播放時看不到。");
    }

    // Colors: fills, outlines and text from the WinLab palette.
    const colors: string[] = [];
    if (shape.kind !== "line" && shape.kind !== "image" && shape.fill) {
      colors.push(shape.fill);
    }
    if (shape.stroke) colors.push(shape.stroke.color);
    if (holdsText(shape) && shape.text) {
      for (const run of runsOf(shape.text))
        if (run.color) colors.push(run.color);
    }
    const foreign = [
      ...new Set(colors.map((c) => c.slice(0, 7).toLowerCase())),
    ].filter((c) => !PALETTE_COLORS.has(c));
    if (foreign.length > 0) {
      add(
        shape.id,
        "palette",
        `用了色票以外的顏色 ${foreign.join("、")}：改用 WinLab 色票，整份簡報的顏色才一致。`
      );
    }

    if (!holdsText(shape) || !shape.text) continue;
    const runs = runsOf(shape.text);
    if (runs.length === 0) continue;

    // Size: readable from the back of the lab, and not shouting.
    const sizes = runs.map((run) => run.size ?? DEFAULT_TEXT.size);
    const small = Math.min(...sizes);
    const large = Math.max(...sizes);
    if (small < MIN_SIZE) {
      add(
        shape.id,
        "font-size",
        `字級 ${pt(small)} pt 太小，至少 ${pt(MIN_SIZE)} pt，坐後排才看得清楚。`
      );
    } else if (large > MAX_SIZE) {
      add(
        shape.id,
        "font-size",
        `字級 ${pt(large)} pt 太大，最多 ${pt(MAX_SIZE)} pt。`
      );
    }

    // Contrast against the shape's fill, or the white slide.
    const behind = shape.fill ? shape.fill.slice(0, 7) : BACKGROUND;
    const worst = runs.reduce<{ ratio: number; large: boolean } | null>(
      (acc, run) => {
        const size = run.size ?? DEFAULT_TEXT.size;
        const ratio = contrast(
          (run.color ?? DEFAULT_TEXT.color).slice(0, 7),
          behind
        );
        const big = size >= 36 || (size >= 28 && run.bold === true);
        const need = big ? 3 : 4.5;
        if (ratio >= need) return acc;
        return !acc || ratio < acc.ratio ? { ratio, large: big } : acc;
      },
      null
    );
    if (worst) {
      add(
        shape.id,
        "low-contrast",
        `文字和底色的對比只有 ${worst.ratio.toFixed(1)}:1，至少要 ${worst.large ? 3 : 4.5}:1：換深一點的字色或淺一點的底色。`
      );
    }

    // Overflow: text taller than its box (plain text boxes grow instead).
    const defaults = shapeTextDefaults(shape.kind);
    const layout = layoutText(shape.text, shape, defaults);
    if (
      fittedHeight(shape, shape.text) === null &&
      layout.height + 2 * defaults.inset.y > shape.h + 1
    ) {
      add(
        shape.id,
        "text-overflow",
        "文字超出框外：縮短文字、把框拉大，或拆成兩頁。"
      );
    }
    const rect = textRect(shape, layout);
    if (rect && !shape.rotation) texts.push({ shape, rect });
  }

  // Text on top of other text.
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      if (overlaps(inset(texts[i].rect, 1), inset(texts[j].rect, 1))) {
        add(
          texts[j].shape.id,
          "text-overlap",
          `文字和${describeShape(texts[i].shape)}的文字疊在一起：移開其中一個。`
        );
      }
    }
  }

  // Connectors running through text they do not connect.
  for (const line of slide.shapes) {
    if (line.kind !== "line") continue;
    const ends = new Set(
      [line.start, line.end].flatMap((end) =>
        "shape" in end ? [end.shape] : []
      )
    );
    const route = routeConnector(
      line.route === "curved" ? { ...line, route: "elbow" } : line,
      shapes
    );
    const points = route.points;
    for (const { shape, rect } of texts) {
      if (ends.has(shape.id)) continue;
      const box = inset(rect, 2);
      const hit = points.some(
        (p, k) => k > 0 && segmentCrosses(points[k - 1], p, box)
      );
      if (hit) {
        add(
          line.id,
          "connector-crosses-text",
          `連接線穿過${describeShape(shape)}的文字：改走折線，或移開其中一個。`
        );
      }
    }
  }
  return out;
}

/** The rule violations of a whole deck, slide by slide. */
export function checkDeck(document: DeckDocument): Violation[] {
  return document.slides.flatMap((slide, i) => checkSlide(slide, i));
}
