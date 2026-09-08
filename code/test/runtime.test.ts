import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises";
import pino from "pino";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { readConfig } from "../src/config.js";
import { Store } from "../src/storage/sqlite.js";
import { SessionRuntime, within } from "../src/runtime/sessions.js";
import type {
  EngineAdapter,
  EngineBindingResult,
  EngineResult,
  EngineUpdate,
} from "../src/engines/adapter.js";
import type {
  InteractionReply,
  Message,
  Run,
  Session,
} from "../shared/contracts.js";
import { createTaskSchema } from "../shared/contracts.js";
import { transitionRun } from "../src/domain/transitions.js";
import { createServer } from "../src/gateway/server.js";
import { engineError } from "../src/errors.js";
import { SettingsManager } from "../src/settings.js";

function configureAgents(config: ReturnType<typeof readConfig>) {
  const manager = new SettingsManager(config),
    view = manager.view();
  manager.save({
    revision: view.revision,
    settings: {
      ...view.settings,
      providers: ["pi", "opencode"].map((id) => ({
        id,
        baseUrl: "http://127.0.0.1:9/v1",
        models: [{ id: "model" }, { id: "chosen" }],
      })),
      agents: view.settings.agents.map((a) =>
        ["pi", "opencode"].includes(a.id)
          ? {
              ...a,
              enabled: true,
              models: [
                { providerID: a.id, modelID: "model" },
                { providerID: a.id, modelID: "chosen" },
              ],
              defaultModel: { providerID: a.id, modelID: "model" },
            }
          : a,
      ),
    },
  });
}

