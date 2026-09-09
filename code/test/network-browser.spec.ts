import { test, expect, type Page } from "@playwright/test";
import type { GatewayView, NetworkInput, NetworkView } from "../shared/system.js";

async function networkFixture(page: Page, native = true) {
  const calls = { tests: [] as { input: NetworkInput; url: string }[], saves: [] as NetworkInput[], restarts: 0 };
  let view: NetworkView = { settings: { npmRegistry: "https://registry.npmjs.org/", mode: "manual", proxyUrl: "http://proxy.example.com:8080", proxyUsername: "employee", noProxy: "", useSystemCa: false, caFile: "" }, hasPassword: true, restartRequired: false, revision: "a".repeat(64), appliedRevision: "a".repeat(64), protection: "file", error: null };
  await page.route("**/api/system", (route) => route.fulfill({ json: { capabilities: { gateway: true, network: true, restart: true }, maintenance: "ready", version: "fixture", nodeVersion: "fixture", nodePath: "/runtime/node", npmPath: "/runtime/npm/bin/npm-cli.js" } }));
  let gateway: GatewayView = { settings: { host: "127.0.0.1", port: 3010 }, appliedSettings: { host: "127.0.0.1", port: 3010 }, revision: "a".repeat(64), appliedRevision: "a".repeat(64), restartRequired: false, url: "http://127.0.0.1:3010", urls: ["http://127.0.0.1:3010"], error: null };
  await page.route("**/api/system/gateway", async (route) => {
    if (route.request().method() === "PUT") gateway = { ...gateway, settings: route.request().postDataJSON().settings, revision: "b".repeat(64), restartRequired: true };
    await route.fulfill({ json: gateway });
  });
  await page.route("**/api/system/network", async (route) => {
    if (route.request().method() === "PUT") {
      const input = route.request().postDataJSON().settings as NetworkInput;
      if (input.noProxy === "reject-save") return route.fulfill({ status: 409, json: { message: "网络设置未能保存" } });
      calls.saves.push(structuredClone(input));
      const { proxyPassword, ...settings } = input;
      view = { ...view, settings, hasPassword: proxyPassword === undefined ? view.hasPassword : !!proxyPassword, restartRequired: true, revision: "b".repeat(64) };
    }
    return route.fulfill({ json: view });
  });
  await page.route("**/api/system/network/test", async (route) => {
    const { settings, url } = route.request().postDataJSON();
    calls.tests.push({ input: settings, url });
    return route.fulfill(url.endsWith("/fail") ? { status: 409, json: { message: "代理连接失败" } } : { json: { status: 200, durationMs: 12 } });
  });
  await page.route("**/api/system/lifecycle", async (route) => { calls.restarts++; return route.fulfill({ status: 202, json: { accepted: true } }); });
  if (native) await page.addInitScript(() => {
    Object.assign(window, { agentBridge: { selectCertificate: async () => "/certificates/企业 CA.pem" } });
  });
  return calls;
}

