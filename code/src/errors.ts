export class GatewayError extends Error {
  constructor(
    public code: string,
    message: string,
    public statusCode = 500,
    public stage = "gateway",
  ) {
    super(message);
  }
}
export function asGatewayError(error: unknown): GatewayError {
  return error instanceof GatewayError
    ? error
    : new GatewayError("INTERNAL_ERROR", "An internal operation failed");
}
export function engineError(
  message = "Agent engine operation failed",
): GatewayError {
  return new GatewayError("BAD_GATEWAY", message, 502, "engine");
}
