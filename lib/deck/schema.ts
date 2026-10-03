// The deck document: what a deck is, independent of how it is drawn. Fields
// follow DrawingML (preset geometry, a box with rotation, connector sites) so
// .pptx export and import map one to one. Every write is validated here.
import * as z from "zod";

import { DECK_TITLE_MAX } from "./limits";

export const SCHEMA_VERSION = 1;

/**
 * The slide canvas in px. One px is 6350 EMU, half a point, so 1920 x 1080 is
 * PowerPoint's 13.333 x 7.5 in widescreen slide.
 */
export const SLIDE_WIDTH = 1920;
export const SLIDE_HEIGHT = 1080;

const Id = z
  .string()
  .regex(/^[a-z]+_[0-9a-z_-]{2,48}$/, "ids look like sh_k4m9x2qa");
const Coord = z.number().min(-10_000).max(10_000);
const Length = z.number().min(0).max(10_000);
const Color = z
  .string()
  .regex(
    /^#[0-9a-f]{6}([0-9a-f]{2})?$/i,
    "colors look like #3297fc, or #3297fc80 with alpha"
  );

export const Run = z.strictObject({
  text: z.string().max(10_000),
  /** px on the 1920 x 1080 canvas; PowerPoint points are half of it. */
  size: z.number().min(1).max(800).optional(),
  color: Color.optional(),
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strike: z.boolean().optional(),
});

export const Paragraph = z.strictObject({
  runs: z.array(Run).max(500),
  align: z.enum(["left", "center", "right", "justify"]).optional(),
  bullet: z.enum(["none", "bullet", "number"]).optional(),
  level: z.number().int().min(0).max(8).optional(),
});

export const TextBody = z.strictObject({
  paragraphs: z.array(Paragraph).min(1).max(500),
  anchor: z.enum(["top", "middle", "bottom"]).optional(),
});

export const Stroke = z.strictObject({
  color: Color,
  width: z.number().min(0).max(200),
  dash: z.enum(["solid", "dash", "dot", "dashDot"]).optional(),
});

const box = {
  x: Coord,
  y: Coord,
  w: Length,
  h: Length,
  /** Degrees clockwise around the box center. */
  rotation: z.number().min(-360).max(360).optional(),
};

const paint = {
  fill: Color.nullable().optional(),
  stroke: Stroke.nullable().optional(),
};

export const Rect = z.strictObject({
  id: Id,
  kind: z.literal("rect"),
  ...box,
  ...paint,
  text: TextBody.optional(),
});

export const RoundRect = z.strictObject({
  id: Id,
  kind: z.literal("roundRect"),
  ...box,
  ...paint,
  text: TextBody.optional(),
  /** Corner radius as a fraction of the shorter side, as PowerPoint keeps it. */
  corner: z.number().min(0).max(0.5).optional(),
});

export const Ellipse = z.strictObject({
  id: Id,
  kind: z.literal("ellipse"),
  ...box,
  ...paint,
  text: TextBody.optional(),
});

export const TextBox = z.strictObject({
  id: Id,
  kind: z.literal("text"),
  ...box,
  ...paint,
  text: TextBody,
});

export const Image = z.strictObject({
  id: Id,
  kind: z.literal("image"),
  ...box,
  /** sha256 of the bytes in the assets table. */
  asset: z.string().regex(/^[0-9a-f]{64}$/, "assets are sha256 hex digests"),
  stroke: Stroke.nullable().optional(),
});

export const Arrow = z.enum([
  "none",
  "triangle",
  "arrow",
  "stealth",
  "oval",
  "diamond",
]);

/**
 * A connector end glued to a shape. Sites follow PowerPoint's preset
 * geometry for rectangles, rounded rectangles and ellipses: 0 top, 1 left,
 * 2 bottom, 3 right.
 */
export const Attached = z.strictObject({
  shape: Id,
  site: z.number().int().min(0).max(3),
});

/** A connector end at a fixed point on the canvas. */
export const Free = z.strictObject({ x: Coord, y: Coord });

export const End = z.union([Attached, Free]);

export const Line = z.strictObject({
  id: Id,
  kind: z.literal("line"),
  route: z.enum(["straight", "elbow", "curved"]),
  start: End,
  end: End,
  stroke: Stroke,
  startArrow: Arrow.optional(),
  endArrow: Arrow.optional(),
});

export const Shape = z.discriminatedUnion("kind", [
  Rect,
  RoundRect,
  Ellipse,
  TextBox,
  Image,
  Line,
]);

export const Slide = z.strictObject({
  id: Id,
  /** The title placeholder; its position and style come from the template. */
  title: z.string().max(500),
  /** Back to front: later shapes are drawn on top. */
  shapes: z.array(Shape).max(1000),
  notes: z.string().max(50_000).optional(),
});

export const DeckDocument = z
  .strictObject({
    schema: z.literal(SCHEMA_VERSION),
    title: z.string().trim().min(1).max(DECK_TITLE_MAX),
    slides: z.array(Slide).min(1).max(500),
  })
  .superRefine((document, ctx) => {
    const seen = new Map<string, string>();
    const claim = (id: string, path: (string | number)[]) => {
      const first = seen.get(id);
      if (first !== undefined) {
        ctx.addIssue({
          code: "custom",
          message: `id ${id} is already used at ${first}`,
          path,
        });
      } else {
        seen.set(id, path.join("."));
      }
    };

    document.slides.forEach((slide, s) => {
      claim(slide.id, ["slides", s, "id"]);
      const kinds = new Map<string, string>();
      slide.shapes.forEach((shape, i) => {
        claim(shape.id, ["slides", s, "shapes", i, "id"]);
        kinds.set(shape.id, shape.kind);
      });
      slide.shapes.forEach((shape, i) => {
        if (shape.kind !== "line") return;
        for (const side of ["start", "end"] as const) {
          const end = shape[side];
          if (!("shape" in end)) continue;
          const target = kinds.get(end.shape);
          const path = ["slides", s, "shapes", i, side, "shape"];
          if (target === undefined) {
            ctx.addIssue({
              code: "custom",
              message: `${end.shape} is not a shape on this slide`,
              path,
            });
          } else if (target === "line") {
            ctx.addIssue({
              code: "custom",
              message: `${end.shape} is a line; lines attach to shapes only`,
              path,
            });
          }
        }
      });
    });
  });

export type DeckDocument = z.infer<typeof DeckDocument>;
export type Slide = z.infer<typeof Slide>;
export type Shape = z.infer<typeof Shape>;
export type TextBody = z.infer<typeof TextBody>;

/** One readable line per problem, path first, for people and agents alike. */
export function describeIssues(error: z.ZodError): string[] {
  return error.issues.map(
    (issue) => `${issue.path.join(".") || "(document)"}: ${issue.message}`
  );
}
