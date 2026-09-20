import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { LlmProxy, responsesToChat, chatToResponse, type LlmUsageRecord } from "../src/llm-proxy/server.js";
import { settingsSchema } from "../shared/settings.js";

async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.equal(typeof address, "object");
  return address!.port;
}
function readRequest(req: import("node:http").IncomingMessage) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>); }
      catch (error) { reject(error); }
    });
  });
}

test("Responses requests convert to Chat, preserve tools, cache previous_response_id and report usage", async () => {
  const requests: Record<string, unknown>[] = [];
  const upstream = createServer(async (req, res) => {
    const body = await readRequest(req);
    requests.push(body);
    assert.equal(req.url, "/v1/chat/completions");
    assert.equal(req.headers.authorization, "Bearer upstream-secret");
    assert.equal(req.headers["x-route"], "blue");
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      id: "chat_1",
      model: "test-model",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "OK", tool_calls: [] },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10, prompt_tokens_details: { cached_tokens: 2 } },
    }));
  });
  const port = await listen(upstream);
  const records: LlmUsageRecord[] = [];
  const settings = settingsSchema.parse({
    providers: [{
      id: "test",
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: "upstream-secret",
      api: "openai-responses",
      upstreamApi: "openai-completions",
      // Agent-level Responses selection must work with legacy providers that
      // did not have the provider-wide conversion toggle enabled.
      conversion: "none",
      request: { headers: { "X-Route": "blue" }, params: { temperature: 0 } },
      models: [{ id: "test-model" }],
    }],
  });
  const proxy = new LlmProxy({ host: "127.0.0.1" }, () => settings, (record) => records.push(record));
  await proxy.start();
  try {
    const url = `${proxy.providerBaseUrl("test")}/responses`;
    const first = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${proxy.runtimeToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "test-model",
        instructions: "Be brief",
        input: "hello",
        tools: [{ type: "function", name: "lookup", parameters: { type: "object" } }],
        tool_choice: "required",
        parallel_tool_calls: true,
        max_output_tokens: 32,
        stream: false,
      }),
    });
    assert.equal(first.status, 200);
    const firstBody = await first.json() as Record<string, unknown>;
    assert.equal(firstBody.object, "response");
    assert.equal(firstBody.output_text, "OK");
    assert.equal((firstBody.usage as Record<string, unknown>).input_tokens, 7);
    const firstId = String(firstBody.id);
    const second = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${proxy.runtimeToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "test-model", previous_response_id: firstId, input: "again", stream: false }),
    });
    assert.equal(second.status, 200);
    assert.equal((requests[0]!.messages as unknown[]).length, 2);
    assert.equal((requests[0]!.messages as Record<string, unknown>[])[0]!.role, "system");
    assert.equal((requests[1]!.messages as unknown[]).length, 3);
    assert.equal((requests[1]!.messages as Record<string, unknown>[])[0]!.role, "user");
    assert.equal(requests[0]!.tool_choice, "required");
    assert.equal(requests[0]!.parallel_tool_calls, true);
    const chat = await fetch(`${proxy.providerBaseUrl("test")}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${proxy.runtimeToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "test-model", messages: [{ role: "user", content: "direct" }] }),
    });
    assert.equal(chat.status, 200);
    assert.equal(Array.isArray((await chat.json() as Record<string, unknown>).choices), true);
    assert.equal(records.length, 3);
    assert.equal(records[0]!.conversion, "responses-to-completions");
    assert.equal(records[2]!.conversion, "none");
    assert.deepEqual(records[0]!.usage, { input: 7, output: 3, cacheRead: 2, cacheWrite: null, costUsd: null });
  } finally {
    await proxy.close();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
});

test("Responses to Chat streaming emits Responses events and rejects missing proxy credentials", async () => {
  const upstream = createServer(async (_req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.write("data: {\"id\":\"c\",\"model\":\"m\",\"choices\":[{\"delta\":{\"content\":\"O\"},\"index\":0}]}\n\n");
    res.write("data: {\"id\":\"c\",\"model\":\"m\",\"choices\":[{\"delta\":{\"content\":\"K\"},\"finish_reason\":\"stop\",\"index\":0}],\"usage\":{\"prompt_tokens\":2,\"completion_tokens\":2}}\n\n");
    res.end("data: [DONE]\n\n");
  });
  const port = await listen(upstream);
  const settings = settingsSchema.parse({ providers: [{ id: "stream", baseUrl: `http://127.0.0.1:${port}/v1`, api: "openai-responses", upstreamApi: "openai-completions", conversion: "responses-to-completions", models: [{ id: "m" }] }] });
  const proxy = new LlmProxy({ host: "127.0.0.1" }, () => settings);
  await proxy.start();
  try {
    const url = `${proxy.providerBaseUrl("stream")}/responses`;
    const unauthorized = await fetch(url, { method: "POST", body: JSON.stringify({ model: "m", input: "x" }) });
    assert.equal(unauthorized.status, 401);
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${proxy.runtimeToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "m", input: "x", stream: true }),
    });
    assert.equal(response.status, 200);
    const stream = await response.text();
    assert.match(stream, /response\.created/);
    assert.match(stream, /response\.output_item\.added/);
    assert.match(stream, /response\.content_part\.added/);
    assert.match(stream, /response\.output_text\.delta/);
    assert.match(stream, /"item_id":"msg_/);
    assert.match(stream, /response\.output_text\.done/);
    assert.match(stream, /response\.content_part\.done/);
    assert.match(stream, /response\.completed/);
    assert.match(stream, /"delta":"O"/);
  } finally {
    await proxy.close();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
});

