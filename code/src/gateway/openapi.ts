import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { gatewaySchema } from "../../host/gateway.mjs";
import {
  createSessionSchema, createTaskSchema, submitRunSchema, promptSchema,
  interactionReplySchema, modelSchema, policySchema, runStates,
} from "../../shared/contracts.js";
import { agentIdSchema, settingsSchema, agentActionSchema, runtimeSourceSchema, providerSchema, skillSchema, mcpSchema } from "../../shared/settings.js";
import { runtimeActionSchema } from "../../shared/runtimes.js";
import { networkSchema, networkInputSchema, lifecycleSchema } from "../../shared/system.js";
import { codeRoot } from "../engines/tool-instructions.js";

// Input mode preserves the distinction between optional defaults and required fields.
const json = (schema: z.ZodType, io: "input" | "output" = "input") => {
  const { $schema, ...result } = z.toJSONSchema(schema, { io });
  return result;
};
type Schema = Record<string, unknown>;
const str: Schema = { type: "string" };
const num: Schema = { type: "number" };
const int: Schema = { type: "integer" };
const bool: Schema = { type: "boolean" };
const date: Schema = { type: "string", format: "date-time" };
const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });
const array = (items: Schema): Schema => ({ type: "array", items });
const nullable = (schema: Schema): Schema => ({ anyOf: [schema, { type: "null" }] });
const enumeration = (...values: string[]): Schema => ({ type: "string", enum: values });
const object = (properties: Record<string, Schema>, optional: string[] = []): Schema => ({
  type: "object", properties, required: Object.keys(properties).filter((key) => !optional.includes(key)),
});
const dictionary = (values: Schema): Schema => ({ type: "object", additionalProperties: values });
const described = (schema: Schema, description: string): Schema => ({ ...schema, description });
const page = (name: string) => object({ snapshot: ref("Snapshot"), items: array(ref(name)), nextCursor: described(nullable(str), "下一页游标；null 表示最后一页。原样传回并保持筛选条件一致；409 时重新读取首页。") });

export const sessionGuide = readFileSync(`${codeRoot}/docs/GATEWAY_API.md`, "utf8").replace(/\r\n/g, "\n");

