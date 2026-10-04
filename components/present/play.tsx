"use client";
// Presenting on this screen: the slides full screen, from the slide in view,
// over the editor. Keys move as in the presenter view, a click steps on and
// a right click back; Escape, or leaving full screen another way, ends it on
// the slide shown, which the editor then shows.
import { useEffect, useRef, useState } from "react";

import { Projection } from "@/components/present/projection";
import type { DeckDocument } from "@/lib/deck/schema";
import { act, type Show, typed } from "@/lib/present/control";
import { cn } from "@/lib/utils";

const IDLE_MS = 2000;

export function Play({
  document,
  start,
  onEnd,
}: {
  document: DeckDocument;
  start: number;
  onEnd: (index: number) => void;
}) {
  const [show, setShow] = useState<Show>({ index: start, blank: null });
  const [idle, setIdle] = useState(true);
  const latest = useRef({ show, onEnd, count: document.slides.length });
  useEffect(() => {
    latest.current = { show, onEnd, count: document.slides.length };
  }, [show, onEnd, document]);
  const root = useRef<HTMLDivElement>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    let ended = false;
    let digits = "";
    const end = () => {
      if (ended) return;
      ended = true;
      latest.current.onEnd(latest.current.show.index);
    };
    // Keys are the presentation's while it runs, never the editor's.
    const onKey = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === "Escape") {
        event.preventDefault();
        end();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const next = typed(digits, event.key, event.shiftKey);
      digits = next.digits;
      if (!next.action) return;
      event.preventDefault();
      const action = next.action;
      setShow((current) => act(current, latest.current.count, action));
    };
    let wasFull = Boolean(window.document.fullscreenElement);
    const onFull = () => {
      const full = Boolean(window.document.fullscreenElement);
      if (wasFull && !full) end();
      wasFull = full;
    };
    window.addEventListener("keydown", onKey, true);
    window.document.addEventListener("fullscreenchange", onFull);
    root.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.document.removeEventListener("fullscreenchange", onFull);
    };
  }, []);

  const step = (by: 1 | -1) =>
    setShow((current) =>
      act(current, latest.current.count, { kind: "step", by })
    );
  const wake = () => {
    setIdle(false);
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setIdle(true), IDLE_MS);
  };
  useEffect(() => () => clearTimeout(idleTimer.current), []);

  return (
    <div
      ref={root}
      tabIndex={-1}
      role="dialog"
      aria-label="播放簡報"
      className={cn(
        "fixed inset-0 z-50 bg-black outline-none",
        idle && "cursor-none"
      )}
      onMouseMove={wake}
      onClick={() => step(1)}
      onContextMenu={(event) => {
        event.preventDefault();
        step(-1);
      }}
    >
      <Projection
        document={document}
        index={Math.min(show.index, document.slides.length - 1)}
        blank={show.blank}
      />
    </div>
  );
}
