"use client";

import {
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { SLIDE_HEIGHT, SLIDE_WIDTH, type Slide } from "@/lib/deck/schema";
import {
  type Box,
  containsPoint,
  cornersOf,
  type Handle,
  HANDLES,
  handlePoint,
  hitTest,
  linePoints,
  type Point,
  type Rect,
  rectBetween,
  resizeBox,
  shapeBounds,
  shapesInRect,
  unionRects,
} from "@/lib/editor/geometry";
import { movedSlide, resizedSlide } from "@/lib/editor/preview";
import { ALL_EDGES, type Edges, type Guide, snapRect } from "@/lib/editor/snap";
import { renderSlideSvg } from "@/lib/render/svg";
import { BACKGROUND_PATH } from "@/lib/render/template";
import { cn } from "@/lib/utils";

/** Screen px within which a click picks a connector or a handle, and snaps. */
const PICK = 6;
const HANDLE = 10;
const SNAP = 6;

const CURSORS: Record<Handle, string> = {
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  nw: "nwse-resize",
  se: "nwse-resize",
};

type Drag =
  | {
      kind: "move";
      origin: Point;
      ids: Set<string>;
      /** The shape under the pointer, selected alone if the press was a click. */
      hit: string;
      start: Rect;
      dx: number;
      dy: number;
      guides: Guide[];
    }
  | {
      kind: "resize";
      origin: Point;
      id: string;
      handle: Handle;
      start: Box;
      box: Box;
      guides: Guide[];
    }
  | {
      kind: "marquee";
      origin: Point;
      current: Point;
      base: string[];
    };

const boxOf = (shape: Box): Box => ({
  x: shape.x,
  y: shape.y,
  w: shape.w,
  h: shape.h,
  rotation: shape.rotation,
});

const points = (list: Point[]) => list.map((p) => `${p.x},${p.y}`).join(" ");

/**
 * The slide being edited: drawn by the shared renderer, with selection,
 * handles, smart guides and the marquee drawn over it. Pointer gestures
 * preview locally and report their result once, on release.
 */
export function Canvas({
  slide,
  number,
  selection,
  onSelect,
  onMove,
  onResize,
  onGestureStart,
  onKeyDown,
  className,
}: {
  slide: Slide;
  number: number;
  selection: string[];
  onSelect: (ids: string[]) => void;
  onMove: (ids: ReadonlySet<string>, dx: number, dy: number) => void;
  onResize: (id: string, box: Box) => void;
  /** Called as a pointer gesture begins, before it reads any shape. */
  onGestureStart: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(SLIDE_WIDTH);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [cursor, setCursor] = useState("default");

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width || SLIDE_WIDTH)
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  /** Canvas px per screen px. */
  const scale = SLIDE_WIDTH / width;
  const shapes = useMemo(
    () => new Map(slide.shapes.map((shape) => [shape.id, shape])),
    [slide]
  );

  const preview =
    drag?.kind === "move"
      ? movedSlide(slide, drag.ids, drag.dx, drag.dy)
      : drag?.kind === "resize"
        ? resizedSlide(slide, drag.id, drag.box)
        : slide;
  const svg = useMemo(
    () =>
      renderSlideSvg(preview, {
        slideNumber: number,
        background: BACKGROUND_PATH,
        assetHref: () => null,
      }),
    [preview, number]
  );

  const single = selection.length === 1 ? shapes.get(selection[0]) : undefined;
  const box = single && single.kind !== "line" ? single : undefined;

  const toCanvas = (event: PointerEvent): Point => {
    const rect = ref.current!.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) * SLIDE_WIDTH) / rect.width,
      y: ((event.clientY - rect.top) * SLIDE_HEIGHT) / rect.height,
    };
  };
  // A box too small for its handles moves when pressed inside; its handles
  // still work from outside it.
  const handleAt = (p: Point): Handle | undefined => {
    if (!box) return undefined;
    const small = Math.min(box.w, box.h) < 3 * HANDLE * scale;
    if (small && containsPoint(box, p)) return undefined;
    return HANDLES.find((handle) => {
      const q = handlePoint(box, handle);
      return Math.hypot(q.x - p.x, q.y - p.y) <= HANDLE * scale;
    });
  };
  const targetsFor = (moving: (id: string) => boolean) =>
    slide.shapes
      .filter((shape) => shape.kind !== "line" && !moving(shape.id))
      .map((shape) => shapeBounds(shape, shapes));

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    onGestureStart();
    // The press focuses the canvas by default (without a focus ring), so
    // the keyboard works right after a click.
    event.currentTarget.setPointerCapture(event.pointerId);
    const p = toCanvas(event);

    const handle = handleAt(p);
    if (box && handle) {
      const start = boxOf(box);
      setDrag({
        kind: "resize",
        origin: p,
        id: box.id,
        handle,
        start,
        box: start,
        guides: [],
      });
      return;
    }

    const hit = hitTest(slide, p, PICK * scale);
    if (!hit) {
      if (!event.shiftKey) onSelect([]);
      setDrag({
        kind: "marquee",
        origin: p,
        current: p,
        base: event.shiftKey ? selection : [],
      });
      return;
    }

    let ids = selection;
    if (event.shiftKey) {
      ids = selection.includes(hit)
        ? selection.filter((id) => id !== hit)
        : [...selection, hit];
      onSelect(ids);
      if (!ids.includes(hit)) return;
    } else if (!selection.includes(hit)) {
      ids = [hit];
      onSelect(ids);
    }
    const moving = new Set(ids);
    const start = unionRects(
      slide.shapes
        .filter((shape) => moving.has(shape.id))
        .map((shape) => shapeBounds(shape, shapes))
    );
    if (!start) return;
    setDrag({
      kind: "move",
      origin: p,
      ids: moving,
      hit,
      start,
      dx: 0,
      dy: 0,
      guides: [],
    });
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const p = toCanvas(event);
    if (!drag) {
      const handle = handleAt(p);
      setCursor(
        handle
          ? CURSORS[handle]
          : hitTest(slide, p, PICK * scale)
            ? "move"
            : "default"
      );
      return;
    }
    if (drag.kind === "marquee") {
      setDrag({ ...drag, current: p });
      return;
    }
    if (drag.kind === "move") {
      let dx = p.x - drag.origin.x;
      let dy = p.y - drag.origin.y;
      let edges: Edges = ALL_EDGES;
      // Shift keeps the move horizontal or vertical, as in PowerPoint.
      if (event.shiftKey) {
        if (Math.abs(dx) >= Math.abs(dy)) {
          dy = 0;
          edges = { x: ALL_EDGES.x, y: [] };
        } else {
          dx = 0;
          edges = { x: [], y: ALL_EDGES.y };
        }
      }
      let guides: Guide[] = [];
      // Alt turns snapping off.
      if (!event.altKey) {
        const snap = snapRect(
          { ...drag.start, x: drag.start.x + dx, y: drag.start.y + dy },
          targetsFor((id) => drag.ids.has(id)),
          SNAP * scale,
          edges
        );
        dx += snap.dx;
        dy += snap.dy;
        guides = snap.guides;
      }
      setDrag({ ...drag, dx, dy, guides });
      return;
    }
    const delta = { x: p.x - drag.origin.x, y: p.y - drag.origin.y };
    let next = resizeBox(drag.start, drag.handle, delta, event.shiftKey);
    let guides: Guide[] = [];
    // Smart guides for an unturned box resized freely: snap the dragged edges.
    if (!event.altKey && !event.shiftKey && !drag.start.rotation) {
      const { handle } = drag;
      const edges = {
        x: handle.includes("e") ? [1] : handle.includes("w") ? [0] : [],
        y: handle.includes("s") ? [1] : handle.includes("n") ? [0] : [],
      };
      const snap = snapRect(
        next,
        targetsFor((id) => id === drag.id),
        SNAP * scale,
        edges
      );
      if (snap.dx || snap.dy) {
        next = resizeBox(drag.start, handle, {
          x: delta.x + snap.dx,
          y: delta.y + snap.dy,
        });
      }
      guides = snap.guides;
    }
    setDrag({ ...drag, box: next, guides });
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (!drag) return;
    setDrag(null);
    if (drag.kind === "move") {
      if (drag.dx || drag.dy) onMove(drag.ids, drag.dx, drag.dy);
      else if (!event.shiftKey && drag.ids.size > 1) onSelect([drag.hit]);
    } else if (drag.kind === "resize") {
      const { start, box: end } = drag;
      if (
        end.x !== start.x ||
        end.y !== start.y ||
        end.w !== start.w ||
        end.h !== start.h
      ) {
        onResize(drag.id, end);
      }
    } else {
      const rect = rectBetween(drag.origin, drag.current);
      if (rect.w < 2 * scale && rect.h < 2 * scale) return;
      const inside = shapesInRect(slide, rect);
      onSelect([...new Set([...drag.base, ...inside])]);
    }
  }

  const stroke = 1.5;
  const handleSize = HANDLE * scale;
  const guides = drag && drag.kind !== "marquee" ? drag.guides : [];
  const previewShapes = new Map(
    preview.shapes.map((shape) => [shape.id, shape])
  );

  return (
    <div
      ref={ref}
      tabIndex={0}
      role="application"
      aria-roledescription="投影片畫布"
      aria-label={`第 ${number} 頁`}
      aria-describedby="canvas-help"
      className={cn(
        "relative aspect-video w-full touch-none overflow-hidden rounded-lg border border-border bg-white outline-offset-4 select-none focus-visible:outline-2",
        className
      )}
      style={{ cursor: drag?.kind === "move" ? "move" : cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDrag(null)}
      onKeyDown={onKeyDown}
    >
      <div
        data-slot="slide-view"
        aria-hidden
        className="absolute inset-0"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      <svg
        aria-hidden
        viewBox={`0 0 ${SLIDE_WIDTH} ${SLIDE_HEIGHT}`}
        className="pointer-events-none absolute inset-0 size-full"
      >
        {selection.map((id) => {
          const shape = previewShapes.get(id);
          if (!shape) return null;
          return shape.kind === "line" ? (
            <polyline
              key={id}
              points={points(linePoints(shape, previewShapes))}
              fill="none"
              stroke="var(--canvas-selection)"
              strokeWidth={stroke * 3}
              strokeOpacity={0.35}
              vectorEffect="non-scaling-stroke"
            />
          ) : (
            <polygon
              key={id}
              points={points(cornersOf(shape))}
              fill="none"
              stroke="var(--canvas-selection)"
              strokeWidth={stroke}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
        {box && drag?.kind !== "move" && (
          <g>
            {HANDLES.map((handle) => {
              const shown = drag?.kind === "resize" ? drag.box : boxOf(box);
              const p = handlePoint(shown, handle);
              return (
                <rect
                  key={handle}
                  x={p.x - handleSize / 2}
                  y={p.y - handleSize / 2}
                  width={handleSize}
                  height={handleSize}
                  fill="var(--canvas-handle)"
                  stroke="var(--canvas-selection)"
                  strokeWidth={stroke}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </g>
        )}
        {guides.map((guide, i) =>
          guide.axis === "x" ? (
            <line
              key={i}
              x1={guide.at}
              x2={guide.at}
              y1={guide.from}
              y2={guide.to}
              stroke="var(--canvas-guide)"
              strokeWidth={1}
              strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
            />
          ) : (
            <line
              key={i}
              x1={guide.from}
              x2={guide.to}
              y1={guide.at}
              y2={guide.at}
              stroke="var(--canvas-guide)"
              strokeWidth={1}
              strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
            />
          )
        )}
        {drag?.kind === "marquee" &&
          (() => {
            const r = rectBetween(drag.origin, drag.current);
            return (
              <rect
                x={r.x}
                y={r.y}
                width={r.w}
                height={r.h}
                fill="var(--canvas-selection)"
                fillOpacity={0.08}
                stroke="var(--canvas-selection)"
                strokeWidth={1}
                strokeDasharray="4 4"
                vectorEffect="non-scaling-stroke"
              />
            );
          })()}
      </svg>
    </div>
  );
}
