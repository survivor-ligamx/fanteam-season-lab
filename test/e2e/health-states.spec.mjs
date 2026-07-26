import { expect, test } from "@playwright/test";

const PARTIAL_PAYLOAD = {
  ok: true,
  service: "fanteam-data",
  version: "e2e-partial",
  updatedAt: "2026-08-20T12:00:00.000Z",
  freshUntil: "2026-08-20T12:02:00.000Z",
  currentGW: 1,
  players: [],
  results: [],
  liveFixtures: [],
  odds: [],
  news: [],
  sources: {
    apiFootball: true,
    footballData: true,
    news: false,
    odds: false,
    fpl: true,
  },
  errors: { news: "timeout", odds: "HTTP 401" },
};

const SOURCE_ROWS = [
  "#srcFixtures",
  "#srcLineups",
  "#srcNews",
  "#srcOdds",
  "#srcPrices",
  "#srcStats",
  "#lastSync",
];

test("conserva la superficie de salud cuando el payload remoto es parcial", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-08-20T12:00:00.000Z") });
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  await page.route("**/*.workers.dev/**", (route) => route.fulfill({ json: PARTIAL_PAYLOAD }));

  await page.goto("/");
  await expect(page.locator("#pitch .player")).toHaveCount(11);

  // El panel de observabilidad vive en la pestaña "Motor automático": hay que abrirla.
  await page.locator('button[data-tab="automation"]').click();
  await expect(page.locator("#automation")).toHaveClass(/active/);

  await expect(page.locator("#dataHealth")).toBeVisible();
  await expect(page.locator("#dataHealthTitle")).not.toHaveText("");
  await expect(page.locator("#dataHealthDetail")).not.toHaveText("");

  for (const row of SOURCE_ROWS) {
    await expect(page.locator(row)).toBeVisible();
    await expect(page.locator(row)).not.toHaveText("");
  }

  expect(browserErrors).toEqual([]);
});
