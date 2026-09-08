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
  active?: {
    run: Run;
    message: Message;
    emit: (update: EngineUpdate) => void;
    done: Promise<EngineResult>;
    reject: (error: Error) => void;
    usage: Usage | null;
    cancelled: boolean;
  };
}
export class GrokAdapter implements EngineAdapter {
  readonly id = "grok";
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
      this.config.grok.command,
      ["--no-auto-update", "agent", "stdio"],
      cwd,
      env,
      true,
    );
    try {
      const init = await rpc.request(
        "initialize",
        {
          protocolVersion: 1,
          clientInfo: { name: "agentbridge", version: "0.2.0" },
          clientCapabilities: {},
        },
        this.config.limits.startupTimeoutMs,
      );
      if (init.protocolVersion !== 1)
        throw engineError("Unsupported Grok ACP protocol version");
      this.state.version = string(record(init.agentInfo ?? {}).version) || null;
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
  private async open(session: Session, nativeId?: string) {
    const env = nativeSessionEnvironment(this.config, this.id, session);
    let rpc = await this.connect(session.directory, env);
    try {
      const catalog = await rpc.request("_x.ai/skills/list", {
        cwd: session.directory,
      });
      const parseSkills = (value: Record<string, unknown>) =>
        list(record(value.result).skills).map((value) => {
          const skill = record(value);
          return { path: string(skill.path), enabled: skill.enabled !== false };
        });
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
              await rpc.request("_x.ai/skills/list", {
                cwd: session.directory,
              }),
            ),
          )
        )
          throw engineError(
            "Grok could not enforce the selected skill configuration",
          );
      }
      const result = await rpc.request(
        nativeId ? "session/load" : "session/new",
        {
          ...(nativeId ? { sessionId: nativeId } : {}),
          cwd: session.directory,
          mcpServers: [],
        },
        this.config.limits.startupTimeoutMs,
      );
      const id = nativeId ?? string(result.sessionId);
      if (
        !id ||
        (nativeId && result.sessionId && result.sessionId !== nativeId)
      )
        throw engineError("Grok session recovery mismatch");
      const model = agentConfiguration(this.config, this.id)!.defaultModel!;
      await rpc.request(
        "session/set_model",
        { sessionId: id, modelId: `${model.providerID}/${model.modelID}` },
        this.config.limits.startupTimeoutMs,
      );
      const native: NativeSession = {
        session,
        rpc,
        nativeId: id,
        generation: ++this.generation,
      };
      rpc.onMessage = (method, params, requestId) =>
        this.event(native, method, params, requestId);
      rpc.onClose = (error) =>
        native.active?.reject(
          engineError(
            "Grok process exited",
            error,
            diagnosticSecrets(this.config),
          ),
        );
      this.sessions.set(session.id, native);
      return { nativeSessionId: id, processGeneration: native.generation };
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
      throw engineError("Grok session cannot start execution");
    if (run.model)
      await native.rpc.request("session/set_model", {
        sessionId: native.nativeId,
        modelId: `${run.model.providerID}/${run.model.modelID}`,
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
    let reject!: (error: Error) => void;
    const lost = new Promise<never>((_, no) => {
      reject = no;
    });
    const response = native.rpc.request(
      "session/prompt",
      {
        sessionId: native.nativeId,
        prompt: [
          { type: "text", text: toolInstructions(session.directory) },
          ...run.inputParts.map((p) => ({ type: "text", text: p.text })),
        ],
      },
      this.config.limits.runTimeoutMs,
    );
    const done = Promise.race([response, lost]).then((result): EngineResult => {
      const active = native.active!;
      const reason = string(result.stopReason);
      const cancelled = active.cancelled || reason === "cancelled";
      const completed = reason === "end_turn";
      message.completedAt = new Date().toISOString();
      message.finishReason = completed ? "stop" : reason;
      for (const part of message.parts)
        if (part.type === "tool" && part.state === "running") {
          part.state = "interrupted";
          part.finishedAt = message.completedAt;
        }
      emit({ type: "message", message });
      return {
        outcome: cancelled ? "aborted" : completed ? "completed" : "failed",
        usage: active.usage,
        ...(!cancelled && !completed
          ? {
              error: {
                code: "ENGINE_ERROR",
                message: `Grok stopped: ${reason || "unknown"}`,
                stage: "engine",
              },
            }
          : {}),
      };
    });
    native.active = {
      run,
      message,
      emit,
      done,
      reject,
      usage: null,
      cancelled: false,
    };
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
    wireMethod: string,
    params: Record<string, unknown>,
    requestId?: string | number,
  ) {
    const active = native.active;
    const method = wireMethod.replace(/^_/, "");
    if (requestId !== undefined) {
      if (
        !active ||
        (params.sessionId && params.sessionId !== native.nativeId)
      ) {
        native.rpc.reject(requestId, "No matching active execution");
        return;
      }
      const question = method === "x.ai/ask_user_question";
      if (!question && method !== "session/request_permission") {
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
          title: question
            ? "Grok clarification"
            : string(record(params.toolCall ?? {}).title) || "Grok permission",
          questions: question
            ? list(params.questions).map((q) => {
                const item = record(q);
                return {
                  text: string(item.question),
                  options: list(item.options).map((o) =>
                    string(record(o).label),
                  ),
                  multiple:
                    item.multiSelect === true || item.multi_select === true,
                  allowCustom: true,
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
    if (
      !active ||
      method !== "session/update" ||
      params.sessionId !== native.nativeId
    )
      return;
    const update = record(params.update),
      type = string(update.sessionUpdate),
      message = active.message;
    if (type === "agent_message_chunk") {
      const content = record(update.content);
      if (content.type !== "text") return;
      let part = message.parts.at(-1);
      if (part?.type !== "text") {
        part = { id: randomUUID(), type: "text", text: "" };
        message.parts.push(part);
      }
      part.text += string(content.text);
    } else if (type === "tool_call" || type === "tool_call_update") {
      const id = string(update.toolCallId);
      if (!id) throw engineError("Grok tool call is missing its ID");
      let part = message.parts.find((p) => p.id === id);
      if (!part) {
        part = {
          id,
          type: "tool",
          toolCallId: id,
          name: string(update.title) || string(update.kind) || "tool",
          input: update.rawInput ?? {},
          output: "",
          state: "running",
          startedAt: new Date().toISOString(),
          finishedAt: null,
        };
        message.parts.push(part);
      }
      if (part.type === "tool") {
        if (typeof update.title === "string") part.name = update.title;
        if (update.rawInput !== undefined) part.input = update.rawInput;
        if (update.rawOutput !== undefined)
          part.output =
            typeof update.rawOutput === "string"
              ? update.rawOutput
              : JSON.stringify(update.rawOutput);
        else if (Array.isArray(update.content))
          part.output = update.content
            .map((v) => {
              const c = record(v);
              return c.type === "content"
                ? string(record(c.content).text)
                : JSON.stringify(c);
            })
            .join("\n");
        if (["completed", "failed"].includes(string(update.status))) {
          part.state = update.status === "failed" ? "failed" : "completed";
          part.finishedAt = new Date().toISOString();
        }
      }
    } else return;
    active.emit({ type: "message", message });
  }
  async reply(id: string, reply: InteractionReply) {
    const pending = this.interactions.get(id);
    if (!pending?.native.active) throw engineError("Grok interaction expired");
    let result: unknown;
    if (pending.method === "x.ai/ask_user_question" && "answers" in reply) {
      const answers: Record<string, string[]> = {},
        annotations: Record<string, { notes: string }> = {};
      list(pending.params.questions).forEach((q, index) => {
        const question = record(q),
          key = string(question.question),
          options = list(question.options).map((o) => string(record(o).label));
        const values = reply.answers[index] ?? [],
          custom = values.filter((v) => !options.includes(v));
        answers[key] = [
          ...values.filter((v) => options.includes(v)),
          ...(custom.length ? ["Other"] : []),
        ];
        if (custom.length) annotations[key] = { notes: custom.join("\n") };
      });
      result = { outcome: "accepted", answers, annotations };
    } else if (
      "decision" in reply &&
      pending.method === "session/request_permission"
    ) {
      const kind =
        reply.decision === "reject"
          ? "reject_once"
          : reply.decision === "always"
            ? "allow_always"
            : "allow_once";
      const options = list(pending.params.options).map(record);
      const option =
        options.find((o) => o.kind === kind) ??
        (reply.decision === "always"
          ? options.find((o) => o.kind === "allow_once")
          : undefined);
      if (!option && reply.decision !== "reject")
        throw engineError("Grok did not offer this permission decision");
      result = {
        outcome: option
          ? { outcome: "selected", optionId: option.optionId }
          : { outcome: "cancelled" },
      };
    } else throw engineError("Invalid Grok interaction reply");
    pending.native.rpc.respond(pending.requestId, result);
    this.interactions.delete(id);
  }
  async abort(id: string) {
    const native = this.sessions.get(id),
      active = native?.active;
    if (!native || !active) return;
    active.cancelled = true;
    native.rpc.send({
      method: "session/cancel",
      params: { sessionId: native.nativeId },
    });
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
