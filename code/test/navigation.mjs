/** @param {import("@playwright/test").Page} page @param {string} name */
export async function navigate(page, name) {
  if (await page.getByRole("button", { name: "打开导航" }).isVisible())
    await page.getByRole("button", { name: "打开导航" }).click();
  await page.locator(".workspace-nav:visible").getByRole("link", { name, exact: true }).click();
}
