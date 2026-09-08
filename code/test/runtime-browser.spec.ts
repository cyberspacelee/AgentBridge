import { test, expect, type Page } from "@playwright/test";
import { agentIds, type AgentView } from "../shared/settings.js";
import type { RuntimeAction, RuntimeView } from "../shared/runtimes.js";

function runtimeFixture(): RuntimeView {
  return {
    id: "pi", managed: true, usable: false, platform: "linux-x64",
    installedVersion: null, latestVersion: null, runningVersion: null,
    checkedAt: null, checkError: null, status: "not_installed",
    updateStatus: "idle", operation: null, cancelable: false,
    progress: null, downloadedBytes: 0, totalBytes: null, sizeBytes: null,
    error: null, source: null, integrity: null,
  };
}

async function runtimeRoutes(page: Page, runtime: RuntimeView) {
  await page.route("**/api/runtimes", (route) => route.fulfill({ json: {
    runtimes: agentIds.map((id) => ({ ...runtime, id })),
  } }));
  await page.route("**/api/agents", async (route) => {
    const response = await route.fetch();
    const body = await response.json() as { agents: AgentView[] };
    for (const agent of body.agents) {
      agent.enabled = false;
      agent.health.status = "disabled";
      agent.operation = null;
      agent.activeRuns = 1;
      agent.queuedRuns = 2;
    }
    await route.fulfill({ json: body });
  });
}

async function assertLayout(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const button of await page.getByRole("tab").all()) {
    const bounds = await button.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  }
}

