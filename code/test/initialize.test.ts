import { test } from "node:test";
import assert from "node:assert/strict";
import fs, { chmod, copyFile, mkdtemp, mkdir, readFile, readdir, realpath, symlink, writeFile, rm } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { findNpm, Supervisor } from "../host/supervisor.mjs";
import { defaultNetworkSettings, validateNetworkSettings } from "../host/network.mjs";
import { gatewaySchema, defaultGateway } from "../host/gateway.mjs";
import { settingsSchema, agentIds } from "../shared/settings.js";
import { readProfile, readSystem, assertCompatible, copySkills, copyRuntimes, initializeRuntimes } from "../tools/initialize.mjs";

const powershell = process.env.AGENT_TEST_POWERSHELL ?? (process.platform === "win32" ? "powershell.exe" : undefined);
test("PowerShell ZIP extraction rejects unsafe paths and preserves asset layouts", { skip: !powershell }, async () => {
  const { stdout } = await promisify(execFile)(powershell!, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.resolve("test/initialize-zip.ps1")]);
  assert.match(stdout, /ZIP extraction checks passed/);
});
test("PowerShell installs the adjacent EXE silently and stops on installer failures", { skip: !powershell }, async () => {
  const { stdout } = await promisify(execFile)(powershell!, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.resolve("test/initialize-install.ps1")]);
  assert.match(stdout, /Installer checks passed/);
});

