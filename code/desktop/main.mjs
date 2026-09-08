import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  safeStorage,
  session,
  shell,
  Tray,
} from "electron";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";
import { isWorkspaceUrl, externalUrl, authorizedHeaders } from "./security.mjs";
import updater from "electron-updater";
import { defaultNetworkSettings, validateNetworkSettings, networkEnvironment } from "./network.mjs";

app.setName("AgentBridge");
app.setPath(
  "userData",
  process.env.AGENT_DESKTOP_DATA_DIR
    ? path.resolve(process.env.AGENT_DESKTOP_DATA_DIR)
    : path.join(app.getPath("appData"), "AgentBridge"),
);
const dataDirectory = app.getPath("userData");
mkdirSync(dataDirectory, { recursive: true });
const preferenceFile = path.join(dataDirectory, "desktop.json");
let preferences = {};
try {
  preferences = JSON.parse(readFileSync(preferenceFile, "utf8"));
} catch {
  /* First launch or invalid non-critical preferences. */
}
const token = randomBytes(32).toString("hex");
let origin;
let child;
let window;
let tray;
let quitting = false;
let promptOpen = false;
let forcedExitTimer;
let installingUpdate = false;
let updateBusy = false;
let restarting = false;
let testingNetwork = false;
let networkSettings = { ...defaultNetworkSettings, proxyPassword: "" };
let appliedNetwork = networkSettings;
const networkFile = path.join(dataDirectory, "network.json");
const engineGroups = new Set();
const resources = app.isPackaged
  ? process.resourcesPath
  : path.resolve(import.meta.dirname, "../.desktop-stage");
const node =
  process.env.AGENT_RUNTIME_NODE ??
  path.join(
    resources,
    "node",
    process.platform === "win32" ? "node.exe" : "bin/node",
  );
const npm =
  process.env.AGENT_RUNTIME_NPM ??
  path.join(
    resources,
    "node",
    process.platform === "win32"
      ? "node_modules/npm/bin/npm-cli.js"
      : "lib/node_modules/npm/bin/npm-cli.js",
  );
const backend =
  process.env.AGENT_DESKTOP_BACKEND ??
  path.join(resources, "backend/dist/src/main.js");

function networkView() {
  const { proxyPassword, ...settings } = networkSettings;
  return {
    settings,
    hasPassword: Boolean(proxyPassword),
    restartRequired: JSON.stringify(networkSettings) !== JSON.stringify(appliedNetwork),
  };
}

function loadNetworkSettings() {
  if (!existsSync(networkFile)) return;
  const { encryptedPassword, ...stored } = JSON.parse(readFileSync(networkFile, "utf8"));
  if (encryptedPassword)
    stored.proxyPassword = safeStorage.decryptString(Buffer.from(encryptedPassword, "base64"));
  networkSettings = validateNetworkSettings(stored);
}