test("desktop network settings test drafts, keep secrets private, save and request restart", async ({ page }, info) => {
  const calls = await networkFixture(page);
  await page.goto("/settings");
  const pane = page.getByRole("region", { name: "网络与代理", exact: true });
  await pane.getByRole("button", { name: "连接测试", exact: true }).click();
  const password = pane.getByLabel("代理密码", { exact: true });
  await expect(password).toHaveValue("");
  await expect(password).toHaveAttribute("placeholder", "已配置，留空保留");
  await pane.getByLabel("代理地址", { exact: true }).fill("http://employee:secret@proxy.example.com:8080");
  await pane.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect(pane.getByText("地址中不能包含用户名或密码", { exact: true })).toBeVisible();
  expect(calls.tests).toHaveLength(0);
  await pane.getByLabel("代理地址", { exact: true }).fill("https://proxy.example.com:8443");
  await password.fill("new-test-password");
  await pane.getByLabel("绕过代理的地址", { exact: true }).fill("intranet.example.com");
  await pane.getByRole("button", { name: "证书与 TLS", exact: true }).click();
  await pane.getByRole("checkbox", { name: "信任系统证书（含企业 CA）", exact: true }).check();
  await pane.getByRole("button", { name: "选择 CA 证书", exact: true }).click();
  await expect(pane.getByLabel("附加 CA 证书", { exact: true })).toHaveValue("/certificates/企业 CA.pem");
  await pane.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect(pane.getByText(/网关连接：HTTP 200/)).toBeVisible();
  const tested = calls;
  expect(tested.saves).toHaveLength(0);
  expect(tested.tests[0]).toEqual({ input: { npmRegistry: "https://registry.npmjs.org/", mode: "manual", proxyUrl: "https://proxy.example.com:8443", proxyUsername: "employee", proxyPassword: "new-test-password", noProxy: "intranet.example.com", useSystemCa: true, caFile: "/certificates/企业 CA.pem" }, url: "https://registry.npmjs.org/" });
  await pane.getByRole("button", { name: "保存", exact: true }).click();
  await expect(password).toHaveValue("");
  await expect(pane.getByText("网络设置已保存，重启后生效", { exact: true })).toBeVisible();
  await expect(pane.getByText("重启会进入现有退出流程，可等待任务完成或停止任务。", { exact: true })).toBeVisible();
  await pane.getByRole("button", { name: "应用设置并重启服务", exact: true }).click();
  await page.getByRole("button", { name: "等待任务完成", exact: true }).click();
  await expect.poll(() => calls.restarts).toBe(1);
  await expect(pane.getByRole("button", { name: "应用设置并重启服务", exact: true })).toBeEnabled();
  await pane.getByLabel("绕过代理的地址", { exact: true }).fill("other.example.com");
  await expect(pane.getByRole("button", { name: "应用设置并重启服务", exact: true })).toBeDisabled();
  await pane.getByRole("button", { name: "保存", exact: true }).click();
  expect(calls.saves.at(-1)).not.toHaveProperty("proxyPassword");
  await pane.getByRole("button", { name: "清除代理密码", exact: true }).click();
  await expect(password).toHaveAttribute("placeholder", "保存后清除密码");
  await pane.getByRole("button", { name: "保存", exact: true }).click();
  await expect(password).toHaveAttribute("placeholder", "未配置");
  expect(calls.saves.at(-1)?.proxyPassword).toBe("");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await pane.getByLabel("代理地址", { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("desktop-network.png"), fullPage: true });
});

test("desktop proxy modes and errors preserve the current form", async ({ page }) => {
  await networkFixture(page);
  await page.goto("/settings");
  const pane = page.getByRole("region", { name: "网络与代理", exact: true });
  await pane.getByRole("button", { name: "连接测试", exact: true }).click();
  const mode = pane.getByRole("combobox", { name: "代理模式", exact: true });
  await mode.click();
  await page.getByRole("option", { name: "继承环境代理", exact: true }).click();
  await expect(pane.getByLabel("代理地址", { exact: true })).toHaveCount(0);
  await expect(pane.getByText("使用启动应用时的 HTTP_PROXY、HTTPS_PROXY 和 NO_PROXY 环境变量。", { exact: true })).toBeVisible();
  await mode.click();
  await page.getByRole("option", { name: "不使用代理", exact: true }).click();
  await pane.getByLabel("测试目标 URL", { exact: true }).fill("https://registry.npmjs.org/fail");
  await pane.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect(pane.getByText("代理连接失败", { exact: true })).toBeVisible();
  await expect(pane.getByLabel("测试目标 URL", { exact: true })).toHaveValue("https://registry.npmjs.org/fail");
  await pane.getByLabel("绕过代理的地址", { exact: true }).fill("reject-save");
  await pane.getByRole("button", { name: "保存", exact: true }).click();
  await expect(pane.getByText("网络设置未能保存", { exact: true })).toBeVisible();
  await expect(pane.getByLabel("绕过代理的地址", { exact: true })).toHaveValue("reject-save");
  await expect(pane.getByRole("button", { name: "应用设置并重启服务", exact: true })).toHaveCount(0);
});

