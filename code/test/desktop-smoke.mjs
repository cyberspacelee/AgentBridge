import { navigate } from "./navigation.mjs";
import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, readdir, readlink, realpath, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { rootCertificates } from "node:tls";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { _electron, expect } from "@playwright/test";

const code = fileURLToPath(new URL("..", import.meta.url));
let executable = process.env.AGENT_DESKTOP_EXECUTABLE;
const scratch = await mkdtemp(path.join(process.env.AGENT_DESKTOP_TEST_TMPDIR ?? os.tmpdir(), "AgentBridge desktop smoke "));
const data = path.join(scratch, "user data");
await mkdir(data);
if (executable) {
  const source = process.platform === "darwin" ? path.resolve(executable, "../../..") : path.dirname(executable);
  const portable = path.join(scratch, "application");
  assert.ok(!portable.startsWith(`${code}${path.sep}`), "Portable smoke must run outside the source tree");
  await cp(source, portable, { recursive: true, verbatimSymlinks: true });
  const portableRoot = await realpath(portable);
  const inspectLinks = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        const target = await realpath(file);
        const relative = path.relative(portableRoot, target);
        assert.ok(relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), `Packaged symlink escapes: ${file}`);
      } else if (entry.isDirectory()) await inspectLinks(file);
    }
  };
  await inspectLinks(portable);
  executable = path.join(portable, path.relative(source, executable));
}
const artifactDirectory = process.env.AGENT_UI_ARTIFACT_DIR ?? path.join(code, "artifacts/desktop");
const env = Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined));
env.AGENT_DESKTOP_DATA_DIR = data;
env.AGENT_HOST = "127.0.0.1";
env.AGENT_PORT = "0";
env.AGENT_ENGINE = "grok"; // Desktop selection comes from settings, not a shell engine override.
if (!executable) {
  env.AGENT_RUNTIME_NODE = process.execPath;
  env.AGENT_RUNTIME_NPM ??= path.resolve(path.dirname(process.execPath), process.platform === "win32" ? "node_modules/npm/bin/npm-cli.js" : "../lib/node_modules/npm/bin/npm-cli.js");
  env.AGENT_DESKTOP_BACKEND = path.join(code, "dist/src/main.js");
} else {
  delete env.NODE_PATH;
  delete env.NODE_OPTIONS;
  delete env.AGENT_RUNTIME_NODE;
  delete env.AGENT_RUNTIME_NPM;
  delete env.AGENT_DESKTOP_BACKEND;
  env.PATH = process.platform === "win32" ? `${process.env.SystemRoot}\\System32` : "/usr/bin:/bin";
}
let application;
const networkServers = [];
const networkSockets = new Set();
const launch = () => _electron.launch({
  ...(executable ? { executablePath: executable } : {}),
  cwd: scratch,
  args: executable ? [] : [path.join(code, "desktop")],
  env,
  chromiumSandbox: process.env.AGENT_DESKTOP_TEST_NO_SANDBOX !== "1",
  timeout: 60000,
});
try {
  application = await launch();
  const page = await application.firstWindow();
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.waitForURL(/\/agents$/);
  await expect(page.getByRole("heading", { name: "Agent 管理", exact: true })).toBeVisible();
  await mkdir(artifactDirectory, { recursive: true });
  await expect(page.getByRole("contentinfo", { name: "桌面状态栏" })).toBeInViewport();
  for (const [label, theme] of [["浅色", "light"], ["深色", "dark"], ["跟随系统", "system"]]) {
    await page.getByRole("button", { name: "主题", exact: true }).click();
    await page.getByRole("menuitemradio", { name: label, exact: true }).click();
    await expect.poll(() => application.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe(theme);
    const dark = await application.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors);
    await expect(page.locator("html")).toHaveClass(dark ? /dark/ : /light/);
    const nativeBackground = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBackgroundColor());
    const rendererBackground = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--background").trim());
    assert.equal(nativeBackground.toLowerCase(), rendererBackground.toLowerCase());
    await page.screenshot({ path: path.join(artifactDirectory, `desktop-${theme}.png`) });
  }
  assert.equal(await page.locator("main").evaluate(el => getComputedStyle(el).scrollbarGutter), "stable both-edges");
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(760, 560));
  await expect(page.getByRole("contentinfo", { name: "桌面状态栏" })).toBeInViewport();
  await expect(page.getByRole("button", { name: "打开导航", exact: true })).toBeVisible();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: path.join(artifactDirectory, "desktop-minimum.png") });
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1280, 860));
  let origin = new URL(page.url()).origin;
  const { storeId, engine: defaultEngine } = await page.evaluate(async () => (await fetch("/api/runtime")).json());
  assert.equal(defaultEngine, "pi");
  assert.equal((await fetch(`${origin}/api/settings`)).status, 200);
  const stream = await fetch(`${origin}/event`);
  assert.equal(stream.status, 200);
  await stream.body.cancel();
  assert.match((await fetch(`${origin}/api/docs`)).headers.get("content-type"), /text\/html/);
  assert.ok((await (await fetch(`${origin}/api/openapi.json`)).json()).paths["/session/{id}/prompt_async"]);
  const runtime = await page.evaluate(async () => (await fetch("/api/runtimes")).json());
  assert.equal(runtime.runtimes.length, 4);
  assert.ok(runtime.runtimes.every((item) => item.managed && item.installedVersion === null));
  if (executable) {
    const resources = await realpath(path.resolve(path.dirname(executable), process.platform === "darwin" ? "../Resources" : "resources"));
    for (const name of ["Initialize-AgentBridge.ps1", "initialize.mjs", "initialize.example.json", "INSTRUCTION.md"])
      assert.ok((await readFile(path.join(resources, "initialization", name))).length, `Packaged initialization file is missing: ${name}`);
    const node = path.join(resources, process.platform === "win32" ? "node/node.exe" : "node/bin/node");
    if (process.platform === "linux") {
      const parentPid = application.process().pid;
      const children = (await readFile(`/proc/${parentPid}/task/${parentPid}/children`, "utf8")).trim().split(/\s+/);
      const programs = await Promise.all(children.map((pid) => readlink(`/proc/${pid}/exe`).catch(() => "")));
      assert.ok(programs.includes(node), "Gateway must use bundled Node");
    }
    for (const name of ["fastify", "pino", "zod", "cross-spawn", "which"]) {
      const dependency = await realpath(path.join(resources, "backend/node_modules", name));
      const relative = path.relative(resources, dependency);
      assert.ok(relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), `${name} must resolve inside the relocated package`);
    }
    const probe = "const r=require('node:module').createRequire(process.argv[1]); const child=r('cross-spawn').sync(process.execPath,['-e','process.stdout.write(\"spawn-ok\")'],{encoding:'utf8'}); if(child.error)throw child.error; if(child.status!==0)throw new Error(child.stderr); process.stdout.write(child.stdout)";
    assert.equal(execFileSync(node, ["-e", probe, path.join(resources, "backend/package.json")], { cwd: scratch, env, encoding: "utf8", timeout: 10000 }), "spawn-ok");
    for (const name of ["opencode-ai", "@earendil-works/pi-coding-agent", "@openai/codex", "pi-mcp-adapter"]) {
      assert.equal(existsSync(path.join(resources, "backend/node_modules", name)), false, `${name} must be installed on demand`);
    }
  }
  assert.equal(await page.evaluate(() => typeof window.require), "undefined");
  assert.equal(await page.evaluate(() => typeof window.process), "undefined");
  assert.equal(await page.evaluate(() => typeof window.agentBridge?.selectDirectory), "function");
  const preferences = await application.evaluate(({ BrowserWindow }) => {
    const prefs = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return { sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation, nodeIntegration: prefs.nodeIntegration };
  });
  assert.deepEqual(preferences, { sandbox: true, contextIsolation: true, nodeIntegration: false });
  assert.equal(await page.evaluate(() => new Promise((resolve, reject) => {
    const events = new EventSource("/event");
    const timer = setTimeout(() => { events.close(); reject(new Error("SSE did not connect")); }, 5000);
    events.onmessage = (event) => { if (JSON.parse(event.data).type === "server.connected") { clearTimeout(timer); events.close(); resolve(true); } };
    events.onerror = () => { clearTimeout(timer); events.close(); reject(new Error("SSE failed")); };
  })), true);
  await application.evaluate(({ dialog }, directory) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
  }, data);
  assert.equal(await page.evaluate(() => window.agentBridge.selectDirectory()), data);
  const beforeRestart = await page.evaluate(async () => (await fetch("/api/runtime")).json());
  assert.equal(await page.evaluate(async () => (await fetch("/api/system/lifecycle", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "restart", mode: "wait" }) })).status), 202);
  await expect.poll(async () => page.evaluate(async (previous) => {
    try { return (await (await fetch("/api/runtime")).json()).instanceId; } catch { return previous; }
  }, beforeRestart.instanceId), { timeout: 15000 }).not.toBe(beforeRestart.instanceId);
  await expect.poll(async () => page.evaluate(async () => {
    try { return (await (await fetch("/api/runtime")).json()).storeId; } catch { return null; }
  }), { timeout: 15000 }).toBe(storeId);
  assert.equal(new URL(page.url()).origin, origin, "Backend restart must preserve the renderer origin");
  await expect(page.getByLabel("网关事件连接：live", { exact: true })).toBeVisible({ timeout: 15000 });
  const listener = createServer();
  await new Promise((resolve) => listener.listen(0, "0.0.0.0", resolve));
  const gatewayPort = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(900, 800));
  await expect(page.getByRole("button", { name: "打开导航", exact: true })).toBeVisible();
  await navigate(page, "系统信息");
  const gatewayPanel = page.getByRole("region", { name: "网关服务", exact: true });
  await gatewayPanel.getByLabel("监听地址", { exact: true }).fill("0.0.0.0");
  await gatewayPanel.getByLabel("网关端口", { exact: true }).fill(String(gatewayPort));
  await gatewayPanel.getByRole("button", { name: "保存网关设置", exact: true }).click();
  await expect(gatewayPanel.getByText(/网关设置已保存/)).toBeVisible();
  await gatewayPanel.getByRole("button", { name: "重启网关", exact: true }).click();
  await page.getByRole("button", { name: "等待任务完成后重启", exact: true }).click();
  origin = `http://127.0.0.1:${gatewayPort}`;
  await page.waitForURL(`${origin}/settings`);
  await expect(page.getByRole("heading", { name: "系统信息", exact: true })).toBeVisible();
  assert.equal((await (await fetch(`${origin}/api/runtime`)).json()).storeId, storeId);
  const gateway = await (await fetch(`${origin}/api/system/gateway`)).json();
  assert.deepEqual(gateway.appliedSettings, { host: "0.0.0.0", port: gatewayPort });
  for (const address of Object.values(os.networkInterfaces()).flat()) {
    if (address?.family === "IPv4" && !address.internal) assert.equal((await fetch(`http://${address.address}:${gatewayPort}/api/settings`)).status, 200);
  }
  const initialNetwork = await page.evaluate(async () => (await fetch("/api/system/network")).json());
  const proxyRequests = [];
  const proxyPassword = "desktop-smoke-secret:@/";
  const proxyAuthorization = `Basic ${Buffer.from(`smoke-user:${proxyPassword}`).toString("base64")}`;
  const proxy = createServer((request, response) => {
    proxyRequests.push({ target: request.url, authorization: request.headers["proxy-authorization"] });
    const authorized = request.headers["proxy-authorization"] === proxyAuthorization;
    response.writeHead(authorized ? 207 : 407, authorized ? {} : { "Proxy-Authenticate": 'Basic realm="proxy"' });
    response.end("proxy");
  });
  proxy.on("connect", (request, socket) => {
    proxyRequests.push({ target: request.url, authorization: request.headers["proxy-authorization"] });
    if (request.headers["proxy-authorization"] !== proxyAuthorization) {
      socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="proxy"\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    socket.once("data", () => socket.end("HTTP/1.1 207 Multi-Status\r\nContent-Length: 5\r\nConnection: close\r\n\r\nproxy"));
  });
  const direct = createServer((_request, response) => { response.writeHead(204); response.end(); });
  for (const server of [proxy, direct]) {
    networkServers.push(server);
    server.on("connection", (socket) => {
      networkSockets.add(socket);
      socket.on("error", () => {});
      socket.on("close", () => networkSockets.delete(socket));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  }
  const caFile = path.join(scratch, "test CA.pem");
  await writeFile(caFile, rootCertificates[0]);
  await application.evaluate(({ dialog }, filename) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filename] });
  }, caFile);
  assert.equal(await page.evaluate(() => window.agentBridge.selectCertificate()), caFile);
  const manualNetwork = {
    ...initialNetwork.settings,
    mode: "manual",
    proxyUrl: `http://127.0.0.1:${proxy.address().port}`,
    proxyUsername: "smoke-user",
    proxyPassword,
    noProxy: "",
    caFile,
  };
  const savedNetwork = await page.evaluate(async (input) => {
    const current = await (await fetch("/api/system/network")).json();
    const response = await fetch("/api/system/network", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ settings: input, revision: current.revision }) });
    return response.json();
  }, manualNetwork);
  assert.equal(savedNetwork.hasPassword, true);
  assert.equal(savedNetwork.restartRequired, true);
  assert.equal(Object.hasOwn(savedNetwork.settings, "proxyPassword"), false);
  assert.ok(!JSON.stringify(savedNetwork).includes(proxyPassword));
  const preservedNetwork = await page.evaluate(async (input) => {
    const current = await (await fetch("/api/system/network")).json();
    const response = await fetch("/api/system/network", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ settings: input, revision: current.revision }) });
    return response.json();
  }, savedNetwork.settings);
  assert.equal(preservedNetwork.hasPassword, true);
  const proxyResult = await page.evaluate(async ([settings, url]) => (await fetch("/api/system/network/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ settings, url }) })).json(), [savedNetwork.settings, "http://proxy-fixture.invalid/check"]);
  assert.equal(proxyResult.status, 207);
  assert.ok(Number.isFinite(proxyResult.durationMs) && proxyResult.durationMs >= 0);
  assert.ok(proxyRequests.some((request) => request.target.includes("proxy-fixture.invalid") && request.authorization === proxyAuthorization));
  const proxiedCount = proxyRequests.length;
  const directResult = await page.evaluate(async ([settings, url]) => (await fetch("/api/system/network/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ settings, url }) })).json(), [savedNetwork.settings, `http://127.0.0.1:${direct.address().port}/check`]);
  assert.equal(directResult.status, 204);
  assert.equal(proxyRequests.length, proxiedCount, "Loopback requests must bypass the configured proxy");
  await page.evaluate(async () => { localStorage.setItem("theme", "dark"); await window.agentBridge.savePreferences({ theme: "dark" }); });
  await expect.poll(async () => JSON.parse(await readFile(path.join(data, "desktop.json"), "utf8").catch(() => "{}")).theme).toBe("dark");
  await navigate(page, "Agent 管理");
  await page.getByRole("link", { name: "Pi", exact: true }).click();
  await page.getByRole("tab", { name: "安装与版本", exact: true }).click();
  await expect(page.getByRole("button", { name: "安装最新版", exact: true })).toBeVisible();
  await mkdir(artifactDirectory, { recursive: true });
  await page.screenshot({ path: path.join(artifactDirectory, executable ? "packaged-runtime.png" : "runtime.png"), fullPage: true });
  const beforeNavigation = page.url();
  await page.evaluate(() => { location.href = "data:text/html,<h1>untrusted</h1>"; });
  await page.waitForTimeout(150);
  assert.equal(page.url(), beforeNavigation);
  assert.equal(application.windows().length, 1);
  assert.deepEqual(errors, []);
  if (existsSync(path.join(code, "desktop/icon.png")) || executable) {
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
    assert.equal((await page.evaluate(async () => (await fetch("/health/live")).json())).ok, true);
  }
  await application.close();
  application = undefined;
  await assert.rejects(fetch(`${origin}/health/live`));
  delete env.AGENT_HOST;
  delete env.AGENT_PORT;
  application = await launch();
  const reopened = await application.firstWindow();
  await reopened.waitForURL(/\/agents$/);
  assert.equal(new URL(reopened.url()).origin, origin, "Saved gateway port must survive a full desktop restart");
  assert.equal(await reopened.evaluate(() => localStorage.getItem("theme")), "dark");
  assert.equal((await reopened.evaluate(async () => (await fetch("/api/runtime")).json())).storeId, storeId);
  const restoredNetwork = await reopened.evaluate(async () => (await fetch("/api/system/network")).json());
  assert.deepEqual(restoredNetwork.settings, savedNetwork.settings);
  assert.equal(restoredNetwork.hasPassword, true);
  assert.equal(restoredNetwork.restartRequired, false);
  assert.ok(!JSON.stringify(restoredNetwork).includes(proxyPassword));
  const restoredResult = await reopened.evaluate(async ([settings, url]) => (await fetch("/api/system/network/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ settings, url }) })).json(), [restoredNetwork.settings, "http://proxy-fixture.invalid/after-restart"]);
  assert.equal(restoredResult.status, 207, "Saved proxy credentials must still authenticate after restart");
  const updaterNetwork = await application.evaluate(async ({ app }) => {
    const createRequire = process.getBuiltinModule("node:module").createRequire;
    const require = createRequire(`${app.getAppPath()}/package.json`);
    const updater = require("electron-updater").autoUpdater;
    const { CancellationToken } = createRequire(require.resolve("electron-updater"))("builder-util-runtime");
    const cancellation = new CancellationToken();
    const timer = setTimeout(() => cancellation.cancel(), 8000);
    try {
      return {
        proxy: await updater.netSession.resolveProxy("https://proxy-fixture.invalid/check"),
        loopback: await updater.netSession.resolveProxy("http://localhost/check"),
        body: await updater.httpExecutor.request({ protocol: "http:", hostname: "proxy-fixture.invalid", path: "/updater-check", method: "GET", timeout: 5000 }, cancellation),
      };
    } finally { clearTimeout(timer); }
  });
  assert.equal(updaterNetwork.proxy, `PROXY 127.0.0.1:${proxy.address().port}`);
  assert.equal(updaterNetwork.loopback, "DIRECT");
  assert.equal(updaterNetwork.body, "proxy");
  const updaterRequests = proxyRequests.filter((request) => request.target.includes("/updater-check"));
  assert.ok(updaterRequests.some((request) => !request.authorization), "Updater must receive the proxy authentication challenge");
  assert.ok(updaterRequests.some((request) => request.authorization === proxyAuthorization), "Updater must answer the proxy challenge with saved credentials");
  const clearedNetwork = await reopened.evaluate(async (input) => {
    const current = await (await fetch("/api/system/network")).json();
    const response = await fetch("/api/system/network", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ settings: input, revision: current.revision }) });
    return response.json();
  }, { ...initialNetwork.settings, proxyPassword: "" });
  assert.equal(clearedNetwork.hasPassword, false);
  assert.equal(clearedNetwork.restartRequired, true);
  await application.close();
  application = undefined;
  console.log(`Desktop smoke passed (${executable ? "packaged" : "development"}); screenshots: ${artifactDirectory}`);
} finally {
  await application?.close();
  for (const socket of networkSockets) socket.destroy();
  await Promise.all(networkServers.map((server) => new Promise((resolve) => server.close(resolve))));
  await rm(scratch, { recursive: true, force: true });
}
