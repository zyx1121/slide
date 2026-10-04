// Editing a text body in place: typing, deleting, splitting and joining
// paragraphs, and styling part of the text. A position is a paragraph and an
// offset in code points of its text, the same offsets the layout reports
// (lib/render/text.ts), so the caret the editor draws is where edits land.
// Pure functions, shared by the editor and its tests.
import type { TextBody } from "../deck/schema";

type Paragraph = TextBody["paragraphs"][number];
type Run = Paragraph["runs"][number];
export type RunStyle = Omit<Run, "text">;
export type ParagraphProps = Omit<Paragraph, "runs">;

/**
 * A caret position. `before` keeps a caret at the end of a wrapped line
 * there, instead of at the start of the next line, which is the same offset.
 */
export type Pos = { p: number; o: number; before?: boolean };
export type TextSelection = { anchor: Pos; focus: Pos };

type Char = { ch: string; style: RunStyle };
type Model = { props: ParagraphProps; chars: Char[]; empty: RunStyle };

const STYLE_KEYS = [
  "size",
  "color",
  "bold",
  "italic",
  "underline",
  "strike",
] as const;

/** A style without the keys it leaves unset, so equal styles compare equal. */
function clean(style: RunStyle): RunStyle {
  const out: RunStyle = {};
  for (const key of STYLE_KEYS) {
    if (style[key] !== undefined)
      (out as Record<string, unknown>)[key] = style[key];
  }
  return out;
}

const styleKey = (style: RunStyle) =>
  STYLE_KEYS.map((key) => String(style[key])).join("|");

function toModel(paragraph: Paragraph): Model {
  const { runs, ...props } = paragraph;
  const chars: Char[] = [];
  for (const run of runs) {
    const { text, ...style } = run;
    const kept = clean(style);
    for (const ch of text) chars.push({ ch, style: kept });
  }
  const last = runs.at(-1);
  return {
    props,
    chars,
    empty: last ? clean(last) : {},
  };
}

function fromModel(model: Model): Paragraph {
  const runs: Run[] = [];
  for (const { ch, style } of model.chars) {
    const last = runs.at(-1);
    if (last && styleKey(last) === styleKey(style)) last.text += ch;
    else runs.push({ ...style, text: ch });
  }
  // An empty paragraph keeps its style in an empty run, as PowerPoint keeps
  // an end-of-paragraph style, so text typed into it later looks the same.
  if (runs.length === 0 && Object.keys(model.empty).length > 0) {
    runs.push({ ...model.empty, text: "" });
  }
  return { ...model.props, runs };
}

const models = (body: TextBody) => body.paragraphs.map(toModel);
const build = (body: TextBody, list: Model[]): TextBody => ({
  ...body,
  paragraphs: list.map(fromModel),
});

/** A paragraph's text. */
export const paragraphText = (paragraph: Paragraph) =>
  paragraph.runs.map((run) => run.text).join("");

/** A paragraph's length in code points. */
export const paragraphLength = (paragraph: Paragraph) =>
  Array.from(paragraphText(paragraph)).length;

export const comparePos = (a: Pos, b: Pos) => a.p - b.p || a.o - b.o;
export const samePos = (a: Pos, b: Pos) => comparePos(a, b) === 0;

/** The selection's ends in document order. */
export function ordered(selection: TextSelection): [Pos, Pos] {
  const { anchor, focus } = selection;
  return comparePos(anchor, focus) <= 0 ? [anchor, focus] : [focus, anchor];
}

export const collapsed = (selection: TextSelection) =>
  samePos(selection.anchor, selection.focus);

export const caretAt = (pos: Pos): TextSelection => ({
  anchor: pos,
  focus: pos,
});

/** A position moved inside the body. */
export function clampPos(body: TextBody, pos: Pos): Pos {
  const p = Math.max(0, Math.min(pos.p, body.paragraphs.length - 1));
  const o = Math.max(
    0,
    Math.min(p === pos.p ? pos.o : 0, paragraphLength(body.paragraphs[p]))
  );
  return p === pos.p && o === pos.o ? pos : { p, o };
}

export function clampSelection(
  body: TextBody,
  selection: TextSelection
): TextSelection {
  return {
    anchor: clampPos(body, selection.anchor),
    focus: clampPos(body, selection.focus),
  };
}

