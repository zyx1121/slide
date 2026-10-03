// The editor's save queue, without React. Edits are applied locally first,
// then saved one at a time, each against the version the previous save left.
//
// The local document must never drift from the server's: a patch is only
// meaningful against the document it was made on. So when the server refuses
// a save, or the save fails, the queue stops taking edits, drops the ones
// waiting (they were made on a document the server does not have) and loads
// the deck again. If that load fails too, edits stay blocked until a load
// succeeds; nothing is sent from a document the server never saw.
import type { Operation } from "../deck/patch";
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
  /** Replaces the editor's document after a load. */
  onReload: (document: DeckDocument) => void;
  onChange: (state: SaverState) => void;
  /** How long to wait before loading again while blocked, in ms. */
  retryDelay?: number;
};

const MESSAGES = {
  conflict: "簡報在別處改過了，已載入最新版本。",
  refused: "這個修改沒有存到，已載入最新版本。",
  failed: "連線中斷，已載入伺服器上的版本。",
  blocked: "連不上伺服器，修改暫停。重新連上後會自動載入。",
} as const;

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

  async function reload(reason: keyof typeof MESSAGES) {
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
    options.onReload(loaded.document);
    phase = "ready";
    message = MESSAGES[reason === "blocked" ? "failed" : reason];
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
    /** Queues a patch already applied locally. False when edits are paused. */
    save(ops: Operation[]): boolean {
      if (phase !== "ready") return false;
      queue.push(ops);
      notify();
      void pump();
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