const schemas: Record<string, Schema> = {
  Error: object({ code: described(str, "稳定的机器可读错误码。"), message: described(str, "错误说明；不包含密钥。") }),
  Failure: object({ code: str, message: str, stage: described(str, "失败阶段，例如 gateway、engine。") }),
  Ok: object({ ok: { const: true, type: "boolean" } }),
  Model: json(modelSchema),
  InteractionPolicy: { ...json(policySchema), description: "permission/question 分别控制审批与问题：manual 等待客户端回复；auto 自动处理。创建后固定，省略则继承 Agent 已应用配置（初值均为 auto）。" },
  CreateSession: json(createSessionSchema),
  Prompt: json(promptSchema),
  CreateTask: json(createTaskSchema),
  SubmitRun: json(submitRunSchema),
  PermissionReply: json(interactionReplySchema.options[0]),
  QuestionReply: json(interactionReplySchema.options[1]),
  SettingsInput: json(settingsSchema),
  Settings: json(settingsSchema, "output"),
  NetworkInput: json(networkInputSchema),
  NetworkSettings: json(networkSchema, "output"),
  GatewaySettings: json(gatewaySchema),
  Usage: described(object({ input: nullable(num), output: nullable(num), cacheRead: nullable(num), cacheWrite: nullable(num), costUsd: nullable(num), source: enumeration("reported", "estimated") }), "Token 用量与美元费用；null 表示未报告，不能当作 0。"),
  Snapshot: object({ storeId: str, instanceId: str, revision: int, cursor: str, capturedAt: date }),
  AcceptedRun: object({ submissionId: str, taskId: described(str, "与 sessionId 相同。"), sessionId: str, runId: str, acceptedAt: date }),
  Run: object({
    id: str, sessionId: str, submissionId: str, sequence: int, inputParts: json(promptSchema.shape.parts),
    model: nullable(ref("Model")), state: described(enumeration(...runStates), "queued/running/stopping 为非终态；completed/failed/timed_out/cancelled 为终态，仅 completed 表示成功。"),
    acceptedAt: date, deadlineAt: described(date, "提交时保存的绝对截止时间，包含排队和人工等待；修改系统时限不改变已提交执行。Agent 确认成功后的产物登记单独计时。"), startedAt: nullable(date), finishedAt: nullable(date),
    stopReason: nullable(enumeration("user", "timeout", "deletion", "shutdown")), error: nullable(ref("Failure")), usage: nullable(ref("Usage")),
    traceId: str, configRevision: nullable(str), runtimeVersion: nullable(str),
  }, ["runtimeVersion"]),
  TextPart: object({ id: str, type: { const: "text", type: "string" }, content: str }),
  ReasoningPart: object({ id: str, type: { const: "reasoning", type: "string" }, content: str }),
  ToolPart: object({ id: str, type: { const: "tool", type: "string" }, toolCallId: str, tool: str,
    input: described({}, "工具原生输入，JSON 任意值。"), output: str,
    state: object({ title: str, status: enumeration("pending", "running", "completed", "failed", "cancelled", "interrupted") }), startedAt: nullable(date), finishedAt: nullable(date) }),
  StepPart: object({ id: str, type: { const: "step-finish", type: "string" }, reason: str, usage: nullable(ref("Usage")) }),
  MessagePart: { oneOf: ["TextPart", "ReasoningPart", "ToolPart", "StepPart"].map(ref), discriminator: { propertyName: "type" } },
  Message: object({ id: str, sessionId: str, runId: str, role: enumeration("user", "assistant"), created_at: date, completedAt: nullable(date),
    info: object({ finish: described(nullable(str), "最终助手回复为 stop；tool-calls 不表示本轮结束。") }), parts: array(ref("MessagePart")) }),
  Question: object({ question: str, options: array(object({ label: str, description: str })), multiple: bool, allowCustom: bool }),
  Interaction: object({ id: str, sessionID: described(str, "所属会话 ID；注意此处为大写 ID。"), runId: str, kind: enumeration("permission", "question"), title: str,
    questions: array(ref("Question")), permission: str, patterns: array(str), state: enumeration("pending", "replying", "resolved", "expired"),
    policy: enumeration("auto", "manual"), created_at: date, resolvedAt: nullable(date), reply: nullable({ oneOf: [ref("PermissionReply"), ref("QuestionReply")] }), error: nullable(str) }),
  Artifact: object({ id: str, sessionId: str, runId: str, relativePath: str, displayName: str, mediaType: str, sizeBytes: int, modifiedAt: date,
    digest: described(str, "文件 SHA-256。"), registeredAt: date, availability: enumeration("available", "missing", "changed", "unavailable"), validation: enumeration("not_checked", "passed", "failed") }),
  TaskSummary: object({ id: str, title: str, titleSource: enumeration("user", "generated"), directory: str, engineId: str, interactionPolicy: ref("InteractionPolicy"),
    availability: enumeration("ready", "unavailable", "deleting"), createdAt: date, updatedAt: date, version: int,
    status: enumeration(...runStates, "not_started", "waiting_input", "unavailable", "deleting"), lastRun: nullable(ref("Run")), queuedCount: int, messageCount: int }),
  TaskDetail: object({ task: ref("TaskSummary"), runs: array(ref("Run")), messages: array(ref("Message")), interactions: array(ref("Interaction")), artifacts: array(ref("Artifact")) }),
  SessionCreated: object({ id: str, title: str, engineId: str, directory: str, interactionPolicy: ref("InteractionPolicy"), created_at: date, status: { type: "string", const: "idle" } }),
  SessionView: object({ id: str, title: str, engineId: str, directory: str, interactionPolicy: ref("InteractionPolicy"), created_at: date, status: enumeration("busy", "idle"), message_count: int }),
  Submission: object({ id: str, operation: enumeration("create", "append"), target: str, digest: str,
    status: enumeration("processing", "accepted", "rejected", "indeterminate", "gone"), result: nullable(ref("AcceptedRun")), error: nullable(ref("Failure")), createdAt: date }),
  EngineHealth: object({ status: enumeration("starting", "ready", "degraded", "unavailable", "stopping", "disabled"), version: nullable(str), message: nullable(str), processes: int, restarts: int }),
  EngineCapabilities: object({ permissions: bool, questions: bool, recovery: bool }),
  ModelOption: object({ providerID: str, modelID: str, name: str }),
  AgentView: object({ id: json(agentIdSchema), enabled: bool, health: ref("EngineHealth"), directory: str, configFile: str, savedRevision: str,
    appliedRevision: nullable(str), pendingChanges: bool, operation: nullable(enumeration("enable", "disable", "stop", "apply")), error: nullable(str),
    activeRuns: int, queuedRuns: int, models: array(ref("ModelOption")), capabilities: ref("EngineCapabilities") }),
  RuntimeView: object({ id: json(agentIdSchema), managed: bool, executable: nullable(str), detection: enumeration("unknown", "checking", "present", "missing", "failed"),
    detectedAt: nullable(date), compatibility: enumeration("unknown", "compatible", "incompatible"), usable: bool, platform: str,
    installedVersion: nullable(str), managedVersion: nullable(str), latestVersion: nullable(str), runningVersion: nullable(str), checkedAt: nullable(date), checkError: nullable(str),
    status: enumeration("not_installed", "installed", "installing", "uninstalling", "failed"), updateStatus: enumeration("idle", "checking", "available", "downloading", "switching", "failed"),
    operation: nullable(enumeration("check", "detect", "install", "update", "uninstall", "source")), cancelable: bool, progress: nullable(num), downloadedBytes: num,
    totalBytes: nullable(num), sizeBytes: nullable(num), error: nullable(str), source: nullable(str), integrity: nullable(str) }),
  RuntimeInfo: object({ instanceId: str, storeId: str, engine: str, health: ref("EngineHealth"),
    engines: array(object({ id: str, health: ref("EngineHealth"), enabled: bool, defaultModel: nullable(ref("Model")), interactionPolicy: ref("InteractionPolicy"), capabilities: ref("EngineCapabilities") }, ["defaultModel", "interactionPolicy"])),
    storage: enumeration("sqlite", "memory"), models: array(ref("Model")), limits: dictionary(num), interactionDefaults: ref("InteractionPolicy"), capabilities: dictionary(bool) }),
  SettingsView: object({ settings: ref("Settings"), revision: str, dataDirectory: str }),
  SystemView: object({ storeId: str, version: str, nodeVersion: str, nodePath: str, npmPath: nullable(str),
    capabilities: object({ gateway: bool, network: bool, restart: bool, directories: bool, certificates: bool }), maintenance: enumeration("ready", "draining", "stopping") }),
  GatewayView: object({ settings: ref("GatewaySettings"), appliedSettings: ref("GatewaySettings"), revision: str, appliedRevision: str, restartRequired: bool, url: nullable(str), urls: array(str), error: nullable(str) }),
  NetworkView: object({ settings: ref("NetworkSettings"), hasPassword: bool, restartRequired: bool, revision: str, appliedRevision: str, protection: enumeration("os", "file"), error: nullable(str) }),
  DirectoryView: object({ directory: nullable(str), parent: nullable(str), entries: array(object({ name: str, path: str })), truncated: bool }),
  RuntimeLog: object({ id: int, occurredAt: date, level: str, stage: str, code: nullable(str), message: str, sessionId: nullable(str), runId: nullable(str), traceId: nullable(str) }),
  Series: object({ metric: str, unit: enumeration("bytes", "count"), from: date, to: date, availableFrom: nullable(date), availableTo: nullable(date), points: array(object({ at: date, value: num })) }),
  Overview: object({ from: date, to: date, capturedAt: date, instanceId: str, engine: nullable(str), health: nullable(ref("EngineHealth")), agents: array(ref("AgentView")), limits: dictionary(num),
    completed: int, failed: int, timedOut: int, cancelled: int, totalFinished: int, accepted: int, running: int, queued: int, successRate: nullable(num), p50ExecutionMs: nullable(num), p95ExecutionMs: nullable(num),
    resource: object({ rss: num, heapTotal: num, heapUsed: num, external: num, arrayBuffers: num, uptimeSeconds: num, cpu: object({ user: num, system: num }), eventLoop: object({ idle: num, active: num, utilization: num }), childProcessMemoryBytes: { type: "null" } }),
    toolCalls: int, toolErrors: int, tools: array(object({ name: str, calls: int, failed: int })), usage: object({ reportedRuns: int, missingRuns: int, costUsd: nullable(num), input: nullable(num), output: nullable(num) }),
    pendingInteractions: int, http: object({ requests: int, errors4xx: int, errors5xx: int, scope: { type: "string", const: "current-instance" } }),
    events: object({ connections: int, sentBytes: int, droppedConnections: int, retained: int, oldestAt: nullable(date) }),
    storage: object({ healthy: bool, allocatedBytes: num, sessions: int, runs: int }), unavailableSessions: int, oldestQueuedAt: nullable(date) }),
};

