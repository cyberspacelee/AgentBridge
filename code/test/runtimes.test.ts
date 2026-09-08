import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs, { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { readConfig } from "../src/config.js";
import { RuntimeManager, type RuntimeDependencies } from "../src/runtime/runtimes.js";

test("runtime promotion retries temporary locks, bounds persistent locks and preserves the installed version on failure", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentbridge-runtime-locks-"));
  const config = readConfig([], { AGENT_DATA_DIR: directory, AGENT_MANAGED_RUNTIMES: "true" });
  const manager = new RuntimeManager(config, {
    runningVersion: () => null,
    switch: async (_id, activate, rollback) => {
      try { await activate(); } catch (error) { await rollback(); throw error; }
    },
  }, {
    fetch: async () => Response.json({ version: "1.2.3", dist: { tarball: "https://registry.npmjs.org/opencode-ai/-/opencode-ai-1.2.3.tgz", integrity: "sha512-Zml4dHVyZQ==" } }),
    freeBytes: async () => 4 * 1024 ** 3,
    install: async (_id, _release, destination) => { await writeFile(path.join(destination, "cli"), "binary"); return "cli"; },
    probe: async (_id, command, destination) => {
      assert.equal(path.basename(path.dirname(destination)), "versions", "CLI must only execute after promotion to avoid Windows executable locks");
      assert.equal(await readFile(command, "utf8"), "binary");
    },
  });
  const rename = fs.rename;
  let failures: string[] = [], attempts = 0;
  t.mock.method(fs, "rename", async (...args: Parameters<typeof rename>) => {
    attempts++;
    const code = failures.shift();
    if (code) throw Object.assign(new Error(`Injected ${code}`), { code });
    return rename(...args);
  });
  syncBuiltinESMExports();
  const manifestFile = path.join(directory, "runtimes", "opencode", "manifest.json");
  try {
    for (const mode of ["managed", "external"] as const) {
      config.runtimeSources.opencode = mode === "managed" ? { mode } : { mode, command: process.execPath };
      for (const scenario of [
        { codes: [], attempts: 1, failed: false },
        { codes: ["EPERM", "EBUSY", "EACCES"], attempts: 4, failed: false },
        { codes: Array<string>(6).fill("EPERM"), attempts: 6, failed: true },
        { codes: ["ENOENT"], attempts: 1, failed: true },
      ]) {
        const previous = JSON.parse(await readFile(manifestFile, "utf8")).current;
        failures = [...scenario.codes]; attempts = 0;
        manager.action("opencode", "install"); await manager.idle();
        assert.equal(attempts, scenario.attempts);
        const current = JSON.parse(await readFile(manifestFile, "utf8")).current;
        if (scenario.failed) {
          assert.match(manager.view("opencode").error!, new RegExp(scenario.codes[0]!));
          assert.deepEqual(current, previous);
        } else {
          assert.equal(manager.view("opencode").error, null);
          assert.equal(current.version, "1.2.3");
          assert.notEqual(current.directory, previous?.directory);
        }
        assert.equal(await readFile(path.join(directory, "runtimes", "opencode", "versions", current.directory, current.command), "utf8"), "binary");
        assert.equal(manager.busy("opencode"), false);
      }
    }
  } finally {
    t.mock.restoreAll(); syncBuiltinESMExports();
    await manager.close(); await rm(directory, { recursive: true, force: true });
  }
});

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
    probe: async (_id, command, destination) => {
      assert.equal(path.basename(path.dirname(destination)), "versions");
      assert.equal(await readFile(command, "utf8"), latest);
      if (failProbe) throw new Error("incompatible protocol");
    },
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
    assert.equal((await readdir(path.join(directory, "runtimes", "opencode", "versions"))).length, 1);
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
    await writeFile(path.join(runtime, "manifest.json"), JSON.stringify({ schemaVersion: 1, current: { ...previous, version: "2.0.0", directory: nextId }, rollback: { previous, directory: nextId, snapshot: true }, operation: "update" }));
    const manager = new RuntimeManager(config, { runningVersion: () => null, switch: async () => {} });
    assert.equal(manager.view("pi").installedVersion, "1.0.0");
    assert.equal(manager.view("pi").usable, true);
    assert.match(manager.view("pi").error!, /interrupted/);
    assert.equal(await readFile(path.join(native, "history"), "utf8"), "old state");
    await manager.close();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Grok allows a 30 minute download while metadata stays bounded and cancellation still aborts the stream", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentbridge-grok-download-"));
  const config = readConfig([], { AGENT_DATA_DIR: directory, AGENT_MANAGED_RUNTIMES: "true" });
  const timeouts: number[] = [];
  const timeout = AbortSignal.timeout;
  t.mock.method(AbortSignal, "timeout", (ms: number) => { timeouts.push(ms); return timeout(ms); });
  let downloadSignal: AbortSignal | undefined;
  const downloading = Promise.withResolvers<void>();
  const manager = new RuntimeManager(config, {
    runningVersion: () => null,
    switch: async () => assert.fail("cancelled download must not activate"),
  }, {
    freeBytes: async () => 4 * 1024 ** 3,
    fetch: async (input, options) => {
      if (String(input).endsWith("/stable")) return new Response("1.0.0");
      if (options?.method === "HEAD") return new Response(null, { headers: {
        "x-goog-hash": "md5=Zml4dHVyZQ==", "x-goog-generation": "12345", "content-length": "1024",
      } });
      downloadSignal = options!.signal!;
      return new Response(new ReadableStream({
        start(controller) {
          downloadSignal!.addEventListener("abort", () => controller.error(downloadSignal!.reason), { once: true });
          downloading.resolve();
        },
      }));
    },
    probe: async () => assert.fail("cancelled download must not execute"),
  });
  try {
    manager.action("grok", "install");
    await downloading.promise;
    assert.deepEqual(timeouts, [120000, 120000, 30 * 60 * 1000]);
    manager.action("grok", "cancel"); await manager.idle();
    assert.equal(downloadSignal!.aborted, true);
    assert.match(manager.view("grok").error!, /cancelled/);
    assert.equal(manager.installed("grok"), false);
    assert.equal(manager.busy("grok"), false);
    await assert.rejects(readdir(path.join(directory, "runtimes", "grok", "staging")), { code: "ENOENT" });
  } finally { await manager.close(); await rm(directory, { recursive: true, force: true }); }
});

