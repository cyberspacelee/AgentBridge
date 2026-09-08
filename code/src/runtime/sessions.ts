import { createHash, randomUUID } from "node:crypto";
import type {
  AcceptedRun,
  CreateTaskInput,
  Failure,
  Interaction,
  InteractionReply,
  Message,
  PromptInput,
  Run,
  RunOutcome,
  Session,
  Submission,
  SubmitRunInput,
  TaskDetail,
  TaskSummary,
} from "../../shared/contracts.js";
import type { Config } from "../config.js";
import {
  isTerminal,
  taskStatus,
  transitionRun,
} from "../domain/transitions.js";
import type {
  EngineAdapter,
  EngineResult,
  EngineUpdate,
} from "../engines/adapter.js";
import {
  asGatewayError,
  engineError,
  errorDetail,
  GatewayError,
} from "../errors.js";
import {
  diagnosticSecrets,
  SettingsManager,
  readSettings,
  agentConfiguration,
  agentRevision,
  agentDirectory,
  agentConfigFile,
  applyAgentConfiguration,
  configuredModels,
  effectiveSettings,
} from "../settings.js";
import {
  agentIdSchema,
  type AgentId,
  type AgentView,
} from "../../shared/settings.js";
import { setTimeout as delay } from "node:timers/promises";
import { Store } from "../storage/sqlite.js";
import {
  discoverFiles,
  registerChangedFiles,
  validateDirectory,
} from "./artifacts.js";
import { within } from "../async.js";
import { RuntimeManager } from "./runtimes.js";
export { within } from "../async.js";

const now = () => new Date().toISOString();
interface Execution {
  done: Promise<void>;
  resolve: () => void;
  stopping?: Promise<void>;
}

export class SessionRuntime {
  readonly settings: SettingsManager;
  readonly runtimes: RuntimeManager;
  private agentOperations = new Map<
    string,
    { action: AgentView["operation"]; promise: Promise<void> }
  >();
  private appliedRevisions = new Map<string, string>();
  private agentErrors = new Map<string, string>();
  private active = new Map<string, Execution>();
  private submissions = new Map<string, Promise<AcceptedRun>>();
  private deleting = new Map<string, Promise<void>>();
  private creating = 0;
  private closed = false;
  private tick?: NodeJS.Timeout;
  private waiting = new Map<string, Set<(run: Run) => void>>();
  private isolations = new Map<string, Promise<void>>();
  private recovery = new Map<
    string,
    { pending?: Promise<void>; attempts: number; at: number }
  >();
  private maintenance?: NodeJS.Timeout;
  private repairs = new Map<string, Promise<void>>();
  private repairAttempts = new Map<string, number>();
  onFinished: (run: Run) => void = () => {};
  onLog: (entry: {
    level: string;
    stage: string;
    code: string;
    message: string;
    sessionId?: string;
    runId?: string;
  }) => void = () => {};

  constructor(
    readonly store: Store,
    readonly adapter: EngineAdapter,
    readonly config: Config,
    private additionalAdapters: EngineAdapter[] = [],
  ) {
    this.settings = new SettingsManager(config);
    this.runtimes = new RuntimeManager(config, {
      runningVersion: (id) => this.adapters.find((a) => a.id === id)?.health().status === "ready" && this.agentEnabled(id) ? this.engine(id).health().version : null,
      snapshotBindings: (id) => this.store.db.prepare("SELECT sessionId,nativeSessionId,processGeneration,instanceId FROM engine_bindings WHERE engineId=?").all(id).map((binding) => ({ sessionId: String(binding.sessionId), nativeSessionId: String(binding.nativeSessionId), processGeneration: Number(binding.processGeneration), instanceId: String(binding.instanceId) })),
      restoreBindings: (id, bindings) => this.store.transaction(() => { for (const binding of bindings) this.store.db.prepare("UPDATE engine_bindings SET nativeSessionId=?,processGeneration=?,instanceId=? WHERE sessionId=? AND engineId=?").run(binding.nativeSessionId, binding.processGeneration, binding.instanceId, binding.sessionId, id); }),
      switch: (id, activate, rollback, uninstall) => this.switchRuntime(id, activate, rollback, uninstall),
    });
  }

