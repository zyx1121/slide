// Style edits from the dock, for every selected shape that has the style:
// fill, outline, text, and connector route and arrowheads. Each edit writes
// only what changes, and the selection's current style tells the dock what
// to show.
import type { Operation } from "../deck/patch";
import type { Shape, Slide } from "../deck/schema";
import { DEFAULT_TEXT } from "../render/template";

export type Dash = "solid" | "dash" | "dot" | "dashDot";
export type Align = "left" | "center" | "right";
export type Anchor = "top" | "middle" | "bottom";
export type Route = "straight" | "elbow" | "curved";
export type Bullet = "none" | "bullet" | "number";
/** The deepest paragraph level PowerPoint offers. */
export const MAX_LEVEL = 8;
export type ArrowHead =
  "none" | "triangle" | "arrow" | "stealth" | "oval" | "diamond";

export type StyleChange =
  | { kind: "fill"; color: string | null }
  | { kind: "stroke"; color?: string; width?: number; dash?: Dash }
  | { kind: "noStroke" }
  | {
      kind: "text";
      size?: number;
      color?: string;
      bold?: boolean;
      italic?: boolean;
      underline?: boolean;
    }
  | { kind: "align"; align: Align }
  | { kind: "anchor"; anchor: Anchor }
  | { kind: "bullet"; bullet: Bullet }
  | { kind: "level"; delta: 1 | -1 }
  | { kind: "route"; route: Route }
  | { kind: "arrow"; end: "start" | "end"; head: ArrowHead };

/** The outline a shape gets when one is first set on it: WinLab's blue. */
export const DEFAULT_STROKE = { color: "#4f81bd", width: 3 };

type Text = NonNullable<Extract<Shape, { kind: "rect" }>["text"]>;

const hasFill = (shape: Shape) =>
  shape.kind !== "line" && shape.kind !== "image";
const textOf = (shape: Shape): Text | undefined =>
  shape.kind === "line" || shape.kind === "image" ? undefined : shape.text;
/** Text boxes start at the top left; text in a shape sits in its middle. */
const alignOf = (shape: Shape): Align =>
  shape.kind === "text" ? "left" : "center";
const anchorOf = (shape: Shape): Anchor =>
  shape.kind === "text" ? "top" : "middle";
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
/** A change's settings, without its kind and without what it leaves alone. */
const settings = (change: StyleChange) =>
  Object.entries(change).filter(
    ([key, value]) => key !== "kind" && value !== undefined
  );

/** The patch that applies `change` to the selected shapes of a slide. */
export function styleOps(
  slide: Slide,
  slideIndex: number,
  ids: ReadonlySet<string>,
  change: StyleChange
): Operation[] {
  const ops: Operation[] = [];
  slide.shapes.forEach((shape, i) => {
    if (!ids.has(shape.id)) return;
    const at = `/slides/${slideIndex}/shapes/${i}`;
    // `add` sets a member whether or not it is there yet (RFC 6902).
    const set = (path: string, value: unknown, current: unknown) => {
      if (!same(value, current))
        ops.push({ op: "add", path: at + path, value });
    };
    const text = textOf(shape);
    switch (change.kind) {
      case "fill":
        if (hasFill(shape)) set("/fill", change.color, shape.fill ?? null);
        break;
      case "noStroke":
        // A connector is its stroke; it cannot lose it.
        if (shape.kind !== "line") set("/stroke", null, shape.stroke ?? null);
        break;
      case "stroke": {
        const base = shape.stroke ?? DEFAULT_STROKE;
        const next = { ...base, ...Object.fromEntries(settings(change)) };
        set("/stroke", next, shape.stroke ?? null);
        break;
      }
      case "text":
        text?.paragraphs.forEach((paragraph, p) =>
          paragraph.runs.forEach((run, r) => {
            for (const [key, value] of settings(change)) {
              const current = run[key as keyof typeof run];
              set(`/text/paragraphs/${p}/runs/${r}/${key}`, value, current);
            }
          })
        );
        break;
      case "align":
        text?.paragraphs.forEach((paragraph, p) =>
          set(
            `/text/paragraphs/${p}/align`,
            change.align,
            paragraph.align ?? alignOf(shape)
          )
        );
        break;
      case "anchor":
        if (text)
          set("/text/anchor", change.anchor, text.anchor ?? anchorOf(shape));
        break;
      case "bullet":
        text?.paragraphs.forEach((paragraph, p) =>
          set(
            `/text/paragraphs/${p}/bullet`,
            change.bullet,
            paragraph.bullet ?? "none"
          )
        );
        break;
      case "level":
        text?.paragraphs.forEach((paragraph, p) =>
          set(
            `/text/paragraphs/${p}/level`,
            shiftLevel(paragraph.level, change.delta),
            paragraph.level ?? 0
          )
        );
        break;
      case "route":
        if (shape.kind === "line") set("/route", change.route, shape.route);
        break;
      case "arrow":
        if (shape.kind === "line") {
          const key = change.end === "start" ? "startArrow" : "endArrow";
          set(`/${key}`, change.head, shape[key] ?? "none");
        }
        break;
    }
  });
  return ops;
}

