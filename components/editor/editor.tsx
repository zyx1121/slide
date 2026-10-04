"use client";

import {
  BringToFrontIcon,
  CopyPlusIcon,
  DownloadIcon,
  GalleryVerticalIcon,
  GlobeIcon,
  ImageIcon,
  MessageSquareIcon,
  PlayIcon,
  PresentationIcon,
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
  useMemo,
  useRef,
  useState,
} from "react";

import {
  editDeckAction,
  loadDeckAction,
  publishDeckAction,
  deckStatusAction,
  selectAction,
} from "@/app/decks/[id]/actions";
import { Canvas, type CanvasText } from "@/components/editor/canvas";
import { CommentsTool } from "@/components/editor/comments-tool";
import { DockPopover, Tool } from "@/components/editor/dock-parts";
import { NotesTool } from "@/components/editor/notes-tool";
import { Play } from "@/components/present/play";
import { screenName, screenUrl } from "@/components/present/presenter";
import { HistoryTool } from "@/components/editor/history-tool";
import { SlideOverlay } from "@/components/editor/overlay";
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
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { compare } from "fast-json-patch";
import Link from "next/link";
import { useRouter } from "next/navigation";

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
import { type End, lineEndOps, newLine, type Side } from "@/lib/editor/connect";
import {
  type Box,
  type Point,
  shapeBounds,
  unionRects,
} from "@/lib/editor/geometry";
import type { Thread } from "@/lib/deck/comments";
import { guard } from "@/lib/editor/guard";
import {
  EMPTY_HISTORY,
  type History,
  historyAfterRebase,
  historyAfterReload,
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
  newImage,
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
import { templateOf, type TemplateId } from "@/lib/render/template";
import {
  blankSlide,
  deleteSlideOps,
  duplicateSlide,
  followSlide,
  insertSlideOps,
  moveSlideOps,
  notesOps,
} from "@/lib/editor/slides";
import { uploadImage } from "@/lib/editor/upload";
import { cn } from "@/lib/utils";

/** What became of an edit: applied, a no-op, paused while saving is, or refused. */
type Commit = "applied" | "unchanged" | "paused" | "refused";

/** The selection of every slide but the one being edited. */
const NONE: string[] = [];

/** A comment cut to a pin's label. */
const short = (body: string) =>
  [...body].length > 80 ? `${[...body].slice(0, 80).join("")}…` : body;

/** The keyboard and mouse help, read with the canvas by screen readers. */
const HELP = [
  "點選形狀來選取，Shift 加選，拖曳空白處框選，Tab 換選下一個；選取的物件旁會出現它的功能選單。",
  "按兩下形狀或標題來打字，選取形狀後按 Enter 也可以；Esc 結束。",
  "連接線：從形狀拖到另一個形狀，兩端會黏在最近的連接點；拖選取線條的端點可以改接。",
  "圖片：用插入圖片、貼上或直接拖進投影片；拖角落會維持比例，按住 Shift 可以自由變形。",
  "方向鍵移動，加 Shift 走得更遠。拖曳時按 Shift 鎖定方向，按 Alt 不對齊。",
  "⌘Z 復原，⌘⇧Z 重做，⌘D 再製，⌘C、⌘X、⌘V 複製、剪下、貼上（Windows 用 Ctrl）。",
  "Page Up、Page Down 換頁。",
];

/** Canvas px an arrow key moves the selection; Shift moves ten times as far. */
const NUDGE = 2;
/** How long nudges gather before they are saved as one edit, in ms. */
const NUDGE_SAVE_DELAY = 500;
/** How often the editor looks for changes made elsewhere, in ms. */
const REMOTE_POLL_MS = 3000;
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

/** The ids of every shape in a document. */
function shapeIds(document: DeckDocument): Set<string> {
  return new Set(
    document.slides.flatMap((slide) => slide.shapes.map((shape) => shape.id))
  );
}

/**
 * The save queue for one editor (lib/editor/saver.ts) and its state. Leaving
 * with edits still on their way asks first.
 */
function useSaver(
  deckId: string,
  initialVersion: number,
  onReload: (document: DeckDocument) => boolean | void,
  onRebase: (document: DeckDocument) => void
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
      onRebase,
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
  initialPublished,
  initialPublicId,
  invalid = null,
  notice: initialNotice = null,
  initialSlide = 0,
}: {
  deckId: string;
  initialDocument: DeckDocument;
  initialVersion: number;
  initialPublished: boolean;
  initialPublicId: string | null;
  /**
   * Why the stored deck cannot be edited, when it breaks the schema: every
   * edit would be refused, so none is offered.
   */
  invalid?: string | null;
  /** A note to show once, such as an import report. */
  notice?: string | null;
  /** The slide to open on, by position, as when back from presenting. */
  initialSlide?: number;
}) {
  const router = useRouter();
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
  const [slideIndex, setSlideIndex] = useState(initialSlide);
  const [visibleIndex, setVisibleIndex] = useState(initialSlide);
  const [selection, setSelection] = useState<string[]>([]);
  /** A tool that draws on the next drag instead of selecting. */
  const [tool, setTool] = useState<"connector" | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const slideItems = useRef<(HTMLLIElement | null)[]>([]);
  const [nudge, setNudge] = useState({ dx: 0, dy: 0 });
  const nudgeRef = useRef(nudge);
  const nudgeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [notice, setNotice] = useState(initialNotice);

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

  // The first undo or redo not yet saved: the history and document it
  // started from, so a lost save can put its step back.
  const unsavedMove = useRef<{
    history: History;
    document: DeckDocument;
  } | null>(null);

  const reload = useCallback((fresh: DeckDocument) => {
    // Undo steps were made against the local document: they stand when the
    // server's is the same, come back to before a lost undo or redo, and
    // otherwise no longer apply.
    const changed = compare(docRef.current, fresh).length > 0;
    const lost = unsavedMove.current;
    const next = historyAfterReload(
      historyRef.current,
      !changed,
      lost && {
        history: lost.history,
        fromDocument: compare(lost.document, fresh).length === 0,
      }
    );
    unsavedMove.current = null;
    historyRef.current = next;
    setHistoryState(next);
    const before = docRef.current;
    docRef.current = fresh;
    setDoc(fresh);
    setSlideIndex((i) => followSlide(before, fresh, i));
    setVisibleIndex((i) => followSlide(before, fresh, i));
    // Shapes still there stay selected: a change from elsewhere, such as the
    // member's agent, should not take away what the member was pointing at.
    const present = shapeIds(fresh);
    setSelection((ids) => {
      const kept = ids.filter((id) => present.has(id));
      return kept.length === ids.length ? ids : kept;
    });
    clearTimeout(nudgeTimer.current);
    nudgeRef.current = { dx: 0, dy: 0 };
    setNudge(nudgeRef.current);
    // Text typed on the old document cannot be saved onto the new one.
    clearTimeout(draftTimer.current);
    draftRef.current = null;
    setDraftState(null);
    return changed;
  }, []);
  // The server's document with the member's waiting edits already on it, or
  // a change made elsewhere while they were idle. What the member is in the
  // middle of stays: the text being typed, nudges gathering and the
  // selection. Undo steps address slides and shapes by position, so they
  // stay only while nothing moved. Only text whose box is gone ends, and
  // says so.
  const rebase = useCallback((fresh: DeckDocument) => {
    const before = docRef.current;
    const history = historyAfterRebase(historyRef.current, before, fresh);
    if (history !== historyRef.current) {
      unsavedMove.current = null;
      historyRef.current = history;
      setHistoryState(history);
    }
    docRef.current = fresh;
    setDoc(fresh);
    setSlideIndex((i) => followSlide(before, fresh, i));
    setVisibleIndex((i) => followSlide(before, fresh, i));
    const present = shapeIds(fresh);
    setSelection((ids) => {
      const kept = ids.filter((id) => present.has(id));
      return kept.length === ids.length ? ids : kept;
    });
    const draft = draftRef.current;
    if (!draft) return;
    const at = fresh.slides.findIndex((slide) => slide.id === draft.slideId);
    const there =
      at >= 0 && (draft.target === TITLE_ID || present.has(draft.target));
    if (!there) {
      clearTimeout(draftTimer.current);
      draftRef.current = null;
      setDraftState(null);
      setRefusal("你正在打字的文字方塊被刪掉了，剛打的字沒有存到。");
    } else if (at !== draft.slide) {
      draftRef.current = { ...draft, slide: at };
      setDraftState(draftRef.current);
    }
  }, []);
  const { saver, state: saving } = useSaver(
    deckId,
    initialVersion,
    reload,
    rebase
  );

  // The deck as the server has it: whether it is still there and published.
  const [publication, setPublication] = useState({
    published: initialPublished,
    publicId: initialPublicId,
  });
  const [deleted, setDeleted] = useState(false);

  // Changes made elsewhere (the member's agent, another tab) come in while
  // the member is not in the middle of an edit: text being typed, nudges
  // gathering or saves on their way wait for the next look, and the saver
  // checks again once the deck is loaded.
  useEffect(() => {
    const idle = () =>
      !draftRef.current && !nudgeRef.current.dx && !nudgeRef.current.dy;
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible" || !idle()) return;
      void deckStatusAction(deckId)
        .then((server) => {
          setDeleted(server === null);
          if (server === null) return;
          setPublication((now) =>
            now.published === server.published &&
            now.publicId === server.publicId
              ? now
              : { published: server.published, publicId: server.publicId }
          );
          if (server.version > saver.version()) return saver.refresh(idle);
        })
        .catch(() => {});
    }, REMOTE_POLL_MS);
    return () => clearInterval(timer);
  }, [deckId, saver]);
  // Once every edit is saved, no undo or redo can be lost any more.
  useEffect(() => {
    if (saving.pending === 0) unsavedMove.current = null;
  }, [saving.pending]);

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
      if (invalid !== null || deleted) return "paused";
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
    [saver, invalid, deleted]
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
    if (invalid !== null) return;
    endEdit();
    flushNudge();
    const slideNow = docRef.current.slides[at];
    const next = startDraft(slideNow, at, target, (body) => {
      if (!point || isEmpty(body)) return selectAll(body);
      const frame = frameOf(slideNow, target, templateOf(docRef.current).id)!;
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

  // Images on their way to the server, for the status in the dock.
  const [uploads, setUploads] = useState(0);
  const filePicker = useRef<HTMLInputElement>(null);

  /**
   * Uploads image files and places each on a slide, centered on `at` (the
   * middle of the slide by default) and stepped down for the next one.
   * Files that are not images are left out without a word; a refused
   * image says why. The slide is followed by its id: a change from
   * elsewhere during the upload may move it.
   */
  const addImages = async (target: number, files: File[], at?: Point) => {
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) return;
    endEdit();
    const slideId = docRef.current.slides[target]?.id;
    setUploads((n) => n + images.length);
    const placed: string[] = [];
    let where = target;
    let k = 0;
    for (const file of images) {
      const result = await uploadImage(file);
      setUploads((n) => n - 1);
      if (!result.ok) {
        setRefusal(result.message);
        continue;
      }
      where = docRef.current.slides.findIndex((slide) => slide.id === slideId);
      if (where < 0) {
        setRefusal("要放圖片的投影片被刪掉了，圖片沒有放上去。");
        continue;
      }
      const center = at ?? { x: 960, y: 540 };
      const shape = newImage(result.asset, {
        x: center.x + 40 * k,
        y: center.y + 40 * k,
      });
      k++;
      if (commit(insertOps(where, shape), where) === "applied") {
        placed.push(shape.id);
      }
    }
    if (placed.length > 0 && where >= 0) select(where, placed);
  };

  // A slide to scroll to once the list has redrawn with it: at first, the
  // slide the editor opens on.
  const pendingScroll = useRef<number | null>(
    initialSlide > 0 ? initialSlide : null
  );
  useEffect(() => {
    const at = pendingScroll.current;
    if (at === null) return;
    pendingScroll.current = null;
    slideItems.current[at]?.scrollIntoView({ block: "start" });
  });

  /**
   * Changes the slide list around the slide in view: a blank slide or a
   * copy after it, moving it, deleting it. The slide it leaves in view is
   * scrolled to once the list has redrawn.
   */
  const changeSlides = (
    action: "add" | "duplicate" | "up" | "down" | "delete"
  ) => {
    endEdit();
    flushNudge();
    const at = visible;
    const slides = docRef.current.slides;
    const plan: { ops: Operation[]; show: number } =
      action === "add"
        ? { ops: insertSlideOps(at + 1, blankSlide()), show: at + 1 }
        : action === "duplicate"
          ? {
              ops: insertSlideOps(at + 1, duplicateSlide(slides[at])),
              show: at + 1,
            }
          : action === "up"
            ? { ops: moveSlideOps(at, at - 1), show: at - 1 }
            : action === "down"
              ? { ops: moveSlideOps(at, at + 1), show: at + 1 }
              : {
                  ops: slides.length > 1 ? deleteSlideOps(at) : [],
                  show: Math.max(0, at - 1),
                };
    if (commit(plan.ops, plan.show) !== "applied") return;
    setSelection([]);
    setSlideIndex(plan.show);
    // The slide in view is the one the action left, now, not once the
    // scroll has caught up: a second action in a row acts on it.
    setVisibleIndex(plan.show);
    pendingScroll.current = plan.show;
  };

  /**
   * Saves a slide's speaker notes, found by its id: the slide may have moved
   * while they were typed. False when the edit could not be made.
   */
  const saveNotes = useCallback(
    (slideId: string, notes: string) => {
      const at = docRef.current.slides.findIndex(
        (slide) => slide.id === slideId
      );
      if (at < 0) return true;
      const outcome = commit(
        notesOps(docRef.current.slides[at], at, notes),
        at
      );
      return outcome === "applied" || outcome === "unchanged";
    },
    [commit]
  );

  // Presenting on this screen, from the slide at this position.
  const [playing, setPlaying] = useState<number | null>(null);
  /** The slides full screen over the editor, from slide `from`. */
  const startPlay = (from: number) => {
    endEdit();
    flushNudge();
    // Asked in the click itself: browsers allow full screen only then.
    void window.document.documentElement.requestFullscreen?.().catch(() => {});
    setPlaying(from);
  };
  const endPlay = useCallback((at: number) => {
    setPlaying(null);
    if (window.document.fullscreenElement) {
      void window.document.exitFullscreen().catch(() => {});
    }
    setSlideIndex(at);
    setVisibleIndex(at);
    pendingScroll.current = at;
  }, []);
  /**
   * The presenter view in this tab, from slide `from`, and the projection
   * window, opened in the click itself or the browser blocks it.
   */
  const startPresenter = (from: number) => {
    endEdit();
    flushNudge();
    const opened = window.open(
      screenUrl(deckId),
      screenName(deckId),
      "popup,width=960,height=540"
    );
    router.push(
      `/decks/${deckId}/present?from=${from + 1}${opened ? "" : "&blocked=1"}`
    );
  };

  /** Adds a connector drawn on a slide and selects it. */
  const drawLine = (at: number, start: End, end: End) => {
    setTool(null);
    const line = newLine(start, end);
    if (commit(insertOps(at, line), at) === "applied") select(at, [line.id]);
  };

  /** Moves one end of a connector, gluing it to a site or freeing it. */
  const moveLineEnd = (at: number, id: string, side: Side, end: End) => {
    commit(lineEndOps(docRef.current.slides[at], at, id, side, end), at);
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

  // What the member has selected, for their agent (get_selection): the
  // shapes on the slide being edited, with the text range being typed in,
  // or the slide in view when nothing is selected. Sent once it settles.
  const selectionInput = useMemo(() => {
    const at = selection.length > 0 || draft ? index : visible;
    const slideNow = doc.slides[at];
    if (!slideNow) return null;
    const targets =
      draft && draft.target !== "title" && draft.slide === at
        ? [
            collapsed(draft.selection)
              ? { shape: draft.target }
              : (() => {
                  const [from, to] = ordered(draft.selection);
                  return {
                    shape: draft.target,
                    text: {
                      from: { p: from.p, o: from.o },
                      to: { p: to.p, o: to.o },
                    },
                  };
                })(),
          ]
        : selection.map((shape) => ({ shape }));
    return { slideId: slideNow.id, targets };
  }, [doc.slides, draft, index, selection, visible]);
  const sentSelection = useRef("");
  useEffect(() => {
    if (!selectionInput) return;
    const key = JSON.stringify(selectionInput);
    if (key === sentSelection.current) return;
    const timer = setTimeout(() => {
      sentSelection.current = key;
      void selectAction(deckId, selectionInput).catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [deckId, selectionInput]);

  // The menu of the selected shapes floats next to them on the active slide,
  // and steps aside while shapes are dragged.
  const [dragging, setDragging] = useState(false);
  const [activeSlide, setActiveSlide] = useState<HTMLElement | null>(null);

  // Comments: the panel, the thread to show first, and open threads as pins.
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentFocus, setCommentFocus] = useState<string | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const slideNumberOf = useCallback(
    (slideId: string) => {
      const at = docRef.current.slides.findIndex((s) => s.id === slideId);
      return at < 0 ? null : at + 1;
    },
    // The document is read through its ref; slide order is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [doc.slides]
  );
  const pinsOf = (slideIndex: number) => {
    const slideNow = doc.slides[slideIndex];
    if (!slideNow) return [];
    const byId = new Map(slideNow.shapes.map((shape) => [shape.id, shape]));
    return threads
      .filter((thread) => thread.status === "open")
      .map((thread, n) => ({ thread, n: n + 1 }))
      .filter(({ thread }) => thread.slideId === slideNow.id)
      .map(({ thread, n }) => {
        const bounds = unionRects(
          thread.targets
            .map((target) => byId.get(target.shape))
            .filter((shape) => shape !== undefined)
            .map((shape) => shapeBounds(shape, byId))
        );
        return {
          id: thread.id,
          n,
          body: thread.body,
          x: bounds ? bounds.x + bounds.w : 1920 - 48,
          y: bounds ? bounds.y : 48,
        };
      });
  };

  const slideOrder = doc.slides.map((slide) => slide.id).join(" ");
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
    // Again whenever the slides change order, so no ratio is kept under an
    // index that now names another slide.
  }, [slideOrder]);

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
    const before = { history: historyRef.current, document: docRef.current };
    const outcome = commit(move.ops, move.slide, false);
    if (outcome === "applied") unsavedMove.current ??= before;
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
    // A picture copied from elsewhere (a screenshot, an image in a page)
    // is uploaded and placed.
    const files = [...(data?.files ?? [])];
    if (!clip && files.some((file) => file.type.startsWith("image/"))) {
      event.preventDefault();
      void addImages(target, files);
      return;
    }
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
      if (!saver.state().accepting || deleted) return;
      const [dx, dy] = arrows[event.key];
      nudgeRef.current = {
        dx: nudgeRef.current.dx + dx,
        dy: nudgeRef.current.dy + dy,
      };
      setNudge(nudgeRef.current);
      clearTimeout(nudgeTimer.current);
      // Through the ref: by the time it fires, a change from elsewhere may
      // have moved the slide, and only the latest render knows where.
      nudgeTimer.current = setTimeout(
        () => flushRef.current(),
        NUDGE_SAVE_DELAY
      );
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
      if (tool) setTool(null);
      else select(at, []);
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
      } else if (key === "enter") {
        event.preventDefault();
        startPlay(at);
      }
    }
  };

  const shown =
    nudge.dx || nudge.dy
      ? movedSlide(slide, new Set(selection), nudge.dx, nudge.dy)
      : slide;
  const none = selection.length === 0;
  const selectedShapes = new Map(
    shown.shapes.map((shape) => [shape.id, shape])
  );
  const selectedRegion = none
    ? null
    : unionRects(
        selection
          .map((id) => selectedShapes.get(id))
          .filter((shape) => shape !== undefined)
          .map((shape) => shapeBounds(shape, selectedShapes))
      );
  const style = selectionStyle(slide, new Set(selection));
  // While a text is edited, the text tools show and change its selection.
  if (draft && draft.slide === index) {
    const frame = frameOf(slide, draft.target, templateOf(doc).id);
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
  const paused = !saving.accepting || invalid !== null || deleted;
  const shownTemplate = templateOf(doc).id;
  const nudging = nudge.dx !== 0 || nudge.dy !== 0;

  const problem =
    invalid ??
    (deleted ? "這份簡報已經刪除了，可以在首頁的「最近刪除」還原。" : null) ??
    refusal ??
    saving.message;
  const status =
    saving.phase === "reloading"
      ? "載入最新版本…"
      : uploads > 0
        ? "上傳圖片中…"
        : saving.pending > 0
          ? "儲存中…"
          : "已儲存";

  // The selected shapes' menu, floating next to them.
  const selectionMenu = (
    <>
      {selection.length > 1 && (
        <span className="px-2 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
          {selection.length} 個物件
        </span>
      )}
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
      {style.line && <LineTools line={style.line} onChange={restyle} />}
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
      <Separator orientation="vertical" className="mx-1 my-2" />
      <Tool
        tip="評論選取的物件"
        icon={MessageSquareIcon}
        onClick={() => {
          setCommentFocus(null);
          setCommentsOpen(true);
        }}
      />
    </>
  );

  return (
    <TextFocus.Provider value={textarea}>
      <div className="relative size-full">
        {/* The slides, one after another down a page that scrolls. Each spans
          the scroller less 1 rem of padding on either side (padding, so a
          scrollbar never eats it), with the same 1 rem between slides, 64 px
          kept at the top for the corners and room at the bottom for the dock.
          A slide snaps to sit just below the corners. */}
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
                className="w-full snap-start scroll-mt-16 px-4"
              >
                <div
                  className="relative"
                  ref={i === index ? setActiveSlide : undefined}
                >
                  <Canvas
                    className="w-full"
                    slide={i === index ? shown : item}
                    number={i + 1}
                    template={shownTemplate}
                    selection={i === index ? selection : NONE}
                    onSelect={(ids) => select(i, ids)}
                    onMove={(ids, dx, dy) =>
                      commit(
                        moveOps(docRef.current.slides[i], i, ids, dx, dy),
                        i
                      )
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
                    tool={tool}
                    onDrawLine={(start, end) => drawLine(i, start, end)}
                    onLineEnd={(id, side, end) => moveLineEnd(i, id, side, end)}
                    onDropFiles={(files, point) =>
                      void addImages(i, files, point)
                    }
                    onDragging={setDragging}
                  />
                  {pinsOf(i).map((pin) => (
                    <button
                      key={pin.id}
                      type="button"
                      aria-label={`評論 ${pin.n}：${short(pin.body)}`}
                      title={short(pin.body)}
                      className="absolute flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-background text-xs text-foreground tabular-nums shadow ring-1 ring-foreground/50 outline-offset-2 focus-visible:outline-2"
                      style={{
                        left: `${Math.min(100, Math.max(0, (pin.x / 1920) * 100))}%`,
                        top: `${Math.min(100, Math.max(0, (pin.y / 1080) * 100))}%`,
                      }}
                      onClick={() => {
                        setCommentFocus(pin.id);
                        setCommentsOpen(true);
                      }}
                    >
                      {pin.n}
                    </button>
                  ))}
                </div>
                {i === index && (
                  <SlideOverlay
                    slide={activeSlide}
                    region={dragging || paused ? null : selectedRegion}
                    label={
                      selection.length > 1
                        ? `選取的 ${selection.length} 個物件`
                        : "選取的物件"
                    }
                  >
                    {selectionMenu}
                  </SlideOverlay>
                )}
              </li>
            ))}
          </ol>
        </div>
        <input
          ref={filePicker}
          type="file"
          accept="image/png,image/jpeg,image/gif"
          multiple
          hidden
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = "";
            void addImages(visible, files);
          }}
        />
        <p id="canvas-help" className="sr-only">
          {HELP.join(" ")}
        </p>

        {/* The dock floats at the bottom center, as Plump's does; only the bar
          and the notice take pointer events, the rest stays the canvas's. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-5 flex flex-col items-center gap-2 px-2">
          {notice && !problem && (
            <div
              role="status"
              data-slot="floating-notice"
              data-surface="tinted"
              className="pointer-events-auto flex max-w-xl items-center gap-3 rounded-xl border px-3 py-2"
            >
              <p className="text-xs">{notice}</p>
              <Button variant="ghost" onClick={() => setNotice(null)}>
                知道了
              </Button>
            </div>
          )}
          {problem && (
            <div
              role="alert"
              data-slot="floating-notice"
              data-surface="tinted"
              className="pointer-events-auto flex items-center gap-3 rounded-xl border px-3 py-2"
            >
              <p className="text-xs text-destructive">{problem}</p>
              {saving.phase === "blocked" && !deleted && (
                <Button variant="ghost" onClick={() => saver.retry()}>
                  重新載入
                </Button>
              )}
              {deleted && (
                <Link href="/" className={buttonVariants({ variant: "ghost" })}>
                  所有簡報
                </Link>
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
            <DockDownload
              href={`/api/decks/${deckId}/export`}
              tip="下載 PowerPoint"
              icon={DownloadIcon}
            />
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
              disabled={paused || nudging || history.future.length === 0}
              onClick={() => travel("redo")}
            />
            <Separator orientation="vertical" className="mx-1 my-2" />
            {/* Inserting stays in the dock; the selected shapes' own tools
              float next to them (SlideOverlay, below the slides). */}
            <fieldset disabled={paused} aria-label="插入" className="contents">
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
              <Tool
                tip="插入圖片"
                icon={ImageIcon}
                onClick={() => filePicker.current?.click()}
              />
              <Tool
                tip="畫連接線"
                icon={ConnectorGlyph}
                pressed={tool === "connector"}
                onClick={() => {
                  endEdit();
                  setTool((current) => (current ? null : "connector"));
                }}
              />
            </fieldset>
            <Separator orientation="vertical" className="mx-1 my-2" />
            <PageList
              slides={doc.slides}
              template={templateOf(doc).id}
              index={visible}
              onPick={(target) => goTo(target)}
            />
            <SlideMenu
              disabled={paused}
              first={visible === 0}
              last={visible === doc.slides.length - 1}
              only={doc.slides.length === 1}
              onAction={changeSlides}
            />
            <NotesTool
              slideId={doc.slides[visible].id}
              slideNumber={visible + 1}
              notes={doc.slides[visible].notes ?? ""}
              disabled={paused}
              onSave={saveNotes}
            />
            <Tool
              tip="播放（⌘ Enter）"
              icon={PlayIcon}
              onClick={() => startPlay(visible)}
            />
            <Tool
              tip="簡報者模式：投影幕放投影片，這裡看講稿"
              icon={PresentationIcon}
              onClick={() => startPresenter(visible)}
            />
            <Separator orientation="vertical" className="mx-1 my-2" />
            {selectionInput && (
              <CommentsTool
                deckId={deckId}
                selection={selectionInput}
                slideNumberOf={slideNumberOf}
                open={commentsOpen}
                onOpenChange={(next) => {
                  setCommentsOpen(next);
                  if (!next) setCommentFocus(null);
                }}
                focus={commentFocus}
                onJump={(slideId, shapes) => {
                  const at = docRef.current.slides.findIndex(
                    (s) => s.id === slideId
                  );
                  if (at < 0) return;
                  const here = new Set(
                    docRef.current.slides[at].shapes.map((shape) => shape.id)
                  );
                  setCommentsOpen(false);
                  goTo(at);
                  select(
                    at,
                    shapes.filter((id) => here.has(id))
                  );
                }}
                onThreads={setThreads}
              />
            )}
            <HistoryTool
              deckId={deckId}
              busy={saving.pending > 0 || draft?.dirty === true || nudging}
              onChanged={async () => {
                await saver.refresh();
              }}
            />
            <p className="min-w-16 px-2 text-center text-xs text-muted-foreground">
              {status}
            </p>
            <PublishTool
              deckId={deckId}
              publication={publication}
              onPublication={setPublication}
            />
          </div>
        </div>
      </div>
      {playing !== null && (
        <Play document={doc} start={playing} onEnd={endPlay} />
      )}
    </TextFocus.Provider>
  );
}

