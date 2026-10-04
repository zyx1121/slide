// The editor's save queue, without React. Edits are applied locally first,
// then saved one at a time, each against the version the previous save left.
//
// The local document must never drift from the server's: a patch is only
// meaningful against the document it was made on. When a save meets a deck
// that moved on (the member's agent edits it at the same time), the deck is
// loaded again and the edits waiting are replayed on it: each patch carries
// id tests, so it lands on the same shapes or is refused. When they cannot be
// replayed, or the server refuses a save, or the save fails, the queue stops
// taking edits, drops the ones waiting (they were made on a document the
// server does not have) and loads the deck again. If that load fails too,
// edits stay blocked until a load succeeds; nothing is sent from a document
// the server never saw.
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

/** Patches applied in turn to a document; null when one of them no longer fits. */
function replay(
  document: DeckDocument,
  patches: Operation[][]
): DeckDocument | null {
  let current = document;
  try {
    for (const patch of patches) {
      current = applyOperations(current, patch).document;
    }
  } catch {
    return null;
  }
  return current;
}

export function createSaver(options: SaverOptions) {
  let version = options.version;
  let phase: SaverState["phase"] = "ready";
  let message: string | null = null;
  let queue: Operation[][] = [];
  let sending = false;
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
    if (sending || phase !== "ready" || queue.length === 0) return;
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
    // A deck that moved on: replay this edit and the queued ones on it.
    if (result?.ok === false && result.code === "conflict" && !disposed) {
      phase = "reloading";
      notify();
      const waiting = [ops, ...queue];
      const loaded = await options.load().catch(() => null);
      const replayed = loaded && replay(loaded.document, waiting);
      if (loaded && replayed && !disposed) {
        version = loaded.version;
        queue = waiting;
        options.onReload(replayed);
        phase = "ready";
        message = null;
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
     * Loads the deck again after a change made elsewhere (a revert, the
     * member's agent), without a message. Only when nothing is waiting to
     * be saved.
     */
    async refresh(): Promise<boolean> {
      if (phase !== "ready" || queue.length > 0 || sending) return false;
      phase = "reloading";
      notify();
      await reload("quiet");
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
