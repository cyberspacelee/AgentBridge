import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { rootCertificates } from "node:tls";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Supervisor } from "../host/supervisor.mjs";
import type { NetworkView } from "../shared/system.js";
import { RuntimeManager } from "../src/runtime/runtimes.js";
import { readSettings, SettingsManager } from "../src/settings.js";
import { readConfig } from "../src/config.js";
import { createServer } from "node:net";
import { gatewaySchema, gatewayUrl, defaultGateway } from "../host/gateway.mjs";
import type { GatewayView } from "../shared/system.js";

async function eventually(check: () => Promise<boolean>) {
  for (let i = 0; i < 100; i++) { if (await check().catch(() => false)) return; await delay(100); }
  assert.fail("Condition did not become true within 10 seconds");
}

test("gateway settings persist, change listener and roll back an occupied port", async () => {
  assert.equal(gatewayUrl("::", 3000), "http://[::1]:3000");
  assert.deepEqual(defaultGateway, { host: "127.0.0.1", port: 6217 });
  assert.equal(readSettings(readConfig([], {})).schemaVersion, 1);
  assert.equal(gatewayUrl("0.0.0.0", 80), "http://127.0.0.1");
  for (const settings of [{ host: "https://example.com", port: 3000 }, { host: "127.0.0.1", port: 65536 }, { host: "0.0.0.0", port: -1 }, { host: "localhost", port: 1.5 }]) assert.equal(gatewaySchema.safeParse(settings).success, false);
  const directory = await mkdtemp(path.join(os.tmpdir(), "bridge-gateway-settings-"));
  const options = { directory, args: ["--import", import.meta.resolve("tsx"), path.resolve("src/main.ts")], cwd: process.cwd() };
  const host = new Supervisor({ ...options, args: [...options.args, "--host=127.0.0.1", "--port", "0"], env: { AGENT_PORT: "1" } });
  const occupied = createServer();
  const available = createServer();
  let restored: Supervisor | undefined;
  try {
    await host.initialize();
    const oldUrl = await host.start();
    const first = await (await fetch(oldUrl + "/api/runtime")).json();
    const headers = { "content-type": "application/json" };
    const view = await (await fetch(oldUrl + "/api/system/gateway")).json() as GatewayView;
    assert.equal(view.settings.port, 0);
    assert.equal(view.url, oldUrl);
    const save = (settings: unknown, revision = host.gatewayView().revision) => fetch(host.url + "/api/system/gateway", { method: "PUT", headers, body: JSON.stringify({ settings, revision }) });
    assert.equal((await save({ host: "0.0.0.0", port: 99999 })).status, 400);
    await new Promise<void>((resolve) => available.listen(0, "0.0.0.0", resolve));
    const port = (available.address() as { port: number }).port;
    await new Promise<void>((resolve) => available.close(() => resolve()));
    const saved = await (await save({ host: "0.0.0.0", port })).json() as GatewayView;
    assert.equal(saved.restartRequired, true);
    assert.equal((await save(view.settings, view.revision)).status, 409);
    await host.stop("wait", true);
    const url = host.url!;
    assert.equal(url, `http://127.0.0.1:${port}`);
    assert.equal(host.gatewayView().restartRequired, false);
    assert.equal((await (await fetch(url + "/api/runtime")).json()).storeId, first.storeId);
    for (const address of Object.values(os.networkInterfaces()).flat()) {
      if (address?.family === "IPv4" && !address.internal) assert.equal((await fetch(`http://${address.address}:${port}/api/settings`)).status, 200);
    }
    await new Promise<void>((resolve) => occupied.listen(0, "0.0.0.0", resolve));
    const busyPort = (occupied.address() as { port: number }).port;
    assert.equal((await save({ host: "0.0.0.0", port: busyPort })).status, 200);
    await host.stop("stop", true);
    assert.equal(host.url, url);
    assert.equal((await fetch(url + "/health/live")).status, 200);
    assert.equal(host.gatewayView().restartRequired, true);
    assert.match(host.gatewayView().error!, /已恢复/);
    // A successful retry clears the failure and survives a full launcher restart.
    assert.equal((await save({ host: "0.0.0.0", port })).status, 200);
    await host.stop("stop", true);
    assert.equal(host.gatewayView().error, null);
    await host.stop();
    restored = new Supervisor(options);
    await restored.initialize();
    assert.deepEqual(restored.gatewayView().settings, { host: "0.0.0.0", port });
    assert.equal(await restored.start(), url);
  } finally {
    await host.stop(); await restored?.stop();
    occupied.close(); available.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("shared host serves Web without credentials, confines paths, imports CA, preserves drafts and restarts with the same store", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bridge-system-"));
  const allowed = path.join(directory, "workspace"); await mkdir(allowed);
  const outside = path.join(directory, "outside"); await mkdir(outside);
  await symlink(outside, path.join(allowed, "escape"), process.platform === "win32" ? "junction" : "dir");
  const host = new Supervisor({ directory, args: ["--import", import.meta.resolve("tsx"), path.resolve("src/main.ts")], cwd: process.cwd(), env: { AGENT_PORT: "0", AGENT_ALLOWED_DIRECTORIES: JSON.stringify([allowed]), AGENT_MANAGED_RUNTIMES: "true" } });
  try {
    await host.initialize(); const origin = await host.start();
    const headers = { "content-type": "application/json" };
    for (const url of ["/api/system", "/api/settings", "/api/system/directories", "/metrics"]) assert.equal((await fetch(origin + url)).status, 200);
    const first = await (await fetch(origin + "/api/runtime", { headers })).json();
    const listing = await (await fetch(origin + `/api/system/directories?directory=${encodeURIComponent(allowed)}`, { headers })).json();
    assert.deepEqual(listing.entries, []);
    assert.equal((await fetch(origin + `/api/system/directories?directory=${encodeURIComponent(outside)}`, { headers })).status, 400);
    const cert = await (await fetch(origin + "/api/system/certificates", { method: "POST", headers, body: JSON.stringify({ pem: rootCertificates[0] }) })).json();
    assert.equal(await readFile(cert.path, "utf8"), rootCertificates[0]);
    assert.equal((await fetch(origin + "/api/system/certificates", { method: "POST", headers, body: JSON.stringify({ pem: "secret private key" }) })).status, 400);
    const network = await (await fetch(origin + "/api/system/network", { headers })).json() as NetworkView;
    const saved = await (await fetch(origin + "/api/system/network", { method: "PUT", headers, body: JSON.stringify({ revision: network.revision, settings: { ...network.settings, mode: "direct", npmRegistry: "https://registry.npmmirror.com", proxyPassword: "private-password" } }) })).json() as NetworkView;
    assert.equal(saved.hasPassword, true); assert.equal(saved.restartRequired, true); assert.ok(!JSON.stringify(saved).includes("private-password"));
    assert.equal(saved.settings.npmRegistry, "https://registry.npmmirror.com/");
    assert.equal((await fetch(origin + "/api/system/network", { method: "PUT", headers, body: JSON.stringify({ revision: network.revision, settings: network.settings }) })).status, 409);
    const pid = host.child!.pid;
    assert.equal((await fetch(origin + "/api/system/lifecycle", { method: "POST", headers, body: JSON.stringify({ action: "restart", mode: "wait" }) })).status, 202);
    await eventually(async () => host.child?.pid !== pid && (await fetch(origin + "/api/system")).ok);
    const second = await (await fetch(origin + "/api/runtime", { headers })).json();
    assert.equal(second.storeId, first.storeId); assert.notEqual(second.instanceId, first.instanceId);
    await eventually(async () => !(await (await fetch(origin + "/api/system/network", { headers })).json()).restartRequired);
    assert.equal((await (await fetch(origin + "/api/system/network", { headers })).json()).settings.npmRegistry, "https://registry.npmmirror.com/");
  } finally { await host.stop(); await rm(directory, { recursive: true, force: true }); }
});

test("external CLI detection never guesses installed state and source switching preserves the original on failure", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bridge-external-"));
  const config = readConfig([], { AGENT_DATA_DIR: directory, CODEX_COMMAND: path.join(directory, "missing") });
  let failed = false;
  const manager = new RuntimeManager(config, { runningVersion: () => null, switch: async (_id, activate, rollback) => { try { await activate(); if (failed) throw new Error("restore failed"); } catch (error) { await rollback(); throw error; } } }, { probe: async () => {} });
  try {
    assert.equal(manager.view("codex").usable, false);
    assert.equal(manager.installed("codex"), false);
    await manager.detect("codex"); assert.equal(manager.view("codex").detection, "missing"); assert.equal(manager.installed("codex"), false);
    await manager.bind("codex", { mode: "external", command: process.execPath }); await manager.idle();
    assert.equal(manager.view("codex").installedVersion, process.versions.node);
    assert.equal(manager.view("codex").usable, true);
    assert.throws(() => manager.action("codex", "uninstall"), /外部 CLI/);
    const native = path.join(directory, "agents/codex"); await mkdir(native, { recursive: true }); await writeFile(path.join(native, "history"), "preserved");
    failed = true;
    await manager.bind("codex", { mode: "external", command: process.execPath }); await manager.idle();
    assert.equal(config.codex.command, process.execPath);
    assert.equal(await readFile(path.join(native, "history"), "utf8"), "preserved");
    assert.match(manager.view("codex").error!, /restore failed/);
  } finally { await manager.close(); await rm(directory, { recursive: true, force: true }); }
});

test("a failed network application restores the previous process and interrupted applications remain retryable", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bridge-host-recovery-"));
  const program = path.join(directory, "backend.mjs");
  await writeFile(program, `import {createServer} from 'node:http';
if(process.env.NO_PROXY==='*') process.exit(9);
const server=createServer((_,r)=>r.end('ready'));
server.listen(Number(process.env.AGENT_PORT), '127.0.0.1',()=>process.send({type:'ready',url:'http://127.0.0.1:'+server.address().port}));
process.on('message',m=>{if(m.type==='shutdown'||m.type==='drain')server.close(()=>process.disconnect());});`);
  const options = { directory, args: [program], env: { AGENT_PORT: "0", NO_PROXY: "", no_proxy: "" } };
  const host = new Supervisor(options);
  try {
    await host.initialize(); const url = await host.start();
    const duplicate = new Supervisor(options);
    await assert.rejects(duplicate.initialize(), /运行中的实例/);
    const before = host.view();
    await host.request("network.save", { revision: before.revision, settings: { ...before.settings, mode: "direct" } });
    await host.stop("stop", true);
    assert.equal(host.url, url); assert.equal((await fetch(url)).status, 200);
    assert.equal(host.view().restartRequired, true); assert.match(host.view().error!, /已恢复/);
    await host.stop();
    const filename = path.join(directory, "system.json");
    const saved = JSON.parse(await readFile(filename, "utf8")); saved.applying = true;
    await writeFile(filename, JSON.stringify(saved));
    const restored = new Supervisor(options);
    try {
      await restored.initialize();
      assert.equal(restored.view().restartRequired, true); assert.match(restored.view().error!, /被中断/);
      assert.equal((await fetch(await restored.start())).status, 200);
    } finally { await restored.stop(); }
  } finally { await host.stop(); await rm(directory, { recursive: true, force: true }); }
});

