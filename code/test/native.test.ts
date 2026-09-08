import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { readConfig } from "../src/config.js";
import { PiAdapter } from "../src/engines/pi/adapter.js";
import { OpenCodeAdapter } from "../src/engines/opencode/adapter.js";
import type { Session } from "../shared/contracts.js";
import { createTaskSchema } from "../shared/contracts.js";
import { SessionRuntime, within } from "../src/runtime/sessions.js";
import { Store } from "../src/storage/sqlite.js";
import { SettingsManager, applyAgentConfiguration } from "../src/settings.js";

for (const engine of ["pi", "opencode"] as const)
  test(
    `${engine} native process lifecycle (no model request)`,
    { skip: process.env.AGENT_NATIVE_SMOKE !== engine },
    async () => {
      const directory = await mkdtemp(
        path.join(os.tmpdir(), "agentbridge-native-"),
      );
      const config = readConfig(["--engine", engine], {
        ...process.env,
        AGENT_DATA_DIR: path.join(directory, "data"),
        ENGINE_A_PASSWORD: "native-smoke-secret",
      });
      let adapter =
        engine === "pi" ? new PiAdapter(config) : new OpenCodeAdapter(config);
      const session: Session = {
        id: randomUUID(),
        title: "Native smoke",
        directory,
        engineId: engine,
        interactionPolicy: { permission: "auto", question: "auto" },
        availability: "ready",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
      };
      try {
        applyAgentConfiguration(config, engine);
        await adapter.start();
        assert.equal(adapter.health().status, "ready");
        const binding = await adapter.createSession(session);
        assert.ok(binding.nativeSessionId);
        await adapter.forceStop(session.id);
        if (engine === "opencode") {
          await adapter.stop();
          await adapter.start();
        }
        const recovered = await adapter.recoverSession(session, binding);
        assert.ok(
          recovered && recovered.processGeneration > binding.processGeneration,
        );
        assert.equal(recovered.nativeSessionId, binding.nativeSessionId);
        await adapter.stop();
        adapter =
          engine === "pi" ? new PiAdapter(config) : new OpenCodeAdapter(config);
        await adapter.start();
        const cold = await adapter.recoverSession(session, recovered);
        assert.equal(cold?.nativeSessionId, binding.nativeSessionId);
        if (engine === "pi") {
          await adapter.stop();
          const file = path.join(
            config.dataDirectory,
            "agents",
            "pi",
            "sessions",
            `${session.id}.jsonl`,
          );
          const history = await readFile(file, "utf8");
          const failing = new PiAdapter({
            ...config,
            pi: { ...config.pi, command: process.execPath },
          });
          try {
            await failing.start();
            await assert.rejects(failing.recoverSession(session, binding));
            assert.equal(await readFile(file, "utf8"), history);
            assert.equal(failing.health().processes, 0);
          } finally {
            await failing.stop();
          }
          await adapter.start();
          assert.equal(
            (await adapter.recoverSession(session, binding))?.nativeSessionId,
            binding.nativeSessionId,
          );
        }
        if (engine === "opencode")
          await assert.rejects(
            adapter.recoverSession(
              { ...session, directory: path.join(directory, "wrong") },
              binding,
            ),
          );
        await adapter.abort(session.id, randomUUID());
        await adapter.disposeSession(session.id);
        if (engine === "pi") {
          const file = path.join(
            config.dataDirectory,
            "agents",
            "pi",
            "sessions",
            `${session.id}.jsonl`,
          );
          await assert.rejects(adapter.recoverSession(session, binding));
          await assert.rejects(readFile(file), { code: "ENOENT" });
          for (const content of [
            "",
            "invalid history\n",
            JSON.stringify({
              type: "session",
              version: 3,
              id: randomUUID(),
              timestamp: new Date().toISOString(),
              cwd: directory,
            }) + "\n",
          ]) {
            await writeFile(file, content);
            await assert.rejects(adapter.recoverSession(session, binding));
            assert.equal(await readFile(file, "utf8"), content);
            assert.equal(adapter.health().processes, 0);
          }
        }
      } finally {
        await adapter.stop();
        await rm(directory, { recursive: true, force: true });
      }
      assert.equal(adapter.health().processes, 0);
    },
  );

