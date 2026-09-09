import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { OpenCodeAdapter } from "../src/engines/opencode/adapter.js";
import { readConfig } from "../src/config.js";
import { within } from "../src/async.js";
import type { Run, Session } from "../shared/contracts.js";
import type { EngineUpdate } from "../src/engines/adapter.js";

for (const mode of ["normal", "lost-response", "upstream-error", "cancel", "reconnect"] as const)
  test(`OpenCode asynchronous execution: ${mode}`, async () => {
    let parent = "", submissions = 0, messageReads = 0, aborted = false, connections = 0;
    const requests: string[] = [];
    const server = createServer(async (req, res) => {
      const route = new URL(req.url!, "http://local").pathname;
      requests.push(`${req.method} ${route}`);
      if (route.endsWith("/prompt_async")) {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        parent = JSON.parse(Buffer.concat(chunks).toString()).messageID;
        submissions++;
        if (mode === "lost-response") res.destroy();
        else res.writeHead(204).end();
        return;
      }
      if (route === "/global/event") {
        connections++;
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(`data: ${JSON.stringify({ type: "permission.asked", properties: approval() })}\n\n`);
        return;
      }
      let body: unknown;
      if (route === "/permission") body = [approval()];
      else if (route === "/question") body = [];
      else if (route.endsWith("/abort")) { aborted = true; body = true; }
      else if (route === "/session/status") body = (mode === "cancel" || mode === "reconnect") && !aborted ? { native: { type: "busy" } } : {};
      else if (route.endsWith("/message")) {
        messageReads++;
        // A previous turn and an early idle response must not complete this prompt.
        body = [{ info: { id: "old", role: "assistant", parentID: "previous", finish: "stop", time: { created: 1, completed: 2 } }, parts: [] }];
        if (messageReads >= 2) body = [
          { info: { id: parent, role: "user", time: { created: 3 } }, parts: [] },
          { info: { id: "final", role: "assistant", parentID: parent, finish: "stop", time: { created: 4, completed: 5 }, ...(mode === "upstream-error" ? { error: { message: "Headers Timeout" } } : {}) },
            parts: [{ id: "text", type: "text", text: "Finished" }] },
        ];
      } else { res.writeHead(404).end(); return; }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(body));
    });
    function approval() { return { id: "permission-1", sessionID: "native", permission: "read", patterns: ["*"] }; }
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const config = readConfig([], { AGENT_LIMITS: JSON.stringify({ runTimeoutMs: 100, startupTimeoutMs: 1000 }) });
    config.opencode.url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const adapter = new OpenCodeAdapter(config);
    const session: Session = { id: "session", title: "Timeout", titleSource: "user", directory: process.cwd(), engineId: "opencode", availability: "ready", interactionPolicy: { permission: "manual", question: "manual" }, version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    const run: Run = { id: "run", sessionId: session.id, submissionId: "submission", sequence: 1, inputParts: [{ type: "text", text: "work" }], model: null, state: "running", acceptedAt: session.createdAt, deadlineAt: new Date(Date.now() + 1800000).toISOString(), startedAt: session.createdAt, finishedAt: null, stopReason: null, error: null, usage: null, traceId: "trace", configRevision: null, runtimeVersion: null };
    Reflect.get(adapter, "sessions").set(session.id, { session, nativeId: "native" });
    const updates: EngineUpdate[] = [];
    let finished = false;
    const running = adapter.run(session, run, (update) => updates.push(update)).then((result) => { finished = true; return result; });
    let watching: Promise<void> | undefined;
    try {
      if (mode === "cancel" || mode === "reconnect") {
        await delay(150);
        assert.equal(finished, false, "the adapter must not add its own execution deadline");
        if (mode === "reconnect") {
          watching = Reflect.get(adapter, "watchEvents").call(adapter, new Response(new ReadableStream({ start(c) { c.close(); } }))) as Promise<void>;
          await within((async () => { while (!updates.some((u) => u.type === "interaction")) await delay(10); })(), 2000);
          await delay(50);
          assert.equal(connections, 1);
          assert.equal(updates.filter((u) => u.type === "interaction").length, 1, "recovered and streamed approvals must be deduplicated");
        }
        await adapter.abort(session.id);
      }
      const result = await within(running, 4000);
      assert.equal(result.outcome, mode === "cancel" || mode === "reconnect" ? "aborted" : mode === "upstream-error" ? "failed" : "completed");
      if (mode === "upstream-error") assert.match(result.error!.message, /model request failed.*Headers Timeout/);
      if (result.outcome === "completed") {
        assert.ok(messageReads >= 2);
        assert.ok(updates.some((u) => u.type === "message" && u.message.info.finish === "stop"));
      }
      assert.equal(submissions, 1, "ambiguous submissions must never be replayed");
      assert.ok(!requests.includes("POST /session/native/message"), "must not hold a synchronous prompt HTTP request");
    } finally {
      Reflect.get(adapter, "stream").abort();
      await watching;
      await adapter.stop();
      await running.catch(() => {});
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
