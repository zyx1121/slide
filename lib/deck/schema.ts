// The deck document: what a deck is, independent of how it is drawn. Fields
// follow DrawingML (preset geometry, a box with rotation, connector sites) so
// .pptx export and import map one to one. Every write is validated here.
import * as z from "zod";

import { DECK_TITLE_MAX, SHAPE_TEXT_MAX, SLIDE_TEXT_MAX } from "./limits";
import { parsePath, PATH_MAX } from "./path";

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
// Postgres cannot store U+0000 in jsonb, so no text may hold it.
const noNul = (value: string) => !value.includes("\u0000");
const NUL = "text cannot contain U+0000";
const Text = (max: number) => z.string().max(max).refine(noNul, NUL);
const Coord = z.number().min(-10_000).max(10_000);
const Length = z.number().min(0).max(10_000);
const Color = z
  .string()
  .regex(
    /^#[0-9a-f]{6}([0-9a-f]{2})?$/i,
    "colors look like #3297fc, or #3297fc80 with alpha"
  );

export const Run = z.strictObject({
  text: Text(10_000),
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
  /** The bullet's character, when it is not "•" (as "–" or "»"). */
  bulletChar: z
    .string()
    .refine(
      (c) => [...c].length === 1 && !/[\u0000-\u001f\u007f-\u009f\s]/.test(c),
      "a bullet is one visible character"
    )
    .optional(),
  level: z.number().int().min(0).max(8).optional(),
  /** Line pitch as a multiple of single spacing (lnSpc in percent). */
  lineSpacing: z.number().min(0.1).max(10).optional(),
  /** Space above and below the paragraph, in px (spcBef, spcAft). */
  spaceBefore: z.number().min(0).max(2000).optional(),
  spaceAfter: z.number().min(0).max(2000).optional(),
});

export const TextBody = z.strictObject({
  paragraphs: z.array(Paragraph).min(1).max(500),
  anchor: z.enum(["top", "middle", "bottom"]).optional(),
  /** False keeps each paragraph on one line (PowerPoint's wrap="none"). */
  wrap: z.boolean().optional(),
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

/** PowerPoint presets drawn at their default adjustments. */
export const PresetGeometry = z.enum([
  "triangle",
  "rtTriangle",
  "diamond",
  "parallelogram",
  "trapezoid",
  "homePlate",
  "chevron",
  "rightArrow",
  "leftArrow",
  "upArrow",
  "downArrow",
  "leftRightArrow",
  "upDownArrow",
  "leftBracket",
  "rightBracket",
]);
export type PresetGeometry = z.infer<typeof PresetGeometry>;

/** Any other preset shape, by its DrawingML name. */
export const Preset = z.strictObject({
  id: Id,
  kind: z.literal("preset"),
  geometry: PresetGeometry,
  ...box,
  ...paint,
  text: TextBody.optional(),
});

/** A custom outline (a:custGeom), stretched over its box; see ./path. */
export const Freeform = z.strictObject({
  id: Id,
  kind: z.literal("freeform"),
  ...box,
  ...paint,
  text: TextBody.optional(),
  path: z
    .string()
    .max(PATH_MAX)
    .refine(
      (d) => parsePath(d) !== null,
      "paths use M, L, C, Q and Z with coordinates 0 to 1000 across the box"
    ),
});

export const TextBox = z.strictObject({
  id: Id,
  kind: z.literal("text"),
  ...box,
  ...paint,
  text: TextBody,
});

/** How much of the picture each side cuts away (or pads), as a fraction of it. */
// Negative sides pad the picture with empty space inside its box, as
// PowerPoint's a:srcRect allows.
const CropSide = z.number().min(-1).max(0.99);
export const Crop = z
  .strictObject({
    left: CropSide,
    top: CropSide,
    right: CropSide,
    bottom: CropSide,
  })
  .refine(
    (crop) => crop.left + crop.right < 1 && crop.top + crop.bottom < 1,
    "a crop must leave some of the picture"
  );

export const Image = z.strictObject({
  id: Id,
  kind: z.literal("image"),
  ...box,
  /** sha256 of the bytes in the assets table. */
  asset: z.string().regex(/^[0-9a-f]{64}$/, "assets are sha256 hex digests"),
  /** The part of the picture shown, stretched over the box (a:srcRect). */
  crop: Crop.optional(),
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
  Preset,
  Freeform,
  TextBox,
  Image,
  Line,
]);

export const Slide = z.strictObject({
  id: Id,
  /** The title placeholder; its position and style come from the template. */
  title: Text(500),
  /** Back to front: later shapes are drawn on top. */
  shapes: z.array(Shape).max(1000),
  notes: Text(50_000).optional(),
});

export const DeckDocument = z
  .strictObject({
    schema: z.literal(SCHEMA_VERSION),
    title: z.string().trim().min(1).max(DECK_TITLE_MAX).refine(noNul, NUL),
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
      let slideText = slide.title.length;
      slide.shapes.forEach((shape, i) => {
        if (shape.kind === "line" || shape.kind === "image" || !shape.text) {
          return;
        }
        let shapeText = 0;
        for (const paragraph of shape.text.paragraphs) {
          for (const run of paragraph.runs) shapeText += run.text.length;
        }
        slideText += shapeText;
        if (shapeText > SHAPE_TEXT_MAX) {
          ctx.addIssue({
            code: "custom",
            message: `a shape holds at most ${SHAPE_TEXT_MAX} characters of text`,
            path: ["slides", s, "shapes", i, "text"],
          });
        }
      });
      if (slideText > SLIDE_TEXT_MAX) {
        ctx.addIssue({
          code: "custom",
          message: `a slide holds at most ${SLIDE_TEXT_MAX} characters of text`,
          path: ["slides", s],
        });
      }
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

/**
 * Why a stored document cannot be edited, in a sentence for its member, or
 * null when it is valid. Every write validates the whole result, so a deck
 * stored before a schema change (or written around the mutation path) would
 * refuse every edit without saying why.
 */
export function storedDocumentProblem(document: unknown): string | null {
  const parsed = DeckDocument.safeParse(document);
  if (parsed.success) return null;
  const [first] = describeIssues(parsed.error);
  return `這份簡報有一筆資料不符合格式（${first}），所以現在不能編輯。請把這段訊息回報給維護者。`;
}
