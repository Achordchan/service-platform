import { defineConfig, devices } from "@playwright/test";
import { e2eWebServerEnv, loadE2EEnv } from "./e2e/load-e2e-env";

const loadedFrom = loadE2EEnv();
const webServerEnv = e2eWebServerEnv();

// Destructive E2E always targets a local server bound to the *_test database.
// Remote/production acceptance must use a separate read-only suite.
const LOCAL_BASE_URL = "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"]],
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL: LOCAL_BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
  },
  webServer: {
    command: "pnpm dev -H 127.0.0.1 -p 3000",
    url: `${LOCAL_BASE_URL}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: webServerEnv,
  },
  metadata: {
    e2eEnvFile: loadedFrom,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