const inputDescriptions: Record<string, string> = {
  directory: "网关主机上已存在、可访问且符合目录白名单的绝对路径；不是客户端本机路径。",
  engineId: "所用 Agent；省略使用当前默认 Agent。Agent 必须已启用且就绪，会话创建后不可更换。",
  title: "会话标题。省略或空白时由首条消息生成（合并空白，截取前 80 字符）。",
  interactionPolicy: "创建后固定。省略继承 Agent 已应用策略；manual 需要客户端通过审批/问题接口回复。",
  parts: "1–16 个文本片段，不能全部为空白；以换行连接后的 UTF-8 总长度不超过 131072 字节（128 KiB）。请求字段为 text，响应文本字段为 content。",
  model: "省略时继承会话模型或 Agent 默认模型。显式模型必须属于当前 Agent；不会静默替换。",
  agent: "助手角色，仅支持 assistant；不是 Agent/引擎 ID。",
  submissionId: "幂等键：1–128 个字母、数字、下划线或短横线。同操作/目标、同键同请求返回原结果；不同请求返回 409。每次新执行使用新键。",
};
for (const name of ["CreateSession", "Prompt", "CreateTask", "SubmitRun"]) {
  const properties = schemas[name]!.properties as Record<string, Schema>;
  for (const [key, value] of Object.entries(properties)) properties[key] = described(value, inputDescriptions[key]!);
}
(schemas.NetworkInput!.properties as Record<string, Schema>).proxyPassword = described(
  (schemas.NetworkInput!.properties as Record<string, Schema>).proxyPassword!, "省略保留现有密码，空字符串清除；响应不回显。",
);
schemas.SettingsInput!.description = "整份替换，不是 PATCH。资源 ID 必须唯一，四个 Agent 各出现一次，引用必须存在；启用 Agent 需要可用默认模型。密钥传回 ******** 保留旧值，空字符串清除。保存后通过 Agent apply 生效。";
schemas.Settings!.description = "已应用默认值的保存配置；API Key、MCP environment/headers 中非空密钥以 ******** 掩码返回。";
schemas.PermissionReply!.description = "once 单次批准、always 按原生引擎作用范围批准、reject 拒绝；重复或过期回复返回 409。message 可选，最长 10000 字符。";
schemas.QuestionReply!.description = "answers 按 questions 顺序逐题回答，每题对应字符串数组；选项回答用 label。multiple=false 仅允许一项，allowCustom=false 不允许选项外文本。";

