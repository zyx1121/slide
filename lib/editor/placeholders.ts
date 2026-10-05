// A layout's text placeholders on a slide: the empty boxes a new slide gets,
// and a placeholder box made plain where its layout no longer holds it.
import type { Layout, Shape } from "../deck/schema";
import { newId } from "../ids";
import { bodyOf } from "../render/svg";

type TextBox = Extract<Shape, { kind: "text" }>;

/**
 * Empty text boxes for a layout's text placeholders, where it puts them: a
 * new slide's places to type, as PowerPoint gives a slide from its layout.
 */
export function placeholderShapes(
  layout: Pick<Layout, "bodies"> | undefined,
  taken?: Set<string>
): TextBox[] {
  return (layout?.bodies ?? []).map((body) => {
    let id = newId("tx");
    while (taken?.has(id)) id = newId("tx");
    taken?.add(id);
    return {
      id,
      kind: "text",
      x: body.x,
      y: body.y,
      w: body.w,
      h: body.h,
      ...(body.rotation ? { rotation: body.rotation } : {}),
      text: { paragraphs: [{ runs: [] }] },
      placeholder: body.key,
    };
  });
}

/**
 * A placeholder's box as a plain text box: what it took from its layout
 * written into its text, so it looks the same away from that layout.
 */
export function bakePlaceholder(shape: TextBox, layout: Layout | undefined) {
  const { placeholder, ...plain } = shape;
  const body = bodyOf(layout, placeholder);
  if (!body) return plain;
  const levelOf = (level: number) =>
    body.levels[Math.min(level, body.levels.length - 1)];
  return {
    ...plain,
    text: {
      ...shape.text,
      anchor: shape.text.anchor ?? body.anchor,
      paragraphs: shape.text.paragraphs.map((paragraph) => {
        const lv = levelOf(paragraph.level ?? 0);
        const bullet = paragraph.bullet ?? lv.bullet;
        const bulletChar = paragraph.bulletChar ?? lv.bulletChar;
        const lineSpacing = paragraph.lineSpacing ?? lv.lineSpacing;
        const spaceBefore = paragraph.spaceBefore ?? lv.spaceBefore;
        const spaceAfter = paragraph.spaceAfter ?? lv.spaceAfter;
        return {
          ...paragraph,
          align: paragraph.align ?? lv.align,
          ...(bullet !== "none" ? { bullet } : {}),
          ...(bullet === "bullet" && bulletChar ? { bulletChar } : {}),
          ...(lineSpacing !== undefined ? { lineSpacing } : {}),
          ...(spaceBefore !== undefined ? { spaceBefore } : {}),
          ...(spaceAfter !== undefined ? { spaceAfter } : {}),
          runs: paragraph.runs.map((run) => ({
            ...run,
            size: run.size ?? lv.size,
            color: run.color ?? lv.color,
            bold: run.bold ?? lv.bold,
          })),
        };
      }),
    },
  };
}

/** Whether a box is where a placeholder puts it, to a pixel. */
export const atPlace = (
  shape: TextBox,
  place: { x: number; y: number; w: number; h: number }
) =>
  Math.abs(shape.x - place.x) < 1 &&
  Math.abs(shape.y - place.y) < 1 &&
  Math.abs(shape.w - place.w) < 1 &&
  Math.abs(shape.h - place.h) < 1;
