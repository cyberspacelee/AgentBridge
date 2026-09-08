import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { SettingsManager } from "../src/settings.js";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { readConfig } from "../src/config.js";
import { CodexAdapter } from "../src/engines/codex/adapter.js";
import { GrokAdapter } from "../src/engines/grok/adapter.js";
import { SessionRuntime, within } from "../src/runtime/sessions.js";
import { Store } from "../src/storage/sqlite.js";
import { setTimeout as delay } from "node:timers/promises";

for (const id of ["codex", "grok"] as const)
  test(
    `${id} native protocol executes an OpenAI-compatible model and resumes durable conversation`,
    { skip: process.env.AGENT_NATIVE_RPC !== id, timeout: 90000 },
    async () => {
      const directory = await mkdtemp(
        path.join(os.tmpdir(), `bridge-${id}-native-`),
      );
      const requests: Record<string, unknown>[] = [];
      const server = createServer(async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const body = JSON.parse(Buffer.concat(chunks).toString());
        requests.push(body);
        const text = "Native protocol verified.";
        res.setHeader(
          "Content-Type",
          body.stream ? "text/event-stream" : "application/json",
        );
        if (req.url?.endsWith("/responses")) {
          const message = {
            id: "msg_" + randomUUID(),
            type: "message",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text, annotations: [] }],
          };
          const response = {
            id: "resp_" + randomUUID(),
            object: "response",
            created_at: Math.floor(Date.now() / 1000),
            status: "completed",
            model: body.model,
            output: [message],
            usage: {
              input_tokens: 10,
              output_tokens: 4,
              total_tokens: 14,
              input_tokens_details: { cached_tokens: 0 },
              output_tokens_details: { reasoning_tokens: 0 },
            },
          };
          if (!body.stream) {
            res.end(JSON.stringify(response));
            return;
          }
          let sequence_number = 0;
          const send = (type: string, fields: Record<string, unknown>) =>
            res.write(
              `event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: sequence_number++, ...fields })}\n\n`,
            );
          send("response.created", {
            response: {
              ...response,
              status: "in_progress",
              output: [],
              usage: null,
            },
          });
          send("response.output_item.added", {
            output_index: 0,
            item: { ...message, status: "in_progress", content: [] },
          });
          send("response.content_part.added", {
            item_id: message.id,
            output_index: 0,
            content_index: 0,
            part: { type: "output_text", text: "", annotations: [] },
          });
          send("response.output_text.delta", {
            item_id: message.id,
            output_index: 0,
            content_index: 0,
            delta: text,
          });
          send("response.output_text.done", {
            item_id: message.id,
            output_index: 0,
            content_index: 0,
            text,
          });
          send("response.content_part.done", {
            item_id: message.id,
            output_index: 0,
            content_index: 0,
            part: message.content[0],
          });
          send("response.output_item.done", { output_index: 0, item: message });
          send("response.completed", { response });
          res.end();
        } else {
          const base = {
            id: "chatcmpl_" + randomUUID(),
            model: body.model,
            created: Math.floor(Date.now() / 1000),
          };
          if (!body.stream) {
            res.end(
              JSON.stringify({
                ...base,
                object: "chat.completion",
                choices: [
                  {
                    index: 0,
                    message: { role: "assistant", content: text },
                    finish_reason: "stop",
                  },
                ],
                usage: {
                  prompt_tokens: 10,
                  completion_tokens: 4,
                  total_tokens: 14,
                },
              }),
            );
            return;
          }
          for (const [delta, finish_reason] of [
            [{ role: "assistant", content: text }, null],
            [{}, "stop"],
          ])
            res.write(
              `data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
            );
          res.end("data: [DONE]\n\n");
        }
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const config = readConfig(["--engine", id], {
        AGENT_DATA_DIR: path.join(directory, "data"),
        AGENT_OPENAI_BASE_URL: `http://127.0.0.1:${address.port}/v1`,
        AGENT_OPENAI_MODELS: "fixture-model",
        AGENT_OPENAI_API:
          id === "codex" ? "openai-responses" : "openai-completions",
        AGENT_LIMITS: JSON.stringify({ runTimeoutMs: 30000 }),
      });
      const adapter = () =>
        id === "codex" ? new CodexAdapter(config) : new GrokAdapter(config);
      const selected = path.join(directory, "selected-skill"),
        rogue = path.join(directory, ".agents", "skills", "unselected-skill");
      for (const [location, name] of [
        [selected, "bridge-selected-marker"],
        [rogue, "bridge-unselected-marker"],
      ]) {
        await mkdir(location!, { recursive: true });
        await writeFile(
          path.join(location!, "SKILL.md"),
          `---\nname: ${name}\ndescription: ${name} handles test confirmations.\n---\nReturn a confirmation.\n`,
        );
      }
      const settings = new SettingsManager(config),
        view = settings.view();
      view.settings.skills.push({
        id: "selected",
        path: selected,
        enabled: true,
      });
      view.settings.agents.find((a) => a.id === id)!.skillIds = ["selected"];
      settings.save({ settings: view.settings, revision: view.revision });
      let store = new Store(config.database),
        runtime = new SessionRuntime(store, adapter(), config);
      try {
        await runtime.start();
        assert.equal(
          runtime.agentHealth(id).status,
          "ready",
          JSON.stringify(runtime.agentHealth(id)),
        );
        const first = await runtime.submit({
          submissionId: randomUUID(),
          directory,
          parts: [{ type: "text", text: "Return a short confirmation." }],
        });
        const result = await within(runtime.wait(first.runId), 40000);
        assert.equal(result.state, "completed", JSON.stringify(result.error));
        assert.ok(
          store
            .messages(first.sessionId)
            .some((m) =>
              m.parts.some(
                (p) =>
                  p.type === "text" &&
                  p.text.includes("Native protocol verified."),
              ),
            ),
        );
        await runtime.stop();
        store.close();
        store = new Store(config.database);
        runtime = new SessionRuntime(store, adapter(), config);
        await runtime.start();
        await within(
          (async () => {
            while (runtime.session(first.sessionId).availability !== "ready")
              await delay(50);
          })(),
          20000,
        );
        const next = await runtime.submit(
          {
            submissionId: randomUUID(),
            parts: [{ type: "text", text: "Continue after restart." }],
          },
          first.sessionId,
        );
        assert.equal(
          (await within(runtime.wait(next.runId), 40000)).state,
          "completed",
          JSON.stringify(runtime.run(next.runId).error),
        );
        assert.ok(
          requests.every((body) => body.model === "fixture-model"),
          JSON.stringify(requests.map((body) => body.model)),
        );
        assert.ok(
          requests
            .slice(1)
            .some((body) =>
              JSON.stringify(body).includes("Native protocol verified."),
            ),
          "Recovered model context must contain prior assistant output",
        );
        assert.equal(runtime.runs(first.sessionId).length, 2);
        const prompts = JSON.stringify(requests);
        assert.ok(
          prompts.includes("bridge-selected-marker"),
          "The selected skill must reach the model",
        );
        assert.ok(
          !prompts.includes("bridge-unselected-marker"),
          "An unselected project skill must not reach the model",
        );
      } finally {
        await runtime.stop();
        store.close();
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