test("the shipped initialization example matches current settings and defaults other Agents to disabled", async () => {
  const env = { AGENT_OPENAI_BASE_URL: "https://example.invalid/v1", AGENT_OPENAI_API_KEY: 'secret-"\\$value', AGENT_OPENAI_MODELS: "example-model" };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  try {
    Object.assign(process.env, env);
    const { settings, selected } = await readProfile(path.resolve("tools/initialize.example.json"), settingsSchema, agentIds);
    assert.equal(settings.schemaVersion, 1);
    assert.equal(settings.defaultAgent, "codex");
    assert.equal(settings.runTimeoutMs, 1800000);
    assert.equal(settings.providers[0].api, "openai-responses");
    assert.equal(settings.providers[0].apiKey, env.AGENT_OPENAI_API_KEY);
    assert.deepEqual(settings.agents.filter((agent: { enabled: boolean }) => agent.enabled).map((agent: { id: string }) => agent.id), ["codex"]);
    assert.deepEqual(selected.map((agent: { id: string }) => agent.id), ["codex"]);
  } finally {
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test("initialization CLI starts through linked paths, preserves network/listener settings and releases its lock", async () => {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "bridge initialize ")));
  const resources = path.join(directory, "installed app/resources");
  const backend = path.join(resources, "backend");
  const data = path.join(directory, "user data/data");
  const filename = path.join(directory, "profile.json");
  const execute = promisify(execFile);
  try {
    // macOS /var and Windows short paths can alias the installed directory.
    const packaged = path.join(directory, "packaged backend");
    const linkType = process.platform === "win32" ? "junction" : "dir";
    await mkdir(packaged);
    await mkdir(resources, { recursive: true });
    await symlink(packaged, backend, linkType);
    await symlink(path.resolve("tools"), path.join(directory, "tools"), linkType);
    await fs.cp(path.resolve("docs"), path.join(backend, "docs"), { recursive: true });
    await writeFile(path.join(backend, "package.json"), '{"type":"module"}');
    await symlink(path.resolve("node_modules"), path.join(backend, "node_modules"), process.platform === "win32" ? "junction" : "dir");
    await execute(process.execPath, [path.resolve("node_modules/typescript/bin/tsc"), "-p", "tsconfig.json", "--outDir", path.join(backend, "dist")], { timeout: 60000 });
    const npm = await findNpm(process.execPath);
    const args = [path.join(directory, "tools/initialize.mjs"), backend, data, filename, npm, "--run-timeout-minutes", "45"];
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
      assert.equal(settings.runTimeoutMs, 2700000);
      assert.ok(settings.agents.every((agent) => !agent.enabled));
      await assert.rejects(readFile(path.join(data, ".host.lock")), { code: "ENOENT" });
      system.gateway = system.appliedGateway = { host: "192.0.2.1", port: 43210 }; // Cannot bind locally; the helper must use a temporary loopback listener.
      system.network.npmRegistry = system.appliedNetwork.npmRegistry = "https://registry.npmmirror.com/";
      await writeFile(systemFile, JSON.stringify(system));
    }
    const original = await readFile(path.join(data, "settings.json"), "utf8");
    for (const invalid of ["0", "1441", "1.5", "NaN"])
      await assert.rejects(execute(process.execPath, [...args.slice(0, -1), invalid], options), /integer from 1 to 1440/);
    await execute(process.execPath, args.slice(0, -2), options);
    assert.equal(JSON.parse(await readFile(path.join(data, "settings.json"), "utf8")).runTimeoutMs, 2700000, "rerunning an older profile preserves the page setting");
    await writeFile(filename, JSON.stringify({ schemaVersion: 3 }));
    await assert.rejects(execute(process.execPath, args, options), /Invalid initialization configuration/);
    await writeFile(filename, '{"apiKey":"do-not-print-this-secret", broken}');
    await assert.rejects(execute(process.execPath, args, options), (error: Error & { stderr?: string }) => {
      assert.match(error.stderr!, /Invalid initialization configuration/);
      assert.ok(!error.stderr!.includes("do-not-print-this-secret"));
      return true;
    });
    assert.equal(await readFile(path.join(data, "settings.json"), "utf8"), original);

    const assets = path.join(directory, "assets");
    const runtimes = path.join(assets, "runtimes");
    const skills = path.join(assets, "skills");
    await mkdir(path.join(skills, "office/assets"), { recursive: true });
    await writeFile(path.join(skills, "office/SKILL.md"), "---\nname: office\ndescription: Fixture skill\n---\nOffice instructions.");
    await writeFile(path.join(skills, "office/assets/template.txt"), "template");
    for (const id of agentIds) {
      await mkdir(path.join(runtimes, id), { recursive: true });
      await writeFile(path.join(runtimes, id, "manifest.json"), JSON.stringify({ schemaVersion: 1, current: null }));
    }
    const systemFile = path.join(assets, "system.json");
    const network = { ...defaultNetworkSettings, mode: "direct", npmRegistry: "https://registry.npmmirror.com/" };
    const system = { schemaVersion: 1, gateway: { host: "localhost", port: 0 }, network, appliedNetwork: defaultNetworkSettings, applying: false, error: null };
    await writeFile(systemFile, "\uFEFF" + JSON.stringify(system));
    const profile = settingsSchema.parse({ defaultAgent: "codex", skills: [{ id: "office", path: "C:\\source machine\\skills\\office" }] });
    await writeFile(filename, JSON.stringify(profile));

    // Exercise the complete PowerShell wrapper, including both ZIP inputs and space-containing paths.
    if (powershell) {
      const exe = path.join(directory, "installed app/agentbridge.exe");
      await writeFile(exe, "fixture");
      await mkdir(path.join(resources, "node/node_modules"), { recursive: true });
      const node = path.join(resources, "node/node.exe");
      await copyFile(process.execPath, node); await chmod(node, 0o755);
      await symlink(path.dirname(path.dirname(npm)), path.join(resources, "node/node_modules/npm"), process.platform === "win32" ? "junction" : "dir");
      await execute(powershell, ["-NoProfile", "-Command", "Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory($env:BRIDGE_TEST_RUNTIMES, $env:BRIDGE_TEST_RUNTIMES + '.zip'); [System.IO.Compression.ZipFile]::CreateFromDirectory($env:BRIDGE_TEST_SKILLS, $env:BRIDGE_TEST_SKILLS + '.zip')"], {
        env: { ...process.env, BRIDGE_TEST_RUNTIMES: runtimes, BRIDGE_TEST_SKILLS: skills },
      });
      const root = path.join(directory, "PowerShell data");
      const { stdout } = await execute(powershell, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.resolve("tools/Initialize-AgentBridge.ps1"), "-ExePath", exe,
        "-SettingsPath", filename, "-SystemPath", systemFile, "-RuntimesPath", runtimes + ".zip", "-SkillsPath", skills + ".zip", "-DataDirectory", root, "-RunTimeoutMinutes", "45"], options);
      assert.match(stdout, /Initialization complete/);
      const saved = settingsSchema.parse(JSON.parse(await readFile(path.join(root, "data/settings.json"), "utf8")));
      assert.equal(saved.skills[0]!.path, path.join(root, "data/skills/office"));
      assert.equal(saved.runTimeoutMs, 2700000);
      assert.equal(await readFile(path.join(saved.skills[0]!.path, "assets/template.txt"), "utf8"), "template");
      assert.deepEqual(JSON.parse(await readFile(path.join(root, "data/system.json"), "utf8")).gateway, system.gateway);

      // Automatic sidecar discovery and the helper shipped inside the installed application.
      const bundle = path.join(directory, "deployment bundle");
      await mkdir(bundle);
      await copyFile(path.resolve("tools/Initialize-AgentBridge.ps1"), path.join(bundle, "Initialize-AgentBridge.ps1"));
      await mkdir(path.join(resources, "initialization"));
      await copyFile(path.resolve("tools/initialize.mjs"), path.join(resources, "initialization/initialize.mjs"));
      await copyFile(filename, path.join(bundle, "settings.json"));
      await copyFile(systemFile, path.join(bundle, "system.json"));
      await copyFile(skills + ".zip", path.join(bundle, "skills.zip"));
      await copyFile(runtimes + ".zip", path.join(bundle, "runtimes.zip"));
      const automatic = path.join(directory, "automatic profile");
      for (let attempt = 0; attempt < 2; attempt++) {
        const { stdout } = await execute(powershell, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(bundle, "Initialize-AgentBridge.ps1"),
          "-InstallDirectory", path.dirname(exe), "-DataDirectory", automatic], options);
        assert.match(stdout, /Using installed application/);
        assert.match(stdout, /Initialization complete/);
        const saved = settingsSchema.parse(JSON.parse(await readFile(path.join(automatic, "data/settings.json"), "utf8")));
        assert.equal(saved.skills[0]!.path, path.join(automatic, "data/skills/office"));
        assert.equal(await readFile(path.join(saved.skills[0]!.path, "assets/template.txt"), "utf8"), "template");
        assert.deepEqual(JSON.parse(await readFile(path.join(automatic, "data/system.json"), "utf8")).gateway, system.gateway);
      }
    }

    const uuid = "11111111-1111-4111-8111-111111111111";
    const version = path.join(runtimes, "codex/versions", uuid);
    await mkdir(version, { recursive: true });
    const program = `if (process.argv.includes('--version')) { console.log('1.2.3'); } else {
      require('node:readline').createInterface({input:process.stdin}).on('line', line => {
        const {id} = JSON.parse(line); if (id !== undefined) console.log(JSON.stringify({id, result:{userAgent:'1.2.3'}}));
      });
    }`;
    const command = process.platform === "win32" ? "codex.cmd" : "codex";
    await writeFile(path.join(version, "cli.cjs"), program);
    await writeFile(path.join(version, command), process.platform === "win32" ? '@echo off\r\n"%AGENT_RUNTIME_NODE%" "%~dp0cli.cjs" %*\r\n' : "#!/usr/bin/env node\n" + program);
    await chmod(path.join(version, command), 0o755);
    await writeFile(path.join(runtimes, "codex/manifest.json"), JSON.stringify({ schemaVersion: 1, current: { version: "1.2.3", directory: uuid, command, size: 100, source: "fixture", integrity: "fixture" } }));
    profile.providers.push({ id: "local", baseUrl: "https://example.invalid/v1", apiKey: "fixture-key", api: "openai-responses", enabled: true, models: [{ id: "example", name: "", contextWindow: 128000, maxTokens: 16384 }] });
    Object.assign(profile.agents.find((agent) => agent.id === "codex")!, { enabled: true, models: [{ providerID: "local", modelID: "example" }], defaultModel: { providerID: "local", modelID: "example" }, skillIds: ["office"] });
    await writeFile(filename, JSON.stringify(profile));
    const offline = path.join(directory, "offline data");
    const offlineArgs = [args[0]!, backend, offline, filename, npm, "--runtimes", runtimes, "--skills", skills, "--system", systemFile];
    for (let attempt = 0; attempt < 2; attempt++) {
      const { stdout } = await execute(process.execPath, offlineArgs, options);
      assert.match(stdout, /Initialization complete/);
      assert.ok(!stdout.includes("installing runtime"));
      const saved = settingsSchema.parse(JSON.parse(await readFile(path.join(offline, "settings.json"), "utf8")));
      assert.equal(saved.skills[0]!.path, path.join(offline, "skills/office"));
      assert.deepEqual(saved.agents.filter((agent) => agent.enabled).map((agent) => agent.id), ["codex"]);
      const imported = JSON.parse(await readFile(path.join(offline, "system.json"), "utf8"));
      assert.deepEqual(imported.gateway, system.gateway);
      assert.deepEqual(imported.network, imported.appliedNetwork);
      assert.equal(imported.network.npmRegistry, network.npmRegistry);
    }
    const restarted = new Supervisor({ directory: offline, args: [path.join(backend, "dist/src/main.js")], env: { AGENT_HOST: undefined, AGENT_PORT: undefined, AGENT_ENGINE: undefined, AGENT_RUNTIME_NPM: npm } });
    try {
      await restarted.initialize();
      const url = await restarted.start();
      const { agents } = await (await fetch(url + "/api/agents")).json();
      assert.equal(agents.find((agent: { id: string }) => agent.id === "codex").health.status, "ready");
    } finally { await restarted.stop(); }
    if (process.platform === "win32") {
      // Exercise the native executable that triggered EPERM after --version on Windows.
      const opencodeVersion = path.join(runtimes, "opencode/versions", uuid);
      await mkdir(opencodeVersion, { recursive: true });
      await copyFile(path.resolve("node_modules/opencode-ai/bin/opencode.exe"), path.join(opencodeVersion, "opencode.exe"));
      const { version } = JSON.parse(await readFile(path.resolve("node_modules/opencode-ai/package.json"), "utf8"));
      await writeFile(path.join(runtimes, "opencode/manifest.json"), JSON.stringify({ schemaVersion: 1, current: { version, directory: uuid, command: "opencode.exe", size: 100, source: "fixture", integrity: "fixture" } }));
      const { stdout } = await execute(process.execPath, offlineArgs, options);
      assert.match(stdout, /opencode: copied runtime/);
      const installed = JSON.parse(await readFile(path.join(offline, "runtimes/opencode/manifest.json"), "utf8"));
      assert.equal(installed.current.version, version);
      assert.match((await execute(process.execPath, offlineArgs, options)).stdout, /opencode: target runtime already registered/);
    }
    await writeFile(path.join(skills, "office/assets/template.txt"), "changed");
    await assert.rejects(execute(process.execPath, offlineArgs, options), /existing Skill files differ/);
    assert.equal(await readFile(path.join(offline, "skills/office/assets/template.txt"), "utf8"), "template");
    assert.equal(JSON.parse(await readFile(filename, "utf8")).skills[0].path, profile.skills[0]!.path);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("deployment system files reject old, interrupted and machine-encrypted settings before import", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "bridge-system-import-"));
  const filename = path.join(directory, "system.json");
  try {
    for (const input of [
      { schemaVersion: 3, network: defaultNetworkSettings, applying: false },
      { schemaVersion: 1, network: defaultNetworkSettings, applying: true },
      { schemaVersion: 1, network: { ...defaultNetworkSettings, encryptedPassword: "machine-bound" }, applying: false },
      { schemaVersion: 1, network: { ...defaultNetworkSettings, npmRegistry: "http://example.invalid" }, applying: false },
    ]) {
      await writeFile(filename, JSON.stringify(input));
      await assert.rejects(readSystem(filename, gatewaySchema, defaultGateway, validateNetworkSettings));
    }
    await mkdir(path.join(directory, "skills/office"), { recursive: true });
    await writeFile(path.join(directory, "skills/office/SKILL.md"), "skill");
    await symlink(directory, path.join(directory, "skills/office/escape"), process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(copySkills(path.join(directory, "skills"), path.join(directory, "data"), [{ id: "office", path: "office" }]), /outside its version directory/);
    await assert.rejects(readFile(path.join(directory, "data/skills/office/SKILL.md")), { code: "ENOENT" });
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

test("local runtimes retain their checked path under Windows locks and publish only verified versions", async (t) => {
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
  const checkedDirectories = new Set<string>();
  const rename = fs.rename;
  t.mock.method(fs, "rename", async (...args: Parameters<typeof rename>) => {
    if (checkedDirectories.has(String(args[0]))) throw Object.assign(new Error("EPERM: checked executable directory is still locked"), { code: "EPERM" });
    return rename(...args);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  try {
    await mkdir(path.join(version, "node_modules/dependency"), { recursive: true });
    await writeFile(path.join(version, command), "fixture executable");
    await writeFile(path.join(version, "node_modules/dependency/index.js"), "fixture dependency");
    await writeFile(sourceFile, JSON.stringify(manifest));
    await mkdir(path.join(source, "codex/versions/unused"));
    let checks = 0;
    const verify = async (file: string, expected: string) => {
      checks++;
      checkedDirectories.add(path.dirname(file));
      await assert.rejects(readFile(path.join(target, "runtimes/codex/manifest.json")), { code: "ENOENT" });
      assert.equal(await readFile(file, "utf8"), "fixture executable");
      assert.equal(expected, "1.2.3");
    };
    await copyRuntimes(source, target, agents, verify, quiet);
    const destinationFile = path.join(target, "runtimes/codex/manifest.json");
    const copied = JSON.parse(await readFile(destinationFile, "utf8"));
    assert.notEqual(copied.current.directory, uuid);
    const destination = path.join(target, "runtimes/codex/versions", copied.current.directory);
    assert.ok(checkedDirectories.has(destination), "Verified executables must keep the same directory after activation");
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