  agentEnabled(id: string) {
    return (
      this.runtimes.installed(id) &&
      (
      agentConfiguration(this.config, id, readSettings(this.config))?.enabled ??
      true
      )
    );
  }
  agentHealth(id: string) {
    const health = this.engine(id).health();
    if (this.agentOperations.has(id))
      return { ...health, status: "stopping" as const };
    if (!this.agentEnabled(id))
      return { ...health, status: "disabled" as const };
    if (this.agentErrors.has(id))
      return {
        ...health,
        status: "unavailable" as const,
        message: this.agentErrors.get(id)!,
      };
    return health;
  }
  agentViews(): AgentView[] {
    const settings = readSettings(this.config);
    return settings.agents
      .filter((a) => this.adapters.some((adapter) => adapter.id === a.id))
      .map((a) => {
        const savedRevision = agentRevision(this.config, a.id, settings);
        const appliedRevision = this.appliedRevisions.get(a.id) ?? null;
        const runs = this.store
          .list("runs")
          .filter(
            (r) => this.store.get("sessions", r.sessionId)?.engineId === a.id,
          );
        return {
          id: a.id,
          enabled: a.enabled,
          health: this.agentHealth(a.id),
          directory: agentDirectory(this.config, a.id),
          configFile: agentConfigFile(this.config, a.id),
          savedRevision,
          appliedRevision,
          pendingChanges: savedRevision !== appliedRevision,
          operation: this.agentOperations.get(a.id)?.action ?? null,
          error: this.agentErrors.get(a.id) ?? null,
          activeRuns: runs.filter(
            (r) => r.state === "running" || r.state === "stopping",
          ).length,
          queuedRuns: runs.filter((r) => r.state === "queued").length,
          models: configuredModels(this.config, a.id),
          capabilities: this.engine(a.id).capabilities?.() ?? {
            permissions: true,
            questions: true,
            recovery: true,
          },
        };
      });
  }
  private publishAgents() {
    this.store.transaction(() =>
      this.store.emit({ type: "agents.updated", data: this.agentViews() }),
    );
  }
  saveSettings(input: unknown) {
    if (this.closed || this.agentOperations.size)
      throw new GatewayError(
        "CONFLICT",
        "Wait for Agent operations before saving configuration",
        409,
      );
    const before = readSettings(this.config);
    const view = this.settings.save(input);
    for (const agent of view.settings.agents)
      if (
        before.agents.find((a) => a.id === agent.id)?.enabled !==
          agent.enabled &&
        this.adapters.some((a) => a.id === agent.id)
      )
        void this.agentAction(
          agent.id,
          agent.enabled ? "enable" : "disable",
        ).catch(() => {});
    this.publishAgents();
    return view;
  }
  async agentAction(id: AgentId, action: NonNullable<AgentView["operation"]>) {
    if (this.closed)
      throw new GatewayError(
        "SERVICE_UNAVAILABLE",
        "Gateway is shutting down",
        503,
      );
    const adapter = this.engine(id);
    if (action === "stop" && this.agentOperations.has(id) && this.runtimes.busy(id)) {
      const view = this.settings.view(); view.settings.agents.find((a) => a.id === id)!.enabled = false;
      this.settings.save({ settings: view.settings, revision: view.revision });
      for (const session of this.store.list("sessions").filter((s) => s.engineId === id)) await this.cancel(session.id);
      return this.agentViews().find((a) => a.id === id)!;
    }
    if ((action === "enable" || action === "apply") && (!this.runtimes.installed(id) || this.runtimes.busy(id)))
      throw new GatewayError("CONFLICT", "Install the runtime and wait for its operation before enabling or applying", 409);
    if (this.agentOperations.has(id))
      throw new GatewayError(
        "CONFLICT",
        "Agent operation is already in progress",
        409,
      );
    const view = this.settings.view();
    if (action === "apply" && !this.agentEnabled(id))
      throw new GatewayError(
        "CONFLICT",
        "Enable the Agent to apply its configuration",
        409,
      );
    if (action !== "apply") {
      view.settings.agents.find((a) => a.id === id)!.enabled =
        action === "enable";
      this.settings.save({ settings: view.settings, revision: view.revision });
    }
    this.agentErrors.delete(id);
    let resolve!: () => void;
    const gate = new Promise<void>((r) => {
      resolve = r;
    });
    this.agentOperations.set(id, { action, promise: gate });
    try {
      this.publishAgents();
    } catch (error) {
      this.agentOperations.delete(id);
      resolve();
      throw error;
    }
    const work = async () => {
      try {
        for (const session of this.store
          .list("sessions")
          .filter((s) => s.engineId === id)) {
          for (const run of this.runs(session.id).filter(
            (r) => r.state === "queued",
          ))
            await this.stopRun(run.id, "user");
          if (action === "stop")
            for (const run of this.runs(session.id).filter(
              (r) => r.state === "running" || r.state === "stopping",
            ))
              await this.stopRun(run.id, "user");
        }
        while (
          this.creating ||
          this.recovery.get(id)?.pending ||
          [
            ...this.active.keys(),
            ...this.repairs.keys(),
            ...this.isolations.keys(),
          ].some((key) => this.store.get("sessions", key)?.engineId === id)
        ) {
          if (this.closed) return;
          await delay(50);
        }
        if (this.closed) return;
        await within(adapter.stop(), this.config.limits.abortTimeoutMs);
        this.store.transaction(() => {
          for (const session of this.store
            .list("sessions")
            .filter(
              (s) => s.engineId === id && s.availability !== "deleting",
            )) {
            this.store.put("sessions", {
              ...session,
              availability: "unavailable",
              version: session.version + 1,
              updatedAt: now(),
            });
            this.repairAttempts.delete(session.id);
            this.publishSession(session.id);
          }
        });
        this.appliedRevisions.delete(id);
        this.recovery.delete(id);
        if (this.agentEnabled(id)) {
          const appliedRevision = applyAgentConfiguration(this.config, id);
          await within(adapter.start(), this.config.limits.startupTimeoutMs);
          this.appliedRevisions.set(id, appliedRevision);
        }
      } catch (error) {
        this.agentErrors.set(
          id,
          errorDetail(error, diagnosticSecrets(this.config)),
        );
        await adapter.stop().catch(() => {});
      } finally {
        this.agentOperations.delete(id);
        try {
          this.publishAgents();
        } finally {
          resolve();
        }
      }
    };
    void work().catch((error) =>
      this.agentErrors.set(
        id,
        errorDetail(error, diagnosticSecrets(this.config)),
      ),
    );
    return this.agentViews().find((a) => a.id === id)!;
  }

  private async switchRuntime(id: AgentId, activate: () => Promise<void>, rollback: () => Promise<void>, uninstall: boolean) {
    if (this.closed || this.agentOperations.has(id)) throw new GatewayError("CONFLICT", "Agent operation is already in progress", 409);
    const adapter = this.engine(id);
    const enabled = this.agentEnabled(id);
    let resolve!: () => void;
    const promise = new Promise<void>((r) => { resolve = r; });
    this.agentOperations.set(id, { action: uninstall ? "disable" : "apply", promise });
    const sessions = () => this.store.list("sessions").filter((s) => s.engineId === id && s.availability !== "deleting");
    const start = async () => {
      if (!enabled || !agentConfiguration(this.config, id, readSettings(this.config))?.enabled || uninstall || this.closed) return;
      this.appliedRevisions.set(id, applyAgentConfiguration(this.config, id));
      await within(adapter.start(), this.config.limits.startupTimeoutMs);
      const restored: { session: Session; nativeSessionId: string; processGeneration: number }[] = [];
      for (const session of sessions()) {
        const binding = this.store.db.prepare("SELECT * FROM engine_bindings WHERE sessionId=?").get(session.id);
        if (!binding || !adapter.recoverSession) throw new Error("Native session cannot be recovered after runtime update");
        const recovered = await within(adapter.recoverSession(session, { nativeSessionId: String(binding.nativeSessionId), processGeneration: Number(binding.processGeneration) }), this.config.limits.startupTimeoutMs);
        if (!recovered) throw new Error("Native session recovery failed after runtime update");
        restored.push({ session, ...recovered });
      }
      this.store.transaction(() => {
        for (const { session, nativeSessionId, processGeneration } of restored) {
          this.store.db.prepare("UPDATE engine_bindings SET nativeSessionId=?,processGeneration=?,instanceId=? WHERE sessionId=?").run(nativeSessionId, processGeneration, this.store.instanceId, session.id);
          this.store.put("sessions", { ...session, availability: "ready", version: session.version + 1, updatedAt: now() });
          this.publishSession(session.id);
        }
      });
    };
    try {
      this.publishAgents();
      for (const session of sessions()) for (const run of this.runs(session.id).filter((r) => r.state === "queued")) await this.stopRun(run.id, "user");
      while (this.creating || this.recovery.get(id)?.pending || [...this.active.keys(), ...this.repairs.keys(), ...this.isolations.keys(), ...this.deleting.keys()].some((key) => this.store.get("sessions", key)?.engineId === id)) {
        if (this.closed) throw new Error("Gateway is shutting down");
        await delay(50);
      }
      await within(adapter.stop(), this.config.limits.abortTimeoutMs);
      this.store.transaction(() => { for (const session of sessions()) { this.store.put("sessions", { ...session, availability: "unavailable", version: session.version + 1, updatedAt: now() }); this.publishSession(session.id); } });
      this.appliedRevisions.delete(id); this.recovery.delete(id);
      if (uninstall) {
        const view = this.settings.view(); view.settings.agents.find((a) => a.id === id)!.enabled = false;
        this.settings.save({ settings: view.settings, revision: view.revision });
      }
      try { await activate(); await start(); }
      catch (error) {
        await within(adapter.stop(), this.config.limits.abortTimeoutMs);
        await rollback();
        await start().catch((restoreError) => { this.agentErrors.set(id, errorDetail(restoreError, diagnosticSecrets(this.config))); });
        throw error;
      }
      this.agentErrors.delete(id);
      for (const session of sessions()) this.repairAttempts.delete(session.id);
    } finally {
      this.agentOperations.delete(id);
      try { this.publishAgents(); } finally { resolve(); }
    }
  }

