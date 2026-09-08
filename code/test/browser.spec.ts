import { navigate } from "./navigation.mjs";
import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { settingsSchema } from "../shared/settings.js";

test("Agent resources, assignment, configuration apply and enable state persist", async ({
  page,
  request,
}, info) => {
  const suffix = info.project.name,
    provider = `compatible-${suffix}`;
  await page.goto("/agents/resources");
  await page.getByRole("button", { name: "添加", exact: true }).click();
  const editor = page.getByRole("dialog");
  await editor.getByLabel("资源标识", { exact: true }).fill(provider);
  await editor
    .getByLabel("Base URL", { exact: true })
    .fill("http://127.0.0.1:8888/v1");
  await editor.getByLabel("API Key", { exact: true }).fill("browser-secret");
  await editor.getByLabel("模型 ID", { exact: true }).fill("model-one");
  await editor.getByRole("button", { name: "添加模型", exact: true }).click();
  await editor
    .getByRole("group", { name: "模型 2", exact: true })
    .getByLabel("模型 ID", { exact: true })
    .fill("model-two");
  await captureQa(page, `agents-model-form-${suffix}`);
  await editor.getByRole("button", { name: "保存配置", exact: true }).click();
  await expect(editor).not.toBeVisible();
  await page.route(`**/api/providers/${provider}/test`, (route) => {
    expect(route.request().postDataJSON().modelID).toBe("model-two");
    return route.fulfill({ json: { ok: true, durationMs: 7, modelID: "model-two" } });
  });
  await page.getByRole("combobox", { name: `测试模型 ${provider}`, exact: true }).click();
  await page.getByRole("option", { name: "model-two", exact: true }).click();
  await page.getByRole("button", { name: `测试连接 ${provider}`, exact: true }).click();
  await expect(page.getByText("model-two · 连接成功 · 7 ms", { exact: true })).toBeVisible();
  expect(await (await request.get("/api/settings")).text()).not.toContain(
    "browser-secret",
  );
  await page
    .getByRole("button", { name: `编辑 ${provider}`, exact: true })
    .click();
  await expect(editor.getByLabel("API Key", { exact: true })).toHaveValue(
    "********",
  );
  await editor.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("tab", { name: "Skills", exact: true }).click();
  await page.getByRole("button", { name: "添加", exact: true }).click();
  const { directory } = await (await request.get("/__test/directory")).json();
  await editor.getByLabel("资源标识", { exact: true }).fill(`office-${suffix}`);
  await editor.getByLabel("服务器 Skill 目录", { exact: true }).fill(directory);
  await editor.getByRole("button", { name: "保存配置", exact: true }).click();
  await expect(editor).not.toBeVisible();
  await page.getByRole("tab", { name: "MCP", exact: true }).click();
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await editor.getByLabel("资源标识", { exact: true }).fill(`mcp-${suffix}`);
  await editor.getByLabel("服务器命令", { exact: true }).fill("node");
  await editor.getByRole("button", { name: "添加参数", exact: true }).click();
  await editor.getByLabel("参数 1", { exact: true }).fill("server.mjs");
  await editor.getByRole("button", { name: "添加环境变量", exact: true }).click();
  await editor.getByLabel("键名 1", { exact: true }).fill("TOKEN");
  await editor.getByLabel("值 1", { exact: true }).fill("mcp-secret");
  await editor.getByRole("button", { name: "保存配置", exact: true }).click();
  await expect(editor).not.toBeVisible();
  await navigate(page, "Agent 管理");
  await page.getByRole("link", { name: "Grok Build", exact: true }).click();
  await page.getByRole("tab", { name: "模型", exact: true }).click();
  await page
    .getByRole("checkbox", { name: `${provider} model-one`, exact: true })
    .check();
  await page.getByRole("tab", { name: "Skills", exact: true }).click();
  await page
    .getByRole("checkbox", { name: new RegExp(`office-${suffix}`) })
    .check();
  await page.getByRole("tab", { name: "MCP", exact: true }).click();
  await page
    .getByRole("checkbox", { name: new RegExp(`mcp-${suffix}`) })
    .check();
  await page.getByRole("button", { name: "保存配置", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "应用配置", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "应用配置", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "应用配置", exact: true }),
  ).toBeDisabled();
  await page.getByRole("tab", { name: "运行", exact: true }).click();
  await captureQa(page, `agents-runtime-${suffix}`);
  await page.getByRole("button", { name: "停用", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "启用", exact: true }),
  ).toBeEnabled();
  await page.reload();
  await expect(page.getByText("已停用", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "启用", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "停用", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("navigation", { name: "Agent 管理" })
    .getByRole("link", { name: "全部 Agents", exact: true })
    .click();
  await captureQa(page, `agents-list-${suffix}`);
});

function designFixture() {
  const at = "2026-09-06T06:00:00.000Z";
  const run = {
    id: "design-run",
    sessionId: "design-fixture",
    submissionId: "sample",
    sequence: 1,
    inputParts: [{ type: "text", text: "测试样本：分析网关运行情况" }],
    model: { providerID: "sample", modelID: "gateway-model" },
    state: "completed",
    acceptedAt: at,
    startedAt: at,
    finishedAt: "2026-09-06T06:00:04.000Z",
    usage: null,
    error: null,
    traceId: "trace-sample",
  };
  return {
    task: {
      id: "design-fixture",
      title: "网关运行检查 · 测试样本",
      directory: "C:/workspace/企业网关/" + "long-path-".repeat(20),
      engineId: "pi",
      interactionPolicy: { permission: "manual", question: "manual" },
      availability: "ready",
      createdAt: at,
      updatedAt: at,
      status: "completed",
      queuedCount: 0,
      lastRun: run,
    },
    runs: [run],
    messages: [
      {
        id: "answer",
        sessionId: "design-fixture",
        runId: run.id,
        role: "assistant",
        created_at: at,
        completedAt: at,
        info: { finish: "stop" },
        parts: [
          {
            id: "text",
            type: "text",
            content: '# 网关检查结果\n\n已完成检查，**需要处理一项异常**。\n\n| 服务 | 状态 |\n| --- | --- |\n| 文档处理 | 就绪 |\n| 搜索服务 | 连接超时 |\n\n- [x] 检查连接\n- [ ] 处理超时\n\n```json\n{"status": "degraded"}\n```\n\n[公开参考](https://example.com) [危险链接](javascript:alert(1)) ![外部图片](https://example.com/tracking.png)\n\n<script>window.hacked=true</script>',
          },
          {
            id: "tool",
            type: "tool",
            toolCallId: "call-sample",
            tool: "search",
            input: { path: "C:/workspace/report.json" },
            output: "连接超时：上游搜索服务没有响应。",
            state: { status: "failed", title: "search" },
            startedAt: at,
            finishedAt: "2026-09-06T06:00:04.000Z",
          },
          { id: "step", type: "step-finish", reason: "stop", usage: null },
        ],
      },
    ],
    interactions: [] as Record<string, unknown>[],
    artifacts: [
      {
        id: "file-sample",
        sessionId: "design-fixture",
        runId: run.id,
        displayName: "report.md",
        relativePath: "report.md",
        mediaType: "text/markdown",
        sizeBytes: 128,
        availability: "changed",
        validation: "passed",
        modifiedAt: at,
        registeredAt: at,
        digest: "sample",
      },
    ],
  };
}

async function mockTask(page: Page, detail: ReturnType<typeof designFixture>) {
  await page.route("**/api/tasks/design-fixture", (route) =>
    route.fulfill({ json: { detail } }),
  );
  await page.goto("/conversations/design-fixture");
  await expect(
    page.getByRole("heading", { name: detail.task.title }),
  ).toBeVisible();
}

async function observationTab(page: Page, name: string) {
  const select = page.getByRole("combobox", { name: "观测视图" });
  if (await select.isVisible()) {
    await select.click();
    await page.getByRole("option", { name, exact: true }).click();
  } else await page.getByRole("tab", { name, exact: true }).click();
}
async function theme(page: Page, name: string) {
  await page.getByRole("button", { name: "主题", exact: true }).click();
  await page.getByRole("menuitemradio", { name, exact: true }).click();
}

async function captureQa(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  if ((page.viewportSize()?.width ?? 1440) < 768) {
    const undersized = await page
      .locator('[class~="group/button"]:visible')
      .evaluateAll((elements) =>
        elements
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            return rect.width < 43.5 || rect.height < 43.5;
          })
          .map(
            (element) =>
              element.getAttribute("aria-label") || element.textContent,
          ),
      );
    expect(undersized).toEqual([]);
  }
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await expect.poll(() => page
    .locator(
      'header button:visible, main button:visible, main [role="combobox"]:visible, [role="dialog"] button:visible, [role="alertdialog"] button:visible',
    )
    .evaluateAll((elements) =>
      elements
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.left < -1 || rect.right > innerWidth + 1;
        })
        .map(
          (element) =>
            element.getAttribute("aria-label") || element.textContent,
        ),
    )).toEqual([]);
  const directory = process.env.AGENT_UI_ARTIFACT_DIR ?? "artifacts/ui/qa";
  await mkdir(directory, { recursive: true });
  await page.screenshot({
    path: `${directory}/${name}.png`,
    animations: "disabled",
  });
  if (
    !(await page.getByRole("listbox").isVisible()) &&
    !(await page.getByRole("dialog").isVisible()) &&
    (await page.evaluate(
      () => document.documentElement.scrollHeight > innerHeight + 1,
    ))
  )
    await page.screenshot({
      path: `${directory}/${name}-full.png`,
      fullPage: true,
      animations: "disabled",
    });
}

