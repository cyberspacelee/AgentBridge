import { randomUUID } from "node:crypto";
import path from "node:path";
import { mkdir, open, rm, writeFile } from "node:fs/promises";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { z } from "zod";
import type { Config } from "../../config.js";
import type {
  EngineAdapter,
  EngineBindingResult,
  EngineResult,
  EngineUpdate,
} from "../adapter.js";
import type {
  EngineHealth,
  Interaction,
  InteractionReply,
  Message,
  Run,
  Session,
  ToolPart,
  Usage,
} from "../../../shared/contracts.js";
import { engineError } from "../../errors.js";
import { within } from "../../async.js";
import {
  readJsonLines,
  startProcess,
  stopProcess,
  processDiagnostic,
} from "../process.js";
import { codeRoot, toolInstructions } from "../tool-instructions.js";
import {
  piDirectory,
  syncPiMcp,
  piProviders,
  readSettings,
  diagnosticSecrets,
} from "../../settings.js";

const object = (v: unknown) => z.record(z.string(), z.unknown()).parse(v);
const text = (v: unknown) => (typeof v === "string" ? v : "");
const contentText = (v: unknown): string =>
  typeof v === "string"
    ? v
    : Array.isArray(v)
      ? v.map((x) => text(object(x).text)).join("\n")
      : "";
