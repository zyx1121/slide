"use client";

import { BringToFrontIcon, SendToBackIcon, Trash2Icon } from "lucide-react";
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { applyOperations, type Operation } from "@/lib/deck/patch";
import type { DeckDocument } from "@/lib/deck/schema";
import type { Box } from "@/lib/editor/geometry";
import {
  boxOps,
  deleteOps,
  insertOps,
  moveOps,
  reorderOps,
} from "@/lib/editor/ops";
import { movedSlide, newShape, type NewShapeKind } from "@/lib/editor/preview";
import { cn } from "@/lib/utils";

/** Canvas px an arrow key moves the selection; Shift moves ten times as far. */
const NUDGE = 2;
/** How long nudges gather before they are saved as one edit, in ms. */
const NUDGE_SAVE_DELAY = 500;

type Status = { saving: boolean; error: string | null };

/**
 * Saves patches in order, each against the version the previous one left.
 * When the server refuses one (another tab or an agent's accepted change
 * moved the deck on), the editor reloads the deck and drops the edits still
 * waiting, which were made against the old version.
 */
function useSaver(
  deckId: string,
  initialVersion: number,
  onReload: (document: DeckDocument) => void
) {
  const version = useRef(initialVersion);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const generation = useRef(0);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const save = useCallback(
    (ops: Operation[]) => {
      const mine = generation.current;
      setPending((n) => n + 1);
      chain.current = chain.current
        .then(async () => {
          if (mine !== generation.current) return;
          const result = await editDeckAction(
            deckId,
            version.current,
            ops
          ).catch(() => null);
          if (mine !== generation.current) return;
          if (result?.ok) {
            version.current = result.version;
            setError(null);
            return;
          }
          generation.current++;
          const fresh = await loadDeckAction(deckId).catch(() => null);
          if (!fresh) {
            setError("儲存失敗，請重新整理頁面。");
            return;
          }
          version.current = fresh.version;
          onReload(fresh.document);
          setError(
            result?.code === "conflict"
              ? "簡報在別處改過了，已載入最新版本。"
              : "這個修改沒有存到，已載入最新版本。"
          );
        })
        .catch(() => setError("儲存失敗，請重新整理頁面。"))
        .finally(() => setPending((n) => n - 1));
    },
    [deckId, onReload]
  );

  // Leaving with edits still on their way asks first.
  useEffect(() => {
    if (pending === 0) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending]);

  return { save, status: { saving: pending > 0, error } satisfies Status };
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
  const [slideIndex, setSlideIndex] = useState(0);
  const [selection, setSelection] = useState<string[]>([]);
  const [nudge, setNudge] = useState({ dx: 0, dy: 0 });
  const nudgeRef = useRef(nudge);
  const nudgeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const reload = useCallback((fresh: DeckDocument) => {
    docRef.current = fresh;
    setDoc(fresh);
    setSlideIndex((i) => Math.min(i, fresh.slides.length - 1));
    setSelection([]);
    nudgeRef.current = { dx: 0, dy: 0 };
    setNudge(nudgeRef.current);
  }, []);
  const { save, status } = useSaver(deckId, initialVersion, reload);

  const index = Math.min(slideIndex, doc.slides.length - 1);
  const slide = doc.slides[index];

  const commit = useCallback(
    (ops: Operation[]) => {
      if (ops.length === 0) return;
      try {
        const next = applyOperations(docRef.current, ops).document;
        docRef.current = next;
        setDoc(next);
      } catch {
        return;
      }
      save(ops);
    },
    [save]
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

  const select = (ids: string[]) => {
    flushNudge();
    setSelection(ids);
  };

  const insert = (kind: NewShapeKind) => {
    flushNudge();
    const shape = newShape(kind, docRef.current.slides[index]);
    commit(insertOps(index, shape));
    setSelection([shape.id]);
  };

  const reorder = (to: "front" | "back") => {
    flushNudge();
    commit(
      reorderOps(docRef.current.slides[index], index, new Set(selection), to)
    );
  };

  const remove = () => {
    flushNudge();
    commit(deleteOps(docRef.current.slides[index], index, new Set(selection)));
    setSelection([]);
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
    } else if (event.key === "Escape") {
      select([]);
    } else if (event.key === "a" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      select(slide.shapes.map((shape) => shape.id));
    }
  };

  useEffect(() => () => clearTimeout(nudgeTimer.current), []);

  const shown =
    nudge.dx || nudge.dy
      ? movedSlide(slide, new Set(selection), nudge.dx, nudge.dy)
      : slide;
  const none = selection.length === 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex">
          <Tool
            tip="插入矩形"
            icon={RectGlyph}
            onClick={() => insert("rect")}
          />
          <Tool
            tip="插入圓角矩形"
            icon={RoundRectGlyph}
            onClick={() => insert("roundRect")}
          />
          <Tool
            tip="插入橢圓"
            icon={EllipseGlyph}
            onClick={() => insert("ellipse")}
          />
        </div>
        <div className="flex">
          <Tool
            tip="移到最上層"
            icon={BringToFrontIcon}
            disabled={none}
            onClick={() => reorder("front")}
          />
          <Tool
            tip="移到最下層"
            icon={SendToBackIcon}
            disabled={none}
            onClick={() => reorder("back")}
          />
          <Tool tip="刪除" icon={Trash2Icon} disabled={none} onClick={remove} />
        </div>
        <p
          aria-live="polite"
          className={cn(
            "ml-auto text-xs",
            status.error ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {status.error ?? (status.saving ? "儲存中…" : "已儲存")}
        </p>
      </div>
      <div className="grid gap-5 lg:grid-cols-[8rem_minmax(0,1fr)]">
        <ol className="order-2 flex gap-3 overflow-x-auto lg:order-1 lg:flex-col lg:overflow-visible">
          {doc.slides.map((item, i) => (
            <li key={item.id} className="w-32 shrink-0">
              <button
                type="button"
                aria-label={`第 ${i + 1} 頁`}
                aria-current={i === index ? "true" : undefined}
                onClick={() => {
                  flushNudge();
                  setSlideIndex(i);
                  setSelection([]);
                }}
                className={cn(
                  "block w-full rounded-lg outline-offset-4 focus-visible:outline-2",
                  i === index ? "opacity-100" : "opacity-60 hover:opacity-100"
                )}
              >
                <SlideView slide={item} number={i + 1} decorative />
              </button>
            </li>
          ))}
        </ol>
        <div className="order-1 flex flex-col gap-3 lg:order-2">
          <Canvas
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
          />
          <p id="canvas-help" className="text-xs text-muted-foreground">
            點選形狀來選取，Shift 加選，拖曳空白處框選。方向鍵移動，加 Shift
            走得更遠。拖曳時按 Shift 鎖定方向，按 Alt 不對齊。
          </p>
        </div>
      </div>
    </div>
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