test("sidebar toggles, persists, centers icons and supports mobile navigation", async ({
  page,
}, info) => {
  await page.goto("/conversations");
  await expect(page.getByRole("heading", { name: "开始一段新的工作" })).toBeVisible();
  if (info.project.name === "desktop") {
    const shell = page.locator(".app-shell");
    await page.getByRole("button", { name: "收起侧边栏" }).click();
    await expect(shell).toHaveAttribute("data-collapsed", "true");
    const link = page
      .locator(".app-sidebar")
      .getByRole("link", { name: "运行观测", exact: true });
    const bounds = await link.boundingBox();
    const icon = await link.locator("svg").boundingBox();
    expect(
      Math.abs(bounds!.x + bounds!.width / 2 - icon!.x - icon!.width / 2),
    ).toBeLessThan(1);
    await link.hover();
    await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText(
      "运行观测",
    );
    await captureQa(page, "sidebar-collapsed");
    await link.click();
    await page.reload();
    await expect(shell).toHaveAttribute("data-collapsed", "true");
    await page.getByRole("button", { name: "展开侧边栏" }).click();
    await expect(shell).toHaveAttribute("data-collapsed", "false");
    await page.setViewportSize({ width: 1024, height: 1000 });
    await expect(
      page.getByRole("button", { name: "收起侧边栏" }),
    ).toBeVisible();
    await captureQa(page, "sidebar-expanded-1024");
    await page.setViewportSize({ width: 1920, height: 1000 });
    const main = await page.locator("main").boundingBox();
    const content = await page.locator(".page").boundingBox();
    expect(
      Math.abs(main!.x + main!.width / 2 - content!.x - content!.width / 2),
    ).toBeLessThan(1);
  }
  await page.setViewportSize({ width: 375, height: 844 });
  await page.getByRole("button", { name: "打开导航" }).click();
  await captureQa(page, `navigation-${info.project.name}`);
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "运行观测", exact: true })
    .click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page).toHaveURL(/observability/);
});

