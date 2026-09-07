import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";

test("settings persist models, skills and MCP with masked secrets", async ({
  page,
  request,
}, info) => {
  const suffix = info.project.name;
  const provider = `compatible-${suffix}`;
  const initialViewport = page.viewportSize()!;
  await page.setViewportSize({ width: initialViewport.width, height: 540 });
  expect((await page.goto("/settings"))?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { name: "配置", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "添加", exact: true }).click();
  const editor = page.getByRole("dialog");
  await expect(
    editor.getByRole("button", { name: /关闭|取消编辑/ }),
  ).toHaveCount(1);
  await expect(editor).toHaveCSS("overflow-y", "hidden");
  await page.getByLabel("名称", { exact: true }).fill(provider);
  await page
    .getByLabel("Base URL", { exact: true })
    .fill("http://127.0.0.1:8888/v1");
  await page.getByLabel("API Key", { exact: true }).fill("browser-secret");
  await page
    .getByRole("group", { name: "模型 1", exact: true })
    .getByLabel("模型 ID", { exact: true })
    .fill("model-one");
  await page
    .getByRole("group", { name: "模型 1", exact: true })
    .getByLabel("上下文长度")
    .fill("32000");
  await page
    .getByRole("group", { name: "模型 1", exact: true })
    .getByLabel("最大输出长度")
    .fill("4096");
  await page.getByRole("button", { name: "添加模型", exact: true }).click();
  await page
    .getByRole("group", { name: "模型 2", exact: true })
    .getByLabel("模型 ID", { exact: true })
    .fill("model-two");
  await page
    .getByRole("group", { name: "模型 2", exact: true })
    .getByLabel("上下文长度")
    .fill("200000");
  await captureQa(page, `settings-model-form-${suffix}`);
  const editorViewport = editor.locator('[data-slot="scroll-area-viewport"]');
  await expect(editorViewport).toHaveCSS("scrollbar-width", "none");
  await expect
    .poll(() =>
      editorViewport.evaluate((el) => el.scrollHeight > el.clientHeight),
    )
    .toBe(true);
  await editorViewport.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  expect(
    await editorViewport.evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await expect(
    editor.getByRole("button", { name: "保存配置", exact: true }),
  ).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: info.outputPath("settings-scroll.png") });
  await page.getByRole("button", { name: "保存配置", exact: true }).click();
  await page.setViewportSize(initialViewport);
  await expect(
    page.getByRole("button", { name: `配置操作 ${provider}`, exact: true }),
  ).toBeVisible();
  const settingsResponse = await request.get("/api/settings");
  expect(await settingsResponse.text()).not.toContain("browser-secret");
  expect(
    (await settingsResponse.json()).settings.providers.find(
      (item: { id: string }) => item.id === provider,
    ).models,
  ).toMatchObject([
    { id: "model-one", contextWindow: 32000, maxTokens: 4096 },
    { id: "model-two", contextWindow: 200000, maxTokens: 16384 },
  ]);
  await page
    .getByRole("button", { name: `配置操作 ${provider}`, exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: `编辑 ${provider}`, exact: true })
    .click();
  await expect(page.getByLabel("API Key", { exact: true })).toHaveValue(
    "********",
  );
  await expect(
    page
      .getByRole("group", { name: "模型 1", exact: true })
      .getByLabel("上下文长度"),
  ).toHaveValue("32000");
  await page
    .getByRole("group", { name: "模型 2", exact: true })
    .getByLabel("上下文长度")
    .fill("256000");
  await page
    .getByLabel("Base URL", { exact: true })
    .fill("http://127.0.0.1:8889/v1");
  await page.getByRole("button", { name: "保存配置", exact: true }).click();
  await expect(
    page.getByRole("button", { name: `配置操作 ${provider}`, exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByText(/8889/)).toBeVisible();
  await page
    .getByRole("button", { name: `配置操作 ${provider}`, exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: `编辑 ${provider}`, exact: true })
    .click();
  await expect(
    page
      .getByRole("group", { name: "模型 2", exact: true })
      .getByLabel("上下文长度"),
  ).toHaveValue("256000");
  await page.getByRole("button", { name: "删除模型 1", exact: true }).click();
  await expect(
    page
      .getByRole("group", { name: "模型 1", exact: true })
      .getByLabel("模型 ID", { exact: true }),
  ).toHaveValue("model-two");
  await editor.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(editor).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: `配置操作 ${provider}`, exact: true }),
  ).toBeFocused();
  await captureQa(page, `settings-models-${suffix}`);
  await page.getByRole("tab", { name: "Skills", exact: true }).click();
  await page.getByRole("button", { name: "添加", exact: true }).click();
  const { directory } = await (await request.get("/__test/directory")).json();
  await page.getByLabel("名称", { exact: true }).fill(`office-${suffix}`);
  await page.getByLabel("Skill 目录", { exact: true }).fill(directory);
  await page.getByRole("button", { name: "保存配置", exact: true }).click();
  await expect(
    page.getByRole("switch", { name: `启用 office-${suffix}` }),
  ).toBeChecked();
  await page.getByRole("switch", { name: `启用 office-${suffix}` }).click();
  await expect(
    page.getByRole("switch", { name: `启用 office-${suffix}` }),
  ).not.toBeChecked();
  await page.getByRole("tab", { name: "MCP", exact: true }).click();
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await page.getByLabel("名称", { exact: true }).fill(`office-mcp-${suffix}`);
  await page.getByRole("combobox", { name: "MCP 引擎", exact: true }).click();
  await page.getByRole("option", { name: "Pi", exact: true }).click();
  await page
    .getByLabel("命令和参数（JSON 数组）")
    .fill('["node", "office-server.mjs"]');
  await page.getByLabel("环境变量（JSON 对象）").fill('{"TOKEN":"mcp-secret"}');
  await page.getByRole("button", { name: "保存配置", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: `配置操作 office-mcp-${suffix}`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Pi MCP 配置文件")).toHaveValue(
    /[/\\]pi[/\\]mcp\.json$/,
  );
  await expect(
    page.getByRole("button", { name: "安装 MCP 扩展", exact: true }),
  ).toBeVisible();
  await captureQa(page, `settings-mcp-${suffix}`);
  await page.getByRole("tab", { name: "Pi 插件", exact: true }).click();
  await expect(page.getByLabel("插件来源", { exact: true })).toBeVisible();
  await captureQa(page, `settings-pi-${suffix}`);
  for (const [tab, id] of [
    ["模型", provider],
    ["Skills", `office-${suffix}`],
    ["MCP", `office-mcp-${suffix}`],
  ]) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    await page
      .getByRole("button", { name: `配置操作 ${id}`, exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: `删除 ${id}`, exact: true })
      .click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "取消", exact: true }),
    ).toBeFocused();
    await page.getByRole("button", { name: "确认删除", exact: true }).click();
    await expect(
      page.getByRole("button", { name: `配置操作 ${id}`, exact: true }),
    ).toHaveCount(0);
  }
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
        createdAt: at,
        completedAt: at,
        finishReason: "stop",
        parts: [
          {
            id: "text",
            type: "text",
            text: '# 网关检查结果\n\n已完成检查，**需要处理一项异常**。\n\n| 服务 | 状态 |\n| --- | --- |\n| 文档处理 | 就绪 |\n| 搜索服务 | 连接超时 |\n\n- [x] 检查连接\n- [ ] 处理超时\n\n```json\n{"status": "degraded"}\n```\n\n[公开参考](https://example.com) [危险链接](javascript:alert(1)) ![外部图片](https://example.com/tracking.png)\n\n<script>window.hacked=true</script>',
          },
          {
            id: "tool",
            type: "tool",
            toolCallId: "call-sample",
            name: "search",
            input: { path: "C:/workspace/report.json" },
            output: "连接超时：上游搜索服务没有响应。",
            state: "failed",
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
  await page.goto("/tasks/design-fixture");
  await expect(
    page.getByRole("heading", { name: detail.task.title }),
  ).toBeVisible();
}

async function navigate(page: Page, name: string) {
  if (await page.getByRole("button", { name: "打开导航" }).isVisible())
    await page.getByRole("button", { name: "打开导航" }).click();
  await page.getByRole("link", { name, exact: true }).click();
}
async function observationTab(page: Page, name: string) {
  const select = page.getByRole("combobox", { name: "观测视图" });
  if (await select.isVisible()) {
    await select.click();
    await page.getByRole("option", { name, exact: true }).click();
  } else await page.getByRole("tab", { name, exact: true }).click();
}
async function theme(page: Page, name: string) {
  await page.getByRole("combobox", { name: "主题", exact: true }).click();
  await page.getByRole("option", { name, exact: true }).click();
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
  const clipped = await page
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
    );
  expect(clipped).toEqual([]);
  await mkdir("artifacts/ui/qa", { recursive: true });
  await page.screenshot({
    path: `artifacts/ui/qa/${name}.png`,
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
      path: `artifacts/ui/qa/${name}-full.png`,
      fullPage: true,
      animations: "disabled",
    });
}

