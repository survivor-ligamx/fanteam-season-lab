import { expect, test } from "@playwright/test";

test.describe("health states", () => {
  test("renders partial health state instead of hiding a degraded payload", async ({ page }) => {
    await page.clock.install({ time: new Date("2026-08-20T12:00:00.000Z") });
    await page.route("**/*.workers.dev/**", (route) => route.fulfill({ json: {
      ok: true, degraded: true, version: "2.3.0", updatedAt: "2026-08-20T12:00:00.000Z", freshUntil: "2026-08-20T12:02:00.000Z", currentGW: 1, players: [], results: [], liveFixtures: [], odds: [], news: [],
      sources: { apiFootball: true, footballData: true, news: false, odds: false, fpl: true }, errors: { news: "timeout", odds: "HTTP 401" }
    } }));
    await page.goto("/");
    await expect(page.locator("#dataHealth")).toBeVisible();
    await expect(page.locator("#dataHealth")).toContainText(/parcial|degrad/i);
  });
});
