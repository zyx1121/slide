import { beforeEach, describe, expect, it, vi } from "vitest";

import { sampleDocument } from "@/lib/deck/sample";

vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/db", () => ({ sql: {} }));
vi.mock("@/lib/deck/store", () => ({ getDeck: vi.fn() }));
vi.mock("@/lib/assets/store", () => ({ readAsset: vi.fn(async () => null) }));

const { getSession } = await import("@/lib/auth/session");
const { getDeck } = await import("@/lib/deck/store");
const { GET } = await import("./route");

const call = (id: string) =>
  GET(new Request("http://app.test/"), {
    params: Promise.resolve({ id }),
  } as never);

beforeEach(() => {
  vi.mocked(getSession).mockResolvedValue({
    sub: "alice-sub",
    name: "Alice",
    email: "",
  });
  vi.mocked(getDeck).mockImplementation(async (_db, owner, id) =>
    owner === "alice-sub" && id === "dk_alice"
      ? ({ id, title: "語音 / Speech", document: sampleDocument() } as never)
      : null
  );
});

describe("GET /api/decks/:id/export", () => {
  it("downloads the owner's deck as .pptx, named after its title", async () => {
    const response = await call("dk_alice");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("presentationml");
    expect(response.headers.get("content-disposition")).toContain(
      `filename*=UTF-8''${encodeURIComponent("語音   Speech.pptx")}`
    );
    const bytes = new Uint8Array(await response.arrayBuffer());
    // A zip file starts with PK.
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe("PK");
  });

  it("answers 404 for another member's deck and 401 when signed out", async () => {
    expect((await call("dk_bob")).status).toBe(404);
    vi.mocked(getSession).mockResolvedValueOnce(null);
    expect((await call("dk_alice")).status).toBe(401);
  });
});