const errors: Record<string, [string, string]> = {
  400: ["VALIDATION_ERROR", "请求格式、字段、参数或业务约束无效"],
  403: ["FORBIDDEN", "Host/Origin 或路径、模型等访问约束不允许"],
  404: ["NOT_FOUND", "资源不存在"],
  409: ["CONFLICT", "修订/操作冲突、过期回复、执行取消；检查当前状态后重试"],
  410: ["GONE", "幂等提交对应的会话已删除"],
  413: ["VALIDATION_ERROR", "JSON 请求体超过大小限制（默认 1 MiB）"],
  415: ["VALIDATION_ERROR", "不支持的请求 Content-Type"],
  429: ["RATE_LIMITED", "请求或资源达到限制"],
  500: ["INTERNAL_ERROR", "内部操作失败"],
  502: ["BAD_GATEWAY", "引擎执行或模型连接失败"],
  503: ["SERVICE_UNAVAILABLE", "Agent/服务未就绪、维护中或连接已达上限"],
  504: ["TIMEOUT", "执行或系统操作超时"],
};
const requestIdHeader = { "X-Request-ID": { description: "请求追踪 ID，用于定位日志。", schema: str } };
const response = (schema: Schema, description = "成功", example?: unknown, mediaType = "application/json") => ({
  description, headers: requestIdHeader, content: { [mediaType]: { schema, ...(example === undefined ? {} : { example }) } },
});
const errorResponses = Object.fromEntries(Object.entries(errors).map(([status, [code, description]]) => [status, response(ref("Error"), description, { code, message: description })]));
const paths: Record<string, Record<string, unknown>> = {};
const parameter = (name: string, schema: Schema, description: string, required = false, location = "query") => ({ name, in: location, required, description, schema });
const idParameter = parameter("id", { type: "string", minLength: 1, maxLength: 300 }, "资源 ID；使用创建/列表接口返回的值。", true, "path");
const agentParameter = { ...idParameter, schema: json(agentIdSchema), description: "Agent ID。" };
const pagination = [
  parameter("limit", { type: "integer", minimum: 1, maximum: 100, default: 20 }, "每页条数。"),
  parameter("cursor", { type: "string", maxLength: 2000 }, "上一页 nextCursor；首请求省略。"),
];
const timeRange = [
  parameter("from", date, "起始 UTC 时间（含边界）；省略为当前时间减 1 小时。"),
  parameter("to", date, "结束 UTC 时间（含边界）；省略为当前时间。from ≤ to，跨度最多 7 天。"),
  parameter("engine", { type: "string", maxLength: 100, pattern: "^[a-zA-Z0-9_-]*$", default: "" }, "按 Agent ID 筛选；空字符串表示全部。"),
];
function operation(method: string, url: string, operationId: string, tag: string, summary: string, output: Schema | null,
  options: { input?: Schema; parameters?: ReturnType<typeof parameter>[]; status?: number; errors?: number[]; description?: string; example?: unknown; result?: unknown; mediaType?: string } = {}) {
  const status = options.status ?? 200;
  paths[url] ??= {};
  paths[url]![method] = {
    operationId, tags: [tag], summary, description: options.description ?? summary,
    parameters: [...(url.includes("{id}") && !options.parameters?.some((p) => p.in === "path") ? [idParameter] : []), ...options.parameters ?? []],
    ...(options.input ? { requestBody: { required: true, content: { "application/json": { schema: options.input.type === "object" ? { ...options.input, additionalProperties: false } : options.input, ...(options.example === undefined ? {} : { example: options.example }) } } } } : {}),
    responses: {
      [status]: output === null ? { description: "执行成功；无响应体。", headers: requestIdHeader } : response(output, status === 202 ? "已受理；通过查询接口确认最终结果。" : "成功", options.result, options.mediaType),
      ...Object.fromEntries([...new Set([400, 403, 500, ...(method !== "get" ? [503] : []), ...(options.input ? [413, 415] : []), ...options.errors ?? []])].map((code) => [code, errorResponses[code]])),
    },
  };
}
operation("get", "/api/examples/session.md", "sessionLifecycle", "调用示例", "完整会话：发现引擎与模型 → 创建 → 审批 → 完成 → 清理", str, { mediaType: "text/plain", description: sessionGuide });

const sessionExample = { directory: "/absolute/workspace", engineId: "pi", title: "会话示例", interactionPolicy: { permission: "manual", question: "manual" } };
const promptExample = { parts: [{ type: "text", text: "检查项目并运行测试；需要权限或信息时先询问我。" }] };
const acceptedExample = { submissionId: "turn-001", taskId: "ses_001", sessionId: "ses_001", runId: "run_001", acceptedAt: "2026-09-09T06:00:00Z" };
const messageExample = { id: "msg_001", sessionId: "ses_001", runId: "run_001", role: "assistant", created_at: "2026-09-09T06:00:01Z", completedAt: "2026-09-09T06:00:02Z", info: { finish: "stop" }, parts: [{ id: "part_001", type: "text", content: "检查完成。" }, { id: "part_002", type: "step-finish", reason: "stop", usage: null }] };

operation("post", "/session", "createSession", "会话", "创建会话", ref("SessionCreated"), { input: ref("CreateSession"), errors: [404, 429, 502, 503, 504], example: sessionExample,
  result: { id: "ses_001", ...sessionExample, created_at: "2026-09-09T06:00:00Z", status: "idle" }, description: "仅创建会话，不执行消息。记录返回的 id。需要人工审批时显式设置 interactionPolicy 为 manual；省略则继承 Agent 已应用策略。工作目录、引擎和策略在创建后固定。" });
