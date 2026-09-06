import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { readConfig } from "../src/config.js";
import { Store } from "../src/storage/sqlite.js";
import { SessionRuntime } from "../src/runtime/sessions.js";
import { createServer } from "../src/gateway/server.js";
import type {
  EngineAdapter,
  EngineResult,
  EngineUpdate,
} from "../src/engines/adapter.js";
import type { Message, Run, Session } from "../shared/contracts.js";

// Deterministic engine is confined to the browser test server, never registered in production.
class BrowserEngine implements EngineAdapter {
  constructor(readonly id: string) {}
  async models() {
    return ["primary", "secondary"].flatMap((provider) =>
      ["fast", "quality"].map((model) => ({
        providerID: `${this.id}-${provider}`,
        modelID: model,
        name: `${this.id} ${provider} ${model}`,
      })),
    );
  }
  private active = new Map<
    string,
    { resolve: (result: EngineResult) => void; timer?: NodeJS.Timeout }
  >();
  private approvals = new Map<string, () => void>();
  health() {
    return {
      status: "ready" as const,
      version: "fixture",
      message: null,
      processes: 0,
      restarts: 0,
    };
  }
  async start() {}
  async createSession() {
    return { nativeSessionId: randomUUID(), processGeneration: 1 };
  }
  async run(session: Session, run: Run, emit: (event: EngineUpdate) => void) {
    return new Promise<EngineResult>((resolve) => {
      const entry = { resolve, timer: undefined as NodeJS.Timeout | undefined };
      this.active.set(session.id, entry);
      const finish = () => {
        entry.timer = setTimeout(() => {
          void (async () => {
            const at = new Date().toISOString();
            await writeFile(
              path.join(session.directory, "report.md"),
              "# Sales report\n\nTotal: 42\n",
            );
            if (!this.active.has(session.id)) return;
            const message: Message = {
              id: randomUUID(),
              sessionId: session.id,
              runId: run.id,
              role: "assistant",
              createdAt: at,
              completedAt: at,
              finishReason: "stop",
              parts: [
                {
                  id: randomUUID(),
                  type: "tool",
                  toolCallId: randomUUID(),
                  name: "write",
                  input: { file: "report.md" },
                  output: "Wrote report.md",
                  state: "completed",
                  startedAt: at,
                  finishedAt: at,
                },
                {
                  id: randomUUID(),
                  type: "text",
                  text: "销售分析已完成，结果已写入 report.md。",
                },
              ],
            };
            emit({ type: "message", message });
            this.active.delete(session.id);
            resolve({ outcome: "completed" });
          })().catch(() => resolve({ outcome: "failed" }));
        }, 300);
      };
      if (run.inputParts.some((p) => p.text === "hold")) return;
      if (session.interactionPolicy.permission === "manual") {
        const id = randomUUID();
        this.approvals.set(id, finish);
        emit({
          type: "interaction",
          interaction: {
            id,
            sessionId: session.id,
            runId: run.id,
            kind: "permission",
            title: "写入销售报告",
            questions: [],
            state: "pending",
            policy: "manual",
            createdAt: new Date().toISOString(),
            resolvedAt: null,
            reply: null,
            error: null,
          },
        });
      } else finish();
    });
  }
  async abort(id: string) {
    const entry = this.active.get(id);
    clearTimeout(entry?.timer);
    this.active.delete(id);
    entry?.resolve({ outcome: "aborted" });
  }
  async forceStop(id: string) {
    await this.abort(id);
    return [id];
  }
  async reply(id: string) {
    this.approvals.get(id)?.();
    this.approvals.delete(id);
  }
  async disposeSession(id: string) {
    await this.abort(id);
  }
  async stop() {
    for (const id of this.active.keys()) await this.abort(id);
  }
}
const directory = await mkdtemp(path.join(os.tmpdir(), "agentbridge-browser-"));
const config = readConfig([], {
  AGENT_STORAGE: "memory",
  AGENT_DATA_DIR: directory,
});
const runtime = new SessionRuntime(
  new Store(":memory:"),
  new BrowserEngine("pi"),
  config,
  [new BrowserEngine("opencode")],
);
await runtime.start();
const server = createServer(runtime);
server.get("/__test/directory", async () => ({ directory }));
await server.listen({ host: "127.0.0.1", port: 3010 });
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    void server
      .close()
      .finally(() => rm(directory, { recursive: true, force: true }));
  });
