// The editor's save queue, without React. Edits are applied locally first,
// then saved one at a time, each against the version the previous save left.
//
// The local document must never drift from the server's: a patch is only
// meaningful against the document it was made on. When a save meets a deck
// that moved on (the member's agent edits it at the same time), the deck is
// loaded again and the edits waiting, with any made meanwhile, are replayed
// on it: each patch carries id tests, so it lands on the same shapes or is
// refused, and one that has nothing left to do is skipped. The editor takes
// the result without stopping what the member is doing (onRebase), and the
// saves go on, even after the editor closed. When the edits cannot be
// replayed, or the server refuses a save, or the save fails, the queue stops
// taking edits, drops the ones waiting (they were made on a document the
// server does not have) and loads the deck again (onReload). If that load
// fails too, edits stay blocked until a load succeeds; nothing is sent from a
// document the server never saw.
import { DeckError } from "../deck/errors";
import { applyOperations, type Operation } from "../deck/patch";
import type { DeckDocument } from "../deck/schema";

export type SendResult =
  | { ok: true; version: number }
  | { ok: false; code: string; currentVersion?: number };

export type Loaded = { document: DeckDocument; version: number };

export type SaverState = {
  /** Whether a new edit may be applied locally and queued. */
  accepting: boolean;
  /** Edits applied locally and not yet saved. */
  pending: number;
  phase: "ready" | "reloading" | "blocked";
  /** What the member should know; null when all is well. */
  message: string | null;
};

export type SaverOptions = {
  version: number;
  send: (version: number, ops: Operation[]) => Promise<SendResult>;
  load: () => Promise<Loaded | null>;
  /**
   * Replaces the editor's document after a load; returns whether it differed
   * from the local one, so a lost answer that lost no edit says so.
   */
  onReload: (document: DeckDocument) => boolean | void;
  /**
   * Brings in the server's document with the local edits still waiting
   * already on it (or, from refresh, a document changed elsewhere while
   * nothing was waiting): the editor keeps what the member is doing.
   */
  onRebase: (document: DeckDocument) => void;
  onChange: (state: SaverState) => void;
  /** How long to wait before loading again while blocked, in ms. */
  retryDelay?: number;
};

const MESSAGES = {
  conflict: "簡報在別處改過了，已載入最新版本。",
  refused: "這個修改沒有存到，已載入最新版本。",
  failed: "連線中斷，已載入伺服器上的版本。",
  kept: "連線中斷過，修改都已儲存。",
  blocked: "連不上伺服器，修改暫停。重新連上後會自動載入。",
} as const;

/**
 * Patches applied in turn to a document, without those that have nothing
 * left to do there; null when one of them no longer fits.
 */
function replay(
  document: DeckDocument,
  patches: Operation[][]
): { document: DeckDocument; patches: Operation[][] } | null {
  let current = document;
  const kept: Operation[][] = [];
  for (const patch of patches) {
    try {
      current = applyOperations(current, patch).document;
      kept.push(patch);
    } catch (error) {
      if (
        error instanceof DeckError &&
        error.message === "the patch changes nothing"
      ) {
        continue;
      }
      return null;
    }
  }
  return { document: current, patches: kept };
}

export function createSaver(options: SaverOptions) {
  let version = options.version;
  let phase: SaverState["phase"] = "ready";
  let message: string | null = null;
  let queue: Operation[][] = [];
  let sending = false;
  /** Loading the deck to replay the waiting edits on; saves wait meanwhile. */
  let rebasing = false;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const state = (): SaverState => ({
    accepting: phase === "ready",
    pending: queue.length + (sending ? 1 : 0),
    phase,
    message,
  });
  const notify = () => {
    if (!disposed) options.onChange(state());
  };

  async function reload(reason: keyof typeof MESSAGES | "quiet") {
    clearTimeout(retryTimer);
    const loaded = await options.load().catch(() => null);
    if (disposed) return;
    if (!loaded) {
      phase = "blocked";
      message = MESSAGES.blocked;
      notify();
      retryTimer = setTimeout(
        () => void reload(reason),
        options.retryDelay ?? 5000
      );
      return;
    }
    version = loaded.version;
    const changed = options.onReload(loaded.document) !== false;
    phase = "ready";
    const said = reason === "blocked" ? "failed" : reason;
    message =
      said === "quiet"
        ? null
        : MESSAGES[said === "failed" && !changed ? "kept" : said];
    notify();
  }

  async function pump() {
    if (sending || rebasing || phase !== "ready" || queue.length === 0) return;
    sending = true;
    const ops = queue.shift()!;
    notify();
    const result = await options.send(version, ops).catch(() => null);
    sending = false;
    if (result?.ok) {
      version = result.version;
      if (queue.length === 0) message = null;
      notify();
      // Saves go on after the editor closes, so leaving keeps its edits.
      void pump();
      return;
    }
    // A deck that moved on: replay this edit and the ones queued behind
    // it, and any the member makes meanwhile, on it. This goes on after the
    // editor closed too, so leaving right after an agent's edit keeps the
    // member's.
    if (result?.ok === false && result.code === "conflict") {
      queue.unshift(ops);
      rebasing = true;
      notify();
      const loaded = await options.load().catch(() => null);
      rebasing = false;
      const replayed = loaded && replay(loaded.document, queue);
      if (loaded && replayed) {
        version = loaded.version;
        queue = replayed.patches;
        if (!disposed) options.onRebase(replayed.document);
        message = null;
        notify();
        void pump();
        return;
      }
      if (loaded) {
        // They no longer fit: drop them and show the deck as it is now,
        // from the load already made.
        queue = [];
        if (disposed) return;
        version = loaded.version;
        options.onReload(loaded.document);
        message = MESSAGES.conflict;
        notify();
        void pump();
        return;
      }
    }
    // Everything still queued was made on top of the refused edit.
    queue = [];
    if (disposed) return;
    phase = "reloading";
    notify();
    await reload(
      result === null
        ? "failed"
        : result.code === "conflict"
          ? "conflict"
          : "refused"
    );
    void pump();
  }

  return {
    state,
    /** The server version the next save is written against. */
    version: () => version,
    /** Queues a patch already applied locally. False when edits are paused. */
    save(ops: Operation[]): boolean {
      if (phase !== "ready") return false;
      queue.push(ops);
      notify();
      void pump();
      return true;
    },
    /**
     * Takes a change made elsewhere (a revert, the member's agent), without
     * a message and without stopping anything: only when nothing is waiting
     * to be saved and `idle` says the member is not in the middle of an
     * edit, both before and after the load.
     */
    async refresh(idle: () => boolean = () => true): Promise<boolean> {
      const quiet = () =>
        phase === "ready" &&
        !sending &&
        !rebasing &&
        queue.length === 0 &&
        idle();
      if (!quiet()) return false;
      const loaded = await options.load().catch(() => null);
      // Edits are not paused meanwhile: one made since was made on the
      // document shown, and its save will meet the newer version and be
      // replayed on it. So the load is only taken if nothing happened.
      if (disposed || !loaded || !quiet() || loaded.version <= version) {
        return false;
      }
      version = loaded.version;
      options.onRebase(loaded.document);
      message = null;
      notify();
      return true;
    },
    /** Loads the deck again now, from the blocked state. */
    retry() {
      if (phase === "blocked") void reload("blocked");
    },
    /** Starts (again) reporting to the editor, as it mounts. */
    attach() {
      disposed = false;
    },
    /** Stops reloading and reporting; queued saves are still sent. */
    dispose() {
      disposed = true;
      clearTimeout(retryTimer);
    },
  };
}

export type Saver = ReturnType<typeof createSaver>;
