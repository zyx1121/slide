import { beforeEach, describe, expect, it, vi } from "vitest";

import { sampleDocument } from "@/lib/deck/sample";

vi.mock("@/lib/db", () => ({ sql: {} }));
vi.mock("@/lib/deck/store", () => ({ getPublishedDeck: vi.fn() }));
vi.mock("@/lib/assets/store", () => ({ readAsset: vi.fn() }));

const { getPublishedDeck } = await import("@/lib/deck/store");
const { readAsset } = await import("@/lib/assets/store");
const { GET } = await import("./route");

const drawn = "d".repeat(64);
const other = "e".repeat(64);
const call = (publicId: string, sha256: string) =>
  GET(new Request("http://app.test/"), {
    params: Promise.resolve({ publicId, sha256 }),
  } as never);

beforeEach(() => {
  const document = sampleDocument();
  document.slides[0].shapes.push({
    id: "im_drawn",
    kind: "image",
    x: 0,
    y: 0,
    w: 10,
    h: 10,
    asset: drawn,
  });
  vi.mocked(getPublishedDeck).mockImplementation(async (_db, publicId) =>
    publicId === "abcdefghjkmnpqrs"
      ? ({ ownerSub: "alice-sub", document } as never)
      : null
  );
  vi.mocked(readAsset).mockImplementation(async (_db, sub) =>
    sub === "alice-sub"
      ? { mime: "image/png", data: Buffer.from([1, 2, 3]) }
      : (null as never)
  );
});

describe("GET /s/:publicId/assets/:sha256", () => {
  it("serves a picture the published deck draws", async () => {
    const response = await call("abcdefghjkmnpqrs", drawn);
    expect(response.status).toBe(200);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(readAsset).toHaveBeenCalledWith({}, "alice-sub", drawn);
  });

  it("serves nothing the deck does not draw, nor for an unpublished deck", async () => {
    expect((await call("abcdefghjkmnpqrs", other)).status).toBe(404);
    expect((await call("unpublished00000", drawn)).status).toBe(404);
  });
});
