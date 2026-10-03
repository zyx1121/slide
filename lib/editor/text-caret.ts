// Where the caret and the selection are drawn, and which position a point or
// an arrow key reaches, read from the layout the renderer draws with
// (lib/render/text.ts). Coordinates are in the text box's own frame: x from
// its left edge, y from its top edge, before rotation.
import type { Line, TextLayout } from "../render/text";
import { comparePos, type Pos } from "./text-edit";

export type CaretBox = { line: number; x: number; top: number; height: number };
export type SelectionRect = { x: number; y: number; w: number; h: number };

/** The line a position is drawn on. */
export function lineOf(layout: TextLayout, pos: Pos): number {
  let found = -1;
  layout.lines.forEach((line, i) => {
    if (line.paragraph !== pos.p || line.start > pos.o) return;
    // At a wrap the offset ends one line and starts the next: it belongs to
    // the next line unless the caret was put at the end of this one.
    if (found >= 0 && pos.before && layout.lines[found].end === pos.o) return;
    found = i;
  });
  return Math.max(0, found);
}

function xIn(line: Line, o: number): number {
  let x = line.carets[0]?.x ?? 0;
  for (const caret of line.carets) {
    if (caret.at > o) break;
    x = caret.x;
  }
  return x;
}

/** The caret for a position: its x, and the top and height of its line. */
export function caretBox(layout: TextLayout, pos: Pos): CaretBox | null {
  const index = lineOf(layout, pos);
  const line = layout.lines[index];
  if (!line) return null;
  return {
    line: index,
    x: xIn(line, pos.o),
    top: layout.top + line.top,
    height: line.height,
  };
}

/** The position nearest an x on a line. */
function nearest(layout: TextLayout, index: number, x: number): Pos {
  const line = layout.lines[index];
  let best = line.carets[0];
  for (const caret of line.carets) {
    if (Math.abs(caret.x - x) < Math.abs(best.x - x)) best = caret;
  }
  const next = layout.lines[index + 1];
  // The last stop of a wrapped line is also the first of the next one.
  const wrapped =
    next !== undefined &&
    next.paragraph === line.paragraph &&
    next.start === best.at;
  return wrapped
    ? { p: line.paragraph, o: best.at, before: true }
    : { p: line.paragraph, o: best.at };
}

/** The position under a point. */
export function hitPos(layout: TextLayout, x: number, y: number): Pos {
  const lines = layout.lines;
  const inner = y - layout.top;
  let index = lines.findIndex((line) => inner < line.top + line.height);
  if (index < 0) index = lines.length - 1;
  return nearest(layout, Math.max(0, index), x);
}

/**
 * The position a line up or down, nearest `goal` (the x the caret had when
 * vertical moves began). Past the first or last line it goes to that line's
 * start or end, as text fields do.
 */
export function verticalPos(
  layout: TextLayout,
  pos: Pos,
  direction: -1 | 1,
  goal: number
): Pos {
  const index = lineOf(layout, pos) + direction;
  const lines = layout.lines;
  if (index < 0) return { p: lines[0].paragraph, o: lines[0].start };
  if (index >= lines.length) {
    const last = lines[lines.length - 1];
    return { p: last.paragraph, o: last.end };
  }
  return nearest(layout, index, goal);
}

/** The start or end of the line a position is on (Home and End). */
export function lineEdge(
  layout: TextLayout,
  pos: Pos,
  edge: "start" | "end"
): Pos {
  const index = lineOf(layout, pos);
  const line = layout.lines[index];
  if (edge === "start") return { p: line.paragraph, o: line.start };
  const next = layout.lines[index + 1];
  const wrapped = next?.paragraph === line.paragraph && next.start === line.end;
  return wrapped
    ? { p: line.paragraph, o: line.end, before: true }
    : { p: line.paragraph, o: line.end };
}

/**
 * Rectangles covering the text between two positions, one per line. A line
 * whose end is selected through to the next line shows a sliver past its
 * text, so selected empty lines show too.
 */
export function selectionRects(
  layout: TextLayout,
  start: Pos,
  end: Pos
): SelectionRect[] {
  const rects: SelectionRect[] = [];
  layout.lines.forEach((line, i) => {
    const lineStart = { p: line.paragraph, o: line.start };
    const lineEnd = { p: line.paragraph, o: line.end };
    if (comparePos(end, lineStart) < 0 || comparePos(start, lineEnd) > 0) {
      return;
    }
    // A selection that starts at a wrap starts on the next line.
    const next = layout.lines[i + 1];
    const wraps = next?.paragraph === line.paragraph && next.start === line.end;
    if (wraps && comparePos(start, lineEnd) === 0) return;
    const from = comparePos(start, lineStart) > 0 ? start.o : line.start;
    const to = comparePos(end, lineEnd) < 0 ? end.o : line.end;
    const x0 = xIn(line, from);
    let x1 = xIn(line, to);
    if (comparePos(end, lineEnd) > 0) x1 += line.height / 4;
    if (x1 <= x0) return;
    rects.push({
      x: x0,
      y: layout.top + line.top,
      w: x1 - x0,
      h: line.height,
    });
  });
  return rects;
}
