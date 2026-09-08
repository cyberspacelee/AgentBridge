import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readConfig } from "../src/config.js";
import { RuntimeManager, type RuntimeDependencies } from "../src/runtime/runtimes.js";

test("managed runtimes resolve each requested latest, isolate failed updates, cancel and preserve native state on uninstall", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentbridge-runtimes-"));
  const config = readConfig([], { AGENT_DATA_DIR: directory, AGENT_MANAGED_RUNTIMES: "true" });
  let latest = "1.2.3", failCheck = false, failProbe = false, waitInstall = false, failSwitch = false;
  const installed: string[] = [];
  const fetcher: RuntimeDependencies["fetch"] = async () => {
    if (failCheck) throw new Error("offline");
    return Response.json({ version: latest, dist: { tarball: `https://registry.npmjs.org/opencode-ai/-/opencode-ai-${latest}.tgz`, integrity: `sha512-${Buffer.from("fixture").toString("base64")}` } });
  };
  const manager = new RuntimeManager(config, {
    runningVersion: () => null,
    switch: async (_id, activate, rollback) => {
      try { await activate(); if (failSwitch) throw new Error("native recovery failed"); }
      catch (error) { await rollback(); throw error; }
    },
  }, {
    fetch: fetcher,
    freeBytes: async () => 4 * 1024 ** 3,
    install: async (_id, release, destination, signal) => {
      installed.push(release.version);
      if (waitInstall) await new Promise<void>((_resolve, reject) => { if (signal.aborted) reject(signal.reason); else signal.addEventListener("abort", () => reject(signal.reason), { once: true }); });
      await writeFile(path.join(destination, "cli"), release.version); return "cli";
    },
    probe: async () => { if (failProbe) throw new Error("incompatible protocol"); },
  });
  try {
    assert.equal(manager.installed("opencode"), false);
    manager.action("opencode", "install"); await manager.idle();
    assert.equal(manager.view("opencode").installedVersion, "1.2.3");
    assert.equal(manager.view("opencode").runningVersion, null);
    const installedCommand = config.opencode.command;
    const successfulCheck = manager.view("opencode").checkedAt;
    failCheck = true; manager.action("opencode", "check"); await manager.idle();
    assert.equal(manager.view("opencode").checkedAt, successfulCheck);
    assert.match(manager.view("opencode").checkError!, /offline/);
    assert.equal(manager.view("opencode").installedVersion, "1.2.3");
    failCheck = false; latest = "2.0.0"; failProbe = true;
    manager.action("opencode", "update"); await manager.idle();
    assert.equal(config.opencode.command, installedCommand);
    assert.match(manager.view("opencode").error!, /incompatible/);
    failProbe = false; waitInstall = true;
    manager.action("opencode", "update");
    assert.throws(() => manager.action("opencode", "uninstall"), /already in progress/);
    manager.action("opencode", "cancel"); await manager.idle();
    assert.equal(config.opencode.command, installedCommand);
    waitInstall = false; failSwitch = true;
    const native = path.join(directory, "agents", "opencode"); await mkdir(native, { recursive: true }); await writeFile(path.join(native, "history"), "keep");
    manager.action("opencode", "update"); await manager.idle();
    assert.equal(manager.view("opencode").installedVersion, "1.2.3");
    assert.equal(await readFile(path.join(native, "history"), "utf8"), "keep");
    assert.equal((await readdir(path.join(directory, "runtimes", "opencode", "versions"))).length, 1);
    failSwitch = false; manager.action("opencode", "update"); await manager.idle();
    assert.equal(manager.view("opencode").installedVersion, "2.0.0");
    manager.action("opencode", "uninstall"); await manager.idle();
    assert.equal(manager.view("opencode").installedVersion, null);
    assert.equal(await readFile(path.join(native, "history"), "utf8"), "keep");
    latest = "3.0.0"; manager.action("opencode", "install"); await manager.idle();
    assert.equal(manager.view("opencode").installedVersion, "3.0.0");
    assert.equal(manager.view("opencode").runningVersion, null);
    assert.ok(installed.includes("1.2.3") && installed.includes("3.0.0"));
    const restarted = new RuntimeManager(config, { runningVersion: () => null, switch: async () => {} });
    assert.equal(restarted.view("opencode").installedVersion, "3.0.0");
    await restarted.close();
  } finally { await manager.close(); await rm(directory, { recursive: true, force: true }); }
});

test("Grok pins object generation and rejects a corrupted artifact before executing it", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentbridge-grok-"));
  const config = readConfig([], { AGENT_DATA_DIR: directory, AGENT_MANAGED_RUNTIMES: "true" });
  const payload = Buffer.from("downloaded binary"); let checked = false;
  const requested: string[] = [];
  const manager = new RuntimeManager(config, { runningVersion: () => null, switch: async () => { throw new Error("must not activate corrupt artifact"); } }, {
    freeBytes: async () => 4 * 1024 ** 3,
    fetch: async (input, options) => {
      const url = String(input); requested.push(url);
      if (url.endsWith("/stable")) return new Response("1.0.0");
      if (options?.method === "HEAD") return new Response(null, { headers: { "x-goog-hash": `md5=${createHash("md5").update("different binary").digest("base64")}`, "x-goog-generation": "12345", "content-length": String(payload.length) } });
      return new Response(payload);
    },
    probe: async () => { checked = true; },
  });
  try {
    manager.action("grok", "install"); await manager.idle();
    assert.match(manager.view("grok").error!, /integrity verification failed/);
    assert.equal(checked, false);
    assert.ok(requested.some((url) => url.endsWith("?generation=12345")));
    assert.equal(manager.installed("grok"), false);
  } finally { await manager.close(); await rm(directory, { recursive: true, force: true }); }
});

test("interrupted runtime switch restores the previous binary and native snapshot before startup", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentbridge-rollback-"));
  const config = readConfig([], { AGENT_DATA_DIR: directory, AGENT_MANAGED_RUNTIMES: "true" });
  const previousId = randomUUID(), nextId = randomUUID();
  const native = path.join(directory, "agents", "pi"), backup = path.join(directory, "backups", "pi", nextId), runtime = path.join(directory, "runtimes", "pi");
  try {
    for (const target of [native, backup, path.join(runtime, "versions", previousId)]) await mkdir(target, { recursive: true });
    await writeFile(path.join(native, "history"), "migrated state"); await writeFile(path.join(backup, "history"), "old state");
    await writeFile(path.join(runtime, "versions", previousId, "cli"), "old binary");
    const previous = { version: "1.0.0", directory: previousId, command: "cli", size: 10, source: "https://registry.npmjs.org/fixture", integrity: "sha512-Zml4dHVyZQ==" };
    await writeFile(path.join(runtime, "manifest.json"), JSON.stringify({ current: { ...previous, version: "2.0.0", directory: nextId }, rollback: { previous, directory: nextId, snapshot: true }, operation: "update" }));
    const manager = new RuntimeManager(config, { runningVersion: () => null, switch: async () => {} });
    assert.equal(manager.view("pi").installedVersion, "1.0.0");
    assert.equal(manager.view("pi").usable, true);
    assert.match(manager.view("pi").error!, /interrupted/);
    assert.equal(await readFile(path.join(native, "history"), "utf8"), "old state");
    await manager.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