/**
 * The slide list, opened from the page number in the dock and floating over
 * the slide, so the slide keeps the page.
 */
function PageList({
  slides,
  template,
  index,
  onPick,
}: {
  slides: DeckDocument["slides"];
  template: TemplateId;
  index: number;
  onPick: (index: number) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <DockPopover
      tip="所有頁面"
      label={`第 ${index + 1} 頁，共 ${slides.length} 頁`}
      trigger={`${index + 1} / ${slides.length}`}
      button={{ size: "default", className: "tabular-nums" }}
      panel="p-3"
      open={open}
      onOpenChange={setOpen}
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
                template={template}
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
    </DockPopover>
  );
}

/**
 * Publishing, from the dock: a published deck is readable by anyone with its
 * link, which the popover shows with a copy button.
 */
function PublishTool({
  deckId,
  publication: state,
  onPublication: setState,
}: {
  deckId: string;
  /** Kept by the editor, which also follows changes made elsewhere. */
  publication: { published: boolean; publicId: string | null };
  onPublication: (next: {
    published: boolean;
    publicId: string | null;
  }) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const url =
    state.published && state.publicId && typeof window !== "undefined"
      ? `${window.location.origin}/s/${state.publicId}`
      : null;
  const toggle = async (published: boolean) => {
    setBusy(true);
    setNote(null);
    try {
      const result = await publishDeckAction(deckId, published);
      if (result) setState(result);
      else setNote("沒有改成功，請重新整理後再試。");
    } catch {
      setNote("沒有改成功，請檢查網路。");
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setNote("已複製連結。");
    } catch {
      setNote("無法複製，請手動選取連結。");
    }
  };
  const label = state.published ? "已發布" : "發布";
  return (
    <DockPopover
      tip={label}
      trigger={<GlobeIcon />}
      button={{ variant: state.published ? "secondary" : "ghost" }}
      panel="w-80"
    >
      {url ? (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            任何拿到連結的人都能看和下載這份簡報，不用登入。之後的修改也會馬上公開。
          </p>
          <input
            readOnly
            value={url}
            aria-label="公開連結"
            onFocus={(event) => event.currentTarget.select()}
            className="h-8 rounded-md border bg-transparent px-2 text-xs"
          />
          <div className="flex gap-2">
            <Button onClick={copy}>複製連結</Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => toggle(false)}
            >
              停止發布
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">
            發布後，任何拿到連結的人都能看和下載這份簡報，不用登入；之後的修改也會馬上公開。可以隨時停止。
          </p>
          <Button disabled={busy} onClick={() => toggle(true)}>
            發布
          </Button>
        </div>
      )}
      {note && (
        <p role="status" className="mt-2 text-xs text-muted-foreground">
          {note}
        </p>
      )}
    </DockPopover>
  );
}

