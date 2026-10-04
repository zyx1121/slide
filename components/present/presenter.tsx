"use client";
// The presenter view: the slide shown and the next one, the speaker notes
// below them, a timer and the clock. It drives the projection windows over
// a BroadcastChannel (lib/present/control.ts): what they show, the deck when
// it changed elsewhere (checked every 3 seconds, as in the editor) and the
// end. Keys pressed in a projection window come here, so a clicker works
// whichever window has focus.
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  MinusIcon,
  MonitorUpIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  RotateCcwIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { deckStatusAction, loadDeckAction } from "@/app/decks/[id]/actions";
import { FIT, SlideFrame } from "@/components/present/projection";
import { Button } from "@/components/ui/button";
import type { DeckDocument } from "@/lib/deck/schema";
import {
  act,
  type Action,
  channelName,
  follow,
  type Message,
  type Show,
  typed,
} from "@/lib/present/control";
import { templateOf } from "@/lib/render/template";
import { cn } from "@/lib/utils";

const POLL_MS = 3000;
/** Speaker notes sizes, in px; the chosen one is kept in this browser. */
const NOTES_SIZES = [16, 20, 24, 28, 32, 40, 48];
const NOTES_KEY = "slide:notes-size";
const NOTES_DEFAULT = 24;

// The notes size as a tiny store over localStorage, which can be missing or
// refuse (a private window): then the choice lasts as long as the page.
let chosenSize: number | null = null;
const sizeListeners = new Set<() => void>();
function readNotesSize(): number {
  if (chosenSize !== null) return chosenSize;
  try {
    const kept = Number(localStorage.getItem(NOTES_KEY));
    if (NOTES_SIZES.includes(kept)) return kept;
  } catch {}
  return NOTES_DEFAULT;
}
function chooseNotesSize(size: number) {
  chosenSize = size;
  try {
    localStorage.setItem(NOTES_KEY, String(size));
  } catch {}
  for (const listener of sizeListeners) listener();
}
function subscribeNotesSize(listener: () => void) {
  sizeListeners.add(listener);
  return () => {
    sizeListeners.delete(listener);
  };
}

/** A projection window's address and its name, reused while it is open. */
export const screenUrl = (deckId: string) => `/decks/${deckId}/present/screen`;
export const screenName = (deckId: string) => `slide-screen-${deckId}`;

/** Elapsed time as m:ss, or h:mm:ss from an hour on. */
function elapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

