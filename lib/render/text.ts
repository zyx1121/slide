// Lays out a text body in a box: line breaking (spaces for Latin, any
// character boundary for CJK, with kinsoku so closing punctuation never starts
// a line), bullets and numbering, alignment and vertical anchoring. The output
// positions every run, so drawing never re-wraps.
import type { TextBody } from "../deck/schema";
import { ASCENT, charWidth, isWide, LINE_HEIGHT } from "./metrics";

export type Align = "left" | "center" | "right" | "justify";
export type Anchor = "top" | "middle" | "bottom";

export type TextDefaults = {
  size: number;
  color: string;
  bold: boolean;
  align: Align;
  anchor: Anchor;
  /** Space between the box edge and the text, in px. */
  inset: { x: number; y: number };
  /** False keeps every paragraph on one line, as PowerPoint's wrap="none". */
  wrap: boolean;
};

export type Segment = {
  text: string;
  /** Latin runs are drawn in Carlito, CJK runs in Noto Sans TC. */
  script: "latin" | "cjk";
  x: number;
  width: number;
  size: number;
  color: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
};

export type Line = {
  /** Baseline, from the top of the text block. */
  baseline: number;
  height: number;
  segments: Segment[];
  bullet?: Omit<Segment, "underline" | "strike" | "script">;
};

export type TextLayout = {
  lines: Line[];
  /** Height of the text block. */
  height: number;
  /** Top of the text block inside the box, after insets and anchoring. */
  top: number;
};

/** PowerPoint's default text insets: 0.1 in left and right, 0.05 in top and bottom. */
export const DEFAULT_INSET = { x: 14.4, y: 7.2 };
/** Indent per paragraph level (0.5 in), and the bullet's hanging indent (0.25 in). */
export const LEVEL_INDENT = 72;
export const BULLET_HANG = 36;

// Kinsoku: characters that may not start a line, and that may not end one.
const NO_START = new Set([
  ..."、。，．：；？！）」』】〕〉》｝〞’”%‰°℃,.:;?!)]}…‥ゝゞヽヾ々ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶー・",
]);
const NO_END = new Set([..."（「『【〔〈《｛〝‘“([{"]);

type RunStyle = Omit<Segment, "text" | "x" | "width" | "script">;
type Char = { ch: string; cp: number; width: number; style: RunStyle };

const isSpace = (ch: string) => ch === " " || ch === " " || ch === "\t";

function styleKey(style: RunStyle): string {
  return `${style.size}|${style.color}|${style.bold}|${style.italic}|${style.underline}|${style.strike}`;
}

function canBreakAfter(chars: Char[], i: number): boolean {
  const next = chars[i + 1];
  if (!next) return true;
  if (NO_START.has(next.ch) || NO_END.has(chars[i].ch)) return false;
  if (isSpace(chars[i].ch)) return !isSpace(next.ch);
  if (isSpace(next.ch)) return false;
  return isWide(chars[i].cp) || isWide(next.cp);
}

/** Splits characters into lines no wider than `limit`; spaces hang past it. */
function breakLines(chars: Char[], limit: number, wrap: boolean): Char[][] {
  const lines: Char[][] = [];
  let start = 0;
  while (start <= chars.length) {
    let width = 0;
    let lastBreak = -1;
    let end = chars.length;
    let forced = false;
    for (let i = start; i < chars.length; i++) {
      const c = chars[i];
      if (c.ch === "\n") {
        end = i;
        forced = true;
        break;
      }
      if (wrap && !isSpace(c.ch) && width + c.width > limit && i > start) {
        end = lastBreak >= start ? lastBreak + 1 : i;
        break;
      }
      width += c.width;
      if (canBreakAfter(chars, i)) lastBreak = i;
    }
    lines.push(chars.slice(start, end));
    if (end >= chars.length && !forced) break;
    start = forced ? end + 1 : end;
    if (start === chars.length && !forced) break;
  }
  return lines;
}

