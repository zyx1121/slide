"use client";
// The editor's overlay engine: UI that floats next to a region of a slide,
// given in slide px, such as the menu of the shapes selected on it. It is
// placed on screen from where the slide is drawn right now and kept there as
// the page scrolls or the window resizes; it sits above the region, or below
// when there is no room, slides sideways to stay on screen, keeps clear of
// the corners and the dock, and hides while the region is scrolled out of
// view. Floating UI does the placing.
import {
  autoUpdate,
  computePosition,
  flip,
  hide,
  offset,
  shift,
  type VirtualElement,
} from "@floating-ui/dom";
import { type ReactNode, useLayoutEffect, useRef } from "react";

import { SLIDE_HEIGHT, SLIDE_WIDTH } from "@/lib/deck/schema";
import type { Rect } from "@/lib/editor/geometry";

/** Room kept clear at the viewport's edges: the corners above, the dock below. */
const CLEAR = { top: 64, bottom: 88, left: 16, right: 16 };
/** Screen px between the region and what floats next to it. */
const GAP = 12;

/** The region on screen, from the slide's element and the region in slide px. */
export function regionOnScreen(slide: HTMLElement, region: Rect): DOMRect {
  const frame = slide.getBoundingClientRect();
  const kx = frame.width / SLIDE_WIDTH;
  const ky = frame.height / SLIDE_HEIGHT;
  return new DOMRect(
    frame.left + region.x * kx,
    frame.top + region.y * ky,
    region.w * kx,
    region.h * ky
  );
}

export function SlideOverlay({
  slide,
  region,
  label,
  children,
}: {
  /** The slide's element on screen; nothing shows without it. */
  slide: HTMLElement | null;
  /** What it floats next to, in slide px; nothing shows without it. */
  region: Rect | null;
  label: string;
  children: ReactNode;
}) {
  const floating = useRef<HTMLDivElement>(null);
  // The latest region, read by Floating UI as it follows scrolling, and the
  // way to place it again when the region itself moves (a shape nudged, an
  // agent's edit) without the page scrolling.
  const latest = useRef(region);
  const placeAgain = useRef<() => void>(() => {});
  const shown = slide !== null && region !== null;

  // First, so the placing below starts from the region of this render.
  const { x, y, w, h } = region ?? { x: 0, y: 0, w: 0, h: 0 };
  useLayoutEffect(() => {
    latest.current = region;
    placeAgain.current();
    // Only the region's numbers matter, not a new object with the same ones.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y, w, h]);

  useLayoutEffect(() => {
    const element = floating.current;
    if (!slide || !element) return;
    const reference: VirtualElement = {
      contextElement: slide,
      getBoundingClientRect: () =>
        latest.current
          ? regionOnScreen(slide, latest.current)
          : new DOMRect(0, 0, 0, 0),
    };
    const place = () =>
      computePosition(reference, element, {
        strategy: "fixed",
        placement: "top",
        middleware: [
          offset(GAP),
          flip({ padding: CLEAR, fallbackPlacements: ["bottom"] }),
          shift({ padding: CLEAR }),
          hide({ padding: CLEAR }),
        ],
      }).then(({ x, y, middlewareData }) => {
        element.style.left = `${x}px`;
        element.style.top = `${y}px`;
        element.style.visibility = middlewareData.hide?.referenceHidden
          ? "hidden"
          : "visible";
      });
    placeAgain.current = () => void place();
    // Placed again whenever an ancestor scrolls or the window resizes.
    return autoUpdate(reference, element, place);
  }, [slide, shown]);

  if (!shown) return null;
  return (
    <div
      ref={floating}
      role="toolbar"
      aria-label={label}
      data-slot="slide-overlay"
      data-surface="tinted"
      // Hidden until placed, so it never flashes at the top left corner.
      style={{ position: "fixed", left: 0, top: 0, visibility: "hidden" }}
      className="z-40 flex max-w-[calc(100vw-2rem)] items-center gap-0.5 overflow-x-auto rounded-2xl border p-1 shadow-sm"
      // Pointer presses here are the menu's, not the slide's below it.
      onPointerDown={(event) => event.stopPropagation()}
    >
      {children}
    </div>
  );
}
