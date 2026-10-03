import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/db", () => ({ sql: {} }));
vi.mock("@/lib/deck/store", () => ({
  createDeck: vi.fn(async () => ({ id: "dk_new" })),
}));
vi.mock("@/lib/assets/store", () => ({
  AssetError: class extends Error {},
  saveAsset: vi.fn(),
}));

const { getSession } = await import("@/lib/auth/session");
const { createDeck } = await import("@/lib/deck/store");
const { exportPptx } = await import("@/lib/pptx/export");
const { sampleDocument } = await import("@/lib/deck/sample");
const { POST } = await import("./route");

const send = (body: BodyInit, headers: Record<string, string> = {}) =>
  POST(
    new Request("http://app.test/api/decks/import", {
      method: "POST",
      body,
      headers,
      duplex: "half",
    } as RequestInit)
  );

beforeEach(() => {
  vi.mocked(getSession).mockResolvedValue({
    sub: "alice",
    name: "Alice",
    email: "",
  });
});

describe("POST /api/decks/import", () => {
  it("makes a deck of the member's from a .pptx", async () => {
    const bytes = exportPptx(sampleDocument(), new Map());
    const response = await send(new Uint8Array(bytes), {
      "x-file-name": encodeURIComponent("報告.pptx"),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ id: "dk_new" });
    expect(createDeck).toHaveBeenCalledWith({}, "alice", expect.any(Object));
  });

  it("refuses another site, a signed-out request and a file that is not a deck", async () => {
    expect(
      (await send(new Uint8Array([1]), { origin: "https://evil.test" })).status
    ).toBe(403);
    vi.mocked(getSession).mockResolvedValueOnce(null);
    expect((await send(new Uint8Array([1]))).status).toBe(401);
    expect((await send(new Uint8Array([1, 2, 3]))).status).toBe(422);
  });
});