test("task list search, history, filters, pagination, empty state and create form", async ({
  page,
}, info) => {
  const task = designFixture().task;
  await page.route(/\/api\/tasks(?:\?.*)?$/, (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const params = new URL(route.request().url()).searchParams;
    const empty =
      params.get("q") === "不存在" || params.get("status") === "failed";
    return route.fulfill({
      json: {
        items: empty
          ? []
          : [
              {
                ...task,
                title: params.get("cursor") === "third" ? "第三页任务" : params.has("cursor") ? "第二页任务" : task.title,
              },
            ],
        nextCursor: empty || params.get("cursor") === "third" ? null : params.has("cursor") ? "third" : "next",
      },
    });
  });
  await page.goto("/conversations");
  await navigate(page, "历史会话");
  const search = page.getByRole("textbox", { name: "搜索会话" });
  await search.fill("不存在");
  await search.press("Enter");
  await expect(page.getByRole("navigation", { name: "会话列表", exact: true }).getByText("没有符合条件的会话")).toBeVisible();
  await captureQa(page, `tasks-empty-${info.project.name}`);
  await search.fill("网关");
  await search.press("Enter");
  await expect(
    page.getByRole("link", { name: task.title, exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(search).toHaveValue("不存在");
  await page.goForward();
  await expect(search).toHaveValue("网关");
  const input = await search.boundingBox();
  const icon = await page
    .locator('.conversation-history:visible [data-slot="input-group"] svg')
    .boundingBox();
  expect(
    Math.abs(input!.y + input!.height / 2 - icon!.y - icon!.height / 2),
  ).toBeLessThan(1);
  await page.getByRole("button", { name: "下一页" }).click();
  await expect(
    page.getByRole("link", { name: "第二页任务", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "下一页" }).click();
  await expect(page.getByRole("link", { name: "第三页任务", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "上一页" }).click();
  await expect(page.getByRole("link", { name: "第二页任务", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "上一页" }).click();
  await page.getByRole("combobox", { name: "会话状态" }).click();
  await page.getByRole("option", { name: "失败", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "会话列表", exact: true }).getByText("没有符合条件的会话")).toBeVisible();
  await navigate(page, "新会话");
  await page.getByRole("button", { name: "模型与会话设置", exact: true }).click();
  const dialog = page.getByRole("form", { name: "新会话" });
  await captureQa(page, `create-${info.project.name}`);
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(dialog).toBeVisible();
  expect(
    await dialog.locator("input:invalid, textarea:invalid").count(),
  ).toBeGreaterThan(0);
  await dialog.getByLabel("服务器工作目录", { exact: true }).fill("/tmp");
  await dialog.getByLabel("消息", { exact: true }).fill("检查");
  await dialog
    .getByLabel("服务器工作目录", { exact: true })
    .fill("/__qa_missing_directory__");
  await dialog.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(dialog.locator('[role="alert"]')).toBeVisible();
  await captureQa(page, `create-invalid-${info.project.name}`);
  await expect(dialog.getByLabel("消息", { exact: true })).toHaveValue("检查");
});

test("history has usable space on short windows and restores scroll after details", async ({ page }, info) => {
  await page.setViewportSize(info.project.name === "mobile" ? { width: 390, height: 640 } : { width: 1280, height: 560 });
  const detail = designFixture();
  await page.route("**/api/tasks/design-fixture", route => route.fulfill({ json: { detail } }));
  await page.route("**/api/tasks?*", route => route.fulfill({ json: {
    items: Array.from({ length: 20 }, (_, i) => ({ ...detail.task, id: i === 19 ? detail.task.id : `task-${i}`, title: `历史会话 ${i} · 检查网关运行情况和修复长标题布局` })), nextCursor: "next",
  }}));
  await page.goto("/conversations/history?q=网关&status=completed");
  const history = page.locator(".conversation-history");
  const viewport = history.locator('[data-slot="scroll-area-viewport"]');
  await expect(history.locator(".conversation-link")).toHaveCount(20);
  expect((await viewport.boundingBox())!.height).toBeGreaterThanOrEqual(160);
  await viewport.evaluate(element => element.scrollTop = element.scrollHeight);
  const top = await viewport.evaluate(element => element.scrollTop);
  await history.locator(".conversation-link").last().click();
  await expect(page.getByRole("heading", { name: detail.task.title, exact: true })).toBeVisible();
  await page.locator(".back-link").click();
  await expect(page).toHaveURL(/conversations\/history\?q=.*status=completed/);
  await expect.poll(() => viewport.evaluate(element => element.scrollTop)).toBe(top);
  await expect(page.getByRole("textbox", { name: "搜索会话" })).toHaveValue("网关");
  await expect(page.locator(".app-sidebar .conversation-link")).toHaveCount(0);
  await captureQa(page, `conversation-history-${info.project.name}`);
});

test("conversation URLs load directly and legacy task URLs preserve context", async ({ page, request }) => {
  for (const path of ["/conversations", "/conversations/history?q=test", "/conversations/design-fixture", "/tasks"]) {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/html");
  }
  expect((await request.get("/conversations-other")).status()).toBe(404);
  expect((await request.get("/api/conversations")).status()).toBe(404);
  await page.goto("/tasks?q=日期&status=completed");
  await expect(page).toHaveURL(/\/conversations\/history\?q=.*status=completed/);
  await page.route("**/api/tasks/design-fixture", route => route.fulfill({ json: { detail: designFixture() } }));
  await page.goto("/tasks/design-fixture?tab=diagnostics#detail");
  await expect(page).toHaveURL(/\/conversations\/design-fixture\?tab=diagnostics#detail$/);
  await expect(page.getByRole("heading", { name: designFixture().task.title })).toBeVisible();
});

test("first-run setup has a coherent heading and separate action", async ({ page }, info) => {
  await page.route("**/api/runtime", async route => {
    const response = await route.fetch();
    const data = await response.json();
    for (const engine of data.engines) { engine.enabled = false; engine.health.status = "disabled"; }
    await route.fulfill({ json: data });
  });
  await page.goto("/conversations");
  await expect(page.getByRole("heading", { name: "连接你的第一个 Agent" })).toBeVisible();
  const action = page.getByRole("link", { name: "配置 Agent", exact: true });
  await expect(action).toBeInViewport();
  await expect(page.getByRole("form", { name: "新会话" })).toHaveCount(0);
  await captureQa(page, `conversation-onboarding-${info.project.name}`);
  await action.click();
  await expect(page).toHaveURL(/\/agents$/);
});

test("empty task and observation lists fill the remaining workspace", async ({
  page,
}, info) => {
  if (info.project.name === "mobile")
    await page.setViewportSize({ width: 320, height: 640 });
  const detail = designFixture();
  detail.artifacts = [];
  await mockTask(page, detail);
  for (const [tab, text] of [
    ["交付物", "暂无交付物"],
    ["交互", "没有交互请求"],
  ]) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    const empty = page
      .getByText(text, { exact: true })
      .locator('xpath=ancestor::*[@data-slot="empty"]');
    await expect(empty).toBeVisible();
    const sizes = await empty.evaluate((element) => ({
      height: element.clientHeight,
      parent: element.parentElement!.clientHeight,
      bottom: element.getBoundingClientRect().bottom,
      viewport: innerHeight,
      page: document.documentElement.scrollHeight,
    }));
    expect(sizes.height).toBeGreaterThan(sizes.parent - 2);
    expect(sizes.bottom).toBeLessThanOrEqual(sizes.viewport + 1);
    expect(sizes.page).toBeLessThanOrEqual(sizes.viewport + 1);
    await captureQa(
      page,
      `empty-${tab === "交付物" ? "artifacts" : "interactions"}-${info.project.name}`,
    );
  }
  await page.route("**/api/observability/overview?*", async (route) => {
    const data = await (await route.fetch()).json();
    await route.fulfill({
      json: { ...data, tools: [], toolCalls: 0, toolErrors: 0 },
    });
  });
  await page.route("**/api/observability/errors?*", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  for (const tab of ["errors", "tools"]) {
    await page.goto(`/observability?tab=${tab}`);
    const empty = page.locator('.list-body > [data-slot="empty"]');
    await expect(empty).toBeVisible();
    await empty.scrollIntoViewIfNeeded();
    const sizes = await empty.evaluate((element) => ({
      height: element.clientHeight,
      parent: element.parentElement!.clientHeight,
      bottom: element.getBoundingClientRect().bottom,
      viewport: innerHeight,
    }));
    expect(sizes.height).toBeGreaterThan(sizes.parent - 2);
    expect(sizes.bottom).toBeLessThanOrEqual(sizes.viewport + 1);
    await captureQa(page, `empty-${tab}-${info.project.name}`);
  }
});

test("task creation selects engine, provider and model with loading and failure states", async ({
  page,
  request,
}, info) => {
  const { directory } = await (await request.get("/__test/directory")).json();
  await page.goto("/conversations");
  await page.getByRole("button", { name: "模型与会话设置", exact: true }).click();
  const dialog = page.getByRole("form", { name: "新会话" });
  const choose = async (label: string, option: string) => {
    await dialog.getByRole("combobox", { name: label, exact: true }).click();
    await page.getByRole("option", { name: option, exact: true }).click();
  };
  await choose("模型供应商", "pi-secondary");
  await choose("模型名称", "pi secondary quality");
  let mode = "error";
  await page.route("**/api/engines/opencode/models", async (route) => {
    if (mode === "error")
      return route.fulfill({
        status: 503,
        json: { code: "SERVICE_UNAVAILABLE", message: "Catalog unavailable" },
      });
    if (mode === "empty") return route.fulfill({ json: { models: [] } });
    return route.continue();
  });
  await choose("Agent", "OpenCode");
  await expect(dialog.getByRole("alert")).toContainText("Catalog unavailable");
  await expect(
    dialog.getByRole("button", { name: "发送消息", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("combobox", { name: "模型供应商", exact: true }),
  ).not.toContainText("pi-secondary");
  mode = "empty";
  await dialog.getByRole("button", { name: "重新加载模型" }).click();
  await expect(
    dialog.getByText("此引擎尚未配置可用模型或供应商凭据。"),
  ).toBeVisible();
  await captureQa(page, `model-empty-${info.project.name}`);
  mode = "ok";
  await choose("Agent", "Pi · 默认");
  await choose("Agent", "OpenCode");
  await choose("模型供应商", "opencode-secondary");
  await choose("模型名称", "opencode secondary quality");
  await captureQa(page, `engine-model-selection-${info.project.name}`);
  await dialog.getByLabel("服务器工作目录", { exact: true }).fill(directory);
  await dialog
    .getByLabel("消息", { exact: true })
    .fill("model selection QA");
  const submitted = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith("/api/tasks"),
  );
  await dialog.getByRole("button", { name: "发送消息", exact: true }).click();
  const payload = (await submitted).postDataJSON();
  expect(payload.engineId).toBe("opencode");
  expect(payload.model).toEqual({
    providerID: "opencode-secondary",
    modelID: "quality",
  });
  await expect(page).toHaveURL(/\/conversations\/[a-f0-9-]+/);
  const id = new URL(page.url()).pathname.split("/").at(-1)!;
  await expect
    .poll(
      async () =>
        (await (await request.get(`/api/tasks/${id}`)).json()).detail.task
          .status,
    )
    .toBe("completed");
  await request.delete(`/session/${id}`);
});

test("observation engine selection isolates requests and does not retain another engine snapshot", async ({
  page,
}, info) => {
  const seen: string[] = [];
  await page.route("**/api/observability/**", async (route) => {
    const url = new URL(route.request().url());
    const engine = url.searchParams.get("engine");
    seen.push(`${url.pathname}:${engine}`);
    if (url.pathname.endsWith("overview")) {
      const response = await route.fetch();
      const data = await response.json();
      return route.fulfill({
        json: { ...data, completed: engine === "pi" ? 7 : 13 },
      });
    }
    return route.continue();
  });
  await page.goto("/observability?engine=pi&window=15");
  const select = page.getByRole("combobox", { name: "观测引擎" });
  await expect(select).toContainText("Pi");
  await expect(
    page.getByText("完成 7 / 失败 0", { exact: true }),
  ).toBeVisible();
  await select.click();
  await expect(
    page.getByRole("option", { name: "OpenCode", exact: true }),
  ).toBeVisible();
  await captureQa(page, `engine-select-${info.project.name}`);
  await page.getByRole("option", { name: "OpenCode", exact: true }).click();
  await expect(page).toHaveURL(/engine=opencode/);
  await expect(
    page.getByText("完成 13 / 失败 0", { exact: true }),
  ).toBeVisible();
  await observationTab(page, "异常与调用链");
  await expect(page.getByText("该时间范围内暂无错误")).toBeVisible();
  expect(seen).toContain("/api/observability/overview:opencode");
  expect(seen).toContain("/api/observability/series:opencode");
  expect(seen).toContain("/api/observability/errors:opencode");
  await page.reload();
  await expect(select).toContainText("OpenCode");
  await observationTab(page, "引擎与资源");
  await expect(page.getByText("就绪", { exact: true }).first()).toBeVisible();
  await captureQa(page, `engine-connected-${info.project.name}`);
  await observationTab(page, "运行概览");
  await page.route("**/api/observability/overview?engine=pi&*", (route) =>
    route.fulfill({
      status: 503,
      json: { code: "QA_OFFLINE", message: "Pi 数据读取失败" },
    }),
  );
  await select.click();
  await page.getByRole("option", { name: "Pi", exact: true }).click();
  await expect(page.getByText("Pi 数据读取失败", { exact: true })).toBeVisible();
  await expect(page.getByText("完成 13 / 失败 0", { exact: true })).toHaveCount(
    0,
  );
  await captureQa(page, `engine-error-${info.project.name}`);
});

test("task rounds, follow mode, information panel and narrow dialogs", async ({
  page,
}, info) => {
  const detail = designFixture();
  detail.runs.push({ ...detail.runs[0], id: "second-run", sequence: 2 });
  detail.messages.push({
    ...detail.messages.find((message) => message.role === "assistant")!,
    id: "second-message",
    runId: "second-run",
    parts: [{ id: "second-text", type: "text", content: "### 第二次执行结果" }],
  });
  await mockTask(page, detail);
  await expect(page.locator(".markdown h3")).toHaveCount(2);
  await page.getByRole("combobox", { name: "执行筛选" }).click();
  await page
    .getByRole("option", { name: "执行 #1 · 已完成", exact: true })
    .click();
  await expect(page).toHaveURL(/run=design-run/);
  await expect(page.locator(".markdown h3")).toHaveCount(1);
  await expect(page.locator(".markdown h3")).toHaveText("网关检查结果");
  const follow = page.getByRole("switch", { name: "跟随输出" });
  await follow.uncheck();
  await expect(follow).not.toBeChecked();
  await follow.check();
  if (info.project.name === "desktop") {
    await expect(page.locator(".task-aside")).not.toBeVisible();
    await captureQa(page, "task-info-collapsed");
    await page.getByRole("button", { name: "任务信息", exact: true }).click();
    await expect(page.locator(".task-aside")).toBeVisible();
    expect(await page.locator(".task-main").evaluate(el => el.clientWidth)).toBeGreaterThanOrEqual(720);
    await page.setViewportSize({ width: 1340, height: 1000 });
    await expect(page.locator(".task-aside")).not.toBeVisible();
    await expect(page.getByRole("button", { name: "任务信息", exact: true })).toHaveAttribute("aria-expanded", "false");
  }
  await page.setViewportSize({ width: 320, height: 640 });
  await page.getByRole("button", { name: "任务信息", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect
    .poll(async () => {
      const bounds = await dialog.boundingBox();
      return Math.abs(bounds!.x + bounds!.width - 320);
    })
    .toBeLessThan(1);
  const rect = await dialog.boundingBox();
  expect(rect!.y).toBeGreaterThanOrEqual(0);
  expect(rect!.y + rect!.height).toBeLessThanOrEqual(641);
  expect(rect!.x).toBeGreaterThanOrEqual(0);
  expect(Math.abs(rect!.x + rect!.width - 320)).toBeLessThan(1);
  await expect(dialog).toHaveAttribute("data-slot", "sheet-content");
  await expect(dialog).toHaveCSS("overflow-y", "hidden");
  const viewport = dialog.locator('[data-slot="scroll-area-viewport"]');
  await expect(viewport).toHaveCSS("scrollbar-width", "none");
  await viewport.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(
    dialog.getByText("费用 (USD)", { exact: true }),
  ).toBeInViewport();
  await captureQa(page, `task-info-${info.project.name}`);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "任务信息", exact: true }),
  ).toBeFocused();
});

test("diagnostics and file previews scroll without compressing content", async ({
  page,
}, info) => {
  const detail = designFixture();
  const at = detail.runs[0].startedAt;
  let logs = Array.from({ length: 30 }, (_, id) => ({
    id,
    occurredAt: at,
    code: `ERROR_${id}`,
    message: `诊断日志 ${id}`,
  }));
  await page.route("**/api/observability/runs/design-run", (route) =>
    route.fulfill({
      json: {
        spans: Array.from({ length: 30 }, (_, i) => ({
          name: `stage-${i}`,
          startedAt: at,
          finishedAt: at,
        })),
        logs,
      },
    }),
  );
  detail.artifacts[0].availability = "available";
  await page.route("**/api/artifacts/file-sample/content?*", (route) =>
    route.fulfill({
      body: Array.from({ length: 200 }, (_, i) => `Preview line ${i}`).join(
        "\n",
      ),
      contentType: "text/plain",
    }),
  );
  await mockTask(page, detail);
  await page.getByRole("tab", { name: "诊断", exact: true }).click();
  const panel = page.getByRole("tabpanel", { name: "诊断", exact: true });
  const viewport = panel.locator('[data-slot="scroll-area-viewport"]');
  await expect(panel.getByRole("row")).toHaveCount(31);
  await expect(panel).toHaveCSS("overflow-y", "hidden");
  await expect(viewport).toHaveCSS("scrollbar-width", "none");
  expect(
    await panel
      .locator('[data-slot="table-container"]')
      .evaluate(
        (el) => el.clientHeight >= el.querySelector("table")!.clientHeight,
      ),
  ).toBe(true);
  expect(
    await viewport.evaluate((el) => el.scrollHeight > el.clientHeight),
  ).toBe(true);
  await expect(
    panel.getByRole("cell", { name: "stage-0", exact: true }),
  ).toBeInViewport();
  await page.screenshot({ path: info.outputPath("diagnostics-top.png") });
  await viewport.hover();
  await page.mouse.wheel(0, 5000);
  await expect(
    panel.getByText("诊断日志 29", { exact: true }),
  ).toBeInViewport();
  await page.screenshot({ path: info.outputPath("diagnostics-bottom.png") });
  logs = [];
  await page.reload();
  await viewport.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(panel.getByText("暂无错误日志")).toBeInViewport();
  await page.getByRole("tab", { name: "交付物", exact: true }).click();
  await page.getByRole("button", { name: "预览 report.md" }).click();
  const preview = page.getByRole("dialog");
  const fileViewport = preview.locator('[data-slot="scroll-area-viewport"]');
  await expect(preview).toHaveCSS("overflow-y", "hidden");
  await expect(preview.locator("pre")).toContainText("Preview line 199");
  await expect(fileViewport).toHaveCSS("scrollbar-width", "none");
  expect(
    await preview.evaluate(
      (el) => el.getBoundingClientRect().height <= innerHeight * 0.9 + 1,
    ),
  ).toBe(true);
  expect(
    await fileViewport.evaluate((el) => el.scrollHeight > el.clientHeight),
  ).toBe(true);
  await fileViewport.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  expect(
    await fileViewport.evaluate(
      (el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 1,
    ),
  ).toBe(true);
  await page.screenshot({ path: info.outputPath("preview-bottom.png") });
  await preview.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(preview).not.toBeVisible();
  detail.runs = [];
  await page.reload();
  await page.getByRole("tab", { name: "诊断", exact: true }).click();
  await expect(panel.getByText("暂无执行记录")).toBeInViewport();
});

test("every detail and observation subview has responsive screenshot evidence", async ({
  page,
  request,
}, info) => {
  test.skip(info.project.name !== "desktop", "Subview matrix runs once");
  test.setTimeout(180000);
  const detail = designFixture();
  const at = new Date().toISOString();
  detail.interactions.push({
    id: "qa-permission",
    sessionID: detail.task.id,
    runId: detail.runs[0].id,
    kind: "permission",
    title: "写入检查报告",
    permission: "",
        patterns: [],
        questions: [],
    state: "resolved",
    policy: "manual",
    created_at: at,
    resolvedAt: at,
    reply: { reply: "once" },
    error: null,
  });
  const log = {
    id: 1,
    occurredAt: at,
    stage: "engine",
    code: "QA_TIMEOUT",
    message: "测试样本：上游服务连接超时，请检查连接状态。",
    sessionId: detail.task.id,
    runId: detail.runs[0].id,
  };
  const overview = await (
    await request.get("/api/observability/overview?engine=pi")
  ).json();
  await page.route("**/api/observability/overview?*", (route) =>
    route.fulfill({
      json: {
        ...overview,
        capturedAt: new Date().toISOString(),
        toolCalls: 8,
        toolErrors: 2,
        tools: [{ name: "read_report", calls: 8, failed: 2 }],
      },
    }),
  );
  await page.route("**/api/observability/errors?*", (route) =>
    route.fulfill({ json: { items: [log] } }),
  );
  await page.route("**/api/observability/runs/design-run", (route) =>
    route.fulfill({
      json: {
        spans: [
          { name: "queue", startedAt: at, finishedAt: at },
          { name: "read_report", startedAt: at, finishedAt: at },
        ],
        logs: [log],
      },
    }),
  );
  await mockTask(page, detail);
  await page.goto("/conversations/design-fixture?tab=invalid");
  await expect(page.getByRole("tab", { name: "对话" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  for (const color of ["浅色", "深色"]) {
    await theme(page, color);
    for (const width of [320, 375, 414, 768, 1440]) {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
      for (const [name, tab] of [
        ["artifacts", "交付物"],
        ["interactions", "交互"],
        ["diagnostics", "诊断"],
      ]) {
        await page.goto("/conversations/design-fixture");
        await page.getByRole("tab", { name: tab, exact: true }).click();
        await expect(
          page.getByRole("tab", { name: tab, exact: true }),
        ).toHaveAttribute("aria-selected", "true");
        if (name === "diagnostics")
          await expect(
            page.getByText("QA_TIMEOUT", { exact: false }),
          ).toBeVisible();
        await captureQa(
          page,
          `${name}-${color === "浅色" ? "light" : "dark"}-${width}`,
        );
      }
      await page.goto("/observability?engine=pi");
      await expect(
        page.getByRole("heading", { name: "运行观测", exact: true }),
      ).toBeVisible();
      for (const [name, tab] of [
        ["engine", "引擎与资源"],
        ["tools", "工具与用量"],
        ["errors", "异常与调用链"],
      ]) {
        await observationTab(page, tab);
        if (name === "tools")
          await expect(
            page.getByRole("cell", { name: "read_report", exact: true }),
          ).toBeVisible();
        if (name === "errors")
          await expect(
            page.getByRole("link", { name: "查看", exact: true }),
          ).toBeVisible();
        await captureQa(
          page,
          `${name}-${color === "浅色" ? "light" : "dark"}-${width}`,
        );
      }
    }
  }
  await page.getByRole("link", { name: "查看", exact: true }).click();
  await expect(page.getByRole("tab", { name: "诊断" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.getByRole("link", { name: "返回网关观测" }).click();
  await expect(page).toHaveURL(/engine=pi.*tab=errors/);
  const notFound = await page.goto("/not-a-page");
  expect(notFound?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "页面不存在" })).toBeVisible();
  await captureQa(page, "not-found");
  await page.getByRole("link", { name: "返回会话" }).click();
  await expect(page).toHaveURL(/\/conversations$/);
});

test("LAN HTTP compatibility supports submission and clipboard fallback", async ({
  page,
  request,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(crypto, "randomUUID", { value: undefined });
    Object.defineProperty(navigator, "clipboard", { value: undefined });
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const { directory } = await (await request.get("/__test/directory")).json();
  await page.goto("/conversations");
  await page.getByRole("button", { name: "模型与会话设置", exact: true }).click();
  const dialog = page.getByRole("form", { name: "新会话" });
  await dialog.getByLabel("服务器工作目录", { exact: true }).fill(directory);
  await dialog
    .getByLabel("消息", { exact: true })
    .fill("HTTP compatibility check");
  const submitted = page.waitForRequest(
    (request) =>
      request.method() === "POST" && request.url().endsWith("/api/tasks"),
  );
  await dialog.getByRole("button", { name: "发送消息", exact: true }).click();
  expect((await submitted).postDataJSON().submissionId).toMatch(
    /^[0-9a-f]{32}$/,
  );
  await expect(page).toHaveURL(/\/conversations\/[\w-]+/);
  await expect(
    page.getByText("销售分析已完成，结果已写入 report.md。"),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "复制文本", exact: true })
    .last()
    .click();
  await expect(
    page.getByRole("button", { name: "已复制", exact: true }),
  ).toBeVisible();
  const input = page.getByRole("textbox", { name: "追加任务", exact: true });
  await input.focus();
  await page.keyboard.press("Control+V");
  await expect(input).toHaveValue("销售分析已完成，结果已写入 report.md。");
  await page.evaluate(() => {
    document.execCommand = () => false;
  });
  await page.getByRole("button", { name: "已复制", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "复制失败", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "删除任务", exact: true }).click();
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(page).toHaveURL(/\/conversations\/history$/);
  const api404 = await request.get("/api/not-a-page", {
    headers: { accept: "text/html" },
  });
  expect(api404.status()).toBe(404);
  expect((await api404.json()).code).toBe("NOT_FOUND");
  expect(errors).toEqual([]);
});

test("task assignment, approval, output, observations, cancellation and deletion", async ({
  page,
  request,
}, info) => {
  const errors: string[] = [];
  await mkdir("artifacts/ui", { recursive: true });
  page.on("pageerror", (error) => errors.push(error.message));
  const { directory } = await (await request.get("/__test/directory")).json();
  await page.goto("/conversations");
  await expect(
    page.getByRole("button", { name: "发送消息", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "模型与会话设置", exact: true }).click();
  const dialog = page.getByRole("form", { name: "新会话" });
  await dialog
    .getByLabel("会话名称（可选）", { exact: true })
    .fill(`销售分析-${info.project.name}`);
  await dialog.getByLabel("服务器工作目录", { exact: true }).fill(directory);
  await dialog
    .getByLabel("消息", { exact: true })
    .fill("汇总销售数据并生成报告");
  await dialog.getByRole("switch", { name: "人工审批权限" }).check();
  await dialog.getByRole("button", { name: "发送消息", exact: true }).click();
  await expect(page).toHaveURL(/\/conversations\/[\w-]+/);
  await expect(page.getByRole("region", { name: "待处理交互" })).toBeVisible();
  await page.screenshot({
    path: `artifacts/ui/approval-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "允许本次", exact: true }).click();
  await page.getByRole("tab", { name: "对话" }).click();
  await expect(
    page.getByText("销售分析已完成，结果已写入 report.md。"),
  ).toBeVisible();
  await page.getByText("write", { exact: true }).click();
  await expect(page.getByText("Wrote report.md")).toBeVisible();
  await page.screenshot({ path: info.outputPath("task.png"), fullPage: true });
  await page.getByRole("tab", { name: "交付物" }).click();
  await page.screenshot({
    path: `artifacts/ui/artifacts-${info.project.name}.png`,
    fullPage: true,
  });
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载 report.md" }).click();
  expect((await download).suggestedFilename()).toBe("report.md");
  await page.getByRole("button", { name: "预览 report.md" }).click();
  await expect(page.getByRole("dialog").getByText(/Total: 42/)).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "诊断" }).click();
  await expect(page.getByText("Trace ID", { exact: true })).toBeVisible();
  await navigate(page, "运行观测");
  await expect(page.getByText("P95 执行耗时", { exact: true })).toBeVisible();
  await page.screenshot({
    path: info.outputPath("observability.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
  await theme(page, "深色");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.screenshot({
    path: info.outputPath("observability-dark.png"),
    fullPage: true,
  });
  await theme(page, "浅色");
  await observationTab(page, "工具与用量");
  await expect(
    page.getByRole("cell", { name: "write", exact: true }),
  ).toBeVisible();
  await observationTab(page, "引擎与资源");
  await expect(page.getByText("网关 RSS", { exact: true })).toBeVisible();
  await observationTab(page, "异常与调用链");
  await navigate(page, "新会话");
  await navigate(page, "历史会话");
  await page
    .getByRole("link", { name: `销售分析-${info.project.name}`, exact: true })
    .click();
  await page.getByLabel("追加任务", { exact: true }).fill("hold");
  await page.getByRole("button", { name: "提交新一轮" }).click();
  await expect(
    page.getByRole("button", { name: "停止任务", exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: `artifacts/ui/running-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "停止任务", exact: true }).click();
  await page.getByRole("button", { name: "确认停止" }).click();
  await expect(page.getByRole("alertdialog")).not.toBeVisible();
  await page.getByRole("button", { name: "删除任务", exact: true }).click();
  await page.getByRole("button", { name: "确认删除" }).click();
  await expect(page).toHaveURL(/\/conversations\/history$/);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  expect(overflow).toBe(false);
  expect(errors).toEqual([]);
});

test("safe Markdown, cumulative tool updates, output limits and unavailable files", async ({
  page,
  context,
}) => {
  await page.clock.install();
  const detail = designFixture();
  const external: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith("https://example.com"))
      external.push(request.url());
  });
  await mockTask(page, detail);
  await expect(page.locator(".markdown h3")).toHaveText("网关检查结果");
  await expect(page.locator(".markdown table")).toBeVisible();
  await expect(page.locator(".markdown input").first()).toBeDisabled();
  await expect(
    page.locator(".markdown img, .markdown script, .markdown iframe"),
  ).toHaveCount(0);
  await expect(page.getByRole("link", { name: "危险链接" })).toHaveCount(0);
  expect(external).toEqual([]);
  const tool = page.getByRole("region", { name: "工具 search" });
  await expect(tool.getByRole("button", { expanded: true })).toBeVisible();
  await expect(tool.getByLabel("工具输出")).toHaveText(
    "连接超时：上游搜索服务没有响应。",
  );
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "复制代码", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    '{"status": "degraded"}',
  );
  await tool.getByRole("button", { expanded: true }).click();
  const part = detail.messages[0].parts[1];
  part.output = "新的累计结果";
  await page.clock.fastForward(5500);
  await expect(tool.getByRole("button", { expanded: false })).toBeVisible();
  await tool.getByRole("button", { expanded: false }).click();
  await expect(tool.getByLabel("工具输出")).toHaveText("新的累计结果");
  part.output = "日志行\n".repeat(18000);
  await page.clock.fastForward(5500);
  await expect(tool.getByText("预览已省略")).toBeVisible();
  expect(
    (await tool.getByLabel("工具输出").innerText()).split("\n").length,
  ).toBeLessThanOrEqual(12);
  await tool.getByRole("button", { name: "显示更多" }).click();
  expect(
    new TextEncoder().encode(await tool.getByLabel("工具输出").innerText())
      .length,
  ).toBeLessThanOrEqual(65536);
  await page.getByRole("tab", { name: "交付物" }).click();
  await expect(page.getByText("文件已修改", { exact: true })).toBeVisible();
  await expect(page.getByText("文件检查通过", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "预览 report.md" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "下载 report.md" }),
  ).toBeDisabled();
});

test("inline questions preserve input on conflict and expire without actionable controls", async ({
  page,
}) => {
  const detail = designFixture();
  const interaction = {
    id: "question-sample",
    sessionID: "design-fixture",
    runId: "design-run",
    kind: "question",
    title: "选择检查范围",
    permission: "",
        patterns: [],
        questions: [
      {
        question: "检查项目",
        options: [{ label: "连接", description: "" }, { label: "文件", description: "" }],
        multiple: true,
        allowCustom: true,
      },
    ],
    state: "pending",
    policy: "manual",
    created_at: "2026-09-06T06:00:00.000Z",
    resolvedAt: null,
    reply: null,
    error: null,
  };
  detail.interactions.push(interaction);
  let attempts = 0;
  await page.route("**/question/question-sample/reply", async (route) => {
    attempts++;
    expect(route.request().postDataJSON()).toEqual({
      answers: [["连接", "存储"]],
    });
    if (attempts === 1)
      await route.fulfill({
        status: 409,
        json: { code: "CONFLICT", message: "请重试当前回复" },
      });
    else {
      interaction.state = "expired";
      await route.fulfill({ status: 204 });
    }
  });
  await mockTask(page, detail);
  const pending = page.getByRole("region", { name: "待处理交互" });
  await pending.getByRole("checkbox", { name: "连接", exact: true }).check();
  await pending
    .getByRole("textbox", { name: "检查项目 自定义回答" })
    .fill("存储");
  await pending.getByRole("button", { name: "提交回答" }).click();
  await expect(pending.getByText("请重试当前回复", { exact: true })).toBeVisible();
  await expect(
    pending.getByRole("textbox", { name: "检查项目 自定义回答" }),
  ).toHaveValue("存储");
  await pending.getByRole("button", { name: "提交回答" }).click();
  await expect(pending).toHaveCount(0);
  await page.getByRole("tab", { name: "交互", exact: true }).click();
  await expect(page.getByText("已过期", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "提交回答" })).toHaveCount(0);
  await expect(page.getByText("检查项目", { exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "连接", exact: true })).toHaveCount(0);
});

test("observation filters persist and paused snapshots survive events and failures", async ({
  page,
}) => {
  await page.clock.install();
  let requests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/api/observability/")) requests++;
  });
  await page.goto(
    "/observability?window=15&metric=queueDepth&tab=errors&stage=engine&code=SAMPLE",
  );
  await expect(page.getByRole("textbox", { name: "错误阶段" })).toHaveValue(
    "engine",
  );
  await observationTab(page, "运行概览");
  await expect(page).toHaveURL(
    /window=15.*metric=queueDepth.*tab=overview.*stage=engine.*code=SAMPLE/,
  );
  await expect(page.getByRole("combobox", { name: "趋势指标" })).toContainText(
    "队列深度",
  );
  await expect(page.getByText("P95 执行耗时", { exact: true })).toBeVisible();
  await page.getByRole("switch", { name: "自动刷新" }).uncheck();
  const paused = requests;
  await page.clock.fastForward(20000);
  await expect(page.getByText(/数据已陈旧/)).toBeVisible();
  expect(requests).toBe(paused);
  await page.getByRole("button", { name: "刷新观测数据" }).click();
  await expect.poll(() => requests).toBeGreaterThan(paused);
  await page.route("**/api/observability/overview?*", (route) =>
    route.fulfill({
      status: 503,
      json: { code: "SAMPLE_ERROR", message: "采集暂不可用" },
    }),
  );
  await page.getByRole("button", { name: "刷新观测数据" }).click();
  await expect(page.getByText("采集暂不可用", { exact: true })).toBeVisible();
  await expect(page.getByText("P95 执行耗时", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("combobox", { name: "时间范围" })).toContainText(
    "最近 15 分钟",
  );
  await observationTab(page, "异常与调用链");
  await expect(page.getByRole("textbox", { name: "错误代码" })).toHaveValue(
    "SAMPLE",
  );
});

test("execution workspace keeps messages primary across viewport sizes", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "Responsive matrix runs once");
  test.setTimeout(90000);
  const detail = designFixture();
  detail.messages[0].parts[0].content = "执行输出，保留可读的上下文。\n\n".repeat(
    100,
  );
  await mockTask(page, detail);
  const log = page.getByLabel("执行消息", { exact: true });
  const input = page.getByRole("textbox", { name: "追加任务", exact: true });
  for (const width of [320, 375, 414, 768, 1440]) {
    await page.setViewportSize({ width, height: 768 });
    await expect(input).toBeInViewport({ ratio: 1 });
    const normal = (await log.boundingBox())!.height;
    expect(normal).toBeGreaterThan(width < 768 ? 230 : 400);
    await log.evaluate((el) => {
      el.scrollTop = 0;
      el.dispatchEvent(new Event("scroll"));
    });
    await expect(
      page.getByRole("button", { name: "回到最新进度" }),
    ).toBeVisible();
    expect((await log.boundingBox())!.height).toBe(normal);
    await page.getByRole("button", { name: "专注阅读", exact: true }).click();
    const focused = (await log.boundingBox())!.height;
    expect(focused).toBeGreaterThan(normal + 80);
    expect(await log.evaluate((el) => el.scrollTop)).toBe(0);
    await input.fill("较长的追加要求\n".repeat(80));
    expect((await input.boundingBox())!.height).toBeLessThanOrEqual(160);
    await expect(input).toBeInViewport({ ratio: 1 });
    await expect(
      page.getByRole("button", { name: "提交新一轮", exact: true }),
    ).toBeInViewport({ ratio: 1 });
    await input.fill("");
    await page.getByRole("button", { name: "回到最新进度" }).click();
    await expect
      .poll(() =>
        log.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight),
      )
      .toBeLessThan(2);
    await page
      .getByRole("button", { name: "退出专注阅读", exact: true })
      .click();
    await expect
      .poll(() =>
        log.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight),
      )
      .toBeLessThan(2);
    expect(
      await page
        .locator("main")
        .evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    console.log(
      `Execution workspace ${width}x768: normal=${normal}, focused=${focused}`,
    );
    await page.screenshot({
      path: info.outputPath(`execution-workspace-${width}.png`),
    });
  }
  await theme(page, "深色");
  await page.screenshot({
    path: info.outputPath("execution-workspace-dark.png"),
  });
  await page.setViewportSize({ width: 375, height: 540 });
  await page.getByRole("button", { name: "专注阅读", exact: true }).click();
  await input.fill("短视口中的输入\n".repeat(50));
  await expect(input).toBeInViewport({ ratio: 1 });
  expect((await log.boundingBox())!.height).toBeGreaterThan(180);
  await page.screenshot({
    path: info.outputPath("execution-workspace-short.png"),
  });
});

test("history scroll stays put on updates and IME does not submit", async ({
  page,
}, info) => {
  test.skip(
    info.project.name !== "desktop",
    "Desktop scroll container behavior",
  );
  await page.clock.install();
  const detail = designFixture();
  detail.messages[0].parts[0].content = "历史记录。\n\n".repeat(100);
  await mockTask(page, detail);
  const log = page.getByLabel("执行消息", { exact: true });
  await log.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll"));
  });
  detail.messages[0].parts[0].content += "新的累计输出";
  await page.clock.fastForward(5500);
  await expect(
    page.getByRole("button", { name: "回到最新进度" }),
  ).toBeVisible();
  expect(await log.evaluate((element) => element.scrollTop)).toBe(0);
  await page.getByRole("tab", { name: "交付物" }).click();
  await page.getByRole("tab", { name: "对话" }).click();
  expect(await log.evaluate((element) => element.scrollTop)).toBe(0);
  let submissions = 0;
  await page.route("**/api/tasks/design-fixture/runs", (route) => {
    submissions++;
    return route.fulfill({
      status: 400,
      json: { code: "SAMPLE", message: "测试拒绝" },
    });
  });
  const input = page.getByRole("textbox", { name: "追加任务", exact: true });
  await input.fill("输入中");
  await input.dispatchEvent("keydown", {
    key: "Enter",
    ctrlKey: true,
    isComposing: true,
  });
  expect(submissions).toBe(0);
  await input.press("Control+Enter");
  await expect.poll(() => submissions).toBe(1);
  await expect(input).toHaveValue("输入中");
});