test("sidebar toggles, persists, centers icons and supports mobile navigation", async ({
  page,
}, info) => {
  await page.goto("/tasks");
  await expect(page.getByRole("heading", { name: "任务工作台" })).toBeVisible();
  if (info.project.name === "desktop") {
    const shell = page.locator(".app-shell");
    await page.getByRole("button", { name: "收起侧边栏" }).click();
    await expect(shell).toHaveAttribute("data-collapsed", "true");
    const link = page
      .locator(".app-sidebar")
      .getByRole("link", { name: "网关观测", exact: true });
    const bounds = await link.boundingBox();
    const icon = await link.locator("svg").boundingBox();
    expect(
      Math.abs(bounds!.x + bounds!.width / 2 - icon!.x - icon!.width / 2),
    ).toBeLessThan(1);
    await link.hover();
    await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText(
      "网关观测",
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
    .getByRole("link", { name: "网关观测", exact: true })
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
                title: params.has("cursor") ? "第二页任务" : task.title,
              },
            ],
        nextCursor: empty || params.has("cursor") ? null : "next",
      },
    });
  });
  await page.goto("/tasks");
  const search = page.getByRole("textbox", { name: "搜索任务" });
  await search.fill("不存在");
  await search.press("Enter");
  await expect(page.getByText("没有符合条件的任务")).toBeVisible();
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
    .locator('.toolbar [data-slot="input-group"] svg')
    .boundingBox();
  expect(
    Math.abs(input!.y + input!.height / 2 - icon!.y - icon!.height / 2),
  ).toBeLessThan(1);
  await page.getByRole("button", { name: "下一页" }).click();
  await expect(
    page.getByRole("link", { name: "第二页任务", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "返回第一页" }).click();
  await page.getByRole("combobox", { name: "任务状态" }).click();
  await page.getByRole("option", { name: "失败", exact: true }).click();
  await expect(page.getByText("没有符合条件的任务")).toBeVisible();
  await page.getByRole("button", { name: "分派任务", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await captureQa(page, `create-${info.project.name}`);
  await expect(dialog).toHaveCSS("overflow-y", "hidden");
  await expect(dialog.locator('[data-slot="scroll-area-viewport"]')).toHaveCSS(
    "scrollbar-width",
    "none",
  );
  await dialog.getByRole("button", { name: "分派任务", exact: true }).click();
  await expect(dialog).toBeVisible();
  expect(
    await dialog.locator("input:invalid, textarea:invalid").count(),
  ).toBeGreaterThan(0);
  await dialog.getByLabel("工作目录", { exact: true }).fill("/tmp");
  await dialog.getByLabel("任务要求", { exact: true }).fill("检查");
  await dialog
    .getByLabel("工作目录", { exact: true })
    .fill("/__qa_missing_directory__");
  await dialog.getByRole("button", { name: "分派任务", exact: true }).click();
  await expect(dialog.locator('[role="alert"]')).toBeVisible();
  await captureQa(page, `create-invalid-${info.project.name}`);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
});

test("fixed workspace keeps empty and short list pagination at the bottom", async ({
  page,
}, info) => {
  const task = designFixture().task;
  await page.route("**/api/tasks?*", (route) => {
    const q = new URL(route.request().url()).searchParams.get("q");
    return route.fulfill({
      json: {
        items:
          q === "empty"
            ? []
            : Array.from({ length: q === "many" ? 50 : 1 }, (_, i) => ({
                ...task,
                id: `task-${i}`,
              })),
        nextCursor: null,
      },
    });
  });
  const bottoms: number[] = [];
  for (const q of ["empty", "short", "many"]) {
    await page.goto(`/tasks?q=${q}`);
    await expect(page.locator(".pagination")).toContainText(
      q === "empty" ? "0 个任务" : q === "many" ? "50 个任务" : "1 个任务",
    );
    await expect(page.locator(".app-footer")).toHaveCount(0);
    await expect(page.locator('.app-header [data-slot="badge"]')).toHaveCount(
      1,
    );
    const metrics = await page.evaluate(() => {
      const list = document.querySelector(".list-body")!;
      const pagination = document
        .querySelector(".pagination")!
        .getBoundingClientRect();
      const blank = list
        .querySelector('[data-slot="empty"]')
        ?.getBoundingClientRect();
      return {
        height: innerHeight,
        pageHeight: document.documentElement.scrollHeight,
        bottom: pagination.bottom,
        scrollable: list.scrollHeight > list.clientHeight,
        blankHeight: blank?.height,
        listHeight: list.clientHeight,
      };
    });
    expect(metrics.pageHeight).toBeLessThanOrEqual(metrics.height + 1);
    expect(metrics.height - metrics.bottom).toBeLessThanOrEqual(25);
    bottoms.push(metrics.bottom);
    if (q === "empty")
      expect(metrics.blankHeight).toBeGreaterThan(metrics.listHeight - 2);
    if (q === "many") {
      expect(metrics.scrollable).toBe(true);
      await page
        .locator(".list-body")
        .evaluate((element) => (element.scrollTop = element.scrollHeight));
      expect((await page.locator(".app-header").boundingBox())!.y).toBe(0);
    }
    await captureQa(page, `fixed-list-${q}-${info.project.name}`);
  }
  expect(Math.max(...bottoms) - Math.min(...bottoms)).toBeLessThan(1);
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
    ["交付物", "本轮暂无交付物"],
    ["交互", "本轮没有交互请求"],
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
  await page.goto("/tasks");
  await page.getByRole("button", { name: "分派任务", exact: true }).click();
  const dialog = page.getByRole("dialog");
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
  await choose("执行引擎", "OpenCode");
  await expect(dialog.getByRole("alert")).toContainText("Catalog unavailable");
  await expect(
    dialog.getByRole("button", { name: "分派任务", exact: true }),
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
  await choose("执行引擎", "Pi");
  await choose("执行引擎", "OpenCode");
  await choose("模型供应商", "opencode-secondary");
  await choose("模型名称", "opencode secondary quality");
  await captureQa(page, `engine-model-selection-${info.project.name}`);
  await dialog.getByLabel("工作目录", { exact: true }).fill(directory);
  await dialog
    .getByLabel("任务要求", { exact: true })
    .fill("model selection QA");
  const submitted = page.waitForRequest(
    (r) => r.method() === "POST" && r.url().endsWith("/api/tasks"),
  );
  await dialog.getByRole("button", { name: "分派任务", exact: true }).click();
  const payload = (await submitted).postDataJSON();
  expect(payload.engineId).toBe("opencode");
  expect(payload.model).toEqual({
    providerID: "opencode-secondary",
    modelID: "quality",
  });
  await expect(page).toHaveURL(/\/tasks\/[a-f0-9-]+/);
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
  await expect(page.getByText("QA_OFFLINE", { exact: true })).toBeVisible();
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
  await mockTask(page, detail);
  await expect(page.getByText("暂无消息", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "执行轮次" }).click();
  await page
    .getByRole("option", { name: "第 1 轮 · 已完成", exact: true })
    .click();
  await expect(page).toHaveURL(/run=design-run/);
  await expect(page.locator(".markdown h3")).toBeVisible();
  const follow = page.getByRole("switch", { name: "跟随输出" });
  await follow.uncheck();
  await expect(follow).not.toBeChecked();
  await follow.check();
  if (info.project.name === "desktop") {
    await expect(page.locator(".task-aside")).not.toBeVisible();
    await captureQa(page, "task-info-collapsed");
    await page.getByRole("button", { name: "任务信息", exact: true }).click();
    await expect(page.locator(".task-aside")).toBeVisible();
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
  await expect(panel.getByText("本轮暂无错误日志")).toBeInViewport();
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
    sessionId: detail.task.id,
    runId: detail.runs[0].id,
    kind: "permission",
    title: "写入检查报告",
    questions: [],
    state: "resolved",
    policy: "manual",
    createdAt: at,
    resolvedAt: at,
    reply: { decision: "once" },
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
  await page.goto("/tasks/design-fixture?tab=invalid");
  await expect(page.getByRole("tab", { name: "执行记录" })).toHaveAttribute(
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
        await page.goto("/tasks/design-fixture");
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
        page.getByRole("heading", { name: "网关观测", exact: true }),
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
  await page.getByRole("link", { name: "返回任务工作台" }).click();
  await expect(page).toHaveURL(/\/tasks$/);
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
  await page.goto("/tasks");
  await page.getByRole("button", { name: "分派任务", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("工作目录", { exact: true }).fill(directory);
  await dialog
    .getByLabel("任务要求", { exact: true })
    .fill("HTTP compatibility check");
  const submitted = page.waitForRequest(
    (request) =>
      request.method() === "POST" && request.url().endsWith("/api/tasks"),
  );
  await dialog.getByRole("button", { name: "分派任务", exact: true }).click();
  expect((await submitted).postDataJSON().submissionId).toMatch(
    /^[0-9a-f]{32}$/,
  );
  await expect(page).toHaveURL(/\/tasks\/[\w-]+/);
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
  await expect(page).toHaveURL(/\/tasks$/);
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
  await page.goto("/tasks");
  await expect(
    page.getByRole("button", { name: "分派任务", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "分派任务", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("任务名称", { exact: true })
    .fill(`销售分析-${info.project.name}`);
  await dialog.getByLabel("工作目录", { exact: true }).fill(directory);
  await dialog
    .getByLabel("任务要求", { exact: true })
    .fill("汇总销售数据并生成报告");
  await dialog.getByRole("switch", { name: "人工审批权限" }).check();
  await dialog.getByRole("button", { name: "分派任务", exact: true }).click();
  await expect(page).toHaveURL(/\/tasks\/[\w-]+/);
  await expect(
    page.getByRole("region", { name: "本轮待处理交互" }),
  ).toBeVisible();
  await page.screenshot({
    path: `artifacts/ui/approval-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "允许本次", exact: true }).click();
  await page.getByRole("tab", { name: "执行记录" }).click();
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
  await navigate(page, "网关观测");
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
  await navigate(page, "任务工作台");
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
  await expect(page).toHaveURL(/\/tasks$/);
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
  await page.getByRole("button", { name: "刷新任务", exact: true }).click();
  await expect(tool.getByRole("button", { expanded: false })).toBeVisible();
  await tool.getByRole("button", { expanded: false }).click();
  await expect(tool.getByLabel("工具输出")).toHaveText("新的累计结果");
  part.output = "日志行\n".repeat(18000);
  await page.getByRole("button", { name: "刷新任务", exact: true }).click();
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
    sessionId: "design-fixture",
    runId: "design-run",
    kind: "question",
    title: "选择检查范围",
    questions: [
      {
        text: "检查项目",
        options: ["连接", "文件"],
        multiple: true,
        allowCustom: true,
      },
    ],
    state: "pending",
    policy: "manual",
    createdAt: "2026-09-06T06:00:00.000Z",
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
  const pending = page.getByRole("region", { name: "本轮待处理交互" });
  await pending.getByRole("checkbox", { name: "连接", exact: true }).check();
  await pending
    .getByRole("textbox", { name: "检查项目 自定义回答" })
    .fill("存储");
  await pending.getByRole("button", { name: "提交回答" }).click();
  await expect(pending.getByText("CONFLICT", { exact: true })).toBeVisible();
  await expect(
    pending.getByRole("textbox", { name: "检查项目 自定义回答" }),
  ).toHaveValue("存储");
  await pending.getByRole("button", { name: "提交回答" }).click();
  await expect(pending).toHaveCount(0);
  await page.getByRole("tab", { name: "交互", exact: true }).click();
  await expect(page.getByText("已过期", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "提交回答" })).toHaveCount(0);
  await expect(
    page.getByRole("checkbox", { name: "连接", exact: true }),
  ).toBeDisabled();
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
  await expect(page.getByText("SAMPLE_ERROR", { exact: true })).toBeVisible();
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
  detail.messages[0].parts[0].text = "执行输出，保留可读的上下文。\n\n".repeat(
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
  const detail = designFixture();
  detail.messages[0].parts[0].text = "历史记录。\n\n".repeat(100);
  await mockTask(page, detail);
  const log = page.getByLabel("执行消息", { exact: true });
  await log.evaluate((element) => {
    element.scrollTop = 0;
    element.dispatchEvent(new Event("scroll"));
  });
  detail.messages[0].parts[0].text += "新的累计输出";
  await page.getByRole("button", { name: "刷新任务", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "回到最新进度" }),
  ).toBeVisible();
  expect(await log.evaluate((element) => element.scrollTop)).toBe(0);
  await page.getByRole("tab", { name: "交付物" }).click();
  await page.getByRole("tab", { name: "执行记录" }).click();
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
        ["execution", "/tasks/design-fixture"],
        ["tasks", "/tasks"],
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
  const detail = designFixture();
  const toolPart = detail.messages[0].parts[1];
  toolPart.state = "running";
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
    toolPart.state = state;
    await page.getByRole("button", { name: "刷新任务", exact: true }).click();
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

test("task updates keep the focused row in place", async ({ page }) => {
  await page.clock.install();
  const first = designFixture().task;
  const second = { ...first, id: "second", title: "第二个测试任务" };
  let items = [first, second];
  await page.route(/\/api\/tasks(?:\?.*)?$/, (route) =>
    route.fulfill({ json: { items, nextCursor: null } }),
  );
  await page.goto("/tasks");
  await page.getByRole("link", { name: first.title, exact: true }).focus();
  first.status = "failed";
  items = [second, first];
  await page.clock.fastForward(5100);
  await expect(
    page.locator(".task-list tbody tr").first().locator(".status"),
  ).toHaveText("失败");
  await expect(page.locator(".task-title").first()).toHaveText(first.title);
  await page.getByRole("button", { name: "刷新任务列表", exact: true }).focus();
  await expect(page.locator(".task-title").first()).toHaveText(second.title);
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
  await expect(page).toHaveURL(/\/tasks$/);
  expect(requests).toBe(2);
  await expect(page.locator("[data-sonner-toast]")).toContainText("任务已删除");
});

test("settings field errors, failed saves and package confirmations use shared components", async ({
  page,
}) => {
  let settings = {
    piConfigDirectory: "",
    opencodeConfigFile: "",
    providers: [],
    skills: [],
    mcp: [],
  };
  let packages = ["npm:sample-plugin"];
  let writes = 0;
  let removals = 0;
  const view = () => ({
    settings,
    packages,
    revision: String(writes),
    restartRequired: true,
    externalOpenCode: true,
    environmentProvider: true,
    effectivePiDirectory: "/tmp/pi-config",
    local: { pi: "/tmp/pi", opencode: "/tmp/opencode.json" },
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
  await page.route("**/api/settings/pi/packages", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      action: "remove",
      source: "npm:sample-plugin",
    });
    removals++;
    if (removals === 1)
      return route.fulfill({
        status: 500,
        json: { code: "FAILED", message: "卸载失败" },
      });
    packages = [];
    await route.fulfill({ json: view() });
  });
  await page.goto("/settings");
  await expect(page.locator('[data-slot="alert"]')).toHaveCount(3);
  await page.getByRole("tab", { name: "MCP", exact: true }).click();
  await page.getByRole("button", { name: "添加", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("名称", { exact: true }).fill("sample");
  await dialog.getByLabel("命令和参数（JSON 数组）").fill("[");
  await dialog.getByRole("button", { name: "保存配置", exact: true }).click();
  await expect(dialog.getByLabel("命令和参数（JSON 数组）")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(dialog.getByLabel("命令和参数（JSON 数组）")).toHaveAttribute(
    "aria-describedby",
    "config.command-error",
  );
  await expect(dialog.getByRole("alert")).toHaveText("JSON 格式不正确");
  expect(writes).toBe(0);
  await dialog
    .getByLabel("命令和参数（JSON 数组）")
    .fill('["node","server.js"]');
  await dialog.getByLabel("环境变量（JSON 对象）").fill("[]");
  await dialog.getByRole("button", { name: "保存配置", exact: true }).click();
  await expect(dialog.getByLabel("环境变量（JSON 对象）")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await dialog.getByLabel("环境变量（JSON 对象）").fill("{}");
  await dialog.getByRole("button", { name: "保存配置", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("配置版本冲突");
  await expect(dialog.getByLabel("名称", { exact: true })).toHaveValue(
    "sample",
  );
  await dialog.getByRole("button", { name: "保存配置", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator("[data-sonner-toast]").last()).toContainText(
    "配置已保存",
  );
  await page.getByRole("tab", { name: "Pi 插件", exact: true }).click();
  const uninstall = page.getByRole("button", {
    name: "卸载 npm:sample-plugin",
    exact: true,
  });
  await uninstall.click();
  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toContainText("/tmp/pi-config");
  await page.keyboard.press("Escape");
  await expect(uninstall).toBeFocused();
  expect(removals).toBe(0);
  await uninstall.click();
  await confirmation
    .getByRole("button", { name: "确认卸载", exact: true })
    .click();
  await expect(confirmation.getByRole("alert")).toContainText("卸载失败");
  await confirmation
    .getByRole("button", { name: "确认卸载", exact: true })
    .click();
  await expect(confirmation).not.toBeVisible();
  await expect(page.getByText("暂无插件", { exact: true })).toBeVisible();
});

test("model search filters, handles no matches and selects with keyboard", async ({
  page,
}) => {
  await page.goto("/tasks");
  await page.getByRole("button", { name: "分派任务", exact: true }).click();
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
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("single choice keyboard navigation and custom answers remain exclusive", async ({
  page,
}) => {
  const detail = designFixture();
  detail.interactions.push({
    id: "single-choice",
    sessionId: "design-fixture",
    runId: "design-run",
    kind: "question",
    title: "选择输出格式",
    questions: [
      {
        text: "输出格式",
        options: ["Markdown", "JSON"],
        multiple: false,
        allowCustom: true,
      },
    ],
    state: "pending",
    policy: "manual",
    createdAt: "2026-09-06T06:00:00.000Z",
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
  const group = page.getByRole("radiogroup", { name: "输出格式", exact: true });
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
