import { beforeEach, describe, expect, it, vi } from "vitest";

import { sampleDocument } from "@/lib/deck/sample";

vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/db", () => ({ sql: {} }));
vi.mock("@/lib/deck/store", () => ({ getDeck: vi.fn() }));
vi.mock("@/lib/assets/store", () => ({
  slideAssetUris: vi.fn(async () => new Map()),
}));

const { getSession } = await import("@/lib/auth/session");
const { getDeck } = await import("@/lib/deck/store");
const { GET } = await import("./route");

const call = (id: string, n: string) =>
  GET(new Request("http://app.test/"), {
    params: Promise.resolve({ id, n }),
  } as never);

beforeEach(() => {
  vi.mocked(getSession).mockResolvedValue({
    sub: "alice-sub",
    name: "Alice",
    email: "",
  });
  vi.mocked(getDeck).mockImplementation(async (_db, owner, id) =>
    owner === "alice-sub" && id === "dk_alice"
      ? ({ id, document: sampleDocument() } as never)
      : null
  );
});

describe("GET /api/decks/:id/slides/:n", () => {
  it("returns the owner's slide as PNG", async () => {
    const response = await call("dk_alice", "1");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    const png = new Uint8Array(await response.arrayBuffer());
    expect(String.fromCharCode(...png.slice(1, 4))).toBe("PNG");
  });

  it("answers 404 for another member's deck and for a missing slide", async () => {
    expect((await call("dk_bob", "1")).status).toBe(404);
    expect((await call("dk_alice", "2")).status).toBe(404);
  });

  it("answers 404 for slide numbers that are not written plainly", async () => {
    vi.mocked(getDeck).mockClear();
    for (const n of [
      "0",
      "-1",
      "1.5",
      "01",
      "0x1",
      "1e0",
      "abc",
      "99999",
      "",
    ]) {
      expect((await call("dk_alice", n)).status).toBe(404);
    }
    expect(getDeck).not.toHaveBeenCalled();
  });

  it("answers 401 without a session", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    expect((await call("dk_alice", "1")).status).toBe(401);
  });
});