test("design screenshots across viewports and themes", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "Responsive matrix runs once");
  test.setTimeout(120000);
  await mkdir("artifacts/ui", { recursive: true });
  const detail = designFixture();
  await page.route(/\/api\/tasks(?:\?.*)?$/, (route) =>
    route.fulfill({ json: { items: [detail.task], nextCursor: null } }),
  );
  await mockTask(page, detail);
  for (const color of ["浅色", "深色"]) {
    await theme(page, color);
    for (const width of [320, 375, 414, 768, 1024, 1440, 1920]) {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
      for (const [name, url] of [
        ["execution", "/conversations/design-fixture"],
        ["tasks", "/conversations"],
        ["observability", "/observability"],
      ]) {
        await page.goto(url);
        await expect(page.locator("main h1")).toBeVisible();
        if (name === "execution")
          await expect(page.locator(".markdown h3")).toBeVisible();
        if (name === "observability")
          await expect(
            page.getByText("P95 执行耗时", { exact: true }),
          ).toBeVisible();
        await expect
          .poll(() =>
            page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          )
          .toBe(true);
        const clipped = await page
          .locator("main button:visible, main [role=combobox]:visible")
          .evaluateAll((elements) =>
            elements
              .filter((element) => {
                const rect = element.getBoundingClientRect();
                return rect.left < -1 || rect.right > innerWidth + 1;
              })
              .map(
                (element) =>
                  element.getAttribute("aria-label") || element.textContent,
              ),
          );
        expect(clipped).toEqual([]);
        await page.screenshot({
          path: `artifacts/ui/${name}-${color === "浅色" ? "light" : "dark"}-${width}.png`,
          fullPage: true,
        });
      }
    }
  }
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" });
  await theme(page, "跟随系统");
  await expect(page.locator("html")).toHaveClass(/dark/);
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).not.toHaveClass(/dark/);
});

