import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";

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
      engineId: "browser-test",
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
  await page.screenshot({ path: `artifacts/ui/approval-${info.project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "允许本次", exact: true }).click();
  await page.getByRole("tab", { name: "执行记录" }).click();
  await expect(
    page.getByText("销售分析已完成，结果已写入 report.md。"),
  ).toBeVisible();
  await page.getByText("write", { exact: true }).click();
  await expect(page.getByText("Wrote report.md")).toBeVisible();
  await page.screenshot({ path: info.outputPath("task.png"), fullPage: true });
  await page.getByRole("tab", { name: "交付物" }).click();
  await page.screenshot({ path: `artifacts/ui/artifacts-${info.project.name}.png`, fullPage: true });
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
  await page.screenshot({ path: `artifacts/ui/running-${info.project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "停止任务", exact: true }).click();
  await page.getByRole("button", { name: "确认停止" }).click();
  await expect(page.getByRole("dialog")).not.toBeVisible();
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
    await trigger.evaluate((element) => getComputedStyle(element).outlineStyle),
  ).not.toBe("none");
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
  const clippedControls = await page.locator('header button:visible, header [role="combobox"]:visible, main button:visible').evaluateAll(elements => elements.filter(element => {
    const rect = element.getBoundingClientRect();
    return rect.left < -1 || rect.right > innerWidth + 1;
  }).map(element => element.getAttribute("aria-label") || element.textContent));
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
  await page.route(/\/api\/tasks(?:\?.*)?$/, route => route.fulfill({ json: { items, nextCursor: null } }));
  await page.goto("/tasks");
  await page.getByRole("link", { name: first.title, exact: true }).focus();
  first.status = "failed";
  items = [second, first];
  await page.clock.fastForward(5100);
  await expect(page.locator(".task-list tbody tr").first().locator(".status")).toHaveText("失败");
  await expect(page.locator(".task-title").first()).toHaveText(first.title);
  await page.getByRole("button", { name: "刷新任务列表", exact: true }).focus();
  await expect(page.locator(".task-title").first()).toHaveText(second.title);
});