const usageOf = (v: unknown): Usage | null => {
  if (!v || typeof v !== "object") return null;
  const u = object(v);
  const number = (n: unknown) =>
    typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
  return {
    input: number(u.input),
    output: number(u.output),
    cacheRead: number(u.cacheRead),
    cacheWrite: number(u.cacheWrite),
    costUsd: u.cost ? number(object(u.cost).total) : null,
    source: "reported",
  };
};
interface RpcSession {
  session: Session;
  child: ChildProcessWithoutNullStreams;
  generation: number;
  nativeId: string;
  pending: Map<
    string,
    {
      resolve: (value: Record<string, unknown>) => void;
      reject: (error: Error) => void;
    }
  >;
  active?: {
    run: Run;
    emit: (event: EngineUpdate) => void;
    resolve: (value: EngineResult) => void;
    reject: (error: Error) => void;
    message?: Message;
    messages: Message[];
    usage: Map<string, Usage>;
    cancelled: boolean;
    error?: EngineResult["error"];
  };
  interactions: Map<string, { nativeId: string; method: string }>;
  closed: boolean;
}
export class PiAdapter implements EngineAdapter {
  readonly id = "pi";
  private sessions = new Map<string, RpcSession>();
  private state: EngineHealth = {
    status: "starting",
    version: null,
    message: null,
    processes: 0,
    restarts: 0,
  };
  private generation = 0;
  constructor(private config: Config) {}
  private get configDirectory() {
    return piDirectory(this.config);
  }
  async models() {
    const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
    const models = await ModelRuntime.create({
      authPath: path.join(this.configDirectory, "auth.json"),
      modelsPath: path.join(this.configDirectory, "models.json"),
      modelsStorePath: path.join(this.configDirectory, "models-store.json"),
      allowModelNetwork: false,
    });
    for (const [id, provider] of Object.entries(piProviders(this.config)))
      models.registerProvider(id, provider);
    if (models.getError())
      throw engineError(
        "Pi model configuration could not be loaded",
        models.getError(),
        diagnosticSecrets(this.config),
      );
    return (await models.getAvailable()).map((model) => ({
      providerID: model.provider,
      modelID: model.id,
      name: model.name,
    }));
  }
  health() {
    return {
      ...this.state,
      processes: [...this.sessions.values()].filter((s) => !s.closed).length,
    };
  }
  unavailableSessions() {
    return [...this.sessions].filter(([, rpc]) => rpc.closed).map(([id]) => id);
  }
  async start() {
    await mkdir(this.config.dataDirectory, { recursive: true });
    const child = startProcess(
      this.config.pi.command,
      ["--version"],
      this.config.dataDirectory,
    );
    let version = "";
    child.stdout.on("data", (chunk) => {
      version = (version + String(chunk)).slice(0, 100);
    });
    try {
      await within(
        new Promise<void>((resolve, reject) => {
          child.once("error", (error) =>
            reject(
              engineError(
                "Pi executable could not be started",
                error,
                diagnosticSecrets(this.config),
              ),
            ),
          );
          child.once("exit", (code) =>
            code === 0
              ? resolve()
              : reject(
                  engineError(
                    "Pi version check failed",
                    processDiagnostic(child),
                    diagnosticSecrets(this.config),
                  ),
                ),
          );
        }),
        this.config.limits.startupTimeoutMs,
      );
      this.state = {
        ...this.state,
        status: "ready",
        version: version.trim(),
        message: null,
      };
    } catch (error) {
      this.state = {
        ...this.state,
        status: "unavailable",
        message: engineError(
          "Pi executable is unavailable",
          error,
          diagnosticSecrets(this.config),
        ).message,
      };
      await stopProcess(child, this.config.limits.abortTimeoutMs).catch(
        () => {},
      );
      throw error;
    }
  }
  async createSession(session: Session) {
    await mkdir(path.join(this.config.dataDirectory, "pi-sessions"), {
      recursive: true,
    });
    // Pi initializes an existing empty file immediately, before the first model response.
    await writeFile(this.sessionFile(session.id), "", { flag: "wx" });
    return this.openSession(session);
  }
  private sessionFile(id: string) {
    return path.join(this.config.dataDirectory, "pi-sessions", `${id}.jsonl`);
  }
  private async openSession(session: Session, expectedNativeId?: string) {
    const settings = readSettings(this.config);
    const mcpEnvironment = syncPiMcp(this.config, settings);
    const child = startProcess(
      this.config.pi.command,
      [
        "--mode",
        "rpc",
        "--session",
        this.sessionFile(session.id),
        "--extension",
        path.join(codeRoot, "tools/pi-extension.mjs"),
        ...settings.skills
          .filter((skill) => skill.enabled && skill.engine !== "opencode")
          .flatMap((skill) => ["--skill", skill.path]),
        "--no-prompt-templates",
        "--no-context-files",
        "--offline",
        "--append-system-prompt",
        toolInstructions(session.directory),
        ...this.config.pi.args,
      ],
      session.directory,
      {
        ...process.env,
        ...mcpEnvironment,
        PI_CODING_AGENT_DIR: this.configDirectory,
        PI_TELEMETRY: "0",
        AGENT_BRIDGE_PERMISSION_POLICY: session.interactionPolicy.permission,
        AGENT_BRIDGE_PROVIDERS: JSON.stringify(piProviders(this.config)),
      },
    );
    const rpc: RpcSession = {
      session,
      child,
      generation: ++this.generation,
      nativeId: "",
      pending: new Map(),
      interactions: new Map(),
      closed: false,
    };
    this.sessions.set(session.id, rpc);
    const fail = (error: Error) => {
      rpc.closed = true;
      for (const p of rpc.pending.values()) p.reject(error);
      rpc.pending.clear();
      rpc.active?.reject(error);
      rpc.active = undefined;
    };
    child.once("error", (error) =>
      fail(
        engineError(
          "Pi process could not start",
          error,
          diagnosticSecrets(this.config),
        ),
      ),
    );
    child.once("exit", () =>
      fail(
        engineError(
          "Pi process exited",
          processDiagnostic(child),
          diagnosticSecrets(this.config),
        ),
      ),
    );
    readJsonLines(
      child.stdout,
      (value) => this.event(rpc, object(value)),
      (error) => {
        fail(error);
        void stopProcess(child, this.config.limits.abortTimeoutMs).catch(
          () => {},
        );
      },
    );
    try {
      const state = await this.command(rpc, "get_state");
      rpc.nativeId = z.string().min(1).parse(object(state.data).sessionId);
      if (expectedNativeId && rpc.nativeId !== expectedNativeId)
        throw engineError("Pi session recovery mismatch");
      const commands = object(
        (await this.command(rpc, "get_commands")).data,
      ).commands;
      if (
        !Array.isArray(commands) ||
        !commands.some((command) => object(command).name === "bridge_health")
      )
        throw engineError("Pi interaction extension did not load");
      if (
        settings.mcp.some((m) => m.engine !== "opencode" && m.enabled) &&
        !commands.some((command) => object(command).name === "mcp")
      )
        throw engineError(
          "Pi MCP is configured but pi-mcp-adapter did not load; install the extension in the selected Pi directory",
          processDiagnostic(child),
          diagnosticSecrets(this.config),
        );
      return {
        nativeSessionId: rpc.nativeId,
        processGeneration: rpc.generation,
      };
    } catch (error) {
      await stopProcess(rpc.child, this.config.limits.abortTimeoutMs);
      this.sessions.delete(session.id);
      throw error;
    }
  }
  async recoverSession(session: Session, binding: EngineBindingResult) {
    if (this.state.status !== "ready") return null;
    const rpc = this.sessions.get(session.id);
    if (rpc) {
      await stopProcess(rpc.child, this.config.limits.abortTimeoutMs);
      this.state.restarts++;
    }
    // Validate the persisted identity before Pi can append startup records.
    const file = await open(this.sessionFile(session.id), "r");
    try {
      let header: Record<string, unknown> | undefined;
      for await (const line of file.readLines()) {
        header = object(JSON.parse(line));
        break;
      }
      if (
        header?.type !== "session" ||
        header.id !== binding.nativeSessionId ||
        header.cwd !== session.directory
      )
        throw engineError("Pi session recovery mismatch");
    } finally {
      await file.close();
    }
    return this.openSession(session, binding.nativeSessionId);
  }
  private command(
    rpc: RpcSession,
    type: string,
    args: Record<string, unknown> = {},
  ) {
    if (rpc.closed)
      return Promise.reject(engineError("Pi session is unavailable"));
    const id = randomUUID();
    return within(
      new Promise<Record<string, unknown>>((resolve, reject) => {
        rpc.pending.set(id, { resolve, reject });
        rpc.child.stdin.write(
          JSON.stringify({ id, type, ...args }) + "\n",
          (error) => {
            if (error) {
              rpc.pending.delete(id);
              reject(engineError("Pi command write failed"));
            }
          },
        );
      }),
      this.config.limits.startupTimeoutMs,
    ).finally(() => rpc.pending.delete(id));
  }
  async run(
    session: Session,
    run: Run,
    emit: (update: EngineUpdate) => void,
  ): Promise<EngineResult> {
    const rpc = this.sessions.get(session.id);
    if (!rpc || rpc.closed || rpc.active)
      throw engineError("Pi session cannot start this run");
    return new Promise((resolve, reject) => {
      const active = {
        run,
        emit,
        resolve,
        reject,
        messages: [],
        usage: new Map(),
        cancelled: false,
      };
      rpc.active = active;
      void (async () => {
        if (run.model)
          await this.command(rpc, "set_model", {
            provider: run.model.providerID,
            modelId: run.model.modelID,
          });
        if (active.cancelled || rpc.active !== active) return;
        await this.command(rpc, "prompt", {
          message: run.inputParts.map((p) => p.text).join("\n"),
        });
      })().catch((error) => {
        if (rpc.active === active) rpc.active = undefined;
        reject(error);
      });
    });
  }
  private publish(rpc: RpcSession) {
    const a = rpc.active;
    if (a?.message)
      a.emit({ type: "message", message: structuredClone(a.message) });
  }
  private event(rpc: RpcSession, event: Record<string, unknown>) {
    if (event.type === "response") {
      const request = rpc.pending.get(text(event.id));
      if (!request) return;
      rpc.pending.delete(text(event.id));
      event.success === true
        ? request.resolve(event)
        : request.reject(
            engineError(
              `Pi ${text(event.command)} failed`,
              event.error,
              diagnosticSecrets(this.config),
            ),
          );
      return;
    }
    const a = rpc.active;
    if (!a) return;
    const at = new Date().toISOString();
    if (event.type === "message_start") {
      const native = object(event.message);
      if (native.role !== "assistant") return;
      a.message = {
        id: `${a.run.id}:message:${a.messages.length}`,
        sessionId: rpc.session.id,
        runId: a.run.id,
        role: "assistant",
        createdAt: at,
        completedAt: null,
        finishReason: null,
        parts: [],
      };
      a.messages.push(a.message);
      this.publish(rpc);
    } else if (event.type === "message_update" && a.message) {
      const delta = object(event.assistantMessageEvent);
      if (delta.type !== "text_delta") return;
      const index = z.number().int().nonnegative().parse(delta.contentIndex);
      const id = `${a.message.id}:part:${index}`;
      if (delta.type === "text_delta") {
        let part = a.message.parts.find((p) => p.id === id);
        if (!part) {
          part = { id, type: "text", text: "" };
          a.message.parts.push(part);
        }
        if (part.type === "text") part.text += z.string().parse(delta.delta);
      }
      this.publish(rpc);
    } else if (event.type === "message_end") {
      const native = object(event.message);
      if (native.role !== "assistant" || !a.message) return;
      const content = z
        .array(z.record(z.string(), z.unknown()))
        .parse(native.content);
      content.forEach((part, index) => {
        const id = `${a.message!.id}:part:${index}`;
        if (part.type === "text") {
          const found = a.message!.parts.find((p) => p.id === id);
          if (found?.type === "text") found.text = z.string().parse(part.text);
          else
            a.message!.parts.push({
              id,
              type: "text",
              text: z.string().parse(part.text),
            });
        } else if (
          part.type === "toolCall" &&
          !a.message!.parts.some(
            (p) => p.type === "tool" && p.toolCallId === part.id,
          )
        )
          a.message!.parts.push({
            id,
            type: "tool",
            toolCallId: z.string().parse(part.id),
            name: z.string().parse(part.name),
            input: part.arguments,
            output: "",
            state: "pending",
            startedAt: null,
            finishedAt: null,
          });
      });
      a.message.finishReason = text(native.stopReason);
      a.error =
        native.stopReason === "error"
          ? engineError(
              "Pi model request failed",
              native.errorMessage || "Assistant stopped with an error",
              diagnosticSecrets(this.config),
            )
          : undefined;
      a.message.completedAt = at;
      const usage = usageOf(native.usage);
      if (usage) a.usage.set(a.message.id, usage);
      this.publish(rpc);
    } else if (
      [
        "tool_execution_start",
        "tool_execution_update",
        "tool_execution_end",
      ].includes(text(event.type))
    ) {
      const nativeId = z.string().parse(event.toolCallId);
      const message = a.messages.find((m) =>
        m.parts.some((p) => p.type === "tool" && p.toolCallId === nativeId),
      );
      const part = message?.parts.find(
        (p) => p.type === "tool" && p.toolCallId === nativeId,
      ) as ToolPart | undefined;
      if (!message || !part)
        throw engineError("Pi tool result has no matching call");
      if (event.type === "tool_execution_start") {
        part.state = "running";
        part.startedAt = at;
      }
      if (event.type === "tool_execution_update")
        part.output = contentText(object(event.partialResult).content);
      if (event.type === "tool_execution_end") {
        part.output = contentText(object(event.result).content);
        part.state = event.isError === true ? "failed" : "completed";
        part.finishedAt = at;
      }
      a.emit({ type: "message", message: structuredClone(message) });
    } else if (event.type === "extension_ui_request") {
      const method = text(event.method);
      if (!["confirm", "select", "input", "editor"].includes(method)) return;
      const id = randomUUID();
      const nativeId = z.string().parse(event.id);
      rpc.interactions.set(id, { nativeId, method });
      const kind =
        method === "confirm" ||
        (method === "select" &&
          text(event.title).startsWith("AgentBridge permission: "))
          ? "permission"
          : "question";
      const interaction: Interaction = {
        id,
        sessionId: rpc.session.id,
        runId: a.run.id,
        kind,
        title: text(event.title),
        questions:
          kind === "permission"
            ? []
            : [
                {
                  text: text(event.title),
                  options: Array.isArray(event.options)
                    ? z.array(z.string()).parse(event.options)
                    : [],
                  multiple: false,
                  allowCustom: method !== "select",
                },
              ],
        state: "pending",
        policy: rpc.session.interactionPolicy[kind],
        createdAt: at,
        resolvedAt: null,
        reply: null,
        error: null,
      };
      a.emit({ type: "interaction", interaction });
    } else if (event.type === "agent_settled") {
      const last = a.messages.at(-1);
      const usage = [...a.usage.values()];
      const sum = (key: keyof Omit<Usage, "source">) =>
        usage.length && usage.every((u) => u[key] !== null)
          ? usage.reduce((n, u) => n + (u[key] ?? 0), 0)
          : null;
      rpc.active = undefined;
      a.resolve({
        ...(last?.finishReason !== "stop" && last?.finishReason !== "aborted"
          ? {
              error:
                a.error ??
                engineError(
                  `Pi ended without completion (stopReason=${last?.finishReason || "missing"})`,
                ),
            }
          : {}),
        outcome:
          last?.finishReason === "stop"
            ? "completed"
            : last?.finishReason === "aborted"
              ? "aborted"
              : "failed",
        usage: usage.length
          ? {
              input: sum("input"),
              output: sum("output"),
              cacheRead: sum("cacheRead"),
              cacheWrite: sum("cacheWrite"),
              costUsd: sum("costUsd"),
              source: "reported",
            }
          : null,
      });
    }
  }
  async abort(sessionId: string) {
    const rpc = this.sessions.get(sessionId);
    if (!rpc || rpc.closed) return;
    if (rpc.active) rpc.active.cancelled = true;
    await this.command(rpc, "abort");
    rpc.active?.resolve({ outcome: "aborted" });
    rpc.active = undefined;
  }
  async forceStop(sessionId: string) {
    const rpc = this.sessions.get(sessionId);
    if (rpc) await stopProcess(rpc.child, this.config.limits.abortTimeoutMs);
    return [sessionId];
  }
  async reply(id: string, reply: InteractionReply) {
    const rpc = [...this.sessions.values()].find((s) => s.interactions.has(id));
    const native = rpc?.interactions.get(id);
    if (!rpc || !native) throw engineError("Pi interaction is unavailable");
    const response =
      "decision" in reply
        ? native.method === "select"
          ? { value: reply.decision }
          : { confirmed: reply.decision !== "reject" }
        : { value: reply.answers[0]?.[0] ?? "" };
    await new Promise<void>((resolve, reject) =>
      rpc.child.stdin.write(
        JSON.stringify({
          type: "extension_ui_response",
          id: native.nativeId,
          ...response,
        }) + "\n",
        (error) => (error ? reject(engineError("Pi reply failed")) : resolve()),
      ),
    );
    rpc.interactions.delete(id);
  }
  async disposeSession(id: string) {
    const rpc = this.sessions.get(id);
    if (rpc) await stopProcess(rpc.child, this.config.limits.abortTimeoutMs);
    this.sessions.delete(id);
    await rm(this.sessionFile(id), { force: true });
  }
  async stop() {
    this.state.status = "stopping";
    await Promise.all(
      [...this.sessions.values()].map((rpc) =>
        stopProcess(rpc.child, this.config.limits.abortTimeoutMs),
      ),
    );
  }
}
