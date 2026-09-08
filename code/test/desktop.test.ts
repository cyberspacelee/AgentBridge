import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fork } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { DatabaseSync } from "node:sqlite";
import { readConfig } from "../src/config.js";
import { OpenCodeAdapter } from "../src/engines/opencode/adapter.js";
import { SessionRuntime } from "../src/runtime/sessions.js";
import { Store } from "../src/storage/sqlite.js";
import { databaseSchema, databaseVersion } from "../src/storage/schema.js";
import { createServer } from "../src/gateway/server.js";
import { within } from "../src/async.js";
import { authorizedHeaders, externalUrl, isWorkspaceUrl } from "../desktop/security.mjs";

test("only the current database format opens; historical data is rejected without conversion", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bridge-database-format-"));
  const filename = path.join(directory, "state.sqlite");
  try {
    const old = new DatabaseSync(filename);
    old.exec(databaseSchema);
    old.exec("PRAGMA user_version=2; INSERT INTO meta VALUES ('keep','original');"); old.close();
    assert.throws(() => new Store(filename), /Unsupported legacy database/);
    const unchanged = new DatabaseSync(filename);
    assert.equal(unchanged.prepare("PRAGMA user_version").get()?.user_version, 2);
    assert.equal(unchanged.prepare("SELECT value FROM meta WHERE key='keep'").get()?.value, "original"); unchanged.close();
    const currentFile = path.join(directory, "current.sqlite");
    const current = new Store(currentFile);
    const id = current.storeId;
    assert.equal(current.db.prepare("PRAGMA user_version").get()?.user_version, databaseVersion); current.close();
    const reopened = new Store(currentFile); assert.equal(reopened.storeId, id); reopened.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("desktop privileges stay with the owned workspace and exact backend origin", () => {
  const origin = "http://127.0.0.1:43210";
  for (const route of ["/agents", "/agents/pi?tab=installation", "/tasks/task-id", "/settings", "/observability"]) {
    assert.equal(isWorkspaceUrl(`${origin}${route}`, origin), true);
  }
  for (const url of [`${origin}/api/artifacts/id/content`, `${origin}/agents/../api/settings`, `${origin}/agents-other`, "data:text/html,test", "file:///etc/passwd", "http://127.0.0.1:43211/agents", "http://user@127.0.0.1:43210/agents"]) {
    assert.equal(isWorkspaceUrl(url, origin), false, url);
  }
  const headers = { authorization: "old", AUTHORIZATION: "other", Accept: "application/json" };
  assert.deepEqual(authorizedHeaders(headers, `${origin}/api/settings`, origin, "secret", true), { Accept: "application/json", Authorization: "Bearer secret" });
  for (const [url, trusted] of [[`${origin}/api/settings`, false], ["https://external.invalid/", true], ["http://127.0.0.1:43211/", true], ["http://127.0.0.1.external.invalid:43210/", true], ["http://user:password@127.0.0.1:43210/api/settings", true], ["not a URL", true]]) {
    assert.deepEqual(authorizedHeaders(headers, url, origin, "secret", trusted), { Accept: "application/json" });
  }
  for (const url of ["javascript:alert(1)", "file:///tmp/report", "data:text/html,test", "https://user:secret@example.com", "mailto:test@example.com"]) assert.equal(externalUrl(url), null);
  assert.equal(externalUrl("https://example.com/docs"), "https://example.com/docs");
});

test("managed process registration cleans up descendants after an Agent crashes", { skip: process.platform !== "linux" }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bridge-desktop-process-"));
  const helper = path.join(directory, "helper.mjs");
  await writeFile(helper, `import { startProcess } from ${JSON.stringify(new URL("../src/engines/process.ts", import.meta.url).href)};
const agent = startProcess(process.execPath, ['-e', "const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); console.log(child.pid); setInterval(()=>{},1000);"], process.cwd());
agent.stdout.once('data', chunk => process.send({type:'descendant',pid:Number(String(chunk).trim())}));
process.on('message', () => agent.kill('SIGKILL'));
`);
  const child = fork(helper, [], {
    execArgv: ["--import", import.meta.resolve("tsx")],
    env: { ...process.env, AGENT_MANAGED_RUNTIMES: "true" },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  let group = 0;
  let descendant = 0;
  const messages: string[] = [];
  child.on("message", (message: { type: string; pid: number }) => {
    messages.push(message.type);
    if (message.type === "engine-started") group = message.pid;
    if (message.type === "descendant") descendant = message.pid;
  });
  try {
    await within((async () => { while (!group || !descendant) await delay(20); })(), 5000);
    child.send({ type: "crash" });
    await within((async () => {
      for (;;) {
        const state = await readFile(`/proc/${descendant}/stat`, "utf8").catch(() => null);
        if (!state || state.includes(") Z ")) break;
        await delay(20);
      }
    })(), 5000);
    await within((async () => { while (!messages.includes("engine-exited")) await delay(20); })(), 5000);
  } finally {
    if (group) { try { process.kill(-group, "SIGKILL"); } catch {} }
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    await within(exited, 5000);
    await rm(directory, { recursive: true, force: true });
  }
});

test("desktop credentials protect every route while ordinary web access remains available", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bridge-desktop-"));
  const token = randomBytes(32).toString("hex");
  const headers = { host: "127.0.0.1", authorization: `Bearer ${token}` };
  try {
    assert.throws(() => readConfig([], { AGENT_DESKTOP_TOKEN: "short" }));
    assert.throws(() =>
      readConfig([], { AGENT_DESKTOP_TOKEN: token, AGENT_HOST: "0.0.0.0" }),
    );
    for (const desktop of [true, false]) {
      const config = readConfig([], {
        AGENT_DATA_DIR: directory,
        AGENT_PORT: "0",
        ...(desktop ? { AGENT_DESKTOP_TOKEN: token } : {}),
      });
      const runtime = new SessionRuntime(
        new Store(":memory:"),
        new OpenCodeAdapter(config),
        config,
      );
      const server = createServer(runtime);
      try {
        const url = await server.listen({ host: config.host, port: config.port });
        assert.notEqual(new URL(url).port, "0");
        assert.equal(
          (await server.inject({ url: "/health/live", headers })).statusCode,
          200,
        );
        assert.equal(
          (await server.inject({ url: "/api/settings", headers: { host: headers.host } })).statusCode,
          desktop ? 403 : 200,
        );
        if (!desktop) {
          assert.equal(
            (await server.inject({ method: "POST", url: "/session/missing/abort", headers: { host: headers.host, origin: config.webOrigin } })).statusCode,
            404,
          );
          continue;
        }
        for (const route of [
          "/", "/agents", "/health/live", "/health/ready", "/metrics",
          "/api/settings", "/api/runtime", "/api/runtimes", "/session",
          "/api/events", "/event", "/api/artifacts/missing/content", "/not-found",
        ]) {
          for (const authorization of [undefined, "Bearer wrong", `Basic ${token}`]) {
            const response = await server.inject({
              url: route,
              headers: { host: headers.host, ...(authorization ? { authorization } : {}) },
            });
            assert.equal(response.statusCode, 403, route);
            assert.ok(!response.body.includes(token));
          }
        }
        assert.equal(
          (await server.inject({ url: `/api/settings?token=${token}`, headers: { host: headers.host } })).statusCode,
          403,
        );
        for (const origin of ["https://untrusted.invalid", "null", config.webOrigin]) {
          for (const method of ["GET", "POST"] as const) {
            const response = await server.inject({ method, url: "/health/live", headers: { ...headers, origin } });
            assert.equal(response.statusCode, 403, `${method} ${origin}`);
          }
        }
        assert.equal(
          (await server.inject({ url: "/health/live", headers: { ...headers, host: "untrusted.invalid" } })).statusCode,
          403,
        );
        assert.equal(
          (await server.inject({ url: "/api/settings", headers: { ...headers, origin: "http://127.0.0.1" } })).statusCode,
          200,
        );
        assert.equal(
          (await server.inject({ url: "/api/artifacts/missing/content", headers })).statusCode,
          404,
        );
        for (const route of ["/api/events", "/event"]) {
          const controller = new AbortController();
          try {
            const response = await fetch(`${url}${route}`, {
              headers: { authorization: headers.authorization, origin: url },
              signal: controller.signal,
            });
            assert.equal(response.status, 200);
            assert.match(response.headers.get("content-type") ?? "", /text\/event-stream/);
            const first = await response.body!.getReader().read();
            assert.match(new TextDecoder().decode(first.value), /server.connected/);
          } finally {
            controller.abort();
          }
        }
      } finally {
        await within(server.close(), 5000);
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("managed gateway starts without Agent CLIs and releases its database after shutdown, drain and parent disconnect", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bridge-desktop-ipc-"));
  const token = randomBytes(32).toString("hex");
  try {
    for (const action of ["shutdown", "drain", "disconnect"]) {
      const child = fork(fileURLToPath(new URL("../src/main.ts", import.meta.url)), [], {
        execArgv: ["--import", import.meta.resolve("tsx")],
        env: {
          ...process.env,
          AGENT_DATA_DIR: directory,
          AGENT_HOST: "127.0.0.1",
          AGENT_PORT: "0",
          AGENT_DESKTOP_TOKEN: token,
          AGENT_ACCESS_TOKEN: token,
          AGENT_SUPERVISED: "true",
          AGENT_MANAGED_RUNTIMES: "true",
        },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
      });
      let diagnostics = "";
      child.stdout!.on("data", (chunk) => { diagnostics = (diagnostics + chunk).slice(-8192); });
      child.stderr!.on("data", (chunk) => { diagnostics = (diagnostics + chunk).slice(-8192); });
      const exited = once(child, "exit");
      try {
        const [ready] = await within(once(child, "message"), 10000);
        assert.equal(ready.type, "ready", diagnostics);
        assert.match(ready.url, /^http:\/\/127\.0\.0\.1:\d+$/);
        const headers = { authorization: `Bearer ${token}` };
        assert.equal((await fetch(`${ready.url}/health/live`, { headers })).status, 200);
        assert.equal((await fetch(`${ready.url}/api/settings`)).status, 403);
        const response = await fetch(`${ready.url}/api/runtimes`, { headers });
        assert.equal(response.status, 200);
        const { runtimes } = await response.json() as { runtimes: { installedVersion: string | null; managed: boolean }[] };
        assert.equal(runtimes.length, 4);
        assert.ok(runtimes.every((runtime) => runtime.managed && runtime.installedVersion === null));
        if (action === "disconnect") child.disconnect();
        else child.send({ type: action });
        const [code, signal] = await within(exited, 10000);
        assert.equal(code, 0, diagnostics);
        assert.equal(signal, null);
        assert.ok(!diagnostics.includes(token));
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
          await exited;
        }
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
