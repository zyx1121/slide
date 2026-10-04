"use client";
// Presenting on this screen: the slides full screen, from the slide in view,
// over the editor. Keys move as in the presenter view, a click steps on and
// a right click back; Escape, or leaving full screen another way, ends it on
// the slide shown, which the editor then shows.
import { useEffect, useRef, useState } from "react";

import { useIdleCursor, usePresentKeys } from "@/components/present/hooks";
import { Projection } from "@/components/present/projection";
import type { DeckDocument } from "@/lib/deck/schema";
import { act, type Action, type Show } from "@/lib/present/control";
import { cn } from "@/lib/utils";

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
  const { idle, wake } = useIdleCursor(true);
  const latest = useRef({ show, onEnd, count: document.slides.length });
  useEffect(() => {
    latest.current = { show, onEnd, count: document.slides.length };
  }, [show, onEnd, document]);
  const root = useRef<HTMLDivElement>(null);
  const ended = useRef(false);
  const end = () => {
    if (ended.current) return;
    ended.current = true;
    latest.current.onEnd(latest.current.show.index);
  };
  const move = (action: Action) =>
    setShow((current) => act(current, latest.current.count, action));

  // Keys are the presentation's while it runs, never the editor's.
  usePresentKeys(move, {
    capture: true,
    first: (event) => {
      if (event.key !== "Escape") return false;
      end();
      return true;
    },
  });
  // Leaving full screen another way (the browser's own Escape) ends it too.
  useEffect(() => {
    let wasFull = Boolean(window.document.fullscreenElement);
    const onFull = () => {
      const full = Boolean(window.document.fullscreenElement);
      if (wasFull && !full) end();
      wasFull = full;
    };
    window.document.addEventListener("fullscreenchange", onFull);
    root.current?.focus();
    return () =>
      window.document.removeEventListener("fullscreenchange", onFull);
    // Once, for as long as it runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const step = (by: 1 | -1) => move({ kind: "step", by });

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
