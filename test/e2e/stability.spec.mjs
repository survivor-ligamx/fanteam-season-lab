import { devices, expect, test } from "@playwright/test";

const workerPayload = {
  ok: true,
  service: "fanteam-data",
  version: "e2e-stability",
  updatedAt: "2026-08-20T12:00:00.000Z",
  freshUntil: "2026-08-20T12:02:00.000Z",
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
    fpl: false,
  },
  sourceMeta: {},
  errors: {},
};

async function routeWorker(target) {
  await target.route("**/*.workers.dev/**", (route) => route.fulfill({ json: workerPayload }));
}

async function expectAppReady(page) {
  await expect(page.locator("#pitch .player")).toHaveCount(11);
  await expect.poll(() => page.evaluate(() => {
    const storage = globalThis.FanTeamSeasonStorage;
    return Boolean(storage && localStorage.getItem(storage.STATE_KEY));
  })).toBe(true);
}

test("funciona en un contexto móvil aislado aunque localStorage esté denegado", async ({ browser }) => {
  const context = await browser.newContext({ ...devices["Pixel 7"] });
  await context.addInitScript(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("storage denegado", "SecurityError");
      },
    });
  });
  await routeWorker(context);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto("/");

  await expect(page).toHaveTitle("FanTeam Intelligence 2026/27");
  await expect(page.locator("#pitch .player")).toHaveCount(11);
  await expect(page.locator("#bench .benchCard")).toHaveCount(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  await context.close();
});

test("dos pestañas convergen al último estado, ignoran eventos viejos y propagan reset", async ({ context }) => {
  await routeWorker(context);
  const first = await context.newPage();
  const second = await context.newPage();
  await first.goto("/");
  await second.goto("/");
  await expectAppReady(first);
  await expectAppReady(second);
  await expect(first.locator("#sideGW")).toHaveText("GW1");
  await expect(second.locator("#sideGW")).toHaveText("GW1");

  const stateA = await first.evaluate(() => {
    const key = globalThis.FanTeamSeasonStorage.STATE_KEY;
    const next = JSON.parse(localStorage.getItem(key));
    next.gw = 2;
    next.autoDraft = { ...(next.autoDraft || {}), enabled: false, status: "paused" };
    const raw = JSON.stringify(next);
    localStorage.setItem(key, raw);
    return raw;
  });
  await expect(second.locator("#sideGW")).toHaveText("GW2");

  await second.evaluate(() => {
    const key = globalThis.FanTeamSeasonStorage.STATE_KEY;
    const next = JSON.parse(localStorage.getItem(key));
    next.gw = 3;
    const raw = JSON.stringify(next);
    localStorage.setItem(key, raw);
    dispatchEvent(new StorageEvent("storage", { key, newValue: raw }));
  });
  await expect(first.locator("#sideGW")).toHaveText("GW3");
  await expect(second.locator("#sideGW")).toHaveText("GW3");

  await second.evaluate((stale) => {
    dispatchEvent(new StorageEvent("storage", {
      key: globalThis.FanTeamSeasonStorage.STATE_KEY,
      newValue: stale,
    }));
  }, stateA);
  await expect(second.locator("#sideGW")).toHaveText("GW3");

  await first.evaluate(() => {
    localStorage.removeItem(globalThis.FanTeamSeasonStorage.STATE_KEY);
  });
  await expect(second.locator("#sideGW")).toHaveText("GW1");
  await expect(second.locator("#toast")).toContainText("restablecida desde otra pestaña");
});

test("ignora eventos de almacenamiento corruptos y conserva la temporada visible", async ({ context }) => {
  await routeWorker(context);
  const first = await context.newPage();
  const second = await context.newPage();
  await first.goto("/");
  await second.goto("/");
  await expectAppReady(first);
  await expectAppReady(second);
  await expect(second.locator("#sideGW")).toHaveText("GW1");

  await first.evaluate(() => {
    const key = globalThis.FanTeamSeasonStorage.STATE_KEY;
    const current = JSON.parse(localStorage.getItem(key));
    current.gw = 9;
    current.squad = Array(15).fill(current.squad[0]);
    localStorage.setItem(key, JSON.stringify(current));
  });

  await expect(second.locator("#sideGW")).toHaveText("GW1");
  await expect(second.locator("#pitch .player")).toHaveCount(11);

  await first.evaluate(() => {
    localStorage.setItem(globalThis.FanTeamSeasonStorage.STATE_KEY, "{corrupto");
  });

  await expect(second.locator("#sideGW")).toHaveText("GW1");
  await expect(second.locator("#pitch .player")).toHaveCount(11);
});