/** The slide in view: add one after it, copy it, move it, delete it. */
function SlideMenu({
  disabled,
  first,
  last,
  only,
  onAction,
}: {
  disabled: boolean;
  first: boolean;
  last: boolean;
  only: boolean;
  onAction: (action: "add" | "duplicate" | "up" | "down" | "delete") => void;
}) {
  const [open, setOpen] = useState(false);
  const item = (
    label: string,
    action: Parameters<typeof onAction>[0],
    off = false
  ) => (
    <Button
      variant="ghost"
      className="justify-start"
      disabled={disabled || off}
      onClick={() => {
        onAction(action);
        setOpen(false);
      }}
    >
      {label}
    </Button>
  );
  return (
    <DockPopover
      tip="投影片"
      trigger={<GalleryVerticalIcon />}
      panel="w-48"
      open={open}
      onOpenChange={setOpen}
    >
      <div className="flex flex-col">
        {item("新增空白頁", "add")}
        {item("複製這一頁", "duplicate")}
        {item("上移", "up", first)}
        {item("下移", "down", last)}
        {item("刪除這一頁", "delete", only)}
      </div>
    </DockPopover>
  );
}

/** A dock button that downloads a file, such as the deck as .pptx. */
function DockDownload({
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
          <a
            href={href}
            download
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

function ConnectorGlyph() {
  return (
    <svg {...glyph}>
      <rect x="2" y="3" width="7" height="6" />
      <rect x="15" y="15" width="7" height="6" />
      <path d="M9 6h4v12h2" />
    </svg>
  );
}