export const startOf = (): Pos => ({ p: 0, o: 0 });
export function endOf(body: TextBody): Pos {
  const p = body.paragraphs.length - 1;
  return { p, o: paragraphLength(body.paragraphs[p]) };
}
export const selectAll = (body: TextBody): TextSelection => ({
  anchor: startOf(),
  focus: endOf(body),
});

/**
 * The style text typed at `pos` gets: that of the character before it, or of
 * the first character when the caret is at the start, as in PowerPoint.
 */
export function styleAt(body: TextBody, pos: Pos): RunStyle {
  const model = toModel(body.paragraphs[pos.p]);
  const char = model.chars[pos.o - 1] ?? model.chars[pos.o];
  return char ? char.style : model.empty;
}

/** Whether a body holds no text at all. */
export const isEmpty = (body: TextBody) =>
  body.paragraphs.every((paragraph) => paragraphLength(paragraph) === 0);

/** An empty body, for a shape that had no text yet. */
export const EMPTY_BODY: TextBody = { paragraphs: [{ runs: [] }] };

/**
 * Replaces the text between two positions with `text`, in `style`. With
 * `paragraphs`, a newline in the text starts a new paragraph that keeps the
 * current one's alignment, bullet and level; without, it stays a newline
 * inside the paragraph (the slide title is a single paragraph).
 */
export function replaceRange(
  body: TextBody,
  from: Pos,
  to: Pos,
  text: string,
  style: RunStyle,
  paragraphs = true
): { body: TextBody; caret: Pos } {
  const [start, end] = comparePos(from, to) <= 0 ? [from, to] : [to, from];
  const list = models(body);
  const first = list[start.p];
  const last = list[end.p];
  const head = first.chars.slice(0, start.o);
  const tail = last.chars.slice(end.o);
  const kept = clean(style);
  const pieces = paragraphs
    ? text.replace(/\r\n?/g, "\n").split("\n")
    : [text.replace(/\r\n?/g, "\n")];
  const made: Model[] = pieces.map((piece, i) => ({
    props: first.props,
    chars: [
      ...(i === 0 ? head : []),
      ...Array.from(piece, (ch) => ({ ch, style: kept })),
    ],
    empty: i === 0 && head.length > 0 ? first.empty : kept,
  }));
  const lastMade = made[made.length - 1];
  const caret = { p: start.p + made.length - 1, o: lastMade.chars.length };
  lastMade.chars.push(...tail);
  if (lastMade.chars.length === 0) lastMade.empty = kept;
  list.splice(start.p, end.p - start.p + 1, ...made);
  return { body: build(body, list), caret };
}

/** Deletes the text between two positions. */
export function deleteRange(body: TextBody, from: Pos, to: Pos) {
  const [start] = comparePos(from, to) <= 0 ? [from, to] : [to, from];
  return replaceRange(body, from, to, "", styleAt(body, start));
}

/** Offsets, in code points, of a string's grapheme or word boundaries. */
function boundaries(text: string, granularity: "grapheme" | "word") {
  const segmenter = new Intl.Segmenter("zh-Hant", { granularity });
  const out: { at: number; wordLike: boolean; end: number }[] = [];
  let cp = 0;
  for (const segment of segmenter.segment(text)) {
    const length = Array.from(segment.segment).length;
    out.push({
      at: cp,
      end: cp + length,
      wordLike: granularity === "word" ? segment.isWordLike === true : true,
    });
    cp += length;
  }
  return out;
}

/**
 * The position one character (grapheme) or one word away, crossing into the
 * neighboring paragraph at either end.
 */
export function step(
  body: TextBody,
  pos: Pos,
  direction: -1 | 1,
  unit: "char" | "word"
): Pos {
  const paragraph = body.paragraphs[pos.p];
  const text = paragraphText(paragraph);
  const length = Array.from(text).length;
  if (direction < 0 && pos.o === 0) {
    return pos.p > 0
      ? { p: pos.p - 1, o: paragraphLength(body.paragraphs[pos.p - 1]) }
      : pos;
  }
  if (direction > 0 && pos.o >= length) {
    return pos.p < body.paragraphs.length - 1 ? { p: pos.p + 1, o: 0 } : pos;
  }
  if (unit === "char") {
    const marks = boundaries(text, "grapheme");
    if (direction < 0) {
      const mark = marks.findLast((m) => m.at < pos.o);
      return { p: pos.p, o: mark?.at ?? 0 };
    }
    const mark = marks.find((m) => m.end > pos.o);
    return { p: pos.p, o: mark?.end ?? length };
  }
  // A word step skips spaces and punctuation, then the word: to its start
  // going back, to its end going forward.
  const words = boundaries(text, "word").filter((m) => m.wordLike);
  if (direction < 0) {
    const word = words.findLast((m) => m.at < pos.o);
    return { p: pos.p, o: word?.at ?? 0 };
  }
  const word = words.find((m) => m.end > pos.o);
  return { p: pos.p, o: word?.end ?? length };
}

