import { test } from "node:test";
import assert from "node:assert/strict";
import { readConfig } from "../src/config.js";
import { PiAdapter } from "../src/engines/pi/adapter.js";
import { OpenCodeAdapter } from "../src/engines/opencode/adapter.js";
import type { EngineUpdate } from "../src/engines/adapter.js";
import type { Message } from "../shared/contracts.js";

test("Pi and OpenCode retain thinking deltas and replace final snapshots", () => {
  const config = readConfig([], {});
  const updates: EngineUpdate[] = [];
  const emit = (event: EngineUpdate) => updates.push(structuredClone(event));
  const pi = new PiAdapter(config);
  const rpc = {
    session: { id: "session" },
    active: { run: { id: "run" }, messages: [], usage: new Map(), emit },
  };
  const piEvent = (event: object) => Reflect.get(pi, "event").call(pi, rpc, event);
  piEvent({ type: "message_start", message: { role: "assistant" } });
  for (const delta of ["Checking ", "inputs"])
    piEvent({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta } });
  piEvent({ type: "message_end", message: { role: "assistant", stopReason: "stop", content: [
    { type: "thinking", thinking: "Checking inputs" }, { type: "text", text: "Done" },
  ] } });
  const piMessage = updates.at(-1)!;
  assert.equal(piMessage.type, "message");
  if (piMessage.type !== "message") throw new Error("Missing Pi message");
  assert.deepEqual(piMessage.message.parts.map(p => p.type), ["reasoning", "text"]);
  assert.equal(piMessage.message.parts[0]!.type === "reasoning" && piMessage.message.parts[0].content, "Checking inputs");

  const opencode = new OpenCodeAdapter(config);
  const message: Message = { ...piMessage.message, parts: [] };
  Reflect.get(opencode, "sessions").set("session", {
    nativeId: "native", session: rpc.session,
    active: { run: { id: "run" }, messages: new Map([["message", message]]), emit },
  });
  const event = (type: string, properties: object) => Reflect.get(opencode, "event").call(opencode, { type, properties });
  const part = { id: "thought", messageID: "message", sessionID: "native", type: "reasoning", text: "Checking " };
  event("message.part.updated", { part });
  event("message.part.delta", { sessionID: "native", messageID: "message", partID: "thought", field: "text", delta: "inputs" });
  assert.equal(message.parts[0]!.type === "reasoning" && message.parts[0].content, "Checking inputs");
  event("message.part.updated", { part: { ...part, text: "Checking inputs" } });
  assert.equal(message.parts.length, 1);
  assert.equal(message.parts[0]!.type === "reasoning" && message.parts[0].content, "Checking inputs");
});

test("OpenCode rejects a malformed shared event without exposing its content and cancels the body", async () => {
  const adapter = new OpenCodeAdapter(readConfig([], {}));
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('data: {"private-content"\n\n')); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(Reflect.get(adapter, "consume").call(adapter, new Response(body)), (error: Error) =>
    /Invalid OpenCode event/.test(error.message) && !error.message.includes("private-content"));
  assert.equal(cancelled, true);
});
