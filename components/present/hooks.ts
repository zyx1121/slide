"use client";
// What the presentation windows share: a pointer that hides once it rests,
// and the keys that move a show (lib/present/control.ts).
import { useCallback, useEffect, useRef, useState } from "react";

import { type Action, typed } from "@/lib/present/control";

const IDLE_MS = 2000;

/** Whether the pointer has rested a while, and what wakes it. */
export function useIdleCursor(initial = false) {
  const [idle, setIdle] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const wake = useCallback(() => {
    setIdle(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setIdle(true), IDLE_MS);
  }, []);
  return { idle, wake };
}

/**
 * Turns the window's keys into actions: a clicker's, the arrows and the
 * rest, and a slide number typed before Enter. `first` sees every key before
 * that and returns true for one it took (Escape, F). With `capture`, keys
 * stop here, before the page below sees them; with `buttons`, Space and
 * Enter on a focused button press the button instead.
 */
export function usePresentKeys(
  onAction: (action: Action) => void,
  options: {
    first?: (event: KeyboardEvent) => boolean;
    capture?: boolean;
    buttons?: boolean;
  } = {}
) {
  const latest = useRef({ onAction, first: options.first });
  useEffect(() => {
    latest.current = { onAction, first: options.first };
  });
  const { capture = false, buttons = false } = options;
  useEffect(() => {
    let digits = "";
    const onKey = (event: KeyboardEvent) => {
      if (capture) event.stopPropagation();
      if (latest.current.first?.(event)) {
        event.preventDefault();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        buttons &&
        target?.closest("button, a") &&
        (event.key === " " || event.key === "Enter")
      ) {
        return;
      }
      const next = typed(digits, event.key, event.shiftKey);
      digits = next.digits;
      if (!next.action) return;
      event.preventDefault();
      latest.current.onAction(next.action);
    };
    window.addEventListener("keydown", onKey, capture);
    return () => window.removeEventListener("keydown", onKey, capture);
  }, [capture, buttons]);
}
