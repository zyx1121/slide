// The app's own spans for Sensorium: imports, renders, exports and MCP
// tools, with counts and outcomes, never deck content. A no-op tracer until
// instrumentation.ts registers one.
import { type Attributes, SpanStatusCode, trace } from "@opentelemetry/api";

/**
 * Runs `work` inside a span named `name`. `work` may add attributes as it
 * learns them (counts, outcomes); a throw marks the span as an error.
 */
export async function inSpan<T>(
  name: string,
  attributes: Attributes,
  work: (set: (more: Attributes) => void) => Promise<T> | T
): Promise<T> {
  return trace
    .getTracer("slide")
    .startActiveSpan(name, { attributes }, async (span) => {
      try {
        return await work((more) => span.setAttributes(more));
      } catch (error) {
        span.recordException(error as Error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      } finally {
        span.end();
      }
    });
}
