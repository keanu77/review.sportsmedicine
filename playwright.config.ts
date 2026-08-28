import { defineConfig, devices } from "@playwright/test";

// Smoke test 跑在 **preview build**（dist/）而不是 dev server——
// 部署到 Cloudflare 的是前者，dev server 的模組轉換與 HMR 都不在正式產物裡。
// webServer 會自己先 build 再 preview，所以 `npm run test:smoke` 一行就能從乾淨狀態跑完。

export default defineConfig({
  testDir: "./tests/smoke",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : [["list"]],
  use: {
    baseURL: "http://localhost:4180",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run build && npx vite preview --port 4180 --strictPort",
    url: "http://localhost:4180",
    // 一律重新 build + 起新 server。reuseExistingServer 會在本機沿用上一輪還開著的
    // preview，於是測到的是**舊的 dist**——改壞程式碼照樣全綠。假綠燈比沒有測試更危險。
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
