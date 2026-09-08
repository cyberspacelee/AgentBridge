import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
import { externalUrl, isWorkspaceUrl } from "../desktop/security.mjs";

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
  for (const url of ["javascript:alert(1)", "file:///tmp/report", "data:text/html,test", "https://user:secret@example.com", "mailto:test@example.com"]) assert.equal(externalUrl(url), null);
  assert.equal(externalUrl("https://example.com/docs"), "https://example.com/docs");
});

for (const supervised of [true, false])
test(`${supervised ? "managed" : "unmanaged"} process cleanup terminates descendants after an Agent crashes`, { skip: process.platform !== "linux" }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bridge-desktop-process-"));
  const helper = path.join(directory, "helper.mjs");
  await writeFile(helper, `import { startProcess } from ${JSON.stringify(new URL("../src/engines/process.ts", import.meta.url).href)};
const send=process.send.bind(process);
if (!${supervised}) process.send=undefined;
const agent = startProcess(process.execPath, ['-e', "const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); console.log(child.pid); setInterval(()=>{},1000);"], process.cwd());
if (!${supervised}) send({type:'engine-started',pid:agent.pid});
agent.stdout.once('data', chunk => send({type:'descendant',pid:Number(String(chunk).trim())}));
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
    if (supervised) await within((async () => { while (!messages.includes("engine-exited")) await delay(20); })(), 5000);
  } finally {
    if (group) { try { process.kill(-group, "SIGKILL"); } catch {} }
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    await within(exited, 5000);
    await rm(directory, { recursive: true, force: true });
  }
});

test("local and LAN gateways expose HTTP and SSE without credentials", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bridge-gateway-access-"));
  try {
    for (const host of ["127.0.0.1", "0.0.0.0"]) {
      const config = readConfig([], { AGENT_DATA_DIR: directory, AGENT_HOST: host, AGENT_PORT: "0" });
      const runtime = new SessionRuntime(new Store(":memory:"), new OpenCodeAdapter(config), config);
      const server = createServer(runtime);
      try {
        await server.listen({ host, port: 0 });
        const url = `http://127.0.0.1:${(server.server.address() as { port: number }).port}`;
        for (const route of ["/health/live", "/metrics", "/api/settings", "/api/runtime", "/api/runtimes", "/api/docs", "/api/examples/evaluate.mjs"]) {
          assert.equal((await fetch(url + route)).status, 200, route);
        }
        assert.equal((await server.inject({ method: "POST", url: "/session/missing/abort" })).statusCode, 404);
        assert.equal((await server.inject({ method: "POST", url: "/session/missing/abort", headers: { origin: config.webOrigin } })).statusCode, 404);
        assert.equal((await server.inject({ method: "POST", url: "/session/missing/abort", headers: { origin: "https://untrusted.invalid" } })).statusCode, 403);
        for (const route of ["/event"]) {
          const controller = new AbortController();
          try {
            const response = await fetch(url + route, { signal: controller.signal });
            assert.equal(response.status, 200);
            assert.match(response.headers.get("content-type")!, /text\/event-stream/);
            assert.match(new TextDecoder().decode((await response.body!.getReader().read()).value), /server.connected/);
          } finally { controller.abort(); }
        }
      } finally { await within(server.close(), 5000); }
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("managed gateway starts without Agent CLIs and releases its database after shutdown, drain and parent disconnect", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bridge-desktop-ipc-"));
  try {
    for (const action of ["shutdown", "drain", "disconnect"]) {
      const child = fork(fileURLToPath(new URL("../src/main.ts", import.meta.url)), [], {
        execArgv: ["--import", import.meta.resolve("tsx")],
        env: {
          ...process.env,
          AGENT_DATA_DIR: directory,
          AGENT_HOST: "127.0.0.1",
          AGENT_PORT: "0",
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
        assert.equal((await fetch(`${ready.url}/health/live`)).status, 200);
        assert.equal((await fetch(`${ready.url}/api/settings`)).status, 200);
        const response = await fetch(`${ready.url}/api/runtimes`);
        assert.equal(response.status, 200);
        const { runtimes } = await response.json() as { runtimes: { installedVersion: string | null; managed: boolean }[] };
        assert.equal(runtimes.length, 4);
        assert.ok(runtimes.every((runtime) => runtime.managed && runtime.installedVersion === null));
        if (action === "disconnect") child.disconnect();
        else child.send({ type: action });
        const [code, signal] = await within(exited, 10000);
        assert.equal(code, 0, diagnostics);
        assert.equal(signal, null);
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
