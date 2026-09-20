import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import type { Config } from "../config.js";
import type { Provider, Settings } from "../../shared/settings.js";

type Api = "openai-completions" | "openai-responses";
type ChatBody = Record<string, unknown>;
type JsonObject = Record<string, unknown>;

function proxyUrl(host: string, port: number) {
  const address = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  return `http://${address.includes(":") ? `[${address}]` : address}:${port}`;
}

export interface LlmUsageRecord {
  providerID: string;
  modelID: string | null;
  clientApi: Api;
  upstreamApi: Api;
  conversion: string;
  status: number;
  durationMs: number;
  ttftMs: number | null;
  stream: boolean;
  usage: {
    input: number | null;
    output: number | null;
    cacheRead: number | null;
    cacheWrite: number | null;
    costUsd: number | null;
  } | null;
  error: string | null;
  errorDetail?: string | null;
  upstreamStatus?: number | null;
  occurredAt: string;
}
export interface LlmProxyDiagnostic {
  providerID: string;
  modelID: string | null;
  clientApi: Api;
  upstreamApi: Api;
  conversion: string;
  upstreamPath: string | null;
  request: string | null;
  response: string | null;
  status: number;
  upstreamStatus: number | null;
  durationMs: number;
  error: string | null;
}

export class LlmProxyError extends Error {
  constructor(
    readonly code: "PROTOCOL_CONVERSION_UNSUPPORTED" | "PROXY_AUTHENTICATION_FAILED" | "PROVIDER_NOT_FOUND" | "INVALID_REQUEST" | "UPSTREAM_ERROR",
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function object(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new LlmProxyError("INVALID_REQUEST", "Request body must be a JSON object");
  return value as JsonObject;
}
function text(value: unknown, field: string): string {
  if (typeof value !== "string")
    throw new LlmProxyError("INVALID_REQUEST", `${field} must be a string`);
  return value;
}
function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
async function upstreamFailure(response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  if (!body) return `Upstream returned HTTP ${response.status}`;
  let detail = body.replace(/\s+/g, " ").trim();
  try {
    const parsed = JSON.parse(body) as JsonObject;
    const upstreamError = parsed.error && typeof parsed.error === "object" ? parsed.error as JsonObject : parsed;
    if (typeof upstreamError.message === "string") detail = upstreamError.message;
    else if (typeof upstreamError.code === "string") detail = upstreamError.code;
  } catch {
    // Keep a short plain-text response for non-JSON OpenAI-compatible servers.
  }
  return `Upstream returned HTTP ${response.status}: ${detail.slice(0, 2000)}`;
}
function diagnosticValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[depth truncated]";
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => diagnosticValue(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
    output[key] = /authorization|api[-_]?key|password|cookie|token/i.test(key)
      ? "[redacted]"
      : diagnosticValue(item, depth + 1);
  }
  return output;
}
function diagnosticText(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  let text: string;
  try { text = JSON.stringify(diagnosticValue(value)) ?? String(value); }
  catch { text = String(value); }
  return text.length <= 12000 ? text : `${text.slice(0, 6000)}...[truncated]...${text.slice(-6000)}`;
}
async function streamPreview(body: ReadableStream<Uint8Array>, limit = 12000): Promise<string> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < limit) {
      const next = await reader.read();
      if (next.done) break;
      const chunk = next.value;
      const remaining = limit - size;
      chunks.push(chunk.byteLength <= remaining ? chunk : chunk.slice(0, remaining));
      size += Math.min(chunk.byteLength, remaining);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return new TextDecoder().decode(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))));
}
function endpoint(api: Api): "responses" | "chat/completions" {
  return api === "openai-responses" ? "responses" : "chat/completions";
}
function apiFromEndpoint(value: string): Api | null {
  return value === "responses" ? "openai-responses" : value === "chat/completions" ? "openai-completions" : null;
}
function usageFromChat(value: unknown) {
  const usage = value && typeof value === "object" ? value as JsonObject : {};
  const prompt = optionalNumber(usage.prompt_tokens);
  const completion = optionalNumber(usage.completion_tokens);
  const details = usage.prompt_tokens_details && typeof usage.prompt_tokens_details === "object"
    ? usage.prompt_tokens_details as JsonObject : {};
  const completionDetails = usage.completion_tokens_details && typeof usage.completion_tokens_details === "object"
    ? usage.completion_tokens_details as JsonObject : {};
  return {
    input: prompt,
    output: completion,
    cacheRead: optionalNumber(details.cached_tokens),
    cacheWrite: optionalNumber(completionDetails.reasoning_tokens),
    costUsd: null,
  };
}
function usageFromResponse(value: unknown) {
  const usage = value && typeof value === "object" ? value as JsonObject : {};
  return {
    input: optionalNumber(usage.input_tokens),
    output: optionalNumber(usage.output_tokens),
    cacheRead: optionalNumber(usage.input_tokens_details && typeof usage.input_tokens_details === "object"
      ? (usage.input_tokens_details as JsonObject).cached_tokens : null),
    cacheWrite: null,
    costUsd: null,
  };
}

