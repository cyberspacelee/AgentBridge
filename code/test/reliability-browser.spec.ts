import { test, expect } from "@playwright/test";
import { navigate } from "./navigation.mjs";

test("SSE recovers from a terminal HTTP failure", async ({ page }) => {
  let attempts = 0;
  await page.route("**/event", (route) => {
    if (++attempts === 1) return route.fulfill({ status: 503, body: "temporarily full" });
    return route.continue();
  });
  await page.goto("/conversations");
  await expect.poll(() => attempts).toBeGreaterThan(1);
  await expect(page.getByLabel("网关事件连接：live")).toBeVisible();
});

test("leaving a pending submission prevents late navigation and retains its idempotency key for retry", async ({ page, request }) => {
  const { directory } = await (await request.get("/__test/directory")).json();
  const bodies: { submissionId: string }[] = [];
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  let reconciliations = 0;
  await page.route("**/api/submissions/**", (route) => { reconciliations++; return route.fulfill({ status: 404 }); });
  await page.route(/\/api\/tasks$/, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const body = route.request().postDataJSON();
    bodies.push(body);
    if (bodies.length === 1) await blocked;
    await route.fulfill({ status: 202, json: { submissionId: body.submissionId, taskId: "recovered-session", sessionId: "recovered-session", runId: "recovered-run", acceptedAt: new Date().toISOString() } }).catch(() => {});
  });
  const send = async () => {
    await page.getByRole("button", { name: "模型与会话设置", exact: true }).click();
    const form = page.getByRole("form", { name: "新会话" });
    await form.getByLabel("服务器工作目录", { exact: true }).fill(directory);
    await form.getByLabel("消息", { exact: true }).fill("retry the same request");
    await form.getByRole("button", { name: "发送消息", exact: true }).click();
  };
  try {
    await page.goto("/conversations");
    await send();
    await expect.poll(() => bodies.length).toBe(1);
    await navigate(page, "运行观测");
    await expect(page).toHaveURL(/\/observability/);
    release();
    await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage).filter((key) => key.startsWith("agentbridge:submission:")).length)).toBe(1);
    await navigate(page, "新会话");
    await send();
    await expect(page).toHaveURL(/\/conversations\/recovered-session$/);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]!.submissionId).toBe(bodies[0]!.submissionId);
    expect(reconciliations).toBe(0);
  } finally { release(); }
});
