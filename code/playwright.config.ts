import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.AGENT_BROWSER_PORT ?? 3010);

export default defineConfig({
  testDir: "./test",
  testMatch: ["browser.spec.ts", "runtime-browser.spec.ts", "network-browser.spec.ts", "reliability-browser.spec.ts"],
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: { baseURL: `http://127.0.0.1:${port}`, trace: "retain-on-failure" },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "mobile",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        deviceScaleFactor: 1,
      },
    },
  ],
  webServer: {
    command: "pnpm exec tsx test/browser-server.ts",
    url: `http://127.0.0.1:${port}/health/ready`,
    reuseExistingServer: false,
    timeout: 30000,
    stdout: "ignore",
  },
});
