import { describe, expect, it, vi } from "vitest";

import type { Operation } from "../deck/patch";
import { sampleDocument } from "../deck/sample";
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
  const onChange = vi.fn();
  const saver = createSaver({
    version: 0,
    send,
    load,
    onReload,
    onChange,
    retryDelay: 10,
  });
  return { saver, onReload, onChange };
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

  it("blocks edits while a refused save reloads, and drops what was queued", async () => {
    // Another tab moved the deck on, changing what these edits were made on;
    // the reload is still on its way when the member presses Delete.
    const load = deferred<Loaded | null>();
    const send = vi
      .fn<(version: number, ops: Operation[]) => Promise<SendResult>>()
      .mockResolvedValueOnce({ ok: false, code: "conflict", currentVersion: 1 })
      .mockImplementation(async (version) => ({
        ok: true,
        version: version + 1,
      }));
    const { saver, onReload } = setup(send, () => load.promise);
    saver.save(onTitle("Mine", "moved tx_note"));
    saver.save(onTitle("moved tx_note", "queued behind it"));
    await tick();
    expect(saver.state()).toMatchObject({
      accepting: false,
      phase: "reloading",
    });
    expect(saver.save(ops("delete during reload"))).toBe(false);

    load.resolve({ document: sampleDocument(), version: 1 });
    await tick();
    expect(onReload).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledTimes(1);
    expect(saver.state()).toMatchObject({
      accepting: true,
      message: "簡報在別處改過了，已載入最新版本。",
    });

    expect(saver.save(ops("after reload"))).toBe(true);
    await tick();
    expect(send).toHaveBeenLastCalledWith(1, ops("after reload"));
  });

  it("replays edits on a deck that moved on, when they still fit", async () => {
    // The member's agent changed the deck between two of the member's saves.
    const send = vi
      .fn<(version: number, ops: Operation[]) => Promise<SendResult>>()
      .mockResolvedValueOnce({ ok: false, code: "conflict", currentVersion: 5 })
      .mockImplementation(async (version) => ({
        ok: true,
        version: version + 1,
      }));
    const loaded = { ...sampleDocument(), title: "Renamed by the agent" };
    const { saver, onReload } = setup(send, async () => ({
      document: loaded,
      version: 5,
    }));
    saver.save([{ op: "replace", path: "/slides/0/title", value: "Mine" }]);
    saver.save(ops("Queued"));
    await tick();
    await tick();
    await tick();
    // The editor shows the agent's change with the member's on top.
    expect(onReload).toHaveBeenCalledOnce();
    const shown = onReload.mock.calls[0][0];
    expect(shown.slides[0].title).toBe("Mine");
    expect(shown.title).toBe("Queued");
    // Both edits went to the server again, on the agent's version.
    expect(send.mock.calls.slice(1).map(([version]) => version)).toEqual([
      5, 6,
    ]);
    expect(saver.state()).toMatchObject({
      accepting: true,
      pending: 0,
      message: null,
    });
    expect(saver.version()).toBe(7);
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

  it("keeps sending queued saves after the editor closes, but never reloads", async () => {
    const first = deferred<SendResult>();
    const send = vi
      .fn<(version: number, ops: Operation[]) => Promise<SendResult>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ ok: false, code: "conflict" });
    const load = vi.fn(async () => null);
    const { saver } = setup(send, load);
    saver.save(ops("A"));
    saver.save(ops("B"));
    saver.dispose();
    first.resolve({ ok: true, version: 1 });
    await tick();
    await tick();
    expect(send).toHaveBeenCalledTimes(2);
    expect(load).not.toHaveBeenCalled();
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
