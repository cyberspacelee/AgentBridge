import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

export async function readProfile(filename, settingsSchema, agentIds) {
  const input = JSON.parse((await readFile(filename, "utf8")).replace(/^\uFEFF/, ""), (_key, value) =>
    typeof value === "string" ? value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name) => {
      if (!process.env[name]) throw new Error(`Missing environment variable: ${name}`);
      return process.env[name];
    }) : value);
  const selected = input.agents ?? [];
  if (!Array.isArray(selected) || selected.some((agent) => !agentIds.includes(agent?.id)) || new Set(selected.map((agent) => agent.id)).size !== selected.length)
    throw new Error("agents must contain unique supported Agent IDs");
  const settings = settingsSchema.parse({
    ...input,
    agents: agentIds.map((id) => ({ runtime: { mode: "managed" }, ...selected.find((agent) => agent.id === id), id })),
  });
  for (const skill of settings.skills) skill.path = path.resolve(path.dirname(filename), skill.path);
  return { settings, selected: settings.agents.filter((agent) => selected.some((item) => item.id === agent.id)) };
}

export function assertCompatible(previous, next) {
  const empty = !previous.providers.length && !previous.skills.length && !previous.mcp.length &&
    previous.agents.every((agent) => !agent.enabled && !agent.models.length && !agent.skillIds.length && !agent.mcpIds.length);
  // Initialization can resume its own configuration; editing existing profiles belongs in the app.
  const comparable = (settings) => ({ ...settings, agents: settings.agents.map(({ enabled, runtime, ...agent }) => agent) });
  if (!empty && JSON.stringify(comparable(previous)) !== JSON.stringify(comparable(next)))
    throw new Error("Existing settings differ from this profile. Use the app to edit them, or select a new data directory.");
}

export async function initializeRuntimes(request, agents, log = console.log) {
  const wait = async (route, key, id, allowError = false) => {
    const deadline = Date.now() + 30 * 60 * 1000;
    for (;;) {
      const item = (await request(route))[key].find((entry) => entry.id === id);
      if (!item) throw new Error(`Missing status for ${id}`);
      if (!item.operation) {
        if (item.error && !allowError) throw new Error(`${id}: ${item.error}`);
        return item;
      }
      if (Date.now() >= deadline) throw new Error(`${id}: initialization timed out`);
      await delay(500);
    }
  };
  for (const agent of agents) {
    const id = agent.id;
    const current = await wait("/api/runtimes", "runtimes", id, true);
    if (agent.runtime.mode === "managed") {
      if (!current.managedVersion || (current.managed && !current.usable)) {
        log(`${id}: installing runtime...`);
        await request(`/api/runtimes/${id}/actions`, { action: "install" });
        const installed = await wait("/api/runtimes", "runtimes", id);
        if (!installed.managedVersion) throw new Error(`${id}: runtime installation did not complete`);
      } else log(`${id}: runtime already installed; skipping download`);
    }
    if (agent.runtime.mode === "external" || !current.managed) {
      log(`${id}: checking runtime source...`);
      await request(`/api/runtimes/${id}/source`, agent.runtime, "PUT");
      await wait("/api/runtimes", "runtimes", id);
    }
    if (agent.enabled) {
      log(`${id}: enabling...`);
      await request(`/api/agents/${id}/actions`, { action: "enable" });
      const enabled = await wait("/api/agents", "agents", id);
      if (enabled.health.status !== "ready") throw new Error(`${id}: Agent is not ready`);
    }
  }
}

async function main() {
  const [backendRoot, directory, filename, npm] = process.argv.slice(2);
  if (!backendRoot || !directory || !filename || !npm) throw new Error("Run Initialize-AgentBridge.ps1 with -ExePath and -ConfigPath");
  const moduleAt = (relative) => import(pathToFileURL(path.join(backendRoot, relative)).href);
  const { settingsSchema, agentIds } = await moduleAt("dist/shared/settings.js");
  const { settings, selected } = await readProfile(path.resolve(filename), settingsSchema, agentIds);
  const { Supervisor } = await moduleAt("dist/host/supervisor.mjs");
  const { readConfig } = await moduleAt("dist/src/config.js");
  const { SettingsManager, readSettings } = await moduleAt("dist/src/settings.js");
  const supervisor = new Supervisor({
    node: process.execPath, args: [path.join(backendRoot, "dist/src/main.js")], directory,
    env: { AGENT_HOST: "127.0.0.1", AGENT_PORT: "0", AGENT_RUNTIME_NPM: npm, AGENT_MANAGED_RUNTIMES: "true" },
  });
  const cancellation = new AbortController();
  const interrupted = () => { cancellation.abort(new Error("Initialization cancelled")); process.exitCode = 1; };
  process.once("SIGINT", interrupted);
  process.once("SIGTERM", interrupted);
  try {
    await supervisor.initialize();
    cancellation.signal.throwIfAborted();
    const config = readConfig([], { AGENT_DATA_DIR: directory, AGENT_MANAGED_RUNTIMES: "true" });
    const previous = readSettings(config);
    assertCompatible(previous, settings);
    const manager = new SettingsManager(config);
    // Validate skill directories and save atomically before any CLI download or execution.
    manager.save({ revision: manager.view().revision, settings: {
      ...settings, agents: settings.agents.map((agent) => ({ ...agent, enabled: false, runtime: previous.agents.find((item) => item.id === agent.id).runtime })),
    } });
    console.log("Configuration saved. Starting temporary local gateway...");
    const origin = await supervisor.start();
    cancellation.signal.throwIfAborted();
    const request = async (route, body, method = body ? "POST" : "GET") => {
      const response = await fetch(`${origin}${route}`, {
        method, headers: { Authorization: `Bearer ${supervisor.token}`, "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}), redirect: "error", signal: AbortSignal.any([cancellation.signal, AbortSignal.timeout(60000)]),
      });
      if (!response.ok) throw new Error(`${method} ${route}: HTTP ${response.status}; inspect the application logs`);
      return response.json();
    };
    await initializeRuntimes(request, selected);
    console.log("Initialization complete. You can now open AgentBridge.");
  } finally {
    await supervisor.stop();
    process.removeListener("SIGINT", interrupted);
    process.removeListener("SIGTERM", interrupted);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    // Schema errors can contain user input; never print raw validation objects or secrets.
    console.error(error.name === "ZodError" ? "Invalid initialization configuration. Check the example and settings schema." : error.message);
    process.exitCode = 1;
  });
}
