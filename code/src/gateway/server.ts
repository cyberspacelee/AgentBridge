import Fastify from "fastify";
import staticFiles from "@fastify/static";
import { randomUUID, createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { open, stat } from "node:fs/promises";
import path from "node:path";
import { z, ZodError } from "zod";
import pino from "pino";
import {
  createTaskSchema,
  createSessionSchema,
  submitRunSchema,
  promptSchema,
  interactionReplySchema,
  type RuntimeInfo,
  type TaskSummary,
} from "../../shared/contracts.js";
import type { SessionRuntime } from "../runtime/sessions.js";
import { asGatewayError, GatewayError } from "../errors.js";
import { within } from "../async.js";
import { isTerminal } from "../domain/transitions.js";
import { artifactPath } from "../runtime/artifacts.js";
import { Telemetry } from "../observability/metrics.js";
import { evaluationEvent, evaluationMessage } from "./serialization.js";
import { SettingsManager } from "../settings.js";

const id = (params: unknown) =>
  z.object({ id: z.string().min(1).max(300) }).parse(params).id;
const pagination = z.object({
  q: z.string().max(300).default(""),
  status: z.string().max(30).default(""),
  cursor: z.string().max(2000).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
const timeRange = z
  .object({
    engine: z
      .string()
      .max(100)
      .regex(/^[a-zA-Z0-9_-]*$/)
      .default(""),
    from: z.iso
      .datetime()
      .default(() => new Date(Date.now() - 3600000).toISOString()),
    to: z.iso.datetime().default(() => new Date().toISOString()),
  })
  .refine(
    (v) =>
      v.from <= v.to && Date.parse(v.to) - Date.parse(v.from) <= 7 * 86400000,
    "Invalid time range",
  );

export function createServer(runtime: SessionRuntime) {
  const { store, config } = runtime;
  const settings = new SettingsManager(config);
  const transport = pino.transport({
    targets: [
      { target: "pino/file", options: { destination: 1 } },
      {
        target: "pino-roll",
        options: {
          file: path.join(config.dataDirectory, "logs/gateway.log"),
          size: "10m",
          frequency: "daily",
          mkdir: true,
          limit: { count: 5, removeOtherLogFiles: true },
        },
      },
    ],
  });
  transport.on("error", () => {
    store.healthy = false;
    process.stderr.write("Gateway log transport failed\n");
  });
  const logger = pino(
    {
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        "password",
        "apiKey",
      ],
    },
    transport,
  );
  runtime.onLog = (entry) => {
    const { level, ...fields } = entry;
    if (level === "error") logger.error(fields, entry.message);
    else if (level === "warn") logger.warn(fields, entry.message);
    else logger.info(fields, entry.message);
  };
  for (const entry of store.db
    .prepare(
      "SELECT stage,code,message FROM runtime_logs ORDER BY id DESC LIMIT 20",
    )
    .all())
    logger.info(
      { ...entry, category: "startup-history" },
      "Recent runtime diagnostic",
    );
  const server = Fastify({
    loggerInstance: logger,
    genReqId: () => randomUUID(),
    bodyLimit: 1024 * 1024,
    requestTimeout: 0,
  });
  const telemetry = new Telemetry(runtime);
  let connections = 0;
  let artifactDownloads = 0;
  const closeStreams = new Set<() => void>();
  server.addHook("onRequest", async (request, reply) => {
    reply.header("X-Request-ID", request.id);
    if (["127.0.0.1", "localhost", "::1"].includes(config.host)) {
      let hostname: string;
      try {
        hostname = new URL(`http://${request.headers.host}`).hostname;
      } catch {
        throw new GatewayError("VALIDATION_ERROR", "Invalid Host header", 400);
      }
      if (!["127.0.0.1", "localhost", "[::1]"].includes(hostname))
        throw new GatewayError(
          "FORBIDDEN",
          "Loopback gateway requires a loopback Host",
          403,
        );
    }
    const origin = request.headers.origin;
    if (
      origin &&
      !["GET", "HEAD", "OPTIONS"].includes(request.method) &&
      origin !== `${request.protocol}://${request.headers.host}` &&
      origin !== config.webOrigin
    )
      throw new GatewayError("FORBIDDEN", "Request origin is not allowed", 403);
  });
  server.addHook("onResponse", async (request, reply) => {
    const route = request.routeOptions.url ?? "unmatched";
    telemetry.http.inc({
      route,
      method: request.method,
      status_class: `${Math.floor(reply.statusCode / 100)}xx`,
    });
    if (route !== "/event" && route !== "/api/events")
      telemetry.httpDuration.observe(
        { route, method: request.method },
        reply.elapsedTime / 1000,
      );
  });
  server.setErrorHandler((error, request, reply) => {
    const status =
      typeof error === "object" && error !== null && "statusCode" in error
        ? Number(error.statusCode)
        : 0;
    const failure =
      error instanceof ZodError
        ? new GatewayError(
            "VALIDATION_ERROR",
            error.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; "),
            400,
          )
        : status === 400 || status === 413 || status === 415
          ? new GatewayError(
              "VALIDATION_ERROR",
              status === 413
                ? "Request body exceeds the size limit"
                : "Invalid request body",
              status,
            )
          : asGatewayError(error);
    if (failure.statusCode >= 500)
      runtime.log("error", failure.stage, failure.code, failure.message);
    request.log.warn({ code: failure.code }, "Request failed");
    void reply
      .code(failure.statusCode)
      .send({ code: failure.code, message: failure.message });
  });
  server.get("/health/live", async () => ({
    ok: true,
    instanceId: store.instanceId,
  }));
  server.get("/health/ready", async (_r, reply) => {
    const ok =
      store.healthy &&
      runtime.adapters.some((adapter) => adapter.health().status === "ready");
    return reply
      .code(ok ? 200 : 503)
      .send({ ok, engine: runtime.adapter.health() });
  });
  server.get("/metrics", async (_r, reply) =>
    reply
      .type(telemetry.registry.contentType)
      .send(await telemetry.registry.metrics()),
  );
  server.get("/api/runtime", async (): Promise<RuntimeInfo> => ({
    instanceId: store.instanceId,
    storeId: store.storeId,
    engine: runtime.adapter.id,
    health: runtime.adapter.health(),
    engines: runtime.adapters.map((adapter) => ({
      id: adapter.id,
      health: adapter.health(),
    })),
    storage: store.filename === ":memory:" ? "memory" : "sqlite",
    models: config.model ? [config.model] : [],
    limits: config.limits,
    interactionDefaults: { permission: "auto", question: "auto" },
    capabilities: {
      text: true,
      tools: true,
      permissions: true,
      questions: true,
      persistence: store.filename !== ":memory:",
      eventReplay: true,
      processMemory: false,
    },
  }));

  server.get("/api/engines/:id/models", async (request) => {
    const adapter = runtime.engine(id(request.params));
    if (adapter.health().status !== "ready")
      throw new GatewayError(
        "SERVICE_UNAVAILABLE",
        `${adapter.id} engine is not ready`,
        503,
      );
    const models = await within(
      adapter.models?.() ?? Promise.resolve([]),
      config.limits.startupTimeoutMs,
    );
    return { models };
  });

  server.get("/api/settings", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    return settings.view();
  });
  server.put("/api/settings", async (request) => settings.save(request.body));
  server.post("/api/settings/pi/packages", async (request) =>
    settings.packageOperation(request.body),
  );

  function page<T extends { id: string }>(
    items: T[],
    query: z.infer<typeof pagination>,
    scope: string,
  ) {
    const hash = createHash("sha256")
      .update(JSON.stringify([scope, query.q, query.status]))
      .digest("hex");
    let start = 0;
    if (query.cursor) {
      let cursor: { id: string; hash: string };
      try {
        cursor = z
          .object({ id: z.string(), hash: z.string() })
          .parse(JSON.parse(Buffer.from(query.cursor, "base64url").toString()));
      } catch {
        throw new GatewayError(
          "VALIDATION_ERROR",
          "Invalid pagination cursor",
          400,
        );
      }
      if (cursor.hash !== hash)
        throw new GatewayError(
          "VALIDATION_ERROR",
          "Cursor does not match filters",
          400,
        );
      const index = items.findIndex((item) => item.id === cursor.id);
      if (index === -1)
        throw new GatewayError(
          "CONFLICT",
          "List changed; refresh pagination",
          409,
        );
      start = index + 1;
    }
    const result = items.slice(start, start + query.limit);
    return {
      snapshot: store.snapshot(),
      items: result,
      nextCursor:
        start + query.limit < items.length
          ? Buffer.from(
              JSON.stringify({ id: result.at(-1)!.id, hash }),
            ).toString("base64url")
          : null,
    };
  }
  server.get("/api/tasks", async (request) => {
    const query = pagination.parse(request.query);
    const items = store
      .list("sessions")
      .map((s) => runtime.summary(s.id))
      .filter(
        (s) =>
          (!query.q ||
            `${s.title} ${s.id}`
              .toLowerCase()
              .includes(query.q.toLowerCase())) &&
          (!query.status || s.status === query.status),
      )
      .sort(
        (a, b) =>
          b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
      );
    return page<TaskSummary>(items, query, "tasks");
  });
  server.post("/api/tasks", async (request, reply) =>
    reply
      .code(202)
      .send(await runtime.submit(createTaskSchema.parse(request.body))),
  );
  server.get("/api/tasks/:id", async (request) => ({
    detail: runtime.detail(id(request.params)),
    snapshot: store.snapshot(),
  }));
  server.get("/api/tasks/:id/runs", async (request) => {
    const sessionId = id(request.params);
    runtime.session(sessionId);
    return page(
      runtime.runs(sessionId),
      pagination.parse(request.query),
      `runs:${sessionId}`,
    );
  });
  server.post("/api/tasks/:id/runs", async (request, reply) =>
    reply
      .code(202)
      .send(
        await runtime.submit(
          submitRunSchema.parse(request.body),
          id(request.params),
        ),
      ),
  );
  server.get("/api/runs/:id", async (request) => {
    const run = runtime.run(id(request.params));
    return {
      snapshot: store.snapshot(),
      detail: { run, messages: store.messages(run.sessionId, run.id) },
    };
  });
  server.get("/api/runs/:id/messages", async (request) => {
    const run = runtime.run(id(request.params));
    return page(
      store.messages(run.sessionId, run.id),
      pagination.parse(request.query),
      `messages:${run.id}`,
    );
  });
  server.get("/api/submissions/:id", async (request) => {
    const query = z
      .object({
        operation: z.enum(["create", "append"]),
        sessionId: z.string().default(""),
      })
      .parse(request.query);
    const submission = store.submission(
      id(request.params),
      query.operation,
      query.sessionId,
    );
    if (!submission)
      throw new GatewayError("NOT_FOUND", "Submission not found", 404);
    return submission;
  });

  server.post("/session", async (request, reply) => {
    const session = await runtime.createSession(
      createSessionSchema.parse(request.body),
    );
    return reply.code(200).send({
      id: session.id,
      title: session.title,
      created_at: session.createdAt,
      status: "idle",
    });
  });
  server.get("/session/status", async () =>
    Object.fromEntries(
      store.list("sessions").map((s) => [
        s.id,
        {
          type: runtime.runs(s.id).some((r) => !isTerminal(r.state))
            ? "busy"
            : "idle",
        },
      ]),
    ),
  );
  server.get("/session/:id", async (request) => {
    const s = runtime.summary(id(request.params));
    return {
      id: s.id,
      title: s.title,
      directory: s.directory,
      created_at: s.createdAt,
      status: runtime.runs(s.id).some((r) => !isTerminal(r.state))
        ? "busy"
        : "idle",
      message_count: s.messageCount,
    };
  });
  server.get("/session/:id/message", async (request) => {
    const sessionId = id(request.params);
    runtime.session(sessionId);
    return store.messages(sessionId).map(evaluationMessage);
  });
  server.post("/session/:id/prompt_async", async (request, reply) => {
    const run = runtime.enqueue(
      id(request.params),
      promptSchema.parse(request.body),
    );
    const finished = await runtime.wait(run.id);
    if (finished.state !== "completed")
      throw new GatewayError(
        finished.state === "timed_out"
          ? "TIMEOUT"
          : finished.state === "cancelled"
            ? "CONFLICT"
            : "BAD_GATEWAY",
        finished.error?.message ?? `Run ${finished.state}`,
        finished.state === "timed_out"
          ? 504
          : finished.state === "cancelled"
            ? 409
            : 502,
      );
    return reply.code(204).send();
  });
  for (const action of ["abort", "stop"])
    server.post(`/session/:id/${action}`, async (request) => {
      await runtime.cancel(id(request.params));
      return { ok: true };
    });
  server.delete("/session/:id", async (request) => {
    await runtime.deleteSession(id(request.params));
    return { ok: true };
  });
  for (const kind of ["permission", "question"] as const) {
    server.get(`/${kind}`, async () =>
      store
        .list("interactions")
        .filter(
          (i) =>
            i.kind === kind &&
            (i.state === "pending" || i.state === "replying"),
        ),
    );
    server.post(`/${kind}/:id/reply`, async (request) => {
      const interactionId = id(request.params);
      const interaction = store.get("interactions", interactionId);
      if (!interaction || interaction.kind !== kind)
        throw new GatewayError("NOT_FOUND", "Interaction not found", 404);
      await runtime.reply(
        interactionId,
        interactionReplySchema.parse(request.body),
      );
      return { ok: true };
    });
  }

  for (const route of ["/event", "/api/events"])
    server.get(route, (request, reply) => {
      if (connections >= config.limits.maxSseConnections)
        throw new GatewayError(
          "SERVICE_UNAVAILABLE",
          "SSE connection limit reached",
          503,
        );
      const sessionId = z
        .object({ sessionId: z.string().optional() })
        .parse(request.query).sessionId;
      if (sessionId) runtime.session(sessionId);
      const raw = reply.raw;
      reply.hijack();
      raw.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
        "x-request-id": request.id,
      });
      connections++;
      telemetry.sse.inc();
      let closed = false;
      let heartbeat: NodeJS.Timeout | undefined;
      let unsubscribe = () => {};
      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        connections--;
        telemetry.sse.dec();
        closeStreams.delete(close);
        raw.end();
      };
      closeStreams.add(close);
      raw.on("close", close);
      const write = (type: string, data: unknown, eventId?: string) => {
        if (closed) return;
        const frame = `${eventId ? `id: ${eventId}\n` : ""}${route === "/api/events" ? `event: ${type}\n` : ""}data: ${JSON.stringify(data)}\n\n`;
        if (raw.writableLength + Buffer.byteLength(frame) > 2 * 1024 * 1024) {
          telemetry.sseDrops.inc({ reason: "backpressure" });
          close();
          return;
        }
        raw.write(frame);
        telemetry.sseBytes.inc(Buffer.byteLength(frame));
      };
      const control = (type: string) =>
        write(type, {
          type,
          properties: { ...store.snapshot(), heartbeatMs: 15000 },
        });
      control("server.connected");
      const dispatch = (
        events: import("../../shared/contracts.js").AppEvent[],
      ) => {
        for (const event of events) {
          if (sessionId && event.sessionId !== sessionId) continue;
          if (route === "/api/events") write(event.type, event, event.eventId);
          else {
            const value = evaluationEvent(event);
            if (value) write(event.type, value, event.eventId);
          }
        }
      };
      const cursor = request.headers["last-event-id"];
      if (typeof cursor === "string") {
        const events = store.replay(cursor, sessionId);
        if (events) dispatch(events);
        else control("server.resync_required");
      }
      if (!closed) {
        unsubscribe = store.subscribe(dispatch);
        heartbeat = setInterval(() => control("server.heartbeat"), 15000);
        heartbeat.unref();
      }
    });

  server.get("/api/artifacts/:id", async (request) => {
    const artifact = store.get("artifacts", id(request.params));
    if (!artifact)
      throw new GatewayError("NOT_FOUND", "Artifact not found", 404);
    try {
      const filename = await artifactPath(
        runtime.session(artifact.sessionId).directory,
        artifact.relativePath,
      );
      const s = await stat(filename);
      if (
        s.size !== artifact.sizeBytes ||
        s.mtime.toISOString() !== artifact.modifiedAt
      )
        return {
          ...artifact,
          availability: "changed",
          validation: "not_checked",
        };
      return artifact;
    } catch {
      return { ...artifact, availability: "missing" };
    }
  });
  server.get("/api/artifacts/:id/content", async (request, reply) => {
    const artifact = store.get("artifacts", id(request.params));
    if (!artifact)
      throw new GatewayError("NOT_FOUND", "Artifact not found", 404);
    const query = z
      .object({
        disposition: z.enum(["inline", "attachment"]).default("attachment"),
      })
      .parse(request.query);
    const filename = await artifactPath(
      runtime.session(artifact.sessionId).directory,
      artifact.relativePath,
    );
    if (
      query.disposition === "inline" &&
      (!artifact.mediaType.startsWith("text/") ||
        artifact.sizeBytes > 1024 * 1024)
    )
      throw new GatewayError(
        "VALIDATION_ERROR",
        "This artifact supports download only",
        400,
      );
    if (artifactDownloads >= config.limits.maxArtifactDownloads)
      throw new GatewayError(
        "SERVICE_UNAVAILABLE",
        "Artifact download capacity reached",
        503,
      );
    artifactDownloads++;
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        artifactDownloads--;
      }
    };
    reply.raw.once("finish", release);
    reply.raw.once("close", release);
    reply.raw.setTimeout(60000, () => reply.raw.destroy());
    const handle = await open(filename, "r");
    let content: Buffer;
    try {
      const actual = await handle.stat();
      if (
        !actual.isFile() ||
        actual.size !== artifact.sizeBytes ||
        actual.size > 100 * 1024 * 1024
      )
        throw new GatewayError(
          "CONFLICT",
          "Artifact changed since registration",
          409,
        );
      const hash = createHash("sha256");
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of handle.createReadStream({
        autoClose: false,
        start: 0,
      })) {
        size += chunk.length;
        if (size > 100 * 1024 * 1024)
          throw new GatewayError(
            "CONFLICT",
            "Artifact grew during access",
            409,
          );
        hash.update(chunk);
        chunks.push(chunk);
      }
      const currentPath = await artifactPath(
        runtime.session(artifact.sessionId).directory,
        artifact.relativePath,
      );
      const current = await stat(currentPath);
      if (
        hash.digest("hex") !== artifact.digest ||
        actual.ino !== current.ino ||
        actual.dev !== current.dev ||
        actual.mtimeMs !== current.mtimeMs ||
        actual.size !== current.size
      )
        throw new GatewayError(
          "CONFLICT",
          "Artifact changed during access",
          409,
        );
      // Send the bytes that were verified, even if the source changes afterward.
      content = Buffer.concat(chunks);
    } finally {
      await handle.close();
    }
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Security-Policy", "default-src 'none'; sandbox");
    reply.header(
      "Content-Disposition",
      `${query.disposition}; filename*=UTF-8''${encodeURIComponent(artifact.displayName)}`,
    );
    return reply
      .type(
        query.disposition === "inline"
          ? "text/plain; charset=utf-8"
          : artifact.mediaType,
      )
      .send(content);
  });

  server.get("/api/observability/overview", async (request) => {
    const range = timeRange.parse(request.query);
    return telemetry.overview(range.from, range.to, range.engine);
  });
  server.get("/api/observability/series", async (request) => {
    const range = timeRange.parse(request.query);
    const metric = z.object({ metric: z.string() }).parse(request.query).metric;
    const series = telemetry.series(metric, range.from, range.to, range.engine);
    if (!series)
      throw new GatewayError("VALIDATION_ERROR", "Unknown metric", 400);
    return series;
  });
  server.get("/api/observability/errors", async (request) => {
    const range = timeRange.parse(request.query);
    const query = z
      .object({
        stage: z.string().default(""),
        code: z.string().default(""),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(request.query);
    return {
      items: store.db
        .prepare(
          "SELECT l.* FROM runtime_logs l LEFT JOIN runs r ON r.id=l.runId LEFT JOIN sessions s ON s.id=COALESCE(l.sessionId,r.sessionId) WHERE l.level IN ('error','warn') AND l.occurredAt>=? AND l.occurredAt<=? AND (?='' OR l.stage=?) AND (?='' OR l.code=?) AND (?='' OR s.engineId=?) ORDER BY l.id DESC LIMIT ?",
        )
        .all(
          range.from,
          range.to,
          query.stage,
          query.stage,
          query.code,
          query.code,
          range.engine,
          range.engine,
          query.limit,
        ),
      from: range.from,
      to: range.to,
    };
  });
  server.get("/api/observability/runs/:id", async (request) => {
    const run = runtime.run(id(request.params));
    return {
      run,
      logs: store.db
        .prepare("SELECT * FROM runtime_logs WHERE runId=? ORDER BY id")
        .all(run.id),
      spans: [
        {
          name: "queue",
          startedAt: run.acceptedAt,
          finishedAt: run.startedAt ?? run.finishedAt,
        },
        ...(run.startedAt
          ? [
              {
                name: "execution",
                startedAt: run.startedAt,
                finishedAt: run.finishedAt,
              },
            ]
          : []),
        ...store.messages(run.sessionId, run.id).flatMap((m) =>
          m.parts.flatMap((p) =>
            p.type === "tool"
              ? [
                  {
                    name: p.name,
                    startedAt: p.startedAt,
                    finishedAt: p.finishedAt,
                    state: p.state,
                  },
                ]
              : [],
          ),
        ),
      ],
      coverage: "gateway-and-observed-tools",
    };
  });

  const staticRoot = path.resolve(import.meta.dirname, "../../web/dist");
  const builtRoot = path.resolve(import.meta.dirname, "../../../web/dist");
  const root = existsSync(staticRoot) ? staticRoot : builtRoot;
  if (existsSync(root)) {
    void server.register(staticFiles, { root, prefix: "/" });
  }
  server.setNotFoundHandler((request, reply) => {
    const pathname = request.url.split("?")[0]!;
    const appRoute =
      pathname === "/" || /^\/(tasks|observability|settings)(\/|$)/.test(pathname);
    const browserPage =
      request.headers.accept?.includes("text/html") &&
      !/^\/(api|session|event|permission|question|health|metrics)(\/|$)/.test(
        pathname,
      ) &&
      !path.extname(pathname);
    if (
      existsSync(root) &&
      request.method === "GET" &&
      (appRoute || browserPage)
    )
      return reply.code(appRoute ? 200 : 404).sendFile("index.html");
    return reply
      .code(404)
      .send({ code: "NOT_FOUND", message: "Route not found" });
  });
  server.addHook("preClose", async () => {
    for (const close of closeStreams) close();
  });
  server.addHook("onClose", async () => {
    telemetry.close();
    await runtime.stop();
    runtime.onLog = () => {};
    store.close();
    await new Promise<void>((resolve) =>
      transport.flush(() => {
        transport.end();
        resolve();
      }),
    );
  });
  return server;
}