function contentText(value: unknown, field: string): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) throw new LlmProxyError("PROTOCOL_CONVERSION_UNSUPPORTED", `${field} cannot be represented as Chat content`);
  return value.map((part) => {
    const item = object(part);
    if (item.type === "input_text" || item.type === "output_text" || item.type === "text" || (item.type === undefined && typeof item.text === "string")) return text(item.text, `${field}.text`);
    throw new LlmProxyError("PROTOCOL_CONVERSION_UNSUPPORTED", `${field} contains unsupported content type ${String(item.type)}`);
  }).join("");
}

function responseInputType(item: JsonObject): string | undefined {
  if (typeof item.type === "string") return item.type;
  if (item.role !== undefined && item.content !== undefined) return "message";
  if (item.call_id !== undefined || (item.id !== undefined && item.output !== undefined)) return "function_call_output";
  if (item.name !== undefined && item.arguments !== undefined) return "function_call";
  return undefined;
}

function responseTools(value: unknown): unknown[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new LlmProxyError("INVALID_REQUEST", "tools must be an array");
  const flatten = (tool: unknown, namespace?: string): unknown[] => {
    const item = object(tool);
    if (item.type === "namespace") {
      const name = text(item.name, "tools.namespace.name");
      if (!Array.isArray(item.tools)) throw new LlmProxyError("INVALID_REQUEST", "tools.namespace.tools must be an array");
      return item.tools.flatMap((nested) => flatten(nested, name));
    }
    if (item.type !== "function") throw new LlmProxyError("PROTOCOL_CONVERSION_UNSUPPORTED", `Unsupported tool type ${String(item.type)}`);
    const fn = item.function && typeof item.function === "object" ? object(item.function) : item;
    const name = text(fn.name, "tools.function.name");
    return [{
      type: "function",
      function: {
        name: namespace ? `${namespace}__${name}` : name,
        ...(typeof fn.description === "string" ? { description: fn.description } : {}),
        parameters: fn.parameters ?? fn.input_schema ?? { type: "object", properties: {} },
        ...(typeof fn.strict === "boolean" ? { strict: fn.strict } : {}),
      },
    }];
  };
  return value.flatMap((tool) => flatten(tool));
}

