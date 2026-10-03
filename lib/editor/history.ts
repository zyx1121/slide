// Undo and redo for the editor. Each edit is kept with its inverse patch;
// undoing applies the inverse as a new edit, so the server records it as a
// revision like any other change, and redoing applies the edit again.
import type { Operation } from "../deck/patch";

export type Step = {
  ops: Operation[];
  inverse: Operation[];
  /** The slide the edit was made on, shown again when it is undone. */
  slide: number;
};
export type History = { past: Step[]; future: Step[] };

export const EMPTY_HISTORY: History = { past: [], future: [] };

/** How many edits undo reaches back. */
export const HISTORY_LIMIT = 100;

/** Records a new edit; it ends whatever could have been redone. */
export function record(history: History, step: Step): History {
  return { past: [...history.past, step].slice(-HISTORY_LIMIT), future: [] };
}

/** The patch that undoes the last edit, and the history after it. */
export function undo(
  history: History
): { ops: Operation[]; slide: number; history: History } | null {
  const step = history.past.at(-1);
  if (!step) return null;
  return {
    ops: step.inverse,
    slide: step.slide,
    history: {
      past: history.past.slice(0, -1),
      future: [...history.future, step],
    },
  };
}

/**
 * The history after the server's document replaced the local one. When it is
 * the same document nothing was lost and the history stands. When it is the
 * document an unsaved undo or redo started from, only that move (and what
 * came after it) was lost: the history it started from applies again, so
 * the member can try it once more. Otherwise the steps no longer apply.
 */
export function historyAfterReload(
  current: History,
  sameDocument: boolean,
  lostMove: { history: History; fromDocument: boolean } | null
): History {
  if (sameDocument) return current;
  if (lostMove?.fromDocument) return lostMove.history;
  return EMPTY_HISTORY;
}

/** The patch that redoes the last undone edit, and the history after it. */
export function redo(
  history: History
): { ops: Operation[]; slide: number; history: History } | null {
  const step = history.future.at(-1);
  if (!step) return null;
  return {
    ops: step.ops,
    slide: step.slide,
    history: {
      past: [...history.past, step],
      future: history.future.slice(0, -1),
    },
  };
}