test("tool states, keyboard focus, reduced motion and enlarged text", async ({
  page,
}, info) => {
  await page.clock.install();
  const detail = designFixture();
  const toolPart = detail.messages[0].parts[1];
  toolPart.state.status = "running";
  toolPart.output = "";
  toolPart.finishedAt = null as unknown as string;
  await mockTask(page, detail);
  const tool = page.getByRole("region", { name: "工具 search" });
  await expect(tool.locator('[data-tone="info"]')).toHaveText("执行中");
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await tool
      .locator(".status-spinner")
      .evaluate((element) => getComputedStyle(element).animationName),
  ).toBe("none");
  for (const [state, label] of [
    ["pending", "待处理"],
    ["completed", "已完成"],
    ["cancelled", "已取消"],
    ["interrupted", "已中断"],
  ]) {
    toolPart.state.status = state;
    await page.clock.fastForward(5500);
    await expect(tool.locator(".status")).toHaveText(label);
  }
  await expect(tool.getByRole("button", { expanded: true })).toBeVisible();
  const trigger = tool.getByRole("button", { expanded: true });
  await page.keyboard.press("Tab");
  await trigger.focus();
  expect(
    await trigger.evaluate((element) => {
      const style = getComputedStyle(element);
      return (
        element.matches(":focus-visible") &&
        (style.outlineStyle !== "none" || style.boxShadow !== "none")
      );
    }),
  ).toBe(true);
  await page.keyboard.press("Enter");
  await expect(tool.getByRole("button", { expanded: false })).toBeFocused();
  if (info.project.name === "mobile") {
    const infoButton = page.getByRole("button", {
      name: "任务信息",
      exact: true,
    });
    await infoButton.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(infoButton).toBeFocused();
  }
  await page.setViewportSize({ width: 768, height: 1000 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "32px";
  });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  const clippedControls = await page
    .locator(
      'header button:visible, header [role="combobox"]:visible, main button:visible',
    )
    .evaluateAll((elements) =>
      elements
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return rect.left < -1 || rect.right > innerWidth + 1;
        })
        .map(
          (element) =>
            element.getAttribute("aria-label") || element.textContent,
        ),
    );
  expect(clippedControls).toEqual([]);
  await mkdir("artifacts/ui", { recursive: true });
  await page.screenshot({
    path: `artifacts/ui/enlarged-text-${info.project.name}.png`,
    fullPage: true,
  });
});