function saveNetworkSettings(input) {
  const next = validateNetworkSettings(input, networkSettings.proxyPassword);
  const stored = { ...next };
  if (next.proxyPassword && safeStorage.isEncryptionAvailable() &&
      (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text")) {
    stored.encryptedPassword = safeStorage.encryptString(next.proxyPassword).toString("base64");
    delete stored.proxyPassword;
  }
  // Match the private local storage used for provider credentials when no OS keyring is available.
  const temporary = `${networkFile}.tmp`;
  writeFileSync(temporary, JSON.stringify(stored, null, 2), { mode: 0o600 });
  renameSync(temporary, networkFile);
  networkSettings = next;
  return networkView();
}

async function configureUpdateProxy() {
  const env = networkEnvironment(appliedNetwork);
  const addresses = [env.http_proxy || env.HTTP_PROXY, env.https_proxy || env.HTTPS_PROXY]
    .map((address) => address || env.all_proxy || env.ALL_PROXY);
  const proxies = addresses.map((address) => address ? new URL(address) : null);
  const rules = proxies.map((proxy, i) => proxy ? `${i ? "https" : "http"}=${proxy.protocol}//${proxy.host}` : "").filter(Boolean);
  await updater.autoUpdater.netSession.setProxy({
    mode: rules.length ? "fixed_servers" : "direct",
    ...(rules.length ? { proxyRules: rules.join(";"), proxyBypassRules: env.NO_PROXY.replaceAll(",", ";") } : {}),
  });
  updater.autoUpdater.on("login", (info, callback) => {
    const proxy = proxies.find((candidate) => candidate && info.isProxy &&
      candidate.hostname === info.host && Number(candidate.port || (candidate.protocol === "https:" ? 443 : 80)) === info.port);
    if (proxy) callback(decodeURIComponent(proxy.username), decodeURIComponent(proxy.password));
    else callback();
  });
}

async function testNetworkSettings(input, target) {
  if (testingNetwork) throw new Error("已有网络测试正在进行");
  if (typeof target !== "string" || target.length > 4096) throw new Error("测试地址无效");
  let url;
  try { url = new URL(target); } catch { throw new Error("请输入有效的 HTTP 或 HTTPS 测试地址"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
    throw new Error("测试地址仅支持不含用户名和密码的 HTTP 或 HTTPS URL");
  const settings = validateNetworkSettings(input, networkSettings.proxyPassword);
  const env = networkEnvironment(settings);
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  delete env.AGENT_DESKTOP_TOKEN;
  testingNetwork = true;
  try {
    const script = `const start=Date.now();
try {
  const response=await fetch(process.argv[1],{signal:AbortSignal.timeout(10000)});
  await response.body?.cancel();
  console.log(JSON.stringify({status:response.status,durationMs:Date.now()-start}));
} catch(error) {
  console.log(JSON.stringify({error:error.cause?.code||error.code||error.name||"NETWORK_ERROR"}));
}`;
    const { stdout } = await promisify(execFile)(node, ["--input-type=module", "-e", script, url.href], {
      env, cwd: dataDirectory, windowsHide: true, timeout: 15000, maxBuffer: 16384,
    });
    const result = JSON.parse(stdout);
    if (result.error) throw new Error(`连接失败（${result.error}），请检查代理地址、认证信息或证书。`);
    return result;
  } finally { testingNetwork = false; }
}

function trusted(event) {
  return Boolean(
    window &&
    !window.isDestroyed() &&
    !window.webContents.isDestroyed() &&
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame &&
    isWorkspaceUrl(event.senderFrame.url, origin),
  );
}

function savePreferences(value) {
  const allowed = {};
  if (["system", "light", "dark"].includes(value?.theme))
    allowed.theme = value.theme;
  if (["true", "false"].includes(value?.["agentbridge:sidebar-collapsed"]))
    allowed["agentbridge:sidebar-collapsed"] =
      value["agentbridge:sidebar-collapsed"];
  preferences = allowed;
  try {
    writeFileSync(preferenceFile, JSON.stringify(allowed), { mode: 0o600 });
  } catch (error) {
    console.error("Could not save desktop preferences:", error.message);
  }
}

async function openExternal(value) {
  const url = externalUrl(value);
  if (url && new URL(url).origin !== origin) await shell.openExternal(url);
}

function showWindow() {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

async function forceStop() {
  if (process.platform === "win32") {
    const pids =
      child?.pid && child.exitCode === null ? [child.pid] : [...engineGroups];
    await Promise.all(
      pids.map(
        (pid) =>
          new Promise((resolve) => {
            const killer = spawn(
              "taskkill",
              ["/pid", String(pid), "/T", "/F"],
              {
                windowsHide: true,
              },
            );
            killer.once("error", resolve);
            killer.once("exit", resolve);
          }),
      ),
    );
    engineGroups.clear();
    return;
  } else {
    for (const pid of engineGroups) {
      try {
        process.kill(-pid, "SIGKILL");
      } catch (error) {
        if (error.code !== "ESRCH") console.error(error);
      }
    }
    engineGroups.clear();
  }
  if (!child?.pid || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch (error) {
    if (error.code !== "ESRCH") console.error(error);
  }
}

async function requestQuit() {
  if (quitting || promptOpen) return;
  promptOpen = true;
  let drain = false;
  try {
    let busy = false;
    if (origin) {
      const response = await fetch(`${origin}/api/agents`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(3000),
      });
      if (response.ok)
        busy = (await response.json()).agents.some(
          (agent) => agent.activeRuns || agent.queuedRuns,
        );
    }
    if (busy) {
      const result = await dialog.showMessageBox(window, {
        type: "question",
        title: "退出 AgentBridge",
        message: "还有任务正在执行",
        buttons: ["取消", "等待任务完成后退出", "停止任务并退出"],
        defaultId: 0,
        cancelId: 0,
      });
      if (result.response === 0) return;
      drain = result.response === 1;
    }
    quitting = true;
    if (drain) {
      tray?.setToolTip("AgentBridge - 等待任务完成");
      window?.hide();
    }
    if (child?.connected) {
      child.send({ type: drain ? "drain" : "shutdown" });
      if (!drain)
        forcedExitTimer = setTimeout(() => {
          void forceStop().finally(() => app.exit(1));
        }, 20000);
    } else finishQuit();
  } catch (error) {
    const result = await dialog.showMessageBox(window, {
      type: "warning",
      message: "无法确认后台状态",
      detail: error.message,
      buttons: ["取消", "退出"],
      cancelId: 0,
    });
    if (result.response === 1) {
      quitting = true;
      if (child?.connected) child.send({ type: "shutdown" });
      forcedExitTimer = setTimeout(() => {
        void forceStop().finally(() => app.exit(1));
      }, 20000);
      if (!child || child.exitCode !== null) finishQuit();
    }
  } finally {
    promptOpen = false;
  }
}

function finishQuit() {
  if (installingUpdate) updater.autoUpdater.quitAndInstall(false, true);
  else {
    if (restarting) app.relaunch();
    app.quit();
  }
}

async function checkForUpdates() {
  if (updateBusy || quitting) return;
  if (!app.isPackaged) {
    await dialog.showMessageBox(window, { message: "开发环境不检查应用更新" });
    return;
  }
  updateBusy = true;
  try {
    updater.autoUpdater.autoDownload = false;
    updater.autoUpdater.autoInstallOnAppQuit = false;
    const result = await updater.autoUpdater.checkForUpdates();
    if (!result?.isUpdateAvailable) {
      await dialog.showMessageBox(window, { message: "当前已是最新版本" });
      return;
    }
    const choice = await dialog.showMessageBox(window, {
      type: "question",
      message: `发现 AgentBridge ${result.updateInfo.version}`,
      buttons: ["稍后", "下载更新"],
      cancelId: 0,
    });
    if (choice.response !== 1) return;
    window.setProgressBar(0);
    const progress = ({ percent }) => window?.setProgressBar(percent / 100);
    updater.autoUpdater.on("download-progress", progress);
    try {
      await updater.autoUpdater.downloadUpdate();
    } finally {
      updater.autoUpdater.removeListener("download-progress", progress);
      window?.setProgressBar(-1);
    }
    const install = await dialog.showMessageBox(window, {
      message: "更新已下载",
      detail: "重启应用后生效，运行中的任务需要先结束。",
      buttons: ["稍后", "重启并安装"],
      cancelId: 0,
    });
    if (install.response === 1) {
      installingUpdate = true;
      await requestQuit();
      if (!quitting) installingUpdate = false;
    }
  } catch (error) {
    await dialog.showMessageBox(window, {
      type: "error",
      message: "应用更新失败",
      detail: error.message,
    });
  } finally {
    updateBusy = false;
  }
}

async function createWindow() {
  const isolated = session.fromPartition(
    `desktop-${randomBytes(8).toString("hex")}`,
  );
  await isolated.setProxy({ mode: "direct" });
  isolated.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false),
  );
  isolated.setPermissionCheckHandler(() => false);
  window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 760,
    minHeight: 560,
    show: false,
    title: "AgentBridge",
    backgroundColor: "#ffffff",
    webPreferences: {
      session: isolated,
      preload: path.join(import.meta.dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  isolated.webRequest.onBeforeSendHeaders((details, callback) => {
    const owned =
      !window.isDestroyed() &&
      !window.webContents.isDestroyed() &&
      details.webContentsId === window.webContents.id &&
      (details.resourceType === "mainFrame"
        ? isWorkspaceUrl(details.url, origin)
        : isWorkspaceUrl(window.webContents.getURL(), origin));
    callback({
      requestHeaders: authorizedHeaders(
        details.requestHeaders,
        details.url,
        origin,
        token,
        owned,
      ),
    });
  });
  isolated.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url);
    callback({
      cancel:
        ["http:", "https:"].includes(url.protocol) && url.origin !== origin,
    });
  });
  isolated.on("will-download", (_event, item) => {
    item.setSaveDialogOptions({ title: "保存交付物" });
    item.once("done", (_event, state) => {
      if (state === "interrupted")
        void dialog.showMessageBox(window, {
          type: "error",
          message: "下载未完成",
          detail: item.getFilename(),
        });
    });
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!isWorkspaceUrl(url, origin)) {
      event.preventDefault();
      void openExternal(url);
    }
  });
  window.webContents.on("will-redirect", (event, url) => {
    if (!isWorkspaceUrl(url, origin)) event.preventDefault();
  });
  window.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isWorkspaceUrl(url, origin)) void window.loadURL(url);
    else if (url.startsWith(`${origin}/api/artifacts/`))
      window.webContents.downloadURL(url);
    else void openExternal(url);
    return { action: "deny" };
  });
  window.on("close", (event) => {
    if (!quitting && tray) {
      event.preventDefault();
      window.hide();
    } else if (!quitting) {
      event.preventDefault();
      void requestQuit();
    }
  });
  window.webContents.on("render-process-gone", () => {
    if (!quitting)
      void dialog
        .showMessageBox({
          type: "error",
          message: "工作台页面已停止",
          buttons: ["重新打开", "退出"],
        })
        .then(({ response }) =>
          response === 0 ? window.loadURL(`${origin}/agents`) : requestQuit(),
        );
  });
  window.once("ready-to-show", showWindow);
  void window
    .loadURL(`${origin}/agents`)
    .catch((error) => dialog.showErrorBox("无法打开工作台", error.message));
}

