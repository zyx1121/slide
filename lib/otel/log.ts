// Error logs for Sensorium. A no-op until instrumentation.ts registers a
// logger provider, so tests and runs without OTel lose nothing.
import {
  type LogAttributes,
  logs,
  SeverityNumber,
} from "@opentelemetry/api-logs";

/**
 * An error as a log record: its message and stack, with attributes that
 * say where it happened. Never deck content, file names or credentials.
 */
export function emitErrorLog(error: unknown, attributes: LogAttributes = {}) {
  logs.getLogger("slide").emit({
    severityNumber: SeverityNumber.ERROR,
    severityText: "ERROR",
    body: error instanceof Error ? error.message : String(error),
    attributes: {
      ...(error instanceof Error && error.stack
        ? { "exception.stacktrace": error.stack }
        : {}),
      ...(error instanceof Error ? { "exception.type": error.name } : {}),
      ...attributes,
    },
  });
}
