import { redactDiagnostic } from "../host/diagnostics.mjs";
export class GatewayError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode = 500,
    public stage = "gateway",
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
export function asGatewayError(error: unknown): GatewayError {
  return error instanceof GatewayError
    ? error
    : new GatewayError("INTERNAL_ERROR", "An internal operation failed", 500, "gateway", { cause: error });
}
export function engineError(
  message = "Agent engine operation failed",
  detail?: unknown,
  secrets: string[] = [],
): GatewayError {
  return new GatewayError(
    "BAD_GATEWAY",
    detail === undefined
      ? message
      : `${message}: ${errorDetail(detail, secrets)}`,
    502,
    "engine",
  );
}

// Keep diagnostic fields, not whole upstream responses (which may echo requests).
export function errorDetail(value: unknown, secrets: string[] = []): string {
  function describe(input: unknown, depth = 0): string {
    if (depth > 4 || input == null) return "";
    if (typeof input === "string") {
      try {
        return describe(JSON.parse(input), depth + 1);
      } catch {
        return input;
      }
    }
    if (typeof input !== "object") return String(input);
    const record = input as Record<string, unknown>;
    const fields = [
      "name",
      "code",
      "statusCode",
      "message",
      "errorMessage",
      "error",
      "data",
      "cause",
    ].map((key) => describe(record[key], depth + 1));
    if (typeof record.responseBody === "string") {
      try {
        fields.push(describe(JSON.parse(record.responseBody), depth + 1));
      } catch {}
    }
    return [...new Set(fields.filter(Boolean))].join(": ");
  }
  let message = describe(value) || "No diagnostic details were provided";
  message = redactDiagnostic(message, secrets).replace(/[\x00-\x1f\x7f]/g, " ");
  return message.length <= 2000
    ? message
    : `${message.slice(0, 1000)}... [truncated] ...${message.slice(-980)}`;
}
