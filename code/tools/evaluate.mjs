import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";

const { values } = parseArgs({ options: {
  url: { type: "string", default: "http://127.0.0.1:3000" },
  directory: { type: "string" },
  engine: { type: "string", default: "pi" },
  prompt: { type: "string", default: "只回复 OK" },
  timeout: { type: "string", default: "660000" },
} });
if (!values.directory) throw new Error("请用 --directory 指定网关主机上存在的绝对工作目录");
const timeout = Number(values.timeout);
if (!Number.isSafeInteger(timeout) || timeout < 1000 || timeout > 2147483647) throw new Error("--timeout 必须为 1000–2147483647 毫秒");
const signal = AbortSignal.timeout(timeout);
const base = new URL(values.url);
if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) throw new Error("--url 必须为无凭据的 HTTP(S) 网关地址");
async function request(route, body) {
  const response = await fetch(new URL(route, base), {
    signal, ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(result)}`);
  return result;
}
await request("/health/ready");
const submissionId = randomUUID();
// Keep the submission ID in stderr so an interrupted request can be reconciled.
process.stderr.write(`submissionId=${submissionId}\n`);
const accepted = await request("/api/tasks", {
  submissionId, engineId: values.engine, directory: values.directory,
  title: "自动化网关评测", parts: [{ type: "text", text: values.prompt }],
  interactionPolicy: { permission: "auto", question: "auto" },
});
process.stderr.write(`sessionId=${accepted.sessionId} runId=${accepted.runId}\n`);
for (;;) {
  const { detail } = await request(`/api/runs/${encodeURIComponent(accepted.runId)}`);
  if (["completed", "failed", "timed_out", "cancelled"].includes(detail.run.state)) {
    const task = await request(`/api/tasks/${encodeURIComponent(accepted.sessionId)}`);
    process.stdout.write(JSON.stringify({ ...accepted, ...detail, artifacts: task.detail.artifacts }, null, 2) + "\n");
    if (detail.run.state !== "completed") process.exitCode = 1;
    break;
  }
  await setTimeout(500, undefined, { signal });
}
