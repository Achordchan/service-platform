import { defineConfig, devices } from "@playwright/test";
import { e2eWebServerEnv, loadE2EEnv } from "./e2e/load-e2e-env";

const loadedFrom = loadE2EEnv();
const webServerEnv = e2eWebServerEnv();

// Destructive E2E always targets a local server bound to the *_test database.
// Remote/production acceptance must use a separate read-only suite.
const LOCAL_BASE_URL = "http://127.0.0.1:3000";

// CI 跑生产构建（next build + next start），而非 next dev：
// dev 是按需懒编译，首次访问路由才现场编译，2 核 runner 上动辄卡几十秒，
// 直接击穿超时（尤其实时投递等重用例）。生产构建路由预编译、占用更低、响应稳定，
// 是 E2E 不再靠重跑的关键。本地保留 next dev 以便边改边测。
const webServerCommand = process.env.CI
  ? "pnpm build && pnpm start -H 127.0.0.1 -p 3000"
  : "pnpm dev -H 127.0.0.1 -p 3000";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
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
    command: webServerCommand,
    url: `${LOCAL_BASE_URL}/login`,
    reuseExistingServer: false,
    // CI 需覆盖 next build 时间（2 核 runner 上构建 + 启动可达数分钟）
    timeout: process.env.CI ? 420_000 : 120_000,
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
