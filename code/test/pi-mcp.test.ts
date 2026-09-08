import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { readConfig } from "../src/config.js";
import {
  SettingsManager,
  applyAgentConfiguration,
  piMcpConfiguration,
  readSettings,
  agentDirectory,
} from "../src/settings.js";
import { PiAdapter } from "../src/engines/pi/adapter.js";

test("Pi MCP generation includes only selected servers, keeps secret values literal and removes stale entries on apply", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bridge-mcp-"));
  try {
    const config = readConfig([], { AGENT_DATA_DIR: directory }),
      manager = new SettingsManager(config);
    let view = manager.view();
    const token = "!literal ${TOKEN} $env:TOKEN {env:TOKEN}";
    view = manager.save({
      revision: view.revision,
      settings: {
        ...view.settings,
        agents: view.settings.agents.map((a) =>
          a.id === "pi" ? { ...a, mcpIds: ["office"] } : a,
        ),
        mcp: [
          {
            id: "office",
            config: {
              type: "local",
              command: ["node", "server.mjs", token],
              environment: { TOKEN: token },
            },
          },
          {
            id: "unselected",
            config: { type: "local", command: ["must-not-start"] },
          },
        ],
      },
    });
    applyAgentConfiguration(config, "pi");
    const file = path.join(agentDirectory(config, "pi"), "mcp.json");
    assert.deepEqual(
      Object.keys(JSON.parse(await readFile(file, "utf8")).mcpServers),
      ["office"],
    );
    const converted = piMcpConfiguration(readSettings(config));
    assert.ok(Object.values(converted.environment).includes(token));
    assert.ok(!JSON.stringify(converted.servers).includes(token));
    const next = structuredClone(view.settings);
    next.agents.find((a) => a.id === "pi")!.mcpIds = [];
    manager.save({ revision: view.revision, settings: next });
    assert.ok(JSON.parse(await readFile(file, "utf8")).mcpServers.office);
    applyAgentConfiguration(config, "pi");
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")).mcpServers, {});
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test(
  "bundled Pi MCP extension loads without installing into the user's Pi directory",
  { timeout: 45000 },
  async () => {
    const directory = await mkdtemp(
      path.join(os.tmpdir(), "bridge-mcp-native-"),
    );
    const config = readConfig([], { AGENT_DATA_DIR: directory }),
      adapter = new PiAdapter(config);
    try {
      const server = path.join(directory, "server.mjs");
      await writeFile(
        server,
        `import {createInterface} from "node:readline"; createInterface({input:process.stdin}).on("line", line=>{const {id,method}=JSON.parse(line);if(id===undefined)return;const result=method==="initialize"?{protocolVersion:"2025-03-26",capabilities:{tools:{}},serverInfo:{name:"fixture",version:"1"}}:method==="tools/list"?{tools:[]}:{};process.stdout.write(JSON.stringify({jsonrpc:"2.0",id,result})+"\\n")});`,
      );
      const manager = new SettingsManager(config),
        view = manager.view();
      manager.save({
        revision: view.revision,
        settings: {
          ...view.settings,
          agents: view.settings.agents.map((a) =>
            a.id === "pi" ? { ...a, mcpIds: ["fixture"] } : a,
          ),
          mcp: [
            {
              id: "fixture",
              config: { type: "local", command: [process.execPath, server] },
            },
          ],
        },
      });
      applyAgentConfiguration(config, "pi");
      await adapter.start();
      const binding = await adapter.createSession({
        id: "mcp-test",
        title: "MCP",
        directory,
        engineId: "pi",
        interactionPolicy: { permission: "manual", question: "manual" },
        availability: "ready",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
      });
      assert.ok(binding.nativeSessionId);
      assert.equal(adapter.health().processes, 1);
    } finally {
      await adapter.stop();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
