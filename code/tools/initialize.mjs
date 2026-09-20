import { cp, lstat, mkdir, readFile, readdir, readlink, realpath, rename, rm, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import path from "node:path";
import { pathToFileURL } from "node:url";

async function readInput(filename) {
  return JSON.parse((await readFile(filename, "utf8")).replace(/^\uFEFF/, ""), (_key, value) =>
    typeof value === "string" ? value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name) => {
      if (!process.env[name]) throw new Error(`Missing environment variable: ${name}`);
      return process.env[name];
    }) : value);
}

export async function readProfile(filename, settingsSchema, agentIds) {
  const input = await readInput(filename);
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

const optionalStat = (file) => lstat(file).catch((error) => { if (error.code !== "ENOENT") throw error; return null; });
const inside = (root, target) => {
  const relative = path.relative(root, target);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
};
const runtimeNames = (id) => id === "qwen" ? ["qwen", "qwencode", "qwen-code"] : [id];

// Preserve relative links inside an asset; reject dependencies on the source machine.
async function checkTree(root, folder = root) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isSymbolicLink()) {
      if (path.isAbsolute(await readlink(file)) || !inside(root, await realpath(file)))
        throw new Error("Asset contains a link outside its version directory");
    } else if (entry.isDirectory()) await checkTree(root, file);
    else if (!entry.isFile()) throw new Error("Asset contains an unsupported filesystem entry");
  }
}

