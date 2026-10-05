// Server only: rasterizes a slide SVG with resvg, using the font files that
// scripts/fetch-fonts.sh puts in fonts/slide/ (or SLIDE_FONT_DIR).
import { existsSync } from "node:fs";
import { join } from "node:path";

import { renderAsync, Resvg, type ResvgRenderOptions } from "@resvg/resvg-js";

import { SLIDE_WIDTH } from "../deck/schema";
import { inSpan } from "../otel/span";

const FONT_FILES = [
  "Carlito-Regular.ttf",
  "Carlito-Bold.ttf",
  "Carlito-Italic.ttf",
  "Carlito-BoldItalic.ttf",
  "NotoSansTC-Regular.otf",
  "NotoSansTC-Bold.otf",
  "NotoEmoji.ttf",
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

function options(width: number): ResvgRenderOptions {
  return {
    fitTo: { mode: "width", value: width },
    background: "#ffffff",
    font: {
      fontFiles: slideFontFiles(),
      loadSystemFonts: false,
      defaultFontFamily: "Carlito",
    },
  };
}

/**
 * A slide SVG as PNG bytes, `width` px wide (1920 by default), on this
 * thread. Requests use renderPngAsync, which keeps the server responsive.
 */
export function renderPng(svg: string, width = SLIDE_WIDTH): Buffer {
  return render(svg, width).asPng();
}

/** The raw rendering, for tests that read pixels. */
export function render(svg: string, width = SLIDE_WIDTH) {
  return new Resvg(svg, options(width)).render();
}

/** Rendering is busy or took too long; the request should be retried. */
export class RenderBusyError extends Error {
  constructor(readonly reason: "busy" | "timeout") {
    super(reason === "busy" ? "too many renders waiting" : "render timed out");
  }
}

/** How many slides render at once, how many may wait, and for how long. */
export const RENDER_LIMITS = { running: 2, waiting: 8, timeoutMs: 10_000 };

let running = 0;
const queue: (() => void)[] = [];

/**
 * A slide SVG as PNG bytes, rendered on libuv's thread pool rather than the
 * request thread, a few at a time. It gives up with RenderBusyError when too
 * many renders wait or one runs past the time limit, so one huge slide
 * cannot stall every request.
 */
export async function renderPngAsync(
  svg: string,
  width = SLIDE_WIDTH,
  limits = RENDER_LIMITS
): Promise<Buffer> {
  return inSpan("render slide", { "render.width": width }, (set) =>
    renderQueued(svg, width, limits, set)
  );
}

async function renderQueued(
  svg: string,
  width: number,
  limits: typeof RENDER_LIMITS,
  set: (more: Record<string, number | string>) => void
): Promise<Buffer> {
  const queued = Date.now();
  if (running >= limits.running) {
    if (queue.length >= limits.waiting) {
      set({ "render.outcome": "busy" });
      throw new RenderBusyError("busy");
    }
    // A finishing render hands its slot over, so the count stays exact.
    await new Promise<void>((resolve) => queue.push(resolve));
  } else {
    running++;
  }
  set({ "render.waited_ms": Date.now() - queued });
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const rendered = renderAsync(svg, options(width), abort.signal);
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        // Settle first: aborting rejects the render at once.
        set({ "render.outcome": "timeout" });
        reject(new RenderBusyError("timeout"));
        abort.abort();
      }, limits.timeoutMs);
    });
    const png = (await Promise.race([rendered, timeout])).asPng();
    set({ "render.outcome": "ok", "render.png_bytes": png.length });
    return png;
  } finally {
    clearTimeout(timer);
    const next = queue.shift();
    if (next) next();
    else running--;
  }
}
