"use client";

import {
  BringToFrontIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleHelpIcon,
  CopyPlusIcon,
  Redo2Icon,
  SendToBackIcon,
  Trash2Icon,
  Undo2Icon,
} from "lucide-react";
import {
  type ComponentType,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { editDeckAction, loadDeckAction } from "@/app/decks/[id]/actions";
import { Canvas } from "@/components/editor/canvas";
import { SlideView } from "@/components/slide-view";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { compare } from "fast-json-patch";

import { DeckError } from "@/lib/deck/errors";
import { applyOperations, type Operation } from "@/lib/deck/patch";
import type { DeckDocument } from "@/lib/deck/schema";
import {
  type Clip,
  CLIP_TYPE,
  copyShapes,
  parseClip,
  pasteOffset,
  pasteShapes,
} from "@/lib/editor/clipboard";
import type { Box } from "@/lib/editor/geometry";
import { guard } from "@/lib/editor/guard";
import {
  EMPTY_HISTORY,
  type History,
  record,
  redo,
  undo,
} from "@/lib/editor/history";
import {
  boxOps,
  deleteOps,
  insertOps,
  moveOps,
  reorderOps,
} from "@/lib/editor/ops";
import { movedSlide, newShape, type NewShapeKind } from "@/lib/editor/preview";
import { createSaver, type SaverState } from "@/lib/editor/saver";
import { cn } from "@/lib/utils";

/** What became of an edit: applied, a no-op, paused while saving is, or refused. */
type Commit = "applied" | "unchanged" | "paused" | "refused";

/** The keyboard and mouse help, shown from the dock and read with the canvas. */
const HELP = [
  "點選形狀來選取，Shift 加選，拖曳空白處框選，Tab 換選下一個。",
  "方向鍵移動，加 Shift 走得更遠。拖曳時按 Shift 鎖定方向，按 Alt 不對齊。",
  "⌘Z 復原，⌘⇧Z 重做，⌘D 再製，⌘C、⌘X、⌘V 複製、剪下、貼上（Windows 用 Ctrl）。",
  "Page Up、Page Down 換頁。",
];

/** Canvas px an arrow key moves the selection; Shift moves ten times as far. */
const NUDGE = 2;
/** How long nudges gather before they are saved as one edit, in ms. */
const NUDGE_SAVE_DELAY = 500;

/**
 * The save queue for one editor (lib/editor/saver.ts) and its state. Leaving
 * with edits still on their way asks first.
 */
function useSaver(
  deckId: string,
  initialVersion: number,
  onReload: (document: DeckDocument) => void
) {
  const [state, setState] = useState<SaverState>({
    accepting: true,
    pending: 0,
    phase: "ready",
    message: null,
  });
  const [saver] = useState(() =>
    createSaver({
      version: initialVersion,
      send: (version, ops) => editDeckAction(deckId, version, ops),
      load: () => loadDeckAction(deckId),
      onReload,
      onChange: setState,
    })
  );
  useEffect(() => {
    saver.attach();
    return () => saver.dispose();
  }, [saver]);
  return { saver, state };
}

/**
 * The deck editor: a toolbar, the slide list and the canvas. Every gesture
 * is applied here at once, through the same patch code the server runs, and
 * then saved in the background.
 */
export function Editor({
  deckId,
  initialDocument,
  initialVersion,
}: {
  deckId: string;
  initialDocument: DeckDocument;
  initialVersion: number;
}) {
  const [doc, setDoc] = useState(initialDocument);
  const docRef = useRef(doc);
  const [history, setHistoryState] = useState<History>(EMPTY_HISTORY);
  const historyRef = useRef(history);
  const setHistory = (next: History) => {
    historyRef.current = next;
    setHistoryState(next);
  };
  const [slideIndex, setSlideIndex] = useState(0);
  const [selection, setSelection] = useState<string[]>([]);
  const [nudge, setNudge] = useState({ dx: 0, dy: 0 });
  const nudgeRef = useRef(nudge);
  const nudgeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  /** An edit that could not be applied here; it never reached the server. */
  const [refusal, setRefusal] = useState<string | null>(null);

  const reload = useCallback((fresh: DeckDocument) => {
    // Undo steps were made against the local document. When the server's
    // differs (an edit was lost, or another tab changed it), they no longer
    // apply; when it is the same, nothing was lost and they still do.
    if (compare(docRef.current, fresh).length > 0) {
      historyRef.current = EMPTY_HISTORY;
      setHistoryState(EMPTY_HISTORY);
    }
    docRef.current = fresh;
    setDoc(fresh);
    setSlideIndex((i) => Math.min(i, fresh.slides.length - 1));
    setSelection([]);
    clearTimeout(nudgeTimer.current);
    nudgeRef.current = { dx: 0, dy: 0 };
    setNudge(nudgeRef.current);
  }, []);
  const { saver, state: saving } = useSaver(deckId, initialVersion, reload);

  const index = Math.min(slideIndex, doc.slides.length - 1);
  const slide = doc.slides[index];

  /**
   * Applies an edit here and queues it for saving. Each patch is guarded by
   * the ids of what it touches, so it can never land on other shapes. While
   * the saver is reloading or offline, edits are paused: they would be made
   * on a document the server does not have. An edit is recorded for undo
   * with its inverse; an undo or redo is not. History keeps patches
   * unguarded; they are guarded again against the document they meet.
   */
  const commit = useCallback(
    (ops: Operation[], recordStep = true): Commit => {
      if (ops.length === 0) return "unchanged";
      if (!saver.state().accepting) return "paused";
      let result: ReturnType<typeof applyOperations>;
      try {
        result = applyOperations(docRef.current, guard(docRef.current, ops));
      } catch (error) {
        if (
          error instanceof DeckError &&
          error.message === "the patch changes nothing"
        ) {
          return "unchanged";
        }
        setRefusal("這個修改無法套用，沒有存到。");
        return "refused";
      }
      docRef.current = result.document;
      setDoc(result.document);
      setRefusal(null);
      if (recordStep) {
        const next = record(historyRef.current, {
          ops,
          inverse: result.inverse,
          slide: index,
        });
        historyRef.current = next;
        setHistoryState(next);
      }
      saver.save(result.operations);
      return "applied";
    },
    [saver, index]
  );

  /** Saves gathered arrow-key nudges as one edit. */
  const flushNudge = useCallback(() => {
    clearTimeout(nudgeTimer.current);
    const { dx, dy } = nudgeRef.current;
    if (!dx && !dy) return;
    nudgeRef.current = { dx: 0, dy: 0 };
    setNudge(nudgeRef.current);
    const current = docRef.current.slides[index];
    commit(moveOps(current, index, new Set(selection), dx, dy));
  }, [commit, index, selection]);

  // Nudges still gathering are saved when the editor closes, and leaving the
  // page asks first while any edit is unsaved.
  const flushRef = useRef(flushNudge);
  useEffect(() => {
    flushRef.current = flushNudge;
  }, [flushNudge]);
  useEffect(() => () => flushRef.current(), []);
  const unsaved = saving.pending > 0 || nudge.dx !== 0 || nudge.dy !== 0;
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  const select = (ids: string[]) => {
    flushNudge();
    setSelection(ids);
  };

  const insert = (kind: NewShapeKind) => {
    flushNudge();
    const shape = newShape(kind, docRef.current.slides[index]);
    if (commit(insertOps(index, shape)) === "applied") {
      setSelection([shape.id]);
    }
  };

  const reorder = (to: "front" | "back") => {
    flushNudge();
    commit(
      reorderOps(docRef.current.slides[index], index, new Set(selection), to)
    );
  };

  const remove = () => {
    flushNudge();
    const current = docRef.current.slides[index];
    if (commit(deleteOps(current, index, new Set(selection))) === "applied") {
      setSelection([]);
    }
  };

  const goTo = (target: number) => {
    if (target < 0 || target >= doc.slides.length || target === index) return;
    flushNudge();
    setSlideIndex(target);
    setSelection([]);
  };

  /** Undoes or redoes one edit, on the slide it was made on. */
  const travel = (direction: "undo" | "redo") => {
    flushNudge();
    const move = (direction === "undo" ? undo : redo)(historyRef.current);
    if (!move) return;
    const outcome = commit(move.ops, false);
    if (outcome === "paused") return;
    if (outcome === "refused") {
      // Steps before this one were made on top of it; none can be undone
      // safely without it.
      setHistory(EMPTY_HISTORY);
      setRefusal("這一步無法復原，復原紀錄已清空。");
      return;
    }
    // A step that changes nothing any more is passed over.
    setHistory(move.history);
    setSlideIndex(move.slide);
    const kept = new Set(
      docRef.current.slides[move.slide]?.shapes.map((shape) => shape.id)
    );
    setSelection((ids) => ids.filter((id) => kept.has(id)));
  };

  /** Adds a clip's shapes to the current slide and selects them. */
  const place = (clip: Clip) => {
    const target = docRef.current.slides[index];
    const shapes = pasteShapes(clip, pasteOffset(target, clip));
    const ops = shapes.flatMap((shape) => insertOps(index, shape));
    if (commit(ops) === "applied") {
      setSelection(shapes.map((shape) => shape.id));
    }
  };

  const copy = (event: ClipboardEvent) => {
    flushNudge();
    const clip = copyShapes(docRef.current.slides[index], new Set(selection));
    if (!clip) return false;
    if (!event.clipboardData) return false;
    event.preventDefault();
    const text = JSON.stringify(clip);
    event.clipboardData.setData(CLIP_TYPE, text);
    event.clipboardData.setData("text/plain", text);
    return true;
  };

  const paste = (event: ClipboardEvent) => {
    flushNudge();
    const data = event.clipboardData;
    // Anything but shapes copied here (text, an image) pastes nothing.
    const clip = parseClip(
      data?.getData(CLIP_TYPE) || data?.getData("text/plain")
    );
    if (!clip) return;
    event.preventDefault();
    place(clip);
  };

  const cut = (event: ClipboardEvent) => {
    // While edits are paused a cut would copy without removing anything.
    if (!saver.state().accepting) return;
    if (copy(event)) remove();
  };

  const duplicate = () => {
    flushNudge();
    const clip = copyShapes(docRef.current.slides[index], new Set(selection));
    if (clip) place(clip);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? NUDGE * 10 : NUDGE;
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    if (event.key in arrows && selection.length > 0) {
      event.preventDefault();
      if (!saver.state().accepting) return;
      const [dx, dy] = arrows[event.key];
      nudgeRef.current = {
        dx: nudgeRef.current.dx + dx,
        dy: nudgeRef.current.dy + dy,
      };
      setNudge(nudgeRef.current);
      clearTimeout(nudgeTimer.current);
      nudgeTimer.current = setTimeout(flushNudge, NUDGE_SAVE_DELAY);
    } else if (
      (event.key === "Delete" || event.key === "Backspace") &&
      selection.length > 0
    ) {
      event.preventDefault();
      remove();
    } else if (event.key === "Tab" && selection.length > 0) {
      // With a selection, Tab picks the next shape, so the keyboard alone
      // can reach every shape; without one, Tab leaves the canvas.
      event.preventDefault();
      const order = slide.shapes.map((shape) => shape.id);
      const last = order.indexOf(selection[selection.length - 1]);
      const step = event.shiftKey ? -1 : 1;
      select([order[(last + step + order.length) % order.length]]);
    } else if (event.key === "PageUp" || event.key === "PageDown") {
      event.preventDefault();
      goTo(index + (event.key === "PageUp" ? -1 : 1));
    } else if (event.key === "Escape") {
      select([]);
    } else if (event.metaKey || event.ctrlKey) {
      const key = event.key.toLowerCase();
      if (key === "a") {
        event.preventDefault();
        select(slide.shapes.map((shape) => shape.id));
      } else if (key === "z") {
        event.preventDefault();
        travel(event.shiftKey ? "redo" : "undo");
      } else if (key === "y") {
        event.preventDefault();
        travel("redo");
      } else if (key === "d") {
        event.preventDefault();
        duplicate();
      }
    }
  };

  const shown =
    nudge.dx || nudge.dy
      ? movedSlide(slide, new Set(selection), nudge.dx, nudge.dy)
      : slide;
  const none = selection.length === 0;
  const paused = !saving.accepting;
  const nudging = nudge.dx !== 0 || nudge.dy !== 0;

  const problem = refusal ?? saving.message;
  const status =
    saving.phase === "reloading"
      ? "載入最新版本…"
      : saving.pending > 0
        ? "儲存中…"
        : "已儲存";

  return (
    <div className="relative size-full">
      {/* The slide, as wide as the page, keeping 64 px above and below for
          the corners and the dock. */}
      <div className="absolute inset-x-0 inset-y-16 flex items-center justify-center">
        <Canvas
          className="w-[min(100%,calc((100dvh_-_8rem)*16/9))]"
          slide={shown}
          number={index + 1}
          selection={selection}
          onSelect={select}
          onMove={(ids, dx, dy) =>
            commit(moveOps(docRef.current.slides[index], index, ids, dx, dy))
          }
          onResize={(id: string, box: Box) =>
            commit(boxOps(docRef.current.slides[index], index, id, box))
          }
          onGestureStart={flushNudge}
          onKeyDown={onKeyDown}
          onCopy={copy}
          onCut={cut}
          onPaste={paste}
        />
      </div>
      <p id="canvas-help" className="sr-only">
        {HELP.join(" ")}
      </p>

      {/* The dock floats at the bottom center, as Plump's does; only the bar
          and the notice take pointer events, the rest stays the canvas's. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-3 flex flex-col items-center gap-2 px-2 max-md:bottom-16">
        {problem && (
          <div
            role="alert"
            data-slot="floating-notice"
            data-surface="tinted"
            className="pointer-events-auto flex items-center gap-3 rounded-xl border px-3 py-2"
          >
            <p className="text-xs text-destructive">{problem}</p>
            {saving.phase === "blocked" && (
              <Button variant="ghost" onClick={() => saver.retry()}>
                重新載入
              </Button>
            )}
          </div>
        )}
        <div
          role="group"
          aria-label="編輯工具"
          data-slot="floating-toolbar"
          data-surface="tinted"
          className="pointer-events-auto flex max-w-full items-center gap-0.5 overflow-x-auto rounded-2xl border p-1"
        >
          <Tool
            tip="復原"
            icon={Undo2Icon}
            disabled={paused || (history.past.length === 0 && !nudging)}
            onClick={() => travel("undo")}
          />
          <Tool
            tip="重做"
            icon={Redo2Icon}
            disabled={paused || history.future.length === 0}
            onClick={() => travel("redo")}
          />
          <Separator orientation="vertical" className="mx-1 my-2" />
          <Tool
            tip="插入矩形"
            icon={RectGlyph}
            disabled={paused}
            onClick={() => insert("rect")}
          />
          <Tool
            tip="插入圓角矩形"
            icon={RoundRectGlyph}
            disabled={paused}
            onClick={() => insert("roundRect")}
          />
          <Tool
            tip="插入橢圓"
            icon={EllipseGlyph}
            disabled={paused}
            onClick={() => insert("ellipse")}
          />
          <Separator orientation="vertical" className="mx-1 my-2" />
          <Tool
            tip="移到最上層"
            icon={BringToFrontIcon}
            disabled={paused || none}
            onClick={() => reorder("front")}
          />
          <Tool
            tip="移到最下層"
            icon={SendToBackIcon}
            disabled={paused || none}
            onClick={() => reorder("back")}
          />
          <Tool
            tip="再製"
            icon={CopyPlusIcon}
            disabled={paused || none}
            onClick={duplicate}
          />
          <Tool
            tip="刪除"
            icon={Trash2Icon}
            disabled={paused || none}
            onClick={remove}
          />
          <Separator orientation="vertical" className="mx-1 my-2" />
          <Tool
            tip="上一頁"
            icon={ChevronLeftIcon}
            disabled={index === 0}
            onClick={() => goTo(index - 1)}
          />
          <PageList
            slides={doc.slides}
            index={index}
            onPick={(target) => goTo(target)}
          />
          <Tool
            tip="下一頁"
            icon={ChevronRightIcon}
            disabled={index === doc.slides.length - 1}
            onClick={() => goTo(index + 1)}
          />
          <Separator orientation="vertical" className="mx-1 my-2" />
          <p className="min-w-16 px-2 text-center text-xs text-muted-foreground">
            {status}
          </p>
          <Popover>
            <Tooltip>
              <TooltipTrigger
                render={
                  <PopoverTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="操作說明"
                      />
                    }
                  />
                }
              >
                <CircleHelpIcon />
              </TooltipTrigger>
              <TooltipContent>操作說明</TooltipContent>
            </Tooltip>
            <PopoverContent
              side="top"
              sideOffset={12}
              data-surface="tinted"
              className="w-80"
            >
              <ul className="flex flex-col gap-1.5 text-xs text-muted-foreground">
                {HELP.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </div>
  );
}

/**
 * The slide list, opened from the page number in the dock and floating over
 * the slide, so the slide keeps the page.
 */
function PageList({
  slides,
  index,
  onPick,
}: {
  slides: DeckDocument["slides"];
  index: number;
  onPick: (index: number) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  variant="ghost"
                  className="tabular-nums"
                  aria-label={`第 ${index + 1} 頁，共 ${slides.length} 頁`}
                />
              }
            />
          }
        >
          {index + 1} / {slides.length}
        </TooltipTrigger>
        <TooltipContent>所有頁面</TooltipContent>
      </Tooltip>
      <PopoverContent
        side="top"
        sideOffset={12}
        data-surface="tinted"
        className="p-3"
        // Up to four 8 rem thumbnails a row, no wider than the slides need.
        style={{
          width: `min(${Math.min(slides.length, 4) * 8.75 + 1.75}rem, calc(100vw - 2rem))`,
        }}
      >
        <ol className="grid max-h-[60dvh] grid-cols-[repeat(auto-fill,8rem)] justify-center gap-3 overflow-y-auto p-1">
          {slides.map((slide, i) => (
            <li key={slide.id}>
              <button
                type="button"
                aria-label={`第 ${i + 1} 頁`}
                aria-current={i === index ? "page" : undefined}
                onClick={() => {
                  onPick(i);
                  setOpen(false);
                }}
                className="flex w-full flex-col gap-1 rounded-lg outline-offset-2 focus-visible:outline-2"
              >
                <SlideView
                  slide={slide}
                  number={i + 1}
                  decorative
                  className={cn(i === index && "ring-2 ring-foreground")}
                />
                <span className="text-xs text-muted-foreground tabular-nums">
                  {i + 1}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </PopoverContent>
    </Popover>
  );
}

function Tool({
  tip,
  icon: Icon,
  disabled,
  onClick,
}: {
  tip: string;
  icon: ComponentType;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={tip}
            disabled={disabled}
            onClick={onClick}
          />
        }
      >
        <Icon />
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}

/*
 * The insert buttons draw the shapes they insert. Lucide's own rectangles
 * all have rounded corners, which would make the three look alike.
 */
const glyph = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

function RectGlyph() {
  return (
    <svg {...glyph}>
      <rect x="2" y="5" width="20" height="14" strokeLinejoin="miter" />
    </svg>
  );
}

function RoundRectGlyph() {
  return (
    <svg {...glyph}>
      <rect x="2" y="5" width="20" height="14" rx="4" />
    </svg>
  );
}

function EllipseGlyph() {
  return (
    <svg {...glyph}>
      <ellipse cx="12" cy="12" rx="10" ry="7" />
    </svg>
  );
}
