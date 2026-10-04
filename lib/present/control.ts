// How a presentation moves, shared by its windows: the keys a presenter (or
// a presentation clicker) presses, what they do to the slide shown, and the
// messages the presenter view and the projection window exchange.
import type { DeckDocument } from "../deck/schema";

/** A screen left black or white instead of the slide. */
export type Blank = "black" | "white" | null;

/** What is shown: the slide by position, or a blank screen over it. */
export type Show = { index: number; blank: Blank };

export type Action =
  | { kind: "step"; by: 1 | -1 }
  | { kind: "first" }
  | { kind: "last" }
  | { kind: "goto"; index: number }
  | { kind: "blank"; blank: "black" | "white" };

/**
 * The action of a key: arrows, space, PageUp and PageDown (what clickers
 * send), Home and End, B or period for black, W or comma for white. Enter
 * steps on, unless a slide number was typed first (see `typed`).
 */
export function actionOf(key: string, shift = false): Action | null {
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
    case "PageDown":
    case "Enter":
    case "n":
    case "N":
      return { kind: "step", by: 1 };
    case " ":
      return { kind: "step", by: shift ? -1 : 1 };
    case "ArrowLeft":
    case "ArrowUp":
    case "PageUp":
    case "Backspace":
    case "p":
    case "P":
      return { kind: "step", by: -1 };
    case "Home":
      return { kind: "first" };
    case "End":
      return { kind: "last" };
    case "b":
    case "B":
    case ".":
      return { kind: "blank", blank: "black" };
    case "w":
    case "W":
    case ",":
      return { kind: "blank", blank: "white" };
    default:
      return null;
  }
}

/**
 * Digits typed before Enter name a slide to go to, as in PowerPoint: the
 * digits so far after `key`, and the action Enter takes with them.
 */
export function typed(
  digits: string,
  key: string,
  shift = false
): { digits: string; action: Action | null } {
  if (/^[0-9]$/.test(key)) {
    return { digits: (digits + key).slice(-3), action: null };
  }
  if (key === "Enter" && digits) {
    return {
      digits: "",
      action: { kind: "goto", index: Number(digits) - 1 },
    };
  }
  return { digits: "", action: actionOf(key, shift) };
}

/**
 * The show after an action, for a deck of `count` slides. Moving while the
 * screen is blank brings the slide back first; the same blank again lifts
 * it.
 */
export function act(show: Show, count: number, action: Action): Show {
  const last = Math.max(0, count - 1);
  const at = (index: number) => Math.min(Math.max(index, 0), last);
  switch (action.kind) {
    case "blank":
      return {
        index: show.index,
        blank: show.blank === action.blank ? null : action.blank,
      };
    case "step":
      if (show.blank) return { index: show.index, blank: null };
      return { index: at(show.index + action.by), blank: null };
    case "first":
      return { index: 0, blank: null };
    case "last":
      return { index: last, blank: null };
    case "goto":
      return { index: at(action.index), blank: null };
  }
}

/** The channel a deck's presenter view and projection windows share. */
export const channelName = (deckId: string) => `slide-present:${deckId}`;

export type Message =
  /** A projection window asks for the deck and what to show. */
  | { type: "hello" }
  /** The presenter view says what to show. */
  | { type: "show"; show: Show }
  /** The presenter view hands on a deck changed elsewhere. */
  | { type: "deck"; document: DeckDocument }
  /** A key pressed in a projection window, for the presenter view to act on. */
  | { type: "act"; action: Action }
  /** The presentation ended. */
  | { type: "end" };
