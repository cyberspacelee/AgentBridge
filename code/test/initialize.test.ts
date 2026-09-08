import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { settingsSchema, agentIds } from "../shared/settings.js";
import { readProfile, assertCompatible, initializeRuntimes } from "../tools/initialize.mjs";

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
  } finally {
    if (previousEnv === undefined) delete process.env[envKey]; else process.env[envKey] = previousEnv;
    await rm(directory, { recursive: true, force: true });
  }
});
