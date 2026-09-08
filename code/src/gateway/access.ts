import type { Server, IncomingMessage, ServerResponse } from "node:http";
import type { Logger } from "pino";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Config } from "../config.js";
import { GatewayError } from "../errors.js";
const equal = (a: string, b: string) => Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function accessControl(server: FastifyInstance<Server, IncomingMessage, ServerResponse, Logger>, config: Config) {
  const token = config.accessToken ?? config.desktopToken;
  const signature = (expires: string) => createHmac("sha256", token ?? "").update(`browser:${expires}`).digest("hex");
  const authenticated = (request: FastifyRequest) => {
    if (!token) return true;
    if (equal(request.headers.authorization ?? "", `Bearer ${token}`)) return true;
    const cookie = request.headers.cookie?.split(";").map((value) => value.trim()).find((value) => value.startsWith("agentbridge_access="))?.slice(19);
    if (!cookie) return false;
    const [expires, hash] = cookie.split(".");
    return !!expires && !!hash && /^\d{13}$/.test(expires) && Number(expires) > Date.now() && equal(hash, signature(expires));
  };
  const attempts = new Map<string, { count: number; until: number }>();
  server.get("/api/access", async (request) => ({ authenticated: authenticated(request), required: !!token }));
  server.post("/api/access", async (request, reply) => {
    const { code } = z.object({ code: z.string().min(32).max(256) }).strict().parse(request.body);
    const attempt = attempts.get(request.ip);
    if (attempt && attempt.until > Date.now() && attempt.count >= 10) throw new GatewayError("RATE_LIMITED", "尝试过多，请稍后重试", 429);
    if (!token || !equal(code, token)) {
      if (attempts.size >= 1000) for (const [ip, value] of attempts) if (value.until <= Date.now()) attempts.delete(ip);
      if (attempts.size >= 1000 && !attempts.has(request.ip)) throw new GatewayError("RATE_LIMITED", "请稍后重试", 429);
      attempts.set(request.ip, { count: attempt && attempt.until > Date.now() ? attempt.count + 1 : 1, until: Date.now() + 300000 });
      throw new GatewayError("UNAUTHORIZED", "配对码无效", 401);
    }
    attempts.delete(request.ip);
    const expires = String(Date.now() + 12 * 3600000);
    reply.header("Set-Cookie", `agentbridge_access=${expires}.${signature(expires)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${request.protocol === "https" ? "; Secure" : ""}`);
    return { authenticated: true };
  });
  server.delete("/api/access", async (_request, reply) => {
    reply.header("Set-Cookie", "agentbridge_access=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
    return { authenticated: false };
  });
  server.addHook("onRequest", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const pathname = request.url.split("?")[0];
    if (token && (config.desktopToken || (pathname !== "/api/access" && /^\/(api|session|event|permission|question|health|metrics)(\/|$)/.test(pathname!))) && !authenticated(request))
      throw new GatewayError("UNAUTHORIZED", "请使用服务启动时的配对码连接此实例", config.desktopToken ? 403 : 401);
    if (token && !request.headers.authorization && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
      const origin = request.headers.origin;
      if (!origin || (origin !== `${request.protocol}://${request.headers.host}` && origin !== config.webOrigin))
        throw new GatewayError("FORBIDDEN", "管理操作需要可信的同源请求", 403);
    }
  });
}