class ControlledEngine implements EngineAdapter {
  id = "test";
  available = true;
  async models() {
    return [{ providerID: this.id, modelID: "model", name: "Test model" }];
  }
  sessions = new Set<string>();
  starts: string[] = [];
  replies: InteractionReply[] = [];
  stopDelay = 0;
  failures = new Set<string>();
  recovered: string[] = [];
  unavailableSessions() {
    return [...this.failures];
  }
  async recoverSession(session: Session, binding: EngineBindingResult) {
    const id = session.id;
    this.sessions.add(id);
    this.failures.delete(id);
    this.recovered.push(id);
    return { ...binding, processGeneration: 2 };
  }
  executions = new Map<
    string,
    {
      run: Run;
      emit: (event: EngineUpdate) => void;
      resolve: (result: EngineResult) => void;
    }
  >();
  health() {
    return {
      status: this.available ? ("ready" as const) : ("unavailable" as const),
      version: "test",
      message: null,
      processes: this.sessions.size,
      restarts: 0,
    };
  }
  async start() {}
  async createSession(s: Session) {
    this.sessions.add(s.id);
    return { nativeSessionId: randomUUID(), processGeneration: 1 };
  }
  run(
    s: Session,
    run: Run,
    emit: (event: EngineUpdate) => void,
  ): Promise<EngineResult> {
    assert.ok(!this.executions.has(s.id), "same-session execution overlapped");
    this.starts.push(run.id);
    return new Promise((resolve) =>
      this.executions.set(s.id, { run, emit, resolve }),
    );
  }
  complete(sessionId: string) {
    const entry = this.executions.get(sessionId)!;
    const msg: Message = {
      id: randomUUID(),
      sessionId,
      runId: entry.run.id,
      role: "assistant",
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      finishReason: "stop",
      parts: [{ id: randomUUID(), type: "text", text: "finished" }],
    };
    entry.emit({ type: "message", message: msg });
    this.executions.delete(sessionId);
    entry.resolve({ outcome: "completed" });
  }
  async abort(id: string) {
    const entry = this.executions.get(id);
    this.executions.delete(id);
    entry?.resolve({ outcome: "aborted" });
    await delay(this.stopDelay);
  }
  async forceStop(id: string) {
    await this.abort(id);
    return [id];
  }
  async reply(_id: string, reply: InteractionReply) {
    this.replies.push(reply);
    await delay(10);
  }
  async disposeSession(id: string) {
    await this.abort(id);
    this.sessions.delete(id);
  }
  async stop() {
    for (const id of this.sessions) await this.disposeSession(id);
  }
}
async function fixture(
  timeout = 5000,
  additionalAdapters: EngineAdapter[] = [],
) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentbridge-test-"));
  const config = readConfig([], {
    AGENT_LIMITS: JSON.stringify({ runTimeoutMs: timeout }),
    AGENT_DATA_DIR: directory,
  });
  const store = new Store(":memory:");
  configureAgents(config);
  const adapter = new ControlledEngine();
  const runtime = new SessionRuntime(
    store,
    adapter,
    config,
    additionalAdapters,
  );
  await runtime.start();
  return {
    directory,
    config,
    store,
    adapter,
    runtime,
    close: async () => {
      await runtime.stop();
      store.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}
async function until(check: () => boolean) {
  await within(
    (async () => {
      while (!check()) await delay(10);
    })(),
    3000,
  );
}
const input = (directory: string, id = randomUUID()) =>
  createTaskSchema.parse({
    submissionId: id,
    directory,
    parts: [{ type: "text", text: "work" }],
  });

test("gateway shutdown flushes final logs even when the transport ready flag is stale", async () => {
  const f = await fixture();
  const server = createServer(f.runtime);
  const transport = (server.log as unknown as Record<symbol, { ready: boolean; closed: boolean; end(): void; [key: symbol]: { ready: boolean } }>)[pino.symbols.streamSym]!;
  try {
    await server.ready();
    await until(() => transport.ready);
    // Reproduce thread-stream's READY race after its reader has advanced past the initial write index.
    const implementation = Object.getOwnPropertySymbols(transport).find((symbol) => String(symbol) === "Symbol(kImpl)")!;
    transport[implementation]!.ready = false;
    server.log.info("shutdown-final-record");
    await within(server.close(), 3000);
    const files = await readdir(path.join(f.directory, "logs"));
    const logs = await Promise.all(files.map((file) => readFile(path.join(f.directory, "logs", file), "utf8")));
    assert.ok(logs.some((log) => log.includes("shutdown-final-record")));
    assert.equal(transport.closed, true);
  } finally {
    if (!transport.closed) transport.end();
    await within(server.close(), 3000);
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("runtime switching drains the target Agent, blocks new work and restores its sessions after rollback", async () => {
  const otherEngine = new ControlledEngine();
  otherEngine.id = "opencode";
  const f = await fixture(10000, [otherEngine]);
  f.adapter.id = "pi";
  try {
    await f.runtime.agentAction("pi", "enable");
    await until(() => !f.runtime.agentViews().find((agent) => agent.id === "pi")!.operation);
    const active = await f.runtime.submit({ ...input(f.directory), engineId: "pi" });
    await until(() => f.adapter.executions.has(active.sessionId));
    const queued = await f.runtime.submit({ submissionId: randomUUID(), parts: [{ type: "text", text: "queued" }] }, active.sessionId);
    const other = await f.runtime.submit({ ...input(f.directory), engineId: "opencode" });
    await until(() => otherEngine.executions.has(other.sessionId));
    let activated = false;
    let rolledBack = false;
    const switching = (f.runtime as unknown as {
      switchRuntime(id: "pi", activate: () => Promise<void>, rollback: () => Promise<void>, uninstall: boolean): Promise<void>;
    }).switchRuntime("pi", async () => {
      activated = true;
      assert.ok(!f.adapter.executions.has(active.sessionId));
      throw new Error("candidate failed to activate");
    }, async () => { rolledBack = true; }, false);
    const rejected = assert.rejects(switching, /candidate failed to activate/);
    await until(() => f.runtime.run(queued.runId).state === "cancelled");
    assert.equal(activated, false);
    assert.throws(() => f.runtime.submit({ ...input(f.directory), engineId: "pi" }), /disabled or applying/);
    assert.ok(otherEngine.executions.has(other.sessionId));
    f.adapter.complete(active.sessionId);
    await rejected;
    assert.equal(rolledBack, true);
    assert.equal(f.runtime.session(active.sessionId).availability, "ready");
    assert.ok(f.adapter.recovered.includes(active.sessionId));
    assert.ok(otherEngine.executions.has(other.sessionId));
    assert.equal(f.runtime.agentViews().find((agent) => agent.id === "pi")!.operation, null);
    otherEngine.complete(other.sessionId);
  } finally {
    await f.close();
  }
});

test("Agent lifecycle drains active work, cancels queues, applies revisions and preserves other agents", async () => {
  const second = new ControlledEngine();
  second.id = "opencode";
  const f = await fixture(10000, [second]);
  f.adapter.id = "pi";
  try {
    await f.runtime.agentAction("pi", "enable");
    await until(
      () => !f.runtime.agentViews().find((a) => a.id === "pi")!.operation,
    );
    const firstRevision = f.runtime
      .agentViews()
      .find((a) => a.id === "pi")!.appliedRevision;
    assert.ok(firstRevision);
    const active = await f.runtime.submit({
      ...input(f.directory),
      engineId: "pi",
    });
    await until(() => f.adapter.executions.has(active.sessionId));
    const queued = await f.runtime.submit(
      { submissionId: randomUUID(), parts: [{ type: "text", text: "queued" }] },
      active.sessionId,
    );
    const other = await f.runtime.submit({
      ...input(f.directory),
      engineId: "opencode",
    });
    await until(() => second.executions.has(other.sessionId));
    const saved = f.runtime.settings.view();
    saved.settings.providers.find((p) => p.id === "pi")!.baseUrl =
      "http://127.0.0.1:10/v1";
    saved.settings.providers.find((p) => p.id === "pi")!.models[0]!.id =
      "replacement";
    const nextAgent = saved.settings.agents.find((a) => a.id === "pi")!;
    nextAgent.models = [{ providerID: "pi", modelID: "replacement" }];
    nextAgent.defaultModel = nextAgent.models[0]!;
    f.runtime.saveSettings({
      settings: saved.settings,
      revision: saved.revision,
    });
    assert.equal(f.runtime.run(active.runId).configRevision, firstRevision);
    assert.equal(
      f.runtime.agentViews().find((a) => a.id === "pi")!.pendingChanges,
      true,
    );
    await f.runtime.agentAction("pi", "apply");
    await until(() => f.runtime.run(queued.runId).state === "cancelled");
    assert.equal(f.runtime.run(active.runId).state, "running");
    assert.throws(
      () => f.runtime.submit({ ...input(f.directory), engineId: "pi" }),
      /disabled or applying/,
    );
    assert.throws(
      () =>
        f.runtime.saveSettings({
          settings: saved.settings,
          revision: saved.revision,
        }),
      /Wait for Agent/,
    );
    f.adapter.complete(active.sessionId);
    await until(
      () => !f.runtime.agentViews().find((a) => a.id === "pi")!.operation,
    );
    const applied = f.runtime.agentViews().find((a) => a.id === "pi")!;
    assert.notEqual(applied.appliedRevision, firstRevision);
    assert.equal(applied.pendingChanges, false);
    assert.equal(f.runtime.run(other.runId).state, "running");
    await until(
      () => f.runtime.session(active.sessionId).availability === "ready",
    );
    const followup = await f.runtime.submit(
      {
        submissionId: randomUUID(),
        parts: [{ type: "text", text: "continue" }],
      },
      active.sessionId,
    );
    await until(() => f.adapter.executions.has(active.sessionId));
    await f.runtime.agentAction("pi", "disable");
    assert.equal(f.runtime.run(followup.runId).model?.modelID, "replacement");
    assert.equal(f.runtime.run(followup.runId).state, "running");
    f.adapter.complete(active.sessionId);
    await until(
      () => !f.runtime.agentViews().find((a) => a.id === "pi")!.operation,
    );
    assert.equal(f.runtime.agentHealth("pi").status, "disabled");
    assert.equal(f.adapter.sessions.size, 0);
    await delay(250);
    assert.equal(f.adapter.sessions.size, 0);
    second.complete(other.sessionId);
  } finally {
    await f.close();
  }
});

test("Agent immediate stop aborts work; failed enable stays unavailable until an explicit retry", async () => {
  const f = await fixture();
  f.adapter.id = "pi";
  try {
    const active = await f.runtime.submit({
      ...input(f.directory),
      engineId: "pi",
    });
    await until(() => f.adapter.executions.has(active.sessionId));
    await f.runtime.agentAction("pi", "stop");
    await until(
      () => !f.runtime.agentViews().find((a) => a.id === "pi")!.operation,
    );
    assert.equal(f.runtime.run(active.runId).state, "cancelled");
    f.adapter.start = async () => {
      throw new Error("fixture start failure");
    };
    await f.runtime.agentAction("pi", "enable");
    await until(
      () => !f.runtime.agentViews().find((a) => a.id === "pi")!.operation,
    );
    assert.equal(f.runtime.agentHealth("pi").status, "unavailable");
    assert.match(
      f.runtime.agentViews().find((a) => a.id === "pi")!.error!,
      /fixture start failure/,
    );
    assert.throws(
      () => f.runtime.submit({ ...input(f.directory), engineId: "pi" }),
      /unavailable|disabled|applying/,
    );
    f.adapter.start = async () => {};
    await f.runtime.agentAction("pi", "enable");
    await until(() => f.runtime.agentHealth("pi").status === "ready");
    assert.equal(
      f.runtime.agentViews().find((a) => a.id === "pi")!.error,
      null,
    );
  } finally {
    await f.close();
  }
});

test("artifact inventory warnings retain the filesystem cause without failing the model run", async () => {
  const f = await fixture();
  try {
    const session = await f.runtime.createSession({ directory: f.directory });
    await rm(f.directory, { recursive: true });
    const accepted = await f.runtime.submit(input(f.directory), session.id);
    await until(() => f.adapter.executions.has(session.id));
    const log = f.store.db
      .prepare(
        "SELECT message,level FROM runtime_logs WHERE runId=? AND code='DISCOVERY_FAILED'",
      )
      .get(accepted.runId);
    assert.equal(log?.level, "warn");
    assert.match(String(log?.message), /ENOENT/);
    assert.ok(String(log?.message).includes(f.directory));
    f.adapter.complete(session.id);
    assert.equal((await f.runtime.wait(accepted.runId)).state, "completed");
  } finally {
    await f.close();
  }
});

test("engine Error messages survive database and JSON serialization", async () => {
  const f = await fixture();
  try {
    const accepted = await f.runtime.submit(input(f.directory));
    await until(() => f.adapter.executions.has(accepted.sessionId));
    f.adapter.executions.get(accepted.sessionId)!.resolve({
      outcome: "failed",
      error: engineError("Provider refused request", {
        statusCode: 401,
        message: "invalid credentials",
      }),
    });
    await f.runtime.wait(accepted.runId);
    const persisted = JSON.parse(JSON.stringify(f.runtime.run(accepted.runId)));
    assert.deepEqual(persisted.error, {
      code: "BAD_GATEWAY",
      message: "Provider refused request: 401: invalid credentials",
      stage: "engine",
    });
    const event = f.store.db
      .prepare("SELECT data FROM events WHERE runId=? AND type='run.finished'")
      .get(accepted.runId);
    assert.deepEqual(JSON.parse(String(event?.data)).error, persisted.error);
  } finally {
    await f.close();
  }
});

test("task engines route models, follow-ups, approvals, cancellation and recovery independently", async () => {
  const second = new ControlledEngine();
  second.id = "opencode";
  const f = await fixture(10000, [second]);
  f.adapter.id = "pi";
  const server = createServer(f.runtime);
  await server.listen({ host: "127.0.0.1", port: 0 });
  try {
    const info = (await server.inject("/api/runtime")).json();
    assert.deepEqual(
      info.engines.map((engine: { id: string }) => engine.id),
      ["pi", "opencode"],
    );
    for (const engineId of ["pi", "opencode"] as const) {
      const catalog = (
        await server.inject(`/api/engines/${engineId}/models`)
      ).json();
      assert.equal(catalog.models[0].providerID, engineId);
    }
    assert.equal(
      (await server.inject("/api/engines/unknown/models")).statusCode,
      400,
    );
    assert.ok(
      (
        await server.inject("/api/observability/overview?engine=opencode")
      ).json().health,
    );
    const allAgents = (await server.inject("/api/observability/overview")).json();
    assert.equal(allAgents.health, null, "An aggregate cannot claim the default Agent health");
    assert.deepEqual(allAgents.agents.map((agent: { id: string }) => agent.id), ["pi", "opencode"]);
    assert.ok(
      (
        await server.inject(
          "/api/observability/series?engine=opencode&metric=rssBytes",
        )
      ).json().points.length,
    );
    const a = await f.runtime.submit({
      ...input(f.directory),
      engineId: "pi",
      model: { providerID: "pi", modelID: "chosen" },
    });
    const b = await f.runtime.submit({
      ...input(f.directory),
      engineId: "opencode",
    });
    await until(
      () =>
        f.adapter.executions.has(a.sessionId) &&
        second.executions.has(b.sessionId),
    );
    assert.equal(f.runtime.session(b.sessionId).engineId, "opencode");
    assert.equal(f.adapter.executions.has(b.sessionId), false);
    const interactionId = randomUUID();
    second.executions.get(b.sessionId)!.emit({
      type: "interaction",
      interaction: {
        id: interactionId,
        sessionId: b.sessionId,
        runId: b.runId,
        kind: "permission",
        title: "Approve",
        questions: [],
        state: "pending",
        policy: "manual",
        createdAt: new Date().toISOString(),
        resolvedAt: null,
        reply: null,
        error: null,
      },
    });
    await f.runtime.reply(interactionId, { decision: "once" });
    assert.equal(second.replies.length, 1);
    assert.equal(f.adapter.replies.length, 0);
    await f.runtime.cancel(b.sessionId);
    assert.equal(f.runtime.run(b.runId).state, "cancelled");
    assert.ok(f.adapter.executions.has(a.sessionId));
    f.adapter.complete(a.sessionId);
    await f.runtime.wait(a.runId);
    const next = await f.runtime.submit(
      {
        submissionId: randomUUID(),
        parts: [{ type: "text", text: "follow up" }],
      },
      a.sessionId,
    );
    assert.deepEqual(f.runtime.run(next.runId).model, {
      providerID: "pi",
      modelID: "chosen",
    });
    await until(() => f.adapter.executions.has(a.sessionId));
    second.failures.add(b.sessionId);
    await until(() => second.recovered.includes(b.sessionId));
    assert.equal(f.adapter.recovered.length, 0);
    assert.equal(f.runtime.run(next.runId).state, "running");
    second.available = false;
    assert.equal(
      (await server.inject("/api/engines/opencode/models")).statusCode,
      503,
    );
    assert.throws(
      () => f.runtime.submit({ ...input(f.directory), engineId: "opencode" }),
      /not ready/,
    );
    f.adapter.complete(a.sessionId);
    await f.runtime.wait(next.runId);
    await f.runtime.deleteSession(b.sessionId);
    assert.equal(second.sessions.size, 0);
    assert.equal(f.adapter.sessions.size, 1);
  } finally {
    await within(server.close(), 3000);
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("observability isolates engine outcomes, tools, logs and samples", async () => {
  const f = await fixture();
  let server: ReturnType<typeof createServer> | undefined;
  try {
    for (const engine of ["pi", "opencode", "opencode"]) {
      f.adapter.id = engine;
      const result = await f.runtime.submit(input(f.directory));
      await until(() => f.adapter.executions.has(result.taskId));
      f.adapter.complete(result.taskId);
      await until(() => f.runtime.run(result.runId).state === "completed");
      const at = new Date().toISOString();
      f.store.transaction(() =>
        f.store.saveMessage({
          id: randomUUID(),
          sessionId: result.taskId,
          runId: result.runId,
          role: "assistant",
          createdAt: at,
          completedAt: at,
          finishReason: "stop",
          parts: [
            {
              id: randomUUID(),
              type: "tool",
              toolCallId: randomUUID(),
              name: `${engine}-tool`,
              input: {},
              output: "ok",
              state: "completed",
              startedAt: at,
              finishedAt: at,
            },
          ],
        }),
      );
      f.store.db
        .prepare(
          "INSERT INTO runtime_logs(occurredAt,level,stage,code,message,runId) VALUES (?,'error','engine','QA',?,?)",
        )
        .run(at, engine, result.runId);
    }
    f.adapter.id = "pi";
    f.store.db
      .prepare(
        "INSERT INTO runtime_logs(occurredAt,level,stage,code,message) VALUES (?,'error','gateway','QA','global')",
      )
      .run(new Date().toISOString());
    server = createServer(f.runtime);
    await server.listen({ host: "127.0.0.1", port: 0 });
    try {
      for (const [engine, count] of [
        ["pi", 1],
        ["opencode", 2],
        ["", 3],
        ["absent", 0],
      ] as const) {
        const response = await server.inject(
          `/api/observability/overview?engine=${engine}`,
        );
        assert.equal(response.statusCode, 200);
        const overview = response.json();
        assert.equal(overview.completed, count);
        assert.equal(overview.accepted, count);
        assert.equal(overview.toolCalls, count);
        assert.equal(overview.usage.missingRuns, count);
        assert.equal(overview.storage.runs, 3, "storage is instance-wide");
        if (engine === "opencode" || engine === "absent")
          assert.equal(overview.health, null);
        const errors = (
          await server.inject(
            `/api/observability/errors?engine=${engine}&code=QA`,
          )
        ).json();
        assert.equal(errors.items.length, engine ? count : count + 1);
        if (engine)
          assert.ok(
            errors.items.every(
              (log: { message: string }) => log.message === engine,
            ),
          );
        const series = (
          await server.inject(
            `/api/observability/series?engine=${engine}&metric=completed`,
          )
        ).json();
        if (engine === "absent") assert.deepEqual(series.points, []);
        else assert.equal(series.points.at(-1).value, count);
      }
      assert.deepEqual(
        (
          await server.inject(
            "/api/observability/series?engine=constructor&metric=completed",
          )
        ).json().points,
        [],
      );
      assert.deepEqual(
        (
          await server.inject(
            "/api/observability/series?engine=opencode&metric=rssBytes",
          )
        ).json().points,
        [],
      );
      assert.equal(
        (await server.inject("/api/observability/overview?engine=%27"))
          .statusCode,
        400,
      );
      assert.equal(
        (
          await server.inject(
            "/api/observability/series?engine=pi&metric=invalid",
          )
        ).statusCode,
        400,
      );
    } finally {
      await within(server.close(), 2000);
    }
  } finally {
    if (server) await rm(f.directory, { recursive: true, force: true });
    else await f.close();
  }
});

test("pnpm workspace configuration and engine precedence", () => {
  assert.equal(
    readConfig(["--engine", "pi"], { AGENT_ENGINE: "opencode" }).engine,
    "pi",
  );
  assert.throws(() => readConfig(["--engine", "invalid"], {}));
  assert.throws(() =>
    createTaskSchema.parse({ ...input("/tmp"), extra: true }),
  );
});
test("transaction rollback publishes no events and does not notify completion observers", () => {
  const store = new Store(":memory:");
  let notifications = 0;
  store.subscribe(() => notifications++);
  assert.throws(() =>
    store.transaction(() => {
      store.emit({ type: "test", data: {} });
      store.afterCommit(() => notifications++);
      throw new Error("rollback");
    }),
  );
  assert.equal(notifications, 0);
  assert.equal(store.snapshot().revision, 0);
  assert.deepEqual(store.replay(`${store.storeId}:0`), []);
  store.close();
});
test("event replay storage is bounded by bytes as well as record count", () => {
  const store = new Store(":memory:", 2000);
  for (let index = 0; index < 10; index++)
    store.transaction(() =>
      store.emit({ type: "test", data: { text: "x".repeat(800) } }),
    );
  assert.ok(Number(store.meta("eventBytes")) <= 2000);
  assert.equal(store.replay(`${store.storeId}:0`), null);
  assert.ok(
    (store.db.prepare("SELECT COUNT(*) AS n FROM events").get()!.n as number) <
      10,
  );
  store.close();
});
test("SQLite lock excludes another gateway and committed history survives reopen", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agentbridge-db-"));
  const filename = path.join(dir, "test.sqlite");
  const store = new Store(filename);
  const id = store.storeId;
  store.transaction(() =>
    store.emit({ type: "test", data: { durable: true } }),
  );
  assert.throws(() => new Store(filename));
  store.close();
  const reopened = new Store(filename);
  assert.equal(reopened.storeId, id);
  assert.equal(reopened.replay(`${id}:0`)?.length, 1);
  reopened.close();
  await rm(dir, { recursive: true, force: true });
});
test("idempotent concurrent creates produce one session/run; a changed payload conflicts", async () => {
  const f = await fixture();
  try {
    const request = input(f.directory);
    const [a, b] = await Promise.all([
      f.runtime.submit(request),
      f.runtime.submit(request),
    ]);
    assert.deepEqual(a, b);
    assert.equal(f.store.list("sessions").length, 1);
    assert.equal(f.store.list("runs").length, 1);
    await assert.rejects(
      f.runtime.submit({ ...request, title: "changed" }),
      /different input/,
    );
  } finally {
    await f.close();
  }
});
test("same session runs serially and successful snapshots have a final assistant step", async () => {
  const f = await fixture();
  try {
    const a = await f.runtime.submit(input(f.directory));
    const b = await f.runtime.submit(
      { submissionId: randomUUID(), parts: [{ type: "text", text: "second" }] },
      a.sessionId,
    );
    await until(() => f.adapter.starts.length === 1);
    assert.equal(f.runtime.run(b.runId).state, "queued");
    f.adapter.complete(a.sessionId);
    assert.equal((await f.runtime.wait(a.runId)).state, "completed");
    await until(() => f.adapter.starts.length === 2);
    f.adapter.complete(a.sessionId);
    await f.runtime.wait(b.runId);
    const last = f.store.messages(a.sessionId).at(-1)!;
    assert.equal(last.role, "assistant");
    assert.equal(last.finishReason, "stop");
    assert.ok(last.parts.some((p) => p.type === "step-finish"));
    assert.throws(() =>
      transitionRun(f.runtime.run(a.runId), "failed", new Date().toISOString()),
    );
  } finally {
    await f.close();
  }
});
test("cancel confirms stopping before resource reuse and cancels queued work", async () => {
  const f = await fixture();
  f.adapter.stopDelay = 150;
  try {
    const a = await f.runtime.submit(input(f.directory));
    await until(() => f.adapter.starts.length === 1);
    const b = await f.runtime.submit(
      { submissionId: randomUUID(), parts: [{ type: "text", text: "queued" }] },
      a.sessionId,
    );
    const stopping = f.runtime.cancel(a.sessionId);
    assert.equal(f.runtime.run(a.runId).state, "stopping");
    await delay(120);
    assert.equal(f.adapter.starts.length, 1);
    assert.equal(f.runtime.run(b.runId).state, "cancelled");
    await stopping;
    assert.equal(f.runtime.run(a.runId).state, "cancelled");
    assert.ok(f.store.healthy);
  } finally {
    await f.close();
  }
});
test("deadline times out an execution without reporting success", async () => {
  const f = await fixture(250);
  try {
    const a = await f.runtime.submit(input(f.directory));
    const result = await within(f.runtime.wait(a.runId), 2000);
    assert.equal(result.state, "timed_out");
  } finally {
    await f.close();
  }
});
test("delete removes replayed content, keeps submission tombstone and user directory", async () => {
  const f = await fixture();
  try {
    const request = input(f.directory);
    const a = await f.runtime.submit(request);
    await until(() => f.adapter.starts.length === 1);
    f.adapter.complete(a.sessionId);
    await f.runtime.wait(a.runId);
    const cursor = `${f.store.storeId}:0`;
    await f.runtime.deleteSession(a.sessionId);
    assert.equal(f.store.list("sessions").length, 0);
    assert.equal(f.store.replay(cursor), null);
    await assert.rejects(f.runtime.submit(request), /deleted/);
  } finally {
    await f.close();
  }
});

test("HTTP contract, SSE completion, metrics and graceful stream shutdown", async () => {
  const f = await fixture();
  const server = createServer(f.runtime);
  await server.listen({ host: "127.0.0.1", port: 0 });
  const address = server.server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const invalid = await server.inject({
      method: "POST",
      url: "/session",
      headers: { "content-type": "application/json" },
      payload: "{",
    });
    assert.equal(invalid.statusCode, 400);
    assert.equal(
      (
        await server.inject({
          method: "POST",
          url: "/session",
          headers: { origin: "https://untrusted.example" },
          payload: { directory: f.directory },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await server.inject({
          url: "/api/runtime",
          headers: { host: "untrusted.example" },
        })
      ).statusCode,
      403,
    );
    assert.equal(invalid.json().code, "VALIDATION_ERROR");
    const unsupported = await server.inject({
      method: "POST",
      url: "/session",
      headers: { "content-type": "application/octet-stream" },
      payload: Buffer.from("invalid"),
    });
    assert.equal(unsupported.statusCode, 415);
    assert.equal(unsupported.json().code, "VALIDATION_ERROR");
    const stream = await fetch(`${base}/event`);
    const reader = stream.body!.getReader();
    const decoder = new TextDecoder();
    let events = "";
    const reading = (async () => {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) return;
        events += decoder.decode(chunk.value, { stream: true });
      }
    })();
    await until(() => events.includes("server.connected"));
    const session = await server.inject({
      method: "POST",
      url: "/session",
      payload: { directory: f.directory, title: "contract" },
    });
    assert.equal(session.statusCode, 200);
    const id = session.json().id;
    const statuses = await server.inject("/session/status");
    assert.equal(statuses.json()[id].type, "idle");
    const prompting = server.inject({
      method: "POST",
      url: `/session/${id}/prompt_async`,
      payload: { parts: [{ type: "text", text: "work" }] },
    });
    await until(() => f.adapter.executions.has(id));
    const filename = path.join(f.directory, "report.md");
    await writeFile(filename, "original report");
    f.adapter.complete(id);
    assert.equal((await prompting).statusCode, 204);
    await until(
      () => events.includes("step-finish") && events.includes("session.idle"),
    );
    const messages = (await server.inject(`/session/${id}/message`)).json();
    assert.equal(messages.at(-1).info.finish, "stop");
    assert.ok(
      messages
        .at(-1)
        .parts.some((p: { type: string }) => p.type === "step-finish"),
    );
    const overview = (
      await server.inject("/api/observability/overview")
    ).json();
    assert.equal(overview.completed, 1);
    assert.equal(overview.usage.input, null);
    const artifact = f.store.list("artifacts")[0]!;
    const download = `/api/artifacts/${artifact.id}/content`;
    assert.equal((await server.inject(download)).body, "original report");
    await writeFile(filename, "modified report");
    assert.equal((await server.inject(download)).statusCode, 409);
    await rm(filename);
    assert.equal((await server.inject(download)).statusCode, 404);
    const metrics = await server.inject("/metrics");
    assert.match(
      metrics.body,
      /agentbridge_runs_finished_total\{outcome="completed"\} 1/,
    );
    assert.equal(
      (await server.inject({ method: "DELETE", url: `/session/${id}` }))
        .statusCode,
      200,
    );
    assert.equal((await server.inject(`/session/${id}`)).statusCode, 404);
    await within(server.close(), 2000);
    await within(reading, 2000);
  } finally {
    await server.close();
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("legacy databases are rejected without changing stored rows", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bridge-legacy-"));
  const file = path.join(directory, "state.sqlite");
  try {
    const old = new DatabaseSync(file);
    old.exec(
      "CREATE TABLE runs (id TEXT); INSERT INTO runs VALUES ('keep'); PRAGMA user_version=1;",
    );
    old.close();
    assert.throws(() => new Store(file), /Unsupported legacy database/);
    const preserved = new DatabaseSync(file);
    try {
      assert.equal(preserved.prepare("SELECT id FROM runs").get()?.id, "keep");
    } finally {
      preserved.close();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("message snapshots cannot overwrite another run's parts", async () => {
  const f = await fixture();
  try {
    const first = await f.runtime.submit(input(f.directory));
    await until(() => f.adapter.executions.has(first.sessionId));
    f.adapter.complete(first.sessionId);
    await f.runtime.wait(first.runId);
    const message = f.store.messages(first.sessionId).at(-1)!;
    assert.throws(
      () =>
        f.store.transaction(() =>
          f.store.saveMessage({ ...message, id: randomUUID() }),
        ),
      /ownership/,
    );
    f.store.transaction(() => f.store.saveMessage({ ...message, parts: [] }));
    assert.equal(f.store.messages(first.sessionId).at(-1)!.parts.length, 0);
  } finally {
    await f.close();
  }
});

test("native failure recovery never replays a previously accepted execution", async () => {
  const f = await fixture();
  try {
    const first = await f.runtime.submit(input(f.directory));
    await until(() => f.adapter.executions.has(first.sessionId));
    f.adapter.failures.add(first.sessionId);
    assert.equal(
      (await within(f.runtime.wait(first.runId), 3000)).state,
      "failed",
    );
    await until(() => f.adapter.recovered.length === 1);
    assert.equal(f.runtime.session(first.sessionId).availability, "ready");
    assert.deepEqual(f.adapter.starts, [first.runId]);
    const next = await f.runtime.submit(
      {
        submissionId: randomUUID(),
        parts: [{ type: "text", text: "new instruction" }],
      },
      first.sessionId,
    );
    await until(() => f.adapter.executions.has(first.sessionId));
    f.adapter.complete(first.sessionId);
    assert.equal((await f.runtime.wait(next.runId)).state, "completed");
    assert.equal(f.runtime.run(first.runId).state, "failed");
  } finally {
    await f.close();
  }
});

test("gateway restart rebuilds both engines from durable bindings without replaying runs", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bridge-recovery-"));
  const config = readConfig([], { AGENT_DATA_DIR: directory });
  configureAgents(config);
  const engines = () =>
    ["pi", "opencode"].map((id) => {
      const engine = new ControlledEngine();
      engine.id = id;
      return engine;
    });
  let adapters = engines();
  let store = new Store(config.database);
  let runtime = new SessionRuntime(store, adapters[0]!, config, [adapters[1]!]);
  try {
    await runtime.start();
    const originals = [];
    for (const adapter of adapters) {
      const accepted = await runtime.submit({
        ...input(directory),
        engineId: adapter.id as "pi" | "opencode",
      });
      await until(() => adapter.executions.has(accepted.sessionId));
      adapter.complete(accepted.sessionId);
      await runtime.wait(accepted.runId);
      originals.push({
        ...accepted,
        nativeId: store.db
          .prepare(
            "SELECT nativeSessionId FROM engine_bindings WHERE sessionId=?",
          )
          .get(accepted.sessionId)!.nativeSessionId,
      });
    }
    const missing = await runtime.createSession({ directory, engineId: "pi" });
    const mismatch = await runtime.createSession({
      directory,
      engineId: "opencode",
    });
    await runtime.stop();
    store.db
      .prepare("DELETE FROM engine_bindings WHERE sessionId=?")
      .run(missing.id);
    store.db
      .prepare("UPDATE engine_bindings SET directory=? WHERE sessionId=?")
      .run(path.join(directory, "wrong"), mismatch.id);
    const interrupted = {
      ...runtime.run(originals[0]!.runId),
      id: randomUUID(),
      sequence: 2,
      state: "running" as const,
      finishedAt: null,
    };
    store.transaction(() => store.put("runs", interrupted));
    const previousInstance = store.instanceId;
    store.close();
    adapters = engines();
    store = new Store(config.database);
    runtime = new SessionRuntime(store, adapters[0]!, config, [adapters[1]!]);
    await runtime.start();
    await until(() =>
      originals.every(
        (item) => runtime.session(item.sessionId).availability === "ready",
      ),
    );
    assert.notEqual(store.instanceId, previousInstance);
    assert.equal(runtime.run(interrupted.id).error?.code, "GATEWAY_RESTARTED");
    assert.equal(runtime.run(interrupted.id).state, "failed");
    assert.equal(runtime.session(missing.id).availability, "unavailable");
    assert.equal(runtime.session(mismatch.id).availability, "unavailable");
    for (const [index, original] of originals.entries()) {
      const adapter = adapters[index]!;
      assert.deepEqual(adapter.starts, []);
      assert.deepEqual(adapter.recovered, [original.sessionId]);
      assert.equal(runtime.run(original.runId).state, "completed");
      const binding = store.db
        .prepare("SELECT * FROM engine_bindings WHERE sessionId=?")
        .get(original.sessionId)!;
      assert.equal(binding.nativeSessionId, original.nativeId);
      assert.equal(binding.instanceId, store.instanceId);
      assert.equal(binding.processGeneration, 2);
      const next = await runtime.submit(
        {
          submissionId: randomUUID(),
          parts: [{ type: "text", text: "continue" }],
        },
        original.sessionId,
      );
      await until(() => adapter.executions.has(original.sessionId));
      adapter.complete(original.sessionId);
      assert.equal((await runtime.wait(next.runId)).state, "completed");
    }
  } finally {
    await runtime.stop();
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