test("store false does not create reusable local Responses history", async () => {
  const upstream = createServer((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ id: "chat", model: "m", choices: [{ message: { role: "assistant", content: "ok" } }] }));
  });
  const port = await listen(upstream);
  const settings = settingsSchema.parse({ providers: [{ id: "store", baseUrl: `http://127.0.0.1:${port}/v1`, api: "openai-responses", upstreamApi: "openai-completions", conversion: "responses-to-completions", models: [{ id: "m" }] }] });
  const proxy = new LlmProxy({ host: "127.0.0.1" }, () => settings);
  await proxy.start();
  try {
    const url = `${proxy.providerBaseUrl("store")}/responses`;
    const first = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${proxy.runtimeToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "m", input: "one", store: false }),
    });
    assert.equal(first.status, 200);
    const id = String((await first.json() as Record<string, unknown>).id);
    const second = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${proxy.runtimeToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "m", previous_response_id: id, input: "two" }),
    });
    assert.equal(second.status, 400);
    const error = (await second.json() as Record<string, unknown>).error as Record<string, unknown>;
    assert.equal(error.code, "PROTOCOL_CONVERSION_UNSUPPORTED");
  } finally {
    await proxy.close();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
});

test("streaming tool calls are represented as Responses function-call events", async () => {
  const upstream = createServer(async (_req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.write(`data: ${JSON.stringify({ model: "m", choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "lookup", arguments: '{"q":"x"}' } }] } }] })}\n\n`);
    res.write(`data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "lookup", arguments: "}" } }] } }] })}\n\n`);
    res.end("data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n");
  });
  const port = await listen(upstream);
  const settings = settingsSchema.parse({ providers: [{ id: "stream-tools", baseUrl: `http://127.0.0.1:${port}/v1`, api: "openai-responses", upstreamApi: "openai-completions", conversion: "responses-to-completions", models: [{ id: "m" }] }] });
  const proxy = new LlmProxy({ host: "127.0.0.1" }, () => settings);
  await proxy.start();
  try {
    const response = await fetch(`${proxy.providerBaseUrl("stream-tools")}/responses`, { method: "POST", headers: { Authorization: `Bearer ${proxy.runtimeToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: "m", input: "x", stream: true }) });
    const body = await response.text();
    assert.match(body, /response\.output_item\.added/);
    assert.match(body, /response\.function_call_arguments\.delta/);
    assert.match(body, /response\.function_call_arguments\.done/);
    assert.match(body, /response\.output_item\.done/);
    assert.match(body, /"type":"function_call"/);
    assert.doesNotMatch(body, /lookuplookup/);
    assert.ok(body.indexOf("response.output_item.added") < body.indexOf("response.function_call_arguments.delta"));
    assert.ok(body.indexOf("response.function_call_arguments.delta") < body.indexOf("response.function_call_arguments.done"));
  } finally {
    await proxy.close();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
});

test("conversion helpers map Responses input and Chat tool calls", () => {
  const chat = responsesToChat({ model: "m", instructions: "rules", input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] }, { type: "function_call_output", call_id: "call_1", output: "done" }], tools: [{ type: "function", name: "lookup", parameters: { type: "object" } }] });
  assert.deepEqual(chat.messages, [
    { role: "system", content: "rules" },
    { role: "user", content: "hello" },
    { role: "tool", tool_call_id: "call_1", content: "done" },
  ]);
  const response = chatToResponse({ model: "m", choices: [{ message: { content: null, tool_calls: [{ id: "call_1", function: { name: "lookup", arguments: "{}" } }] } }], usage: {} });
  assert.equal((response.output as unknown[])[0] && (response.output as unknown[])[0] && ((response.output as unknown[])[0] as Record<string, unknown>).type, "function_call");
  const toolCall = responsesToChat({ model: "m", input: [{ type: "function_call", call_id: "call_1", name: "lookup", arguments: "{}" }] });
  assert.deepEqual(toolCall.messages, [{ role: "assistant", tool_calls: [{ id: "call_1", type: "function", function: { name: "lookup", arguments: "{}" } }] }]);
  assert.deepEqual(responsesToChat({ model: "m", input: "done" }, [{ role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function" }] }]).messages[0], { role: "assistant", tool_calls: [{ id: "call_1", type: "function" }] });
});

test("Responses instructions and developer messages become one leading system message", () => {
  const body = responsesToChat({
    model: "m",
    instructions: "top-level",
    input: [
      { type: "message", role: "user", content: "before" },
      { type: "message", role: "developer", content: "developer rules" },
      { type: "message", role: "user", content: "after" },
    ],
  }, [
    { role: "system", content: "old instructions" },
    { role: "user", content: "previous" },
    { role: "assistant", content: "answer" },
  ]);
  assert.deepEqual(body.messages, [
    { role: "system", content: "top-level\n\ndeveloper rules" },
    { role: "user", content: "previous" },
    { role: "assistant", content: "answer" },
    { role: "user", content: "before" },
    { role: "user", content: "after" },
  ]);
});

test("Responses function calls are grouped into one Chat assistant tool-call message", () => {
  const body = responsesToChat({
    model: "m",
    input: [
      { type: "function_call", call_id: "call_1", name: "one", arguments: "{}" },
      { type: "function_call", call_id: "call_2", name: "two", arguments: "{}" },
      { type: "function_call_output", call_id: "call_1", output: "done" },
    ],
  });
  assert.deepEqual(body.messages, [
    { role: "assistant", tool_calls: [
      { id: "call_1", type: "function", function: { name: "one", arguments: "{}" } },
      { id: "call_2", type: "function", function: { name: "two", arguments: "{}" } },
    ] },
    { role: "tool", tool_call_id: "call_1", content: "done" },
  ]);
});

test("Chat reasoning usage is returned as Responses reasoning token details", () => {
  const response = chatToResponse({
    model: "m",
    choices: [{ message: { content: "ok", reasoning_content: "summary" } }],
    usage: {
      prompt_tokens: 4,
      completion_tokens: 6,
      completion_tokens_details: { reasoning_tokens: 3 },
    },
  });
  assert.deepEqual(response.output, [
    { type: "reasoning", id: (response.output as Record<string, unknown>[])[0]!.id, summary: [{ type: "summary_text", text: "summary" }] },
    { type: "message", id: (response.output as Record<string, unknown>[])[1]!.id, status: "completed", role: "assistant", content: [{ type: "output_text", text: "ok", annotations: [] }] },
  ]);
  assert.deepEqual(response.usage, {
    input_tokens: 4,
    output_tokens: 6,
    total_tokens: 10,
    output_tokens_details: { reasoning_tokens: 3 },
  });
});

test("Responses conversion accepts message and text items without type", () => {
  const body = responsesToChat({
    model: "m",
    input: [
      { role: "user", content: "hello" },
      { role: "assistant", content: [{ text: "hi" }] },
      { id: "call_1", output: "done" },
    ],
  });
  assert.deepEqual(body.messages, [
    { role: "user", content: "hello" },
    { role: "assistant", content: "hi" },
    { role: "tool", tool_call_id: "call_1", content: "done" },
  ]);
});

test("Responses conversion drops empty system messages", () => {
  const body = responsesToChat({
    model: "m",
    input: [
      { role: "system", content: [{ type: "input_text", text: "" }] },
      { role: "user", content: "hello" },
    ],
  });
  assert.deepEqual(body.messages, [{ role: "user", content: "hello" }]);
});

test("Responses namespace tools flatten for Chat Completions", () => {
  const body = responsesToChat({
    model: "m",
    input: "hello",
    tools: [{
      type: "namespace",
      name: "mcp__server",
      tools: [{ type: "function", name: "lookup", description: "Find data", parameters: { type: "object" } }],
    }],
  });
  assert.deepEqual(body.tools, [{ type: "function", function: { name: "mcp__server__lookup", description: "Find data", parameters: { type: "object" } } }]);
});

test("Responses completed omits incomplete Chat usage", () => {
  assert.equal("usage" in chatToResponse({ model: "m", choices: [{ message: { content: "ok" } }], usage: {} }), false);
  assert.deepEqual((chatToResponse({ model: "m", choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 4, completion_tokens: 2 } }).usage as Record<string, unknown>), {
    input_tokens: 4,
    output_tokens: 2,
    total_tokens: 6,
  });
});

test("upstream validation errors preserve the provider response message", async () => {
  const upstream = createServer((_req, res) => {
    res.statusCode = 422;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: { message: "unsupported parameter: reasoning_effort" } }));
  });
  const port = await listen(upstream);
  const settings = settingsSchema.parse({ providers: [{ id: "error", baseUrl: `http://127.0.0.1:${port}/v1`, api: "openai-completions", models: [{ id: "m" }] }] });
  const diagnostics: Record<string, unknown>[] = [];
  const proxy = new LlmProxy({ host: "127.0.0.1" }, () => settings, undefined, (diagnostic) => diagnostics.push(diagnostic as unknown as Record<string, unknown>));
  await proxy.start();
  try {
    const response = await fetch(`${proxy.providerBaseUrl("error")}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${proxy.runtimeToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "m", messages: [{ role: "user", content: "hello" }] }),
    });
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: { code: "UPSTREAM_ERROR", message: "Upstream returned HTTP 422: unsupported parameter: reasoning_effort", type: "proxy_error" } });
    assert.match(String(diagnostics[0]!.request), /"messages"/);
    assert.match(String(diagnostics[0]!.response), /unsupported parameter/);
    assert.equal(diagnostics[0]!.upstreamStatus, 422);
  } finally {
    await proxy.close();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
});
