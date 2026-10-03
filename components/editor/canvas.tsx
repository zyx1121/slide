"use client";

import {
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
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
import { TextEditor, type TextKeys } from "@/components/editor/text-editor";
import {
  type End,
  newLine,
  otherGlue,
  type Side,
  type Snap,
  snapEnd,
  withLineEnd,
} from "@/lib/editor/connect";
import { movedSlide, resizedSlide } from "@/lib/editor/preview";
import { assetUrl } from "@/lib/editor/upload";
import { ALL_EDGES, type Edges, type Guide, snapRect } from "@/lib/editor/snap";
import { caretAt, paragraphAt, type Pos, wordAt } from "@/lib/editor/text-edit";
import {
  draftLayout,
  draftSlide,
  frameOf,
  pointInFrame,
  shownBody,
  type TextDraft,
  TITLE_ID,
} from "@/lib/editor/text-session";
import { holdsText, renderSlideSvg } from "@/lib/render/svg";
import { BACKGROUND_PATH, TITLE } from "@/lib/render/template";
import { cn } from "@/lib/utils";

/** Screen px within which a click picks a connector or a handle, and snaps. */
const PICK = 6;
const HANDLE = 10;
/** Screen px within which a connector end snaps to a shape's site. */
const SITE_REACH = 14;
/** The shortest connector a drag draws, in screen px. */
const MIN_LINE = 8;

/** Presses closer together than this, in ms, count as a double click. */
const MULTI_CLICK_MS = 500;
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
    }
  | {
      /** Selecting text by dragging across it. */
      kind: "text";
      anchor: Pos;
    }
  | {
      /** Drawing a new connector from `start`. */
      kind: "draw";
      start: Snap;
      current: Snap;
    }
  | {
      /** Moving one end of a selected connector. */
      kind: "end";
      id: string;
      side: Side;
      snap: Snap;
    };