export function responsesToChat(input: JsonObject, history: JsonObject[] = []): ChatBody {
  const messages: JsonObject[] = history.map((message) => {
    if (message.role === "assistant" && message.content === null && message.tool_calls) {
      const { content: _content, ...toolMessage } = message;
      return toolMessage;
    }
    return message;
  });
  if (typeof input.instructions === "string" && input.instructions.length > 0) messages.push({ role: "system", content: input.instructions });
  const items = typeof input.input === "string" ? [{ type: "message", role: "user", content: input.input }] : input.input;
  if (!Array.isArray(items)) throw new LlmProxyError("INVALID_REQUEST", "input must be a string or array");
  for (const raw of items) {
    const item = object(raw);
    switch (responseInputType(item)) {
      case "message": {
        const role = item.role === "developer" ? "system" : item.role;
        if (!["user", "assistant", "system"].includes(String(role))) throw new LlmProxyError("PROTOCOL_CONVERSION_UNSUPPORTED", `Unsupported message role ${String(role)}`);
        const content = contentText(item.content, "input.message.content");
        if (content.length > 0) messages.push({ role, content });
        break;
      }
      case "function_call_output":
        messages.push({ role: "tool", tool_call_id: text(item.call_id ?? item.id, "function_call_output.call_id"), content: contentText(item.output, "function_call_output.output") });
        break;
      case "function_call":
        messages.push({ role: "assistant", tool_calls: [{ id: text(item.call_id, "function_call.call_id"), type: "function", function: { name: text(item.name, "function_call.name"), arguments: text(item.arguments, "function_call.arguments") } }] });
        break;
      default:
        throw new LlmProxyError("PROTOCOL_CONVERSION_UNSUPPORTED", `Unsupported input item type ${String(item.type)}`);
    }
  }
  const result: ChatBody = {
    model: text(input.model, "model"),
    messages,
    ...(input.stream === true ? { stream: true } : { stream: false }),
  };
  const tools = responseTools(input.tools);
  if (tools) result.tools = tools;
  if (input.max_output_tokens !== undefined) result.max_tokens = input.max_output_tokens;
  if (input.temperature !== undefined) result.temperature = input.temperature;
  if (input.top_p !== undefined) result.top_p = input.top_p;
  const reasoning = input.reasoning && typeof input.reasoning === "object" ? object(input.reasoning) : undefined;
  if (reasoning?.effort !== undefined) result.reasoning_effort = reasoning.effort;
  const format = input.text && typeof input.text === "object" ? object(input.text).format : undefined;
  if (format && typeof format === "object") {
    const value = object(format);
    if (value.type === "json_schema") result.response_format = { type: "json_schema", json_schema: { name: value.name ?? "response", description: value.description, schema: value.schema, strict: value.strict } };
    else if (value.type === "json_object") result.response_format = { type: "json_object" };
  }
  return result;
}

function responseOutputFromChat(body: JsonObject, responseId = `resp_${randomUUID().replaceAll("-", "")}`, messageId = `msg_${randomUUID().replaceAll("-", "")}`): JsonObject {
  const choice = Array.isArray(body.choices) && body.choices[0] && typeof body.choices[0] === "object" ? body.choices[0] as JsonObject : {};
  const message = choice.message && typeof choice.message === "object" ? choice.message as JsonObject : {};
  const output: JsonObject[] = [];
  const content = typeof message.content === "string" ? message.content : "";
  if (content) output.push({ type: "message", id: messageId, status: "completed", role: "assistant", content: [{ type: "output_text", text: content, annotations: [] }] });
  const reasoning = typeof message.reasoning_content === "string" ? message.reasoning_content : "";
  if (reasoning) output.unshift({ type: "reasoning", id: `rs_${randomUUID().replaceAll("-", "")}`, summary: [{ type: "summary_text", text: reasoning }] });
  if (Array.isArray(message.tool_calls)) for (const raw of message.tool_calls) {
    const tool = object(raw);
    const fn = tool.function && typeof tool.function === "object" ? object(tool.function) : {};
    output.push({ type: "function_call", id: text(tool.id, "tool_calls.id"), call_id: text(tool.id, "tool_calls.id"), name: text(fn.name, "tool_calls.function.name"), arguments: text(fn.arguments, "tool_calls.function.arguments"), status: "completed" });
  }
  const chatUsage = usageFromChat(body.usage);
  const usage = chatUsage.input !== null && chatUsage.output !== null
    ? {
        input_tokens: chatUsage.input,
        output_tokens: chatUsage.output,
        total_tokens: chatUsage.input + chatUsage.output,
        ...(chatUsage.cacheRead === null ? {} : { input_tokens_details: { cached_tokens: chatUsage.cacheRead } }),
      }
    : undefined;
  return {
    id: responseId,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "completed",
    model: typeof body.model === "string" ? body.model : undefined,
    output,
    output_text: content,
    ...(usage ? { usage } : {}),
  };
}

export function chatToResponse(body: JsonObject, responseId?: string): JsonObject {
  return responseOutputFromChat(body, responseId);
}

function assistantMessageFromResponse(response: JsonObject): JsonObject {
  const output = Array.isArray(response.output) ? response.output : [];
  const message = output.find((item) => item && typeof item === "object" && (item as JsonObject).type === "message") as JsonObject | undefined;
  const calls = output
    .filter((item) => item && typeof item === "object" && (item as JsonObject).type === "function_call")
    .map((item) => {
      const value = item as JsonObject;
      return { id: value.call_id ?? value.id, type: "function", function: { name: value.name, arguments: value.arguments } };
    });
  const content = message && Array.isArray(message.content)
    ? (message.content as unknown[]).map((part) => part && typeof part === "object" ? (part as JsonObject).text : "").filter((value): value is string => typeof value === "string").join("")
    : String(response.output_text ?? "");
  return { role: "assistant", ...(content ? { content } : {}), ...(calls.length ? { tool_calls: calls } : {}) };
}

