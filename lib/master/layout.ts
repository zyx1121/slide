// A deck's master, as every renderer and editor reads it.
import type { DeckDocument, Layout, Master, Slide } from "../deck/schema";
import builtin from "./builtin.json";

export const BUILTIN_IDS = ["plain", "winlab"] as const;
export type BuiltinId = (typeof BUILTIN_IDS)[number];

/** The masters Slide ships with, from template/ (bun scripts/masters.ts). */
export const BUILTIN_MASTERS = builtin as Record<BuiltinId, Master>;

const resolved = new WeakMap<
  Layout,
  { masterShapes: Master["shapes"]; layout: Layout }
>();

/**
 * The layout a slide is drawn on, its artwork resolved: the master's shapes
 * (when the layout shows them) then its own. The same layout of the same
 * master gives the same object, so pages can keep it as a key.
 */
export function layoutOf(
  document: Pick<DeckDocument, "master">,
  slide: Pick<Slide, "layout"> | undefined
): Layout {
  const { layouts, layout: fallback, shapes } = document.master;
  const layout =
    layouts[slide?.layout ?? fallback] ?? layouts[fallback] ?? layouts[0];
  if (!layout.master || shapes.length === 0) return layout;
  const cached = resolved.get(layout);
  if (cached && cached.masterShapes === shapes) return cached.layout;
  const out = { ...layout, shapes: [...shapes, ...layout.shapes] };
  resolved.set(layout, { masterShapes: shapes, layout: out });
  return out;
}