operation("get", "/session/{id}", "getSession", "会话", "查询会话", ref("SessionView"), { errors: [404], description: "status=idle 仅表示当前空闲，不表示上一轮成功。message_count 为会话消息总数。" });
operation("get", "/session/status", "listSessionStatuses", "会话", "查询所有会话忙闲状态", dictionary(object({ type: enumeration("busy", "idle") })), { result: { ses_001: { type: "idle" } } });
operation("post", "/session/{id}/prompt_async", "promptSession", "会话", "提交消息并等待本轮结束", null, { input: ref("Prompt"), status: 204, errors: [404, 409, 429, 502, 504], example: promptExample,
  description: "名称虽为 prompt_async，HTTP 连接会等待本轮终态：成功 204（空响应）、失败 502、超时 504、取消 409。HTTP 超时应大于运行上限（默认 1800 秒，可在系统信息页配置）。manual 模式须在另一连接处理审批/问题。无需重新创建会话即可再次调用完成多轮对话。此接口无幂等键；需要立即返回 runId 和幂等重试请用 POST /api/tasks/{id}/runs。" });
operation("get", "/session/{id}/message", "listSessionMessages", "会话", "读取会话消息与工具轨迹", array(ref("Message")), { errors: [404], result: [messageExample],
  description: "返回全部消息（不分页）。文本在 parts[].content。最终助手消息需 role=assistant、info.finish=stop 且含 step-finish；tool-calls 或单独 step-finish 不能判定成功。失败时仍可读取已有轨迹。" });
for (const action of ["abort", "stop"]) operation("post", `/session/{id}/${action}`, `${action}Session`, "会话", action === "abort" ? "中止会话执行" : "中止会话执行（abort 别名）", ref("Ok"), { errors: [404, 409, 504], result: { ok: true }, description: "无请求体。取消本会话活动与排队中的执行，未完成交互会过期；保留会话和已生成消息，后续仍可提交新一轮。" });
operation("delete", "/session/{id}", "deleteSession", "会话", "删除会话", ref("Ok"), { errors: [404, 409, 504], result: { ok: true }, description: "无请求体。停止执行并删除会话及关联记录；先读取所需消息与产物。此接口用于最终清理；一轮正常完成后无需删除，可继续使用会话。没有独立的 close/end 接口。" });
for (const kind of ["permission", "question"] as const) {
  operation("get", `/${kind}`, `list${kind === "permission" ? "Permissions" : "Questions"}`, "审批与问题", kind === "permission" ? "查询待处理权限审批" : "查询待回答问题", array(ref("Interaction")), { description: "返回所有会话中 state=pending/replying 的对应交互，无过滤参数。按 sessionID 和 runId 在客户端筛选，仅回复 pending 项；也可从 SSE 接收 asked 事件。无待处理项时返回 []。" });
  operation("post", `/${kind}/{id}/reply`, kind === "permission" ? "replyPermission" : "replyQuestion", "审批与问题", kind === "permission" ? "回复权限审批" : "回答问题", ref("Ok"), {
    input: ref(kind === "permission" ? "PermissionReply" : "QuestionReply"), errors: [404, 409, 502, 504], result: { ok: true },
    parameters: [{ ...idParameter, description: "Interaction.id（不是会话 ID）；来自对应 GET 列表或 SSE asked 事件。" }],
    example: kind === "permission" ? { reply: "once", message: "允许本次操作" } : { answers: [["第一题选项 label"], ["第二题回答"]] },
    description: kind === "permission" ? "once 单次批准，always 的作用范围服从原生引擎，reject 拒绝。成功后继续等待本轮结果，不代表本轮已结束。重复、过期或执行已结束返回 409；重新查询，不要盲目重复批准。" : "answers 必须与 questions 顺序和数量一致；每题为字符串数组，遵循 multiple 和 allowCustom。格式/选项不符返回 400；重复、过期或执行已结束返回 409。",
  });
}
operation("post", "/api/tasks", "createTask", "任务与执行", "创建会话并提交首轮", ref("AcceptedRun"), { input: ref("CreateTask"), status: 202, errors: [404, 409, 410, 429, 502, 504], example: { ...sessionExample, ...promptExample, submissionId: "turn-001" }, result: acceptedExample,
  description: "立即返回已受理执行，不等待完成。按 runId 轮询 GET /api/runs/{id}；manual 策略同样需要审批/问题回复。相同幂等键和请求可安全重试。" });