export async function copySkills(source, directory, skills) {
  const root = await realpath(source);
  const targetRoot = path.join(directory, "skills");
  const digest = async (folder) => {
    const hash = createHash("sha256");
    const visit = async (folder) => {
      for (const entry of (await readdir(folder, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        const file = path.join(folder, entry.name);
        hash.update(JSON.stringify([entry.name, entry.isDirectory(), entry.isSymbolicLink()]));
        if (entry.isDirectory()) await visit(file);
        else if (entry.isSymbolicLink()) hash.update(JSON.stringify(await readlink(file)));
        else {
          const content = createHash("sha256");
          for await (const chunk of createReadStream(file)) content.update(chunk);
          hash.update(content.digest());
        }
      }
      hash.update("end-directory");
    };
    await visit(folder);
    return hash.digest("hex");
  };
  const plans = [];
  for (const skill of skills) {
    if (!/^[a-zA-Z0-9_-]+$/.test(skill.id)) throw new Error("Invalid Skill ID");
    const candidates = [...new Set([skill.id, path.win32.basename(skill.path)])];
    const matches = [];
    for (const name of candidates) {
      if (!name || [".", ".."].includes(name)) continue;
      const folder = path.join(root, name);
      if ((await optionalStat(path.join(folder, "SKILL.md")))?.isFile()) matches.push(folder);
    }
    if (matches.length !== 1) throw new Error(`${skill.id}: expected one Skill directory named by ID or original folder name, containing SKILL.md`);
    const from = await realpath(matches[0]);
    if (!inside(root, from)) throw new Error("Skill directory escapes its source");
    await checkTree(from);
    const to = path.join(targetRoot, skill.id);
    const existing = await optionalStat(to);
    if (existing) {
      if (!existing.isDirectory() || existing.isSymbolicLink()) throw new Error(`${skill.id}: existing Skill path is not a regular directory`);
      await checkTree(to);
      if (await digest(from) !== await digest(to)) throw new Error(`${skill.id}: existing Skill files differ; use a new data directory`);
    } else plans.push({ from, to });
  }
  await mkdir(targetRoot, { recursive: true, mode: 0o700 });
  if (!inside(await realpath(directory), await realpath(targetRoot))) throw new Error("Skill destination escapes the data directory");
  for (const { from, to } of plans) {
    const staging = path.join(targetRoot, `.copy-${randomUUID()}`);
    try {
      await cp(from, staging, { recursive: true, verbatimSymlinks: true, force: false, errorOnExist: true });
      await checkTree(staging);
      await rename(staging, to);
    } finally { await rm(staging, { recursive: true, force: true }); }
  }
}

export async function readSystem(filename, gatewaySchema, defaultGateway, validateNetworkSettings, llmProxySchema, defaultLlmProxy) {
  const input = await readInput(filename);
  if (input?.schemaVersion !== 1 || !input.network || input.applying !== false)
    throw new Error("Expected a current, idle system.json with schemaVersion 1");
  if (input.network.encryptedPassword || input.appliedNetwork?.encryptedPassword)
    throw new Error("System proxy password is encrypted for the source machine; provide network.proxyPassword in the deployment file instead");
  const gateway = gatewaySchema.parse(input.gateway ?? defaultGateway);
  const network = validateNetworkSettings(input.network);
  const llmProxy = llmProxySchema && defaultLlmProxy ? llmProxySchema.parse(input.llmProxy ?? defaultLlmProxy) : undefined;
  return { gateway, network, ...(llmProxy ? { llmProxy } : {}) };
}

// Caller holds the target instance lock. Source must be a stopped instance or a snapshot.
export async function copyRuntimes(source, directory, agents, verify = null, log = console.log) {
  const sourceRoot = await realpath(source);
  const readOptional = async (file) => readFile(file, "utf8").catch((error) => {
    if (error.code !== "ENOENT") throw error;
    return null;
  });
  if (await readOptional(path.join(sourceRoot, "../.host.lock")))
    throw new Error("Exit the source AgentBridge instance before copying runtimes");
  for (const agent of agents.filter((item) => item.runtime.mode === "managed")) {
    const id = agent.id;
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`Unsupported runtime ID: ${id}`);
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
    const sourceIds = runtimeNames(id);
    let sourceId = "", raw = "";
    for (const candidate of sourceIds) {
      const candidateRaw = await readOptional(path.join(sourceRoot, candidate, "manifest.json"));
      if (candidateRaw !== null) { sourceId = candidate; raw = candidateRaw; break; }
    }
    if (!sourceId) continue;
    const sourceFile = path.join(sourceRoot, sourceId, "manifest.json");
    const manifest = JSON.parse(raw);
    const current = manifest.current;
    if (!current) continue;
    if (manifest.schemaVersion !== 1 || !current || manifest.rollback || manifest.sourceRollback || manifest.operation || manifest.uninstallPending ||
        !/^\d+\.\d+\.\d+$/.test(current.version) || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(current.directory) ||
        typeof current.command !== "string" || !current.command || path.win32.isAbsolute(current.command) || path.posix.isAbsolute(current.command) || current.command.split(/[\\/]/).includes("..") ||
        !Number.isFinite(current.size) || current.size < 0 || typeof current.source !== "string" || typeof current.integrity !== "string")
      throw new Error(`${id}: expected a complete, idle AgentBridge runtime manifest`);
    if ((process.platform === "win32") !== /\.(cmd|exe)$/i.test(current.command))
      throw new Error(`${id}: runtime belongs to a different operating system`);
    const version = await realpath(path.join(sourceRoot, sourceId, "versions", current.directory));
    if (!inside(sourceRoot, version)) throw new Error(`${id}: version directory escapes the runtime source`);
    await checkTree(version);
    const uuid = randomUUID();
    const destination = path.join(target, "versions", uuid);
    let committed = false;
    try {
      await mkdir(path.dirname(destination), { recursive: true });
      // Keep the executable at its final path before probing: Windows may retain file locks afterward.
      // The new UUID is not active until the verified manifest is committed below.
      await cp(version, destination, { recursive: true, verbatimSymlinks: true, force: false, errorOnExist: true });
      const command = path.join(destination, current.command);
      if (!(await lstat(await realpath(command))).isFile()) throw new Error(`${id}: runtime executable is missing`);
      if (verify) {
        log(`${id}: checking copied runtime ${current.version}...`);
        await verify(command, current.version);
      }
      if (await readFile(sourceFile, "utf8") !== raw) throw new Error(`${id}: source changed during copying; retry with the source app closed`);
      const temporary = path.join(target, `manifest-${uuid}.tmp`);
      try {
        await writeFile(temporary, JSON.stringify({ schemaVersion: 1, current: { ...current, directory: uuid } }), { flag: "wx", mode: 0o600 });
        await rename(temporary, targetFile);
        committed = true;
      } finally { await rm(temporary, { force: true }); }
      log(`${id}: copied runtime ${current.version}`);
    } finally {
      if (!committed) await rm(destination, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }
}

async function main() {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: { runtimes: { type: "string" }, skills: { type: "string" }, system: { type: "string" }, "run-timeout-minutes": { type: "string" } } });
  const [backendRoot, directory, filename, npm, legacyRuntimesPath] = positionals;
  const runtimesPath = values.runtimes ?? legacyRuntimesPath;
  if (!backendRoot || !directory || !filename || !npm) throw new Error("Run Initialize-AgentBridge.ps1 with -ExePath and -ConfigPath");
  const moduleAt = (relative) => import(pathToFileURL(path.join(backendRoot, relative)).href);
  const { settingsSchema, agentIds } = await moduleAt("dist/shared/settings.js");
  const { settings, selected: requested } = await readProfile(path.resolve(filename), settingsSchema, agentIds);
  if (values["run-timeout-minutes"] !== undefined) {
    const minutes = Number(values["run-timeout-minutes"]);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) throw new Error("--run-timeout-minutes must be an integer from 1 to 1440");
    settings.runTimeoutMs = minutes * 60000;
  }
  const skills = structuredClone(settings.skills);
  if (values.skills) for (const skill of settings.skills) skill.path = path.join(directory, "skills", skill.id);
  const { Supervisor } = await moduleAt("dist/host/supervisor.mjs");
  const { readConfig } = await moduleAt("dist/src/config.js");
  const { SettingsManager, readSettings } = await moduleAt("dist/src/settings.js");
  let system;
  if (values.system) {
    const { gatewaySchema, defaultGateway, llmProxySchema, defaultLlmProxy } = await moduleAt("dist/host/gateway.mjs");
    const { validateNetworkSettings } = await moduleAt("dist/host/network.mjs");
    system = await readSystem(values.system, gatewaySchema, defaultGateway, validateNetworkSettings, llmProxySchema, defaultLlmProxy);
  }
  const supervisor = new Supervisor({
    node: process.execPath, args: [path.join(backendRoot, "dist/src/main.js")], directory,
    env: { AGENT_HOST: undefined, AGENT_PORT: undefined, AGENT_ENGINE: undefined, AGENT_RUNTIME_NPM: npm, AGENT_MANAGED_RUNTIMES: "true" },
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
    if (settings.runTimeoutMs === undefined && previous.runTimeoutMs !== undefined)
      settings.runTimeoutMs = previous.runTimeoutMs;
    if (values.skills) await copySkills(values.skills, directory, skills);
    const manager = new SettingsManager(config);
    manager.save({ revision: manager.view().revision, settings: {
      ...settings,
    } });
    if (system) {
      supervisor.gateway = supervisor.appliedGateway = system.gateway;
      if (system.llmProxy) supervisor.llmProxy = supervisor.appliedLlmProxy = system.llmProxy;
      supervisor.settings = supervisor.applied = system.network;
      supervisor.error = null;
      await supervisor.persist(false);
    }
    if (runtimesPath) {
      await copyRuntimes(runtimesPath, directory, requested);
    }
    console.log("Initialization complete. Runtime files, configuration and skills are ready.");
  } finally {
    await supervisor.stop();
    process.removeListener("SIGINT", interrupted);
    process.removeListener("SIGTERM", interrupted);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(await realpath(process.argv[1])).href) {
  main().catch((error) => {
    // Schema errors can contain user input; never print raw validation objects or secrets.
    console.error(["ZodError", "SyntaxError"].includes(error.name) ? "Invalid initialization configuration. Check the example and settings schema." : error.message);
    process.exitCode = 1;
  });
}
