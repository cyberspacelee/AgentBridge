import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, readdir, readlink, realpath, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
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
  const inspectLinks = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        const target = await realpath(file);
        assert.ok(target === portable || target.startsWith(`${portable}${path.sep}`), `Packaged symlink escapes: ${file}`);
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
  await expect(page.getByRole("link", { name: "Agent 管理", exact: true })).toBeVisible();
  const origin = new URL(page.url()).origin;
  const { storeId } = await page.evaluate(async () => (await fetch("/api/runtime")).json());
  assert.equal((await fetch(`${origin}/api/settings`)).status, 403);
  assert.equal((await fetch(`${origin}/api/events`)).status, 403);
  const runtime = await page.evaluate(async () => (await fetch("/api/runtimes")).json());
  assert.equal(runtime.runtimes.length, 4);
  assert.ok(runtime.runtimes.every((item) => item.managed && item.installedVersion === null));
  if (executable && process.platform === "linux") {
    const resources = path.join(path.dirname(executable), "resources");
    const parentPid = application.process().pid;
    const children = (await readFile(`/proc/${parentPid}/task/${parentPid}/children`, "utf8")).trim().split(/\s+/);
    const programs = await Promise.all(children.map((pid) => readlink(`/proc/${pid}/exe`).catch(() => "")));
    assert.ok(programs.includes(path.join(resources, "node/bin/node")), "Gateway must use bundled Node");
    for (const name of ["fastify", "pino", "zod", "cross-spawn"]) {
      const dependency = await realpath(path.join(resources, "backend/node_modules", name));
      assert.ok(dependency.startsWith(`${resources}${path.sep}`), `${name} must resolve inside the relocated package`);
    }
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
  await application.close();
  application = undefined;
  console.log(`Desktop smoke passed (${executable ? "packaged" : "development"}); screenshots: ${artifactDirectory}`);
} finally {
  await application?.close();
  await rm(scratch, { recursive: true, force: true });
}
