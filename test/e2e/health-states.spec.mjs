import { expect, test } from "@playwright/test";

test.describe("health states", () => {
  test("keeps the health surface visible when a remote payload is partial", async ({ page }) => {
    await page.clock.install({ time: new Date("2026-08-20T12:00:00.000Z") });
    await page.route("**/*.workers.dev/**", (route) => route.fulfill({ json: {
      ok: true,
      degraded: true,
      version: "2.3.0",
      updatedAt: "2026-08-20T12:00:00.000Z",
      freshUntil: "2026-08-20T12:02:00.000Z",
      currentGW: 1,
      players: [],
      results: [],
      liveFixtures: [],
      odds: [],
      news: [],
      sources: { apiFootball: true, footballData: true, news: false, odds: false, fpl: true },
      errors: { news: "timeout", odds: "HTTP 401" },
    } }));
    await page.goto("/");
    await expect(page.locator("#dataHealth")).toBeVisible();
    await expect(page.locator("#dataHealthTitle")).not.toHaveText("");
    await expect(page.locator("#dataHealthDetail")).not.toHaveText("");
  });
});
