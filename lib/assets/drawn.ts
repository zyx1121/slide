// Which pictures a deck draws: on its slides, and in its layouts'
// backgrounds and artwork.
import type { DeckDocument, Layout, Shape, Slide } from "../deck/schema";

const pictures = (shapes: readonly Shape[]) =>
  shapes.flatMap((shape) => (shape.kind === "image" ? [shape.asset] : []));

/** A layout's background picture, if it has one. */
const backgroundPicture = (layout: Layout) =>
  layout.background &&
  typeof layout.background === "object" &&
  "image" in layout.background
    ? [layout.background.image]
    : [];

/**
 * The assets a slide draws, its layout's background and artwork first when
 * given.
 */
export function slideAssets(slide: Slide, layout?: Layout): string[] {
  return [
    ...new Set([
      ...(layout ? backgroundPicture(layout) : []),
      ...pictures(layout?.shapes ?? []),
      ...pictures(slide.shapes),
    ]),
  ];
}

/** The assets a deck draws: its slides', and its layouts' and master's. */
export function documentAssets(document: DeckDocument): string[] {
  return [
    ...new Set([
      ...pictures(document.master.shapes),
      ...document.master.layouts.flatMap((layout) => [
        ...backgroundPicture(layout),
        ...pictures(layout.shapes),
      ]),
      ...document.slides.flatMap((slide) => pictures(slide.shapes)),
    ]),
  ];
}
