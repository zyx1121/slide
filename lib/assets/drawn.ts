// Which pictures a deck draws: on its slides, and in its layouts' artwork.
import type { DeckDocument, Layout, Slide } from "../deck/schema";

/** The assets a slide draws, its layout's artwork first when given. */
export function slideAssets(slide: Slide, layout?: Layout): string[] {
  return [
    ...new Set(
      [...(layout?.shapes ?? []), ...slide.shapes].flatMap((shape) =>
        shape.kind === "image" ? [shape.asset] : []
      )
    ),
  ];
}

/** The assets a deck draws: its slides' and its layouts' artwork. */
export function documentAssets(document: DeckDocument): string[] {
  return [
    ...new Set([
      ...slideAssets({
        id: "sl_master",
        title: "",
        shapes: document.master.shapes,
      }),
      ...document.master.layouts.flatMap((layout) =>
        slideAssets({ id: "sl_layout", title: "", shapes: layout.shapes })
      ),
      ...document.slides.flatMap((slide) => slideAssets(slide)),
    ]),
  ];
}
