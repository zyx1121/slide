// Lays out a text body in a box: line breaking (spaces and hyphens for Latin,
// any character boundary for CJK, with kinsoku so closing punctuation never
// starts a line), bullets and numbering, alignment and vertical anchoring.
// The output positions every run, so drawing never re-wraps.
import type { TextBody } from "../deck/schema";
import {
  ASCENT,
  charWidth,
  fontOf,
  isCurlyQuote,
  isWide,
  LINE_HEIGHT,
  measure,
} from "./metrics";

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
  /** Drawn in Carlito, the CJK font or the emoji font; see fontOf. */
  script: "latin" | "cjk" | "emoji";
  x: number;
  width: number;
  size: number;
  color: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
};

/** Where the caret stands before character `at` of a paragraph. */
export type Caret = { at: number; x: number };

export type Line = {
  /** The paragraph the line belongs to. */
  paragraph: number;
  /** Offsets, in code points of the paragraph's text, the line covers. */
  start: number;
  end: number;
  /** Top of the line, from the top of the text block. */
  top: number;
  /** Baseline, from the top of the text block. */
  baseline: number;
  height: number;
  /** Every caret stop on the line, left to right, for text editing. */
  carets: Caret[];
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
/** Indent per paragraph level: 0.5 in. */
export const LEVEL_INDENT = 72;
/** Hanging indents PowerPoint gives a bullet (0.375 in) and a number (0.5 in). */
export const BULLET_HANG = 54;
export const NUMBER_HANG = 72;

// Kinsoku: characters that may not start a line, and that may not end one.
const NO_START = new Set([
  ..."、。，．：；？！）」』】〕〉》｝〞’”%‰°℃,.:;?!)]}…‥ゝゞヽヾ々ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶー・",
]);
const NO_END = new Set([..."（「『【〔〈《｛〝‘“([{"]);
const HYPHENS = new Set(["-", "‐", "–", "—"]);
const LINE_BREAKS = new Set(["\n", "\u000b", " "]);

type RunStyle = Omit<Segment, "text" | "x" | "width" | "script">;
type Char = {
  ch: string;
  cp: number;
  /** Offset in code points within the paragraph's text. */
  at: number;
  width: number;
  style: RunStyle;
};

const NO_BREAK_SPACE = "\u00a0";
const isSpace = (ch: string) =>
  ch === " " || ch === NO_BREAK_SPACE || ch === "\t";

/**
 * Characters that are neither drawn nor allowed in XML: C0 and C1 controls
 * other than tab and line breaks, U+FFFE, U+FFFF and lone surrogates.
 */
function invisible(ch: string, cp: number): boolean {
  if (ch === "\t" || LINE_BREAKS.has(ch)) return false;
  return (
    cp < 0x20 ||
    (cp >= 0x7f && cp <= 0x9f) ||
    cp === 0xfffe ||
    cp === 0xffff ||
    (cp >= 0xd800 && cp <= 0xdfff)
  );
}

function styleKey(style: RunStyle): string {
  return `${style.size}|${style.color}|${style.bold}|${style.italic}|${style.underline}|${style.strike}`;
}

// Curly quotes are drawn as CJK but break as punctuation: "don’t" stays whole.
const breaksLikeCjk = (cp: number) =>
  isWide(cp) || (fontOf(cp) === "cjk" && !isCurlyQuote(cp));

function canBreakAfter(chars: Char[], i: number): boolean {
  const here = chars[i];
  const next = chars[i + 1];
  if (!next) return true;
  if (NO_START.has(next.ch) || NO_END.has(here.ch)) return false;
  // A no-break space holds its neighbours together.
  if (here.ch === NO_BREAK_SPACE || next.ch === NO_BREAK_SPACE) return false;
  if (isSpace(here.ch)) return !isSpace(next.ch);
  if (isSpace(next.ch)) return false;
  // After a hyphen inside a word: "end-to-end" may break as "end-" / "to-end".
  if (HYPHENS.has(here.ch) && i > 0 && !isSpace(chars[i - 1].ch)) return true;
  return breaksLikeCjk(here.cp) || breaksLikeCjk(next.cp);
}

/**
 * Splits characters into lines, line `n` no wider than `limit(n)`; spaces
 * hang past the limit. Each line is a range of `chars`, without the forced
 * break that ends it.
 */
function breakLines(
  chars: Char[],
  limit: (line: number) => number,
  wrap: boolean
): { start: number; end: number }[] {
  const lines: { start: number; end: number }[] = [];
  let start = 0;
  while (start <= chars.length) {
    const max = limit(lines.length);
    let width = 0;
    let lastBreak = -1;
    let end = chars.length;
    let forced = false;
    for (let i = start; i < chars.length; i++) {
      const c = chars[i];
      if (LINE_BREAKS.has(c.ch)) {
        end = i;
        forced = true;
        break;
      }
      if (wrap && !isSpace(c.ch) && width + c.width > max && i > start) {
        end = lastBreak >= start ? lastBreak + 1 : i;
        break;
      }
      width += c.width;
      if (canBreakAfter(chars, i)) lastBreak = i;
    }
    lines.push({ start, end });
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

// Segments split where the style or the font changes, so every drawn run is
// in one font: renderers that fall back per glyph (resvg) would otherwise draw
// the rest of a mixed run in the fallback font and ignore its weight.
// With `extra`, the space justification adds after a character: the next
// character starts a new segment there, so the gap falls between words (or
// CJK characters) rather than being spread over every glyph.
function segmentsOf(chars: Char[], x0: number, extra?: number[]): Segment[] {
  const segments: Segment[] = [];
  let x = x0;
  let gap = false;
  chars.forEach((c, i) => {
    const last = segments[segments.length - 1];
    // A space goes with the run before it, but never in the emoji font,
    // whose space is not as wide as the one measured.
    const script =
      isSpace(c.ch) && last && last.script !== "emoji"
        ? last.script
        : isSpace(c.ch)
          ? "latin"
          : fontOf(c.cp);
    const text = c.ch === "\t" ? "    " : c.ch;
    if (
      last &&
      !gap &&
      last.script === script &&
      styleKey(last) === styleKey(c.style)
    ) {
      last.text += text;
      last.width += c.width;
    } else {
      segments.push({ ...c.style, script, text, x, width: c.width });
    }
    const after = extra?.[i] ?? 0;
    x += c.width + after;
    gap = after > 0;
  });
  return segments;
}

/**
 * The space justification adds after each character of a line: spread over
 * the spaces between words, or between characters when there are none
 * (CJK), so the line fills its room.
 */
function justify(visible: Char[], room: number): number[] {
  const width = visible.reduce((sum, c) => sum + c.width, 0);
  const free = room - width;
  if (free <= 0 || visible.length < 2) return [];
  let gaps = visible
    .map((c, i) => (isSpace(c.ch) && i > 0 ? i : -1))
    .filter((i) => i >= 0);
  if (gaps.length === 0) gaps = visible.slice(0, -1).map((_, i) => i);
  const extra: number[] = new Array(visible.length).fill(0);
  for (const i of gaps) extra[i] = free / gaps.length;
  return extra;
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

  body.paragraphs.forEach((paragraph, paragraphIndex) => {
    const level = paragraph.level ?? 0;
    const bulletKind = paragraph.bullet ?? "none";
    const hang =
      bulletKind === "number"
        ? NUMBER_HANG
        : bulletKind === "bullet"
          ? BULLET_HANG
          : 0;
    const marL = level * LEVEL_INDENT + hang;
    const align = paragraph.align ?? defaults.align;

    const chars: Char[] = [];
    let at = 0;
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
        if (invisible(ch, cp)) {
          at++;
          continue;
        }
        const width = LINE_BREAKS.has(ch)
          ? 0
          : ch === "\t"
            ? 4 * charWidth(0x20, style)
            : charWidth(cp, style);
        chars.push({ ch, cp, at: at++, width, style });
      }
    }
    const offsetAt = (index: number) =>
      index < chars.length ? chars[index].at : at;
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
    const labelStyle = {
      size: paraSize,
      color: first?.color ?? defaults.color,
      bold: first?.bold ?? defaults.bold,
      italic: false,
    };
    // A label wider than its hanging indent pushes the first line's text
    // along, as PowerPoint does, instead of drawing over it.
    const labelX = marL - hang;
    const firstIndent = label
      ? Math.max(marL, labelX + measure(label, labelStyle) + paraSize / 4)
      : marL;
    const limitFor = (line: number) =>
      Math.max(1, inner - (line === 0 ? firstIndent : marL));

    breakLines(chars, limitFor, defaults.wrap).forEach((range, index) => {
      const lineChars = chars.slice(range.start, range.end);
      const visible = trimTrailingSpaces(lineChars);
      let size = 0;
      for (const c of lineChars) size = Math.max(size, c.style.size);
      size ||= paraSize;
      const height = size * LINE_HEIGHT;
      let width = 0;
      for (const c of visible) width += c.width;
      const indent = index === 0 ? firstIndent : marL;
      const room = limitFor(index);
      const offset =
        align === "center"
          ? (room - width) / 2
          : align === "right"
            ? room - width
            : 0;
      const x0 = defaults.inset.x + indent + offset;
      // Justified lines fill their room, but for a paragraph's last line
      // and lines that end in a break.
      const ends =
        range.end >= chars.length || LINE_BREAKS.has(chars[range.end].ch);
      const extra = align === "justify" && !ends ? justify(visible, room) : [];
      const carets: Caret[] = [];
      let x = x0;
      lineChars.forEach((c, i) => {
        carets.push({ at: c.at, x });
        x += c.width + (extra[i] ?? 0);
      });
      carets.push({ at: offsetAt(range.end), x });
      const line: Line = {
        paragraph: paragraphIndex,
        start: offsetAt(range.start),
        end: offsetAt(range.end),
        top: y,
        baseline: y + size * ASCENT,
        height,
        carets,
        segments: segmentsOf(visible, x0, extra),
      };
      if (label && index === 0) {
        line.bullet = {
          ...labelStyle,
          text: label,
          x: defaults.inset.x + labelX,
          width: 0,
        };
      }
      lines.push(line);
      y += height;
    });
  });

  const room = box.h - 2 * defaults.inset.y;
  const anchor = body.anchor ?? defaults.anchor;
  const top =
    defaults.inset.y +
    (anchor === "middle" ? (room - y) / 2 : anchor === "bottom" ? room - y : 0);
  return { lines, height: y, top };
}