test("web settings expose the same network management without Electron", async ({ page }) => {
  await networkFixture(page, false);
  await page.goto("/settings");
  const pane = page.getByRole("region", { name: "网络与代理", exact: true });
  await pane.getByRole("button", { name: "连接测试", exact: true }).click();
  await expect(pane.getByLabel("代理地址", { exact: true })).toHaveValue("http://proxy.example.com:8080");
  await expect(pane.getByRole("button", { name: "测试连接", exact: true })).toBeVisible();
  await expect(pane.getByLabel("上传 CA 证书", { exact: true })).toHaveAttribute("type", "file");
});

test("Web opens management directly without pairing or disconnect controls", async ({ page }) => {
  await networkFixture(page, false);
  await page.route("**/api/access", () => { throw new Error("Removed access API must not be called"); });
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "系统信息", exact: true })).toBeVisible();
  await expect(page.getByLabel("实例配对码", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "断开浏览器连接", exact: true })).toHaveCount(0);
});

test("npm registry presets and custom sources are saved and used as connection test targets", async ({ page }, info) => {
  const calls = await networkFixture(page, false);
  await page.goto("/settings");
  const pane = page.getByRole("region", { name: "网络与代理", exact: true });
  await pane.getByRole("button", { name: "连接测试", exact: true }).click();
  const registry = pane.getByLabel("npm 源", { exact: true });
  await expect(registry).toHaveValue("https://registry.npmjs.org/");
  await pane.getByRole("button", { name: "npmmirror 国内源", exact: true }).click();
  await expect(registry).toHaveValue("https://registry.npmmirror.com/");
  await pane.getByRole("button", { name: "测试连接", exact: true }).click();
  expect(calls.tests.at(-1)?.url).toBe("https://registry.npmmirror.com/");
  expect(calls.saves).toHaveLength(0);
  await pane.getByRole("button", { name: "保存", exact: true }).click();
  expect(calls.saves.at(-1)?.npmRegistry).toBe("https://registry.npmmirror.com/");
  await expect(pane.getByRole("button", { name: "应用设置并重启服务", exact: true })).toBeEnabled();
  await page.reload();
  await expect(registry).toHaveValue("https://registry.npmmirror.com/");
  await registry.fill("http://insecure.example.com/");
  await pane.getByRole("button", { name: "保存", exact: true }).click();
  await expect(registry).toHaveAttribute("aria-invalid", "true");
  expect(calls.saves).toHaveLength(1);
  await registry.fill("https://packages.example.com/repository/npm/");
  await pane.getByRole("button", { name: "保存", exact: true }).click();
  expect(calls.saves.at(-1)?.npmRegistry).toBe("https://packages.example.com/repository/npm/");
  await pane.getByRole("button", { name: "npm 官方源", exact: true }).click();
  await expect(registry).toHaveValue("https://registry.npmjs.org/");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await registry.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("npm-registry.png"), fullPage: true });
});


