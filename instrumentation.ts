// OpenTelemetry for the WinLab observability platform, Sensorium: request
// spans, the app's own spans (imports, renders, exports, MCP tools) and
// error logs, over OTLP/HTTP JSON, the one encoding Sensorium takes. Off
// unless OTEL_EXPORTER_OTLP_ENDPOINT is set; OTEL_EXPORTER_OTLP_HEADERS
// carries the project's bearer token and OTEL_SERVICE_NAME names the
// service. The same shape as www.winlab.tw's.
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs";
import { OTLPHttpJsonTraceExporter, registerOTel } from "@vercel/otel";

import { emitErrorLog } from "@/lib/otel/log";
import { RedactingExporter } from "@/lib/otel/redact";

export function register() {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.replace(/\/+$/, "");
  if (!endpoint) return;
  const headers = parseHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS);
  registerOTel({
    serviceName: process.env.OTEL_SERVICE_NAME || "slide",
    // Only the JSON exporter below: @vercel/otel's "auto" processor would
    // also send protobuf, which Sensorium refuses.
    spanProcessors: [],
    // Paths lose their queries and public ids before they leave.
    traceExporter: new RedactingExporter(
      new OTLPHttpJsonTraceExporter({ url: `${endpoint}/v1/traces`, headers })
    ),
    logRecordProcessors: [
      new BatchLogRecordProcessor({
        exporter: new OTLPLogExporter({ url: `${endpoint}/v1/logs`, headers }),
      }),
    ],
  });
}

/** Errors on the server (renders, route handlers, actions) as error logs. */
export async function onRequestError(
  error: unknown,
  request: Readonly<{ path: string; method: string }>,
  context: Readonly<{ routePath: string; routeType: string }>
) {
  emitErrorLog(error, {
    "http.route": context.routePath,
    "http.request.method": request.method,
    "next.route_type": context.routeType,
  });
}

/** OTLP's `key=value,key=value` header list. */
function parseHeaders(raw: string | undefined) {
  if (!raw) return undefined;
  const headers: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const eq = pair.indexOf("=");
    if (eq > 0) headers[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return headers;
}
