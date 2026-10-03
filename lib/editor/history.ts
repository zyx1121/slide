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
