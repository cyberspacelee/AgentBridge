import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from "prom-client";
import { performance } from "node:perf_hooks";
import type { Run } from "../../shared/contracts.js";
import { isTerminal } from "../domain/transitions.js";
import type { SessionRuntime } from "../runtime/sessions.js";

export class Telemetry {
  readonly registry = new Registry();
  readonly http: Counter<"route" | "method" | "status_class">;
  readonly httpDuration: Histogram<"route" | "method">;
  readonly sse: Gauge;
  readonly sseBytes: Counter;
  readonly sseDrops: Counter<"reason">;
  private finished: Counter<"outcome">;
  private duration: Histogram<"phase">;
  private active: Gauge;
  private queued: Gauge;
  private ready: Gauge;
  private records: Gauge<"kind">;
  private published: Counter<"type">;
  private unsubscribe: () => void;
  private timer: NodeJS.Timeout;
  private samples: {
    at: string;
    rssBytes: number;
    heapBytes: number;
    activeRuns: number;
    queueDepth: number;
    completed: number;
    failed: number;
    engines: Record<
      string,
      {
        activeRuns: number;
        queueDepth: number;
        completed: number;
        failed: number;
      }
    >;
  }[] = [];
  constructor(private runtime: SessionRuntime) {
    const registers = [this.registry];
    collectDefaultMetrics({ register: this.registry, prefix: "agentbridge_" });
    this.http = new Counter({
      name: "agentbridge_http_requests_total",
      help: "Completed HTTP requests",
      labelNames: ["route", "method", "status_class"],
      registers,
    });
    this.httpDuration = new Histogram({
      name: "agentbridge_http_request_duration_seconds",
      help: "HTTP request duration excluding SSE",
      labelNames: ["route", "method"],
      buckets: [0.005, 0.02, 0.1, 0.5, 1, 5, 30, 120, 600],
      registers,
    });
    this.finished = new Counter({
      name: "agentbridge_runs_finished_total",
      help: "Run outcomes committed in this instance",
      labelNames: ["outcome"],
      registers,
    });
    this.duration = new Histogram({
      name: "agentbridge_run_duration_seconds",
      help: "Run phase durations",
      labelNames: ["phase"],
      buckets: [0.1, 1, 5, 15, 30, 60, 120, 300, 600],
      registers,
    });
    this.active = new Gauge({
      name: "agentbridge_runs_active",
      help: "Running or stopping executions",
      registers,
    });
    this.queued = new Gauge({
      name: "agentbridge_queue_depth",
      help: "Queued executions",
      registers,
    });
    this.ready = new Gauge({
      name: "agentbridge_engine_ready",
      help: "Engine readiness",
      registers,
    });
    this.records = new Gauge({
      name: "agentbridge_stored_records",
      help: "Stored business records",
      labelNames: ["kind"],
      registers,
    });
    this.published = new Counter({
      name: "agentbridge_events_published_total",
      help: "Committed application events",
      labelNames: ["type"],
      registers,
    });
    this.unsubscribe = runtime.store.subscribe((events) => {
      for (const event of events) this.published.inc({ type: event.type });
    });
    this.sse = new Gauge({
      name: "agentbridge_sse_connections",
      help: "Connected event consumers",
      registers,
    });
    this.sseBytes = new Counter({
      name: "agentbridge_sse_bytes_sent_total",
      help: "Bytes written to SSE consumers",
      registers,
    });
    this.sseDrops = new Counter({
      name: "agentbridge_sse_disconnects_total",
      help: "SSE disconnections",
      labelNames: ["reason"],
      registers,
    });
    runtime.onFinished = (run) => this.recordFinished(run);
    this.sample();
    this.timer = setInterval(() => this.sample(), 5000);
    this.timer.unref();
  }
  private recordFinished(run: Run) {
    this.finished.inc({ outcome: run.state });
    const end = Date.parse(run.finishedAt!);
    const start = Date.parse(run.startedAt ?? run.finishedAt!);
    this.duration.observe(
      { phase: "total" },
      Math.max(0, (end - Date.parse(run.acceptedAt)) / 1000),
    );
    this.duration.observe(
      { phase: "queue" },
      Math.max(0, (start - Date.parse(run.acceptedAt)) / 1000),
    );
    if (run.startedAt)
      this.duration.observe(
        { phase: "execution" },
        Math.max(0, (end - start) / 1000),
      );
  }
  private sample() {
    const runs = this.runtime.store.list("runs");
    const sessions = this.runtime.store.list("sessions");
    const engineBySession = new Map(sessions.map((s) => [s.id, s.engineId]));
    const engines = Object.fromEntries(
      [
        ...new Set([
          ...this.runtime.adapters.map((adapter) => adapter.id),
          ...sessions.map((s) => s.engineId),
        ]),
      ].map((engine) => {
        const selected = runs.filter(
          (r) => engineBySession.get(r.sessionId) === engine,
        );
        return [
          engine,
          {
            activeRuns: selected.filter(
              (r) => r.state === "running" || r.state === "stopping",
            ).length,
            queueDepth: selected.filter((r) => r.state === "queued").length,
            completed: selected.filter((r) => r.state === "completed").length,
            failed: selected.filter(
              (r) => r.state === "failed" || r.state === "timed_out",
            ).length,
          },
        ];
      }),
    );
    const memory = process.memoryUsage();
    const sample = {
      at: new Date().toISOString(),
      rssBytes: memory.rss,
      heapBytes: memory.heapUsed,
      engines,
      activeRuns: runs.filter(
        (r) => r.state === "running" || r.state === "stopping",
      ).length,
      queueDepth: runs.filter((r) => r.state === "queued").length,
      completed: runs.filter((r) => r.state === "completed").length,
      failed: runs.filter(
        (r) => r.state === "failed" || r.state === "timed_out",
      ).length,
    };
    this.active.set(sample.activeRuns);
    this.queued.set(sample.queueDepth);
    this.ready.set(
      this.runtime.adapters.some(
        (adapter) => this.runtime.agentHealth(adapter.id).status === "ready",
      )
        ? 1
        : 0,
    );
    for (const table of [
      "sessions",
      "runs",
      "messages",
      "artifacts",
      "interactions",
    ] as const)
      this.records.set(
        { kind: table },
        Number(
          this.runtime.store.db
            .prepare(`SELECT COUNT(*) AS n FROM ${table}`)
            .get()?.n ?? 0,
        ),
      );
    this.samples.push(sample);
    if (this.samples.length > 720) this.samples.shift();
  }
  async overview(from: string, to: string, engine = "") {
    const sessions = this.runtime.store
      .list("sessions")
      .filter((s) => !engine || s.engineId === engine);
    const sessionIds = new Set(sessions.map((s) => s.id));
    const allRuns = this.runtime.store.list("runs");
    const all = allRuns.filter((r) => sessionIds.has(r.sessionId));
    const runs = all.filter(
      (r) => r.finishedAt && r.finishedAt >= from && r.finishedAt <= to,
    );
    const count = (state: string) =>
      runs.filter((r) => r.state === state).length;
    const completed = count("completed"),
      failed = count("failed"),
      timedOut = count("timed_out"),
      cancelled = count("cancelled");
    const durations = runs
      .filter((r) => r.startedAt)
      .map((r) => Date.parse(r.finishedAt!) - Date.parse(r.startedAt!))
      .sort((a, b) => a - b);
    const percentile = (p: number) =>
      durations.length
        ? durations[Math.max(0, Math.ceil(durations.length * p) - 1)]
        : null;
    const tools = this.runtime.store.db
      .prepare(
        "SELECT p.content FROM message_parts p JOIN messages m ON m.id=p.messageId JOIN runs r ON r.id=m.runId JOIN sessions s ON s.id=r.sessionId WHERE p.type='tool' AND r.acceptedAt>=? AND r.acceptedAt<=? AND (?='' OR s.engineId=?)",
      )
      .all(from, to, engine, engine)
      .map(
        (r) =>
          JSON.parse(String(r.content)) as {
            name: string;
            state: string;
            startedAt: string | null;
            finishedAt: string | null;
          },
      );
    const usage = runs.map((r) => r.usage).filter((u) => u !== null);
    const [http, connections, sent, drops] = await Promise.all([
      this.http.get(),
      this.sse.get(),
      this.sseBytes.get(),
      this.sseDrops.get(),
    ]);
    const sumValues = (values: { value: number }[]) =>
      values.reduce((total, value) => total + value.value, 0);
    const db = this.runtime.store.db;
    return {
      from,
      to,
      capturedAt: new Date().toISOString(),
      instanceId: this.runtime.store.instanceId,
      engine: engine || null,
      health: this.runtime.adapters.some((adapter) => adapter.id === engine)
        ? this.runtime.agentHealth(engine)
        : null,
      agents: this.runtime.agentViews().filter((agent) => !engine || agent.id === engine),
      limits: this.runtime.config.limits,
      completed,
      failed,
      timedOut,
      cancelled,
      totalFinished: runs.length,
      accepted: all.filter((r) => r.acceptedAt >= from && r.acceptedAt <= to)
        .length,
      running: all.filter(
        (r) => r.state === "running" || r.state === "stopping",
      ).length,
      queued: all.filter((r) => r.state === "queued").length,
      successRate:
        completed + failed + timedOut
          ? completed / (completed + failed + timedOut)
          : null,
      p50ExecutionMs: percentile(0.5),
      p95ExecutionMs: percentile(0.95),
      resource: {
        ...process.memoryUsage(),
        uptimeSeconds: process.uptime(),
        cpu: process.cpuUsage(),
        eventLoop: performance.eventLoopUtilization(),
        childProcessMemoryBytes: null,
      },
      toolCalls: tools.length,
      toolErrors: tools.filter((t) => t.state === "failed").length,
      tools: [...new Set(tools.map((t) => t.name))].map((name) => ({
        name,
        calls: tools.filter((t) => t.name === name).length,
        failed: tools.filter((t) => t.name === name && t.state === "failed")
          .length,
      })),
      usage: {
        reportedRuns: usage.length,
        missingRuns: runs.length - usage.length,
        costUsd:
          usage.length && usage.every((u) => u.costUsd !== null)
            ? usage.reduce((sum, u) => sum + u.costUsd!, 0)
            : null,
        input:
          usage.length && usage.every((u) => u.input !== null)
            ? usage.reduce((sum, u) => sum + u.input!, 0)
            : null,
        output:
          usage.length && usage.every((u) => u.output !== null)
            ? usage.reduce((sum, u) => sum + u.output!, 0)
            : null,
      },
      pendingInteractions: this.runtime.store
        .list("interactions")
        .filter(
          (i) =>
            sessionIds.has(i.sessionId) &&
            (i.state === "pending" || i.state === "replying"),
        ).length,
      http: {
        requests: sumValues(http.values),
        errors4xx: sumValues(
          http.values.filter((v) => v.labels.status_class === "4xx"),
        ),
        errors5xx: sumValues(
          http.values.filter((v) => v.labels.status_class === "5xx"),
        ),
        scope: "current-instance",
      },
      events: {
        connections: sumValues(connections.values),
        sentBytes: sumValues(sent.values),
        droppedConnections: sumValues(drops.values),
        retained: Number(
          db.prepare("SELECT COUNT(*) AS n FROM events").get()?.n ?? 0,
        ),
        oldestAt:
          db.prepare("SELECT MIN(occurredAt) AS at FROM events").get()?.at ??
          null,
      },
      storage: {
        healthy: this.runtime.store.healthy,
        allocatedBytes:
          Number(db.prepare("PRAGMA page_count").get()?.page_count ?? 0) *
          Number(db.prepare("PRAGMA page_size").get()?.page_size ?? 0),
        sessions: this.runtime.store.list("sessions").length,
        runs: allRuns.length,
      },
      unavailableSessions: sessions.filter(
        (s) => s.availability === "unavailable",
      ).length,
      oldestQueuedAt:
        all
          .filter((r) => !isTerminal(r.state) && r.state === "queued")
          .sort((a, b) => a.acceptedAt.localeCompare(b.acceptedAt))[0]
          ?.acceptedAt ?? null,
    };
  }
  series(metric: string, from: string, to: string, engine = "") {
    const allowed = [
      "rssBytes",
      "heapBytes",
      "activeRuns",
      "queueDepth",
      "completed",
      "failed",
    ] as const;
    if (!allowed.includes(metric as (typeof allowed)[number])) return null;
    const key = metric as (typeof allowed)[number];
    const samples = this.samples.filter(
      (s) =>
        (!engine || Object.hasOwn(s.engines, engine)) &&
        (!engine ||
          this.runtime.adapters.some((adapter) => adapter.id === engine) ||
          !metric.endsWith("Bytes")),
    );
    return {
      metric,
      unit: metric.endsWith("Bytes") ? "bytes" : "count",
      from,
      to,
      availableFrom: samples[0]?.at ?? null,
      availableTo: samples.at(-1)?.at ?? null,
      points: samples
        .filter((s) => s.at >= from && s.at <= to)
        .map((s) => ({
          at: s.at,
          value:
            engine && key !== "rssBytes" && key !== "heapBytes"
              ? s.engines[engine]![key]
              : s[key],
        })),
    };
  }
  close() {
    clearInterval(this.timer);
    this.unsubscribe();
    this.runtime.onFinished = () => {};
    this.registry.clear();
  }
}
