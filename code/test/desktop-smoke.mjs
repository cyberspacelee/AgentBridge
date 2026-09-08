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
const artifactDirectory = path.join(code, "artifacts/desktop");
const env = Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined));
env.AGENT_DESKTOP_DATA_DIR = data;
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
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.waitForURL(/\/agents$/);
  await expect(page.getByRole("heading", { name: "Agent 管理", exact: true })).toBeVisible();
  const origin = new URL(page.url()).origin;
  const { storeId } = await page.evaluate(async () => (await fetch("/api/runtime")).json());
  assert.equal((await fetch(`${origin}/api/settings`)).status, 403);
  assert.equal((await fetch(`${origin}/api/events`)).status, 403);
  const runtime = await page.evaluate(async () => (await fetch("/api/runtimes")).json());
  assert.equal(runtime.runtimes.length, 4);
  assert.ok(runtime.runtimes.every((item) => item.managed && item.installedVersion === null));
  if (executable) {
    const resources = await realpath(path.resolve(path.dirname(executable), process.platform === "darwin" ? "../Resources" : "resources"));
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
    const events = new EventSource("/api/events");
    const timer = setTimeout(() => { events.close(); reject(new Error("SSE did not connect")); }, 5000);
    events.addEventListener("server.connected", () => { clearTimeout(timer); events.close(); resolve(true); });
    events.onerror = () => { clearTimeout(timer); events.close(); reject(new Error("SSE failed")); };
  })), true);
  await application.evaluate(({ dialog }, directory) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] });
  }, data);
  assert.equal(await page.evaluate(() => window.agentBridge.selectDirectory()), data);
  const initialNetwork = await page.evaluate(() => window.agentBridge.getNetworkSettings());
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
  const savedNetwork = await page.evaluate((input) => window.agentBridge.saveNetworkSettings(input), manualNetwork);
  assert.equal(savedNetwork.hasPassword, true);
  assert.equal(savedNetwork.restartRequired, true);
  assert.equal(Object.hasOwn(savedNetwork.settings, "proxyPassword"), false);
  assert.ok(!JSON.stringify(savedNetwork).includes(proxyPassword));
  const preservedNetwork = await page.evaluate((input) => window.agentBridge.saveNetworkSettings(input), savedNetwork.settings);
  assert.equal(preservedNetwork.hasPassword, true);
  const proxyResult = await page.evaluate(([input, url]) => window.agentBridge.testNetworkSettings(input, url), [savedNetwork.settings, "http://proxy-fixture.invalid/check"]);
  assert.equal(proxyResult.status, 207);
  assert.ok(Number.isFinite(proxyResult.durationMs) && proxyResult.durationMs >= 0);
  assert.ok(proxyRequests.some((request) => request.target.includes("proxy-fixture.invalid") && request.authorization === proxyAuthorization));
  const proxiedCount = proxyRequests.length;
  const directResult = await page.evaluate(([input, url]) => window.agentBridge.testNetworkSettings(input, url), [savedNetwork.settings, `http://127.0.0.1:${direct.address().port}/check`]);
  assert.equal(directResult.status, 204);
  assert.equal(proxyRequests.length, proxiedCount, "Loopback requests must bypass the configured proxy");
  await page.evaluate(() => localStorage.setItem("theme", "dark"));
  await expect.poll(async () => JSON.parse(await readFile(path.join(data, "desktop.json"), "utf8").catch(() => "{}")).theme).toBe("dark");
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
  application = await launch();
  const reopened = await application.firstWindow();
  await reopened.waitForURL(/\/agents$/);
  assert.equal(await reopened.evaluate(() => localStorage.getItem("theme")), "dark");
  assert.equal((await reopened.evaluate(async () => (await fetch("/api/runtime")).json())).storeId, storeId);
  const restoredNetwork = await reopened.evaluate(() => window.agentBridge.getNetworkSettings());
  assert.deepEqual(restoredNetwork.settings, savedNetwork.settings);
  assert.equal(restoredNetwork.hasPassword, true);
  assert.equal(restoredNetwork.restartRequired, false);
  assert.ok(!JSON.stringify(restoredNetwork).includes(proxyPassword));
  const restoredResult = await reopened.evaluate(([input, url]) => window.agentBridge.testNetworkSettings(input, url), [restoredNetwork.settings, "http://proxy-fixture.invalid/after-restart"]);
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
  const clearedNetwork = await reopened.evaluate((input) => window.agentBridge.saveNetworkSettings(input), { ...initialNetwork.settings, proxyPassword: "" });
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