function appendSse(res: ServerResponse, event: string, data: JsonObject) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function convertChatStream(
  body: ReadableStream<Uint8Array>,
  res: ServerResponse,
  responseId: string,
  onDone: (body: JsonObject) => void,
  onFirstToken: () => void,
) {
  const decoder = new TextDecoder();
  let buffer = "";
  let textOutput = "";
  let reasoningOutput = "";
  let model = "unknown";
  let usage: JsonObject | undefined;
  let finishReason: unknown;
  const messageId = `msg_${randomUUID().replaceAll("-", "")}`;
  let messageStarted = false;
  const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();
  const announcedTools = new Set<number>();
  const startMessage = () => {
    if (messageStarted) return;
    messageStarted = true;
    appendSse(res, "response.output_item.added", { type: "response.output_item.added", response_id: responseId, output_index: 0, item: { type: "message", id: messageId, status: "in_progress", role: "assistant", content: [] } });
    appendSse(res, "response.content_part.added", { type: "response.content_part.added", response_id: responseId, item_id: messageId, output_index: 0, content_index: 0, part: { type: "output_text", text: "", annotations: [] } });
  };
  const emitLine = (line: string) => {
    if (!line.startsWith("data:")) return;
    const raw = line.slice(5).trim();
    if (!raw || raw === "[DONE]") return;
    let chunk: JsonObject;
    try { chunk = object(JSON.parse(raw)); } catch { return; }
    if (typeof chunk.model === "string") model = chunk.model;
    if (chunk.usage && typeof chunk.usage === "object") usage = object(chunk.usage);
    const choice = Array.isArray(chunk.choices) && chunk.choices[0] && typeof chunk.choices[0] === "object" ? chunk.choices[0] as JsonObject : {};
    if (choice.finish_reason !== undefined && choice.finish_reason !== null) finishReason = choice.finish_reason;
    const delta = choice.delta && typeof choice.delta === "object" ? choice.delta as JsonObject : {};
    if (typeof delta.content === "string") {
      onFirstToken();
      startMessage();
      textOutput += delta.content;
      appendSse(res, "response.output_text.delta", { type: "response.output_text.delta", response_id: responseId, item_id: messageId, output_index: 0, content_index: 0, delta: delta.content });
    }
    if (typeof delta.reasoning_content === "string") {
      onFirstToken();
      reasoningOutput += delta.reasoning_content;
      appendSse(res, "response.reasoning_summary_text.delta", { type: "response.reasoning_summary_text.delta", response_id: responseId, item_id: `rs_${responseId}`, output_index: 0, summary_index: 0, delta: delta.reasoning_content });
    }
    if (Array.isArray(delta.tool_calls)) for (const raw of delta.tool_calls) {
      onFirstToken();
      const call = object(raw);
      const index = typeof call.index === "number" ? call.index : 0;
      const fn = call.function && typeof call.function === "object" ? object(call.function) : {};
      const current = toolCalls.get(index) ?? { id: typeof call.id === "string" ? call.id : `call_${index}`, name: typeof fn.name === "string" ? fn.name : "", arguments: "" };
      if (typeof call.id === "string") current.id = call.id;
      // Chat Completions sends the function name as metadata, not a text delta.
      // Some compatible servers repeat it on every chunk; retain the first value.
      if (typeof fn.name === "string" && !current.name) current.name = fn.name;
      if (!announcedTools.has(index)) {
        announcedTools.add(index);
        appendSse(res, "response.output_item.added", { type: "response.output_item.added", response_id: responseId, output_index: index, item: { type: "function_call", id: current.id, call_id: current.id, name: current.name, arguments: "", status: "in_progress" } });
      }
      if (typeof fn.arguments === "string") {
        current.arguments += fn.arguments;
        appendSse(res, "response.function_call_arguments.delta", { type: "response.function_call_arguments.delta", response_id: responseId, item_id: current.id, output_index: index, delta: fn.arguments });
      }
      toolCalls.set(index, current);
    }
  };
  appendSse(res, "response.created", { type: "response.created", response: { id: responseId, object: "response", status: "in_progress", output: [] } });
  for await (const chunk of Readable.fromWeb(body as never)) {
    buffer += decoder.decode(chunk as Buffer, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) emitLine(line);
  }
  if (buffer) emitLine(buffer);
  const response = responseOutputFromChat({ model, choices: [{ message: { content: textOutput, reasoning_content: reasoningOutput, tool_calls: [...toolCalls.values()].map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: call.arguments } })) } }], usage }, responseId, messageId);
  response.status = finishReason === "length" ? "incomplete" : "completed";
  if (messageStarted) {
    const message = (response.output as JsonObject[]).find((item) => item.type === "message") ?? { type: "message", id: messageId, status: response.status, role: "assistant", content: [{ type: "output_text", text: textOutput, annotations: [] }] };
    appendSse(res, "response.output_text.done", { type: "response.output_text.done", response_id: responseId, item_id: messageId, output_index: 0, content_index: 0, text: textOutput });
    appendSse(res, "response.content_part.done", { type: "response.content_part.done", response_id: responseId, item_id: messageId, output_index: 0, content_index: 0, part: { type: "output_text", text: textOutput, annotations: [] } });
    appendSse(res, "response.output_item.done", { type: "response.output_item.done", response_id: responseId, output_index: 0, item: message });
  }
  for (const [index, call] of toolCalls) {
    appendSse(res, "response.function_call_arguments.done", { type: "response.function_call_arguments.done", response_id: responseId, item_id: call.id, output_index: index, arguments: call.arguments });
    appendSse(res, "response.output_item.done", { type: "response.output_item.done", response_id: responseId, output_index: index, item: { type: "function_call", id: call.id, call_id: call.id, name: call.name, arguments: call.arguments, status: "completed" } });
  }
  appendSse(res, "response.completed", { type: "response.completed", response });
  res.end();
  onDone(response);
}

