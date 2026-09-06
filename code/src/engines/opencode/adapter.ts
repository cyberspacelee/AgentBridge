import { randomBytes, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { createParser } from "eventsource-parser";
import { z } from "zod";
import type { Config } from "../../config.js";
import type { EngineAdapter, EngineResult, EngineUpdate } from "../adapter.js";
import type {
  EngineHealth,
  Interaction,
  InteractionReply,
  Message,
  MessagePart,
  Run,
  Session,
  Usage,
} from "../../../shared/contracts.js";
import { engineError } from "../../errors.js";
import { within } from "../../async.js";
import { startProcess, stopProcess } from "../process.js";
import { toolInstructions } from "../tool-instructions.js";

const object = (v: unknown) => z.record(z.string(), z.unknown()).parse(v);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const timestamp = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v)
    ? new Date(v).toISOString()
    : new Date().toISOString();
interface NativeSession {
  session: Session;
  nativeId: string;
  active?: {
    run: Run;
    parentId: string;
    emit: (event: EngineUpdate) => void;
    messages: Map<string, Message>;
    cancelled: boolean;
    submission?: Promise<unknown>;
  };
}

export class OpenCodeAdapter implements EngineAdapter {
  readonly id = "opencode";
  private sessions = new Map<string, NativeSession>();
  private interactions = new Map<
    string,
    { nativeId: string; sessionId: string; kind: "permission" | "question" }
  >();
  private child?: ChildProcessWithoutNullStreams;
  private stream = new AbortController();
  private streamJob?: Promise<void>;
  private generation = 0;
  private password: string;
  private state: EngineHealth = {
    status: "starting",
    version: null,
    message: null,
    processes: 0,
    restarts: 0,
  };
  constructor(private config: Config) {
    this.password =
      config.opencode.password ||
      (config.opencode.managed ? randomBytes(24).toString("hex") : "");
  }
  health() {
    return { ...this.state };
  }
  unavailableSessions() {
    return this.state.status === "ready" ? [] : [...this.sessions.keys()];
  }
  private url(route: string, directory?: string) {
    const url = new URL(route, this.config.opencode.url);
    if (directory) url.searchParams.set("directory", directory);
    return url;
  }
  private headers() {
    return {
      "content-type": "application/json",
      ...(this.password
        ? {
            authorization: `Basic ${Buffer.from(`${this.config.opencode.username}:${this.password}`).toString("base64")}`,
          }
        : {}),
    };
  }
  private async request(
    route: string,
    method = "GET",
    body?: unknown,
    directory?: string,
    timeout = this.config.limits.startupTimeoutMs,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(this.url(route, directory), {
        method,
        headers: this.headers(),
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeout),
      });
    } catch {
      throw engineError("OpenCode transport failed");
    }
    if (!response.ok)
      throw engineError(
        `OpenCode ${method} operation returned HTTP ${response.status}`,
      );
    if (response.status === 204) return null;
    try {
      return await response.json();
    } catch {
      throw engineError("OpenCode returned invalid JSON");
    }
  }
  async start() {
    await mkdir(this.config.dataDirectory, { recursive: true });
    this.stream = new AbortController();
    this.state.status = "starting";
    if (this.generation) this.state.restarts++;
    if (this.config.opencode.managed) {
      const url = new URL(this.config.opencode.url);
      this.child = startProcess(
        this.config.opencode.command,
        ["serve", "--hostname", url.hostname, "--port", url.port || "4096"],
        this.config.dataDirectory,
        {
          ...process.env,
          OPENCODE_SERVER_USERNAME: this.config.opencode.username,
          OPENCODE_SERVER_PASSWORD: this.password,
        },
      );
      this.child.stdout.resume();
      this.child.on("error", () => {
        this.state.status = "unavailable";
        this.state.message = "OpenCode executable could not start";
      });
      this.child.on("exit", () => {
        this.state.status = "unavailable";
        this.state.processes = 0;
        this.state.message = "OpenCode process exited";
      });
    }
    try {
      const until = Date.now() + this.config.limits.startupTimeoutMs;
      let health: Record<string, unknown> | undefined;
      while (Date.now() < until) {
        if (
          this.child &&
          (this.child.exitCode !== null || this.child.signalCode !== null)
        )
          break;
        try {
          health = object(
            await this.request(
              "/global/health",
              "GET",
              undefined,
              undefined,
              1000,
            ),
          );
          if (health.healthy === true) break;
        } catch {
          await delay(200);
        }
      }
      if (health?.healthy !== true)
        throw engineError("OpenCode health check failed");
      const response = await within(
        fetch(this.url("/global/event"), {
          headers: this.headers(),
          signal: this.stream.signal,
        }),
        this.config.limits.startupTimeoutMs,
      );
      if (!response.ok || !response.body)
        throw engineError("OpenCode event stream unavailable");
      this.generation++;
      this.state = {
        ...this.state,
        status: "ready",
        version: str(health.version),
        message: null,
        processes: this.config.opencode.managed ? 1 : 0,
      };
      this.streamJob = this.consume(response).catch(() => {
        if (!this.stream.signal.aborted) {
          this.state.status = "degraded";
          this.state.message = "OpenCode event stream disconnected";
        }
      });
    } catch (error) {
      this.state.status = "unavailable";
      this.state.message = "OpenCode is unavailable";
      this.stream.abort();
      if (this.child)
        await stopProcess(this.child, this.config.limits.abortTimeoutMs).catch(
          () => {},
        );
      throw error;
    }
  }
  private async consume(response: Response) {
    const parser = createParser({
      onEvent: (event) => {
        const value = object(JSON.parse(event.data));
        this.event(object(value.payload ?? value));
      },
    });
    const decoder = new TextDecoder();
    for await (const chunk of response.body!)
      parser.feed(decoder.decode(chunk, { stream: true }));
    parser.feed(decoder.decode());
    if (!this.stream.signal.aborted) throw engineError("OpenCode SSE ended");
  }
  async createSession(session: Session) {
    const native = object(
      await this.request(
        "/session",
        "POST",
        {
          title: session.title,
          ...(session.interactionPolicy.permission === "manual"
            ? { permission: [{ permission: "*", pattern: "*", action: "ask" }] }
            : {}),
        },
        session.directory,
      ),
    );
    const nativeId = z.string().min(1).parse(native.id);
    this.sessions.set(session.id, { session, nativeId });
    return { nativeSessionId: nativeId, processGeneration: this.generation };
  }
  async recoverSession(id: string) {
    const native = this.sessions.get(id);
    if (!native || this.state.status !== "ready") return null;
    const session = object(
      await this.request(
        `/session/${encodeURIComponent(native.nativeId)}`,
        "GET",
        undefined,
        native.session.directory,
      ),
    );
    if (session.id !== native.nativeId)
      throw engineError("OpenCode session recovery mismatch");
    return {
      nativeSessionId: native.nativeId,
      processGeneration: this.generation,
    };
  }
  private native(sessionId: string) {
    const native = this.sessions.get(sessionId);
    if (!native) throw engineError("OpenCode session context is unavailable");
    return native;
  }
  private usage(info: Record<string, unknown>): Usage | null {
    if (!info.tokens) return null;
    const tokens = object(info.tokens);
    const cache = tokens.cache ? object(tokens.cache) : {};
    const num = (v: unknown) =>
      typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
    return {
      input: num(tokens.input),
      output: num(tokens.output),
      cacheRead: num(cache.read),
      cacheWrite: num(cache.write),
      costUsd: num(info.cost),
      source: "reported",
    };
  }
  private info(
    native: NativeSession,
    info: Record<string, unknown>,
  ): Message | undefined {
    const active = native.active;
    if (
      !active ||
      info.role !== "assistant" ||
      info.parentID !== active.parentId
    )
      return;
    const nativeId = z.string().parse(info.id);
    const time = object(info.time);
    const message = active.messages.get(nativeId) ?? {
      id: `${active.run.id}:${nativeId}`,
      sessionId: native.session.id,
      runId: active.run.id,
      role: "assistant",
      createdAt: timestamp(time.created),
      completedAt: null,
      finishReason: null,
      parts: [],
    };
    message.completedAt = time.completed ? timestamp(time.completed) : null;
    message.finishReason = info.error
      ? "error"
      : typeof info.finish === "string"
        ? info.finish
        : null;
    active.messages.set(nativeId, message);
    return message;
  }
  private part(
    native: NativeSession,
    p: Record<string, unknown>,
  ): MessagePart | undefined {
    const active = native.active;
    if (!active) return;
    const id = `${active.run.id}:${z.string().parse(p.id)}`;
    if (p.type === "text")
      return { id, type: "text", text: z.string().parse(p.text) };
    if (p.type === "step-finish")
      return {
        id,
        type: "step-finish",
        reason: str(p.reason),
        usage: this.usage(p),
      };
    if (p.type === "tool") {
      const state = object(p.state);
      const time = state.time ? object(state.time) : {};
      const status = z
        .enum(["pending", "running", "completed", "error"])
        .parse(state.status);
      return {
        id,
        type: "tool",
        toolCallId: z.string().parse(p.callID),
        name: z.string().parse(p.tool),
        input: state.input ?? {},
        output: str(state.output ?? state.error),
        state: status === "error" ? "failed" : status,
        startedAt: time.start ? timestamp(time.start) : null,
        finishedAt: time.end ? timestamp(time.end) : null,
      };
    }
  }
  private event(event: Record<string, unknown>) {
    if (!event.properties) return;
    const properties = object(event.properties);
    const part = properties.part ? object(properties.part) : undefined;
    const info = properties.info ? object(properties.info) : undefined;
    const sessionId =
      properties.sessionID ?? part?.sessionID ?? info?.sessionID;
    const native = [...this.sessions.values()].find(
      (s) => s.nativeId === sessionId,
    );
    const active = native?.active;
    if (!native || !active || active.cancelled) return;
    if (event.type === "message.updated" && info) {
      const message = this.info(native, info);
      if (message)
        active.emit({ type: "message", message: structuredClone(message) });
    } else if (event.type === "message.part.updated" && part) {
      const message = active.messages.get(str(part.messageID));
      const normalized = this.part(native, part);
      if (!message || !normalized) return;
      const index = message.parts.findIndex((p) => p.id === normalized.id);
      if (index < 0) message.parts.push(normalized);
      else message.parts[index] = normalized;
      active.emit({ type: "message", message: structuredClone(message) });
    } else if (event.type === "message.part.delta") {
      const message = active.messages.get(str(properties.messageID));
      const target = message?.parts.find(
        (p) => p.id === `${active.run.id}:${str(properties.partID)}`,
      );
      if (message && target?.type === "text" && properties.field === "text") {
        target.text += z.string().parse(properties.delta);
        active.emit({ type: "message", message: structuredClone(message) });
      }
    } else if (
      event.type === "permission.asked" ||
      event.type === "question.asked"
    ) {
      const id = randomUUID();
      const kind =
        event.type === "permission.asked" ? "permission" : "question";
      const interaction: Interaction = {
        id,
        sessionId: native.session.id,
        runId: active.run.id,
        kind,
        title: str(properties.permission) || "Agent question",
        questions:
          kind === "question"
            ? z
                .array(z.record(z.string(), z.unknown()))
                .parse(properties.questions)
                .map((q) => ({
                  text: z.string().parse(q.question),
                  options: z
                    .array(z.record(z.string(), z.unknown()))
                    .parse(q.options)
                    .map((o) => z.string().parse(o.label)),
                  multiple: q.multiple === true,
                  allowCustom: q.custom !== false,
                }))
            : [],
        state: "pending",
        policy: native.session.interactionPolicy[kind],
        createdAt: new Date().toISOString(),
        resolvedAt: null,
        reply: null,
        error: null,
      };
      this.interactions.set(id, {
        nativeId: z.string().parse(properties.id),
        sessionId: native.session.id,
        kind,
      });
      active.emit({ type: "interaction", interaction });
    }
  }
  async run(
    session: Session,
    run: Run,
    emit: (update: EngineUpdate) => void,
  ): Promise<EngineResult> {
    const native = this.native(session.id);
    if (native.active) throw engineError("OpenCode session is already running");
    const active: NonNullable<NativeSession["active"]> = {
      run,
      emit,
      messages: new Map<string, Message>(),
      parentId: `msg_${Date.now().toString(16)}${randomBytes(12).toString("hex")}`,
      cancelled: false,
    };
    native.active = active;
    try {
      active.submission = this.request(
        `/session/${encodeURIComponent(native.nativeId)}/message`,
        "POST",
        {
          messageID: active.parentId,
          system: toolInstructions(session.directory),
          parts: run.inputParts,
          ...(run.model ? { model: run.model } : {}),
        },
        session.directory,
        this.config.limits.runTimeoutMs + this.config.limits.abortTimeoutMs,
      );
      await active.submission;
      if (active.cancelled) return { outcome: "aborted" };
      const messages = z
        .array(z.record(z.string(), z.unknown()))
        .parse(
          await this.request(
            `/session/${encodeURIComponent(native.nativeId)}/message`,
            "GET",
            undefined,
            session.directory,
          ),
        );
      let last: Message | undefined;
      const usages: Usage[] = [];
      for (const record of messages) {
        const info = object(record.info);
        const message = this.info(native, info);
        if (!message) continue;
        message.parts = z
          .array(z.record(z.string(), z.unknown()))
          .parse(record.parts)
          .flatMap((p) => {
            const normalized = this.part(native, p);
            return normalized ? [normalized] : [];
          });
        emit({ type: "message", message });
        last = message;
        const usage = this.usage(info);
        if (usage) usages.push(usage);
      }
      const sum = (key: keyof Omit<Usage, "source">) =>
        usages.length && usages.every((u) => u[key] !== null)
          ? usages.reduce((n, u) => n + (u[key] ?? 0), 0)
          : null;
      return {
        outcome: last?.finishReason === "stop" ? "completed" : "failed",
        usage: usages.length
          ? {
              input: sum("input"),
              output: sum("output"),
              cacheRead: sum("cacheRead"),
              cacheWrite: sum("cacheWrite"),
              costUsd: sum("costUsd"),
              source: "reported",
            }
          : null,
      };
    } finally {
      if (native.active === active) native.active = undefined;
    }
  }
  async abort(sessionId: string) {
    const native = this.sessions.get(sessionId);
    if (!native) return;
    const active = native.active;
    if (active) active.cancelled = true;
    await this.request(
      `/session/${encodeURIComponent(native.nativeId)}/abort`,
      "POST",
      {},
      native.session.directory,
      this.config.limits.abortTimeoutMs,
    );
    // Cancellation may reach the server before the prompt request on another connection.
    if (active?.submission)
      await within(
        active.submission.catch(() => {}),
        this.config.limits.abortTimeoutMs,
      );
    const until = Date.now() + this.config.limits.abortTimeoutMs;
    while (Date.now() < until) {
      const statuses = object(
        await this.request(
          "/session/status",
          "GET",
          undefined,
          native.session.directory,
        ),
      );
      if (
        !statuses[native.nativeId] ||
        object(statuses[native.nativeId]).type === "idle"
      )
        return;
      await delay(50);
    }
    throw engineError("OpenCode did not confirm idle after cancellation");
  }
  async forceStop() {
    if (!this.child)
      throw engineError(
        "Cannot terminate an externally managed OpenCode process",
      );
    const affected = [...this.sessions.keys()];
    this.stream.abort();
    await stopProcess(this.child, this.config.limits.abortTimeoutMs);
    return affected;
  }
  async reply(id: string, reply: InteractionReply) {
    const interaction = this.interactions.get(id);
    if (!interaction) throw engineError("OpenCode interaction not found");
    const native = this.native(interaction.sessionId);
    await this.request(
      `/${interaction.kind}/${encodeURIComponent(interaction.nativeId)}/reply`,
      "POST",
      "decision" in reply
        ? { reply: reply.decision }
        : { answers: reply.answers },
      native.session.directory,
    );
    this.interactions.delete(id);
  }
  async disposeSession(sessionId: string) {
    const native = this.sessions.get(sessionId);
    if (!native) return;
    if (this.state.status === "ready" || !this.config.opencode.managed)
      await this.request(
        `/session/${encodeURIComponent(native.nativeId)}`,
        "DELETE",
        undefined,
        native.session.directory,
      );
    this.sessions.delete(sessionId);
    for (const [id, interaction] of this.interactions)
      if (interaction.sessionId === sessionId) this.interactions.delete(id);
  }
  async stop() {
    this.state.status = "stopping";
    this.stream.abort();
    if (this.child)
      await stopProcess(this.child, this.config.limits.abortTimeoutMs);
    else
      await Promise.all(
        [...this.sessions.keys()].map((id) => this.disposeSession(id)),
      );
    await this.streamJob;
  }
}