test("managed CLI installs latest on demand, cancels, updates and confirms uninstall", async ({ page }, info) => {
  const runtime = runtimeFixture();
  const actions: RuntimeAction[] = [];
  let latest = "1.2.0", installs = 0, updates = 0, uninstalls = 0;
  await runtimeRoutes(page, runtime);
  await page.route("**/api/runtimes/pi/actions", async (route) => {
    const { action } = route.request().postDataJSON() as { action: RuntimeAction };
    actions.push(action);
    if (action === "check") {
      runtime.latestVersion = latest;
      runtime.checkedAt = "2026-09-08T08:00:00.000Z";
      runtime.updateStatus = latest === runtime.installedVersion ? "idle" : "available";
    } else if (action === "install" && installs++ === 0) {
      Object.assign(runtime, { status: "installing", updateStatus: "downloading", operation: "install", progress: 37, cancelable: true, downloadedBytes: 37000000, totalBytes: 100000000 });
    } else if (action === "cancel") {
      Object.assign(runtime, { status: "not_installed", updateStatus: "idle", operation: null, progress: null, cancelable: false });
    } else if (action === "install") {
      Object.assign(runtime, { status: "installed", usable: true, updateStatus: "idle", installedVersion: latest, sizeBytes: 100000000, operation: null, error: null });
    } else if (action === "update" && updates++ === 0) {
      Object.assign(runtime, { updateStatus: "failed", error: "新版协议不兼容，保留已安装版本" });
    } else if (action === "update") {
      Object.assign(runtime, { updateStatus: "switching", operation: "update", cancelable: false, error: null });
    } else if (action === "uninstall" && uninstalls++ === 0) {
      await route.fulfill({ status: 500, json: { code: "IO_ERROR", message: "程序文件暂时被占用" } });
      return;
    } else if (action === "uninstall") {
      Object.assign(runtime, { status: "uninstalling", usable: false, operation: "uninstall", error: null });
    }
    await route.fulfill({ status: 202, json: { runtime } });
  });
  await page.goto("/agents");
  await expect(page.getByRole("switch", { name: "启用 Pi", exact: true })).toBeDisabled();
  await page.screenshot({ path: info.outputPath("runtime-list.png"), fullPage: true });
  await page.getByRole("link", { name: "Pi", exact: true }).click();
  await page.getByRole("tab", { name: "安装与版本", exact: true }).click();
  const pane = page.getByRole("region", { name: "安装与版本", exact: true });
  const enable = page.getByRole("button", { name: "启用", exact: true });
  await expect(pane.getByText("1.2.0", { exact: true })).toBeVisible();
  await expect(enable).toBeDisabled();
  expect(actions).toEqual(["check"]);
  await pane.getByRole("button", { name: "安装最新版", exact: true }).click();
  await expect(pane.getByRole("progressbar")).toHaveAttribute("value", "37");
  await assertLayout(page);
  await page.screenshot({ path: info.outputPath("runtime-download.png"), fullPage: true });
  await pane.getByRole("button", { name: "取消下载", exact: true }).click();
  await expect(pane.getByRole("progressbar")).toHaveCount(0);
  await pane.getByRole("button", { name: "安装最新版", exact: true }).click();
  await expect(enable).toBeEnabled();
  await expect(pane.getByText("已是最新版", { exact: true })).toBeVisible();
  expect(actions.filter((action) => action === "check")).toHaveLength(1);
  latest = "1.3.0";
  await pane.getByRole("button", { name: "检查更新", exact: true }).click();
  await expect(pane.getByText("1.3.0", { exact: true })).toBeVisible();
  await pane.getByRole("button", { name: "更新到最新版", exact: true }).click();
  await expect(pane.getByText("新版协议不兼容，保留已安装版本")).toBeVisible();
  await expect(pane.getByText("1.2.0", { exact: true })).toBeVisible();
  await expect(enable).toBeEnabled();
  await pane.getByRole("button", { name: "更新到最新版", exact: true }).click();
  await expect(pane.getByRole("button", { name: "取消下载", exact: true })).toHaveCount(0);
  await expect(enable).toBeDisabled();
  Object.assign(runtime, { installedVersion: latest, operation: null, updateStatus: "idle" });
  await expect(enable).toBeEnabled();
  await pane.getByRole("button", { name: "卸载", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("保留模型配置、API Key、会话、任务历史和产物");
  await expect(dialog).toContainText("等待 1 个正在执行的任务及审批结束");
  await dialog.getByRole("button", { name: "卸载", exact: true }).click();
  await expect(dialog).toContainText("程序文件暂时被占用");
  await dialog.getByRole("button", { name: "卸载", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(enable).toBeDisabled();
  Object.assign(runtime, { status: "failed", operation: null, error: "删除失败，请重试卸载" });
  await expect(pane.getByText("删除失败，请重试卸载", { exact: true })).toBeVisible();
  await expect(enable).toBeDisabled();
  await pane.getByRole("button", { name: "卸载", exact: true }).click();
  await dialog.getByRole("button", { name: "卸载", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  Object.assign(runtime, { installedVersion: null, status: "not_installed", operation: null, sizeBytes: null });
  await expect(pane.getByRole("button", { name: "安装最新版", exact: true })).toBeEnabled();
  await expect(enable).toBeDisabled();
  await page.screenshot({ path: info.outputPath("runtime-uninstalled.png"), fullPage: true });
});

test("failed latest checks identify cached versions and host CLIs remain outside management", async ({ page }, info) => {
  const runtime = { ...runtimeFixture(), usable: true, installedVersion: "1.1.0", latestVersion: "1.1.0", checkedAt: "2026-09-07T08:00:00.000Z", status: "installed" as const };
  await runtimeRoutes(page, runtime);
  let checks = 0;
  await page.route("**/api/runtimes/pi/actions", (route) => {
    checks++;
    runtime.checkError = "无法连接官方更新源";
    return route.fulfill({ status: 202, json: { runtime } });
  });
  await page.goto("/agents/pi?tab=installation");
  await expect(page.getByText("1.1.0 · 缓存", { exact: true })).toBeVisible();
  await expect(page.getByText("已是最新版", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "启用", exact: true })).toBeEnabled();
  await assertLayout(page);
  await page.screenshot({ path: info.outputPath("runtime-offline.png"), fullPage: true });
  runtime.managed = false;
  runtime.checkError = null;
  await page.reload();
  await expect(page.getByText("主机 CLI", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "更新到最新版", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "卸载", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "启用", exact: true })).toBeEnabled();
  expect(checks).toBe(1);
});

test("desktop directory chooser fills paths and preserves them when cancelled", async ({ page }, info) => {
  await page.addInitScript(() => {
    let selections = 0;
    Object.assign(window, { agentBridge: { version: "test", selectDirectory: async () => selections++ % 2 ? null : "/workspace/项目" } });
  });
  await page.goto("/tasks");
  await page.getByRole("button", { name: "分派任务", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "选择目录", exact: true }).click();
  await expect(dialog.getByLabel("工作目录", { exact: true })).toHaveValue("/workspace/项目");
  await dialog.getByRole("button", { name: "选择目录", exact: true }).click();
  await expect(dialog.getByLabel("工作目录", { exact: true })).toHaveValue("/workspace/项目");
  await page.screenshot({ path: info.outputPath("desktop-directory.png"), fullPage: true });
  await page.goto("/agents/resources?tab=skills");
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await dialog.getByRole("button", { name: "选择目录", exact: true }).click();
  await expect(dialog.getByLabel("Skill 目录", { exact: true })).toHaveValue("/workspace/项目");
});

test("a runtime waiting for active tasks can be stopped explicitly", async ({ page }) => {
  const runtime = { ...runtimeFixture(), installedVersion: "1.0.0", usable: true, operation: "uninstall" as const, status: "uninstalling" as const };
  await runtimeRoutes(page, runtime);
  await page.route("**/api/agents", async (route) => {
    const response = await route.fetch();
    const body = await response.json() as { agents: AgentView[] };
    const agent = body.agents.find((agent) => agent.id === "pi")!;
    Object.assign(agent, { enabled: true, operation: "disable", activeRuns: 1 });
    await route.fulfill({ json: body });
  });
  let stopped = false;
  await page.route("**/api/agents/pi/actions", (route) => {
    expect(route.request().postDataJSON()).toEqual({ action: "stop" });
    stopped = true;
    return route.fulfill({ json: {} });
  });
  await page.goto("/agents/pi?tab=installation");
  await page.getByRole("button", { name: "立即停止", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("中断 1 个正在执行的任务");
  await dialog.getByRole("button", { name: "确认", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(stopped).toBe(true);
});
