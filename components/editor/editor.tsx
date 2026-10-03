"use client";

import {
  BringToFrontIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleHelpIcon,
  CopyPlusIcon,
  LayoutGridIcon,
  TypeIcon,
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
import { Canvas, type CanvasText } from "@/components/editor/canvas";
import {
  FillTool,
  LineTools,
  StrokeTool,
  TextTools,
} from "@/components/editor/dock-tools";
import {
  type DraftChange,
  type TextKeys,
  TextFocus,
} from "@/components/editor/text-editor";
import { SlideView } from "@/components/slide-view";
import { Button, buttonVariants } from "@/components/ui/button";
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
import Link from "next/link";

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
import type { Box, Point } from "@/lib/editor/geometry";
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
import {
  movedSlide,
  newShape,
  type NewShapeKind,
  shareSlides,
} from "@/lib/editor/preview";
import { createSaver, type SaverState } from "@/lib/editor/saver";
import {
  selectionStyle,
  shiftLevel,
  type StyleChange,
  styleOps,
  textStyle,
} from "@/lib/editor/style";
import {
  clampSelection,
  collapsed,
  isEmpty,
  ordered,
  selectAll,
  selectedStyles,
  styleAt,
  styleParagraphs,
  styleRange,
  wordAt,
} from "@/lib/editor/text-edit";
import {
  draftLayout,
  draftOps,
  frameOf,
  pointInFrame,
  startDraft,
  storedBody,
  type TextDraft,
  TITLE_ID,
} from "@/lib/editor/text-session";
import { holdsText } from "@/lib/render/svg";
import { cn } from "@/lib/utils";

/** What became of an edit: applied, a no-op, paused while saving is, or refused. */
type Commit = "applied" | "unchanged" | "paused" | "refused";

/** The selection of every slide but the one being edited. */
const NONE: string[] = [];

/** The keyboard and mouse help, shown from the dock and read with the canvas. */
const HELP = [
  "點選形狀來選取，Shift 加選，拖曳空白處框選，Tab 換選下一個。",
  "按兩下形狀或標題來打字，選取形狀後按 Enter 也可以；Esc 結束。",
  "方向鍵移動，加 Shift 走得更遠。拖曳時按 Shift 鎖定方向，按 Alt 不對齊。",
  "⌘Z 復原，⌘⇧Z 重做，⌘D 再製，⌘C、⌘X、⌘V 複製、剪下、貼上（Windows 用 Ctrl）。",
  "Page Up、Page Down 換頁。",
];

/** Canvas px an arrow key moves the selection; Shift moves ten times as far. */
const NUDGE = 2;
/** How long nudges gather before they are saved as one edit, in ms. */
const NUDGE_SAVE_DELAY = 500;
/** How long typing pauses before it is saved as one edit, in ms. */
const TEXT_SAVE_DELAY = 800;

/** Style changes that apply to the text being edited rather than its shape. */
const TEXT_CHANGES = new Set<StyleChange["kind"]>([
  "text",
  "align",
  "anchor",
  "bullet",
  "level",
]);

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
  // The slide holding the selection, which keyboard and arrange tools act
  // on, and the slide most in view, which the page number shows and inserts
  // go to.
  const [slideIndex, setSlideIndex] = useState(0);
  const [visibleIndex, setVisibleIndex] = useState(0);
  const [selection, setSelection] = useState<string[]>([]);
  const scroller = useRef<HTMLDivElement>(null);
  const slideItems = useRef<(HTMLLIElement | null)[]>([]);
  const [nudge, setNudge] = useState({ dx: 0, dy: 0 });
  const nudgeRef = useRef(nudge);
  const nudgeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  /** An edit that could not be applied here; it never reached the server. */
  const [refusal, setRefusal] = useState<string | null>(null);

  // The text being edited in place, if any, and the field that takes its keys.
  const [draft, setDraftState] = useState<TextDraft | null>(null);
  const draftRef = useRef<TextDraft | null>(null);
  const setDraft = (next: TextDraft | null) => {
    draftRef.current = next;
    setDraftState(next);
  };
  const textarea = useRef<HTMLTextAreaElement>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

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
    setVisibleIndex((i) => Math.min(i, fresh.slides.length - 1));
    setSelection([]);
    clearTimeout(nudgeTimer.current);
    nudgeRef.current = { dx: 0, dy: 0 };
    setNudge(nudgeRef.current);
    // Text typed on the old document cannot be saved onto the new one.
    clearTimeout(draftTimer.current);
    draftRef.current = null;
    setDraftState(null);
  }, []);
  const { saver, state: saving } = useSaver(deckId, initialVersion, reload);

  const index = Math.min(slideIndex, doc.slides.length - 1);
  const slide = doc.slides[index];
  const visible = Math.min(visibleIndex, doc.slides.length - 1);

  /**
   * Applies an edit here and queues it for saving. Each patch is guarded by
   * the ids of what it touches, so it can never land on other shapes. While
   * the saver is reloading or offline, edits are paused: they would be made
   * on a document the server does not have. An edit is recorded for undo
   * with its inverse; an undo or redo is not. History keeps patches
   * unguarded; they are guarded again against the document they meet.
   */
  const commit = useCallback(
    (ops: Operation[], slideOf: number, recordStep = true): Commit => {
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
      const next = shareSlides(docRef.current, result.document);
      docRef.current = next;
      setDoc(next);
      setRefusal(null);
      if (recordStep) {
        const step = record(historyRef.current, {
          ops,
          inverse: result.inverse,
          slide: slideOf,
        });
        historyRef.current = step;
        setHistoryState(step);
      }
      saver.save(result.operations);
      return "applied";
    },
    [saver]
  );

  /**
   * Saves the text being edited, if it changed. When editing ends (`final`),
   * an emptied text box is deleted. An edit that is refused ends editing.
   */
  const flushText = useCallback(
    (final: boolean) => {
      clearTimeout(draftTimer.current);
      const current = draftRef.current;
      if (!current || (!current.dirty && !final)) return;
      const slideNow = docRef.current.slides[current.slide];
      if (!slideNow || slideNow.id !== current.slideId) {
        draftRef.current = null;
        setDraftState(null);
        return;
      }
      const outcome = commit(
        draftOps(slideNow, current.slide, current, final),
        current.slide
      );
      if (outcome === "refused") {
        draftRef.current = null;
        setDraftState(null);
      } else if (outcome !== "paused" && draftRef.current === current) {
        draftRef.current = { ...current, dirty: false };
        setDraftState(draftRef.current);
      }
    },
    [commit]
  );

  /** Saves gathered arrow-key nudges, and typing, each as one edit. */
  const flushNudge = useCallback(() => {
    flushText(false);
    clearTimeout(nudgeTimer.current);
    const { dx, dy } = nudgeRef.current;
    if (!dx && !dy) return;
    nudgeRef.current = { dx: 0, dy: 0 };
    setNudge(nudgeRef.current);
    const current = docRef.current.slides[index];
    commit(moveOps(current, index, new Set(selection), dx, dy), index);
  }, [commit, flushText, index, selection]);

  // Nudges still gathering are saved when the editor closes, and leaving the
  // page asks first while any edit is unsaved.
  const flushRef = useRef(flushNudge);
  useEffect(() => {
    flushRef.current = flushNudge;
  }, [flushNudge]);
  useEffect(() => () => flushRef.current(), []);
  const unsaved =
    saving.pending > 0 ||
    nudge.dx !== 0 ||
    nudge.dy !== 0 ||
    draft?.dirty === true;
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);

  /**
   * Ends text editing: saves the text and selects its shape, which is gone
   * if it was an emptied text box. `focus` hands the keys back to the canvas.
   */
  const endEdit = useCallback(
    (focus = false) => {
      const current = draftRef.current;
      if (!current) return;
      flushText(true);
      draftRef.current = null;
      setDraftState(null);
      const kept = docRef.current.slides[current.slide]?.shapes.some(
        (shape) => shape.id === current.target
      );
      setSelection(kept ? [current.target] : []);
      if (focus) {
        slideItems.current[current.slide]
          ?.querySelector<HTMLElement>("[role=application]")
          ?.focus({ preventScroll: true });
      }
    },
    [flushText]
  );

  // A press anywhere but a slide, the dock or one of its popovers ends text
  // editing; slides handle their own presses.
  const editing = draft !== null;
  useEffect(() => {
    if (!editing) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (
        target?.closest(
          "[role=application], [data-slot=floating-toolbar], [data-slot=popover-content]"
        )
      ) {
        return;
      }
      endEdit();
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [editing, endEdit]);

  /** Takes a new draft from the text field or the canvas. */
  const onDraft = (next: TextDraft, change: DraftChange) => {
    setDraft(next);
    if (change === "select") return;
    clearTimeout(draftTimer.current);
    if (change === "edit") flushText(false);
    else
      draftTimer.current = setTimeout(() => flushText(false), TEXT_SAVE_DELAY);
  };

  /**
   * Starts editing a shape's text or the title: at a point it selects the
   * word there (an empty text gets a caret), from the keyboard all of it.
   */
  const startEdit = (at: number, target: string, point: Point | null) => {
    endEdit();
    flushNudge();
    const slideNow = docRef.current.slides[at];
    const next = startDraft(slideNow, at, target, (body) => {
      if (!point || isEmpty(body)) return selectAll(body);
      const frame = frameOf(slideNow, target)!;
      const { pos } = pointInFrame(frame, draftLayout(frame, body), point);
      return wordAt(body, pos);
    });
    if (!next) return;
    setSlideIndex(at);
    setSelection(target === TITLE_ID ? [] : [target]);
    setDraft(next);
  };

  /** Selects shapes on a slide, which becomes the one being edited. */
  const select = (target: number, ids: string[]) => {
    endEdit();
    flushNudge();
    setSlideIndex(target);
    setSelection(ids);
  };

  /** Inserts on the slide in view and selects the new shape. */
  const insert = (kind: NewShapeKind) => {
    endEdit();
    flushNudge();
    const shape = newShape(kind, docRef.current.slides[visible]);
    if (commit(insertOps(visible, shape), visible) === "applied") {
      select(visible, [shape.id]);
      // A new text box is typed into right away.
      if (kind === "text") startEdit(visible, shape.id, null);
    }
  };

  /**
   * A style change on the text being edited: run styles go to the selected
   * text (at a caret, to what is typed next), paragraph styles to the
   * selected paragraphs. The field keeps the keys.
   */
  const restyleDraft = (current: TextDraft, change: StyleChange) => {
    const refocus = () =>
      requestAnimationFrame(() =>
        textarea.current?.focus({ preventScroll: true })
      );
    if (current.target === TITLE_ID) return refocus();
    const [start, end] = ordered(current.selection);
    const body = current.body;
    let next: TextDraft = current;
    switch (change.kind) {
      case "text": {
        const { kind: _, ...style } = change;
        void _;
        if (collapsed(current.selection)) {
          next = {
            ...current,
            typing: { ...(current.typing ?? styleAt(body, start)), ...style },
          };
          setDraft(next);
          return refocus();
        }
        next = { ...current, body: styleRange(body, start, end, style) };
        break;
      }
      case "align":
        next = {
          ...current,
          body: styleParagraphs(body, start, end, (props) => ({
            ...props,
            align: change.align,
          })),
        };
        break;
      case "bullet":
        next = {
          ...current,
          body: styleParagraphs(body, start, end, (props) => ({
            ...props,
            bullet: change.bullet,
          })),
        };
        break;
      case "level":
        next = {
          ...current,
          body: styleParagraphs(body, start, end, (props) => ({
            ...props,
            level: shiftLevel(props.level, change.delta),
          })),
        };
        break;
      case "anchor":
        next = { ...current, body: { ...body, anchor: change.anchor } };
        break;
    }
    onDraft({ ...next, dirty: true }, "edit");
    refocus();
  };

  /** Applies a style from the dock to the selection. */
  const restyle = (change: StyleChange) => {
    const current = draftRef.current;
    if (current && TEXT_CHANGES.has(change.kind)) {
      restyleDraft(current, change);
      return;
    }
    flushNudge();
    const slideNow = docRef.current.slides[index];
    commit(styleOps(slideNow, index, new Set(selection), change), index);
  };

  const reorder = (to: "front" | "back") => {
    flushNudge();
    const current = docRef.current.slides[index];
    commit(reorderOps(current, index, new Set(selection), to), index);
  };

  const remove = () => {
    endEdit();
    flushNudge();
    const current = docRef.current.slides[index];
    const ops = deleteOps(current, index, new Set(selection));
    if (commit(ops, index) === "applied") setSelection([]);
  };

  // The page number follows the slide most in view.
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const ratios = new Map<number, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const at = Number((entry.target as HTMLElement).dataset.index);
          ratios.set(at, entry.intersectionRatio);
        }
        let best = 0;
        for (const [at, ratio] of ratios) {
          if (ratio > (ratios.get(best) ?? -1)) best = at;
        }
        setVisibleIndex(best);
      },
      { root, threshold: [0, 0.25, 0.5, 0.75, 1] }
    );
    for (const item of slideItems.current) if (item) observer.observe(item);
    return () => observer.disconnect();
  }, [doc.slides.length]);

  // The zyx mark turns black over a slide and back over the page, as on the
  // Made pages, since no fade separates it from what scrolls beneath.
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    let frame = 0;
    const update = () => {
      const over = slideItems.current.some((item) => {
        const canvas = item?.querySelector("[role=application]");
        const rect = canvas?.getBoundingClientRect();
        // The mark sits 20 px in from the corner and is 20 px tall.
        return (
          rect &&
          rect.left <= 32 &&
          rect.right >= 32 &&
          rect.top <= 30 &&
          rect.bottom >= 30
        );
      });
      document.documentElement.style.setProperty(
        "--stage-logo-ink",
        over ? "var(--color-black)" : ""
      );
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    update();
    root.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      cancelAnimationFrame(frame);
      root.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      document.documentElement.style.removeProperty("--stage-logo-ink");
    };
  }, [doc.slides.length]);

  /** Scrolls a slide into view, and focuses its canvas when asked. */
  const goTo = (target: number, focus = false) => {
    if (target < 0 || target >= doc.slides.length) return;
    const item = slideItems.current[target];
    if (!item) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    item.scrollIntoView({
      behavior: still ? "auto" : "smooth",
      block: "start",
    });
    if (focus) {
      item.querySelector<HTMLElement>("[role=application]")?.focus({
        preventScroll: true,
      });
    }
  };

  /** Undoes or redoes one edit, on the slide it was made on. */
  const travel = (direction: "undo" | "redo") => {
    flushNudge();
    const move = (direction === "undo" ? undo : redo)(historyRef.current);
    if (!move) return;
    const outcome = commit(move.ops, move.slide, false);
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
    goTo(move.slide);
    const kept = new Set(
      docRef.current.slides[move.slide]?.shapes.map((shape) => shape.id)
    );
    setSelection((ids) => ids.filter((id) => kept.has(id)));
  };

  /** Adds a clip's shapes to a slide and selects them. */
  const place = (target: number, clip: Clip) => {
    const onto = docRef.current.slides[target];
    const shapes = pasteShapes(clip, pasteOffset(onto, clip));
    const ops = shapes.flatMap((shape) => insertOps(target, shape));
    if (commit(ops, target) === "applied") {
      select(
        target,
        shapes.map((shape) => shape.id)
      );
    }
  };

  /**
   * Undo and redo while typing: the typing so far is saved as one edit
   * first, and the text then follows what the document holds.
   */
  const travelText = (direction: "undo" | "redo") => {
    travel(direction);
    const current = draftRef.current;
    if (!current) return;
    const slideNow = docRef.current.slides[current.slide];
    const body =
      slideNow && slideNow.id === current.slideId
        ? storedBody(slideNow, current.target)
        : null;
    if (!body) {
      setDraft(null);
      return;
    }
    setDraft({
      ...current,
      body,
      selection: clampSelection(body, current.selection),
      composition: null,
      typing: null,
      goal: null,
      dirty: false,
    });
  };

  /** Copies the selection, when it is on the slide whose canvas has focus. */
  const copy = (event: ClipboardEvent, from: number) => {
    flushNudge();
    if (from !== index) return false;
    const clip = copyShapes(docRef.current.slides[index], new Set(selection));
    if (!clip) return false;
    if (!event.clipboardData) return false;
    event.preventDefault();
    const text = JSON.stringify(clip);
    event.clipboardData.setData(CLIP_TYPE, text);
    event.clipboardData.setData("text/plain", text);
    return true;
  };

  const paste = (event: ClipboardEvent, target: number) => {
    flushNudge();
    const data = event.clipboardData;
    // Anything but shapes copied here (text, an image) pastes nothing.
    const clip = parseClip(
      data?.getData(CLIP_TYPE) || data?.getData("text/plain")
    );
    if (!clip) return;
    event.preventDefault();
    place(target, clip);
  };

  const cut = (event: ClipboardEvent, from: number) => {
    // While edits are paused a cut would copy without removing anything.
    if (!saver.state().accepting) return;
    if (copy(event, from)) remove();
  };

  const duplicate = () => {
    flushNudge();
    const clip = copyShapes(docRef.current.slides[index], new Set(selection));
    if (clip) place(index, clip);
  };

  /** Keys on the canvas of slide `at`; selection lives on the active slide. */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, at: number) => {
    // Keys typed into a text belong to it.
    if (event.target !== event.currentTarget) return;
    const picked = at === index ? selection : NONE;
    const own = docRef.current.slides[at];
    const step = event.shiftKey ? NUDGE * 10 : NUDGE;
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    if (event.key in arrows && picked.length > 0) {
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
      picked.length > 0
    ) {
      event.preventDefault();
      remove();
    } else if (event.key === "Tab" && picked.length > 0) {
      // With a selection, Tab picks the next shape, so the keyboard alone
      // can reach every shape; without one, Tab leaves the canvas.
      event.preventDefault();
      const order = own.shapes.map((shape) => shape.id);
      const last = order.indexOf(picked[picked.length - 1]);
      const step = event.shiftKey ? -1 : 1;
      select(at, [order[(last + step + order.length) % order.length]]);
    } else if (event.key === "PageUp" || event.key === "PageDown") {
      event.preventDefault();
      goTo(at + (event.key === "PageUp" ? -1 : 1), true);
    } else if (
      (event.key === "Enter" || event.key === "F2") &&
      picked.length === 1
    ) {
      const shape = own.shapes.find((item) => item.id === picked[0]);
      if (shape && holdsText(shape)) {
        event.preventDefault();
        startEdit(at, shape.id, null);
      }
    } else if (event.key === "Escape") {
      select(at, []);
    } else if (event.metaKey || event.ctrlKey) {
      const key = event.key.toLowerCase();
      if (key === "a") {
        event.preventDefault();
        select(
          at,
          own.shapes.map((shape) => shape.id)
        );
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
  const style = selectionStyle(slide, new Set(selection));
  // While a text is edited, the text tools show and change its selection.
  if (draft && draft.slide === index) {
    const frame = frameOf(slide, draft.target);
    if (draft.target === TITLE_ID || !frame) {
      delete style.text;
    } else {
      const [start, end] = ordered(draft.selection);
      const runs = selectedStyles(draft.body, draft.selection).map((run) =>
        draft.typing && collapsed(draft.selection)
          ? { ...run, ...draft.typing }
          : run
      );
      const paragraphs = draft.body.paragraphs.slice(start.p, end.p + 1);
      style.text = textStyle(
        runs,
        paragraphs,
        paragraphs.map(
          (paragraph) =>
            (paragraph.align ?? frame.defaults.align) as
              "left" | "center" | "right"
        ),
        [draft.body.anchor ?? frame.defaults.anchor],
        frame.defaults
      );
    }
  }

  const textKeys: TextKeys = {
    read: () => draftRef.current,
    onChange: onDraft,
    onExit: () => endEdit(true),
    onUndo: () => travelText("undo"),
    onRedo: () => travelText("redo"),
    onToggle: (key) =>
      restyle({ kind: "text", [key]: style.text?.[key] !== true }),
    onLevel: (delta) => restyle({ kind: "level", delta }),
  };
  const canvasText = (at: number): CanvasText | null =>
    draft && draft.slide === at ? { draft, textarea, keys: textKeys } : null;
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
    <TextFocus.Provider value={textarea}>
      <div className="relative size-full">
        {/* The slides, one after another down a page that scrolls. Each spans
          the viewport less 1 rem on either side, with the same 1 rem between
          slides, 64 px kept at the top for the corners and room at the bottom
          for the dock. A slide snaps to sit just below the corners. */}
        <div
          ref={scroller}
          className="absolute inset-0 snap-y snap-proximity overflow-y-auto"
        >
          <ol className="flex flex-col items-center gap-4 pt-16 pb-28">
            {doc.slides.map((item, i) => (
              <li
                key={item.id}
                ref={(element) => {
                  slideItems.current[i] = element;
                }}
                data-index={i}
                className="flex w-full snap-start scroll-mt-16 justify-center"
              >
                <Canvas
                  className="w-[calc(100dvw-2rem)]"
                  slide={i === index ? shown : item}
                  number={i + 1}
                  selection={i === index ? selection : NONE}
                  onSelect={(ids) => select(i, ids)}
                  onMove={(ids, dx, dy) =>
                    commit(moveOps(docRef.current.slides[i], i, ids, dx, dy), i)
                  }
                  onResize={(id: string, box: Box) =>
                    commit(boxOps(docRef.current.slides[i], i, id, box), i)
                  }
                  onGestureStart={flushNudge}
                  onKeyDown={(event) => onKeyDown(event, i)}
                  onCopy={(event) => copy(event, i)}
                  onCut={(event) => cut(event, i)}
                  onPaste={(event) => paste(event, i)}
                  text={canvasText(i)}
                  onEditText={(target, point) => startEdit(i, target, point)}
                />
              </li>
            ))}
          </ol>
        </div>
        <p id="canvas-help" className="sr-only">
          {HELP.join(" ")}
        </p>

        {/* The dock floats at the bottom center, as Plump's does; only the bar
          and the notice take pointer events, the rest stays the canvas's. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-5 flex flex-col items-center gap-2 px-2">
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
            <DockLink href="/" tip="所有簡報" icon={LayoutGridIcon} />
            <Separator orientation="vertical" className="mx-1 my-2" />
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
            {/* The middle of the dock follows the selection: inserting with
              nothing selected, otherwise the selection's own tools. */}
            <fieldset
              disabled={paused}
              aria-label={none ? "插入" : "選取的物件"}
              className="contents"
            >
              {none ? (
                <>
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
                  <Tool
                    tip="插入文字方塊"
                    icon={TypeIcon}
                    onClick={() => insert("text")}
                  />
                </>
              ) : (
                <>
                  {style.fill !== undefined && (
                    <FillTool value={style.fill} onChange={restyle} />
                  )}
                  {style.stroke && (
                    <StrokeTool
                      stroke={style.stroke}
                      line={style.line !== undefined}
                      onChange={restyle}
                    />
                  )}
                  {style.line && (
                    <LineTools line={style.line} onChange={restyle} />
                  )}
                  {style.text && (
                    <>
                      <Separator orientation="vertical" className="mx-1 my-2" />
                      <TextTools text={style.text} onChange={restyle} />
                    </>
                  )}
                  <Separator orientation="vertical" className="mx-1 my-2" />
                  <Tool
                    tip="移到最上層"
                    icon={BringToFrontIcon}
                    onClick={() => reorder("front")}
                  />
                  <Tool
                    tip="移到最下層"
                    icon={SendToBackIcon}
                    onClick={() => reorder("back")}
                  />
                  <Tool tip="再製" icon={CopyPlusIcon} onClick={duplicate} />
                  <Tool tip="刪除" icon={Trash2Icon} onClick={remove} />
                </>
              )}
            </fieldset>
            <Separator orientation="vertical" className="mx-1 my-2" />
            <Tool
              tip="上一頁"
              icon={ChevronLeftIcon}
              disabled={visible === 0}
              onClick={() => goTo(visible - 1)}
            />
            <PageList
              slides={doc.slides}
              index={visible}
              onPick={(target) => goTo(target)}
            />
            <Tool
              tip="下一頁"
              icon={ChevronRightIcon}
              disabled={visible === doc.slides.length - 1}
              onClick={() => goTo(visible + 1)}
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
    </TextFocus.Provider>
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

function DockLink({
  href,
  tip,
  icon: Icon,
}: {
  href: string;
  tip: string;
  icon: ComponentType;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link
            href={href}
            aria-label={tip}
            className={buttonVariants({ variant: "ghost", size: "icon" })}
          />
        }
      >
        <Icon />
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
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
