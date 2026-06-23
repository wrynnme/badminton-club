import { defineConfig, devices } from "@playwright/test";

// Net-zero E2E against the local dev server (which talks to the project's single
// Supabase). global-setup seeds a throwaway club + mints an owner cookie;
// global-teardown deletes it. Local-only — NOT wired into CI (CI hitting prod = no).
// Run: `npm run e2e` (dev server auto-started/reused on :3000).
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // tests share one seeded club → run serially
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    storageState: "./e2e/.auth/state.json",
    trace: "on-first-retry",
    locale: "th-TH",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
