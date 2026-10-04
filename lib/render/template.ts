// The slide templates, in px on the 1920 x 1080 canvas. Every template
// shares the placeholders of the "Title & Bullets" layout in template/*.pptx;
// they differ in background, colors, the .pptx an export starts from, and
// whether the rule check holds colors to the palette.
import type { DeckDocument } from "../deck/schema";

/** Title placeholder: Calibri bold 36 pt (72 px), centered, middle. */
export const TITLE = {
  box: { x: 178, y: 10, w: 1588, h: 138 },
  size: 72,
  bold: true,
  inset: { x: 7.2, y: 7.2 },
};

/** Slide number placeholder: 14 pt (28 px), right-aligned. */
export const SLIDE_NUMBER = {
  box: { x: 1845, y: 1025, w: 45, h: 44 },
  size: 28,
  inset: { x: 7.2, y: 7.2 },
};

/** Text a member types into a shape or text box without choosing a size: 18 pt. */
export const DEFAULT_TEXT = { size: 36, color: "#000000" };

export const TEMPLATE_IDS = ["plain", "winlab"] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

export type Template = {
  id: TemplateId;
  /** The template's name in the editor. */
  name: string;
  /** The content-slide background under public/, or null for plain white. */
  background: string | null;
  titleColor: string;
  slideNumber: { color: string; bold: boolean };
  /** The file under template/ an export starts from. */
  pptx: string;
  /** Whether the rule check holds colors to the palette. */
  palette: boolean;
};

export const TEMPLATES: Record<TemplateId, Template> = {
  plain: {
    id: "plain",
    name: "空白",
    background: null,
    titleColor: "#000000",
    slideNumber: { color: "#7f7f7f", bold: false },
    pptx: "plain.pptx",
    palette: false,
  },
  winlab: {
    id: "winlab",
    name: "WinLab",
    // Gradient, logo, title rule and footer bar, from template/winlab.pptx.
    background: "/template/winlab-background.png",
    titleColor: "#3297fc",
    slideNumber: { color: "#ffffff", bold: true },
    pptx: "winlab.pptx",
    palette: true,
  },
};

/** A deck's template; a deck that names none is plain. */
export const templateOf = (document: Pick<DeckDocument, "template">) =>
  TEMPLATES[document.template ?? "plain"];
