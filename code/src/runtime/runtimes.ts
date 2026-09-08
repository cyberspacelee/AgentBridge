import { createHash, randomUUID } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { chmod, cp, mkdir, open, readdir, readFile, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { agentIds, runtimeSourceSchema, type AgentId, type RuntimeSource } from "../../shared/settings.js";
import type { RuntimeAction, RuntimeView } from "../../shared/runtimes.js";
import type { Config } from "../config.js";
import { GatewayError, errorDetail } from "../errors.js";
import { agentDirectory, applyAgentConfiguration, diagnosticSecrets, readSettings } from "../settings.js";
import { startProcess, stopProcess, resolveExecutable } from "../engines/process.js";
import { within } from "../async.js";
import { PiAdapter } from "../engines/pi/adapter.js";
import { OpenCodeAdapter } from "../engines/opencode/adapter.js";
import { CodexAdapter } from "../engines/codex/adapter.js";
import { GrokAdapter } from "../engines/grok/adapter.js";

const packages = { pi: "@earendil-works/pi-coding-agent", opencode: "opencode-ai", codex: "@openai/codex" } as const;
const stableVersion = z.string().regex(/^\d+\.\d+\.\d+$/);
const maxDownload = 512 * 1024 * 1024;
const maxInstallation = 2 * 1024 * 1024 * 1024;
const downloadTimeoutMs = 30 * 60 * 1000;
const timestamp = () => new Date().toISOString();
// Windows may briefly lock runtime files after a CLI exits or while a scanner reads them.
const removeOptions = { recursive: true, force: true, maxRetries: 5, retryDelay: 200 };
async function renameDirectory(source: string, destination: string) {
  for (let attempt = 0; ; attempt++) {
    try { await rename(source, destination); return; }
    catch (error) {
      if (attempt >= removeOptions.maxRetries || !["EPERM", "EACCES", "EBUSY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      await delay(removeOptions.retryDelay * (attempt + 1));
    }
  }
}
function opencodePackage() {
  const platform = process.platform === "win32" ? "windows" : process.platform;
  const musl = process.platform === "linux" && !(process.report.getReport() as { header: { glibcVersionRuntime?: string } }).header.glibcVersionRuntime;
  // The baseline x64 build also works on machines without AVX2.
  return `opencode-${platform}-${process.arch}${process.arch === "x64" ? "-baseline" : ""}${musl ? "-musl" : ""}`;
}
const installedSchema = z.object({ version: stableVersion, directory: z.string().uuid(), command: z.string().refine((value) => !path.isAbsolute(value) && !value.split(/[\\/]/).includes("..")), size: z.number(), source: z.string(), integrity: z.string() });
const bindingSchema = z.object({ sessionId: z.string(), nativeSessionId: z.string(), processGeneration: z.number(), instanceId: z.string() });
type RuntimeBinding = z.infer<typeof bindingSchema>;
const manifestSchema = z.object({
  schemaVersion: z.literal(1),
  current: installedSchema.nullable().default(null),
  rollback: z.object({ previous: installedSchema.nullable(), directory: z.string().uuid(), snapshot: z.boolean(), bindings: z.array(bindingSchema).default([]) }).nullable().default(null),
  sourceRollback: z.object({ previous: runtimeSourceSchema, directory: z.string().uuid(), snapshot: z.boolean(), bindings: z.array(bindingSchema) }).nullable().default(null),
  uninstallPending: z.boolean().default(false),
  latestVersion: stableVersion.nullable().default(null), checkedAt: z.string().nullable().default(null), checkError: z.string().nullable().default(null),
  operation: z.enum(["check", "detect", "install", "update", "uninstall"]).nullable().default(null),
  error: z.string().nullable().default(null),
});
type Manifest = z.infer<typeof manifestSchema>;
type Release = { version: string; source: string; integrity: string; bytes?: number; dependencies?: Record<string, string> };
type Hooks = {
  runningVersion(id: AgentId): string | null;
  saveSource?(id: AgentId, source: RuntimeSource): void;
  snapshotBindings?(id: AgentId): RuntimeBinding[];
  restoreBindings?(id: AgentId, bindings: RuntimeBinding[]): void;
  switch(id: AgentId, activate: () => Promise<void>, rollback: () => Promise<void>, uninstall: boolean): Promise<void>;
};
export type RuntimeDependencies = {
  fetch: typeof fetch;
  freeBytes?: (directory: string) => Promise<number>;
  install?: (id: AgentId, release: Release, directory: string, signal: AbortSignal) => Promise<string>;
  probe?: (id: AgentId, command: string, directory: string, signal: AbortSignal) => Promise<void>;
};

export async function directorySize(directory: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) total += await directorySize(filename);
    else if (entry.isFile()) total += (await stat(filename)).size;
    if (total > maxInstallation) throw new Error("Runtime exceeded the 2 GiB installation limit");
  }
  return total;
}


export class RuntimeManager {
  private manifests = new Map<AgentId, Manifest>();
  private states = new Map<AgentId, Partial<RuntimeView>>();
  private operations = new Map<AgentId, { controller: AbortController; done: Promise<void> }>();
  private closed = false;
  private detections = new Map<AgentId, Partial<RuntimeView>>();
  private readonly dependencies: RuntimeDependencies;
  constructor(readonly config: Config, private hooks: Hooks, dependencies: Partial<RuntimeDependencies> = {}) {
    this.dependencies = { fetch, ...dependencies };
    for (const id of agentIds) {
      config.runtimeSources[id] = readSettings(config).agents.find((agent) => agent.id === id)!.runtime;
      if (!this.managed(id)) config[id].command = config.runtimeSources[id]!.command!;
      let manifest = manifestSchema.parse({ schemaVersion: 1 });
      {
        mkdirSync(this.directory(id), { recursive: true, mode: 0o700 });
        try { manifest = manifestSchema.parse(JSON.parse(readFileSync(this.manifestFile(id), "utf8"))); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error(`Unsupported or invalid ${id} runtime manifest; use a new data directory. No migration is provided.`); }
        if (manifest.rollback) {
          const backup = path.join(config.dataDirectory, "backups", id, manifest.rollback.directory);
          if (manifest.rollback.snapshot) {
            if (!existsSync(backup)) throw new Error(`Interrupted ${id} update requires its missing native state backup`);
            const native = agentDirectory(config, id);
            rmSync(native, removeOptions); cpSync(backup, native, { recursive: true });
          }
          this.hooks.restoreBindings?.(id, manifest.rollback.bindings);
          manifest.current = manifest.rollback.previous; manifest.rollback = null;
        }
        if (manifest.sourceRollback) {
          const rollback = manifest.sourceRollback;
          const backup = path.join(config.dataDirectory, "backups", id, rollback.directory);
          if (rollback.snapshot) {
            if (!existsSync(backup)) throw new Error(`Interrupted ${id} source switch is missing its native backup`);
            const native = agentDirectory(config, id);
            rmSync(native, removeOptions); cpSync(backup, native, { recursive: true });
          } else rmSync(agentDirectory(config, id), removeOptions);
          config.runtimeSources[id] = rollback.previous;
          if (rollback.previous.mode === "external") config[id].command = rollback.previous.command!;
          this.hooks.saveSource?.(id, rollback.previous);
          this.hooks.restoreBindings?.(id, rollback.bindings);
          manifest.sourceRollback = null;
          manifest.error = "来源切换被中断，已恢复原来源和会话";
        }
        if (manifest.operation) { manifest.error = "Installation was interrupted by gateway shutdown; retry the operation"; manifest.operation = null; }
        rmSync(path.join(this.directory(id), "staging"), removeOptions);
      }
      this.manifests.set(id, manifest);
      if (this.managed(id)) this.select(id);
      this.persist(id);
    }
  }
  private directory(id: AgentId) { return path.join(this.config.dataDirectory, "runtimes", id); }
  private manifestFile(id: AgentId) { return path.join(this.directory(id), "manifest.json"); }
  private persist(id: AgentId) {
    const filename = this.manifestFile(id);
    writeFileSync(`${filename}.tmp`, JSON.stringify(this.manifests.get(id)), { mode: 0o600 });
    renameSync(`${filename}.tmp`, filename);
  }
  private select(id: AgentId) {
    const current = this.manifests.get(id)!.current;
    this.config[id].command = current
      ? path.join(this.directory(id), "versions", current.directory, current.command)
      : path.join(this.directory(id), "not-installed");
  }
  managed(id: string) { return this.config.runtimeSources[id]?.mode === "managed"; }
  installed(id: string) {
    if (!agentIds.includes(id as AgentId)) return true;
    const manifest = this.manifests.get(id as AgentId);
    if (!this.managed(id)) return !!resolveExecutable(this.config[id as AgentId].command) && this.detections.get(id as AgentId)?.detection !== "failed";
    return !!manifest?.current && !manifest.uninstallPending && existsSync(this.config[id as AgentId].command);
  }
  async detect(id: AgentId, signal: AbortSignal = AbortSignal.timeout(10000)) {
    if (this.managed(id)) return this.view(id);
    this.detections.set(id, { detection: "checking", compatibility: "unknown", installedVersion: null });
    let executable: string | undefined;
    const command = this.config[id].command;
    executable = resolveExecutable(command);
    if (!executable) this.detections.set(id, { executable: null, detection: "missing", detectedAt: timestamp(), installedVersion: null, compatibility: "unknown", error: "找不到外部 CLI，请检查命令或切换到受管安装" });
    else {
      try {
        const output = await this.command(executable, ["--version"], this.config.dataDirectory, AbortSignal.any([signal, AbortSignal.timeout(10000)]));
        const version = output.match(/\d+\.\d+\.\d+/)?.[0];
        if (!version) throw new Error("CLI 未返回可识别的版本");
        this.detections.set(id, { executable, detection: "present", detectedAt: timestamp(), installedVersion: version, compatibility: "unknown", error: null });
      } catch (error) { this.detections.set(id, { executable, detection: "failed", detectedAt: timestamp(), installedVersion: null, compatibility: "unknown", error: errorDetail(error, diagnosticSecrets(this.config)) }); }
    }
    return this.view(id);
  }
  async bind(id: AgentId, source: RuntimeSource) {
    if (this.closed || this.busy(id)) throw new GatewayError("CONFLICT", "运行时操作尚未结束", 409);
    const previous = { ...this.config.runtimeSources[id]! };
    const previousCommand = this.config[id].command;
    const controller = new AbortController();
    this.states.set(id, { operation: "source", cancelable: true, updateStatus: "checking" });
    const manifest = this.manifests.get(id)!;
    const operation = randomUUID();
    const backup = path.join(this.config.dataDirectory, "backups", id, operation);
    const native = agentDirectory(this.config, id);
    const done = Promise.resolve().then(async () => {
      try {
        if (source.mode === "managed" && !this.manifests.get(id)?.current) throw new Error("请先安装受管 CLI，再切换来源");
        if (source.mode === "external") {
            const output = await this.command(source.command!, ["--version"], this.config.dataDirectory, AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]));
            const version = output.match(/\d+\.\d+\.\d+/)?.[0];
            if (!version) throw new Error("外部 CLI 未返回版本");
            const probeDirectory = path.join(this.directory(id), "source-probe", randomUUID());
            await mkdir(probeDirectory, { recursive: true });
            try { await this.probe(id, source.command!, probeDirectory, controller.signal, version, true); }
            finally { await rm(probeDirectory, removeOptions); }
        }
        controller.signal.throwIfAborted();
        this.states.set(id, { operation: "source", cancelable: false, updateStatus: "switching" });
        await this.hooks.switch(id, async () => {
          const snapshot = existsSync(native);
          if (snapshot) {
            const size = await directorySize(native);
            const disk = await statfs(native);
            if (disk.bavail * disk.bsize < size + 64 * 1024 * 1024) throw new Error("原生会话备份空间不足");
            await mkdir(path.dirname(backup), { recursive: true }); await cp(native, backup, { recursive: true });
          }
          manifest.sourceRollback = { previous, directory: operation, snapshot, bindings: this.hooks.snapshotBindings?.(id) ?? [] };
          this.persist(id);
          this.config.runtimeSources[id] = source;
          if (source.mode === "managed") this.select(id); else this.config[id].command = source.command!;
          this.hooks.saveSource?.(id, source);
          this.detections.delete(id);
        }, async () => {
          this.config.runtimeSources[id] = previous; this.config[id].command = previousCommand;
          this.hooks.saveSource?.(id, previous);
          if (manifest.sourceRollback) {
            await rm(native, removeOptions);
            if (manifest.sourceRollback.snapshot) await cp(backup, native, { recursive: true });
          }
          if (manifest.sourceRollback) this.hooks.restoreBindings?.(id, manifest.sourceRollback.bindings);
          manifest.sourceRollback = null; this.persist(id);
        }, false);
        manifest.sourceRollback = null; manifest.error = null; this.persist(id);
        if (source.mode === "external") {
          await this.detect(id);
          if (this.detections.get(id)?.detection === "present") this.detections.set(id, { ...this.detections.get(id), compatibility: "compatible" });
        }
        await rm(backup, removeOptions);
      } catch (error) {
        manifest.error = errorDetail(error, diagnosticSecrets(this.config)); this.persist(id);
        this.detections.set(id, { ...this.detections.get(id), error: manifest.error });
        if (!manifest.sourceRollback) await rm(backup, removeOptions);
      }
      finally { this.operations.delete(id); this.states.delete(id); }
    });
    this.operations.set(id, { controller, done });
    return this.view(id);
  }
  busy(id: string) { return this.operations.has(id as AgentId); }
  views(): RuntimeView[] { return agentIds.map((id) => this.view(id)); }
  view(id: AgentId): RuntimeView {
    const manifest = this.manifests.get(id)!;
    const current = manifest.current;
    const runningVersion = this.hooks.runningVersion(id);
    return {
      id, managed: this.managed(id), usable: this.managed(id) ? this.installed(id) : this.installed(id) && (this.detections.get(id)?.detection === "present" || !!runningVersion),
      detectedAt: null, executable: this.config[id].command, detection: this.managed(id) ? (this.installed(id) ? "present" : "missing") : "unknown", compatibility: runningVersion ? "compatible" : "unknown", platform: `${process.platform}-${process.arch}`,
      installedVersion: this.managed(id) ? current?.version ?? null : runningVersion,
      managedVersion: current?.version ?? null,
      runningVersion, latestVersion: manifest.latestVersion, checkedAt: manifest.checkedAt, checkError: manifest.checkError,
      status: manifest.error ? "failed" : (this.managed(id) && current) || (!this.managed(id) && (runningVersion || this.detections.get(id)?.installedVersion)) ? "installed" : "not_installed",
      updateStatus: manifest.latestVersion && current && manifest.latestVersion !== current.version ? "available" : "idle",
      operation: manifest.operation, cancelable: false, progress: null, downloadedBytes: 0, totalBytes: null,
      sizeBytes: current?.size ?? null, error: manifest.error, source: current?.source ?? null, integrity: current?.integrity ?? null,
      ...this.detections.get(id),
      ...this.states.get(id),
      ...(runningVersion ? { compatibility: "compatible" as const } : {}),
    };
  }
  action(id: AgentId, action: RuntimeAction) {
    if (!this.managed(id) && !["check", "detect", "install", "cancel"].includes(action)) throw new GatewayError("CONFLICT", "外部 CLI 不允许覆盖更新或卸载，请先切换到受管来源", 409);
    if (this.closed) throw new GatewayError("SERVICE_UNAVAILABLE", "Gateway is shutting down", 503);
    const pending = this.operations.get(id);
    if (action === "cancel") {
      if (!pending || !this.view(id).cancelable) throw new GatewayError("CONFLICT", "This operation cannot be cancelled", 409);
      pending.controller.abort(new Error("Operation cancelled"));
      return this.view(id);
    }
    if (pending) throw new GatewayError("CONFLICT", "Runtime operation is already in progress", 409);
    const manifest = this.manifests.get(id)!;
    manifest.operation = action; manifest.error = null;
    this.states.set(id, { operation: action, cancelable: action !== "uninstall", ...(action === "detect" ? { detection: "checking" } : action === "check" ? { updateStatus: "checking" } : action === "uninstall" ? { status: "uninstalling" } : { status: manifest.current ? "installed" : "installing", updateStatus: "downloading" }) });
    this.persist(id);
    const controller = new AbortController();
    const done = Promise.resolve().then(async () => {
      await rm(path.join(this.directory(id), "staging"), removeOptions);
      if (action === "detect") await this.detect(id, controller.signal);
      else if (action === "uninstall") await this.uninstall(id);
      else if (action === "check") await this.resolve(id, controller.signal);
      else await this.install(id, controller.signal);
    }).catch((error) => {
      const message = errorDetail(error, diagnosticSecrets(this.config));
      if (action === "check") manifest.checkError = message;
      else manifest.error = message;
    }).finally(async () => {
      await rm(path.join(this.directory(id), "staging"), removeOptions).catch(() => {});
      manifest.operation = null;
      this.states.delete(id); this.operations.delete(id); this.persist(id);
    });
    this.operations.set(id, { controller, done });
    return this.view(id);
  }
  async idle(id?: AgentId) { await Promise.all([...this.operations].filter(([key]) => !id || key === id).map(([, value]) => value.done)); }
  async close() {
    this.closed = true;
    for (const [id, operation] of this.operations) if (this.view(id).cancelable) operation.controller.abort(new Error("Gateway is shutting down"));
    await this.idle();
  }
  private npmSource(url: string) {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password &&
      ["https://registry.npmjs.org", new URL(this.config.npmRegistry).origin].includes(parsed.origin);
  }
  private async response(url: string, signal: AbortSignal, method = "GET", timeoutMs = 120000) {
    const parsed = new URL(url);
    if (!this.npmSource(url) && parsed.origin !== "https://storage.googleapis.com") throw new Error("Runtime source is not an allowed distribution URL");
    const response = await this.dependencies.fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]), method, redirect: "error" });
    if (!response.ok) throw new Error(`Runtime source returned HTTP ${response.status}${response.status === 404 ? "; no artifact is available for this platform" : ""}`);
    return response;
  }
  private async metadata(url: string, signal: AbortSignal) {
    const response = await this.response(url, signal);
    const reader = response.body!.getReader(); let size = 0; const chunks: Uint8Array[] = [];
    try { while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 4 * 1024 * 1024) throw new Error("Runtime metadata exceeded 4 MiB"); chunks.push(value); } }
    finally { await reader.cancel(); }
    return Buffer.concat(chunks).toString("utf8");
  }
  private async npmRelease(name: string, signal: AbortSignal, version = "latest") {
    const data = z.object({ version: stableVersion, dist: z.object({ tarball: z.url(), integrity: z.string().regex(/^sha512-[A-Za-z0-9+/]+=*$/) }) }).parse(JSON.parse(await this.metadata(`${this.config.npmRegistry}${name}/${version}`, signal)));
    if (!this.npmSource(data.dist.tarball)) throw new Error("Unexpected npm artifact source");
    return { version: data.version, source: data.dist.tarball, integrity: data.dist.integrity };
  }
  private async resolve(id: AgentId, signal: AbortSignal): Promise<Release> {
    if (!["darwin", "linux", "win32"].includes(process.platform) || !["x64", "arm64"].includes(process.arch)) throw new Error(`Unsupported platform: ${process.platform}-${process.arch}`);
    let release: Release;
    if (id === "grok") {
      const base = "https://storage.googleapis.com/grok-build-public-artifacts/cli";
      const version = stableVersion.parse((await this.metadata(`${base}/stable`, signal)).trim());
      const platform = `${{ darwin: "macos", linux: "linux", win32: "windows" }[process.platform as "linux"]}-${process.arch === "x64" ? "x86_64" : "aarch64"}`;
      const source = `${base}/grok-${version}-${platform}${process.platform === "win32" ? ".exe" : ""}`;
      const response = await this.response(source, signal, "HEAD");
      const md5 = response.headers.get("x-goog-hash")?.match(/(?:^|,\s*)md5=([A-Za-z0-9+/]+=*)/)?.[1];
      const generation = response.headers.get("x-goog-generation");
      if (!md5 || !generation || !/^\d+$/.test(generation)) throw new Error("Official Grok artifact has no integrity metadata");
      const bytes = Number(response.headers.get("content-length"));
      if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > maxDownload) throw new Error("Grok artifact exceeds download limit");
      release = { version, source: `${source}?generation=${generation}`, integrity: `md5-${md5}`, bytes };
    } else {
      release = await this.npmRelease(packages[id], signal);
      if (id === "opencode") release = await this.npmRelease(opencodePackage(), signal, release.version);
    }
    const manifest = this.manifests.get(id)!;
    manifest.latestVersion = release.version; manifest.checkedAt = timestamp(); manifest.checkError = null; this.persist(id);
    return release;
  }
  private async command(command: string, args: string[], directory: string, signal: AbortSignal, env: NodeJS.ProcessEnv = process.env, timeoutMs = 10 * 60 * 1000) {
    signal.throwIfAborted();
    const child = startProcess(command, args, directory, env);
    let output = "";
    child.stdout.on("data", (value) => { output = (output + String(value)).slice(-8192); });
    child.stderr.on("data", (value) => { output = (output + String(value)).slice(-8192); });
    const abort = () => { void stopProcess(child, 5000).catch(() => {}); };
    signal.addEventListener("abort", abort, { once: true });
    try {
      await within(new Promise<void>((resolve, reject) => { child.once("error", reject); child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`Runtime process failed (${code}): ${output}`))); }), timeoutMs);
      signal.throwIfAborted(); return output;
    } finally { signal.removeEventListener("abort", abort); await stopProcess(child, 5000); }
  }
  private async installFiles(id: AgentId, release: Release, directory: string, signal: AbortSignal) {
    if (this.dependencies.install) return this.dependencies.install(id, release, directory, signal);
    if (id === "grok") {
      const command = process.platform === "win32" ? "grok.exe" : "grok";
      const response = await this.response(release.source, signal, "GET", downloadTimeoutMs);
      const output = await open(path.join(directory, command), "wx", 0o700);
      const digest = createHash("md5"); let downloaded = 0;
      try {
        for await (const value of response.body!) {
          downloaded += value.length;
          if (downloaded > maxDownload || downloaded > release.bytes!) throw new Error("Runtime download exceeded declared size");
          digest.update(value); await output.write(value);
          this.states.set(id, { ...this.states.get(id), downloadedBytes: downloaded, totalBytes: release.bytes!, progress: 100 * downloaded / release.bytes! });
        }
      } finally { await output.close(); }
      if (downloaded !== release.bytes || `md5-${digest.digest("base64")}` !== release.integrity) throw new Error("Runtime integrity verification failed");
      await chmod(path.join(directory, command), 0o700); return command;
    }
    signal = AbortSignal.any([signal, AbortSignal.timeout(downloadTimeoutMs)]);
    const packageName = id === "opencode" ? opencodePackage() : packages[id];
    const dependencies: Record<string, string> = { [packageName]: release.version };
    if (id === "pi") {
      for (const name of ["pi-mcp-adapter", "typebox"]) dependencies[name] = (await this.npmRelease(name, signal)).version;
    }
    await writeFile(path.join(directory, "package.json"), JSON.stringify({ private: true, dependencies }));
    const npm = this.config.runtimeNpm || createRequire(import.meta.url).resolve("npm/bin/npm-cli.js");
    const env = { ...process.env, PATH: `${path.dirname(this.config.runtimeNode)}${path.delimiter}${process.env.PATH ?? ""}`, npm_config_cache: path.join(directory, ".npm-cache"), npm_config_userconfig: path.join(directory, ".npmrc"), npm_config_globalconfig: path.join(directory, ".npmrc-global"), npm_config_registry: this.config.npmRegistry, npm_config_update_notifier: "false", npm_config_ignore_scripts: "true" };
    await writeFile(env.npm_config_userconfig, `registry=${this.config.npmRegistry}\nignore-scripts=true\n`);
    await writeFile(env.npm_config_globalconfig, "");
    const args = [npm, "install", "--ignore-scripts", "--no-audit", "--no-fund", "--global=false", `--registry=${this.config.npmRegistry}`, `--fetch-timeout=${downloadTimeoutMs}`, "--cache", env.npm_config_cache, "--userconfig", env.npm_config_userconfig, "--globalconfig", env.npm_config_globalconfig, "--prefix", directory];
    await this.command(this.config.runtimeNode, [...args, "--package-lock-only"], directory, signal, env, downloadTimeoutMs);
    const lock = JSON.parse(await readFile(path.join(directory, "package-lock.json"), "utf8"));
    for (const [name, entry] of Object.entries(lock.packages) as [string, { version: string; resolved?: string; integrity?: string; inBundle?: boolean }][]) {
      if (!name) continue;
      // Bundled packages are covered by their enclosing package tarball's integrity.
      if (entry.inBundle && name.includes("/node_modules/")) continue;
      if (!entry.integrity && entry.resolved) {
        const dependency = await this.npmRelease(name.slice(name.lastIndexOf("node_modules/") + "node_modules/".length), signal, stableVersion.parse(entry.version));
        if (dependency.source !== entry.resolved) throw new Error(`Dependency source changed: ${name}`);
        entry.integrity = dependency.integrity;
      }
      if (!entry.resolved || !this.npmSource(entry.resolved) || !entry.integrity?.match(/^sha(?:512|256|1)-[A-Za-z0-9+/]+=*$/)) throw new Error(`Dependency lock contains an unverified distribution source: ${name}`);
    }
    if (lock.packages[`node_modules/${packageName}`]?.integrity !== release.integrity) throw new Error("npm artifact changed after latest resolution");
    await writeFile(path.join(directory, "package-lock.json"), JSON.stringify(lock));
    // ponytail: poll npm's bounded staging directory; use filesystem quotas when strict per-write quotas are required.
    const budget = new AbortController(); let monitoring = false;
    const timer = setInterval(() => {
      if (monitoring) return; monitoring = true;
      void directorySize(directory).catch((error) => budget.abort(error)).finally(() => { monitoring = false; });
    }, 500);
    try { await this.command(this.config.runtimeNode, [npm, "ci", ...args.slice(2)], directory, AbortSignal.any([signal, budget.signal]), env, downloadTimeoutMs); }
    finally { clearInterval(timer); }
    await rm(path.join(directory, ".npm-cache"), removeOptions);
    if (id === "opencode") {
      const command = path.join("node_modules", packageName, "bin", process.platform === "win32" ? "opencode.exe" : "opencode");
      if (!existsSync(path.join(directory, command))) throw new Error("Official OpenCode package is missing its platform binary");
      return command;
    }
    const command = path.join("node_modules", ".bin", id);
    if (!existsSync(path.join(directory, `${command}${process.platform === "win32" ? ".cmd" : ""}`))) throw new Error("Official package did not install a CLI for this platform");
    return `${command}${process.platform === "win32" ? ".cmd" : ""}`;
  }
  private async probe(id: AgentId, command: string, directory: string, signal: AbortSignal, expectedVersion: string, external = false) {
    if (this.dependencies.probe) return this.dependencies.probe(id, command, directory, signal);
    const probeDirectory = path.join(directory, ".probe"); await mkdir(probeDirectory, { recursive: true });
    const config = structuredClone(this.config); config.dataDirectory = probeDirectory;
    config.runtimeSources[id] = external ? { mode: "external", command } : { mode: "managed" };
    config[id].command = command;
    if (existsSync(path.join(this.config.dataDirectory, "settings.json"))) await cp(path.join(this.config.dataDirectory, "settings.json"), path.join(probeDirectory, "settings.json"));
    applyAgentConfiguration(config, id);
    const adapters = { pi: PiAdapter, opencode: OpenCodeAdapter, codex: CodexAdapter, grok: GrokAdapter };
    const adapter = new adapters[id](config);
    const version = await this.command(command, ["--version"], probeDirectory, signal);
    if (version.match(/\d+\.\d+\.\d+/)?.[0] !== expectedVersion) throw new Error("CLI version does not match the downloaded release");
    try {
      signal.throwIfAborted();
      await within(adapter.start(), config.limits.startupTimeoutMs);
      if (id === "pi") await within(adapter.createSession({ id: randomUUID(), engineId: id, title: "Protocol check", directory: probeDirectory, availability: "unavailable", interactionPolicy: { permission: "manual", question: "manual" }, createdAt: timestamp(), updatedAt: timestamp(), version: 1 }), config.limits.startupTimeoutMs);
      signal.throwIfAborted();
    } finally { await adapter.stop(); await rm(probeDirectory, removeOptions); }
  }
  private async install(id: AgentId, signal: AbortSignal) {
    const release = await this.resolve(id, signal);
    const manifest = this.manifests.get(id)!;
    const externalSource = !this.managed(id);
    if (manifest.operation === "update" && manifest.current?.version === release.version && this.installed(id)) return;
    const operation = randomUUID(); const directory = path.join(this.directory(id), "staging", operation);
    await mkdir(directory, { recursive: true });
    const disk = await statfs(directory);
    const freeBytes = this.dependencies.freeBytes ? await this.dependencies.freeBytes(directory) : disk.bavail * disk.bsize;
    const requiredBytes = release.bytes ? release.bytes + 64 * 1024 * 1024 : maxInstallation;
    if (freeBytes < requiredBytes) throw new Error(`At least ${Math.ceil(requiredBytes / 1024 / 1024)} MiB of free disk space is required to install this runtime`);
    const command = await this.installFiles(id, release, directory, signal);
    const destination = path.join(this.directory(id), "versions", operation);
    let size: number;
    try {
      // Move before executing the CLI: Windows can retain locks after a probe exits.
      await mkdir(path.dirname(destination), { recursive: true }); await renameDirectory(directory, destination);
      await this.probe(id, path.join(destination, command), destination, signal, release.version);
      size = await directorySize(destination); signal.throwIfAborted();
    } catch (error) {
      await rm(destination, removeOptions);
      throw error;
    }
    this.states.set(id, { ...this.states.get(id), cancelable: false, updateStatus: "switching", progress: 100 });
    const previous = manifest.current;
    if (externalSource) {
      manifest.current = { version: release.version, directory: operation, command, size, source: release.source, integrity: release.integrity };
      this.persist(id);
      for (const entry of await readdir(path.dirname(destination))) if (entry !== operation) await rm(path.join(path.dirname(destination), entry), removeOptions);
      return;
    }
    const backup = path.join(this.config.dataDirectory, "backups", id, operation);
    const native = agentDirectory(this.config, id); let snapshot = false;
    try { await this.hooks.switch(id, async () => {
      if (existsSync(native)) {
        const nativeSize = await directorySize(native);
        const disk = await statfs(native);
        if (disk.bavail * disk.bsize < nativeSize + 64 * 1024 * 1024) throw new Error("Insufficient disk space to back up native session state");
        await mkdir(path.dirname(backup), { recursive: true }); await cp(native, backup, { recursive: true }); snapshot = true;
      }
      manifest.rollback = { previous, directory: operation, snapshot, bindings: this.hooks.snapshotBindings?.(id) ?? [] }; this.persist(id);
      manifest.current = { version: release.version, directory: operation, command, size, source: release.source, integrity: release.integrity };
      this.persist(id); this.select(id);
    }, async () => {
      manifest.current = previous; this.persist(id); this.select(id);
      if (snapshot) { await rm(native, removeOptions); await cp(backup, native, { recursive: true }); }
      if (manifest.rollback) this.hooks.restoreBindings?.(id, manifest.rollback.bindings);
      manifest.rollback = null; this.persist(id);
    }, false); }
    catch (error) {
      if (!manifest.rollback) { await rm(destination, removeOptions); await rm(backup, removeOptions); }
      throw error;
    }
    manifest.rollback = null; manifest.uninstallPending = false; this.persist(id);
    await rm(backup, removeOptions);
    for (const entry of await readdir(path.dirname(destination))) if (entry !== operation) await rm(path.join(path.dirname(destination), entry), removeOptions);
  }
  private async uninstall(id: AgentId) {
    const manifest = this.manifests.get(id)!;
    await this.hooks.switch(id, async () => {
      manifest.uninstallPending = true; this.persist(id);
      await rm(path.join(this.directory(id), "versions"), removeOptions);
      await rm(path.join(this.config.dataDirectory, "backups", id), removeOptions);
      manifest.current = null; manifest.uninstallPending = false; this.persist(id); this.select(id);
    }, async () => {}, true);
  }
}