  get adapters() {
    return [this.adapter, ...this.additionalAdapters];
  }
  engine(
    id: string = this.adapters.some(
      (a) => a.id === readSettings(this.config).defaultAgent,
    )
      ? readSettings(this.config).defaultAgent
      : this.adapter.id,
  ) {
    const adapter = this.adapters.find((adapter) => adapter.id === id);
    if (!adapter)
      throw new GatewayError("VALIDATION_ERROR", "Unknown engine", 400);
    return adapter;
  }
  private sessionEngine(id: string) {
    return this.engine(this.session(id).engineId);
  }

  async start() {
    this.store.transaction(() => {
      for (const session of this.store.list("sessions"))
        this.store.put("sessions", {
          ...session,
          availability: "unavailable",
          updatedAt: now(),
          version: session.version + 1,
        });
      for (const run of this.store
        .list("runs")
        .filter((r) => !isTerminal(r.state)))
        this.finish(run.id, "failed", {
          code: "GATEWAY_RESTARTED",
          message: "Gateway restarted; this execution was not replayed",
          stage: "recovery",
        });
      for (const i of this.store
        .list("interactions")
        .filter((i) => i.state === "pending" || i.state === "replying"))
        this.store.put("interactions", { ...i, state: "expired" });
      for (const s of this.store
        .list("submissions")
        .filter((s) => s.status === "processing"))
        this.store.put("submissions", {
          ...s,
          status: "indeterminate",
          error: {
            code: "GATEWAY_RESTARTED",
            message: "Submission outcome requires reconciliation",
            stage: "recovery",
          },
        });
    });
    await Promise.all(
      this.adapters.map(async (adapter) => {
        if (!this.agentEnabled(adapter.id)) return;
        try {
          const appliedRevision = agentIdSchema.safeParse(adapter.id).success
            ? applyAgentConfiguration(this.config, adapter.id as AgentId)
            : null;
          await within(adapter.start(), this.config.limits.startupTimeoutMs);
          if (appliedRevision)
            this.appliedRevisions.set(adapter.id, appliedRevision);
        } catch (error) {
          this.log(
            "error",
            "engine",
            asGatewayError(error).code,
            `${adapter.id} engine is not ready: ${errorDetail(error, diagnosticSecrets(this.config))}`,
          );
        }
      }),
    );
    this.tick = setInterval(() => this.schedule(), 100);
    this.tick.unref();
    this.maintenance = setInterval(() => {
      try {
        this.store.pruneEvents(
          this.config.limits.maxEvents,
          new Date(
            Date.now() - this.config.limits.eventRetentionMs,
          ).toISOString(),
        );
      } catch {
        this.store.healthy = false;
        this.log(
          "error",
          "storage",
          "INTERNAL_ERROR",
          "Event retention maintenance failed",
        );
      }
    }, 60000);
    this.maintenance.unref();
  }
  session(id: string): Session {
    const s = this.store.get("sessions", id);
    if (!s) throw new GatewayError("NOT_FOUND", "Session not found", 404);
    return s;
  }
  run(id: string): Run {
    const r = this.store.get("runs", id);
    if (!r) throw new GatewayError("NOT_FOUND", "Run not found", 404);
    return r;
  }
  runs(sessionId: string) {
    return this.store.list("runs", "sessionId=? ORDER BY sequence", [
      sessionId,
    ]);
  }
  summary(id: string): TaskSummary {
    const session = this.session(id);
    const runs = this.runs(id);
    const interactions = this.store.list("interactions", "sessionId=?", [id]);
    return {
      ...session,
      status: taskStatus(session, runs, interactions),
      lastRun: runs.at(-1) ?? null,
      queuedCount: runs.filter((r) => r.state === "queued").length,
      messageCount: Number(
        this.store.db
          .prepare("SELECT COUNT(*) AS n FROM messages WHERE sessionId=?")
          .get(id)?.n ?? 0,
      ),
    };
  }
  detail(id: string): TaskDetail {
    return {
      task: this.summary(id),
      runs: this.runs(id),
      messages: this.store.messages(id),
      interactions: this.store.list("interactions", "sessionId=?", [id]),
      artifacts: this.store.list("artifacts", "sessionId=?", [id]),
    };
  }
  private publishSession(id: string) {
    const task = this.summary(id);
    this.store.emit({ type: "session.updated", sessionId: id, data: task });
    const busy = this.runs(id).some((r) => !isTerminal(r.state));
    this.store.emit({
      type: "session.status",
      sessionId: id,
      data: { sessionID: id, status: { type: busy ? "busy" : "idle" } },
    });
    if (!busy)
      this.store.emit({
        type: "session.idle",
        sessionId: id,
        data: { sessionID: id },
      });
  }
  private ensureAdmission(adapter: EngineAdapter) {
    if (
      !this.agentEnabled(adapter.id) ||
      this.agentOperations.has(adapter.id) ||
      this.agentErrors.has(adapter.id)
    )
      throw new GatewayError(
        "SERVICE_UNAVAILABLE",
        "Agent is disabled or applying configuration",
        503,
      );
    if (this.closed || !this.store.healthy)
      throw new GatewayError(
        "SERVICE_UNAVAILABLE",
        "Gateway is not accepting work",
        503,
      );
    if (adapter.health().status !== "ready")
      throw new GatewayError(
        "SERVICE_UNAVAILABLE",
        `${adapter.id} engine is not ready`,
        503,
      );
  }
  async createSession(input: {
    engineId?: string;
    directory: string;
    title?: string;
    interactionPolicy?: Session["interactionPolicy"];
  }): Promise<Session> {
    const adapter = this.engine(input.engineId);
    this.ensureAdmission(adapter);
    if (
      this.store.list("sessions").length + this.creating >=
      this.config.limits.maxSessions
    )
      throw new GatewayError(
        "SERVICE_UNAVAILABLE",
        "Session capacity reached",
        503,
      );
    this.creating++;
    let session: Session | undefined;
    try {
      const directory = await validateDirectory(
        input.directory,
        this.config.allowedDirectories,
      );
      session = {
        id: randomUUID(),
        directory,
        title: input.title?.trim() || "Untitled task",
        engineId: adapter.id,
        interactionPolicy: input.interactionPolicy ??
          agentConfiguration(this.config, adapter.id)?.interactionPolicy ?? {
            permission: "auto",
            question: "auto",
          },
        availability: "ready",
        createdAt: now(),
        updatedAt: now(),
        version: 1,
      };
      const owned = session;
      const creation = adapter.createSession(owned);
      const binding = await within(
        creation,
        this.config.limits.startupTimeoutMs,
      ).catch((error) => {
        void creation
          .then(() => adapter.disposeSession(owned.id))
          .catch(() => {});
        throw error;
      });
      this.store.transaction(() => {
        this.store.put("sessions", owned);
        this.store.db
          .prepare("INSERT INTO engine_bindings VALUES (?,?,?,?,?,?)")
          .run(
            owned.id,
            owned.engineId,
            binding.nativeSessionId,
            directory,
            this.store.instanceId,
            binding.processGeneration,
          );
        this.store.emit({
          type: "session.created",
          sessionId: owned.id,
          data: this.summary(owned.id),
        });
      });
      return owned;
    } catch (error) {
      if (session)
        await within(
          adapter.disposeSession(session.id),
          this.config.limits.abortTimeoutMs,
        ).catch(() =>
          this.log(
            "error",
            "cleanup",
            "CLEANUP_FAILED",
            "Native session cleanup failed",
            session!.id,
          ),
        );
      throw error;
    } finally {
      this.creating--;
    }
  }
  submit(
    input: CreateTaskInput | SubmitRunInput,
    sessionId?: string,
  ): Promise<AcceptedRun> {
    const operation = sessionId ? "append" : "create";
    const target = sessionId ?? "";
    const key = `${operation}:${target}:${input.submissionId}`;
    const digest = createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex");
    const existing = this.store.submission(
      input.submissionId,
      operation,
      target,
    );
    if (existing) {
      if (existing.digest !== digest)
        return Promise.reject(
          new GatewayError(
            "CONFLICT",
            "Submission ID was used with different input",
            409,
          ),
        );
      if (existing.status === "accepted" && existing.result)
        return Promise.resolve(existing.result);
      if (existing.status === "gone")
        return Promise.reject(
          new GatewayError("GONE", "Task for this submission was deleted", 410),
        );
      const pending = this.submissions.get(key);
      if (pending) return pending;
      return Promise.reject(
        new GatewayError(
          "CONFLICT",
          `Submission is ${existing.status}; inspect its recorded outcome`,
          409,
        ),
      );
    }
    this.ensureAdmission(
      sessionId
        ? this.sessionEngine(sessionId)
        : this.engine((input as CreateTaskInput).engineId),
    );
    const record: Submission = {
      id: input.submissionId,
      operation,
      target,
      digest,
      status: "processing",
      result: null,
      error: null,
      createdAt: now(),
    };
    this.store.transaction(() => this.store.put("submissions", record));
    const promise = (async () => {
      let created: Session | undefined;
      try {
        if (!sessionId)
          created = await this.createSession(input as CreateTaskInput);
        const id = sessionId ?? created!.id;
        let result!: AcceptedRun;
        this.store.transaction(() => {
          const run = this.enqueue(id, input, input.submissionId);
          result = {
            submissionId: input.submissionId,
            taskId: id,
            sessionId: id,
            runId: run.id,
            acceptedAt: run.acceptedAt,
          };
          this.store.put("submissions", {
            ...record,
            status: "accepted",
            result,
          });
        });
        return result;
      } catch (error) {
        const e = asGatewayError(error);
        this.store.transaction(() =>
          this.store.put("submissions", {
            ...record,
            status: "rejected",
            error: { code: e.code, message: e.message, stage: e.stage },
          }),
        );
        if (created) await this.deleteSession(created.id).catch(() => {});
        throw error;
      } finally {
        this.submissions.delete(key);
      }
    })();
    this.submissions.set(key, promise);
    return promise;
  }
  enqueue(
    sessionId: string,
    input: PromptInput,
    submissionId: string = randomUUID(),
  ): Run {
    const session = this.session(sessionId);
    this.ensureAdmission(this.engine(session.engineId));
    if (session.availability !== "ready")
      throw new GatewayError("CONFLICT", "Session cannot accept new work", 409);
    const runs = this.runs(sessionId);
    if (
      runs.filter((r) => !isTerminal(r.state)).length >=
      this.config.limits.maxQueuedPerSession + 1
    )
      throw new GatewayError(
        "SERVICE_UNAVAILABLE",
        "Session queue capacity reached",
        503,
      );
    const previousModel = runs.at(-1)?.model;
    const availableModels = configuredModels(this.config, session.engineId);
    const inheritedModel =
      previousModel &&
      (!agentIdSchema.safeParse(session.engineId).success ||
        availableModels.some(
          (m) =>
            m.providerID === previousModel.providerID &&
            m.modelID === previousModel.modelID,
        ))
        ? previousModel
        : null;
    const run: Run = {
      runtimeVersion: this.runtimes.view(agentIdSchema.safeParse(session.engineId).success ? session.engineId as AgentId : this.config.engine).runningVersion,
      configRevision: this.appliedRevisions.get(session.engineId) ?? null,
      id: randomUUID(),
      sessionId,
      submissionId,
      sequence: (runs.at(-1)?.sequence ?? 0) + 1,
      inputParts: input.parts,
      model:
        input.model ??
        inheritedModel ??
        agentConfiguration(this.config, session.engineId)?.defaultModel ??
        (session.engineId === this.adapter.id ? this.config.model : null),
      state: "queued",
      acceptedAt: now(),
      deadlineAt: new Date(
        Date.now() + this.config.limits.runTimeoutMs,
      ).toISOString(),
      startedAt: null,
      finishedAt: null,
      stopReason: null,
      error: null,
      usage: null,
      traceId: randomUUID().replaceAll("-", ""),
    };
    if (
      agentIdSchema.safeParse(session.engineId).success &&
      (!run.model ||
        !configuredModels(this.config, session.engineId).some(
          (m) =>
            m.providerID === run.model!.providerID &&
            m.modelID === run.model!.modelID,
        ))
    )
      throw new GatewayError(
        "VALIDATION_ERROR",
        "Select a model configured for this agent",
        400,
      );
    this.store.transaction(() => {
      this.store.put("runs", run);
      this.store.emit({
        type: "run.accepted",
        sessionId,
        runId: run.id,
        data: run,
      });
      this.publishSession(sessionId);
    });
    return run;
  }
  wait(runId: string): Promise<Run> {
    const run = this.run(runId);
    if (isTerminal(run.state)) return Promise.resolve(run);
    return new Promise((resolve) => {
      const list = this.waiting.get(runId) ?? new Set();
      list.add(resolve);
      this.waiting.set(runId, list);
    });
  }
  private schedule() {
    if (this.closed || !this.store.healthy) return;
    try {
      for (const adapter of this.adapters) {
        if (
          !this.agentEnabled(adapter.id) ||
          this.agentOperations.has(adapter.id) ||
          this.agentErrors.has(adapter.id)
        )
          continue;
        const recovery = this.recovery.get(adapter.id) ?? {
          attempts: 0,
          at: 0,
        };
        this.recovery.set(adapter.id, recovery);
        for (const id of adapter.unavailableSessions?.() ?? [])
          if (this.store.get("sessions", id)?.availability === "ready") {
            void this.isolate(id)
              .then(() => {
                for (const r of this.runs(id).filter(
                  (r) => !isTerminal(r.state),
                ))
                  this.finish(r.id, "failed", {
                    code: "BAD_GATEWAY",
                    message: "Native session became unavailable",
                    stage: "engine",
                  });
              })
              .catch(() => {
                this.store.healthy = false;
              });
          }
        const health = adapter.health().status;
        if (
          (health === "unavailable" || health === "degraded") &&
          ![...this.active.keys(), ...this.isolations.keys()].some(
            (id) => this.session(id).engineId === adapter.id,
          ) &&
          !recovery.pending &&
          recovery.attempts < 3 &&
          Date.now() >= recovery.at
        ) {
          recovery.attempts++;
          recovery.at = Date.now() + 1000 * 2 ** recovery.attempts;
          this.log(
            "warn",
            "engine",
            "ENGINE_RESTART",
            "Restarting engine for new sessions; interrupted tasks are not replayed",
          );
          recovery.pending = adapter
            .stop()
            .then(async () => {
              if (
                this.closed ||
                !this.agentEnabled(adapter.id) ||
                this.agentOperations.has(adapter.id)
              )
                return;
              await adapter.start();
              if (
                agentIdSchema.safeParse(adapter.id).success &&
                !this.appliedRevisions.has(adapter.id)
              )
                this.appliedRevisions.set(
                  adapter.id,
                  agentRevision(
                    this.config,
                    adapter.id,
                    effectiveSettings(this.config, adapter.id),
                  ),
                );
            })
            .catch((error) =>
              this.log(
                "error",
                "engine",
                "BAD_GATEWAY",
                `Engine restart failed: ${errorDetail(error, diagnosticSecrets(this.config))}`,
              ),
            )
            .finally(() => {
              recovery.pending = undefined;
            });
        }
        if (health === "ready" && adapter.recoverSession)
          for (const session of this.store.list(
            "sessions",
            "availability='unavailable'",
          )) {
            if (
              session.engineId !== adapter.id ||
              this.active.has(session.id) ||
              this.isolations.has(session.id) ||
              this.repairs.has(session.id) ||
              (this.repairAttempts.get(session.id) ?? 0) >= 2
            )
              continue;
            this.repairAttempts.set(
              session.id,
              (this.repairAttempts.get(session.id) ?? 0) + 1,
            );
            const persisted = this.store.db
              .prepare("SELECT * FROM engine_bindings WHERE sessionId=?")
              .get(session.id);
            if (
              !persisted ||
              persisted.engineId !== session.engineId ||
              persisted.directory !== session.directory ||
              typeof persisted.nativeSessionId !== "string" ||
              !persisted.nativeSessionId
            ) {
              this.repairAttempts.set(session.id, 2);
              this.log(
                "error",
                "recovery",
                "BAD_GATEWAY",
                "Native session binding is missing or inconsistent",
                session.id,
              );
              continue;
            }
            const repair = adapter
              .recoverSession(session, {
                nativeSessionId: persisted.nativeSessionId,
                processGeneration: Number(persisted.processGeneration),
              })
              .then((binding) => {
                const current = this.store.get("sessions", session.id);
                if (!binding) {
                  this.repairAttempts.set(session.id, 2);
                  return;
                }
                if (this.closed || current?.availability !== "unavailable")
                  return;
                this.store.transaction(() => {
                  this.store.db
                    .prepare(
                      "UPDATE engine_bindings SET nativeSessionId=?,processGeneration=?,instanceId=? WHERE sessionId=?",
                    )
                    .run(
                      binding.nativeSessionId,
                      binding.processGeneration,
                      this.store.instanceId,
                      session.id,
                    );
                  this.store.put("sessions", {
                    ...current,
                    availability: "ready",
                    version: current.version + 1,
                    updatedAt: now(),
                  });
                  this.publishSession(session.id);
                });
                this.log(
                  "info",
                  "recovery",
                  "SESSION_RECOVERED",
                  "Native context recovered; previous runs remain terminal",
                  session.id,
                );
              })
              .catch((error) =>
                this.log(
                  "error",
                  "recovery",
                  "BAD_GATEWAY",
                  `Native session recovery failed: ${errorDetail(error, diagnosticSecrets(this.config))}`,
                  session.id,
                ),
              )
              .finally(() => this.repairs.delete(session.id));
            this.repairs.set(session.id, repair);
          }
      }
      for (const run of this.store.list(
        "runs",
        "state IN ('queued','running') ORDER BY acceptedAt,sequence",
      )) {
        if (Date.now() >= Date.parse(run.deadlineAt)) {
          if (run.state === "queued")
            this.finish(run.id, "timed_out", {
              code: "TIMEOUT",
              message: "Execution deadline expired while queued",
              stage: "queue",
            });
          else void this.stopRun(run.id, "timeout").catch(() => {});
          continue;
        }
        if (
          run.state !== "queued" ||
          !this.agentEnabled(this.session(run.sessionId).engineId) ||
          this.agentOperations.has(this.session(run.sessionId).engineId) ||
          this.active.size >= this.config.limits.maxConcurrentRuns ||
          this.active.has(run.sessionId)
        )
          continue;
        if (this.session(run.sessionId).availability !== "ready") {
          this.finish(run.id, "failed", {
            code: "BAD_GATEWAY",
            message: "Session engine context is unavailable",
            stage: "engine",
          });
          continue;
        }
        let resolve!: () => void;
        const done = new Promise<void>((r) => {
          resolve = r;
        });
        const execution: Execution = { done, resolve };
        this.active.set(run.sessionId, execution);
        void this.execute(run.id)
          .finally(async () => {
            await execution.stopping?.catch(() => {});
            if (this.active.get(run.sessionId) === execution)
              this.active.delete(run.sessionId);
            execution.resolve();
          })
          .catch((error) => {
            this.store.healthy = false;
            this.log(
              "error",
              "runtime",
              "INTERNAL_ERROR",
              asGatewayError(error).message,
            );
          });
      }
    } catch {
      this.store.healthy = false;
    }
  }
  private async execute(runId: string) {
    let run = this.run(runId);
    const session = this.session(run.sessionId);
    this.store.transaction(() => {
      run = transitionRun(run, "running", now());
      this.store.put("runs", run);
      const user: Message = {
        id: randomUUID(),
        sessionId: session.id,
        runId,
        role: "user",
        createdAt: now(),
        completedAt: now(),
        finishReason: null,
        parts: run.inputParts.map((p) => ({ ...p, id: randomUUID() })),
      };
      this.saveMessage(user);
      this.store.emit({
        type: "run.updated",
        sessionId: session.id,
        runId,
        data: run,
      });
      this.publishSession(session.id);
    });
    let before: Map<string, string> | null = null;
    try {
      before = await discoverFiles(session.directory);
    } catch (error) {
      this.log(
        "warn",
        "artifact",
        "DISCOVERY_FAILED",
        `Initial artifact inventory could not be completed: ${errorDetail(error, diagnosticSecrets(this.config))}`,
        session.id,
        runId,
      );
    }
    if (this.run(runId).state !== "running") return;
    try {
      const result = await this.engine(session.engineId).run(
        session,
        run,
        (update) => this.update(runId, update),
      );
      if (this.run(runId).state !== "running") return;
      if (result.outcome === "completed") {
        const last = this.store.messages(session.id, runId).at(-1);
        if (!last || last.role !== "assistant" || last.finishReason !== "stop")
          throw engineError(
            "Engine ended without a successful final assistant message",
          );
        try {
          const artifacts = before
            ? await registerChangedFiles(session, run, before)
            : [];
          if (this.run(runId).state === "running")
            this.store.transaction(() => {
              for (const artifact of artifacts) {
                this.store.put("artifacts", artifact);
                this.store.emit({
                  type: "artifact.updated",
                  sessionId: session.id,
                  runId,
                  data: artifact,
                });
              }
            });
        } catch (error) {
          this.log(
            "warn",
            "artifact",
            "ARTIFACT_CHECK_FAILED",
            `Artifact discovery or verification failed: ${errorDetail(error, diagnosticSecrets(this.config))}`,
            session.id,
            runId,
          );
        }
        if (this.run(runId).state !== "running") return;
        this.store.transaction(() => {
          if (
            !last.parts.some(
              (p) => p.type === "step-finish" && p.reason === "stop",
            )
          )
            last.parts.push({
              id: randomUUID(),
              type: "step-finish",
              reason: "stop",
              usage: result.usage ?? null,
            });
          this.saveMessage(last);
          this.finish(runId, "completed", null, result);
        });
      } else
        this.finish(
          runId,
          "failed",
          result.error ?? {
            code: "BAD_GATEWAY",
            message: "Agent did not complete this run",
            stage: "engine",
          },
          result,
        );
    } catch (error) {
      if (this.run(runId).state !== "running") return;
      const e = asGatewayError(error);
      if (!(error instanceof GatewayError))
        e.message = errorDetail(error, diagnosticSecrets(this.config));
      // A rejected transport promise does not prove that native work stopped.
      await this.isolate(session.id, {
        code: e.code,
        message: e.message,
        stage: e.stage,
      });
      if (isTerminal(this.run(runId).state)) return;
      this.finish(runId, "failed", {
        code: e.code,
        message: e.message,
        stage: e.stage,
      });
    }
  }
  private saveMessage(message: Message) {
    this.store.saveMessage(message);
    this.store.emit({
      type: "message.updated",
      sessionId: message.sessionId,
      runId: message.runId,
      data: { ...message, parts: undefined },
    });
    for (const part of message.parts)
      this.store.emit({
        type: "message.part.updated",
        sessionId: message.sessionId,
        runId: message.runId,
        data: { messageId: message.id, part },
      });
  }
  private update(runId: string, update: EngineUpdate) {
    const run = this.run(runId);
    if (run.state !== "running") return;
    if (update.type === "message") {
      if (
        update.message.runId !== runId ||
        update.message.sessionId !== run.sessionId
      )
        throw engineError("Engine message belongs to a different execution");
      if (
        Buffer.byteLength(JSON.stringify(update.message)) >
        this.config.limits.maxPartBytes
      )
        throw engineError("Engine message exceeded the configured size limit");
      this.store.transaction(() => this.saveMessage(update.message));
    } else {
      const interaction = update.interaction;
      if (
        interaction.runId !== runId ||
        interaction.sessionId !== run.sessionId
      )
        throw engineError("Interaction belongs to a different execution");
      if (this.store.get("interactions", interaction.id)) return;
      this.store.transaction(() => {
        this.store.put("interactions", interaction);
        this.store.emit({
          type: `${interaction.kind}.asked`,
          sessionId: run.sessionId,
          runId,
          data: interaction,
        });
        this.publishSession(run.sessionId);
      });
      if (interaction.policy === "auto") {
        const reply: InteractionReply =
          interaction.kind === "permission"
            ? { decision: "always" }
            : {
                answers: interaction.questions.map((q) => [
                  q.options[0] ?? this.config.questionAnswer,
                ]),
              };
        void this.reply(interaction.id, reply).catch(() => {
          void this.stopRun(runId, "user").catch(() => {});
        });
      }
    }
  }
  private finish(
    runId: string,
    outcome: RunOutcome,
    error: Failure | null = null,
    result?: EngineResult,
  ) {
    const current = this.run(runId);
    if (isTerminal(current.state)) return;
    // Error.message is not enumerable; persist a plain failure for HTTP/SSE and reloads.
    if (error)
      error = { code: error.code, message: error.message, stage: error.stage };
    let finished!: Run;
    this.store.transaction(() => {
      finished = {
        ...transitionRun(current, outcome, now()),
        error,
        usage: result?.usage ?? current.usage,
      };
      this.store.put("runs", finished);
      if (outcome !== "completed")
        for (const message of this.store.messages(current.sessionId, runId)) {
          if (
            !message.parts.some(
              (p) =>
                p.type === "tool" &&
                (p.state === "running" || p.state === "pending"),
            )
          )
            continue;
          message.parts = message.parts.map((p) =>
            p.type === "tool" &&
            (p.state === "running" || p.state === "pending")
              ? {
                  ...p,
                  state: outcome === "cancelled" ? "cancelled" : "interrupted",
                  finishedAt: now(),
                }
              : p,
          );
          this.saveMessage(message);
        }
      for (const i of this.store
        .list("interactions", "runId=?", [runId])
        .filter((i) => i.state === "pending" || i.state === "replying")) {
        const expired: Interaction = { ...i, state: "expired" };
        this.store.put("interactions", expired);
        this.store.emit({
          type: "interaction.updated",
          sessionId: current.sessionId,
          runId,
          data: expired,
        });
      }
      this.store.emit({
        type: "run.finished",
        sessionId: current.sessionId,
        runId,
        data: finished,
      });
      if (error)
        this.store.emit({
          type: "session.error",
          sessionId: current.sessionId,
          runId,
          data: { sessionID: current.sessionId, error },
        });
      const session = this.session(current.sessionId);
      this.store.put("sessions", {
        ...session,
        updatedAt: now(),
        version: session.version + 1,
      });
      this.publishSession(current.sessionId);
    });
    this.store.afterCommit(() =>
      queueMicrotask(() => {
        for (const resolve of this.waiting.get(runId) ?? []) resolve(finished);
        this.waiting.delete(runId);
        this.onFinished(finished);
      }),
    );
    if (error)
      this.log(
        "error",
        error.stage,
        error.code,
        error.message,
        current.sessionId,
        runId,
      );
  }
  async reply(id: string, reply: InteractionReply) {
    const i = this.store.get("interactions", id);
    if (!i) throw new GatewayError("NOT_FOUND", "Interaction not found", 404);
    if (i.state !== "pending" || this.run(i.runId).state !== "running")
      throw new GatewayError(
        "CONFLICT",
        "Interaction is already claimed or expired",
        409,
      );
    if (
      i.kind === "permission" ? !("decision" in reply) : !("answers" in reply)
    )
      throw new GatewayError(
        "VALIDATION_ERROR",
        "Reply does not match interaction kind",
        400,
      );
    if ("answers" in reply) {
      if (
        reply.answers.length !== i.questions.length ||
        reply.answers.some((a, index) => {
          const q = i.questions[index]!;
          return (
            !a.length ||
            (!q.multiple && a.length !== 1) ||
            (!q.allowCustom && a.some((v) => !q.options.includes(v)))
          );
        })
      )
        throw new GatewayError(
          "VALIDATION_ERROR",
          "Answers do not match question options",
          400,
        );
    }
    const claimed: Interaction = { ...i, state: "replying", reply };
    this.store.transaction(() => {
      this.store.put("interactions", claimed);
      this.store.emit({
        type: "interaction.updated",
        sessionId: i.sessionId,
        runId: i.runId,
        data: claimed,
      });
    });
    try {
      await within(
        this.sessionEngine(i.sessionId).reply(id, reply),
        this.config.limits.abortTimeoutMs,
      );
      if (this.store.get("interactions", id)?.state !== "replying") return;
      const resolved: Interaction = {
        ...claimed,
        state: "resolved",
        resolvedAt: now(),
      };
      this.store.transaction(() => {
        this.store.put("interactions", resolved);
        this.store.emit({
          type: "interaction.updated",
          sessionId: i.sessionId,
          runId: i.runId,
          data: resolved,
        });
        this.publishSession(i.sessionId);
      });
    } catch (error) {
      if (this.store.get("interactions", id)?.state === "replying")
        this.store.transaction(() =>
          this.store.put("interactions", {
            ...claimed,
            error:
              "Reply outcome is uncertain; it will not be sent again automatically",
          }),
        );
      throw error;
    }
  }
  private stopRun(
    runId: string,
    reason: NonNullable<Run["stopReason"]>,
  ): Promise<void> {
    const run = this.run(runId);
    if (isTerminal(run.state)) return Promise.resolve();
    if (run.state === "queued") {
      this.store.transaction(() => {
        this.store.put("runs", { ...run, stopReason: reason });
        this.finish(runId, reason === "timeout" ? "timed_out" : "cancelled");
      });
      return Promise.resolve();
    }
    const isolation = this.isolations.get(run.sessionId);
    if (isolation) return isolation;
    const execution = this.active.get(run.sessionId);
    if (execution?.stopping) return execution.stopping;
    this.store.transaction(() => {
      const stopping = {
        ...transitionRun(run, "stopping", now()),
        stopReason: reason,
      };
      this.store.put("runs", stopping);
      this.store.emit({
        type: "run.updated",
        sessionId: run.sessionId,
        runId,
        data: stopping,
      });
      this.publishSession(run.sessionId);
    });
    const stopping = (async () => {
      try {
        await within(
          this.sessionEngine(run.sessionId).abort(run.sessionId, run.id),
          this.config.limits.abortTimeoutMs,
        );
      } catch {
        try {
          const affected = await within(
            this.sessionEngine(run.sessionId).forceStop(run.sessionId),
            this.config.limits.abortTimeoutMs,
          );
          this.store.transaction(() => {
            for (const id of affected) {
              const s = this.store.get("sessions", id);
              if (s)
                this.store.put("sessions", {
                  ...s,
                  availability: "unavailable",
                });
              for (const r of this.runs(id).filter(
                (r) => !isTerminal(r.state) && r.id !== runId,
              ))
                this.finish(r.id, "failed", {
                  code: "BAD_GATEWAY",
                  message: "Engine process was stopped",
                  stage: "engine",
                });
            }
          });
        } catch {
          this.repairAttempts.set(run.sessionId, 2);
          this.store.transaction(() => {
            this.store.put("sessions", {
              ...this.session(run.sessionId),
              availability: "unavailable",
            });
            this.finish(runId, "failed", {
              code: "STOP_UNCONFIRMED",
              message: "Engine stop could not be confirmed",
              stage: "cancellation",
            });
          });
          throw engineError("Engine stop could not be confirmed");
        }
      }
      this.finish(
        runId,
        reason === "timeout" ? "timed_out" : "cancelled",
        reason === "timeout"
          ? {
              code: "TIMEOUT",
              message: "Run deadline exceeded",
              stage: "execution",
            }
          : null,
      );
    })();
    if (execution) execution.stopping = stopping;
    return stopping;
  }
  async cancel(
    sessionId: string,
    reason: NonNullable<Run["stopReason"]> = "user",
  ) {
    this.session(sessionId);
    const runs = this.runs(sessionId);
    this.store.transaction(() => {
      for (const r of runs.filter((r) => r.state === "queued"))
        this.finish(r.id, "cancelled");
    });
    const active = runs.find(
      (r) => r.state === "running" || r.state === "stopping",
    );
    if (active) await this.stopRun(active.id, reason);
  }
  private isolate(
    sessionId: string,
    failure: Failure = {
      code: "BAD_GATEWAY",
      message: "Native execution became unavailable",
      stage: "engine",
    },
  ): Promise<void> {
    const existing = this.isolations.get(sessionId);
    if (existing) return existing;
    const session = this.store.get("sessions", sessionId);
    if (session)
      this.store.transaction(() => {
        this.store.put("sessions", { ...session, availability: "unavailable" });
        for (const run of this.runs(sessionId).filter(
          (r) => r.state === "running",
        )) {
          const stopping = transitionRun(run, "stopping", now());
          this.store.put("runs", stopping);
          this.store.emit({
            type: "run.updated",
            sessionId,
            runId: run.id,
            data: stopping,
          });
        }
        this.publishSession(sessionId);
      });
    const isolation = (async () => {
      let affected = [sessionId];
      try {
        await within(
          this.sessionEngine(sessionId).abort(
            sessionId,
            this.runs(sessionId).find((r) => r.state === "stopping")?.id ?? "",
          ),
          this.config.limits.abortTimeoutMs,
        );
      } catch {
        try {
          affected = [
            ...new Set([
              ...affected,
              ...(await within(
                this.sessionEngine(sessionId).forceStop(sessionId),
                this.config.limits.abortTimeoutMs,
              )),
            ]),
          ];
        } catch {
          this.repairAttempts.set(sessionId, 2);
          this.log(
            "error",
            "cleanup",
            "STOP_UNCONFIRMED",
            "Native execution stop could not be confirmed",
            sessionId,
          );
        }
      }
      this.store.transaction(() => {
        for (const id of affected) {
          const s = this.store.get("sessions", id);
          if (s) {
            this.store.put("sessions", { ...s, availability: "unavailable" });
            this.publishSession(id);
          }
          for (const run of this.runs(id).filter((r) => !isTerminal(r.state)))
            this.finish(run.id, "failed", failure);
        }
      });
    })().finally(() => this.isolations.delete(sessionId));
    this.isolations.set(sessionId, isolation);
    return isolation;
  }
  deleteSession(id: string): Promise<void> {
    const pending = this.deleting.get(id);
    if (pending) return pending;
    const session = this.session(id);
    if (this.agentOperations.has(session.engineId) && this.runtimes.busy(session.engineId)) throw new GatewayError("CONFLICT", "Wait for the runtime operation before deleting native sessions", 409);
    this.store.transaction(() => {
      this.store.put("sessions", { ...session, availability: "deleting" });
      this.publishSession(id);
    });
    const deletion = (async () => {
      await this.cancel(id, "deletion");
      const execution = this.active.get(id);
      if (execution)
        await within(execution.done, this.config.limits.abortTimeoutMs);
      const repair = this.repairs.get(id);
      if (repair)
        await within(
          repair,
          this.config.limits.startupTimeoutMs +
            this.config.limits.abortTimeoutMs,
        );
      await within(
        this.sessionEngine(id).disposeSession(id),
        this.config.limits.abortTimeoutMs,
      );
      this.store.transaction(() => this.store.deleteSession(id));
    })().finally(() => this.deleting.delete(id));
    this.deleting.set(id, deletion);
    return deletion;
  }
  log(
    level: string,
    stage: string,
    code: string,
    message: string,
    sessionId?: string,
    runId?: string,
  ) {
    this.onLog({ level, stage, code, message, sessionId, runId });
    try {
      this.store.db
        .prepare(
          "INSERT INTO runtime_logs(occurredAt,level,stage,code,message,sessionId,runId,traceId) VALUES (?,?,?,?,?,?,?,?)",
        )
        .run(
          now(),
          level,
          stage,
          code,
          message,
          sessionId ?? null,
          runId ?? null,
          runId ? (this.store.get("runs", runId)?.traceId ?? null) : null,
        );
      this.store.db.exec(
        "DELETE FROM runtime_logs WHERE id NOT IN (SELECT id FROM runtime_logs ORDER BY id DESC LIMIT 10000)",
      );
    } catch {
      process.stderr.write("Runtime log write failed\n");
    }
  }
  async stop() {
    this.closed = true;
    clearInterval(this.tick);
    clearInterval(this.maintenance);
    const runtimeOperations = this.runtimes.close();
    await within(
      Promise.all(
        [...this.agentOperations.values()].map(
          (operation) => operation.promise,
        ),
      ),
      this.config.limits.startupTimeoutMs + this.config.limits.abortTimeoutMs,
    );
    await within(
      Promise.all(
        [...this.recovery.values()].map((recovery) => recovery.pending),
      ),
      this.config.limits.startupTimeoutMs + this.config.limits.abortTimeoutMs,
    );
    await Promise.all(this.repairs.values());
    await Promise.allSettled(
      this.store.list("sessions").map((s) => this.cancel(s.id, "shutdown")),
    );
    await within(
      Promise.allSettled(this.adapters.map((adapter) => adapter.stop())).then(
        (results) => {
          const failure = results.find(
            (result) => result.status === "rejected",
          );
          if (failure?.status === "rejected") throw failure.reason;
        },
      ),
      this.config.limits.abortTimeoutMs,
    );
    await within(
      Promise.all([...this.active.values()].map((e) => e.done)),
      this.config.limits.abortTimeoutMs,
    );
    await Promise.all(this.isolations.values());
    await runtimeOperations;
  }
}