async function launchBackend() {
  if (!existsSync(node) || !existsSync(backend) || !existsSync(npm))
    throw new Error(
      "桌面运行文件不完整，请重新安装或运行 pnpm desktop:prepare。",
    );
  const env = {
    ...networkEnvironment(appliedNetwork),
    AGENT_HOST: "127.0.0.1",
    AGENT_PORT: "0",
    AGENT_DATA_DIR: path.join(dataDirectory, "data"),
    AGENT_DESKTOP_TOKEN: token,
    AGENT_MANAGED_RUNTIMES: "true",
    AGENT_RUNTIME_NODE: node,
    AGENT_RUNTIME_NPM: npm,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  child = spawn(node, [backend], {
    env,
    cwd: dataDirectory,
    detached: process.platform !== "win32",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let diagnostics = "";
  for (const stream of [child.stdout, child.stderr])
    stream.on("data", (chunk) => {
      diagnostics = (
        diagnostics + chunk.toString().replaceAll(token, "[redacted]")
      ).slice(-8192);
    });
  child.on("message", (message) => {
    if (!Number.isSafeInteger(message?.pid) || message.pid <= 1) return;
    if (message.type === "engine-started") engineGroups.add(message.pid);
    if (message.type === "engine-exited") engineGroups.delete(message.pid);
  });
  child.once("exit", async (code) => {
    clearTimeout(forcedExitTimer);
    await forceStop();
    if (quitting) {
      finishQuit();
      return;
    }
    dialog.showErrorBox(
      "AgentBridge 后台已停止",
      `退出状态：${code ?? "未知"}\n${diagnostics}`,
    );
    quitting = true;
    app.quit();
  });
  origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`后台启动超时\n${diagnostics}`)),
      45000,
    );
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", () => {
      clearTimeout(timer);
      reject(new Error(`后台启动失败\n${diagnostics}`));
    });
    child.on("message", (message) => {
      if (message?.type === "ready" && typeof message.url === "string") {
        const url = new URL(message.url);
        if (
          url.protocol !== "http:" ||
          url.hostname !== "127.0.0.1" ||
          !url.port
        )
          return;
        clearTimeout(timer);
        resolve(url.origin);
      }
    });
  });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", showWindow);
  app.on("activate", showWindow);
  app.on("before-quit", (event) => {
    if (!quitting) {
      event.preventDefault();
      void requestQuit();
    }
  });
  ipcMain.on("desktop:initial", (event) => {
    event.returnValue = trusted(event)
      ? { version: app.getVersion(), preferences }
      : null;
  });
  ipcMain.on("desktop:preferences", (event, value) => {
    if (trusted(event)) savePreferences(value);
  });
  ipcMain.handle("desktop:select-directory", async (event) => {
    if (!trusted(event)) throw new Error("Untrusted desktop request");
    const result = await dialog.showOpenDialog(window, {
      title: "选择工作目录",
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle("desktop:network-get", (event) => {
    if (!trusted(event)) throw new Error("Untrusted desktop request");
    return networkView();
  });
  ipcMain.handle("desktop:network-save", (event, input) => {
    if (!trusted(event)) throw new Error("Untrusted desktop request");
    return saveNetworkSettings(input);
  });
  ipcMain.handle("desktop:network-test", (event, input, url) => {
    if (!trusted(event)) throw new Error("Untrusted desktop request");
    return testNetworkSettings(input, url);
  });
  ipcMain.handle("desktop:select-certificate", async (event) => {
    if (!trusted(event)) throw new Error("Untrusted desktop request");
    const result = await dialog.showOpenDialog(window, {
      title: "选择企业 CA 证书", properties: ["openFile"],
      filters: [{ name: "PEM 证书", extensions: ["pem", "crt", "cer"] }],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle("desktop:restart", async (event) => {
    if (!trusted(event)) throw new Error("Untrusted desktop request");
    if (quitting || promptOpen || updateBusy) return false;
    restarting = true;
    await requestQuit();
    if (!quitting) restarting = false;
    return quitting;
  });
  void app.whenReady().then(async () => {
    try {
      updater.autoUpdater.on("error", () => {});
      let networkError;
      try { loadNetworkSettings(); } catch {
        networkError = "保存的代理或证书配置无法读取，已临时使用环境设置。请在系统信息中的网络与代理重新配置。";
      }
      appliedNetwork = networkSettings;
      await configureUpdateProxy();
      await launchBackend();
      await createWindow();
      if (networkError) dialog.showErrorBox("网络配置需要修复", networkError);
      const iconFile = path.join(import.meta.dirname, "icon.png");
      if (existsSync(iconFile)) {
        tray = new Tray(
          nativeImage
            .createFromPath(iconFile)
            .resize({ width: 20, height: 20 }),
        );
        tray.setToolTip("AgentBridge");
        tray.setContextMenu(
          Menu.buildFromTemplate([
            { label: "打开 AgentBridge", click: showWindow },
            { type: "separator" },
            {
              label: "退出",
              click: () => {
                void requestQuit();
              },
            },
          ]),
        );
        tray.on("click", showWindow);
      }
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          {
            label: "AgentBridge",
            submenu: [
              { label: "打开工作台", click: showWindow },
              {
                label: "检查应用更新",
                click: () => {
                  void checkForUpdates();
                },
              },
              {
                label: "打开日志目录",
                click: () => {
                  void shell.openPath(path.join(dataDirectory, "data/logs"));
                },
              },
              { type: "separator" },
              {
                label: "退出",
                accelerator: "CmdOrCtrl+Q",
                click: () => {
                  void requestQuit();
                },
              },
            ],
          },
          {
            label: "编辑",
            submenu: [
              { role: "undo" },
              { role: "redo" },
              { type: "separator" },
              { role: "cut" },
              { role: "copy" },
              { role: "paste" },
              { role: "selectAll" },
            ],
          },
          {
            label: "视图",
            submenu: [
              { role: "reload" },
              { role: "resetZoom" },
              { role: "zoomIn" },
              { role: "zoomOut" },
              { role: "togglefullscreen" },
            ],
          },
        ]),
      );
    } catch (error) {
      quitting = true;
      await forceStop();
      dialog.showErrorBox("AgentBridge 启动失败", error.message);
      app.quit();
    }
  });
}
