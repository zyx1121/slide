"use client";
// The projection window: only the slide, on black, for the projector. The
// presenter view says what to show and keys pressed here go to it, so a
// clicker works whichever window has focus; opened on its own, it moves by
// itself. Double-click, F or the button puts it full screen; until then a
// hint says how, and the pointer hides when it rests.
import { useCallback, useEffect, useRef, useState } from "react";

import { Projection } from "@/components/present/projection";
import { Button } from "@/components/ui/button";
import type { DeckDocument } from "@/lib/deck/schema";
import {
  act,
  channelName,
  type Message,
  type Show,
  typed,
} from "@/lib/present/control";
import { cn } from "@/lib/utils";

const IDLE_MS = 2000;

export function Screen({
  deckId,
  initialDocument,
}: {
  deckId: string;
  initialDocument: DeckDocument;
}) {
  const [document, setDocument] = useState(initialDocument);
  const [show, setShow] = useState<Show>({ index: 0, blank: null });
  // Whether a presenter view answered: then it decides what shows.
  const [linked, setLinked] = useState(false);
  const [ended, setEnded] = useState(false);
  const [full, setFull] = useState(false);
  const [idle, setIdle] = useState(false);
  const channel = useRef<BroadcastChannel | null>(null);
  const linkedRef = useRef(false);
  const count = useRef(initialDocument.slides.length);
  const digits = useRef("");
  const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const opened = new BroadcastChannel(channelName(deckId));
    channel.current = opened;
    opened.onmessage = (event: MessageEvent<Message>) => {
      const message = event.data;
      if (message.type === "show") {
        linkedRef.current = true;
        setLinked(true);
        setEnded(false);
        setShow(message.show);
      } else if (message.type === "deck") {
        count.current = message.document.slides.length;
        setDocument(message.document);
      } else if (message.type === "end") {
        setEnded(true);
        // Only a window a script opened may close itself; others stay.
        setTimeout(() => window.close(), 1500);
      }
    };
    opened.postMessage({ type: "hello" } satisfies Message);
    return () => {
      opened.close();
      channel.current = null;
    };
  }, [deckId]);

  const toggleFull = useCallback(() => {
    const page = window.document;
    if (page.fullscreenElement) void page.exitFullscreen().catch(() => {});
    else void page.documentElement.requestFullscreen?.().catch(() => {});
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "f" || event.key === "F") {
        event.preventDefault();
        toggleFull();
        return;
      }
      const next = typed(digits.current, event.key, event.shiftKey);
      digits.current = next.digits;
      if (!next.action) return;
      event.preventDefault();
      const action = next.action;
      if (linkedRef.current) {
        channel.current?.postMessage({ type: "act", action } satisfies Message);
      } else {
        setShow((current) => act(current, count.current, action));
      }
    };
    const onFull = () => setFull(Boolean(window.document.fullscreenElement));
    window.addEventListener("keydown", onKey);
    window.document.addEventListener("fullscreenchange", onFull);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.document.removeEventListener("fullscreenchange", onFull);
    };
  }, [toggleFull]);

  const wake = () => {
    setIdle(false);
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setIdle(true), IDLE_MS);
  };
  useEffect(() => () => clearTimeout(idleTimer.current), []);

  return (
    <div
      className={cn("fixed inset-0 bg-black", idle && "cursor-none")}
      onDoubleClick={toggleFull}
      onMouseMove={wake}
    >
      <Projection
        document={document}
        index={Math.min(show.index, document.slides.length - 1)}
        blank={show.blank}
      />
      {!full && !ended && (
        <div className="absolute inset-x-4 bottom-6 flex justify-center">
          <div
            data-surface="tinted"
            className="flex items-center gap-3 rounded-xl border border-border px-4 py-2 text-sm text-foreground"
          >
            <p>
              {linked
                ? "把這個視窗拖到投影幕，再按兩下或按 F 全螢幕。"
                : "沒有連上簡報者畫面，可以直接用方向鍵換頁。"}
            </p>
            <Button onClick={toggleFull}>全螢幕</Button>
          </div>
        </div>
      )}
      {ended && (
        <div className="absolute inset-0 grid place-items-center bg-black text-sm text-white/70">
          簡報結束
        </div>
      )}
    </div>
  );
}
