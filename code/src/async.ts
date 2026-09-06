import { GatewayError } from "./errors.js";

export function within<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new GatewayError("TIMEOUT", "Operation timed out", 504)),
        timeoutMs,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}
