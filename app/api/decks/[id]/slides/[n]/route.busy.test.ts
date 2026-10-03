import { describe, expect, it, vi } from "vitest";

import { sampleDocument } from "@/lib/deck/sample";

vi.mock("@/lib/auth/session", () => ({
  getSession: vi.fn(async () => ({ sub: "alice-sub", name: "", email: "" })),
}));
vi.mock("@/lib/db", () => ({ sql: {} }));
vi.mock("@/lib/deck/store", () => ({
  getDeck: vi.fn(async () => ({ id: "dk_alice", document: sampleDocument() })),
}));
vi.mock("@/lib/assets/store", () => ({
  slideAssetUris: vi.fn(async () => new Map()),
}));
vi.mock("@/lib/render/png", async (original) => {
  const real = await original<typeof import("@/lib/render/png")>();
  return {
    ...real,
    renderPngAsync: vi.fn(async () => {
      throw new real.RenderBusyError("timeout");
    }),
  };
});

const { GET } = await import("./route");

describe("GET /api/decks/:id/slides/:n while rendering is busy", () => {
  it("answers 503 with Retry-After instead of hanging", async () => {
    const response = await GET(new Request("http://app.test/"), {
      params: Promise.resolve({ id: "dk_alice", n: "1" }),
    } as never);
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("5");
  });
});
