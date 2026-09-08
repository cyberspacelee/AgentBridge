import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, symlink, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { settingsSchema, agentIds } from "../shared/settings.js";
import { readProfile, assertCompatible, copyRuntimes, initializeRuntimes } from "../tools/initialize.mjs";

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