function trimTrailingSpaces(chars: Char[]): Char[] {
  let end = chars.length;
  while (end > 0 && isSpace(chars[end - 1].ch)) end--;
  return chars.slice(0, end);
}

// Segments split where the style or the script changes, so every drawn run
// is in one font: renderers that fall back per glyph (resvg) would otherwise
// draw the rest of a mixed run in the fallback font and ignore its weight.
function segmentsOf(chars: Char[], x0: number): Segment[] {
  const segments: Segment[] = [];
  let x = x0;
  for (const c of chars) {
    const last = segments[segments.length - 1];
    const script = isWide(c.cp)
      ? "cjk"
      : isSpace(c.ch) && last
        ? last.script
        : "latin";
    if (
      last &&
      last.script === script &&
      styleKey(last) === styleKey(c.style)
    ) {
      last.text += c.ch;
      last.width += c.width;
    } else {
      segments.push({ ...c.style, script, text: c.ch, x, width: c.width });
    }
    x += c.width;
  }
  return segments;
}

/** Lays `body` out in a `w` x `h` box. */
export function layoutText(
  body: TextBody,
  box: { w: number; h: number },
  defaults: TextDefaults
): TextLayout {
  const inner = Math.max(0, box.w - 2 * defaults.inset.x);
  const lines: Line[] = [];
  const counters: number[] = [];
  let y = 0;

  for (const paragraph of body.paragraphs) {
    const level = paragraph.level ?? 0;
    const bulletKind = paragraph.bullet ?? "none";
    const marL =
      level * LEVEL_INDENT + (bulletKind === "none" ? 0 : BULLET_HANG);
    const limit = Math.max(1, inner - marL);
    const align = paragraph.align ?? defaults.align;

    const chars: Char[] = [];
    for (const run of paragraph.runs) {
      const style: RunStyle = {
        size: run.size ?? defaults.size,
        color: run.color ?? defaults.color,
        bold: run.bold ?? defaults.bold,
        italic: run.italic ?? false,
        underline: run.underline ?? false,
        strike: run.strike ?? false,
      };
      for (const ch of run.text) {
        const cp = ch.codePointAt(0)!;
        chars.push({
          ch,
          cp,
          width: ch === "\n" ? 0 : charWidth(cp, style),
          style,
        });
      }
    }
    const first = paragraph.runs[0];
    const paraSize = first?.size ?? defaults.size;

    let label: string | undefined;
    if (bulletKind === "number") {
      counters.length = level + 1;
      counters[level] = (counters[level] ?? 0) + 1;
      label = `${counters[level]}.`;
    } else {
      counters.length = level;
      if (bulletKind === "bullet") label = "•";
    }

    breakLines(chars, limit, defaults.wrap).forEach((lineChars, index) => {
      const visible = trimTrailingSpaces(lineChars);
      const size =
        Math.max(
          0,
          ...lineChars.filter((c) => c.ch !== "\n").map((c) => c.style.size)
        ) || paraSize;
      const height = size * LINE_HEIGHT;
      const width = visible.reduce((sum, c) => sum + c.width, 0);
      const offset =
        align === "center"
          ? (limit - width) / 2
          : align === "right"
            ? limit - width
            : 0;
      const line: Line = {
        baseline: y + size * ASCENT,
        height,
        segments: segmentsOf(visible, defaults.inset.x + marL + offset),
      };
      if (label && index === 0) {
        const style = {
          size: paraSize,
          color: first?.color ?? defaults.color,
          bold: first?.bold ?? defaults.bold,
          italic: false,
        };
        line.bullet = {
          ...style,
          text: label,
          x: defaults.inset.x + marL - BULLET_HANG,
          width: BULLET_HANG,
        };
      }
      lines.push(line);
      y += height;
    });
  }

  const room = box.h - 2 * defaults.inset.y;
  const anchor = body.anchor ?? defaults.anchor;
  const top =
    defaults.inset.y +
    (anchor === "middle" ? (room - y) / 2 : anchor === "bottom" ? room - y : 0);
  return { lines, height: y, top };
}