const clockTime = (ms: number) =>
  new Date(ms).toLocaleTimeString("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

/** Where the browser can tell, a screen other than this window's. */
type ScreenInfo = {
  availLeft: number;
  availTop: number;
  availWidth: number;
  availHeight: number;
};
type ScreenDetails = { screens: ScreenInfo[]; currentScreen: ScreenInfo };

async function otherScreen(): Promise<ScreenInfo | null> {
  const details = (
    window as unknown as { getScreenDetails?: () => Promise<ScreenDetails> }
  ).getScreenDetails;
  if (!details) return null;
  try {
    const found = await details.call(window);
    return (
      found.screens.find((screen) => screen !== found.currentScreen) ?? null
    );
  } catch {
    return null;
  }
}

export function Presenter({
  deckId,
  title,
  initialDocument,
  initialVersion,
  start,
  screenBlocked,
}: {
  deckId: string;
  title: string;
  initialDocument: DeckDocument;
  initialVersion: number;
  /** The slide to start on, by position. */
  start: number;
  /** The browser blocked the projection window the editor tried to open. */
  screenBlocked: boolean;
}) {
  const router = useRouter();
  const [document, setDocument] = useState(initialDocument);
  const [version, setVersion] = useState(initialVersion);
  const [show, setShow] = useState<Show>({ index: start, blank: null });
  const [deleted, setDeleted] = useState(false);
  const [note, setNote] = useState<string | null>(
    screenBlocked
      ? "瀏覽器擋下了投影畫面，請允許這個網站的彈出式視窗，再按「投影畫面」。"
      : null
  );
  const notesSize = useSyncExternalStore(
    subscribeNotesSize,
    readNotesSize,
    () => NOTES_DEFAULT
  );
  const [now, setNow] = useState(() => Date.now());
  const [timer, setTimer] = useState<{ from: number; paused: number | null }>(
    () => ({ from: Date.now(), paused: null })
  );

  const channel = useRef<BroadcastChannel | null>(null);
  const latest = useRef({ document, version, show });
  useEffect(() => {
    latest.current = { document, version, show };
  }, [document, version, show]);
  const digits = useRef("");

  const move = useCallback((action: Action) => {
    setShow((current) =>
      act(current, latest.current.document.slides.length, action)
    );
  }, []);

  const end = useCallback(() => {
    channel.current?.postMessage({ type: "end" } satisfies Message);
    router.push(`/decks/${deckId}?slide=${latest.current.show.index + 1}`);
  }, [deckId, router]);

  // The projection windows: told the deck and what to show when they say
  // hello and on every change; their keys come back as actions.
  useEffect(() => {
    const opened = new BroadcastChannel(channelName(deckId));
    channel.current = opened;
    const tell = () => {
      const { document, version, show } = latest.current;
      opened.postMessage({ type: "deck", document, version } satisfies Message);
      opened.postMessage({ type: "show", show } satisfies Message);
    };
    opened.onmessage = (event: MessageEvent<Message>) => {
      if (event.data.type === "hello") tell();
      else if (event.data.type === "act") move(event.data.action);
    };
    tell();
    return () => {
      opened.close();
      channel.current = null;
    };
  }, [deckId, move]);
  useEffect(() => {
    channel.current?.postMessage({ type: "show", show } satisfies Message);
  }, [show]);
  useEffect(() => {
    channel.current?.postMessage({
      type: "deck",
      document,
      version,
    } satisfies Message);
  }, [document, version]);

  // Keys: the clicker's, and digits then Enter to go to a slide.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      // Space and Enter on a focused button press the button.
      const target = event.target as HTMLElement | null;
      if (
        target?.closest("button, a") &&
        (event.key === " " || event.key === "Enter")
      ) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        end();
        return;
      }
      const next = typed(digits.current, event.key, event.shiftKey);
      digits.current = next.digits;
      if (!next.action) return;
      event.preventDefault();
      move(next.action);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [end, move]);

  // The deck changed elsewhere: the new one, on the same slide by id.
  useEffect(() => {
    const poll = setInterval(() => {
      void deckStatusAction(deckId)
        .then(async (status) => {
          setDeleted(status === null);
          if (!status || status.version <= latest.current.version) return;
          const loaded = await loadDeckAction(deckId);
          if (!loaded || loaded.version <= latest.current.version) return;
          const before = latest.current.document;
          setDocument(loaded.document);
          setVersion(loaded.version);
          setShow((current) => ({
            ...current,
            index: follow(before, loaded.document, current.index),
          }));
        })
        .catch(() => {});
    }, POLL_MS);
    return () => clearInterval(poll);
  }, [deckId]);

  // The clock.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);
  const resize = (by: 1 | -1) => {
    const at = NOTES_SIZES.indexOf(notesSize);
    chooseNotesSize(
      NOTES_SIZES[Math.min(Math.max(at + by, 0), NOTES_SIZES.length - 1)]
    );
  };

  const openScreen = async () => {
    // Asked only where the browser can place windows (Chromium); elsewhere
    // the window opens at once, while the click still lets it.
    const other = "getScreenDetails" in window ? await otherScreen() : null;
    const features = other
      ? `popup,left=${other.availLeft},top=${other.availTop},width=${other.availWidth},height=${other.availHeight}`
      : "popup,width=960,height=540";
    const opened = window.open(screenUrl(deckId), screenName(deckId), features);
    setNote(
      opened
        ? null
        : "瀏覽器擋下了投影畫面，請允許這個網站的彈出式視窗，再按一次。"
    );
  };

  const slides = document.slides;
  const index = Math.min(show.index, slides.length - 1);
  const current = slides[index];
  const next = slides[index + 1];
  const template = templateOf(document).id;
  const notes = current?.notes?.trim() ? current.notes : "";
  const running = timer.paused === null;
  const time = (timer.paused ?? now) - timer.from;

  return (
    <div className="fixed inset-0 grid grid-rows-[auto_minmax(0,3fr)_minmax(0,2fr)] gap-4 bg-background p-4 text-foreground">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="上一頁"
            disabled={index === 0 && !show.blank}
            onClick={() => move({ kind: "step", by: -1 })}
          >
            <ChevronLeftIcon />
          </Button>
          <p className="text-sm whitespace-nowrap tabular-nums">
            {index + 1} / {slides.length}
          </p>
          <Button
            variant="ghost"
            size="icon"
            aria-label="下一頁"
            disabled={index === slides.length - 1 && !show.blank}
            onClick={() => move({ kind: "step", by: 1 })}
          >
            <ChevronRightIcon />
          </Button>
          <h1 className="ml-2 truncate text-sm text-muted-foreground">
            {title}
          </h1>
        </div>
        <div className="flex items-center gap-1">
          <p
            className="font-mono text-2xl tabular-nums"
            aria-label={`經過 ${elapsed(time)}`}
          >
            {elapsed(time)}
          </p>
          <Button
            variant="ghost"
            size="icon"
            aria-label={running ? "暫停計時" : "繼續計時"}
            onClick={() =>
              setTimer((t) =>
                t.paused === null
                  ? { ...t, paused: Date.now() }
                  : { from: t.from + Date.now() - t.paused, paused: null }
              )
            }
          >
            {running ? <PauseIcon /> : <PlayIcon />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="重新計時"
            onClick={() =>
              setTimer((t) => ({
                from: Date.now(),
                paused: t.paused === null ? null : Date.now(),
              }))
            }
          >
            <RotateCcwIcon />
          </Button>
          <p className="ml-3 text-sm text-muted-foreground tabular-nums">
            {clockTime(now)}
          </p>
        </div>
        <div className="flex flex-1 items-center justify-end gap-2">
          <Button variant="ghost" onClick={() => void openScreen()}>
            <MonitorUpIcon />
            投影畫面
          </Button>
          <Button
            variant={show.blank === "black" ? "secondary" : "ghost"}
            aria-pressed={show.blank === "black"}
            onClick={() => move({ kind: "blank", blank: "black" })}
          >
            黑畫面
          </Button>
          <Button variant="secondary" onClick={end}>
            結束
          </Button>
        </div>
        {(note || deleted) && (
          <p className="basis-full text-xs text-destructive">
            {deleted ? "這份簡報已經刪除了，畫面停在刪除前的版本。" : note}
          </p>
        )}
      </header>

      <div className="grid min-h-0 grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4">
        <section
          aria-label="目前的投影片"
          className="[container-type:size] flex min-h-0 items-center justify-center"
        >
          <div className={cn("relative", FIT)}>
            {current && (
              <SlideFrame
                slide={current}
                number={index + 1}
                template={template}
                className="size-full rounded-lg"
              />
            )}
            {show.blank && (
              <div className="absolute inset-0 grid place-items-center rounded-lg bg-black/80 text-sm text-white">
                投影幕：{show.blank === "black" ? "黑畫面" : "白畫面"}
              </div>
            )}
          </div>
        </section>
        <section aria-label="下一張" className="flex min-h-0 flex-col gap-2">
          <p className="text-xs text-muted-foreground">下一張</p>
          <div className="[container-type:size] flex min-h-0 flex-1 items-start">
            {next ? (
              <SlideFrame
                slide={next}
                number={index + 2}
                template={template}
                className={cn(FIT, "rounded-md")}
              />
            ) : (
              <div
                className={cn(
                  FIT,
                  "grid place-items-center rounded-md border border-border text-sm text-muted-foreground"
                )}
              >
                這是最後一張
              </div>
            )}
          </div>
        </section>
      </div>

      <section
        aria-label="講稿"
        className="flex min-h-0 flex-col gap-2 rounded-xl border border-border p-4"
      >
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">講稿</p>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label="講稿字小一點"
              disabled={notesSize === NOTES_SIZES[0]}
              onClick={() => resize(-1)}
            >
              <MinusIcon />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="講稿字大一點"
              disabled={notesSize === NOTES_SIZES.at(-1)}
              onClick={() => resize(1)}
            >
              <PlusIcon />
            </Button>
          </div>
        </div>
        <div
          className="min-h-0 flex-1 overflow-y-auto leading-relaxed whitespace-pre-wrap"
          style={{ fontSize: notesSize }}
        >
          {notes || (
            <span className="text-muted-foreground">這一頁沒有講稿。</span>
          )}
        </div>
      </section>
    </div>
  );
}
