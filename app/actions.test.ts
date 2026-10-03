import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/db", () => ({ sql: {} }));
vi.mock("@/lib/deck/store", () => ({
  createDeck: vi.fn(),
  renameDeck: vi.fn(),
  deleteDeck: vi.fn(),
}));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect ${url}`);
  }),
}));

const { requireUser } = await import("@/lib/auth/session");
const { createDeck, deleteDeck, renameDeck } = await import("@/lib/deck/store");
const { refresh } = await import("next/cache");
const { createDeckAction, deleteDeckAction, renameDeckAction } =
  await import("./actions");

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireUser).mockResolvedValue({
    sub: "alice-sub",
    name: "Alice",
    email: "",
  });
});

describe("deck actions", () => {
  it("do nothing without a session", async () => {
    vi.mocked(requireUser).mockRejectedValue(new Error("redirect /auth/login"));
    await expect(createDeckAction()).rejects.toThrow("redirect /auth/login");
    await expect(
      renameDeckAction(form({ id: "dk_1", title: "Report" }))
    ).rejects.toThrow("redirect /auth/login");
    await expect(deleteDeckAction(form({ id: "dk_1" }))).rejects.toThrow(
      "redirect /auth/login"
    );
    expect(createDeck).not.toHaveBeenCalled();
    expect(renameDeck).not.toHaveBeenCalled();
    expect(deleteDeck).not.toHaveBeenCalled();
  });

  it("create a deck for the member and open it", async () => {
    vi.mocked(createDeck).mockResolvedValue({ id: "dk_new" } as never);
    await expect(createDeckAction()).rejects.toThrow("redirect /decks/dk_new");
    expect(createDeck).toHaveBeenCalledWith({}, "alice-sub");
  });

  it("rename with the trimmed title, as the member", async () => {
    vi.mocked(renameDeck).mockResolvedValue(true);
    expect(
      await renameDeckAction(form({ id: "dk_1", title: "  Report  " }))
    ).toEqual({ ok: true });
    expect(renameDeck).toHaveBeenCalledWith({}, "alice-sub", "dk_1", "Report");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("explain a blank, overlong or missing title without writing", async () => {
    const invalid: Record<string, string>[] = [
      { id: "dk_1", title: "" },
      { id: "dk_1", title: "   " },
      { id: "dk_1", title: "x".repeat(201) },
      { id: "dk_1" },
      { title: "Report" },
    ];
    for (const fields of invalid) {
      const result = await renameDeckAction(form(fields));
      expect(result).toEqual({ ok: false, error: expect.any(String) });
    }
    expect(renameDeck).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("report a deck that is gone or someone else's", async () => {
    vi.mocked(renameDeck).mockResolvedValue(false);
    expect(
      await renameDeckAction(form({ id: "dk_bob", title: "Mine" }))
    ).toEqual({ ok: false, error: expect.any(String) });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("delete as the member", async () => {
    vi.mocked(deleteDeck).mockResolvedValue(true);
    expect(await deleteDeckAction(form({ id: "dk_1" }))).toEqual({ ok: true });
    expect(deleteDeck).toHaveBeenCalledWith({}, "alice-sub", "dk_1");
    expect(refresh).toHaveBeenCalledOnce();
    expect(await deleteDeckAction(form({}))).toEqual({
      ok: false,
      error: expect.any(String),
    });
  });
});