test("current source-switch journals recover native state, while historical settings are rejected without migration", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bridge-source-journal-"));
  const config = readConfig([], { AGENT_DATA_DIR: directory, CODEX_COMMAND: "missing" });
  const settings = new SettingsManager(config);
  const rollbackId = randomUUID();
  const native = path.join(directory, "agents/codex");
  const backup = path.join(directory, "backups/codex", rollbackId);
  const runtime = path.join(directory, "runtimes/codex");
  try {
    for (const target of [native, backup, runtime]) await mkdir(target, { recursive: true });
    await writeFile(path.join(native, "history"), "partial-new-state");
    await writeFile(path.join(backup, "history"), "original-state");
    await writeFile(path.join(runtime, "manifest.json"), JSON.stringify({ schemaVersion: 1, sourceRollback: { previous: { mode: "external", command: process.execPath }, directory: rollbackId, snapshot: true, bindings: [] } }));
    const manager = new RuntimeManager(config, {
      runningVersion: () => null, switch: async () => {},
      saveSource: (id, source) => { const view = settings.view(); view.settings.agents.find((agent) => agent.id === id)!.runtime = source; settings.save({ settings: view.settings, revision: view.revision }); },
    });
    try {
      assert.equal(config.codex.command, process.execPath);
      assert.equal(readSettings(config).agents.find((agent) => agent.id === "codex")!.runtime.command, process.execPath);
      assert.equal(await readFile(path.join(native, "history"), "utf8"), "original-state");
      assert.match(manager.view("codex").error!, /已恢复/);
    } finally { await manager.close(); }
    const filename = path.join(directory, "settings.json");
    const historical = { ...readSettings(config), schemaVersion: 2 };
    const original = JSON.stringify(historical); await writeFile(filename, original);
    assert.throws(() => readSettings(config), /不支持历史配置/);
    assert.equal(await readFile(filename, "utf8"), original);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("supervisor redacts secrets split across output chunks and persists lifecycle diagnostics", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bridge-host-diagnostics-"));
  let output = "", reported = "";
  const secret = "fixture.a+b-key";
  const program = `const {createServer}=require('node:http');
    process.stdout.write('fixture.a+');
    setTimeout(()=>process.stdout.write('b-key\\n'),20);
    const server=createServer((_,r)=>r.end('ready'));
    server.listen(0,'127.0.0.1',()=>process.send({type:'ready',url:'http://127.0.0.1:'+server.address().port}));
    process.on('message',()=>server.close(()=>process.disconnect()));`;
  const host = new Supervisor({ directory, args: ["-e", program], env: { AGENT_PORT: "0", OPENAI_API_KEY: secret }, onOutput: (value: string) => output += value, onError: (error: Error) => reported = error.message });
  try {
    await host.initialize();
    await host.start();
    await eventually(async () => output.includes("[REDACTED]"));
    assert.ok(!output.includes(secret));
    await host.reportError(new Error("lifecycle failed " + secret));
    const logs = await readFile(path.join(directory, "host.log"), "utf8");
    assert.match(logs, /lifecycle failed/);
    assert.ok(!logs.includes(secret));
    assert.ok(!reported.includes(secret));
  } finally { await host.stop(); await rm(directory, { recursive: true, force: true }); }
});

test("unsafe storage failure restarts the supervised gateway and reopens the same store", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bridge-storage-recovery-"));
  const program = path.join(directory, "gateway.mjs");
  await writeFile(program, `import {startGateway} from ${JSON.stringify(new URL('../src/main.ts', import.meta.url).href)};
    const {server,runtime}=await startGateway();
    const address=server.server.address();
    process.send({type:'ready',url:'http://127.0.0.1:'+address.port});
    process.on('message', message=>{
      if(message.type==='fault') runtime.storageFailure(new Error('uncertain storage operation'));
      if(message.type==='shutdown') void server.close().finally(()=>process.disconnect());
    });`);
  const host = new Supervisor({ directory, args: ["--import", import.meta.resolve("tsx"), program], env: { AGENT_PORT: "0", AGENT_MANAGED_RUNTIMES: "true" } });
  try {
    await host.initialize();
    const origin = await host.start();
    const first = await (await fetch(origin + "/api/runtime")).json();
    const pid = host.child!.pid;
    host.child!.send({ type: "fault" });
    await eventually(async () => host.child?.pid !== pid && (await (await fetch(origin + "/api/system")).json()).maintenance === "ready");
    const next = await (await fetch(origin + "/api/runtime")).json();
    assert.equal(next.storeId, first.storeId);
    assert.notEqual(next.instanceId, first.instanceId);
  } finally { await host.stop(); await rm(directory, { recursive: true, force: true }); }
});
