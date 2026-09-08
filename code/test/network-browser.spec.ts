import { test, expect, type Page } from "@playwright/test";
import type { NetworkInput, NetworkView } from "../shared/system.js";

async function networkFixture(page: Page, native = true) {
  const calls = { tests: [] as { input: NetworkInput; url: string }[], saves: [] as NetworkInput[], restarts: 0 };
  let view: NetworkView = { settings: { mode: "manual", proxyUrl: "http://proxy.example.com:8080", proxyUsername: "employee", noProxy: "", useSystemCa: false, caFile: "" }, hasPassword: true, restartRequired: false, revision: "a".repeat(64), appliedRevision: "a".repeat(64), protection: "file", error: null };
  await page.route("**/api/system", (route) => route.fulfill({ json: { capabilities: { network: true, restart: true } } }));
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
  await pane.getByRole("checkbox", { name: "信任系统证书（含企业 CA）", exact: true }).check();
  await pane.getByRole("button", { name: "选择 CA 证书", exact: true }).click();
  await expect(pane.getByLabel("附加 CA 证书", { exact: true })).toHaveValue("/certificates/企业 CA.pem");
  await pane.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect(pane.getByText(/网关连接：HTTP 200/)).toBeVisible();
  const tested = calls;
  expect(tested.saves).toHaveLength(0);
  expect(tested.tests[0]).toEqual({ input: { mode: "manual", proxyUrl: "https://proxy.example.com:8443", proxyUsername: "employee", proxyPassword: "new-test-password", noProxy: "intranet.example.com", useSystemCa: true, caFile: "/certificates/企业 CA.pem" }, url: "https://registry.npmjs.org/" });
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
  await expect(pane.getByLabel("代理地址", { exact: true })).toHaveValue("http://proxy.example.com:8080");
  await expect(pane.getByRole("button", { name: "测试连接", exact: true })).toBeVisible();
  await expect(pane.getByLabel("上传 CA 证书", { exact: true })).toHaveAttribute("type", "file");
});

test("Web pairs before loading management data and disconnects without persisting the pairing code", async ({ page }) => {
  await networkFixture(page, false);
  let paired = false;
  const code = "browser-test-pairing-code-32-characters";
  await page.route("**/api/access", async (route) => {
    if (route.request().method() === "POST") {
      if (route.request().postDataJSON().code !== code) return route.fulfill({ status: 401, json: { message: "配对码无效" } });
      paired = true;
    }
    if (route.request().method() === "DELETE") paired = false;
    return route.fulfill({ json: { authenticated: paired, required: true } });
  });
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "连接 AgentBridge" })).toBeVisible();
  await expect(page.getByRole("region", { name: "网络与代理" })).toHaveCount(0);
  await page.getByLabel("实例配对码", { exact: true }).fill("incorrect-pairing-code-of-32-characters");
  await page.getByRole("button", { name: "连接实例", exact: true }).click();
  await expect(page.getByText("配对码无效", { exact: true })).toBeVisible();
  await page.getByLabel("实例配对码", { exact: true }).fill(code);
  await page.getByRole("button", { name: "连接实例", exact: true }).click();
  await expect(page.getByRole("heading", { name: "系统信息", exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain(code);
  await page.getByRole("button", { name: "断开浏览器连接", exact: true }).click();
  await expect(page.getByRole("heading", { name: "连接 AgentBridge" })).toBeVisible();
  await expect(page.getByLabel("实例配对码", { exact: true })).toHaveValue("");
});
