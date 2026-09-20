import { defineConfig, devices } from "@playwright/test"

const baseURL = "http://127.0.0.1:3400"

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: "list",
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
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
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: [
    {
      command: "node ../backend/dist/main.js",
      url: "http://127.0.0.1:4000/health",
      timeout: 60_000,
      reuseExistingServer: false,
      env: { NODE_ENV: "test", RUN_MIGRATIONS: "false" },
    },
    {
      command: "npm run start -- --hostname 127.0.0.1 --port 3400",
      url: `${baseURL}/login`,
      timeout: 60_000,
      reuseExistingServer: false,
      env: { NODE_ENV: "production", BACKEND_API_URL: "http://127.0.0.1:4000" },
    },
  ],
})
