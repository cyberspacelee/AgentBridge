import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { nativeSessionDirectory } from "../../settings.js";
import type { Config } from "../../config.js";
import type {
  EngineAdapter,
  EngineBindingResult,
  EngineUpdate,
  EngineResult,
} from "../adapter.js";
import type {
  EngineHealth,
  Session,
  Run,
  Message,
  ToolPart,
  InteractionReply,
  Usage,
} from "../../../shared/contracts.js";
import { RpcProcess, record, string, list } from "../rpc.js";
import {
  agentConfiguration,
  agentDirectory,
  configuredModels,
  nativeEnvironment,
  nativeSessionEnvironment,
  restrictNativeSkills,
  diagnosticSecrets,
} from "../../settings.js";
import { engineError, errorDetail } from "../../errors.js";
import { within } from "../../async.js";
import { toolInstructions } from "../tool-instructions.js";

interface NativeSession {
  session: Session;
  rpc: RpcProcess;
  nativeId: string;
  generation: number;
  provider: string;
  active?: {
    run: Run;
    turnId: string;
    message: Message;
    emit: (update: EngineUpdate) => void;
    done: Promise<EngineResult>;
    resolve: (result: EngineResult) => void;
    reject: (error: Error) => void;
    usage: Usage | null;
    usageStart?: Record<string, number>;
  };
}
export class CodexAdapter implements EngineAdapter {
  readonly id = "codex";
  private sessions = new Map<string, NativeSession>();
  private interactions = new Map<
    string,
    {
      native: NativeSession;
      requestId: string | number;
      method: string;
      params: Record<string, unknown>;
    }
  >();
  private generation = 0;
  private state: EngineHealth = {
    status: "starting",
    version: null,
    message: null,
    processes: 0,
    restarts: 0,
  };
  constructor(private config: Config) {}
  capabilities() {
    return { permissions: true, questions: true, recovery: true };
  }
  health() {
    return {
      ...this.state,
      processes: [...this.sessions.values()].filter((s) => !s.rpc.closed)
        .length,
    };
  }
  async models() {
    return configuredModels(this.config, this.id);
  }
  unavailableSessions() {
    return [...this.sessions].filter(([, s]) => s.rpc.closed).map(([id]) => id);
  }
  private async connect(
    cwd: string,
    env = nativeEnvironment(this.config, this.id),
  ) {
    const rpc = new RpcProcess(
      this.config.codex.command,
      ["app-server"],
      cwd,
      env,
      false,
    );
    try {
      const init = await rpc.request(
        "initialize",
        {
          clientInfo: { name: "agentbridge", version: "0.2.0" },
          capabilities: { experimentalApi: true },
        },
        this.config.limits.startupTimeoutMs,
      );
      rpc.send({ method: "initialized", params: {} });
      this.state.version = string(init.userAgent);
      return rpc;
    } catch (error) {
      await rpc.stop();
      throw error;
    }
  }
  async start() {
    try {
      const rpc = await this.connect(agentDirectory(this.config, this.id));
      await rpc.stop();
      this.state.status = "ready";
      this.state.message = null;
    } catch (error) {
      this.state.status = "unavailable";
      this.state.message = errorDetail(error, diagnosticSecrets(this.config));
      throw error;
    }
  }
  private async open(session: Session, threadId?: string) {
    const env = nativeSessionEnvironment(this.config, this.id, session);
    let rpc = await this.connect(session.directory, env);
    try {
      const catalog = await rpc.request("skills/list", {
        cwds: [session.directory],
        forceReload: true,
      });
      const parseSkills = (value: Record<string, unknown>) => {
        if (!Array.isArray(value.data))
          throw engineError("Codex returned an invalid skill catalog");
        return value.data
          .flatMap((entry) => list(record(entry).skills))
          .map((value) => {
            const skill = record(value);
            return {
              path: string(skill.path),
              enabled: skill.enabled === true,
            };
          });
      };
      if (
        restrictNativeSkills(
          this.config,
          this.id,
          session.id,
          parseSkills(catalog),
        )
      ) {
        await rpc.stop();
        rpc = await this.connect(session.directory, env);
        if (
          restrictNativeSkills(
            this.config,
            this.id,
            session.id,
            parseSkills(
              await rpc.request("skills/list", {
                cwds: [session.directory],
                forceReload: true,
              }),
            ),
          )
        )
          throw engineError(
            "Codex could not enforce the selected skill configuration",
          );
      }
      const model = agentConfiguration(this.config, this.id)!.defaultModel!;
      const result = await rpc.request(
        threadId ? "thread/resume" : "thread/start",
        {
          ...(threadId ? { threadId } : {}),
          cwd: session.directory,
          model: model.modelID,
          modelProvider: model.providerID,
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          sandbox: "workspace-write",
          developerInstructions: toolInstructions(session.directory),
        },
        this.config.limits.startupTimeoutMs,
      );
      const nativeId = string(record(result.thread).id);
      if (!nativeId || (threadId && nativeId !== threadId))
        throw engineError("Codex session recovery mismatch");
      const native: NativeSession = {
        session,
        rpc,
        nativeId,
        generation: ++this.generation,
        provider: model.providerID,
      };
      rpc.onMessage = (method, params, id) =>
        this.event(native, method, params, id);
      rpc.onClose = (error) =>
        native.active?.reject(
          engineError(
            "Codex process exited",
            error,
            diagnosticSecrets(this.config),
          ),
        );
      this.sessions.set(session.id, native);
      return {
        nativeSessionId: nativeId,
        processGeneration: native.generation,
      };
    } catch (error) {
      await rpc.stop();
      throw error;
    }
  }
  async createSession(session: Session) {
    return this.open(session);
  }
  async recoverSession(session: Session, binding: EngineBindingResult) {
    await this.forceStop(session.id);
    return this.open(session, binding.nativeSessionId);
  }
  async run(session: Session, run: Run, emit: (update: EngineUpdate) => void) {
    const native = this.sessions.get(session.id);
    if (!native || native.rpc.closed || native.active)
      throw engineError("Codex session cannot start execution");
    if (run.model && native.provider !== run.model.providerID) {
      await native.rpc.request("thread/resume", {
        threadId: native.nativeId,
        modelProvider: run.model.providerID,
        model: run.model.modelID,
      });
      native.provider = run.model.providerID;
    }
    let resolve!: (result: EngineResult) => void,
      reject!: (error: Error) => void;
    const done = new Promise<EngineResult>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const message: Message = {
      id: randomUUID(),
      sessionId: session.id,
      runId: run.id,
      role: "assistant",
      createdAt: new Date().toISOString(),
      completedAt: null,
      finishReason: null,
      parts: [],
    };
    native.active = {
      run,
      turnId: "",
      message,
      emit,
      done,
      resolve,
      reject,
      usage: null,
    };
    // Read terminal events before waiting for the turn/start response; both can arrive in one batch.
    void native.rpc
      .request(
        "turn/start",
        {
          threadId: native.nativeId,
          model: run.model?.modelID,
          input: run.inputParts.map((p) => ({ type: "text", text: p.text })),
        },
        this.config.limits.startupTimeoutMs,
      )
      .then((response) => {
        if (native.active?.run.id === run.id)
          native.active.turnId = string(record(response.turn).id);
      }, reject);
    try {
      return await done;
    } finally {
      native.active = undefined;
      for (const [id, pending] of this.interactions)
        if (pending.native === native) this.interactions.delete(id);
    }
  }
  private event(
    native: NativeSession,
    method: string,
    params: Record<string, unknown>,
    requestId?: string | number,
  ) {
    const active = native.active;
    if (requestId !== undefined) {
      if (!active || (params.threadId && params.threadId !== native.nativeId)) {
        native.rpc.reject(requestId, "No matching active execution");
        return;
      }
      const question = method === "item/tool/requestUserInput";
      if (
        !question &&
        ![
          "item/commandExecution/requestApproval",
          "item/fileChange/requestApproval",
          "item/permissions/requestApproval",
        ].includes(method)
      ) {
        native.rpc.reject(requestId, `Unsupported request: ${method}`);
        return;
      }
      const id = randomUUID();
      this.interactions.set(id, { native, requestId, method, params });
      active.emit({
        type: "interaction",
        interaction: {
          id,
          sessionId: native.session.id,
          runId: active.run.id,
          kind: question ? "question" : "permission",
          title:
            string(params.reason) ||
            string(params.command) ||
            (question ? "Codex clarification" : "Codex permission"),
          questions: question
            ? list(params.questions).map((q) => {
                const item = record(q);
                return {
                  text: string(item.question),
                  options: list(item.options).map((o) =>
                    string(record(o).label),
                  ),
                  multiple: false,
                  allowCustom: !item.isOther
                    ? list(item.options).length === 0
                    : true,
                };
              })
            : [],
          state: "pending",
          policy: question
            ? native.session.interactionPolicy.question
            : native.session.interactionPolicy.permission,
          createdAt: new Date().toISOString(),
          resolvedAt: null,
          reply: null,
          error: null,
        },
      });
      return;
    }
    if (!active || (params.threadId && params.threadId !== native.nativeId))
      return;
    if (method === "turn/started")
      active.turnId = string(record(params.turn).id);
    if (params.turnId && active.turnId && params.turnId !== active.turnId)
      return;
    const message = active.message;
    if (method === "item/agentMessage/delta") {
      const id = string(params.itemId);
      let part = message.parts.find((p) => p.id === id && p.type === "text");
      if (!part) {
        part = { id, type: "text", text: "" };
        message.parts.push(part);
      }
      if (part.type === "text") part.text += string(params.delta);
    } else if (method === "item/started" || method === "item/completed") {
      const item = record(params.item),
        id = string(item.id),
        type = string(item.type);
      if (!id || ["userMessage", "reasoning"].includes(type)) return;
      if (type === "agentMessage") {
        const part = message.parts.find((p) => p.id === id);
        if (part?.type === "text" && typeof item.text === "string")
          part.text = item.text;
        else if (!part)
          message.parts.push({ id, type: "text", text: string(item.text) });
      } else {
        let part = message.parts.find((p) => p.id === id);
        if (!part) {
          part = {
            id,
            type: "tool",
            toolCallId: id,
            name: string(item.tool) || type,
            input: item.arguments ?? item.command ?? item.changes ?? item,
            output: "",
            state: "running",
            startedAt: new Date().toISOString(),
            finishedAt: null,
          };
          message.parts.push(part);
        }
        if (part.type === "tool") {
          part.output =
            string(item.aggregatedOutput) ||
            (item.result
              ? JSON.stringify(item.result)
              : item.changes
                ? JSON.stringify(item.changes)
                : part.output);
          if (method === "item/completed") {
            part.state = ["failed", "declined"].includes(string(item.status))
              ? "failed"
              : "completed";
            part.finishedAt = new Date().toISOString();
          }
        }
      }
    } else if (method === "item/commandExecution/outputDelta") {
      const part = message.parts.find((p) => p.id === params.itemId);
      if (part?.type === "tool") part.output += string(params.delta);
    } else if (method === "thread/tokenUsage/updated") {
      const usage = record(params.tokenUsage),
        last = record(usage.last ?? {}),
        total = record(usage.total ?? {});
      const number = (v: unknown) =>
        typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
      const fields = [
        "inputTokens",
        "outputTokens",
        "cachedInputTokens",
        "cacheWriteInputTokens",
      ];
      // Native totals include earlier turns; retain a baseline and count every model call in this Run.
      active.usageStart ??= Object.fromEntries(
        fields
          .filter(
            (key) => number(total[key]) !== null && number(last[key]) !== null,
          )
          .map((key) => [
            key,
            Math.max(0, Number(total[key]) - Number(last[key])),
          ]),
      );
      const count = (key: string) =>
        active.usageStart![key] !== undefined && number(total[key]) !== null
          ? Math.max(0, Number(total[key]) - active.usageStart![key]!)
          : number(last[key]);
      active.usage = {
        input: count("inputTokens"),
        output: count("outputTokens"),
        cacheRead: count("cachedInputTokens"),
        cacheWrite: count("cacheWriteInputTokens"),
        costUsd: null,
        source: "reported",
      };
      return;
    } else if (method === "turn/completed") {
      const turn = record(params.turn),
        status = string(turn.status),
        completed = status === "completed";
      message.completedAt = new Date().toISOString();
      message.finishReason = completed ? "stop" : status;
      for (const part of message.parts)
        if (part.type === "tool" && part.state === "running") {
          part.state = "interrupted";
          part.finishedAt = message.completedAt;
        }
      active.emit({ type: "message", message });
      active.resolve({
        outcome: completed
          ? "completed"
          : status === "interrupted"
            ? "aborted"
            : "failed",
        usage: active.usage,
        ...(turn.error
          ? {
              error: {
                code: "ENGINE_ERROR",
                message: errorDetail(
                  JSON.stringify(turn.error),
                  diagnosticSecrets(this.config),
                ),
                stage: "engine",
              },
            }
          : {}),
      });
      return;
    } else return;
    active.emit({ type: "message", message });
  }
  async reply(id: string, reply: InteractionReply) {
    const pending = this.interactions.get(id);
    if (!pending || !pending.native.active)
      throw engineError("Codex interaction expired");
    let result: unknown;
    if (pending.method === "item/tool/requestUserInput" && "answers" in reply)
      result = {
        answers: Object.fromEntries(
          list(pending.params.questions).map((q, index) => [
            string(record(q).id),
            { answers: reply.answers[index] ?? [] },
          ]),
        ),
      };
    else if (
      "decision" in reply &&
      pending.method === "item/permissions/requestApproval"
    )
      result = {
        permissions:
          reply.decision === "reject" ? {} : pending.params.permissions,
        scope: reply.decision === "always" ? "session" : "turn",
      };
    else if ("decision" in reply)
      result = {
        decision:
          reply.decision === "reject"
            ? "decline"
            : reply.decision === "always"
              ? "acceptForSession"
              : "accept",
      };
    else throw engineError("Invalid Codex interaction reply");
    pending.native.rpc.respond(pending.requestId, result);
    this.interactions.delete(id);
  }
  async abort(id: string) {
    const native = this.sessions.get(id),
      active = native?.active;
    if (!native || !active) return;
    if (!active.turnId)
      throw engineError("Codex turn has not been acknowledged");
    await native.rpc.request(
      "turn/interrupt",
      { threadId: native.nativeId, turnId: active.turnId },
      this.config.limits.abortTimeoutMs,
    );
    await within(active.done, this.config.limits.abortTimeoutMs);
  }
  async forceStop(id: string) {
    const native = this.sessions.get(id);
    if (native) await native.rpc.stop(this.config.limits.abortTimeoutMs);
    return [id];
  }
  async disposeSession(id: string) {
    await this.forceStop(id);
    this.sessions.delete(id);
    await rm(nativeSessionDirectory(this.config, this.id, id), {
      recursive: true,
      force: true,
    });
  }
  async stop() {
    this.state.status = "stopping";
    await Promise.all(
      [...this.sessions.keys()].map((id) => this.forceStop(id)),
    );
    this.sessions.clear();
    this.state.status = "unavailable";
  }
}
