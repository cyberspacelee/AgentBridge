import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  safeStorage,
  session,
  shell,
  Tray,
} from "electron";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { isWorkspaceUrl, externalUrl } from "./security.mjs";
import updater from "electron-updater";

app.setName("AgentBridge");
app.setPath(
  "userData",
  process.env.AGENT_DESKTOP_DATA_DIR
    ? path.resolve(process.env.AGENT_DESKTOP_DATA_DIR)
    : path.join(app.getPath("appData"), "AgentBridge"),
);
const dataDirectory = app.getPath("userData");
await mkdir(dataDirectory, { recursive: true });
const preferenceFile = path.join(dataDirectory, "desktop.json");
let preferences = {};
try {
  preferences = JSON.parse(await readFile(preferenceFile, "utf8"));
} catch {
  /* First launch or invalid non-critical preferences. */
}
nativeTheme.themeSource = ["system", "light", "dark"].includes(preferences?.theme)
  ? preferences.theme : "system";
// Native startup surface mirrors tokens.css; desktop smoke checks both themes.
const windowBackground = () => nativeTheme.shouldUseDarkColors ? "#202421" : "#fcfcfa";
nativeTheme.on("updated", () => {
  if (window && !window.isDestroyed()) window.setBackgroundColor(windowBackground());
});
let origin;
let supervisor;
let window;
let tray;
let quitting = false;
let promptOpen = false;
let installingUpdate = false;
let updateBusy = false;
let appliedNetwork;
let updateLogin;
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

const { Supervisor, atomicJson } = await import(pathToFileURL(path.join(path.dirname(backend), "../host/supervisor.mjs")).href);
const { networkEnvironment } = await import(pathToFileURL(path.join(path.dirname(backend), "../host/network.mjs")).href);

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
  await updater.autoUpdater.netSession.closeAllConnections();
  if (updateLogin) updater.autoUpdater.removeListener("login", updateLogin);
  updateLogin = (info, callback) => {
    const proxy = proxies.find((candidate) => candidate && info.isProxy &&
      candidate.hostname === info.host && Number(candidate.port || (candidate.protocol === "https:" ? 443 : 80)) === info.port);
    if (proxy) callback(decodeURIComponent(proxy.username), decodeURIComponent(proxy.password));
    else callback();
  };
  updater.autoUpdater.on("login", updateLogin);
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

let preferenceWrite = Promise.resolve();
function savePreferences(value) {
  const allowed = {};
  if (["system", "light", "dark"].includes(value?.theme)) allowed.theme = value.theme;
  if (["true", "false"].includes(value?.["agentbridge:sidebar-collapsed"]))
    allowed["agentbridge:sidebar-collapsed"] = value["agentbridge:sidebar-collapsed"];
  preferenceWrite = preferenceWrite.catch(() => {}).then(async () => {
    const next = { ...preferences, ...allowed };
    await atomicJson(preferenceFile, next);
    preferences = next;
    if (allowed.theme) nativeTheme.themeSource = allowed.theme;
  });
  return preferenceWrite;
}

async function openExternal(value) {
  const url = externalUrl(value);
  if (url && (new URL(url).origin !== origin || new URL(url).pathname === "/api/docs")) await shell.openExternal(url);
}

function showWindow() {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

async function requestQuit() {
  if (quitting || promptOpen) return;
  promptOpen = true;
  let drain = false;
  try {
    let busy = false;
    if (origin) {
      const response = await fetch(`${origin}/api/agents`, {
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
      showWindow();
    }
    if (supervisor?.child?.exitCode === null) await supervisor.stop(drain ? "wait" : "stop");
    else finishQuit();
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
      await supervisor?.kill();
      await supervisor?.release();
      finishQuit();
    }
  } finally {
    promptOpen = false;
  }
}

function finishQuit() {
  if (installingUpdate) updater.autoUpdater.quitAndInstall(false, true);
  else {
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
    backgroundColor: windowBackground(),
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
        ).catch((error) => dialog.showErrorBox("无法恢复工作台", error.message));
  });
  window.once("ready-to-show", showWindow);
  void window
    .loadURL(`${origin}/agents`)
    .catch((error) => dialog.showErrorBox("无法打开工作台", error.message));
}

async function launchBackend() {
  const secure = await safeStorage.isAsyncEncryptionAvailable() && (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text");
  supervisor = new Supervisor({
    node, args: [backend], directory: path.join(dataDirectory, "data"),
    protection: secure ? "os" : "file",
    encrypt: secure ? (value) => safeStorage.encryptStringAsync(value) : undefined,
    decrypt: async (value) => (await safeStorage.decryptStringAsync(value)).result,
    // Desktop selects the saved Agent; do not inherit a shell-only engine override.
    env: { AGENT_MANAGED_RUNTIMES: "true", AGENT_RUNTIME_NPM: npm, AGENT_ENGINE: undefined },
    onReady: (url) => {
      const changed = origin && origin !== url;
      origin = url;
      if (changed && window && !window.isDestroyed()) void window.loadURL(`${origin}/settings`);
    },
    onNetwork: async (settings) => { appliedNetwork = settings; await configureUpdateProxy(); },
    onExit: (code, closing) => {
      if (!closing) dialog.showErrorBox("AgentBridge 后台已停止", `退出状态：${code}`);
      quitting = true; finishQuit();
    },
    onError: (error) => dialog.showErrorBox("后台操作失败", error.message),
  });
  await supervisor.initialize();
  appliedNetwork = supervisor.applied;
  await configureUpdateProxy();
  origin = await supervisor.start();
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
  ipcMain.handle("desktop:initial", (event) => {
    if (!trusted(event)) throw new Error("Untrusted desktop request");
    return { version: app.getVersion(), preferences };
  });
  ipcMain.handle("desktop:preferences", async (event, value) => {
    if (!trusted(event)) throw new Error("Untrusted desktop request");
    await savePreferences(value);
  });
  ipcMain.handle("desktop:select-directory", async (event) => {
    if (!trusted(event)) throw new Error("Untrusted desktop request");
    const result = await dialog.showOpenDialog(window, {
      title: "选择工作目录",
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle("desktop:select-certificate", async (event) => {
    if (!trusted(event)) throw new Error("Untrusted desktop request");
    const result = await dialog.showOpenDialog(window, {
      title: "选择企业 CA 证书", properties: ["openFile"],
      filters: [{ name: "PEM 证书", extensions: ["pem", "crt", "cer"] }],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  void app.whenReady().then(async () => {
    try {
      updater.autoUpdater.on("error", () => {});
      await launchBackend();
      await createWindow();
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
      await supervisor?.kill();
      await supervisor?.release();
      dialog.showErrorBox("AgentBridge 启动失败", error.message);
      app.quit();
    }
  });
}
