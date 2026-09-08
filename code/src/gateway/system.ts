import { gatewaySchema } from "../../host/gateway.mjs";
import { createRequire } from "node:module";
import { codeRoot } from "../engines/tool-instructions.js";
import type { Server, IncomingMessage, ServerResponse } from "node:http";
import type { Logger } from "pino";
import { randomUUID, createHash } from "node:crypto";
import { opendir, realpath, stat, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { lifecycleSchema, networkInputSchema, type DirectoryView, type SystemView } from "../../shared/system.js";
import type { SessionRuntime } from "../runtime/sessions.js";
import { GatewayError } from "../errors.js";
import { validateCertificatePem } from "../../host/network.mjs";
import { isWithin, validateDirectory } from "../runtime/artifacts.js";

const { version } = createRequire(import.meta.url)(path.join(codeRoot, "package.json")) as { version: string };
const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
process.on("message", (message: unknown) => {
  if (!message || typeof message !== "object" || !("type" in message) || message.type !== "host:response") return;
  const parsed = z.object({ type: z.literal("host:response"), id: z.string(), value: z.unknown().optional(), error: z.string().optional() }).safeParse(message);
  if (!parsed.success) return;
  const input = parsed.data;
  const request = pending.get(input.id);
  if (!request) return;
  clearTimeout(request.timer); pending.delete(input.id);
  if (input.error) request.reject(new GatewayError("CONFIGURATION_ERROR", input.error, 409));
  else request.resolve(input.value);
});
process.on("disconnect", () => { for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new GatewayError("SERVICE_UNAVAILABLE", "启动管理器已断开", 503)); } pending.clear(); });
export function hostRequest(method: string, payload: unknown = {}) {
  if (!process.connected || !process.send) throw new GatewayError("SERVICE_UNAVAILABLE", "请通过 pnpm start、pnpm dev 或桌面入口启动服务", 503);
  if (pending.size >= 32) throw new GatewayError("RATE_LIMITED", "系统操作过多", 429);
  return new Promise<unknown>((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => { pending.delete(id); reject(new GatewayError("GATEWAY_TIMEOUT", "系统操作超时", 504)); }, 20000);
    pending.set(id, { resolve, reject, timer });
    process.send!({ type: "host:request", id, method, payload }, (error) => { if (error) { clearTimeout(timer); pending.delete(id); reject(error); } });
  });
}
export function systemRoutes(server: FastifyInstance<Server, IncomingMessage, ServerResponse, Logger>, runtime: SessionRuntime) {
  const { config, store } = runtime;
  server.get("/api/system", async (): Promise<SystemView> => ({
    storeId: store.storeId, version, nodeVersion: process.version, nodePath: process.execPath, npmPath: config.runtimeNpm || null,
    capabilities: { gateway: config.supervised, network: config.supervised, restart: config.supervised, directories: true, certificates: true },
    maintenance: runtime.lifecycle,
  }));
  server.get("/api/system/gateway", async () => hostRequest("gateway.get"));
  server.put("/api/system/gateway", async (request) => hostRequest("gateway.save", z.object({ settings: gatewaySchema, revision: z.string().length(64) }).strict().parse(request.body)));
  server.get("/api/system/network", async () => hostRequest("network.get"));
  server.put("/api/system/network", async (request) => hostRequest("network.save", z.object({ settings: networkInputSchema, revision: z.string().length(64) }).strict().parse(request.body)));
  server.post("/api/system/network/test", async (request) => hostRequest("network.test", z.object({ settings: networkInputSchema, url: z.string().url().max(4096) }).strict().parse(request.body)));
  server.post("/api/system/lifecycle", async (request, reply) => {
    const input = lifecycleSchema.parse(request.body);
    const result = await hostRequest("lifecycle", input);
    return reply.code(202).send(result);
  });
  server.get("/api/system/directories", async (request): Promise<DirectoryView> => {
    const { directory } = z.object({ directory: z.string().max(4096).optional() }).parse(request.query);
    const roots = config.allowedDirectories.length ? await Promise.all(config.allowedDirectories.map((root) => realpath(root))) : process.platform === "win32"
      ? (await Promise.all(Array.from({ length: 26 }, (_, i) => realpath(`${String.fromCharCode(65 + i)}:\\`).catch(() => null)))).filter((root): root is string => root !== null)
      : ["/"];
    if (!config.allowedDirectories.length && directory && process.platform === "win32" && path.isAbsolute(directory)) roots.push(path.parse(directory).root);
    if (!directory) return { directory: null, parent: null, entries: roots.map((root) => ({ name: root, path: root })), truncated: false };
    const resolved = await validateDirectory(directory, roots);
    const parent = path.dirname(resolved);
    const visible = (target: string) => roots.some((root) => isWithin(root, target));
    const entries: DirectoryView["entries"] = [];
    let visited = 0;
    for await (const child of await opendir(resolved)) {
      if (++visited > 5000) break;
      if (!child.isDirectory() && !child.isSymbolicLink()) continue;
      try {
        const target = await realpath(path.join(resolved, child.name));
        if (visible(target) && (await stat(target)).isDirectory()) entries.push({ name: child.name, path: target });
      } catch { /* An inaccessible child must not make its parent unbrowseable. */ }
      if (entries.length >= 500) break;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    return { directory: resolved, parent: parent !== resolved && visible(parent) ? parent : null, entries, truncated: entries.length >= 500 || visited > 5000 };
  });
  server.post("/api/system/certificates", { bodyLimit: 3 * 1024 * 1024 }, async (request) => {
    const { pem } = z.object({ pem: z.string().min(1).max(2 * 1024 * 1024) }).strict().parse(request.body);
    try { validateCertificatePem(pem); }
    catch { throw new GatewayError("VALIDATION_ERROR", "需要有效的 PEM 格式 CA 证书（不超过 2 MiB）", 400); }
    const directory = path.join(config.dataDirectory, "certificates");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const filename = path.join(directory, `${createHash("sha256").update(pem).digest("hex")}.pem`);
    await writeFile(filename, pem, { mode: 0o600, flag: "wx" }).catch((error) => { if (error.code !== "EEXIST") throw error; });
    return { path: filename };
  });
}
