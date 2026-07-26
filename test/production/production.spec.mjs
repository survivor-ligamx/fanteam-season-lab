import { expect, test } from "@playwright/test";

const APP_URL = process.env.APP_URL || "https://survivor-ligamx.github.io/fanteam-season-lab/";

test("GitHub Pages carga deadlines y ejecuta el Web Worker real", async ({ page }) => {
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });

  const navigation = await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  expect(navigation?.ok()).toBe(true);
  await expect(page).toHaveTitle("FanTeam Intelligence 2026/27");
  await expect(page.locator("#pitch .player")).toHaveCount(11);
  await expect(page.locator("#dataHealth")).toHaveAttribute("role", "status");

  const deadlines = await page.evaluate(() => ({
    version: globalThis.FanTeamDeadlines?.VERSION,
    derived: globalThis.FanTeamDeadlines?.derive([
      { gameweek: 1, kickoff: "2026-08-21T17:30:00Z" },
    ], [])[0],
    scriptLoaded: [...document.scripts]
      .some((script) => script.src.endsWith("/src/fanteam-deadlines.js")),
  }));
  expect(deadlines).toEqual({
    version: "fanteam-deadlines-v1",
    derived: "2026-08-21T16:00:00.000Z",
    scriptLoaded: true,
  });

  // La sincronización vuelve a renderizar Wildcards y cancela cualquier plan activo.
  // Exigir éxito valida la conexión Pages → Worker y evita usar un nodo reemplazado.
  await expect(page.locator("#syncMessage")).toContainText(
    "Recomendaciones recalculadas",
  );

  await page.locator('button[data-tab="wildcards"]').click();
  await page.locator("#wcOptimize").click();
  await expect(page.locator("#wcOptResult")).toContainText("Worker del navegador");
  await expect(page.locator("#wcOptResult")).not.toContainText("fallback seguro");
  await expect(page.locator("#wcOptResult .benchCard")).toHaveCount(15);
  await page.waitForTimeout(500);

  expect(browserErrors).toEqual([]);
});
