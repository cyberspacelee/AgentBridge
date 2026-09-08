import { parseArgs } from "node:util";
import { Readable } from "node:stream";
import { createInterface } from "node:readline";

const { values } = parseArgs({ options: {
  url: { type: "string", default: "http://127.0.0.1:6217" },
  directory: { type: "string" },
  engine: { type: "string" },
  provider: { type: "string" },
  model: { type: "string" },
  prompt: { type: "string", default: "只回复 OK" },
  timeout: { type: "string", default: "660000" },
} });
if (!values.directory) throw new Error("请用 --directory 指定网关主机上存在的绝对工作目录");
if (!!values.provider !== !!values.model) throw new Error("--provider 和 --model 必须一起传入");
const timeout = Number(values.timeout);
if (!Number.isSafeInteger(timeout) || timeout < 1000 || timeout > 2147483647) throw new Error("--timeout 必须为 1000–2147483647 毫秒");
const deadline = AbortSignal.timeout(timeout);
const base = new URL(values.url);
if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) throw new Error("--url 必须为无凭据的 HTTP(S) 网关地址");
async function request(route, body, signal = deadline) {
  const response = await fetch(new URL(route, base), {
    signal, ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  const result = response.status === 204 ? null : await response.json();
  if (!response.ok) throw Object.assign(new Error(result.message ?? `HTTP ${response.status}`), { code: result.code, status: response.status });
  return { status: response.status, result };
}
const { result: runtime } = await request("/api/runtime");
const engine = runtime.engines.find((item) => item.id === (values.engine ?? runtime.engine));
if (!engine || engine.health.status !== "ready") throw new Error("所选引擎尚未就绪");
const model = values.model ? { providerID: values.provider, modelID: values.model } : engine.defaultModel;
if (!model) throw new Error("请配置默认模型，或传入 --provider 和 --model");
const { result: created } = await request("/session", {
  directory: values.directory, ...(values.engine ? { engineId: values.engine } : {}),
  interactionPolicy: { permission: "auto", question: "auto" },
});
const sessionId = created.id;
process.stderr.write(`sessionId=${sessionId} engineId=${created.engineId}\n`);
const prefix = `/session/${encodeURIComponent(sessionId)}`;
const controller = new AbortController();
const events = {};
let reading;
let failure;
let messages = [];
let session = created;
let completed = false;
try {
  const response = await fetch(new URL("/event", base), { signal: AbortSignal.any([deadline, controller.signal]), headers: { Accept: "text/event-stream" } });
  if (!response.ok || !response.headers.get("content-type")?.startsWith("text/event-stream")) throw new Error("无法订阅 SSE 事件");
  const idle = Promise.withResolvers();
  reading = (async () => {
    const lines = createInterface({ input: Readable.fromWeb(response.body) });
    for await (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const event = JSON.parse(line.slice(5));
      const owner = event.properties?.sessionID ?? event.sessionId;
      if (owner && owner !== sessionId) continue;
      events[event.type] = (events[event.type] ?? 0) + 1;
      if (owner === sessionId && event.type === "session.idle") idle.resolve();
    }
    throw new Error("SSE 连接在评测结束前关闭");
  })();
  const prompt = await Promise.race([request(`${prefix}/prompt_async`, {
    parts: [{ type: "text", text: values.prompt }], model, agent: "assistant",
  }), reading]);
  await Promise.race([idle.promise, reading]);
  ({ result: messages } = await request(`${prefix}/message`));
  ({ result: session } = await request(prefix));
  const last = messages.at(-1);
  completed = prompt.status === 204 && session.status === "idle" && last?.role === "assistant" && last.info.finish === "stop" && last.parts.some((part) => part.type === "step-finish");
  if (!completed) throw new Error("本轮缺少成功终态或最终助手消息");
} catch (error) {
  failure = { code: error.code ?? "EVALUATION_FAILED", message: error.message };
  await request(`${prefix}/abort`, {}, AbortSignal.timeout(5000)).catch(() => {});
  ({ result: messages } = await request(`${prefix}/message`, undefined, AbortSignal.timeout(5000)).catch(() => ({ result: [] })));
} finally {
  controller.abort();
  await reading?.catch(() => {});
}
process.stdout.write(JSON.stringify({ sessionId, engineId: created.engineId, completed, session, messages, events, ...(failure ? { error: failure } : {}) }, null, 2) + "\n");
if (!completed) process.exitCode = 1;