for (const engine of ["pi", "opencode"] as const)
  test(
    `${engine} native tool loop with a local model fixture`,
    { skip: process.env.AGENT_NATIVE_MODEL !== engine, timeout: 90000 },
    async () => {
      const directory = await mkdtemp(
        path.join(os.tmpdir(), "agentbridge-model-"),
      );
      const output = path.join(directory, "result.txt");
      const selectedSkill = path.join(directory, "selected-skill");
      const unselectedSkill = path.join(
        directory,
        ".agents",
        "skills",
        "unselected-skill",
      );
      for (const [location, marker] of [
        [selectedSkill, "bridge-selected-marker"],
        [unselectedSkill, "bridge-unselected-marker"],
      ]) {
        await mkdir(location!, { recursive: true });
        await writeFile(
          path.join(location!, "SKILL.md"),
          `---\nname: ${marker}\ndescription: ${marker} handles confirmations.\n---\nConfirm the result.\n`,
        );
      }
      const modelRequests: string[] = [];
      let toolRequests = 0;
      let rejectModel = false;
      let recoveredHistory = false;
      const server = createServer(async (req, res) => {
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(Buffer.from(chunk));
          const body = JSON.parse(Buffer.concat(chunks).toString());
          modelRequests.push(JSON.stringify(body));
          if (
            body.messages.some((message: { content: unknown }) =>
              JSON.stringify(message.content).includes(
                "Continue after gateway restart",
              ),
            )
          ) {
            recoveredHistory = body.messages.some(
              (message: { role: string; content: unknown }) =>
                message.role === "assistant" &&
                JSON.stringify(message.content).includes(
                  "Native execution complete.",
                ),
            );
          }
          if (rejectModel) {
            res.writeHead(401, { "content-type": "application/json" });
            res.end(
              JSON.stringify({
                error: {
                  code: "invalid_api_key",
                  message:
                    "Provider rejected configured key native-test-secret",
                },
              }),
            );
            return;
          }
          const hasTool = body.messages.some(
            (m: { role: string }) => m.role === "tool",
          );
          const useTool = body.tools?.length && !hasTool;
          if (useTool) toolRequests++;
          const tool = {
            id: "call_bridge_write",
            type: "function",
            function: {
              name: "write",
              arguments: JSON.stringify({
                [engine === "pi" ? "path" : "filePath"]: output,
                content: "native tool verified\n",
              }),
            },
          };
          const message = useTool
            ? { role: "assistant", content: null, tool_calls: [tool] }
            : { role: "assistant", content: "Native execution complete." };
          const finish = useTool ? "tool_calls" : "stop";
          const base = {
            id: "chatcmpl_bridge",
            created: Math.floor(Date.now() / 1000),
            model: "bridge-test",
          };
          if (body.stream) {
            res.writeHead(200, { "content-type": "text/event-stream" });
            const send = (delta: unknown, finish_reason: string | null) =>
              res.write(
                `data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
              );
            send(
              useTool
                ? { role: "assistant", tool_calls: [{ index: 0, ...tool }] }
                : message,
              null,
            );
            send({}, finish);
            res.end("data: [DONE]\n\n");
          } else {
            res.writeHead(200, { "content-type": "application/json" });
            res.end(
              JSON.stringify({
                ...base,
                object: "chat.completion",
                choices: [{ index: 0, message, finish_reason: finish }],
                usage: {
                  prompt_tokens: 10,
                  completion_tokens: 5,
                  total_tokens: 15,
                },
              }),
            );
          }
        } catch {
          res.writeHead(500).end();
        }
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const baseUrl = `http://127.0.0.1:${address.port}/v1`;
      const previous = {
        OPENCODE_CONFIG_CONTENT: process.env.OPENCODE_CONFIG_CONTENT,
        ENGINE_B_CONFIG_DIR: process.env.ENGINE_B_CONFIG_DIR,
      };
      const piConfig = path.join(directory, "pi-config");
      await mkdir(piConfig);
      process.env.ENGINE_B_CONFIG_DIR = piConfig;
      process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify({
        enabled_providers: ["bridge"],
        model: "bridge/bridge-test",
        small_model: "bridge/bridge-test",
      });
      const config = readConfig(["--engine", engine], {
        ...process.env,
        AGENT_DATA_DIR: path.join(directory, "data"),
        AGENT_LIMITS: JSON.stringify({ runTimeoutMs: 45000 }),
      });
      let store = new Store(config.database);
      const settings = new SettingsManager(config);
      const initial = settings.view();
      settings.save({
        revision: initial.revision,
        settings: {
          ...initial.settings,
          agents: initial.settings.agents.map((a) =>
            a.id === engine
              ? {
                  ...a,
                  enabled: true,
                  skillIds: ["selected"],
                  models: [{ providerID: "bridge", modelID: "bridge-test" }],
                  defaultModel: {
                    providerID: "bridge",
                    modelID: "bridge-test",
                  },
                }
              : a,
          ),
          skills: [{ id: "selected", path: selectedSkill, enabled: true }],
          providers: [
            {
              id: "bridge",
              baseUrl,
              apiKey: "native-test-secret",
              models: [
                { id: "bridge-test", contextWindow: 32000, maxTokens: 4000 },
              ],
            },
          ],
        },
      });
      const adapter =
        engine === "pi" ? new PiAdapter(config) : new OpenCodeAdapter(config);
      let runtime = new SessionRuntime(store, adapter, config);
      try {
        await runtime.start();
        const accepted = await runtime.submit(
          createTaskSchema.parse({
            submissionId: randomUUID(),
            directory,
            title: "Native tool fixture",
            model: { providerID: "bridge", modelID: "bridge-test" },
            parts: [
              {
                type: "text",
                text: "Write result.txt, then report completion.",
              },
            ],
            interactionPolicy: { permission: "manual", question: "auto" },
          }),
        );
        const pending = await within(
          (async () => {
            for (;;) {
              const item = store
                .list("interactions")
                .find((i) => i.state === "pending");
              if (item) return item;
              const state = runtime.run(accepted.runId).state;
              assert.ok(
                !["failed", "completed", "timed_out"].includes(state),
                `Run ended before approval: ${JSON.stringify(runtime.run(accepted.runId))}`,
              );
              await delay(50);
            }
          })(),
          50000,
        );
        assert.equal(pending.kind, "permission");
        await assert.rejects(readFile(output), { code: "ENOENT" });
        await runtime.reply(pending.id, { decision: "once" });
        const result = await within(runtime.wait(accepted.runId), 20000);
        assert.equal(result.state, "completed", JSON.stringify(result.error));
        assert.equal(await readFile(output, "utf8"), "native tool verified\n");
        assert.equal(toolRequests, 1);
        assert.ok(
          modelRequests.some((request) =>
            request.includes("bridge-selected-marker"),
          ),
          "Selected skill must reach the model",
        );
        assert.ok(
          modelRequests.every(
            (request) => !request.includes("bridge-unselected-marker"),
          ),
          "Unselected project skill must not reach the model",
        );
        const messages = store.messages(accepted.sessionId);
        assert.ok(
          messages.some((m) =>
            m.parts.some((p) => p.type === "tool" && p.state === "completed"),
          ),
        );
        assert.equal(messages.at(-1)?.finishReason, "stop");
        assert.ok(messages.at(-1)?.parts.some((p) => p.type === "step-finish"));
        const originalBinding = store.db
          .prepare(
            "SELECT nativeSessionId FROM engine_bindings WHERE sessionId=?",
          )
          .get(accepted.sessionId)!;
        await runtime.stop();
        store.close();
        store = new Store(config.database);
        runtime = new SessionRuntime(
          store,
          engine === "pi" ? new PiAdapter(config) : new OpenCodeAdapter(config),
          config,
        );
        await runtime.start();
        await within(
          (async () => {
            while (runtime.session(accepted.sessionId).availability !== "ready")
              await delay(50);
          })(),
          15000,
        );
        assert.equal(
          store.db
            .prepare(
              "SELECT nativeSessionId FROM engine_bindings WHERE sessionId=?",
            )
            .get(accepted.sessionId)!.nativeSessionId,
          originalBinding.nativeSessionId,
        );
        const continued = await runtime.submit(
          {
            submissionId: randomUUID(),
            model: { providerID: "bridge", modelID: "bridge-test" },
            parts: [{ type: "text", text: "Continue after gateway restart" }],
          },
          accepted.sessionId,
        );
        assert.equal(
          (await within(runtime.wait(continued.runId), 20000)).state,
          "completed",
        );
        assert.equal(
          recoveredHistory,
          true,
          "Native model history was lost across gateway restart",
        );
        assert.equal(
          toolRequests,
          1,
          "Gateway replayed the original tool execution",
        );
        rejectModel = true;
        const rejected = await runtime.submit(
          createTaskSchema.parse({
            submissionId: randomUUID(),
            directory,
            title: "Provider rejection",
            model: { providerID: "bridge", modelID: "bridge-test" },
            parts: [{ type: "text", text: "Test rejected model request" }],
          }),
        );
        const failure = await within(runtime.wait(rejected.runId), 20000);
        assert.equal(failure.state, "failed");
        assert.match(
          failure.error!.message,
          /Provider rejected configured key/,
        );
        assert.ok(!failure.error!.message.includes("native-test-secret"));
        assert.equal(
          runtime.run(rejected.runId).error?.message,
          failure.error!.message,
        );
        const log = store.db
          .prepare(
            "SELECT message FROM runtime_logs WHERE runId=? AND level='error'",
          )
          .get(rejected.runId);
        assert.match(String(log?.message), /Provider rejected configured key/);
        assert.ok(!String(log?.message).includes("native-test-secret"));
        await runtime.deleteSession(accepted.sessionId);
      } finally {
        await runtime.stop();
        store.close();
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
