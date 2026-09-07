import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { readConfig } from "../src/config.js";
import {
  SettingsManager,
  opencodeEnvironment,
  piProviders,
  readSettings,
  piDirectory,
} from "../src/settings.js";
import { hiddenSecret, settingsSchema } from "../shared/settings.js";
import { PiAdapter } from "../src/engines/pi/adapter.js";

test("settings preserve secrets, reject stale writes and feed native model/skill/MCP configuration", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bridge-settings-"));
  try {
    const config = readConfig([], { AGENT_DATA_DIR: directory });
    const manager = new SettingsManager(config);
    const first = manager.view();
    assert.equal(
      settingsSchema.safeParse({
        providers: [
          { id: "invalid", baseUrl: "not-a-url", models: [{ id: "model" }] },
        ],
      }).success,
      false,
    );
    const saved = manager.save({
      revision: first.revision,
      settings: {
        ...first.settings,
        providers: [
          {
            id: "bridge",
            baseUrl: "http://localhost:9999/v1",
            apiKey: "!literal$key",
            models: [
              { id: "model", contextWindow: 32000, maxTokens: 4096 },
              { id: "large", contextWindow: 200000, maxTokens: 16384 },
            ],
          },
        ],
        skills: [
          { id: "office", path: directory, engine: "both", enabled: true },
        ],
        mcp: [
          {
            id: "office",
            enabled: true,
            config: {
              type: "local",
              command: ["node", "server.mjs"],
              environment: { TOKEN: "secret" },
            },
          },
        ],
      },
    });
    assert.equal(saved.settings.providers[0]!.apiKey, hiddenSecret);
    assert.ok(!JSON.stringify(saved).includes("literal"));
    assert.equal(saved.restartRequired, true);
    assert.equal(
      saved.settings.mcp[0]!.config.type === "local" &&
        saved.settings.mcp[0]!.config.environment.TOKEN,
      hiddenSecret,
    );
    assert.throws(
      () =>
        manager.save({ revision: first.revision, settings: first.settings }),
      /changed/,
    );
    manager.save({ revision: saved.revision, settings: saved.settings });
    assert.equal(readSettings(config).providers[0]!.apiKey, "!literal$key");
    assert.equal(piProviders(config).bridge!.apiKey, "$!literal$$key");
    const native = JSON.parse(
      opencodeEnvironment(config).OPENCODE_CONFIG_CONTENT,
    );
    assert.equal(native.provider.bridge.options.apiKey, "!literal$key");
    assert.deepEqual(native.provider.bridge.models.model.limit, {
      context: 32000,
      output: 4096,
    });
    assert.deepEqual(native.provider.bridge.models.large.limit, {
      context: 200000,
      output: 16384,
    });
    assert.deepEqual(
      piProviders(config).bridge!.models.map((model) => [
        model.contextWindow,
        model.maxTokens,
      ]),
      [
        [32000, 4096],
        [200000, 16384],
      ],
    );
    assert.deepEqual(native.skills.paths, [directory]);
    assert.equal(native.mcp.office.environment.TOKEN, "secret");
    const models = await new PiAdapter(config).models();
    assert.ok(
      models.some(
        (model) => model.providerID === "bridge" && model.modelID === "model",
      ),
    );
    const invalid = structuredClone(saved.settings);
    invalid.skills[0]!.path = "../outside";
    assert.throws(
      () => manager.save({ revision: saved.revision, settings: invalid }),
      /absolute/,
    );
    assert.equal(
      settingsSchema.safeParse({
        ...saved.settings,
        providers: [...saved.settings.providers, ...saved.settings.providers],
      }).success,
      false,
    );
    const cleared = manager.save({
      revision: saved.revision,
      settings: { ...saved.settings, providers: [], skills: [], mcp: [] },
    });
    assert.deepEqual(cleared.settings.providers, []);
    assert.equal(cleared.restartRequired, false);
    assert.ok((await stat(directory)).isDirectory());
    if (process.platform !== "win32")
      assert.equal(
        (await stat(path.join(directory, "settings.json"))).mode & 0o777,
        0o600,
      );
    const envConfig = readConfig([], {
      AGENT_DATA_DIR: directory,
      AGENT_OPENAI_BASE_URL: "http://localhost:8000/v1",
      AGENT_OPENAI_MODELS: "a,b",
      AGENT_OPENAI_API_KEY: "env-key",
    });
    assert.deepEqual(Object.keys(piProviders(envConfig)), ["compatible"]);
    assert.equal(
      new SettingsManager(envConfig).view().environmentProvider,
      true,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Pi uses selected local configuration and installs, loads and removes a local package", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bridge-package-"));
  const config = readConfig([], { AGENT_DATA_DIR: directory });
  const adapter = new PiAdapter(config);
  try {
    const native = path.join(directory, "personal-pi");
    const source = path.join(directory, "local-package");
    const marker = path.join(directory, "loaded.txt");
    await mkdir(native);
    await mkdir(source);
    await writeFile(
      path.join(native, "models.json"),
      JSON.stringify({
        providers: {
          personal: {
            api: "openai-completions",
            baseUrl: "http://localhost:9999/v1",
            apiKey: "local",
            models: [{ id: "personal-model" }],
          },
        },
      }),
    );
    await writeFile(
      path.join(source, "package.json"),
      JSON.stringify({
        name: "bridge-fixture",
        pi: { extensions: ["index.mjs"] },
      }),
    );
    await writeFile(
      path.join(source, "index.mjs"),
      `import { writeFileSync } from 'node:fs'; export default function(pi) { writeFileSync(${JSON.stringify(marker)}, 'loaded'); pi.registerCommand('fixture_plugin', {description: 'fixture', handler: async () => {}}); }`,
    );
    const manager = new SettingsManager(config);
    const initial = manager.view();
    manager.save({
      revision: initial.revision,
      settings: { ...initial.settings, piConfigDirectory: native },
    });
    assert.equal(piDirectory(config), native);
    assert.ok(
      (await adapter.models()).some(
        (model) => model.modelID === "personal-model",
      ),
    );
    const installed = await manager.packageOperation({
      action: "install",
      source,
    });
    assert.ok(installed.packages.includes(source));
    await adapter.start();
    await adapter.createSession({
      id: "plugin-test",
      title: "Plugin test",
      directory,
      engineId: "pi",
      interactionPolicy: { permission: "manual", question: "manual" },
      availability: "ready",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
    });
    assert.equal(await readFile(marker, "utf8"), "loaded");
    const removed = await manager.packageOperation({
      action: "remove",
      source,
    });
    assert.ok(!removed.packages.includes(source));
    assert.ok((await stat(source)).isDirectory());
    await assert.rejects(
      manager.packageOperation({ action: "install", source: "--help" }),
    );
  } finally {
    await adapter.stop();
    await rm(directory, { recursive: true, force: true });
  }
});