operation("post", "/api/tasks/{id}/runs", "submitRun", "任务与执行", "向已有会话追加一轮", ref("AcceptedRun"), { input: ref("SubmitRun"), status: 202, errors: [404, 409, 410, 429], example: { ...promptExample, submissionId: "turn-002" }, result: { ...acceptedExample, submissionId: "turn-002", runId: "run_002" }, description: "路径 id 为已有 sessionId/taskId。同会话各轮串行执行；立即返回 runId，推荐在人工交互客户端中使用。每一新轮使用新 submissionId。" });
operation("get", "/api/tasks", "listTasks", "任务与执行", "分页查询任务", page("TaskSummary"), { parameters: [...pagination, parameter("q", { type: "string", maxLength: 300, default: "" }, "标题或 ID 的不区分大小写子串。"), parameter("status", { ...enumeration(...runStates, "not_started", "waiting_input", "unavailable", "deleting", ""), default: "" }, "精确匹配状态；空字符串表示全部。")], errors: [409], description: "按创建时间和 ID 降序。保留 nextCursor 与原筛选；游标不匹配筛选返回 400，锚点已删除返回 409。" });
operation("get", "/api/tasks/{id}", "getTask", "任务与执行", "读取任务详情", object({ snapshot: ref("Snapshot"), detail: ref("TaskDetail") }), { errors: [404] });
operation("get", "/api/tasks/{id}/runs", "listTaskRuns", "任务与执行", "分页读取会话执行记录", page("Run"), { parameters: pagination, errors: [404, 409] });
operation("get", "/api/runs/{id}", "getRun", "任务与执行", "读取本轮结果", object({ snapshot: ref("Snapshot"), detail: object({ run: ref("Run"), messages: array(ref("Message")) }) }), { errors: [404], description: "轮询 detail.run.state；completed/failed/timed_out/cancelled 均为终态，仅 completed 成功。失败原因见 error，输出见 detail.messages。manual 等待审批时仍为非终态，应继续处理交互。" });
operation("get", "/api/runs/{id}/messages", "listRunMessages", "任务与执行", "分页读取本轮消息", page("Message"), { parameters: pagination, errors: [404, 409] });
operation("get", "/api/submissions/{id}", "getSubmission", "任务与执行", "查询幂等提交结果", ref("Submission"), { parameters: [parameter("operation", enumeration("create", "append"), "原提交操作：create 创建任务，append 追加执行。", true), parameter("sessionId", { type: "string", default: "" }, "append 时传原 sessionId；create 时省略。")], errors: [404], description: "用于提交响应丢失后的结果核对。检查 status/result/error，避免更换幂等键造成重复执行。" });

