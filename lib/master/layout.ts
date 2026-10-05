// A deck's master, as every renderer and editor reads it.
import type { DeckDocument, Layout, Master, Slide } from "../deck/schema";
import builtin from "./builtin.json";

export const BUILTIN_IDS = ["plain", "winlab"] as const;
export type BuiltinId = (typeof BUILTIN_IDS)[number];

/** The masters Slide ships with, from template/ (bun scripts/masters.ts). */
export const BUILTIN_MASTERS = builtin as Record<BuiltinId, Master>;

/** The layout a slide is drawn on. */
export function layoutOf(
  document: Pick<DeckDocument, "master">,
  slide: Pick<Slide, "layout"> | undefined
): Layout {
  const { layouts, layout } = document.master;
  return layouts[slide?.layout ?? layout] ?? layouts[layout] ?? layouts[0];
}
