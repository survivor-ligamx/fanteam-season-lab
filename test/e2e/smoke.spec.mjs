import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";

const V1_FIXTURE = fileURLToPath(
  new URL("../frontend/fixtures/backup-v1.json", import.meta.url),
);
const APP_FILE_URL = pathToFileURL(
  fileURLToPath(new URL("../../index.html", import.meta.url)),
).href;

const workerPayload = {
  ok: true,
  service: "fanteam-data",
  version: "e2e",
  updatedAt: "2026-08-20T12:00:00.000Z",
  currentGW: 1,
  players: [],
  results: [],
  liveFixtures: [],
  odds: [],
  news: [],
  sources: {
    apiFootball: false,
    footballData: false,
    news: false,
    odds: false,
  },
  errors: {},
};

test("navega, renderiza y restaura un backup legacy en Chromium", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-08-20T12:00:00.000Z") });
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  await page.route("**/*.workers.dev/**", (route) => route.fulfill({ json: workerPayload }));

  await page.goto("/");
  await expect(page).toHaveTitle("FanTeam Intelligence 2026/27");
  await expect(page.locator("#captainName")).not.toHaveText("—");
  await expect(page.locator("#pitch .player")).toHaveCount(11);
  await expect(page.locator("#bench .benchCard")).toHaveCount(4);

  await page.locator('button[data-tab="planner"]').click();
  await expect(page.locator("#planner")).toHaveClass(/active/);
  await expect(page.locator("#sixWeekPlan .week")).toHaveCount(6);

  await page.locator('button[data-tab="market"]').click();
  await expect(page.locator("#market")).toHaveClass(/active/);
  await expect(page.locator("#marketBody tr")).toHaveCount(160);

  await page.locator('button[data-tab="squad"]').click();
  const downloadPromise = page.waitForEvent("download");
  await page.locator("#exportSeason").click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  const backup = JSON.parse(await readFile(downloadPath, "utf8"));
  expect(backup.app).toBe("fanteam-season-lab");
  expect(backup.v).toBe(5);
  expect(backup.state.squad).toHaveLength(15);

  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#importFile").setInputFiles(V1_FIXTURE);
  await expect(page.locator("#toast")).toContainText("Temporada importada");
  await expect(page.locator("#sideGW")).toHaveText("GW2");
  await expect(page.locator("#pitch .player")).toHaveCount(11);

  expect(browserErrors).toEqual([]);
});

test("abre la aplicación y sus módulos clásicos mediante file://", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-08-20T12:00:00.000Z") });
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  await page.route("**/*.workers.dev/**", (route) => route.fulfill({ json: workerPayload }));

  await page.goto(APP_FILE_URL);
  await expect(page).toHaveTitle("FanTeam Intelligence 2026/27");
  await expect(page.locator("#pitch .player")).toHaveCount(11);
  await expect(page.locator("#bench .benchCard")).toHaveCount(4);
  expect(await page.evaluate(() => ({
    backupType: typeof globalThis.FanTeamSeasonBackup,
    backupVersion: globalThis.FanTeamSeasonBackup?.VERSION,
    scoringType: typeof globalThis.FanTeamScoring,
    scoringVersion: globalThis.FanTeamScoring?.VERSION,
    importType: typeof globalThis.FanTeamImport,
    importVersion: globalThis.FanTeamImport?.VERSION,
    financeType: typeof globalThis.FanTeamFinance,
    financeVersion: globalThis.FanTeamFinance?.VERSION,
    projectionType: typeof globalThis.FanTeamProjection,
    projectionVersion: globalThis.FanTeamProjection?.VERSION,
    transfersType: typeof globalThis.FanTeamTransfers,
    transfersVersion: globalThis.FanTeamTransfers?.VERSION,
  }))).toEqual({
    backupType: "object",
    backupVersion: 5,
    scoringType: "object",
    scoringVersion: "fanteam-v1",
    importType: "object",
    importVersion: "fanteam-import-v1",
    financeType: "object",
    financeVersion: "fanteam-finance-v1",
    projectionType: "object",
    projectionVersion: "fanteam-projection-v1",
    transfersType: "object",
    transfersVersion: "fanteam-transfers-v1",
  });
  expect(browserErrors).toEqual([]);
});