test("system settings group fields in cards and retain drafts when optional sections collapse", async ({ page }, info) => {
  await networkFixture(page, false);
  await page.goto("/settings");
  for (const name of ["CLI 下载源", "网络代理", "实例信息"]) {
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  }
  const certificates = page.getByRole("button", { name: "证书与 TLS", exact: true });
  const connection = page.getByRole("button", { name: "连接测试", exact: true });
  const limits = page.getByRole("button", { name: "运行限制", exact: true });
  for (const trigger of [certificates, connection, limits]) await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByLabel("附加 CA 证书", { exact: true })).toHaveCount(0);
  await certificates.focus();
  await page.keyboard.press("Enter");
  await expect(certificates).toHaveAttribute("aria-expanded", "true");
  await page.getByLabel("附加 CA 证书", { exact: true }).fill("/certificates/custom.pem");
  await certificates.click();
  await certificates.click();
  await expect(page.getByLabel("附加 CA 证书", { exact: true })).toHaveValue("/certificates/custom.pem");
  await certificates.click();
  await limits.click();
  await expect(page.getByText("最大并发执行数", { exact: true })).toBeVisible();
  await limits.click();
  for (const width of [320, 375, 414, 768]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator("#main-content").evaluate((element) => element.scrollTo(0, 0));
    const bar = page.locator(".config-action-bar");
    const fields = page.getByRole("region", { name: "网络与代理", exact: true }).locator("form > fieldset");
    expect((await bar.boundingBox())!.y).toBeGreaterThanOrEqual((await fields.boundingBox())!.y + (await fields.boundingBox())!.height);
    await bar.scrollIntoViewIfNeeded();
    const frame = (await bar.boundingBox())!;
    for (const button of await bar.getByRole("button").all()) {
      const box = (await button.boundingBox())!;
      expect(box.x).toBeGreaterThan(frame.x + 8);
      expect(box.x + box.width).toBeLessThan(frame.x + frame.width - 8);
      await expect(button).toBeInViewport();
    }
    await page.screenshot({ path: info.outputPath(`settings-actions-${width}.png`) });
    await page.screenshot({ path: info.outputPath(`settings-groups-${width}.png`), fullPage: true });
  }
});

test("gateway settings show public API docs, retain the port and guide Web reconnect", async ({ page }, info) => {
  const calls = await networkFixture(page, false);
  await page.goto("/settings");
  const pane = page.getByRole("region", { name: "网关服务", exact: true });
  await expect(pane.getByLabel("网关端口", { exact: true })).toHaveValue("3010");
  await expect(pane.getByRole("link", { name: "API 文档（OpenAPI）" })).toHaveAttribute("href", "/api/docs");
  await pane.getByLabel("监听地址", { exact: true }).fill("0.0.0.0");
  await pane.getByLabel("网关端口", { exact: true }).fill("3100");
  await pane.getByRole("button", { name: "保存网关设置", exact: true }).click();
  await expect(pane.getByText(/网关设置已保存/)).toBeVisible();
  await page.reload();
  await expect(pane.getByLabel("网关端口", { exact: true })).toHaveValue("3100");
  await pane.getByRole("button", { name: "重启网关", exact: true }).click();
  await page.getByRole("button", { name: "等待任务完成后重启", exact: true }).click();
  await expect.poll(() => calls.restarts).toBe(1);
  await expect(pane.getByRole("link", { name: "使用新地址打开工作台" })).toHaveAttribute("href", "http://127.0.0.1:3100/settings");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await pane.screenshot({ path: info.outputPath("gateway-settings.png") });
});

test("API documentation renders schemas offline and exposes Markdown for agents", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const external: string[] = [];
  await page.route("**/*", (route) => {
    if (new URL(route.request().url()).hostname !== "127.0.0.1") {
      external.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  await page.goto("/api/docs");
  await expect(page.getByRole("heading", { name: /^AgentBridge API/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Markdown 文档（供 Agent 使用）" })).toHaveAttribute("href", "/api/docs.md");
  const session = page.locator("#operations-会话-createSession");
  await session.locator(".opblock-summary-control").click();
  await expect(session.getByText("directory", { exact: true }).first()).toBeVisible();
  await expect(session.getByText("interactionPolicy", { exact: true }).first()).toBeVisible();
  await expect(session.getByText("Request body", { exact: true })).toBeVisible();
  await expect(session.getByText("Responses", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
  await page.screenshot({ path: info.outputPath("api-docs.png"), fullPage: false });
  const markdown = await page.request.get("/api/docs.md");
  expect(markdown.headers()["content-type"]).toContain("text/markdown");
  expect(await markdown.text()).toContain("完整会话调用示例");
});