const controlEvent = object({ type: enumeration("server.connected", "server.heartbeat", "server.resync_required"), properties: object({ ...(schemas.Snapshot!.properties as Record<string, Schema>), heartbeatMs: { type: "integer", const: 15000 } }) });
schemas.AppEvent = object({ schemaVersion: { type: "integer", const: 1 }, eventId: str, revision: int, instanceId: str, occurredAt: date, type: str, sessionId: str, runId: str, properties: described({}, "由 type 决定；详见 /event 的事件表。") }, ["sessionId", "runId"]);
schemas.ControlEvent = controlEvent;
operation("get", "/event", "subscribeEvents", "事件", "订阅会话事件（SSE）", { type: "string", description: "SSE 文本帧；data 中为 AppEvent 或 ControlEvent JSON。" }, {
  parameters: [parameter("sessionId", str, "仅接收此会话的业务事件；省略接收全部。"), parameter("Last-Event-ID", str, "上次业务帧 id；断线后回放。无游标从当前时刻开始。", false, "header")], errors: [404, 503], mediaType: "text/event-stream",
  result: 'data: {"type":"server.connected","properties":{"storeId":"store_001","instanceId":"instance_001","revision":1,"cursor":"evt_001","capturedAt":"2026-09-09T06:00:00Z","heartbeatMs":15000}}\n\nid: evt_002\ndata: {"schemaVersion":1,"eventId":"evt_002","revision":2,"instanceId":"instance_001","occurredAt":"2026-09-09T06:00:01Z","type":"session.idle","sessionId":"ses_001","properties":{"sessionID":"ses_001"}}\n\n',
  description: `创建会话后、提交消息前建立连接。帧使用 id: 与 data:，没有 event: 行；data 是 JSON。控制帧无持久化 id，立即发送 connected，每 15 秒 heartbeat。收到 server.resync_required 时重读任务/消息/审批快照，更新游标；不能假设历史完整。连接/慢消费者缓冲有上限。\n\n| type | properties |\n| --- | --- |\n| server.connected / server.heartbeat / server.resync_required | Snapshot 字段 + heartbeatMs:15000 |\n| permission.asked / question.asked / interaction.updated | Interaction；按 sessionID/runId 匹配 |\n| session.status | {sessionID,status:{type:"busy"或"idle"}} |\n| session.idle | {sessionID}；空闲不表示成功 |\n| session.error | {sessionID,error:Failure} |\n| message.updated | Message 元数据（不含 parts） |\n| message.part.updated | {sessionID,messageID,part:MessagePart} |\n| session.created / session.updated | TaskSummary |\n| session.deleted | {sessionID} |\n| run.accepted / run.updated / run.finished | Run |\n| artifact.updated | Artifact |\n| agents.updated | AgentView[] |\n\n业务 data 结构见 AppEvent，控制 data 结构见 ControlEvent。`,
});
operation("get", "/health/live", "liveness", "系统", "检查进程存活", object({ ok: { type: "boolean", const: true }, instanceId: str }));
operation("get", "/health/ready", "readiness", "系统", "检查服务就绪", object({ ok: bool, engine: ref("EngineHealth") }), { description: "存储健康且至少一个 Agent ready 时返回 200，否则 503。engine 是默认 Agent 的健康状态。" });
(paths["/health/ready"]!.get as { responses: Record<string, unknown> }).responses[503] = response(object({ ok: { type: "boolean", const: false }, engine: ref("EngineHealth") }), "存储不健康或没有就绪的 Agent");
operation("get", "/api/runtime", "getRuntimeInfo", "系统", "读取引擎、模型与运行限制", ref("RuntimeInfo"));
operation("get", "/api/system", "getSystem", "系统", "读取系统信息", ref("SystemView"));
operation("get", "/api/system/gateway", "getGatewaySettings", "系统", "读取监听配置", ref("GatewayView"), { errors: [409, 429, 503, 504] });
operation("put", "/api/system/gateway", "saveGatewaySettings", "系统", "保存监听配置", ref("GatewayView"), { input: object({ revision: { type: "string", minLength: 64, maxLength: 64 }, settings: ref("GatewaySettings") }), errors: [409, 429, 504], description: "revision 原样使用 GET 返回值。保存后调用 lifecycle restart 生效；port=0 自动分配，0.0.0.0/:: 监听全部对应网卡。改址后按 url/urls 重连。", example: { revision: "a".repeat(64), settings: { host: "127.0.0.1", port: 6217 } } });
operation("get", "/api/system/network", "getNetworkSettings", "系统", "读取网络配置", ref("NetworkView"), { errors: [409, 429, 503, 504] });
operation("put", "/api/system/network", "saveNetworkSettings", "系统", "保存网络配置", ref("NetworkView"), { input: object({ revision: { type: "string", minLength: 64, maxLength: 64 }, settings: ref("NetworkInput") }), errors: [409, 429, 504], description: "完整 settings 与上一 GET 的 revision 必填。保存后重启生效；proxyPassword 省略保留、空字符串清除。" });
operation("post", "/api/system/network/test", "testNetwork", "系统", "测试网络连接", object({ status: int, durationMs: num, scope: { type: "string", const: "gateway" } }), { input: object({ settings: ref("NetworkInput"), url: { type: "string", format: "uri", maxLength: 4096 } }), errors: [409, 429, 504], description: "使用草稿 settings 测试，不保存。url 必须为不含凭据的 HTTP(S) 地址；返回目标 HTTP 状态和耗时（毫秒）。" });
operation("post", "/api/system/lifecycle", "changeLifecycle", "系统", "重启或关闭网关", object({ accepted: { type: "boolean", const: true } }), { input: json(lifecycleSchema), status: 202, errors: [409, 429, 504], example: { action: "restart", mode: "wait" }, description: "wait 等待已有任务完成；stop 停止任务。202 后连接将断开，重启时等待新地址 /health/live。影响整个网关；结束单个会话使用会话 abort/delete。" });
operation("get", "/api/system/directories", "listDirectories", "系统", "浏览工作目录", ref("DirectoryView"), { parameters: [parameter("directory", { type: "string", maxLength: 4096 }, "主机绝对路径；省略列出允许的根目录。")], description: "只返回可见目录；最多 500 条、最多扫描 5000 个子项，达到上限时 truncated=true。parent 为 null 表示不能再向上浏览。" });
operation("post", "/api/system/certificates", "uploadCertificate", "系统", "保存 PEM CA 证书", object({ path: str }), { input: object({ pem: { type: "string", minLength: 1, maxLength: 2097152 } }), description: "pem 为有效的 CA 证书，最多 2 MiB；本接口 JSON 请求体上限 3 MiB。返回网关主机上的保存路径，可用于 caFile。" });
operation("get", "/api/settings", "getSettings", "Agent 与资源", "读取资源配置", ref("SettingsView"));
operation("put", "/api/settings", "saveSettings", "Agent 与资源", "替换资源配置", ref("SettingsView"), { input: object({ settings: ref("SettingsInput"), revision: str }), errors: [409], description: "完整替换配置，revision 必须匹配 GET 结果；冲突返回 409。返回掩码密钥 ******** 可原样提交保留旧值。Agent 资源配置保存后对相关 Agent 执行 apply；runTimeoutMs 为 60000–86400000 毫秒，保存后立即用于四个 Agent 的新任务，无需 apply 或重启，优先于 AGENT_LIMITS.runTimeoutMs。省略时使用环境变量或默认 1800000 毫秒。" });
operation("get", "/api/agents", "listAgents", "Agent 与资源", "读取 Agent 状态", object({ agents: array(ref("AgentView")) }));
operation("post", "/api/agents/{id}/actions", "actOnAgent", "Agent 与资源", "启用、停用、停止或应用 Agent 配置", ref("AgentView"), { input: json(agentActionSchema), parameters: [agentParameter], status: 202, errors: [409, 502, 504], description: "disable/apply 等待活动执行；stop 强制停止。202 后轮询 /api/agents 的 operation/error/health。" });
operation("get", "/api/engines/{id}/models", "listModels", "Agent 与资源", "查询 Agent 可用模型", object({ models: array(ref("ModelOption")) }), { parameters: [agentParameter], errors: [404, 503, 504] });
operation("post", "/api/providers/{id}/test", "testProvider", "Agent 与资源", "测试已保存模型连接", object({ ok: { type: "boolean", const: true }, durationMs: num, modelID: str }), { input: object({ modelID: { type: "string", minLength: 1, maxLength: 300 } }), errors: [502], description: "id 为配置中的 provider ID；使用已保存的凭据发起真实模型请求。失败返回 502 MODEL_CONNECTION_ERROR，耗时单位毫秒。" });
operation("post", "/api/agents/{id}/import", "previewNativeConfig", "Agent 与资源", "预览原生配置导入", object({ providers: array(json(providerSchema, "output")), skills: array(json(skillSchema, "output")), mcp: array(json(mcpSchema, "output")), warnings: array(str) }), { input: object({ file: { type: "string", minLength: 1, maxLength: 4096 } }), parameters: [agentParameter], description: "file 为主机上已存在的绝对 JSON/TOML 文件路径，大小不超过 1 MiB。只预览支持的资源，不保存、不导入密钥；检查 warnings 后合并到 settings。" });
operation("get", "/api/runtimes", "listRuntimes", "Agent 与资源", "查询 CLI 安装状态", object({ runtimes: array(ref("RuntimeView")) }));
operation("post", "/api/runtimes/{id}/actions", "actOnRuntime", "Agent 与资源", "检查、检测、安装、更新、卸载或取消 CLI 操作", object({ runtime: ref("RuntimeView") }), { input: json(runtimeActionSchema), parameters: [agentParameter], status: 202, errors: [409], description: "202 后轮询 /api/runtimes 查看 operation/progress/error。安装完成不会自动启用 Agent。" });
operation("put", "/api/runtimes/{id}/source", "bindRuntimeSource", "Agent 与资源", "绑定托管或外部 CLI", object({ runtime: ref("RuntimeView") }), { input: { ...json(runtimeSourceSchema), description: "mode=external 时 command 必填；mode=managed 使用受管安装。" }, parameters: [agentParameter], status: 202, errors: [409], example: { mode: "external", command: "/usr/local/bin/pi" } });
operation("get", "/api/artifacts/{id}", "getArtifact", "产物", "读取产物元数据", ref("Artifact"), { errors: [404], description: "产物 ID 来自任务 detail.artifacts；返回当前 availability，缺失/变化会更新状态。" });
operation("get", "/api/artifacts/{id}/content", "downloadArtifact", "产物", "读取产物内容", { type: "string", format: "binary" }, { parameters: [parameter("disposition", { ...enumeration("inline", "attachment"), default: "attachment" }, "inline 仅允许不超过 1 MiB 的 text/*，以 text/plain 返回；attachment 按产物媒体类型下载。")], errors: [404, 409, 503], mediaType: "application/octet-stream",
  description: "返回校验过 SHA-256 的完整文件，最大 100 MiB；不支持 Range/206。响应 Content-Type 为产物媒体类型（inline 为 text/plain），Content-Disposition 提供文件名。产物变化返回 409；请使用 ID，不要从原始路径拼接 URL。" });