/** A paragraph level moved one step, within PowerPoint's nine levels. */
export const shiftLevel = (level: number | undefined, delta: 1 | -1) =>
  Math.max(0, Math.min(MAX_LEVEL, (level ?? 0) + delta));

/** One value shared by every shape it applies to, or "mixed". */
export type Shared<T> = T | "mixed";

function shared<T>(values: T[]): Shared<T> | undefined {
  if (values.length === 0) return undefined;
  return values.every((value) => same(value, values[0])) ? values[0] : "mixed";
}

/**
 * What the selection looks like, for the dock. A group is present only when
 * every selected shape has it (fill, outline, connector), or for text, when
 * any selected shape holds text.
 */
export type SelectionStyle = {
  fill?: Shared<string | null>;
  stroke?: {
    color: Shared<string | null>;
    width: Shared<number | null>;
    dash: Shared<Dash>;
    /** Whether "no outline" may be chosen: connectors always keep theirs. */
    optional: boolean;
  };
  text?: {
    size: Shared<number>;
    color: Shared<string>;
    bold: Shared<boolean>;
    italic: Shared<boolean>;
    underline: Shared<boolean>;
    align: Shared<Align>;
    anchor: Shared<Anchor>;
    bullet: Shared<Bullet>;
  };
  line?: {
    route: Shared<Route>;
    start: Shared<ArrowHead>;
    end: Shared<ArrowHead>;
  };
};

type TextParagraph = Text["paragraphs"][number];
type RunLike = Omit<TextParagraph["runs"][number], "text">;

/**
 * What the dock shows for text: the styles of the given runs and
 * paragraphs. Text without runs yet shows the defaults it would get.
 */
export function textStyle(
  runs: RunLike[],
  paragraphs: Omit<TextParagraph, "runs">[],
  aligns: Align[],
  anchors: Anchor[],
  defaults: { size: number; color: string; bold: boolean } = {
    ...DEFAULT_TEXT,
    bold: false,
  }
): NonNullable<SelectionStyle["text"]> {
  return {
    size: shared(runs.map((run) => run.size ?? defaults.size)) ?? defaults.size,
    color:
      shared(runs.map((run) => run.color ?? defaults.color)) ?? defaults.color,
    bold: shared(runs.map((run) => run.bold ?? defaults.bold)) ?? defaults.bold,
    italic: shared(runs.map((run) => run.italic ?? false)) ?? false,
    underline: shared(runs.map((run) => run.underline ?? false)) ?? false,
    align: shared(aligns) ?? "left",
    anchor: shared(anchors) ?? "top",
    bullet:
      shared(paragraphs.map((paragraph) => paragraph.bullet ?? "none")) ??
      "none",
  };
}

export function selectionStyle(
  slide: Slide,
  ids: ReadonlySet<string>
): SelectionStyle {
  const picked = slide.shapes.filter((shape) => ids.has(shape.id));
  if (picked.length === 0) return {};
  const style: SelectionStyle = {};

  if (picked.every(hasFill)) {
    style.fill = shared(
      picked.map((shape) => ("fill" in shape ? (shape.fill ?? null) : null))
    );
  }
  style.stroke = {
    color: shared(picked.map((shape) => shape.stroke?.color ?? null))!,
    width: shared(picked.map((shape) => shape.stroke?.width ?? null))!,
    dash: shared(picked.map((shape) => shape.stroke?.dash ?? "solid"))!,
    optional: picked.every((shape) => shape.kind !== "line"),
  };

  const runs: Text["paragraphs"][number]["runs"] = [];
  const paragraphs: TextParagraph[] = [];
  const aligns: Align[] = [];
  const anchors: Anchor[] = [];
  for (const shape of picked) {
    const text = textOf(shape);
    if (!text) continue;
    anchors.push(text.anchor ?? anchorOf(shape));
    for (const paragraph of text.paragraphs) {
      aligns.push((paragraph.align as Align | undefined) ?? alignOf(shape));
      runs.push(...paragraph.runs);
      paragraphs.push(paragraph);
    }
  }
  if (anchors.length > 0) {
    style.text = textStyle(runs, paragraphs, aligns, anchors);
  }

  if (picked.every((shape) => shape.kind === "line")) {
    const lines = picked as Extract<Shape, { kind: "line" }>[];
    style.line = {
      route: shared(lines.map((line) => line.route))!,
      start: shared(lines.map((line) => line.startArrow ?? "none"))!,
      end: shared(lines.map((line) => line.endArrow ?? "none"))!,
    };
  }
  return style;
}
