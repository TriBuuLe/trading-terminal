import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
export const E2E_DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgres://paper:paper@localhost:5433/paper_terminal_e2e";

/** Smoke test: the app in DEMO_MODE (simulated broker, no Alpaca/GitHub needed). */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1, // specs share one database (the planner profile is global)
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: { baseURL: `http://localhost:${PORT}`, viewport: { width: 1440, height: 900 }, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: `pnpm exec next dev -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DEMO_MODE: "true",
      DATABASE_URL: E2E_DATABASE_URL,
      NEXT_DIST_DIR: ".next-e2e",
      AUTH_SECRET: "e2e-only-secret-e2e-only-secret-e2e-only",
      CRON_SECRET: "e2e-only-cron-secret-0123456789",
      ALLOWED_GITHUB_USER: "demo",
      ALPACA_API_KEY_ID: "",
      ALPACA_API_SECRET_KEY: "",
      FINNHUB_API_KEY: "",
      GEMINI_API_KEY: "",
      DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    },
  },
});
