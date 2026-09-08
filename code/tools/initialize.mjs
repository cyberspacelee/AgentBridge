import { cp, lstat, mkdir, readFile, readdir, readlink, realpath, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
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

// Caller holds the target instance lock. Source must be a stopped instance or a snapshot.
export async function copyRuntimes(source, directory, agents, verify, log = console.log) {
  const sourceRoot = await realpath(source);
  const readOptional = async (file) => readFile(file, "utf8").catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });
  if (await readOptional(path.join(sourceRoot, "../.host.lock")))
    throw new Error("Exit the source AgentBridge instance before copying runtimes");
  const inside = (root, target) => {
    const relative = path.relative(root, target);
    return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
  };
  // Preserve npm's relative .bin links, but reject links back to the source machine.
  const checkTree = async (root, folder = root) => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const file = path.join(folder, entry.name);
      if (entry.isSymbolicLink()) {
        const link = await readlink(file);
        if (path.isAbsolute(link) || !inside(root, await realpath(file)))
          throw new Error("Runtime contains a link outside its version directory");
      } else if (entry.isDirectory()) await checkTree(root, file);
      else if (!entry.isFile()) throw new Error("Runtime contains an unsupported filesystem entry");
    }
  };
  for (const agent of agents.filter((item) => item.runtime.mode === "managed")) {
    const id = agent.id;
    if (!["pi", "opencode", "codex", "grok"].includes(id)) throw new Error("Unsupported runtime ID");
    const target = path.join(directory, "runtimes", id);
    const targetFile = path.join(target, "manifest.json");
    const old = JSON.parse(await readOptional(targetFile) ?? "null");
    if (old && old.schemaVersion !== 1) throw new Error(`${id}: unsupported target runtime manifest; original file retained`);
    if (old?.rollback || old?.sourceRollback || old?.operation || old?.uninstallPending)
      throw new Error(`${id}: target runtime has an unfinished operation; recover it in the app first`);
    if (old?.current) {
      log(`${id}: target runtime already registered; keeping it`);
      continue;
    }
    const sourceFile = path.join(sourceRoot, id, "manifest.json");
    const raw = await readFile(sourceFile, "utf8");
    const manifest = JSON.parse(raw);
    const current = manifest.current;
    if (manifest.schemaVersion !== 1 || !current || manifest.rollback || manifest.sourceRollback || manifest.operation || manifest.uninstallPending ||
        !/^\d+\.\d+\.\d+$/.test(current.version) || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(current.directory) ||
        typeof current.command !== "string" || !current.command || path.win32.isAbsolute(current.command) || path.posix.isAbsolute(current.command) || current.command.split(/[\\/]/).includes("..") ||
        !Number.isFinite(current.size) || current.size < 0 || typeof current.source !== "string" || typeof current.integrity !== "string")
      throw new Error(`${id}: expected a complete, idle AgentBridge runtime manifest`);
    if ((process.platform === "win32") !== /\.(cmd|exe)$/i.test(current.command))
      throw new Error(`${id}: runtime belongs to a different operating system`);
    const version = await realpath(path.join(sourceRoot, id, "versions", current.directory));
    if (!inside(sourceRoot, version)) throw new Error(`${id}: version directory escapes the runtime source`);
    await checkTree(version);
    const uuid = randomUUID();
    const staging = path.join(target, `copy-${uuid}`);
    const destination = path.join(target, "versions", uuid);
    let committed = false;
    try {
      await mkdir(path.dirname(destination), { recursive: true });
      await cp(version, staging, { recursive: true, verbatimSymlinks: true, force: false, errorOnExist: true });
      const command = path.join(staging, current.command);
      if (!(await lstat(await realpath(command))).isFile()) throw new Error(`${id}: runtime executable is missing`);
      log(`${id}: checking copied runtime ${current.version}...`);
      await verify(command, current.version);
      if (await readFile(sourceFile, "utf8") !== raw) throw new Error(`${id}: source changed during copying; retry with the source app closed`);
      await rename(staging, destination);
      const temporary = path.join(target, `manifest-${uuid}.tmp`);
      try {
        await writeFile(temporary, JSON.stringify({ schemaVersion: 1, current: { ...current, directory: uuid } }), { flag: "wx", mode: 0o600 });
        await rename(temporary, targetFile);
        committed = true;
      } finally { await rm(temporary, { force: true }); }
      log(`${id}: copied runtime ${current.version}`);
    } finally {
      await rm(staging, { recursive: true, force: true });
      if (!committed) await rm(destination, { recursive: true, force: true });
    }
  }
}

export async function initializeRuntimes(request, agents, log = console.log, localOnly = false) {
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
        if (localOnly) throw new Error(`${id}: local runtime is missing or unusable; no download was attempted`);
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
  const [backendRoot, directory, filename, npm, runtimesPath] = process.argv.slice(2);
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
    if (runtimesPath) {
      const { startProcess, stopProcess } = await moduleAt("dist/src/engines/process.js");
      const { within } = await moduleAt("dist/src/async.js");
      await copyRuntimes(runtimesPath, directory, selected, async (command, expected) => {
        cancellation.signal.throwIfAborted();
        const child = startProcess(command, ["--version"], path.dirname(command), { ...process.env, AGENT_RUNTIME_NODE: process.execPath });
        let output = "";
        child.stdout.on("data", (chunk) => { output = (output + chunk).slice(-8192); });
        child.stderr.on("data", (chunk) => { output = (output + chunk).slice(-8192); });
        try {
          await within(new Promise((resolve, reject) => {
            child.once("error", reject);
            child.once("exit", (code) => code === 0 ? resolve() : reject(new Error("Copied runtime cannot run on this machine; check OS, CPU architecture and dependencies")));
          }), 15000);
          if (output.match(/\d+\.\d+\.\d+/)?.[0] !== expected) throw new Error("Copied runtime version does not match its manifest");
          cancellation.signal.throwIfAborted();
        } finally { await stopProcess(child, 5000); }
      });
    }
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
    await initializeRuntimes(request, selected, console.log, !!runtimesPath);
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
