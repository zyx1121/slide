import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";
import { describe, expect, it } from "vitest";

import { RedactingExporter, redactPath } from "./redact";

describe("redactPath", () => {
  it("drops queries and public ids from paths, URLs and span names", () => {
    expect(redactPath("/s/pub_k4m9x2qa7b/export")).toBe("/s/[publicId]/export");
    expect(redactPath("GET /s/pub_k4m9x2qa7b")).toBe("GET /s/[publicId]");
    expect(redactPath("/auth/callback?code=abc&state=def")).toBe(
      "/auth/callback"
    );
    expect(redactPath("https://slide.zyx.tw/s/abc?x=1")).toBe(
      "https://slide.zyx.tw/s/[publicId]"
    );
    expect(redactPath("/api/decks/dk_abc/slides/2")).toBe(
      "/api/decks/dk_abc/slides/2"
    );
    // Not a path: left alone.
    expect(redactPath("why? because")).toBe("why? because");
  });
});

describe("RedactingExporter", () => {
  it("exports spans with redacted names and attributes, the rest as it was", () => {
    let sent: ReadableSpan[] = [];
    const inner = {
      export: (spans: ReadableSpan[]) => (sent = spans),
      shutdown: async () => {},
    } as unknown as SpanExporter;
    const span = {
      name: "GET /s/pub_secret?x=1",
      attributes: {
        "http.target": "/s/pub_secret/export",
        "http.status_code": 200,
      },
      kind: 1,
      spanContext: () => ({ traceId: "t", spanId: "s", traceFlags: 1 }),
    } as unknown as ReadableSpan;
    new RedactingExporter(inner).export([span], () => {});
    expect(sent[0].name).toBe("GET /s/[publicId]");
    expect(sent[0].attributes).toEqual({
      "http.target": "/s/[publicId]/export",
      "http.status_code": 200,
    });
    expect(sent[0].kind).toBe(1);
    expect(sent[0].spanContext().traceId).toBe("t");
  });
});