/** The text being edited on this slide, and what its keys do. */
export type CanvasText = {
  draft: TextDraft;
  textarea: RefObject<HTMLTextAreaElement | null>;
  keys: TextKeys;
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
  onCopy,
  onCut,
  onPaste,
  text,
  onEditText,
  tool,
  onDrawLine,
  onLineEnd,
  onDropFiles,
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
  /** Clipboard events while the canvas has focus, wherever the browser sends them. */
  onCopy: (event: ClipboardEvent) => void;
  onCut: (event: ClipboardEvent) => void;
  onPaste: (event: ClipboardEvent) => void;
  /** The text being edited on this slide, if any. */
  text: CanvasText | null;
  /** A double click on a shape's text or the title, at a canvas point. */
  onEditText: (target: string, at: Point) => void;
  /** A tool that draws instead of selecting: a connector. */
  tool: "connector" | null;
  /** A connector drawn with the tool, from one end to the other. */
  onDrawLine: (start: End, end: End) => void;
  /** One end of a connector dragged to a new place or site. */
  onLineEnd: (id: string, side: Side, end: End) => void;
  /** Files dropped on the slide, at a canvas point. */
  onDropFiles: (files: File[], at: Point) => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(SLIDE_WIDTH);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [cursor, setCursor] = useState("default");
  // The site a connector end would glue to under the pointer, shown while
  // the connector tool is on.
  const [hover, setHover] = useState<Snap | null>(null);
  // Pointer events report no click count (detail is 0 in Chromium), so
  // presses on text are counted here: two select a word, three a paragraph.
  const presses = useRef({ count: 0, time: 0, x: 0, y: 0 });

  // Browsers send clipboard events for a focused element that holds no text
  // to <body> (Firefox) or to wherever a text selection was left (Chrome),
  // so the canvas listens on the document and acts while it has focus.
  const clipboard = useRef({ onCopy, onCut, onPaste });
  useEffect(() => {
    clipboard.current = { onCopy, onCut, onPaste };
  }, [onCopy, onCut, onPaste]);
  useEffect(() => {
    const route =
      (name: keyof typeof clipboard.current) => (event: ClipboardEvent) => {
        if (document.activeElement === ref.current) {
          clipboard.current[name](event);
        }
      };
    const handlers = {
      copy: route("onCopy"),
      cut: route("onCut"),
      paste: route("onPaste"),
    };
    for (const [type, handler] of Object.entries(handlers)) {
      document.addEventListener(type, handler as EventListener);
    }
    return () => {
      for (const [type, handler] of Object.entries(handlers)) {
        document.removeEventListener(type, handler as EventListener);
      }
    };
  }, []);

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

  // The text being edited shows as typed, before it is saved.
  const draft = text?.draft;
  const base = useMemo(
    () => (draft ? draftSlide(slide, draft) : slide),
    [slide, draft]
  );
  const preview = useMemo(
    () =>
      drag?.kind === "move"
        ? movedSlide(base, drag.ids, drag.dx, drag.dy)
        : drag?.kind === "resize"
          ? resizedSlide(base, drag.id, drag.box)
          : drag?.kind === "end"
            ? withLineEnd(base, drag.id, drag.side, drag.snap.end)
            : drag?.kind === "draw"
              ? {
                  ...base,
                  shapes: [
                    ...base.shapes,
                    {
                      ...newLine(drag.start.end, drag.current.end),
                      id: "ln_drawing",
                    },
                  ],
                }
              : base,
    [base, drag]
  );
  const frame = text ? frameOf(base, text.draft.target) : null;
  const shown = text ? shownBody(text.draft) : null;
  const layout = frame && shown ? draftLayout(frame, shown.body) : null;
  const svg = useMemo(
    () =>
      renderSlideSvg(preview, {
        slideNumber: number,
        background: null,
        bare: true,
        assetHref: assetUrl,
      }),
    [preview, number]
  );

  const single =
    selection.length === 1
      ? base.shapes.find((shape) => shape.id === selection[0])
      : undefined;
  const box = single && single.kind !== "line" ? single : undefined;
  const line = single && single.kind === "line" ? single : undefined;

  /** The end of the selected connector under a point, if any. */
  const lineEndAt = (p: Point): Side | undefined => {
    if (!line) return undefined;
    const points = linePoints(line, shapes);
    const ends: [Side, Point][] = [
      ["start", points[0]],
      ["end", points[points.length - 1]],
    ];
    return ends.find(
      ([, q]) => Math.hypot(q.x - p.x, q.y - p.y) <= HANDLE * scale
    )?.[0];
  };

  const toCanvas = (event: { clientX: number; clientY: number }): Point => {
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
    if (text && frame && layout) {
      const p = toCanvas(event);
      const at = pointInFrame(frame, layout, p);
      if (at.inside) {
        // Keeps the focus, and the IME, in the text's field.
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        const { draft } = text;
        const last = presses.current;
        const again =
          event.timeStamp - last.time < MULTI_CLICK_MS &&
          Math.hypot(event.clientX - last.x, event.clientY - last.y) < PICK;
        const count = again ? last.count + 1 : 1;
        presses.current = {
          count,
          time: event.timeStamp,
          x: event.clientX,
          y: event.clientY,
        };
        const selection =
          count >= 3
            ? paragraphAt(draft.body, at.pos)
            : count === 2
              ? wordAt(draft.body, at.pos)
              : event.shiftKey
                ? { anchor: draft.selection.anchor, focus: at.pos }
                : caretAt(at.pos);
        text.keys.onChange(
          { ...draft, selection, typing: null, goal: null },
          "select"
        );
        text.textarea.current?.focus({ preventScroll: true });
        setDrag({ kind: "text", anchor: selection.anchor });
        return;
      }
      text.keys.onExit();
    }
    onGestureStart();
    // The press focuses the canvas by default (without a focus ring), so
    // the keyboard works right after a click.
    event.currentTarget.setPointerCapture(event.pointerId);
    // A text selection left on the page would take over copy and paste.
    window.getSelection()?.removeAllRanges();
    const p = toCanvas(event);

    if (tool === "connector") {
      const start = snapEnd(slide, p, SITE_REACH * scale);
      setDrag({ kind: "draw", start, current: start });
      return;
    }
    const side = lineEndAt(p);
    if (line && side) {
      setDrag({
        kind: "end",
        id: line.id,
        side,
        snap: snapEnd(slide, p, SITE_REACH * scale, otherGlue(line, side)),
      });
      return;
    }

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
    if (drag?.kind === "text") {
      if (!text || !frame || !layout) return;
      const at = pointInFrame(frame, layout, p);
      text.keys.onChange(
        {
          ...text.draft,
          selection: { anchor: drag.anchor, focus: at.pos },
          typing: null,
          goal: null,
        },
        "select"
      );
      return;
    }
    if (drag?.kind === "draw") {
      const avoid = "shape" in drag.start.end ? drag.start.end : undefined;
      setDrag({
        ...drag,
        current: snapEnd(slide, p, SITE_REACH * scale, avoid),
      });
      return;
    }
    if (drag?.kind === "end") {
      const current = shapes.get(drag.id);
      if (current?.kind !== "line") return;
      setDrag({
        ...drag,
        snap: snapEnd(
          slide,
          p,
          SITE_REACH * scale,
          otherGlue(current, drag.side)
        ),
      });
      return;
    }
    if (!drag && tool === "connector") {
      setCursor("crosshair");
      const snap = snapEnd(slide, p, SITE_REACH * scale);
      setHover(snap.shape ? snap : null);
      return;
    }
    if (!drag) {
      if (text && frame && layout && pointInFrame(frame, layout, p).inside) {
        setCursor("text");
        return;
      }
      const handle = handleAt(p);
      setCursor(
        lineEndAt(p)
          ? "crosshair"
          : handle
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
    // A picture keeps its proportions from a corner unless Shift is held,
    // as in PowerPoint; other shapes keep them only with Shift.
    const corner = drag.handle.length === 2;
    const keep =
      shapes.get(drag.id)?.kind === "image" && corner
        ? !event.shiftKey
        : event.shiftKey;
    let next = resizeBox(drag.start, drag.handle, delta, keep);
    let guides: Guide[] = [];
    // Smart guides for an unturned box resized freely: snap the dragged edges.
    if (!event.altKey && !keep && !drag.start.rotation) {
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
    if (drag.kind === "text") return;
    if (drag.kind === "draw") {
      const { start, current } = drag;
      const length = Math.hypot(
        current.point.x - start.point.x,
        current.point.y - start.point.y
      );
      if (length >= MIN_LINE * scale) onDrawLine(start.end, current.end);
      return;
    }
    if (drag.kind === "end") {
      onLineEnd(drag.id, drag.side, drag.snap.end);
      return;
    }
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
    } else if (drag.kind === "marquee") {
      const rect = rectBetween(drag.origin, drag.current);
      if (rect.w < 2 * scale && rect.h < 2 * scale) return;
      const inside = shapesInRect(slide, rect);
      onSelect([...new Set([...drag.base, ...inside])]);
    }
  }

  /** A double click edits the text of the shape under it, or the title. */
  function onDoubleClick(event: MouseEvent<HTMLDivElement>) {
    if (text) return;
    const p = toCanvas(event);
    const hit = hitTest(slide, p, PICK * scale);
    const shape = hit ? shapes.get(hit) : undefined;
    if (shape && holdsText(shape)) {
      onEditText(shape.id, p);
    } else if (
      !hit &&
      p.x >= TITLE.box.x &&
      p.x <= TITLE.box.x + TITLE.box.w &&
      p.y >= TITLE.box.y &&
      p.y <= TITLE.box.y + TITLE.box.h
    ) {
      onEditText(TITLE_ID, p);
    }
  }

  const stroke = 1.5;
  const handleSize = HANDLE * scale;
  const guides =
    drag && (drag.kind === "move" || drag.kind === "resize") ? drag.guides : [];
  // Sites to glue to: under the end being drawn or dragged, or under the
  // pointer while the connector tool is on.
  const snap =
    drag?.kind === "draw"
      ? drag.current
      : drag?.kind === "end"
        ? drag.snap
        : tool === "connector"
          ? hover
          : null;
  const previewShapes = new Map(
    preview.shapes.map((shape) => [shape.id, shape])
  );
  const shownLine =
    line && drag?.kind !== "move"
      ? preview.shapes.find((shape) => shape.id === line.id)
      : undefined;
  const lineEnds =
    shownLine?.kind === "line" ? linePoints(shownLine, previewShapes) : null;

  return (
    <div
      ref={ref}
      tabIndex={0}
      role="application"
      aria-roledescription="投影片畫布"
      aria-label={`第 ${number} 頁`}
      aria-describedby="canvas-help"
      className={cn(
        "relative aspect-video w-full touch-none overflow-hidden border border-border bg-white bg-size-[100%_100%] outline-offset-4 select-none focus-visible:outline-2",
        className
      )}
      style={{
        cursor: drag?.kind === "move" ? "move" : cursor,
        // The template background lives on the frame, not in the slide's
        // SVG: rebuilt with every edit, the 4K image was decoded again each
        // time, which Safari showed as a white flash.
        backgroundImage: `url(${BACKGROUND_PATH})`,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setDrag(null)}
      onPointerLeave={() => setHover(null)}
      onDoubleClick={onDoubleClick}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDrop={(event) => {
        const files = [...event.dataTransfer.files];
        if (files.length === 0) return;
        event.preventDefault();
        onDropFiles(files, toCanvas(event));
      }}
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
        {lineEnds &&
          [lineEnds[0], lineEnds[lineEnds.length - 1]].map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={(HANDLE / 2) * scale}
              fill="var(--canvas-handle)"
              stroke="var(--canvas-selection)"
              strokeWidth={stroke}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        {snap?.sites.map((p, i) => {
          const active =
            Math.hypot(p.x - snap.point.x, p.y - snap.point.y) < 0.5;
          return (
            <circle
              key={`site-${i}`}
              cx={p.x}
              cy={p.y}
              r={(active ? 6 : 4) * scale}
              fill={active ? "var(--canvas-selection)" : "var(--canvas-handle)"}
              stroke="var(--canvas-selection)"
              strokeWidth={stroke}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
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
      {text && frame && layout && shown && (
        <TextEditor
          draft={text.draft}
          frame={frame}
          layout={layout}
          selection={shown.selection}
          scale={scale}
          textarea={text.textarea}
          keys={text.keys}
        />
      )}
    </div>
  );
}
