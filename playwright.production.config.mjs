import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "test/production",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  timeout: 45_000,
  expect: {
    timeout: 25_000,
  },
  reporter: [["line"]],
  outputDir: "test-results/production",
  use: {
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "production-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
