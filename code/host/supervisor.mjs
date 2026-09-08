import { redactDiagnostic } from "./diagnostics.mjs";
import { StringDecoder } from "node:string_decoder";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomBytes } from "node:crypto";
import { access, mkdir, readFile, writeFile, appendFile, stat, rename, realpath, rm } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { networkInterfaces } from "node:os";
import { gatewaySchema, gatewayUrl, defaultGateway } from "./gateway.mjs";
import { defaultNetworkSettings, validateNetworkSettings, networkEnvironment } from "./network.mjs";

const revision = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const message = (error) => error instanceof Error ? error.message : String(error);
export async function atomicJson(filename, value) {
  await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  const temporary = `${filename}.${randomBytes(8).toString("hex")}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600, flag: "wx" });
  await rename(temporary, filename);
}
export async function findNpm(node, explicit = "") {
  const candidates = explicit ? [explicit] : [
    path.join(path.dirname(node), "node_modules/npm/bin/npm-cli.js"),
    path.resolve(path.dirname(node), "../lib/node_modules/npm/bin/npm-cli.js"),
    ...String(process.env.PATH ?? "").split(path.delimiter).map((entry) => path.join(entry, process.platform === "win32" ? "npm.cmd" : "npm")),
  ];
  for (let candidate of candidates) {
    try {
      candidate = await realpath(candidate);
      if (candidate.endsWith(".cmd")) candidate = path.join(path.dirname(candidate), "node_modules/npm/bin/npm-cli.js");
      await access(candidate, constants.R_OK);
      const { stdout } = await promisify(execFile)(node, [candidate, "--version"], { timeout: 10000, windowsHide: true });
      if (/^\d+\.\d+\.\d+\s*$/.test(stdout)) return candidate;
    } catch { /* Try the next standard Node/npm location. */ }
  }
  throw new Error("找不到可用的 npm。请安装 Node.js/npm 或设置 AGENT_RUNTIME_NPM 为 npm-cli.js 的绝对路径。");
}

async function lockDirectory(directory) {
  const filename = path.join(directory, ".host.lock");
  const id = randomBytes(16).toString("hex");
  const create = () => writeFile(filename, JSON.stringify({ pid: process.pid, id }), { flag: "wx", mode: 0o600 });
  try { await create(); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    const previous = JSON.parse(await readFile(filename, "utf8"));
    if (!Number.isSafeInteger(previous.pid) || previous.pid <= 1) throw new Error("实例锁损坏，请核对目录中的进程归属");
    let alive = true;
    try { process.kill(previous.pid, 0); } catch (error) { if (error.code === "ESRCH") alive = false; else throw error; }
    if (alive) throw new Error("此数据目录已有运行中的实例。请连接已有实例或选择另一个数据目录。");
    // Only remove the stale lock that was inspected; exclusive creation elects the next owner.
    if (JSON.parse(await readFile(filename, "utf8")).id !== previous.id) throw new Error("实例锁已改变，请重试");
    await rm(filename); await create();
  }
  return async () => {
    try { if (JSON.parse(await readFile(filename, "utf8")).id === id) await rm(filename); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  };
}

// The same owner supervises Node for the Web launcher and Electron main process.
export class Supervisor {
  child;
  url;
  closing = false;
  restarting = false;
  groups = new Set();
  settings = { ...defaultNetworkSettings, proxyPassword: "" };
  applied = this.settings;
  error = null;
  saving = false;
  testing = false;
  operation = null;
  forceTimer;
  /** @param {any} options */
  constructor(options) {
    this.options = options;
    this.node = options.node ?? process.execPath;
    this.directory = path.resolve(options.directory);
    this.filename = path.join(this.directory, "system.json");
    this.baseEnv = { ...process.env, ...options.env };
    if (this.baseEnv.NODE_EXTRA_CA_CERTS) this.baseEnv.NODE_EXTRA_CA_CERTS = path.resolve(options.cwd ?? process.cwd(), this.baseEnv.NODE_EXTRA_CA_CERTS);
    this.gatewayOverrides = {};
    if (this.baseEnv.AGENT_HOST !== undefined) this.gatewayOverrides.host = this.baseEnv.AGENT_HOST;
    if (this.baseEnv.AGENT_PORT !== undefined) this.gatewayOverrides.port = Number(this.baseEnv.AGENT_PORT);
    this.args = [];
    for (let i = 0; i < options.args.length; i++) {
      const argument = options.args[i];
      const match = /^--(host|port)(?:=(.*))?$/.exec(argument);
      if (!match) { this.args.push(argument); continue; }
      const value = match[2] ?? options.args[++i];
      this.gatewayOverrides[match[1]] = match[1] === "port" ? Number(value) : value;
    }
    this.gateway = gatewaySchema.parse({ ...defaultGateway, ...this.gatewayOverrides });
    this.appliedGateway = this.gateway;
  }
  async initialize() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    this.unlock = await lockDirectory(this.directory);
    const { stdout: nodeVersion } = await promisify(execFile)(this.node, ["-p", "process.versions.node"], { timeout: 10000, windowsHide: true });
    const [major, minor] = nodeVersion.trim().split(".").map(Number);
    if (!(major === 22 && minor >= 21 || major >= 24)) throw new Error("需要 Node.js >= 22.21（推荐项目打包使用的 Node.js 24）");
    this.baseEnv.AGENT_MANAGED_RUNTIMES ??= "true";
    this.npm = await findNpm(this.node, this.baseEnv.AGENT_RUNTIME_NPM);
    let stored;
    try { stored = JSON.parse(await readFile(this.filename, "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw new Error("系统配置损坏，原文件已保留，请从备份恢复。"); }
    if (stored !== undefined) {
      if (!stored || stored.schemaVersion !== 1 || !stored.network || !stored.appliedNetwork || typeof stored.applying !== "boolean" || !(stored.error === null || typeof stored.error === "string")) throw new Error("系统配置版本不受支持，原文件已保留。");
      this.gateway = gatewaySchema.parse({ ...this.gateway, ...stored.gateway, ...this.gatewayOverrides });
      this.appliedGateway = stored.applying ? gatewaySchema.parse({ ...this.gateway, ...stored.appliedGateway, ...this.gatewayOverrides }) : this.gateway;
      this.settings = await this.decode(stored.network);
      this.applied = await this.decode(stored.appliedNetwork);
      if (!stored.applying) {
        try { this.applied = validateNetworkSettings(this.settings); }
        catch { this.error = "保存的证书配置不可用，已保留此前生效的网络设置。请重新选择证书。"; }
      }
      this.error ??= stored.error ?? null;
      // Recover an interrupted application attempt before starting any Agent.
      if (stored.applying) this.error = "上次系统配置应用被中断，已恢复之前生效的配置；保存的设置仍可重试。";
    } else {
      this.applied = this.settings;
    }
    validateNetworkSettings(this.applied);
    await this.persist(false);
  }
  async decode(value) {
    const { encryptedPassword, ...plain } = value;
    if (encryptedPassword) {
      if (!this.options.decrypt) throw new Error("配置中的密码需要原桌面密钥存储解锁。请重新配置，不支持迁移加密文件。");
      plain.proxyPassword = await this.options.decrypt(Buffer.from(encryptedPassword, "base64"));
    }
    return validateNetworkSettings(plain, "", false);
  }
  async encode(value) {
    if (!value.proxyPassword || !this.options.encrypt) return value;
    const encrypted = await this.options.encrypt(value.proxyPassword);
    const { proxyPassword, ...plain } = value;
    return { ...plain, encryptedPassword: encrypted.toString("base64") };
  }
  async persist(applying) {
    await atomicJson(this.filename, { schemaVersion: 1, gateway: this.gateway, appliedGateway: this.appliedGateway, network: await this.encode(this.settings), appliedNetwork: await this.encode(this.applied), applying, error: this.error });
  }
  view() {
    const { proxyPassword, ...settings } = this.settings;
    return { settings, hasPassword: !!proxyPassword, revision: revision(this.settings), appliedRevision: revision(this.applied), restartRequired: revision(this.settings) !== revision(this.applied), protection: this.options.protection ?? "file", error: this.error };
  }
  gatewayView() {
    const hosts = this.appliedGateway.host === "0.0.0.0" || this.appliedGateway.host === "::"
      ? Object.values(networkInterfaces()).flat().filter((entry) => entry && !entry.internal && !entry.address.includes("%") && (this.appliedGateway.host === "::" || entry.family === "IPv4")).map((entry) => entry.address)
      : [];
    const port = this.url ? Number(new URL(this.url).port || 80) : this.appliedGateway.port;
    return { settings: this.gateway, appliedSettings: this.appliedGateway, revision: revision(this.gateway), appliedRevision: revision(this.appliedGateway), restartRequired: revision(this.gateway) !== revision(this.appliedGateway), url: this.url ?? null, urls: [...new Set([gatewayUrl(this.appliedGateway.host, port), ...hosts.map((host) => gatewayUrl(host, port))])], error: this.error };
  }
  async request(method, payload) {
    if (method === "gateway.get") return this.gatewayView();
    if (method === "gateway.save") {
      if (this.saving || this.operation) throw new Error("已有系统配置操作正在进行");
      if (payload.revision !== revision(this.gateway)) throw new Error("网关设置已被修改，请刷新后重试");
      this.saving = true;
      const previous = this.gateway;
      try {
        this.gateway = gatewaySchema.parse(payload.settings);
        await this.persist(false);
        return this.gatewayView();
      } catch (error) { this.gateway = previous; throw error; }
      finally { this.saving = false; }
    }
    if (method === "network.get") return this.view();
    if (method === "network.save") {
      if (this.saving || this.operation) throw new Error("已有系统配置操作正在进行");
      if (payload.revision !== revision(this.settings)) throw new Error("网络设置已被修改，请刷新后重试");
      this.saving = true;
      const previous = this.settings;
      try {
        this.settings = validateNetworkSettings(payload.settings, this.settings.proxyPassword);
        await this.persist(false);
        return this.view();
      } catch (error) { this.settings = previous; throw error; }
      finally { this.saving = false; }
    }
    if (method === "network.test") {
      if (this.testing) throw new Error("已有网络测试正在进行");
      const settings = validateNetworkSettings(payload.settings, this.settings.proxyPassword);
      const url = new URL(payload.url);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.href.length > 4096) throw new Error("测试地址无效");
      this.testing = true;
      try {
        const env = networkEnvironment(settings, this.baseEnv);
        for (const key of ["NODE_OPTIONS", "ELECTRON_RUN_AS_NODE"]) delete env[key];
        const script = `const start=Date.now();try{const r=await fetch(process.argv[1],{signal:AbortSignal.timeout(10000)});await r.body?.cancel();console.log(JSON.stringify({status:r.status,durationMs:Date.now()-start,scope:"gateway"}));}catch(e){console.log(JSON.stringify({error:e.cause?.code||e.code||e.name}));}`;
        const { stdout } = await promisify(execFile)(this.node, ["--input-type=module", "-e", script, url.href], { env, cwd: this.directory, timeout: 15000, maxBuffer: 16384, windowsHide: true });
        const result = JSON.parse(stdout);
        if (result.error) throw new Error(`连接失败（${result.error}），请检查代理、认证和证书。`);
        return result;
      } finally { this.testing = false; }
    }
    if (method === "lifecycle") {
      if (this.closing && this.operation === payload.action && payload.mode === "stop") {
        await this.stop("stop", payload.action === "restart");
        return { accepted: true };
      }
      if (this.operation || this.saving) throw new Error("已有生命周期操作正在进行");
      if (!["restart", "shutdown"].includes(payload.action) || !["wait", "stop"].includes(payload.mode)) throw new Error("无效的生命周期操作");
      this.operation = payload.action;
      setTimeout(() => void this.stop(payload.mode, payload.action === "restart").catch((error) => this.reportError(error)), 100);
      return { accepted: true };
    }
    throw new Error("Unsupported host operation");
  }
  async start() {
    this.closing = false;
    const env = {
      ...networkEnvironment(this.applied, this.baseEnv),
      AGENT_DATA_DIR: this.directory, AGENT_RUNTIME_NODE: this.node, AGENT_RUNTIME_NPM: this.npm,
      AGENT_SUPERVISED: "true", AGENT_HOST: this.appliedGateway.host, AGENT_PORT: String(this.appliedGateway.port),
    };
    if (this.url && this.appliedGateway.port === 0) env.AGENT_PORT = new URL(this.url).port || "80";
    delete env.NODE_OPTIONS; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(this.node, this.args, { env, cwd: this.options.cwd ?? this.directory, detached: process.platform !== "win32", windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
    this.child = child;
    let diagnostics = "";
    for (const stream of [child.stdout, child.stderr]) {
      const decoder = new StringDecoder("utf8");
      let pending = "", dropping = false;
      const output = (line) => {
        const value = redactDiagnostic(line, [this.applied.proxyPassword], this.baseEnv);
        diagnostics = (diagnostics + value).slice(-8192);
        this.options.onOutput?.(value, stream === child.stdout ? "stdout" : "stderr");
      };
      const consume = (text) => {
        for (const fragment of text.split(/(?<=\n)/)) {
          if (!dropping) pending += fragment;
          if (pending.length > 65536) { pending = ""; dropping = true; }
          if (fragment.endsWith("\n")) {
            output(dropping ? "[oversized diagnostic omitted]\n" : pending);
            pending = ""; dropping = false;
          }
        }
      };
      stream.on("data", (chunk) => consume(decoder.write(chunk)));
      stream.on("end", () => { consume(decoder.end()); if (pending || dropping) output(dropping ? "[oversized diagnostic omitted]\n" : pending); });
    }
    child.on("message", (input) => {
      if (input?.type === "engine-started" && Number.isSafeInteger(input.pid) && input.pid > 1) this.groups.add(input.pid);
      if (input?.type === "engine-exited") this.groups.delete(input.pid);
      if (input?.type === "host:request" && typeof input.id === "string" && input.id.length <= 100) {
        void this.request(input.method, input.payload).then(
          (value) => { if (child.connected) child.send({ type: "host:response", id: input.id, value }, () => {}); },
          (error) => { if (child.connected) child.send({ type: "host:response", id: input.id, error: message(error) }, () => {}); },
        );
      }
    });
    let ready = false;
    child.once("exit", (code) => {
      clearTimeout(this.forceTimer);
      const finalExit = ready && !this.restarting;
      void this.cleanup().finally(() => { if (finalExit) void this.release().finally(() => this.options.onExit?.(code ?? 1, this.closing)); });
    });
    this.url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { reject(new Error(`网关启动超时\n${diagnostics}`)); void this.kill(); }, 45000);
      child.once("error", (error) => { clearTimeout(timer); reject(error); });
      child.once("exit", () => { clearTimeout(timer); if (!ready) reject(Object.assign(new Error(`网关启动失败\n${diagnostics}`), { exitCode: child.exitCode ?? 1 })); });
      child.on("message", (input) => {
        if (input?.type !== "ready") return;
        let url;
        try { url = new URL(input.url); } catch { return; }
        if (url.origin !== gatewayUrl(this.appliedGateway.host, Number(url.port || 80))) return;
        ready = true; clearTimeout(timer); resolve(url.origin);
      });
    });
    this.options.onReady?.(this.url);
    return this.url;
  }
  async stop(mode = "stop", restart = false) {
    if (this.closing) {
      if (mode === "stop" && this.child?.connected) {
        this.child.send({ type: "shutdown" }, () => {});
        clearTimeout(this.forceTimer);
        this.forceTimer = setTimeout(() => void this.kill(), 20000);
      }
      return;
    }
    this.closing = true;
    this.restarting = restart;
    if (restart) {
      try { validateNetworkSettings(this.settings); await this.persist(true); }
      catch (error) { this.closing = false; this.restarting = false; this.operation = null; throw error; }
    }
    const child = this.child;
    if (child?.pid && child.exitCode === null && child.signalCode === null) {
      await new Promise((resolve) => {
        child.once("exit", resolve);
        if (child.connected) child.send({ type: mode === "wait" ? "drain" : "shutdown" }, () => {});
        else void this.kill();
        if (mode !== "wait") this.forceTimer = setTimeout(() => void this.kill(), 20000);
      });
    }
    await this.cleanup();
    if (!restart) { await this.release(); return; }
    const previous = this.applied;
    const previousGateway = this.appliedGateway;
    const previousUrl = this.url;
    if (revision(this.gateway) !== revision(this.appliedGateway)) this.url = undefined;
    this.appliedGateway = this.gateway;
    this.applied = this.settings;
    try {
      await this.options.onNetwork?.(this.applied);
      await this.start();
      this.error = null;
    } catch (error) {
      const failedChild = this.child;
      await this.kill();
      if (failedChild?.pid && failedChild.exitCode === null && failedChild.signalCode === null) await new Promise((resolve) => failedChild.once("exit", resolve));
      this.error = "新系统配置启动失败，已恢复之前生效的配置。请检查监听地址、端口占用和网络配置。";
      this.applied = previous;
      this.appliedGateway = previousGateway;
      this.url = previousUrl;
      try {
        await this.options.onNetwork?.(this.applied);
        await this.start();
      } catch (restoreError) {
        this.error = "服务恢复失败，请检查启动日志后重新启动实例。";
        await this.kill(); await this.release();
        this.options.onExit?.(1, false);
        throw restoreError;
      }
    } finally {
      this.operation = null; this.restarting = false;
      await this.persist(false);
    }
  }
  async reportError(error) {
    const detail = redactDiagnostic(message(error), [this.applied.proxyPassword], this.baseEnv);
    try {
      const filename = path.join(this.directory, "host.log");
      if ((await stat(filename).catch(() => null))?.size > 1024 * 1024) await rename(filename, filename + ".1");
      await appendFile(filename, `${new Date().toISOString()} ${detail}\n`, { mode: 0o600 });
    } catch { process.stderr.write("Host diagnostic write failed\n"); }
    this.options.onError?.(new Error(detail));
  }
  async release() { await this.unlock?.(); this.unlock = undefined; }
  async cleanup() {
    const groups = [...this.groups]; this.groups.clear();
    for (const pid of groups) {
      if (process.platform === "win32") await promisify(execFile)("taskkill", ["/pid", String(pid), "/T", "/F"], { windowsHide: true }).catch(() => {});
      else { try { process.kill(-pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") this.options.onError?.(error); } }
    }
  }
  async kill() {
    await this.cleanup();
    if (!this.child?.pid || this.child.exitCode !== null) return;
    if (process.platform === "win32") await promisify(execFile)("taskkill", ["/pid", String(this.child.pid), "/T", "/F"], { windowsHide: true }).catch(() => {});
    else { try { process.kill(-this.child.pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; } }
  }
}
