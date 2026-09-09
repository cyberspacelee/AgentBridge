import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { openapi } from "../src/gateway/openapi.js";
import { apiMarkdown } from "../src/gateway/api-markdown.js";
import { createServer } from "../src/gateway/server.js";
import { readConfig } from "../src/config.js";
import { OpenCodeAdapter } from "../src/engines/opencode/adapter.js";
import { SessionRuntime } from "../src/runtime/sessions.js";
import { Store } from "../src/storage/sqlite.js";
import { createSessionSchema, createTaskSchema, promptSchema, submitRunSchema, interactionReplySchema } from "../shared/contracts.js";

test("OpenAPI and Markdown cover gateway routes, real responses, required inputs and offline assets", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bridge-api-docs-"));
  const config = readConfig([], { AGENT_DATA_DIR: directory });
  const runtime = new SessionRuntime(new Store(":memory:"), new OpenCodeAdapter(config), config);
  const server = createServer(runtime);
  // Zod's JSON Schema reader resolves $defs; OpenAPI uses components/schemas.
  const validator = (schema: unknown) => z.fromJSONSchema(JSON.parse(JSON.stringify({ ...(schema as object), $defs: openapi.components.schemas }).replaceAll("#/components/schemas/", "#/$defs/")));
  try {
    const response = await server.inject("/api/openapi.json");
    assert.equal(response.statusCode, 200);
    const spec = response.json();
    assert.equal(spec.openapi, "3.1.0");
    assert.deepEqual(spec.security, []);
    const ids = new Set();
    for (const [url, methods] of Object.entries(spec.paths)) for (const [method, operation] of Object.entries(methods as Record<string, any>)) {
      assert.ok(server.hasRoute({ method: method.toUpperCase() as "GET", url: url.replace(/\{(.*?)\}/g, ":$1") }), `${method} ${url}`);
      assert.ok(!ids.has(operation.operationId), `duplicate operationId ${operation.operationId}`);
      ids.add(operation.operationId);
      for (const param of operation.parameters) if (param.in === "path") assert.equal(param.required, true);
      for (const body of Object.values(operation.requestBody?.content ?? {}) as any[]) if (body.example !== undefined) validator(body.schema).parse(body.example);
      for (const response of Object.values(operation.responses) as any[]) for (const body of Object.values(response.content ?? {}) as any[]) {
        const validate = validator(body.schema);
        if (body.example !== undefined) validate.parse(body.example);
      }
    }
    // Every HTTP route except static UI assets and automatic HEAD must be documented.
    const documented = new Set(Object.entries(spec.paths).flatMap(([url, methods]) => Object.keys(methods as object).map((method) => `${method.toUpperCase()} ${url.replace(/\{(.*?)\}/g, ":$1")}`)));
    const segments: string[] = [];
    let checkedRoutes = 0;
    for (const match of server.printRoutes({ commonPrefix: false }).matchAll(/^([│ ]*)[├└]── (\S+) \(([^)]+)\)/gm)) {
      const [, indent, segment, methods] = match;
      segments.length = indent!.length / 4;
      segments.push(segment!);
      const url = segments.join("");
      if (url.startsWith("/api/docs/") || !/^\/(api|session|permission|question|event|health|metrics)(\/|$)/.test(url)) continue;
      for (const method of methods!.split(", ")) if (method !== "HEAD") {
        checkedRoutes++;
        assert.ok(documented.has(`${method} ${url}`), `undocumented ${method} ${url}`);
      }
    }
    assert.equal(checkedRoutes, documented.size);
    for (const schema of Object.values(spec.components.schemas)) validator(schema);
    for (const [name, schema] of Object.entries({ CreateSession: createSessionSchema, CreateTask: createTaskSchema, Prompt: promptSchema, SubmitRun: submitRunSchema, PermissionReply: interactionReplySchema.options[0], QuestionReply: interactionReplySchema.options[1] })) {
      const original = z.toJSONSchema(schema, { io: "input" });
      assert.deepEqual(spec.components.schemas[name].required, original.required, name);
      const minimal = name === "CreateSession" ? { directory } : name === "CreateTask" ? { directory, submissionId: "turn-001", parts: [{ type: "text", text: "hello" }] } : name === "SubmitRun" ? { submissionId: "turn-001", parts: [{ type: "text", text: "hello" }] } : name === "Prompt" ? { parts: [{ type: "text", text: "hello" }] } : name === "PermissionReply" ? { reply: "once" } : { answers: [["A"]] };
      validator(spec.components.schemas[name]).parse(minimal);
      for (const field of original.required ?? []) {
        const missing = { ...minimal } as Record<string, unknown>;
        delete missing[field];
        assert.equal(validator(spec.components.schemas[name]).safeParse(missing).success, false, `${name}.${field}`);
      }
    }
    for (const url of ["/health/live", "/health/ready", "/api/runtime", "/api/system", "/api/settings", "/api/agents", "/api/runtimes", "/api/tasks", "/session/status", "/permission", "/question", "/api/system/directories", "/api/observability/overview", "/api/observability/series?metric=rssBytes", "/api/observability/errors"]) {
      const actual = await server.inject(url);
      const schema = spec.paths[url.split("?")[0]!].get.responses[actual.statusCode].content["application/json"].schema;
      const result = validator(schema).safeParse(actual.json());
      assert.ok(result.success, `${url}: ${JSON.stringify(result.error)}`);
    }
    const docs = await server.inject("/api/docs");
    assert.match(String(docs.headers["content-type"]), /text\/html/);
    assert.match(String(docs.headers["content-security-policy"]), /script-src 'self'/);
    for (const asset of ["swagger-ui.css", "swagger-ui-bundle.js", "init.js"]) assert.equal((await server.inject(`/api/docs/${asset}`)).statusCode, 200);
    const markdown = await server.inject("/api/docs.md");
    assert.match(String(markdown.headers["content-type"]), /text\/markdown/);
    assert.equal(markdown.body, apiMarkdown());
    assert.equal(markdown.body, (await readFile(new URL("../docs/API_REFERENCE.md", import.meta.url), "utf8")).replace(/\r\n/g, "\n"), "run pnpm docs:generate after changing the contract");
    for (const term of ["providerID", "modelID", "必填", "PermissionReply", "QuestionReply", "prompt_async", "Last-Event-ID", "DELETE /session/{id}"]) assert.ok(markdown.body.includes(term), term);
    assert.equal(spec.paths["/session/{id}/prompt_async"].post.responses[204].content, undefined);
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