/** The word around a position, for a double click; spaces select themselves. */
export function wordAt(body: TextBody, pos: Pos): TextSelection {
  const text = paragraphText(body.paragraphs[pos.p]);
  const marks = boundaries(text, "word");
  const mark =
    marks.find((m) => m.at <= pos.o && pos.o < m.end) ??
    marks.findLast((m) => m.end === pos.o);
  if (!mark) return caretAt(pos);
  return {
    anchor: { p: pos.p, o: mark.at },
    focus: { p: pos.p, o: mark.end },
  };
}

/** The whole paragraph around a position, for a triple click. */
export function paragraphAt(body: TextBody, pos: Pos): TextSelection {
  return {
    anchor: { p: pos.p, o: 0 },
    focus: { p: pos.p, o: paragraphLength(body.paragraphs[pos.p]) },
  };
}

/** The selected text, paragraphs joined by newlines, for the clipboard. */
export function plainText(body: TextBody, from: Pos, to: Pos): string {
  const [start, end] = comparePos(from, to) <= 0 ? [from, to] : [to, from];
  const lines: string[] = [];
  for (let p = start.p; p <= end.p; p++) {
    const chars = Array.from(paragraphText(body.paragraphs[p]));
    const a = p === start.p ? start.o : 0;
    const b = p === end.p ? end.o : chars.length;
    lines.push(chars.slice(a, b).join(""));
  }
  return lines.join("\n").replace(/\u000b/g, "\n");
}

/** Sets run styles on the text between two positions. */
export function styleRange(
  body: TextBody,
  from: Pos,
  to: Pos,
  change: RunStyle
): TextBody {
  const [start, end] = comparePos(from, to) <= 0 ? [from, to] : [to, from];
  const list = models(body);
  for (let p = start.p; p <= end.p; p++) {
    const model = list[p];
    const a = p === start.p ? start.o : 0;
    const b = p === end.p ? end.o : model.chars.length;
    for (let i = a; i < b; i++) {
      model.chars[i] = {
        ...model.chars[i],
        style: clean({ ...model.chars[i].style, ...change }),
      };
    }
    // A paragraph covered whole keeps the new style when emptied later.
    if (a === 0 && b === model.chars.length) {
      model.empty = clean({ ...model.empty, ...change });
    }
  }
  return build(body, list);
}

/** Sets paragraph properties on every paragraph between two positions. */
export function styleParagraphs(
  body: TextBody,
  from: Pos,
  to: Pos,
  change: (props: ParagraphProps) => ParagraphProps
): TextBody {
  const [start, end] = comparePos(from, to) <= 0 ? [from, to] : [to, from];
  return {
    ...body,
    paragraphs: body.paragraphs.map((paragraph, p) => {
      if (p < start.p || p > end.p) return paragraph;
      const { runs, ...props } = paragraph;
      // Whatever the change leaves alone stays: an imported paragraph's line
      // spacing, space around it and bullet character among them.
      const { align, bullet, level, ...rest } = change(props);
      const tidy: ParagraphProps = { ...rest };
      if (align !== undefined) tidy.align = align;
      if (bullet !== undefined && bullet !== "none") tidy.bullet = bullet;
      else delete tidy.bulletChar;
      if (level) tidy.level = level;
      return { ...tidy, runs };
    }),
  };
}

/** The run styles of the selected characters, or the typing style at a caret. */
export function selectedStyles(
  body: TextBody,
  selection: TextSelection
): RunStyle[] {
  const [start, end] = ordered(selection);
  if (samePos(start, end)) return [styleAt(body, start)];
  const styles: RunStyle[] = [];
  for (let p = start.p; p <= end.p; p++) {
    const model = toModel(body.paragraphs[p]);
    const a = p === start.p ? start.o : 0;
    const b = p === end.p ? end.o : model.chars.length;
    for (let i = a; i < b; i++) styles.push(model.chars[i].style);
    if (a === b && model.chars.length === 0) styles.push(model.empty);
  }
  return styles.length > 0 ? styles : [styleAt(body, start)];
}