function mergeParams(body: ChatBody, params: Record<string, unknown>): ChatBody {
  const protectedKeys = new Set(["model", "messages", "input", "stream", "instructions", "previous_response_id", "tools"]);
  return Object.entries(params).reduce((result, [key, value]) => {
    if (!protectedKeys.has(key)) result[key] = value;
    return result;
  }, { ...body });
}

async function readBody(req: IncomingMessage): Promise<JsonObject> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const value = Buffer.from(chunk as Uint8Array);
    size += value.length;
    if (size > 2 * 1024 * 1024) throw new LlmProxyError("INVALID_REQUEST", "LLM request body exceeds 2 MiB", 413);
    chunks.push(value);
  }
  try { return object(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
  catch (error) { if (error instanceof LlmProxyError) throw error; throw new LlmProxyError("INVALID_REQUEST", "LLM request body must be valid JSON"); }
}

interface HistoryEntry { messages: JsonObject[]; bytes: number; expiresAt: number; }

export class LlmProxy {
  private server = createServer((req, res) => void this.handle(req, res));
  private listening = false;
  private readonly token = randomBytes(32).toString("base64url");
  private readonly history = new Map<string, HistoryEntry>();
  private port = 0;
  constructor(
    private readonly config: { llmProxy?: Config["llmProxy"] },
    private readonly getSettings: () => Settings,
    private readonly onRecord?: (record: LlmUsageRecord) => void,
    private readonly onDiagnostic?: (diagnostic: LlmProxyDiagnostic) => void,
  ) {}
  private get listener() { return this.config.llmProxy ?? { host: "127.0.0.1", port: 0 }; }
  get baseUrl() { return proxyUrl(this.listener.host, this.port); }
  get runtimeToken() { return this.token; }
  providerBaseUrl(providerId: string) { return `${this.baseUrl}/llm/${encodeURIComponent(providerId)}/v1`; }
  async start() {
    if (this.listening) return;
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => { this.server.off("listening", onListening); reject(error); };
      const onListening = () => { this.server.off("error", onError); const address = this.server.address(); this.port = typeof address === "object" && address ? address.port : 0; this.listening = true; resolve(); };
      this.server.once("error", onError);
      this.server.once("listening", onListening);
      this.server.listen(this.listener.port, this.listener.host);
    });
  }
  async close() {
    if (!this.listening) return;
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
    this.listening = false;
  }
  private cleanupHistory() {
    const now = Date.now();
    for (const [id, entry] of this.history) if (entry.expiresAt <= now) this.history.delete(id);
    while (this.history.size > 100) this.history.delete(this.history.keys().next().value!);
  }
  private getHistory(id: string): JsonObject[] {
    this.cleanupHistory();
    const entry = this.history.get(id);
    if (!entry) throw new LlmProxyError("PROTOCOL_CONVERSION_UNSUPPORTED", "previous_response_id is unknown or expired");
    return structuredClone(entry.messages);
  }
  private putHistory(id: string, messages: JsonObject[]) {
    const copy = structuredClone(messages);
    this.history.set(id, { messages: copy, bytes: Buffer.byteLength(JSON.stringify(copy)), expiresAt: Date.now() + 10 * 60 * 1000 });
    this.cleanupHistory();
    let total = 0;
    for (const entry of this.history.values()) total += entry.bytes;
    while (total > 2 * 1024 * 1024 && this.history.size) {
      const first = this.history.keys().next().value!;
      total -= this.history.get(first)?.bytes ?? 0;
      this.history.delete(first);
    }
  }
  private async handle(req: IncomingMessage, res: ServerResponse) {
    const started = Date.now();
    let providerID = "";
    let modelID: string | null = null;
    let clientApi: Api = "openai-completions";
    let upstreamApi: Api = clientApi;
    let conversion = "none";
    let stream = false;
    let status = 500;
    let upstreamStatus: number | null = null;
    let ttftMs: number | null = null;
    let usage: LlmUsageRecord["usage"] = null;
    let error: string | null = null;
    let errorDetail: string | null = null;
    let requestBody: unknown = null;
    let responseBody: unknown = null;
    let upstreamPath: string | null = null;
    const finish = () => {
      const durationMs = Date.now() - started;
      this.onRecord?.({ providerID, modelID, clientApi, upstreamApi, conversion, status, durationMs, ttftMs, stream, usage, error, errorDetail, upstreamStatus, occurredAt: new Date().toISOString() });
      this.onDiagnostic?.({ providerID, modelID, clientApi, upstreamApi, conversion, upstreamPath, request: diagnosticText(requestBody), response: diagnosticText(responseBody), status, upstreamStatus, durationMs, error: errorDetail ?? error });
    };
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const match = url.pathname.match(/^\/llm\/([^/]+)\/v1\/(responses|chat\/completions|models)$/);
      if (!match) throw new LlmProxyError("INVALID_REQUEST", "Unknown LLM proxy route", 404);
      if (req.headers.authorization !== `Bearer ${this.token}`) throw new LlmProxyError("PROXY_AUTHENTICATION_FAILED", "Invalid LLM proxy token", 401);
      providerID = decodeURIComponent(match[1]!);
      const provider = this.getSettings().providers.find((item) => item.id === providerID);
      if (!provider || !provider.enabled) throw new LlmProxyError("PROVIDER_NOT_FOUND", "Provider is not enabled", 404);
      if (match[2] === "models") {
        if (req.method !== "GET") throw new LlmProxyError("INVALID_REQUEST", "Models endpoint only accepts GET", 405);
        status = 200;
        this.writeJson(res, status, { object: "list", data: provider.models.map((model) => ({ id: model.id, object: "model", owned_by: provider.id })) });
        finish();
        return;
      }
      if (req.method !== "POST") throw new LlmProxyError("INVALID_REQUEST", "LLM endpoints only accept POST", 405);
      clientApi = apiFromEndpoint(match[2]!)!;
      upstreamApi = provider.upstreamApi ?? provider.api;
      const configuredConversion = provider.conversion ?? "none";
      // A Responses client may target a Chat-only provider.  The client
      // protocol is selected per Agent, so conversion must not depend on a
      // provider-wide toggle being present in older settings.
      const convertingResponses = clientApi === "openai-responses" && upstreamApi === "openai-completions";
      const directRequest = configuredConversion === "none" && clientApi === upstreamApi;
      const compatibleRequest = directRequest || convertingResponses || (configuredConversion === "responses-to-completions" && clientApi === "openai-completions" && upstreamApi === "openai-completions");
      if (!compatibleRequest) throw new LlmProxyError("PROTOCOL_CONVERSION_UNSUPPORTED", `Unsupported client/upstream protocol route: ${clientApi} -> ${upstreamApi}`);
      conversion = convertingResponses ? "responses-to-completions" : "none";
      const input = await readBody(req);
      requestBody = input;
      modelID = typeof input.model === "string" ? input.model : null;
      stream = input.stream === true;
      const model = provider.models.find((item) => item.id === modelID);
      if (!model) throw new LlmProxyError("INVALID_REQUEST", "Unknown provider model", 400);
      let outgoing = input;
      let history: JsonObject[] = [];
      if (convertingResponses) {
        if (input.previous_response_id !== undefined) history = this.getHistory(text(input.previous_response_id, "previous_response_id"));
        outgoing = responsesToChat(input, history);
      }
      outgoing = mergeParams(outgoing, provider.request?.params ?? {});
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      for (const [key, value] of Object.entries(provider.request?.headers ?? {})) if (!["authorization", "host", "content-length", "transfer-encoding"].includes(key.toLowerCase())) headers[key] = String(value);
      if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;
      const upstream = `${provider.baseUrl.replace(/\/$/, "")}/${endpoint(upstreamApi)}`;
      upstreamPath = `/${endpoint(upstreamApi)}`;
      const response = await fetch(upstream, { method: "POST", redirect: "error", signal: AbortSignal.timeout(120000), headers, body: JSON.stringify(outgoing) });
      status = response.status;
      upstreamStatus = response.status;
      if (!response.ok) {
        throw new Error(await upstreamFailure(response));
      }
      const contentType = response.headers.get("content-type") ?? "application/json";
      if (convertingResponses) {
        const responseId = `resp_${randomUUID().replaceAll("-", "")}`;
        if (stream || contentType.includes("text/event-stream")) {
          res.statusCode = status;
          res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
          res.setHeader("Cache-Control", "no-cache");
          if (!response.body) throw new Error("Upstream returned an empty stream");
          await convertChatStream(response.body, res, responseId, (converted) => {
            responseBody = converted;
            usage = usageFromResponse(converted.usage);
            this.putHistory(responseId, [
              ...(Array.isArray(outgoing.messages) ? outgoing.messages as JsonObject[] : history),
              assistantMessageFromResponse(converted),
            ]);
          }, () => { if (ttftMs === null) ttftMs = Date.now() - started; });
          status = 200;
          finish();
          return;
        }
        const body = object(await response.json());
        const converted = chatToResponse(body, responseId);
        responseBody = converted;
        usage = usageFromResponse(converted.usage);
        this.putHistory(responseId, [
          ...(Array.isArray(outgoing.messages) ? outgoing.messages as JsonObject[] : history),
          assistantMessageFromResponse(converted),
        ]);
        status = 200;
        this.writeJson(res, status, converted);
        finish();
        return;
      }
      const raw = contentType.includes("application/json") ? await response.clone().json().catch(() => null) as JsonObject | null : null;
      responseBody = raw ?? { contentType, stream: true };
      res.statusCode = status;
      res.setHeader("Content-Type", contentType);
      if (response.body) {
        const [clientBody, diagnosticBody] = response.body.tee();
        Readable.fromWeb(clientBody as never).pipe(res);
        responseBody = await streamPreview(diagnosticBody);
      } else res.end();
      usage = raw ? usageFromResponse(raw.usage) : null;
      ttftMs = Date.now() - started;
      finish();
    } catch (caught) {
      error = caught instanceof LlmProxyError ? caught.code : "UPSTREAM_ERROR";
      errorDetail = caught instanceof Error ? caught.message : String(caught);
      responseBody ??= { error: errorDetail };
      const proxyError = caught instanceof LlmProxyError
        ? caught
        : new LlmProxyError("UPSTREAM_ERROR", caught instanceof Error ? caught.message : "Upstream model request failed", 502);
      status = proxyError.status;
      if (!res.headersSent) this.writeJson(res, status, { error: { code: proxyError.code, message: proxyError.message, type: "proxy_error" } });
      else res.end();
      finish();
    }
  }
  private writeJson(res: ServerResponse, status: number, body: unknown) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify(body));
  }
}

const proxies = new WeakMap<object, LlmProxy>();
export function registerLlmProxy(config: Config, proxy: LlmProxy) { proxies.set(config, proxy); }
export function unregisterLlmProxy(config: Config) { proxies.delete(config); }
export function getLlmProxy(config: Config) { return proxies.get(config); }
