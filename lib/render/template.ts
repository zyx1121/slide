// The WinLab master (template/winlab.pptx), in px on the 1920 x 1080 canvas.
// Values come from the master's "Title & Bullets" layout.

/** The content-slide background: gradient, logo, title rule, footer bar. */
export const BACKGROUND_PATH = "/template/winlab-background.png";

/** Title placeholder: Calibri bold 36 pt (72 px), #3297fc, centered, middle. */
export const TITLE = {
  box: { x: 178, y: 10, w: 1588, h: 138 },
  size: 72,
  color: "#3297fc",
  bold: true,
  inset: { x: 7.2, y: 7.2 },
};

/** Slide number placeholder: bold white 14 pt (28 px), right-aligned, on the footer bar. */
export const SLIDE_NUMBER = {
  box: { x: 1845, y: 1025, w: 45, h: 44 },
  size: 28,
  color: "#ffffff",
  bold: true,
  inset: { x: 7.2, y: 7.2 },
};

/** Text a member types into a shape or text box without choosing a size: 18 pt. */
export const DEFAULT_TEXT = { size: 36, color: "#000000" };
