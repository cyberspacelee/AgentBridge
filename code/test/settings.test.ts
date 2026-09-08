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
import { createServer } from "node:http";
import path from "node:path";
import os from "node:os";
import { parse } from "smol-toml";
import { readConfig } from "../src/config.js";
import {
  SettingsManager,
  agentDirectory,
  agentConfigFile,
  applyAgentConfiguration,
  agentRevision,
  configuredModels,
  nativeEnvironment,
  opencodeEnvironment,
  piProviders,
  readSettings,
} from "../src/settings.js";
import { hiddenSecret, settingsSchema } from "../shared/settings.js";

test("unified configuration isolates four native directories, snapshots applied resources and preserves secrets", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bridge-settings-"));
  try {
    const config = readConfig([], { AGENT_DATA_DIR: directory }),
      manager = new SettingsManager(config);
    const first = manager.view(),
      skill = path.join(directory, "office");
    await mkdir(skill);
    await writeFile(
      path.join(skill, "SKILL.md"),
      "---\nname: office\ndescription: Office operations\n---\n",
    );
    const saved = manager.save({
      revision: first.revision,
      settings: {
        ...first.settings,
        providers: [
          {
            id: "bridge",
            baseUrl: "http://localhost:9999/v1",
            api: "openai-responses",
            apiKey: "!literal$key",
            models: [
              { id: "model", contextWindow: 32000, maxTokens: 4096 },
              { id: "large" },
            ],
          },
        ],
        skills: [{ id: "office", path: skill }],
        mcp: [
          {
            id: "office",
            config: {
              type: "local",
              command: ["node", "server.mjs"],
              environment: { TOKEN: "secret" },
            },
          },
        ],
        agents: first.settings.agents.map((a) => ({
          ...a,
          models: [{ providerID: "bridge", modelID: "model" }],
          defaultModel: { providerID: "bridge", modelID: "model" },
          skillIds: ["office"],
          mcpIds: ["office"],
        })),
      },
    });
    assert.equal(saved.settings.providers[0]!.apiKey, hiddenSecret);
    assert.ok(!JSON.stringify(saved).includes("literal"));
    assert.throws(
      () =>
        manager.save({ revision: first.revision, settings: first.settings }),
      { code: "CONFLICT" },
    );
    manager.save({ revision: saved.revision, settings: saved.settings });
    assert.equal(readSettings(config).providers[0]!.apiKey, "!literal$key");
    for (const id of ["pi", "opencode", "codex", "grok"] as const) {
      const version = applyAgentConfiguration(config, id);
      assert.equal(version, agentRevision(config, id));
      assert.equal(configuredModels(config, id).length, 1);
      assert.equal(configuredModels(config, id)[0]!.modelID, "model");
      assert.ok((await stat(agentConfigFile(config, id))).isFile());
      if (process.platform !== "win32")
        assert.equal(
          (await stat(agentConfigFile(config, id))).mode & 0o777,
          0o600,
        );
    }
    assert.equal(piProviders(config).bridge!.apiKey, "$!literal$$key");
    const oc = JSON.parse(opencodeEnvironment(config).OPENCODE_CONFIG_CONTENT);
    assert.deepEqual(oc.skills.paths, [skill]);
    assert.equal(oc.mcp.office.environment.TOKEN, "secret");
    const codex = parse(
      await readFile(agentConfigFile(config, "codex"), "utf8"),
    );
    assert.equal(codex.model_provider, "bridge");
    assert.equal(
      nativeEnvironment(config, "codex").CODEX_HOME,
      agentDirectory(config, "codex"),
    );
    assert.equal(
      nativeEnvironment(config, "grok").GROK_HOME,
      agentDirectory(config, "grok"),
    );
    const next = structuredClone(saved.settings);
    next.providers[0]!.apiKey = "changed";
    next.agents
      .find((a) => a.id === "pi")!
      .models.push({ providerID: "bridge", modelID: "large" });
    manager.save({ revision: saved.revision, settings: next });
    assert.equal(configuredModels(config, "pi").length, 1);
    assert.equal(piProviders(config).bridge!.apiKey, "$!literal$$key");
    applyAgentConfiguration(config, "pi");
    assert.equal(configuredModels(config, "pi").length, 2);
    assert.equal(piProviders(config).bridge!.apiKey, "changed");
    assert.equal(
      JSON.parse(opencodeEnvironment(config).OPENCODE_CONFIG_CONTENT).provider
        .bridge.options.apiKey,
      "!literal$key",
    );
    const invalid = structuredClone(next);
    invalid.providers = [];
    assert.equal(settingsSchema.safeParse(invalid).success, false);
    const chatCodex = structuredClone(next);
    chatCodex.providers[0]!.api = "openai-completions";
    assert.equal(settingsSchema.safeParse(chatCodex).success, false);
    assert.equal(
      settingsSchema.safeParse({ piConfigDirectory: skill }).success,
      false,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("native import is preview-only and excludes credentials; saved settings override bootstrap environment", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bridge-import-"));
  try {
    const config = readConfig([], {
      AGENT_DATA_DIR: directory,
      AGENT_OPENAI_BASE_URL: "http://localhost:9/v1",
      AGENT_OPENAI_MODELS: "seed",
    });
    const manager = new SettingsManager(config),
      view = manager.view(),
      file = path.join(directory, "native.toml");
    await writeFile(
      file,
      'model = "custom"\nmodel_provider = "local"\n[model_providers.local]\nbase_url = "http://localhost:8/v1"\nexperimental_bearer_token = "private-key"\n',
    );
    const preview = manager.importNative("codex", { file });
    assert.equal(preview.providers[0]!.models[0]!.id, "custom");
    assert.ok(!JSON.stringify(preview).includes("private-key"));
    assert.equal(manager.view().revision, view.revision);
    const before = await readFile(file, "utf8");
    manager.save({
      revision: view.revision,
      settings: {
        ...view.settings,
        providers: [],
        agents: view.settings.agents.map((a) => ({
          ...a,
          enabled: false,
          models: [],
          defaultModel: null,
        })),
      },
    });
    assert.equal(readSettings(config).providers.length, 0);
    assert.equal(await readFile(file, "utf8"), before);
    const piFile = path.join(directory, "models.json");
    await writeFile(
      piFile,
      JSON.stringify({
        providers: {
          local: {
            baseUrl: "http://localhost:8/v1",
            api: "openai-completions",
            apiKey: "private-key",
            models: [
              {
                id: "custom",
                contextWindow: 32000,
                maxTokens: 4096,
                reasoning: true,
                input: ["text"],
                cost: { input: 1, output: 2 },
              },
            ],
          },
        },
      }),
    );
    const piPreview = manager.importNative("pi", { file: piFile });
    assert.equal(piPreview.providers[0]?.models[0]?.contextWindow, 32000);
    assert.ok(!JSON.stringify(piPreview).includes("private-key"));
    await writeFile(piFile, "{ invalid");
    assert.throws(
      () => manager.importNative("pi", { file: piFile }),
      /valid JSON or TOML/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("connection testing uses the selected protocol and reports provider failures without credentials", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bridge-connection-"));
  const requests: string[] = [];
  const server = createServer(async (req, res) => {
    for await (const _ of req) {
      void _;
    }
    requests.push(req.url!);
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify(
        req.url === "/v1/responses"
          ? {
              output: [
                {
                  type: "message",
                  content: [{ type: "output_text", text: "OK" }],
                },
              ],
            }
          : { choices: [{ message: { content: "OK" } }] },
      ),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const config = readConfig([], { AGENT_DATA_DIR: directory }),
      manager = new SettingsManager(config),
      view = manager.view();
    manager.save({
      revision: view.revision,
      settings: {
        ...view.settings,
        providers: ["openai-completions", "openai-responses"].map((api, i) => ({
          id: "p" + i,
          api,
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          models: [{ id: "custom" }],
        })),
      },
    });
    assert.equal(
      (await manager.testProvider("p0", { modelID: "custom" })).ok,
      true,
    );
    assert.equal(
      (await manager.testProvider("p1", { modelID: "custom" })).ok,
      true,
    );
    assert.deepEqual(requests, ["/v1/chat/completions", "/v1/responses"]);
    await assert.rejects(
      manager.testProvider("p0", { modelID: "missing" }),
      /Unknown/,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
