import { describe, expect, it, vi } from "vitest";

import { applyOperations, type Operation } from "../deck/patch";
import { sampleDocument } from "../deck/sample";
import type { DeckDocument } from "../deck/schema";
import { guard } from "./guard";
import { createSaver, type Loaded, type SendResult } from "./saver";

const ops = (title: string): Operation[] => [
  { op: "replace", path: "/title", value: title },
];
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
/** A patch made on a deck titled `was`: it no longer fits once the title moved. */
const onTitle = (was: string, title: string): Operation[] => [
  { op: "test", path: "/title", value: was },
  { op: "replace", path: "/title", value: title },
];

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(
  send: (version: number, ops: Operation[]) => Promise<SendResult>,
  load: () => Promise<Loaded | null>
) {
  const onReload = vi.fn();
  const onRebase = vi.fn();
  const onChange = vi.fn();
  const saver = createSaver({
    version: 0,
    send,
    load,
    onReload,
    onRebase,
    onChange,
    retryDelay: 10,
  });
  return { saver, onReload, onRebase, onChange };
}

describe("createSaver", () => {
  it("saves in order, each against the version the last one left", async () => {
    const send = vi.fn(async (version: number, patch: Operation[]) => ({
      ok: true as const,
      version: version + patch.length,
    }));
    const { saver } = setup(send, async () => null);
    saver.save(ops("A"));
    saver.save(ops("B"));
    saver.save(ops("C"));
    await tick();
    await tick();
    await tick();
    expect(
      send.mock.calls.map(([version, patch]) => [version, patch[0]])
    ).toEqual([
      [0, ops("A")[0]],
      [1, ops("B")[0]],
      [2, ops("C")[0]],
    ]);
    expect(saver.state()).toMatchObject({
      pending: 0,
      phase: "ready",
      message: null,
    });
  });

  it("drops what no longer fits a deck that moved on, and says so", async () => {
    // Another tab changed what these edits were made on; the deck is still
    // loading when the member presses Delete.
    const load = deferred<Loaded | null>();
    const send = vi
      .fn<(version: number, ops: Operation[]) => Promise<SendResult>>()
      .mockResolvedValueOnce({ ok: false, code: "conflict" })
      .mockImplementation(async (version) => ({
        ok: true,
        version: version + 1,
      }));
    const { saver, onReload, onRebase } = setup(send, () => load.promise);
    saver.save(onTitle("Mine", "moved tx_note"));
    saver.save(onTitle("moved tx_note", "queued behind it"));
    await tick();
    expect(saver.save(ops("delete while loading"))).toBe(true);

    load.resolve({ document: sampleDocument(), version: 1 });
    await tick();
    await tick();
    expect(onRebase).not.toHaveBeenCalled();
    expect(onReload).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledTimes(1);
    expect(saver.state()).toMatchObject({
      accepting: true,
      pending: 0,
      message: "簡報在別處改過了，已載入最新版本。",
    });

    expect(saver.save(ops("after reload"))).toBe(true);
    await tick();
    expect(send).toHaveBeenLastCalledWith(1, ops("after reload"));
  });

  it("stops taking edits while a refused save reloads", async () => {
    const load = deferred<Loaded | null>();
    const send = vi
      .fn<(version: number, ops: Operation[]) => Promise<SendResult>>()
      .mockResolvedValueOnce({ ok: false, code: "invalid_document" });
    const { saver, onReload } = setup(send, () => load.promise);
    saver.save(ops("broken"));
    await tick();
    expect(saver.state()).toMatchObject({
      accepting: false,
      phase: "reloading",
    });
    expect(saver.save(ops("during reload"))).toBe(false);
    load.resolve({ document: sampleDocument(), version: 0 });
    await tick();
    expect(onReload).toHaveBeenCalledOnce();
    expect(saver.state().message).toBe("這個修改沒有存到，已載入最新版本。");
  });

  it("re-points waiting edits at the slide they were made on, wherever it went", async () => {
    // The member typed a title; their agent inserted a slide before it.
    const doc = sampleDocument();
    const typed = guard(doc, [
      { op: "replace", path: "/slides/0/title", value: "Typed" },
    ]);
    const there = applyOperations(doc, [
      {
        op: "add",
        path: "/slides/0",
        value: { id: "sl_agent", title: "Agent", shapes: [] },
      },
    ]).document;
    const send = vi
      .fn<(version: number, ops: Operation[]) => Promise<SendResult>>()
      .mockResolvedValueOnce({ ok: false, code: "conflict" })
      .mockResolvedValueOnce({ ok: true, version: 2 });
    const { saver, onReload, onRebase } = setup(send, async () => ({
      document: there,
      version: 1,
    }));
    saver.save(typed);
    await tick();
    await tick();
    await tick();
    expect(onReload).not.toHaveBeenCalled();
    const rebased = onRebase.mock.calls[0][0] as DeckDocument;
    expect(rebased.slides.map((slide) => slide.title)).toEqual([
      "Agent",
      "Typed",
    ]);
    expect(send).toHaveBeenLastCalledWith(1, [
      { op: "test", path: "/slides/1/id", value: "sl_overview" },
      { op: "replace", path: "/slides/1/title", value: "Typed" },
    ]);
    expect(saver.state()).toMatchObject({ pending: 0, message: null });
  });

  it("replays edits on a deck that moved on, without stopping the member", async () => {
    // The member's agent changed the deck between two of the member's saves.
    const load = deferred<Loaded | null>();
    const send = vi
      .fn<(version: number, ops: Operation[]) => Promise<SendResult>>()
      .mockResolvedValueOnce({ ok: false, code: "conflict" })
      .mockImplementation(async (version) => ({
        ok: true,
        version: version + 1,
      }));
    const { saver, onReload, onRebase } = setup(send, () => load.promise);
    saver.save([{ op: "replace", path: "/slides/0/title", value: "Mine" }]);
    saver.save(ops("Queued"));
    await tick();
    // While the deck loads, the member keeps editing.
    expect(saver.state().accepting).toBe(true);
    expect(saver.save(ops("Typed meanwhile"))).toBe(true);
    load.resolve({
      document: { ...sampleDocument(), title: "Renamed by the agent" },
      version: 5,
    });
    await tick();
    await tick();
    await tick();
    await tick();
    // The editor takes the agent's change with the member's on top, and is
    // not reloaded: what the member is doing stays.
    expect(onReload).not.toHaveBeenCalled();
    expect(onRebase).toHaveBeenCalledOnce();
    const shown = onRebase.mock.calls[0][0];
    expect(shown.slides[0].title).toBe("Mine");
    expect(shown.title).toBe("Typed meanwhile");
    // All three went to the server again, on the agent's version.
    expect(send.mock.calls.slice(1).map(([version]) => version)).toEqual([
      5, 6, 7,
    ]);
    expect(saver.state()).toMatchObject({
      accepting: true,
      pending: 0,
      message: null,
    });
    expect(saver.version()).toBe(8);
  });

  it("skips an edit the other change already made, and replays the rest", async () => {
    const send = vi
      .fn<(version: number, ops: Operation[]) => Promise<SendResult>>()
      .mockResolvedValueOnce({ ok: false, code: "conflict" })
      .mockImplementation(async (version) => ({
        ok: true,
        version: version + 1,
      }));
    const { saver, onRebase } = setup(send, async () => ({
      document: { ...sampleDocument(), title: "Same" },
      version: 2,
    }));
    saver.save(ops("Same"));
    saver.save(ops("After"));
    for (let i = 0; i < 5; i++) await tick();
    expect(onRebase.mock.calls[0][0].title).toBe("After");
    expect(send.mock.calls.slice(1)).toEqual([[2, ops("After")]]);
  });

  it("replays and saves after the editor closed, without touching it", async () => {
    const load = deferred<Loaded | null>();
    const send = vi
      .fn<(version: number, ops: Operation[]) => Promise<SendResult>>()
      .mockResolvedValueOnce({ ok: false, code: "conflict" })
      .mockImplementation(async (version) => ({
        ok: true,
        version: version + 1,
      }));
    const { saver, onRebase, onReload } = setup(send, () => load.promise);
    saver.save(ops("Typed before leaving"));
    await tick();
    saver.dispose();
    load.resolve({ document: sampleDocument(), version: 3 });
    for (let i = 0; i < 5; i++) await tick();
    expect(send).toHaveBeenLastCalledWith(3, ops("Typed before leaving"));
    expect(onRebase).not.toHaveBeenCalled();
    expect(onReload).not.toHaveBeenCalled();
  });

  it("takes a change from elsewhere only while the member stays idle", async () => {
    const load = deferred<Loaded | null>();
    const { saver, onRebase } = setup(
      async (version) => ({ ok: true, version: version + 1 }),
      () => load.promise
    );
    let idle = true;
    const refreshed = saver.refresh(() => idle);
    // Not paused while it loads.
    expect(saver.state().accepting).toBe(true);
    idle = false; // the member started typing meanwhile
    load.resolve({ document: sampleDocument(), version: 4 });
    expect(await refreshed).toBe(false);
    expect(onRebase).not.toHaveBeenCalled();
    expect(saver.version()).toBe(0);

    idle = true;
    const again = saver.refresh(() => idle);
    expect(await again).toBe(true);
    expect(onRebase).toHaveBeenCalledOnce();
    expect(saver.version()).toBe(4);
  });

  it("stays blocked when the save and the reload both fail, until a load works", async () => {
    // The server is restarting: the delete is not saved and the deck cannot
    // be loaded. Nothing may be sent from the local document after that.
    let up = false;
    const send = vi.fn(async (version: number): Promise<SendResult> => {
      if (!up) throw new Error("network");
      return { ok: true, version: version + 1 };
    });
    const load = vi.fn(async () =>
      up ? { document: sampleDocument(), version: 0 } : null
    );
    const { saver, onReload } = setup(send, load);
    saver.save(ops("delete sh_asr"));
    await tick();
    await tick();
    expect(saver.state()).toMatchObject({ accepting: false, phase: "blocked" });
    expect(saver.save(ops("nudge sh_router"))).toBe(false);

    up = true;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(onReload).toHaveBeenCalledOnce();
    expect(saver.state()).toMatchObject({
      accepting: true,
      message: "連線中斷，已載入伺服器上的版本。",
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("keeps sending queued saves after the editor closes, and never touches it", async () => {
    const first = deferred<SendResult>();
    const send = vi
      .fn<(version: number, ops: Operation[]) => Promise<SendResult>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ ok: false, code: "conflict" });
    const load = vi.fn(async () => null);
    const { saver, onReload, onRebase } = setup(send, load);
    saver.save(ops("A"));
    saver.save(ops("B"));
    saver.dispose();
    first.resolve({ ok: true, version: 1 });
    await tick();
    await tick();
    expect(send).toHaveBeenCalledTimes(2);
    // The conflict loads the deck to replay on it; this load fails, so the
    // edit is dropped, and the closed editor is left alone.
    expect(load).toHaveBeenCalledOnce();
    expect(onReload).not.toHaveBeenCalled();
    expect(onRebase).not.toHaveBeenCalled();
  });

  it("says nothing was lost when only the answer to a save was", async () => {
    const loaded = { document: sampleDocument(), version: 1 };
    const { saver, onReload } = setup(
      async () => {
        throw new Error("network");
      },
      async () => loaded
    );
    onReload.mockReturnValue(false);
    saver.save(ops("A"));
    await tick();
    await tick();
    expect(saver.state().message).toBe("連線中斷過，修改都已儲存。");
    onReload.mockReturnValue(true);
    saver.save(ops("B"));
    await tick();
    await tick();
    expect(saver.state().message).toBe("連線中斷，已載入伺服器上的版本。");
  });
});
