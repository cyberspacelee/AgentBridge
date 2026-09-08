import { test, expect, type Page } from "@playwright/test";
import type { NetworkInput, NetworkView } from "../web/src/lib/desktop.js";

async function networkFixture(page: Page) {
  await page.addInitScript(() => {
    const calls = { tests: [] as { input: NetworkInput; url: string }[], saves: [] as NetworkInput[], restarts: 0 };
    let view: NetworkView = {
      settings: { mode: "manual", proxyUrl: "http://proxy.example.com:8080", proxyUsername: "employee", noProxy: "", useSystemCa: false, caFile: "" },
      hasPassword: true,
      restartRequired: false,
    };
    Object.assign(window, {
      networkCalls: calls,
      agentBridge: {
        version: "test",
        getNetworkSettings: async () => structuredClone(view),
        saveNetworkSettings: async (input: NetworkInput) => {
          if (input.noProxy === "reject-save") throw new Error("网络设置未能保存");
          calls.saves.push(structuredClone(input));
          const { proxyPassword, ...settings } = input;
          view = { settings, hasPassword: proxyPassword === undefined ? view.hasPassword : !!proxyPassword, restartRequired: true };
          return structuredClone(view);
        },
        testNetworkSettings: async (input: NetworkInput, url: string) => {
          calls.tests.push({ input: structuredClone(input), url });
          if (url.endsWith("/fail")) throw new Error("代理连接失败");
          return { status: 200, durationMs: 12 };
        },
        selectCertificate: async () => "/certificates/企业 CA.pem",
        restart: async () => { calls.restarts++; return false; },
      },
    });
  });
}

test("desktop network settings test drafts, keep secrets private, save and request restart", async ({ page }, info) => {
  await networkFixture(page);
  await page.goto("/settings");
  const pane = page.getByRole("region", { name: "网络与代理", exact: true });
  const password = pane.getByLabel("代理密码", { exact: true });
  await expect(password).toHaveValue("");
  await expect(password).toHaveAttribute("placeholder", "已配置，留空保留");
  await pane.getByLabel("代理地址", { exact: true }).fill("http://employee:secret@proxy.example.com:8080");
  await pane.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect(pane.getByText("地址中不能包含用户名或密码", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => Reflect.get(window, "networkCalls").tests)).toHaveLength(0);
  await pane.getByLabel("代理地址", { exact: true }).fill("https://proxy.example.com:8443");
  await password.fill("new-test-password");
  await pane.getByLabel("绕过代理的地址", { exact: true }).fill("intranet.example.com");
  await pane.getByRole("checkbox", { name: "信任系统证书（含企业 CA）", exact: true }).check();
  await pane.getByRole("button", { name: "选择 CA 证书", exact: true }).click();
  await expect(pane.getByLabel("附加 CA 证书", { exact: true })).toHaveValue("/certificates/企业 CA.pem");
  await pane.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect(pane.getByText("HTTP 200 · 12 ms", { exact: true })).toBeVisible();
  const tested = await page.evaluate(() => Reflect.get(window, "networkCalls"));
  expect(tested.saves).toHaveLength(0);
  expect(tested.tests[0]).toEqual({ input: { mode: "manual", proxyUrl: "https://proxy.example.com:8443", proxyUsername: "employee", proxyPassword: "new-test-password", noProxy: "intranet.example.com", useSystemCa: true, caFile: "/certificates/企业 CA.pem" }, url: "https://registry.npmjs.org/" });
  await pane.getByRole("button", { name: "保存", exact: true }).click();
  await expect(password).toHaveValue("");
  await expect(pane.getByText("网络设置已保存，重启后生效", { exact: true })).toBeVisible();
  await expect(pane.getByText("重启会进入现有退出流程，可等待任务完成或停止任务。", { exact: true })).toBeVisible();
  await pane.getByRole("button", { name: "重启应用", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, "networkCalls").restarts)).toBe(1);
  await expect(pane.getByRole("button", { name: "重启应用", exact: true })).toBeEnabled();
  await pane.getByLabel("绕过代理的地址", { exact: true }).fill("other.example.com");
  await expect(pane.getByRole("button", { name: "重启应用", exact: true })).toBeDisabled();
  await pane.getByRole("button", { name: "保存", exact: true }).click();
  expect(await page.evaluate(() => Reflect.get(window, "networkCalls").saves.at(-1))).not.toHaveProperty("proxyPassword");
  await pane.getByRole("button", { name: "清除代理密码", exact: true }).click();
  await expect(password).toHaveAttribute("placeholder", "保存后清除密码");
  await pane.getByRole("button", { name: "保存", exact: true }).click();
  await expect(password).toHaveAttribute("placeholder", "未配置");
  expect(await page.evaluate(() => Reflect.get(window, "networkCalls").saves.at(-1).proxyPassword)).toBe("");
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
  await expect(pane.getByRole("button", { name: "重启应用", exact: true })).toHaveCount(0);
});

test("web settings show the environment configuration entry without desktop controls", async ({ page }) => {
  await page.goto("/settings");
  const pane = page.getByRole("region", { name: "网络与代理", exact: true });
  await expect(pane).toContainText("源码 Web 模式通过启动目录的 .env 配置代理");
  await expect(pane.getByRole("button")).toHaveCount(0);
});
