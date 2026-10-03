import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/db", () => ({ sql: {} }));
vi.mock("@/lib/assets/store", async (original) => ({
  ...(await original<typeof import("@/lib/assets/store")>()),
  saveAsset: vi.fn(),
}));

const { getSession } = await import("@/lib/auth/session");
const { saveAsset } = await import("@/lib/assets/store");
const { POST } = await import("./route");

const upload = (body: BodyInit, headers: Record<string, string> = {}) =>
  POST(
    new Request("http://app.test/api/assets", {
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
  vi.mocked(saveAsset).mockResolvedValue({
    sha256: "a".repeat(64),
    bytes: 3,
    mime: "image/png",
    width: 1,
    height: 1,
  });
});

describe("POST /api/assets", () => {
  it("stores the body for the signed-in member", async () => {
    const response = await upload(new Uint8Array([1, 2, 3]));
    expect(response.status).toBe(201);
    expect(saveAsset).toHaveBeenCalledWith({}, "alice", expect.any(Uint8Array));
  });

  it("takes an upload from the site's own pages", async () => {
    const own = { origin: "http://app.test", "sec-fetch-site": "same-origin" };
    expect((await upload(new Uint8Array([1]), own)).status).toBe(201);
  });

  it("refuses a signed-out request and another site's", async () => {
    vi.mocked(getSession).mockResolvedValueOnce(null);
    expect((await upload(new Uint8Array([1]))).status).toBe(401);
    expect(
      (await upload(new Uint8Array([1]), { origin: "https://evil.test" }))
        .status
    ).toBe(403);
    expect(
      (await upload(new Uint8Array([1]), { "sec-fetch-site": "same-site" }))
        .status
    ).toBe(403);
  });

  it("stops reading a body past the limit", async () => {
    vi.mocked(saveAsset).mockClear();
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    expect((await upload(big)).status).toBe(413);
    expect(saveAsset).not.toHaveBeenCalled();
  });
});
