import { beforeEach, describe, expect, it, vi } from "vitest";

import { DeckError } from "@/lib/deck/errors";
import { sampleDocument } from "@/lib/deck/sample";

vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/db", () => ({ sql: {} }));
vi.mock("@/lib/deck/store", () => ({ getDeck: vi.fn(), mutateDeck: vi.fn() }));

const { requireUser } = await import("@/lib/auth/session");
const { getDeck, mutateDeck } = await import("@/lib/deck/store");
const { editDeckAction, loadDeckAction, setMasterAction } =
  await import("./actions");

const ops = [{ op: "replace", path: "/title", value: "New" }];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireUser).mockResolvedValue({
    sub: "alice-sub",
    name: "Alice",
    email: "",
  });
});

describe("editDeckAction", () => {
  it("writes as the member, never as an agent or someone else", async () => {
    vi.mocked(mutateDeck).mockResolvedValue({
      status: "applied",
      version: 4,
      revisionId: "9",
    });
    expect(await editDeckAction("dk_1", 3, ops)).toEqual({
      ok: true,
      version: 4,
    });
    expect(mutateDeck).toHaveBeenCalledWith(
      {},
      {
        deckId: "dk_1",
        actor: { kind: "member", sub: "alice-sub" },
        baseVersion: 3,
        ops,
      }
    );
  });

  it("reports a refused patch with its reason", async () => {
    vi.mocked(mutateDeck).mockRejectedValue(
      new DeckError("conflict", "moved on")
    );
    expect(await editDeckAction("dk_1", 3, ops)).toEqual({
      ok: false,
      code: "conflict",
    });
  });

  it("refuses arguments of the wrong shape without writing", async () => {
    for (const [id, version] of [
      [42, 3],
      ["dk_1", "3"],
      ["dk_1", 1.5],
      ["dk_1", Number.NaN],
    ] as const) {
      expect(await editDeckAction(id, version, ops)).toEqual({
        ok: false,
        code: "malformed",
      });
    }
    expect(mutateDeck).not.toHaveBeenCalled();
  });

  it("does nothing without a session", async () => {
    vi.mocked(requireUser).mockRejectedValue(new Error("redirect /auth/login"));
    await expect(editDeckAction("dk_1", 3, ops)).rejects.toThrow();
    await expect(loadDeckAction("dk_1")).rejects.toThrow();
    expect(mutateDeck).not.toHaveBeenCalled();
    expect(getDeck).not.toHaveBeenCalled();
  });
});

describe("loadDeckAction", () => {
  it("returns only the member's own deck", async () => {
    vi.mocked(getDeck).mockImplementation(async (_db, owner, id) =>
      owner === "alice-sub" && id === "dk_1"
        ? ({ document: sampleDocument(), version: 7 } as never)
        : null
    );
    expect(await loadDeckAction("dk_1")).toEqual({
      document: sampleDocument(),
      version: 7,
    });
    expect(await loadDeckAction("dk_bob")).toBeNull();
    expect(await loadDeckAction(["dk_1"])).toBeNull();
  });
});

describe("setMasterAction", () => {
  it("plans the move on the deck as it is, as the member", async () => {
    let planned: unknown = null;
    vi.mocked(mutateDeck).mockImplementation(async (_db, input) => {
      if ("plan" in input) planned = input.plan(sampleDocument());
      return { status: "applied", version: 5, revisionId: "10" };
    });
    expect(await setMasterAction("dk_1", "plain")).toEqual({
      ok: true,
      version: 5,
    });
    expect(vi.mocked(mutateDeck).mock.calls[0][1]).toMatchObject({
      deckId: "dk_1",
      actor: { kind: "member", sub: "alice-sub" },
    });
    expect(planned).toContainEqual(
      expect.objectContaining({ op: "replace", path: "/master" })
    );
  });

  it("refuses a master the member may not use, without writing", async () => {
    for (const ref of ["keynote", "f".repeat(64).slice(0, 10), 42]) {
      expect(await setMasterAction("dk_1", ref)).toEqual({
        ok: false,
        code: "malformed",
      });
    }
    expect(mutateDeck).not.toHaveBeenCalled();
  });
});
