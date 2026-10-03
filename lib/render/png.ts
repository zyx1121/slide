// Server only: rasterizes a slide SVG with resvg, using the font files that
// scripts/fetch-fonts.sh puts in fonts/slide/ (or SLIDE_FONT_DIR).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { Resvg } from "@resvg/resvg-js";

import { SLIDE_WIDTH } from "../deck/schema";
import { BACKGROUND_PATH } from "./template";

const FONT_FILES = [
  "Carlito-Regular.ttf",
  "Carlito-Bold.ttf",
  "Carlito-Italic.ttf",
  "Carlito-BoldItalic.ttf",
  "NotoSansTC-Regular.otf",
  "NotoSansTC-Bold.otf",
];

function fontDir(): string {
  return process.env.SLIDE_FONT_DIR || join(process.cwd(), "fonts/slide");
}

/** The font files, or an error that says how to get them. */
export function slideFontFiles(): string[] {
  const dir = fontDir();
  const files = FONT_FILES.map((file) => join(dir, file));
  const missing = files.filter((file) => !existsSync(file));
  if (missing.length > 0) {
    throw new Error(
      `slide fonts are missing in ${dir}; run scripts/fetch-fonts.sh`
    );
  }
  return files;
}

let background: string | undefined;

/** The template background as a data URI, read once from public/. */
export function backgroundDataUri(): string {
  background ??= `data:image/png;base64,${readFileSync(
    join(process.cwd(), "public", BACKGROUND_PATH)
  ).toString("base64")}`;
  return background;
}

/** A slide SVG as PNG bytes, `width` px wide (1920 by default). */
export function renderPng(svg: string, width = SLIDE_WIDTH): Buffer {
  return render(svg, width).asPng();
}

/** The raw rendering, for tests that read pixels. */
export function render(svg: string, width = SLIDE_WIDTH) {
  return new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    background: "#ffffff",
    font: {
      fontFiles: slideFontFiles(),
      loadSystemFonts: false,
      defaultFontFamily: "Carlito",
    },
  }).render();
}