test("task updates keep the focused row in place", async ({ page }, info) => {
  await page.clock.install();
  const first = designFixture().task;
  const second = { ...first, id: "second", title: "第二个测试任务" };
  let items = [first, second];
  await page.route(/\/api\/tasks(?:\?.*)?$/, (route) =>
    route.fulfill({ json: { items, nextCursor: null } }),
  );
  await page.goto("/conversations");
  await navigate(page, "历史会话");
  await page.getByRole("link", { name: first.title, exact: true }).focus();
  first.status = "failed";
  items = [second, first];
  await page.clock.fastForward(5100);
  await expect(
    page.locator(".conversation-history:visible .conversation-link").first().locator(".status"),
  ).toHaveText("失败");
  await expect(page.locator(".conversation-history:visible .conversation-link .history-title").first()).toHaveText(first.title);
  await page.getByRole("textbox", { name: "搜索会话", exact: true }).focus();
  await expect(page.locator(".conversation-history:visible .conversation-link .history-title").first()).toHaveText(second.title);
});

test("danger confirmation cancels, locks during submission and preserves failures", async ({
  page,
}) => {
  const detail = designFixture();
  let requests = 0;
  let release: (() => void) | undefined;
  await page.route("**/session/design-fixture", async (route) => {
    requests++;
    if (requests === 1) {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await route.fulfill({
        status: 503,
        json: { code: "UNAVAILABLE", message: "删除失败，请重试" },
      });
    } else await route.fulfill({ status: 204 });
  });
  await mockTask(page, detail);
  const trigger = page.getByRole("button", { name: "删除任务", exact: true });
  const confirmation = page.getByRole("alertdialog");
  await trigger.click();
  await expect(
    confirmation.getByRole("button", { name: "取消", exact: true }),
  ).toBeFocused();
  await expect(confirmation).toContainText("工作目录中的文件会保留");
  await confirmation.getByRole("button", { name: "取消", exact: true }).click();
  await expect(confirmation).not.toBeVisible();
  await expect(trigger).toBeFocused();
  expect(requests).toBe(0);
  await trigger.click();
  await confirmation
    .getByRole("button", { name: "确认删除", exact: true })
    .click();
  await expect.poll(() => requests).toBe(1);
  await expect(
    confirmation.getByRole("button", { name: "确认删除", exact: true }),
  ).toBeDisabled();
  await expect(
    confirmation.getByRole("button", { name: "取消", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(confirmation).toBeVisible();
  release!();
  await expect(confirmation.getByRole("alert")).toContainText(
    "删除失败，请重试",
  );
  await captureQa(page, "confirmation-failure");
  await confirmation
    .getByRole("button", { name: "确认删除", exact: true })
    .click();
  await expect(page).toHaveURL(/\/conversations\/history$/);
  expect(requests).toBe(2);
  await expect(page.locator("[data-sonner-toast]")).toContainText("任务已删除");
});

test("resource field errors and stale writes preserve the draft", async ({
  page,
}) => {
  let settings = settingsSchema.parse({});
  let writes = 0;
  const view = () => ({
    settings,
    revision: String(writes),
    dataDirectory: "/tmp/bridge",
  });
  await page.route("**/api/settings", async (route) => {
    if (route.request().method() === "PUT") {
      writes++;
      if (writes === 1)
        return route.fulfill({
          status: 409,
          json: { code: "CONFLICT", message: "配置版本冲突" },
        });
      settings = route.request().postDataJSON().settings;
    }
    await route.fulfill({ json: view() });
  });
  await page.goto("/agents/resources");
  await page.getByRole("tab", { name: "MCP", exact: true }).click();
  await page.getByRole("button", { name: "添加", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("资源标识", { exact: true }).fill("sample");
  await dialog.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toContainText("放弃未保存的资源配置");
  await page.getByRole("alertdialog").getByRole("button", { name: "取消", exact: true }).click();
  await expect(dialog.getByLabel("资源标识", { exact: true })).toHaveValue("sample");
  await dialog.getByRole("button", { name: "保存配置", exact: true }).click();
  expect(await dialog.getByLabel("服务器命令").evaluate((el: HTMLInputElement) => el.validity.valueMissing)).toBe(true);
  expect(writes).toBe(0);
  await dialog.getByLabel("服务器命令").fill("node");
  await dialog.getByRole("button", { name: "添加环境变量", exact: true }).click();
  await dialog.getByLabel("键名 1", { exact: true }).fill("TOKEN");
  await dialog.getByRole("button", { name: "添加环境变量", exact: true }).click();
  await dialog.getByLabel("键名 2", { exact: true }).fill("TOKEN");
  await dialog.getByRole("button", { name: "保存配置", exact: true }).click();
  await expect(dialog.getByText("键名不能重复", { exact: true })).toBeVisible();
  expect(writes).toBe(0);
  await dialog.getByRole("button", { name: "删除键值 2", exact: true }).click();
  await dialog.getByRole("button", { name: "保存配置", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("配置版本冲突");
  await expect(dialog.getByLabel("资源标识", { exact: true })).toHaveValue(
    "sample",
  );
  await dialog.getByRole("button", { name: "保存配置", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("button", { name: "编辑 sample", exact: true })).toBeVisible();
});

test("Agent drafts survive resource navigation and refresh, and flag concurrent edits", async ({ page, request }) => {
  const saved = await (await request.get("/api/settings")).json();
  let current = structuredClone(saved);
  let writes = 0;
  const initialPolicy = current.settings.agents.find((a: { id: string }) => a.id === "pi").interactionPolicy.permission;
  const nextPolicy = initialPolicy === "manual" ? "auto" : "manual";
  const label = nextPolicy === "auto" ? "自动处理" : "人工处理";
  await page.route("**/api/settings", (route) => {
    if (route.request().method() === "PUT") {
      const body = route.request().postDataJSON();
      expect(body.revision).toBe(current.revision);
      current = { ...current, settings: body.settings, revision: `draft-${++writes}` };
    }
    return route.fulfill({ json: current });
  });
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/agents/pi?tab=runtime");
  await page.getByRole("combobox", { name: "默认权限策略", exact: true }).click();
  await page.getByRole("option", { name: label, exact: true }).click();
  await page.getByRole("tab", { name: "Skills", exact: true }).click();
  await page.getByRole("button", { name: "共享资源", exact: true }).click();
  await expect(page).toHaveURL(/tab=skills&agent=pi/);
  await page.getByRole("link", { name: "返回 Pi 配置", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Skills", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "运行", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("combobox", { name: "默认权限策略", exact: true })).toContainText(label);
  await expect(page.getByRole("button", { name: "保存配置", exact: true })).toBeEnabled();
  const agent = current.settings.agents.find((a: { id: string }) => a.id === "pi");
  agent.interactionPolicy.question = agent.interactionPolicy.question === "auto" ? "manual" : "auto";
  current.revision = "external-change";
  await page.getByRole("button", { name: "刷新 Agent 配置", exact: true }).click();
  await expect(page.getByText("此 Agent 的配置已在其他位置修改", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "保存配置", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "保留我的更改", exact: true }).click();
  await page.getByRole("button", { name: "保存配置", exact: true }).click();
  expect(writes).toBe(1);
  expect(current.settings.agents.find((a: { id: string }) => a.id === "pi").interactionPolicy.permission).toBe(nextPolicy);
  await expect(page.getByRole("button", { name: "保存配置", exact: true })).toBeDisabled();
  await captureQa(page, `agent-draft-${test.info().project.name}`);
});

test("first configuration reaches activation and reports an asynchronous failure", async ({ page, request }) => {
  const live = await (await request.get("/api/runtime")).json();
  const snapshot = await (await request.get("/api/agents")).json();
  let settings = settingsSchema.parse({});
  let version = 0;
  const agents = snapshot.agents.map((a: { id: string }) => ({ ...a, enabled: false, health: { status: "disabled", processes: 0, restarts: 0, version: null }, operation: null, error: null, pendingChanges: true }));
  await page.route("**/api/runtime", (route) => route.fulfill({ json: { ...live, engines: live.engines.map((a: object) => ({ ...a, enabled: false, health: { status: "disabled" } })) } }));
  await page.route("**/api/agents", (route) => route.fulfill({ json: { agents } }));
  await page.route("**/api/settings", (route) => {
    if (route.request().method() === "PUT") { settings = settingsSchema.parse(route.request().postDataJSON().settings); version++; }
    return route.fulfill({ json: { settings, revision: String(version), dataDirectory: "/tmp/fixture" } });
  });
  await page.route("**/api/agents/pi/actions", (route) => {
    expect(route.request().postDataJSON().action).toBe("enable");
    settings.agents.find((a) => a.id === "pi")!.enabled = true;
    Object.assign(agents.find((a: { id: string }) => a.id === "pi"), { enabled: true, operation: "enable" });
    return route.fulfill({ status: 202, json: agents[0] });
  });
  await page.goto("/conversations");
  await page.getByRole("link", { name: "配置 Agent", exact: true }).click();
  await page.getByRole("link", { name: "Pi", exact: true }).click();
  await page.getByRole("button", { name: "添加模型连接", exact: true }).click();
  await page.getByRole("button", { name: "添加", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("资源标识").fill("new-provider");
  await dialog.getByLabel("Base URL").fill("https://example.test/v1");
  await dialog.getByLabel("API Key").fill("secret-stays-in-form");
  await dialog.getByLabel("模型 ID", { exact: true }).fill("new-model");
  await dialog.getByRole("button", { name: "保存配置", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole("link", { name: "返回 Pi 配置", exact: true }).click();
  await page.getByRole("checkbox", { name: "new-provider new-model", exact: true }).check();
  const stored = await page.evaluate(() => JSON.stringify(sessionStorage));
  expect(stored).not.toContain("secret-stays-in-form");
  await page.getByRole("button", { name: "保存并启用", exact: true }).click();
  await expect(page.getByRole("button", { name: "处理中", exact: true })).toBeDisabled();
  Object.assign(agents.find((a: { id: string }) => a.id === "pi"), { operation: null, error: "模型服务拒绝连接" });
  await page.getByRole("button", { name: "刷新 Agent 配置", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("模型服务拒绝连接");
  await expect(page.getByRole("button", { name: "应用配置", exact: true })).toBeEnabled();
  await captureQa(page, `agent-activation-failed-${test.info().project.name}`);
});

test("model search filters, handles no matches and selects with keyboard", async ({
  page,
}) => {
  await page.goto("/conversations");
  await page.getByRole("button", { name: "模型与会话设置", exact: true }).click();
  const provider = page.getByRole("combobox", {
    name: "模型供应商",
    exact: true,
  });
  await provider.fill("no-provider-matches");
  await expect(page.getByText("没有匹配的选项", { exact: true })).toBeVisible();
  await provider.fill("pi-secondary");
  await expect(
    page.getByRole("option", { name: "pi-secondary", exact: true }),
  ).toBeVisible();
  await provider.press("ArrowDown");
  await provider.press("Enter");
  await expect(provider).toHaveValue("pi-secondary");
  const model = page.getByRole("combobox", { name: "模型名称", exact: true });
  await model.fill("quality");
  await expect(
    page.getByRole("option", { name: "pi secondary quality", exact: true }),
  ).toBeVisible();
  await model.press("ArrowDown");
  await model.press("Enter");
  await expect(model).toHaveValue("pi secondary quality");
  await expect(page.getByRole("form", { name: "新会话" })).toBeVisible();
});

test("single choice keyboard navigation and custom answers remain exclusive", async ({
  page,
}) => {
  const detail = designFixture();
  detail.interactions.push({
    id: "single-choice",
    sessionID: "design-fixture",
    runId: "design-run",
    kind: "question",
    title: "选择输出格式",
    permission: "",
        patterns: [],
        questions: [
      {
        question: "输出格式",
        options: [{ label: "Markdown", description: "" }, { label: "JSON", description: "" }],
        multiple: false,
        allowCustom: true,
      },
    ],
    state: "pending",
    policy: "manual",
    created_at: "2026-09-06T06:00:00.000Z",
    resolvedAt: null,
    reply: null,
    error: null,
  });
  let answers: string[][] | undefined;
  await page.route("**/question/single-choice/reply", async (route) => {
    answers = route.request().postDataJSON().answers;
    await route.fulfill({
      status: 409,
      json: { code: "CONFLICT", message: "保留回答以重试" },
    });
  });
  await mockTask(page, detail);
  const group = page.getByRole("group", { name: "输出格式", exact: true });
  const markdown = group.getByRole("radio", { name: "Markdown", exact: true });
  const json = group.getByRole("radio", { name: "JSON", exact: true });
  await markdown.check();
  await markdown.press("ArrowDown");
  await expect(json).toBeChecked();
  await expect(markdown).not.toBeChecked();
  const custom = page.getByRole("textbox", {
    name: "输出格式 自定义回答",
    exact: true,
  });
  await custom.fill("纯文本");
  await expect(json).not.toBeChecked();
  await markdown.check();
  await expect(custom).toHaveValue("");
  await page.getByRole("button", { name: "提交回答", exact: true }).click();
  await expect.poll(() => answers).toEqual([["Markdown"]]);
  await expect(markdown).toBeChecked();
});


test("reasoning folds independently of the answer", async ({ page }) => {
  const detail = designFixture();
  detail.messages[0].parts.unshift({ id: "reasoning", type: "reasoning", content: "先检查连接，再汇总异常。" });
  await mockTask(page, detail);
  const reasoning = page.getByRole("button", { name: "思考过程", exact: true });
  await expect(page.getByText("先检查连接，再汇总异常。", { exact: true })).not.toBeVisible();
  await reasoning.click();
  await expect(page.getByText("先检查连接，再汇总异常。", { exact: true })).toBeVisible();
  await expect(page.locator('[data-slot="message"]')).toHaveCount(1);
  await captureQa(page, `reasoning-${test.info().project.name}`);
  await reasoning.click();
  await expect(page.getByRole("heading", { name: "网关检查结果", exact: true })).toBeVisible();
});

test("shared field focus and heading scale remain consistent after selection", async ({ page }, info) => {
  await page.goto("/conversations");
  const heading = page.getByRole("heading", { name: "开始一段新的工作", exact: true });
  await expect(heading).toHaveCSS("font-size", info.project.name === "mobile" ? "24px" : "30px");
  const agent = page.getByRole("combobox", { name: "Agent", exact: true });
  const before = await agent.boundingBox();
  const border = await agent.evaluate(el => getComputedStyle(el).borderColor);
  await agent.click();
  await page.getByRole("option", { name: "OpenCode", exact: true }).click();
  await heading.click();
  await expect(agent).toHaveCSS("border-color", border);
  expect((await agent.boundingBox())!.height).toBe(before!.height);
  await agent.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Escape");
  await expect(agent).toBeFocused();
  const directory = page.getByLabel("服务器工作目录", { exact: true });
  await directory.focus();
  await expect(directory).toHaveCSS("border-width", "0px");
  await expect(directory.locator('xpath=..')).toHaveCSS("border-width", "1px");
  await expect(page.getByRole("button", { name: "主题", exact: true })).toBeVisible();
  await captureQa(page, `field-focus-${info.project.name}`);
});

test("questionnaire preserves answers across steps and shows resolved answers", async ({ page }) => {
  const detail = designFixture();
  const interaction = {
    id: "multi-step", sessionID: detail.task.id, runId: detail.runs[0].id, kind: "question",
    title: "确认需求", permission: "", patterns: [], state: "pending", policy: "manual",
    created_at: detail.task.createdAt, resolvedAt: null as string | null, reply: null as { answers: string[][] } | null, error: null,
    questions: [
      { question: "选择格式", options: [{ label: "Markdown", description: "易于阅读" }], multiple: false, allowCustom: false },
      { question: "补充要求", options: [], multiple: false, allowCustom: true },
    ],
  };
  detail.interactions.push(interaction);
  await page.route("**/question/multi-step/reply", async route => {
    const body = route.request().postDataJSON();
    expect(body).toEqual({ answers: [["Markdown"], ["保留数据来源"]] });
    interaction.reply = body;
    interaction.state = "resolved";
    interaction.resolvedAt = new Date().toISOString();
    await route.fulfill({ status: 204 });
  });
  await mockTask(page, detail);
  await page.getByRole("radio", { name: "Markdown 易于阅读", exact: true }).check();
  await captureQa(page, `questionnaire-${test.info().project.name}`);
  await page.getByRole("button", { name: "下一题", exact: true }).click();
  await page.getByRole("textbox", { name: "补充要求 自定义回答", exact: true }).fill("保留数据来源");
  await page.getByRole("button", { name: "上一题", exact: true }).click();
  await expect(page.getByRole("radio", { name: "Markdown 易于阅读", exact: true })).toBeChecked();
  await page.getByRole("button", { name: "下一题", exact: true }).click();
  await page.getByRole("button", { name: "提交回答", exact: true }).click();
  await expect(page.getByRole("region", { name: "待处理交互" })).toHaveCount(0);
  await page.getByRole("tab", { name: "交互", exact: true }).click();
  await expect(page.getByText(/Markdown；保留数据来源/)).toBeVisible();
  await expect(page.getByRole("button", { name: "提交回答", exact: true })).toHaveCount(0);
});