test("Pi, OpenCode and Codex use the configured registry in metadata, npm and integrity checks", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agentbridge-npm-download-"));
  const npm = path.join(directory, "npm-fixture.mjs");
  await writeFile(npm, `
    import assert from "node:assert/strict";
    import { mkdir, readFile, writeFile } from "node:fs/promises";
    import path from "node:path";
    assert.ok(process.argv.includes("--fetch-timeout=1800000"));
    const registry = process.env.npm_config_registry;
    assert.ok(process.argv.includes("--registry=" + registry));
    assert.ok((await readFile(".npmrc", "utf8")).includes("registry=" + registry));
    const dependencies = JSON.parse(await readFile("package.json", "utf8")).dependencies;
    const packages = {};
    for (const [name, version] of Object.entries(dependencies)) {
      packages["node_modules/" + name] = { version, resolved: registry + "fixture.tgz", integrity: "sha512-Zml4dHVyZQ==" };
    }
    if (process.argv[2] === "install") {
      await writeFile("package-lock.json", JSON.stringify({ packages }));
    } else {
      assert.equal(process.argv[2], "ci");
      const name = Object.keys(dependencies)[0];
      const command = name.startsWith("opencode-")
        ? path.join("node_modules", name, "bin", process.platform === "win32" ? "opencode.exe" : "opencode")
        : path.join("node_modules", ".bin", (name === "@openai/codex" ? "codex" : "pi") + (process.platform === "win32" ? ".cmd" : ""));
      await mkdir(path.dirname(command), { recursive: true });
      await writeFile(command, "fixture");
    }
  `);
  const config = readConfig([], { AGENT_DATA_DIR: directory, AGENT_MANAGED_RUNTIMES: "true", AGENT_RUNTIME_NODE: process.execPath, AGENT_RUNTIME_NPM: npm });
  const manager = new RuntimeManager(config, {
    runningVersion: () => null,
    switch: async (_id, activate, rollback) => {
      try { await activate(); } catch (error) { await rollback(); throw error; }
    },
  }, {
    fetch: async (url) => {
      assert.ok(String(url).startsWith(config.npmRegistry));
      return Response.json({ version: "1.2.3", dist: { tarball: config.npmRegistry + "fixture.tgz", integrity: "sha512-Zml4dHVyZQ==" } });
    },
    freeBytes: async () => 4 * 1024 ** 3,
    probe: async (_id, command) => { assert.equal(await readFile(command, "utf8"), "fixture"); },
  });
  try {
    for (const registry of ["https://registry.npmjs.org/", "https://registry.npmmirror.com/", "https://packages.example.com/repository/npm/"]) {
      config.npmRegistry = registry;
      for (const id of ["pi", "opencode", "codex"] as const) {
        manager.action(id, "install"); await manager.idle(id);
        assert.equal(manager.view(id).error, null);
        assert.equal(manager.view(id).installedVersion, "1.2.3");
        assert.equal(manager.view(id).source, registry + "fixture.tgz");
        assert.equal(manager.installed(id), true);
      }
    }
    const installedCommand = config.codex.command;
    const script = await readFile(npm, "utf8");
    for (const [replacement, expected] of [
      [script.replace('registry + "fixture.tgz"', '"https://untrusted.invalid/fixture.tgz"'), /unverified distribution source/],
      [script.replace("sha512-Zml4dHVyZQ==", "sha512-bW9kaWZpZWQ="), /artifact changed/],
    ] as const) {
      await writeFile(npm, replacement);
      manager.action("codex", "install"); await manager.idle();
      assert.match(manager.view("codex").error!, expected);
      assert.equal(config.codex.command, installedCommand);
    }
  } finally { await manager.close(); await rm(directory, { recursive: true, force: true }); }
});
