import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, symlink, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { findNpm } from "../host/supervisor.mjs";
import { settingsSchema, agentIds } from "../shared/settings.js";
import { readProfile, assertCompatible, copyRuntimes, initializeRuntimes } from "../tools/initialize.mjs";

test("the shipped initialization example matches current settings and defaults other Agents to disabled", async () => {
  const env = { AGENT_OPENAI_BASE_URL: "https://example.invalid/v1", AGENT_OPENAI_API_KEY: 'secret-"\\$value', AGENT_OPENAI_MODELS: "example-model" };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, env);
    const { settings, selected } = await readProfile(path.resolve("tools/initialize.example.json"), settingsSchema, agentIds);
    assert.equal(settings.schemaVersion, 1);
    assert.equal(settings.defaultAgent, "codex");
    assert.equal(settings.providers[0].api, "openai-responses");
    assert.equal(settings.providers[0].apiKey, env.AGENT_OPENAI_API_KEY);
    assert.deepEqual(settings.agents.filter((agent: { enabled: boolean }) => agent.enabled).map((agent: { id: string }) => agent.id), ["codex"]);
    assert.deepEqual(selected.map((agent: { id: string }) => agent.id), ["codex"]);
  } finally {
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test("initialization CLI uses the packaged backend, preserves network/listener settings and releases its lock", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bridge initialize "));
  const backend = path.join(directory, "installed app/backend");
  const data = path.join(directory, "user data/data");
  const filename = path.join(directory, "profile.json");
  const execute = promisify(execFile);
  try {
    await mkdir(backend, { recursive: true });
    await writeFile(path.join(backend, "package.json"), '{"type":"module"}');
    await symlink(path.resolve("node_modules"), path.join(backend, "node_modules"), process.platform === "win32" ? "junction" : "dir");
    await execute(process.execPath, [path.resolve("node_modules/typescript/bin/tsc"), "-p", "tsconfig.json", "--outDir", path.join(backend, "dist")], { timeout: 60000 });
    const npm = await findNpm(process.execPath);
    const args = [path.resolve("tools/initialize.mjs"), backend, data, filename, npm];
    const options = { timeout: 30000, env: { ...process.env, AGENT_HOST: "invalid-host", AGENT_PORT: "invalid-port", AGENT_ENGINE: "invalid-engine" } };
    await writeFile(filename, JSON.stringify({ schemaVersion: 1, defaultAgent: "codex" }));
    for (const saved of [false, true]) {
      const { stdout } = await execute(process.execPath, args, options);
      assert.match(stdout, /Initialization complete/);
      const systemFile = path.join(data, "system.json");
      const system = JSON.parse(await readFile(systemFile, "utf8"));
      assert.deepEqual(system.gateway, saved ? { host: "192.0.2.1", port: 43210 } : { host: "127.0.0.1", port: 6217 });
      assert.deepEqual(system.appliedGateway, system.gateway);
      if (saved) assert.equal(system.network.npmRegistry, "https://registry.npmmirror.com/");
      const settings = settingsSchema.parse(JSON.parse(await readFile(path.join(data, "settings.json"), "utf8")));
      assert.equal(settings.defaultAgent, "codex");
      assert.ok(settings.agents.every((agent) => !agent.enabled));
      await assert.rejects(readFile(path.join(data, ".host.lock")), { code: "ENOENT" });
      system.gateway = system.appliedGateway = { host: "192.0.2.1", port: 43210 }; // Cannot bind locally; the helper must use a temporary loopback listener.
      system.network.npmRegistry = system.appliedNetwork.npmRegistry = "https://registry.npmmirror.com/";
      await writeFile(systemFile, JSON.stringify(system));
    }
    const original = await readFile(path.join(data, "settings.json"), "utf8");
    await writeFile(filename, JSON.stringify({ schemaVersion: 3 }));
    await assert.rejects(execute(process.execPath, args, options), /Invalid initialization configuration/);
    await writeFile(filename, '{"apiKey":"do-not-print-this-secret", broken}');
    await assert.rejects(execute(process.execPath, args, options), (error: Error & { stderr?: string }) => {
      assert.match(error.stderr!, /Invalid initialization configuration/);
      assert.ok(!error.stderr!.includes("do-not-print-this-secret"));
      return true;
    });
    assert.equal(await readFile(path.join(data, "settings.json"), "utf8"), original);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("initialization expands secrets safely, resolves skill paths, rejects conflicts, and resumes failed installs", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bridge-initialize-"));
  const filename = path.join(directory, "profile.json");
  const envKey = "AGENTBRIDGE_INITIALIZE_TEST_SECRET";
  const previousEnv = process.env[envKey];
  try {
    process.env[envKey] = 'secret-"\\$value';
    const profile = {
      providers: [{ id: "local", baseUrl: "https://example.invalid/v1", apiKey: `\${${envKey}}`, models: [{ id: "example" }] }],
      skills: [{ id: "office", path: "./skills/office" }],
      mcp: [{ id: "office", config: { type: "local", command: ["python", "server.py"] } }],
      agents: [{ id: "pi", enabled: true, models: [{ providerID: "local", modelID: "example" }], defaultModel: { providerID: "local", modelID: "example" }, skillIds: ["office"], mcpIds: ["office"] }],
    };
    await writeFile(filename, "\uFEFF" + JSON.stringify(profile));
    const { settings, selected } = await readProfile(filename, settingsSchema, agentIds);
    assert.equal(settings.providers[0].apiKey, process.env[envKey]);
    assert.equal(settings.skills[0].path, path.join(directory, "skills/office"));
    assert.equal(settings.agents.length, 4);
    assert.deepEqual(selected.map((agent: { id: string }) => agent.id), ["pi"]);
    assertCompatible(settingsSchema.parse({}), settings);
    assertCompatible({ ...settings, agents: settings.agents.map((agent: object) => ({ ...agent, enabled: false })) }, settings);
    assert.throws(() => assertCompatible(settings, { ...settings, providers: [] }), /Existing settings differ/);
    delete process.env[envKey];
    await assert.rejects(readProfile(filename, settingsSchema, agentIds), /Missing environment variable/);
    await writeFile(filename, JSON.stringify({ agents: [{ id: "pi" }, { id: "pi" }] }));
    await assert.rejects(readProfile(filename, settingsSchema, agentIds), /unique supported/);
    await writeFile(filename, JSON.stringify({ agents: [{ id: "pi", skillIds: ["missing"] }] }));
    await assert.rejects(readProfile(filename, settingsSchema, agentIds));

    const actions: string[] = [];
    let installed = false;
    let fail = false;
    const request = async (route: string, body?: { action?: string }) => {
      if (body) {
        actions.push(body.action!);
        if (body.action === "install") installed = !fail;
        return {};
      }
      if (route === "/api/runtimes") return { runtimes: [{ id: "pi", operation: null, managed: true, usable: installed, managedVersion: installed ? "1.0.0" : null, error: installed ? null : "previous installation interrupted" }] };
      return { agents: [{ id: "pi", operation: null, health: { status: "ready" } }] };
    };
    await initializeRuntimes(request, selected, () => {});
    assert.deepEqual(actions, ["install", "enable"]);
    actions.length = 0;
    await initializeRuntimes(request, selected, () => {});
    assert.deepEqual(actions, ["enable"]);
    installed = false; fail = true; actions.length = 0;
    await assert.rejects(initializeRuntimes(request, selected, () => {}), /installation interrupted/);
    assert.deepEqual(actions, ["install"]); // Never enable after a failed installation.
    actions.length = 0;
    await assert.rejects(initializeRuntimes(request, selected, () => {}, true), /no download was attempted/);
    assert.deepEqual(actions, []);

    for (const mode of ["external", "managed"]) {
      let usable = false;
      let bound = false;
      const bindRequest = async (route: string, body?: { action?: string }, method?: string) => {
        if (body) {
          if (method === "PUT") { assert.equal(route, "/api/runtimes/pi/source"); bound = true; }
          else actions.push(body.action!);
          return {};
        }
        return { runtimes: [{ id: "pi", operation: null, managed: bound && mode === "managed", usable, managedVersion: "1.0.0", error: null }] };
      };
      const agents = [{ ...selected[0], enabled: false, runtime: { mode, ...(mode === "external" ? { command: "pi" } : {}) } }];
      await assert.rejects(initializeRuntimes(bindRequest, agents, () => {}, true), /source is not usable/);
      assert.deepEqual(actions, []); // No download or enable after failed source verification.
      bound = false; usable = true;
      await initializeRuntimes(bindRequest, agents, () => {}, true);
      assert.ok(bound);
    }
  } finally {
    if (previousEnv === undefined) delete process.env[envKey]; else process.env[envKey] = previousEnv;
    await rm(directory, { recursive: true, force: true });
  }
});

test("local runtimes copy their active version and manifest without replacing existing installations", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bridge-copy-runtime-"));
  const source = path.join(directory, "snapshot/runtimes");
  const target = path.join(directory, "target");
  const uuid = "11111111-1111-4111-8111-111111111111";
  const command = process.platform === "win32" ? "codex.cmd" : "codex";
  const version = path.join(source, "codex/versions", uuid);
  const sourceFile = path.join(source, "codex/manifest.json");
  const manifest = { schemaVersion: 1, current: { version: "1.2.3", directory: uuid, command, size: 100, source: "fixture", integrity: "fixture" } };
  const agents = [{ id: "codex", runtime: { mode: "managed" } }];
  const quiet = () => {};
  try {
    await mkdir(path.join(version, "node_modules/dependency"), { recursive: true });
    await writeFile(path.join(version, command), "fixture executable");
    await writeFile(path.join(version, "node_modules/dependency/index.js"), "fixture dependency");
    await writeFile(sourceFile, JSON.stringify(manifest));
    await mkdir(path.join(source, "codex/versions/unused"));
    let checks = 0;
    const verify = async (file: string, expected: string) => {
      checks++;
      assert.equal(await readFile(file, "utf8"), "fixture executable");
      assert.equal(expected, "1.2.3");
    };
    await copyRuntimes(source, target, agents, verify, quiet);
    const destinationFile = path.join(target, "runtimes/codex/manifest.json");
    const copied = JSON.parse(await readFile(destinationFile, "utf8"));
    assert.notEqual(copied.current.directory, uuid);
    const destination = path.join(target, "runtimes/codex/versions", copied.current.directory);
    assert.equal(await readFile(path.join(destination, "node_modules/dependency/index.js"), "utf8"), "fixture dependency");
    assert.deepEqual(await readdir(path.dirname(destination)), [copied.current.directory]);
    assert.equal(await readFile(sourceFile, "utf8"), JSON.stringify(manifest));
    await copyRuntimes(source, target, agents, verify, quiet);
    assert.equal(checks, 1);
    assert.equal(await readFile(destinationFile, "utf8"), JSON.stringify(copied));

    const rejected = path.join(directory, "rejected");
    await assert.rejects(copyRuntimes(source, rejected, agents, async () => { throw new Error("Wrong architecture"); }, quiet), /Wrong architecture/);
    await assert.rejects(readFile(path.join(rejected, "runtimes/codex/manifest.json")), { code: "ENOENT" });
    assert.deepEqual(await readdir(path.join(rejected, "runtimes/codex")), ["versions"]);
    assert.deepEqual(await readdir(path.join(rejected, "runtimes/codex/versions")), []);

    await writeFile(sourceFile, JSON.stringify({ ...manifest, operation: "install" }));
    await assert.rejects(copyRuntimes(source, rejected, agents, verify, quiet), /complete, idle/);
    await writeFile(sourceFile, JSON.stringify({ ...manifest, current: { ...manifest.current, command: "../outside" } }));
    await assert.rejects(copyRuntimes(source, rejected, agents, verify, quiet), /complete, idle/);
    await writeFile(sourceFile, JSON.stringify(manifest));
    await writeFile(path.join(source, "../.host.lock"), "active");
    await assert.rejects(copyRuntimes(source, rejected, agents, verify, quiet), /Exit the source/);
    await rm(path.join(source, "../.host.lock"));
    if (process.platform !== "win32") {
      await symlink("../../../..", path.join(version, "escape"));
      await assert.rejects(copyRuntimes(source, rejected, agents, verify, quiet), /outside its version/);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
