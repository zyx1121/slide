// One text being edited in place: the shape or slide title it belongs to,
// the draft of its text, the selection in it and any IME composition. The
// draft is written to the document as an ordinary edit when typing pauses
// and when editing ends.
import type { Operation } from "../deck/patch";
import type { Shape, Slide, TextBody } from "../deck/schema";
import {
  holdsText,
  shapeTextDefaults,
  titleBody,
  titleText,
} from "../render/svg";
import { TITLE } from "../render/template";
import { layoutText, type TextDefaults, type TextLayout } from "../render/text";
import { tidy, toLocal } from "./geometry";
import { deleteOps } from "./ops";
import { hitPos } from "./text-caret";
import {
  EMPTY_BODY,
  isEmpty,
  ordered,
  paragraphText,
  type Pos,
  replaceRange,
  type RunStyle,
  styleAt,
  type TextSelection,
} from "./text-edit";

/** The target that edits the slide title instead of a shape. */
export const TITLE_ID = "title";

export type TextDraft = {
  /** The slide, by position and id, and the shape (or TITLE_ID) edited. */
  slide: number;
  slideId: string;
  target: string;
  body: TextBody;
  selection: TextSelection;
  /** Text an IME is composing, shown at the selection until it commits. */
  composition: string | null;
  /** Style chosen at a collapsed caret, for the text typed next. */
  typing: RunStyle | null;
  /** The x the caret keeps while it moves up and down lines. */
  goal: number | null;
  /** Whether the draft differs from what was last written. */
  dirty: boolean;
};

/** Where a text is laid out, and how. */
export type TextFrame = {
  box: { x: number; y: number; w: number; h: number };
  rotation: number;
  defaults: TextDefaults;
  /** False for the title: Enter breaks a line inside its one paragraph. */
  paragraphs: boolean;
};

export function frameOf(slide: Slide, target: string): TextFrame | null {
  if (target === TITLE_ID) {
    return {
      box: TITLE.box,
      rotation: 0,
      defaults: titleText(slide.title),
      paragraphs: false,
    };
  }
  const shape = slide.shapes.find((item) => item.id === target);
  if (!shape || !holdsText(shape)) return null;
  return {
    box: { x: shape.x, y: shape.y, w: shape.w, h: shape.h },
    rotation: shape.rotation ?? 0,
    defaults: shapeTextDefaults(shape.kind),
    paragraphs: true,
  };
}

/** The target's text as the document has it. */
export function storedBody(slide: Slide, target: string): TextBody | null {
  if (target === TITLE_ID) return titleBody(slide.title);
  const shape = slide.shapes.find((item) => item.id === target);
  if (!shape || !holdsText(shape)) return null;
  return shape.text ?? EMPTY_BODY;
}

/** A new draft of a target's text, or null when it holds no text. */
export function startDraft(
  slide: Slide,
  slideIndex: number,
  target: string,
  selection: (body: TextBody) => TextSelection
): TextDraft | null {
  const body = storedBody(slide, target);
  if (!body) return null;
  return {
    slide: slideIndex,
    slideId: slide.id,
    target,
    body,
    selection: selection(body),
    composition: null,
    typing: null,
    goal: null,
    dirty: false,
  };
}

/**
 * The body as it is shown: the draft with any composition in place of the
 * selection, underlined as IMEs show it, and where the caret is then.
 */
export function shownBody(draft: TextDraft): {
  body: TextBody;
  selection: TextSelection;
} {
  if (draft.composition === null) {
    return { body: draft.body, selection: draft.selection };
  }
  const [start, end] = ordered(draft.selection);
  const style = { ...(draft.typing ?? styleAt(draft.body, start)) };
  const { body, caret } = replaceRange(
    draft.body,
    start,
    end,
    draft.composition,
    { ...style, underline: true },
    false
  );
  return { body, selection: { anchor: caret, focus: caret } };
}

/**
 * The height a text box takes for its text: one without fill or outline
 * grows and shrinks with it, as PowerPoint's text boxes do by default, so
 * the box stays where its text is. Null for every other shape.
 */
export function fittedHeight(shape: Shape, body: TextBody): number | null {
  if (shape.kind !== "text" || shape.fill || shape.stroke) return null;
  if ((body.anchor ?? "top") !== "top") return null;
  const defaults = shapeTextDefaults("text");
  const layout = layoutText(body, shape, defaults);
  return tidy(layout.height + 2 * defaults.inset.y);
}

/** The slide with the draft shown in place of the target's stored text. */
export function draftSlide(slide: Slide, draft: TextDraft): Slide {
  const { body } = shownBody(draft);
  if (draft.target === TITLE_ID) {
    return { ...slide, title: paragraphText(body.paragraphs[0]) };
  }
  return {
    ...slide,
    shapes: slide.shapes.map((shape) =>
      shape.id === draft.target && holdsText(shape)
        ? { ...shape, text: body, h: fittedHeight(shape, body) ?? shape.h }
        : shape
    ),
  };
}

/**
 * Where a canvas point falls on a text: whether inside its frame, and the
 * nearest position in the text.
 */
export function pointInFrame(
  frame: TextFrame,
  layout: TextLayout,
  p: { x: number; y: number }
): { inside: boolean; pos: Pos } {
  const { box } = frame;
  const local = toLocal({ ...box, rotation: frame.rotation }, p);
  const inside =
    Math.abs(local.x) <= box.w / 2 && Math.abs(local.y) <= box.h / 2;
  return {
    inside,
    pos: hitPos(layout, local.x + box.w / 2, local.y + box.h / 2),
  };
}

/** The layout of the shown text in its frame. */
export function draftLayout(frame: TextFrame, body: TextBody): TextLayout {
  return layoutText(body, frame.box, frame.defaults);
}

/**
 * The patch that writes the draft. When editing ends, an emptied text box
 * is deleted, as PowerPoint does, and a shape left without text loses its
 * text body.
 */
export function draftOps(
  slide: Slide,
  slideIndex: number,
  draft: TextDraft,
  final: boolean
): Operation[] {
  if (draft.target === TITLE_ID) {
    const title = paragraphText(draft.body.paragraphs[0]);
    return title === slide.title
      ? []
      : [{ op: "replace", path: `/slides/${slideIndex}/title`, value: title }];
  }
  const index = slide.shapes.findIndex((shape) => shape.id === draft.target);
  const shape = slide.shapes[index];
  if (!shape || !holdsText(shape)) return [];
  const path = `/slides/${slideIndex}/shapes/${index}/text`;
  if (final && isEmpty(draft.body)) {
    if (shape.kind === "text") {
      return deleteOps(slide, slideIndex, new Set([shape.id]));
    }
    return shape.text ? [{ op: "remove", path }] : [];
  }
  const ops: Operation[] = [];
  if (JSON.stringify(shape.text ?? EMPTY_BODY) !== JSON.stringify(draft.body)) {
    // `add` sets the member whether or not the shape has text yet.
    ops.push({ op: "add", path, value: draft.body });
  }
  const h = fittedHeight(shape, draft.body);
  if (h !== null && h !== shape.h) {
    ops.push({
      op: "replace",
      path: `/slides/${slideIndex}/shapes/${index}/h`,
      value: h,
    });
  }
  return ops;
}
