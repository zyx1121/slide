// What spans must not carry to Sensorium: a published deck's public id is
// the only key to it (and survives unpublishing), and sign-in callbacks
// carry codes in their query. Paths in span names and attributes keep
// their route and lose both.
import type { ExportResult } from "@opentelemetry/core";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace-base";

/** A path or URL without its query, public ids as /s/[publicId]. */
export function redactPath(value: string): string {
  if (!/^(\/|https?:\/\/|[A-Z]+ \/)/.test(value)) return value;
  return value.replace(/\?\S*/, "").replace(/\/s\/[^/\s?#]+/g, "/s/[publicId]");
}

/** An exporter that sends spans with their paths redacted. */
export class RedactingExporter implements SpanExporter {
  constructor(private readonly inner: SpanExporter) {}

  export(spans: ReadableSpan[], done: (result: ExportResult) => void): void {
    this.inner.export(spans.map(redactSpan), done);
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush?.() ?? Promise.resolve();
  }
}

function redactSpan(span: ReadableSpan): ReadableSpan {
  const attributes = Object.fromEntries(
    Object.entries(span.attributes).map(([key, value]) => [
      key,
      typeof value === "string" ? redactPath(value) : value,
    ])
  );
  // The span as it was, but for its name and attributes.
  return Object.create(span, {
    name: { value: redactPath(span.name), enumerable: true },
    attributes: { value: attributes, enumerable: true },
  });
}
