import { z } from "zod";

export const gatewaySchema = z.object({
  host: z.union([z.ipv4(), z.ipv6(), z.literal("localhost")]),
  port: z.number().int().min(0).max(65535),
}).strict();

export function gatewayUrl(host, port) {
  const address = host === "0.0.0.0" ? "127.0.0.1" : host === "::" ? "::1" : host;
  return new URL(`http://${address.includes(":") ? `[${address}]` : address}:${port}`).origin;
}