operation("get", "/api/observability/overview", "getOverview", "观测", "查询执行与资源汇总", ref("Overview"), { parameters: timeRange });
operation("get", "/api/observability/series", "getSeries", "观测", "查询时序指标", ref("Series"), { parameters: [...timeRange, parameter("metric", enumeration("rssBytes", "heapBytes", "activeRuns", "queueDepth", "completed", "failed"), "指标名称。", true)] });
operation("get", "/api/observability/errors", "listErrors", "观测", "查询错误与警告日志", object({ items: array(ref("RuntimeLog")), from: date, to: date }), { parameters: [...timeRange, parameter("stage", { type: "string", default: "" }, "阶段，空字符串表示全部。"), parameter("code", { type: "string", default: "" }, "错误码，空字符串表示全部。"), parameter("limit", { type: "integer", minimum: 1, maximum: 100, default: 50 }, "最多返回条数；按日志 ID 降序。") ] });
operation("get", "/api/observability/runs/{id}", "getRunDiagnostics", "观测", "读取单轮诊断", object({ run: ref("Run"), logs: array(ref("RuntimeLog")), spans: array(object({ name: str, startedAt: nullable(date), finishedAt: nullable(date), state: str }, ["state"])), coverage: { type: "string", const: "gateway-and-observed-tools" } }), { errors: [404] });
operation("get", "/metrics", "getMetrics", "观测", "读取 Prometheus 指标", str, { mediaType: "text/plain" });
operation("get", "/api/docs.md", "getApiMarkdown", "文档", "下载完整 Markdown API 文档（供 Agent 使用）", str, { mediaType: "text/markdown", description: "包含全部接口、参数/响应字段、必填、约束、错误码、示例与完整会话流程；与网页使用同一份 OpenAPI 定义。" });
operation("get", "/api/docs", "getApiDocs", "文档", "打开 API 文档", str, { mediaType: "text/html" });
operation("get", "/api/openapi.json", "getOpenApi", "文档", "下载 OpenAPI 3.1 定义", { type: "object", description: "OpenAPI 3.1 文档，包含 info、servers、paths、components。" });
operation("get", "/api/examples/evaluate.mjs", "getEvaluationExample", "文档", "下载自动会话验证脚本", str, { mediaType: "text/plain", description: "Node.js >=22.21，无第三方依赖。node evaluate.mjs --url http://127.0.0.1:6217 --directory /absolute/workspace --prompt '只回复 OK'；脚本使用 auto 交互策略。" });

export const openapi = {
  openapi: "3.1.0",
  info: { title: "AgentBridge API", version: createRequire(import.meta.url)(`${codeRoot}/package.json`).version as string,
    description: "Base URL 为当前网关地址。无需 Authorization/Cookie；仅供受信任客户端，同源与目录访问约束仍生效。JSON 请求使用 Content-Type: application/json，默认最大 1 MiB。响应头 X-Request-ID 用于追踪。字段标记 required 为必填；null 与省略不同。[Markdown 文档（供 Agent 使用）](/api/docs.md) · [完整会话示例](/api/examples/session.md)。" },
  servers: [{ url: "/", description: "当前网关" }], security: [],
  tags: [
    { name: "调用示例" },
    { name: "会话", description: "会话支持多轮复用。引擎与模型发现、人工审批和清理的完整步骤见「调用示例」。" },
    ...["审批与问题", "任务与执行", "事件", "产物", "Agent 与资源", "系统", "观测", "文档"].map((name) => ({ name })),
  ], paths, components: { schemas },
};
