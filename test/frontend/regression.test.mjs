import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createFrontendHarness } from "./harness.mjs";

const plain = (value) => JSON.parse(JSON.stringify(value));
const loadBackupFixture = async (version) => JSON.parse(
  await readFile(new URL(`./fixtures/backup-v${version}.json`, import.meta.url), "utf8"),
);

function buildWorstValidSquad(api, gw = 2) {
  const ids = [];
  const clubs = {};
  for (const [position, quota] of Object.entries(plain(api.POS_QUOTA))) {
    const candidates = api.players
      .filter((player) => player.pos === position)
      .sort((left, right) => api.horizon(left, gw) - api.horizon(right, gw));
    for (const player of candidates) {
      const selected = ids.filter((id) => api.byId(id).pos === position).length;
      if (selected >= quota) break;
      if ((clubs[player.club] || 0) >= 3) continue;
      ids.push(player.id);
      clubs[player.club] = (clubs[player.club] || 0) + 1;
    }
  }
  return ids;
}

async function setup(t) {
  const harness = await createFrontendHarness();
  t.after(harness.close);
  return harness;
}

test("carga el dominio real sin ejecutar sincronización ni render inicial", async (t) => {
  const { api, dom } = await setup(t);

  assert.equal(api.players.length, 580);
  assert.equal(api.initial.length, 15);
  assert.equal(api.state.squad.length, 15);
  assert.equal(dom.window.FanTeamSeasonBackup.VERSION, 5);
  assert.equal(typeof dom.window.FanTeamSeasonBackup.parse, "function");
  assert.equal(dom.window.localStorage.getItem("fanteam-data-endpoint"), null);
  const freshUntil = "2026-08-21T18:00:00.000Z";
  assert.equal(api.dataPreparePayload({ freshUntil }, 1).freshUntil, freshUntil);
});

test("catálogo mantiene identidad, clubes y campos estructurales válidos", async (t) => {
  const { api, dom } = await setup(t);
  const clubs = new Set(["ARS", "AVL", "BHA", "BOU", "BRE", "CHE", "CRY", "CVC", "EVE", "FUL", "HUL", "IPS", "LEE", "LIV", "MCI", "MUN", "NEW", "NFO", "SUN", "TOT"]);
  const ids = new Set();
  const identities = new Set();
  const normalize = (value) => String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

  for (const player of api.players) {
    assert.equal(ids.has(player.id), false, `ID duplicado: ${player.id}`);
    ids.add(player.id);
    const identity = `${normalize(player.name)}|${player.club}`;
    assert.equal(identities.has(identity), false, `nombre+club duplicado: ${identity}`);
    identities.add(identity);
    assert.equal(clubs.has(player.club), true, `club inválido: ${player.club}`);
    assert.equal(["GK", "DEF", "MID", "FWD"].includes(player.pos), true);
    assert.equal(Number.isFinite(player.price) && player.price > 0, true);
    const tokens = player.name.trim().split(/\s+/);
    assert.equal(
      tokens.length === 2 && normalize(tokens[0]) === normalize(tokens[1]),
      false,
      `nombre repetido: ${player.name}`,
    );
  }
  const renamed = api.players.find((player) => player.aliases?.includes("Rodri Rodri"));
  assert.equal(renamed.name, "Rodri");
  assert.equal(
    dom.window.FanTeamImport.matchPlayer(
      { name: "Rodri Rodri", club: "MCI" },
      api.players,
      api.resolveClubCode,
    )?.id,
    renamed.id,
  );
  assert.equal(
    api.dataPreparePlayerUpdates([{ name: "Rodri Rodri", club: "MCI", confidence: 5 }]).updates[0]?.id,
    renamed.id,
  );
  assert.equal(ids.size, 580);
});

test("renderiza la jornada y las vistas principales con el estado inicial", async (t) => {
  const { api, dom } = await setup(t);

  assert.doesNotThrow(() => api.renderWeek());
  assert.equal(dom.window.document.querySelectorAll("#marketBody tr").length, 160);
  assert.match(dom.window.document.querySelector("#captainName").textContent, /\S/);
  assert.match(dom.window.document.querySelector("#sixWeekPlan").textContent, /GW1/);
  assert.match(dom.window.document.querySelector("#marketMovementBody").textContent, /Importa precios/);
});

test("calcula scoring FanTeam v1 y respeta fronteras de minutos", async (t) => {
  const { api } = await setup(t);
  const goalkeeper = api.players.find((player) => player.pos === "GK");
  const defender = api.players.find((player) => player.pos === "DEF");
  const midfielder = api.players.find((player) => player.pos === "MID");

  const gkStats = api.normalizeFanTeamStats({
    minutes: 90,
    goals: 1,
    shotsOnTarget: 1,
    saves: 4,
    penaltiesSaved: 1,
    cleanSheet: true,
  });
  const gkScore = api.calculateFanTeamPoints(goalkeeper, gkStats);
  assert.equal(gkScore.points, 22);
  assert.equal(gkScore.breakdown.goals, 8);
  assert.equal(gkScore.breakdown.saves, 2);
  assert.equal(gkScore.breakdown.penaltiesSaved, 5);

  const at59 = api.calculateFanTeamPoints(
    defender,
    api.normalizeFanTeamStats({ minutes: 59, cleanSheet: true }),
  );
  const at60 = api.calculateFanTeamPoints(
    defender,
    api.normalizeFanTeamStats({ minutes: 60, cleanSheet: true }),
  );
  assert.equal(at59.points, 1);
  assert.equal(at60.points, 6);

  const fullMatch = api.normalizeFanTeamStats({ minutos: 90, goles: 1 });
  assert.equal(fullMatch.fullMatch, true);
  assert.equal(api.calculateFanTeamPoints(midfielder, fullMatch).points, 8);

  assert.throws(
    () => api.normalizeFanTeamStats({ minutes: 89, fullMatch: true }),
    /fullMatch exige 90\+ minutos/,
  );
  assert.throws(
    () => api.normalizeFanTeamStats({ minutes: 0, goals: 1 }),
    /sin minutos no puede registrar acciones/,
  );
});

test("normaliza estados legacy, limita históricos y es idempotente", async (t) => {
  const { api } = await setup(t);
  const player = api.players.find((candidate) => candidate.id === api.initial[0]);
  const price = Number((player.price + 0.5).toFixed(1));
  const snapshots = Array.from({ length: 66 }, (_, index) => ({
    seq: 900 - index,
    at: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    gw: index + 1,
    source: `legacy-${index}`,
    coverage: 1,
    changes: { [player.id]: [player.basePrice ?? player.price, price] },
  }));
  const legacy = {
    squad: plain(api.initial),
    gw: 99,
    free: -8,
    history: Array.from({ length: 40 }, (_, index) => ({
      gw: index + 1,
      decision: "Guardar transferencia",
    })),
    wc1: 1,
    wc2: 0,
    bank: -4,
    priceOverrides: { [player.id]: price, desconocido: 99 },
    purchasePrices: {},
    priceHistory: [],
    marketPriceHistory: snapshots,
    actualsByGW: {},
  };

  const migrated = api.migrateState(plain(legacy));
  assert.equal(migrated.gw, 38);
  assert.equal(migrated.free, 0);
  assert.equal(migrated.bank, 0);
  assert.equal(migrated.history.length, 38);
  assert.equal(migrated.marketPriceHistory.length, 64);
  assert.equal(migrated.marketPriceHistory[0].seq, 1);
  assert.equal(migrated.marketPriceHistory.at(-1).seq, 64);
  assert.equal(migrated.priceOverrides[player.id], price);
  assert.equal("desconocido" in migrated.priceOverrides, false);
  assert.equal(migrated.purchasePrices[player.id] > 0, true);
  assert.equal(migrated.wc1, true);
  assert.equal(migrated.wc2, false);

  const once = plain(migrated);
  const twice = plain(api.migrateState(plain(migrated)));
  assert.deepEqual(twice, once);
});

test("muestra conciliación persistente cuando recupera una plantilla huérfana", async (t) => {
  const { api, dom } = await setup(t);
  api.setState({
    ...plain(api.state),
    squad: [...plain(api.initial.slice(0, 14)), 999999999],
    bank: 7.3,
    purchasePrices: { 999999999: 4.5 },
  });

  api.renderWeek();

  assert.equal(api.state.squad.length, 15);
  assert.equal(api.state.recovery.originalSquad.at(-1), 999999999);
  assert.equal(api.state.recovery.originalFinances.bank, 7.3);
  const banner = dom.window.document.querySelector("#recoveryBanner");
  assert.equal(banner.hidden, false);
  assert.match(banner.textContent, /Saldo original: 7\.3M; saldo reconstruido:/);
  assert.equal(dom.window.document.querySelector("#priceBankLabel").textContent, "Saldo reconstruido");
});

test("parsea precios y conserva el último movimiento observado por jugador", async (t) => {
  const { api } = await setup(t);
  const first = api.players[0];
  const second = api.players[1];
  const firstPrice = Number((first.price + 0.5).toFixed(1));
  const secondPrice = Number((second.price - 0.5).toFixed(1));

  const csv = api.parsePriceInput(
    `id,name,club,price\n${first.id},${first.name},${first.club},${firstPrice}`,
    "precios.csv",
  );
  assert.equal(csv.length, 1);
  assert.equal(csv[0].id, String(first.id));

  const firstImport = api.applyPriceUpdates(csv, "primer.csv");
  assert.equal(firstImport.applied, 1);
  assert.equal(firstImport.changed, 1);
  assert.equal(firstImport.snapshotAdded, true);

  const duplicate = api.applyPriceUpdates(
    api.parsePriceInput(JSON.stringify({ players: [{ id: first.id, price: firstPrice }] }), "precios.json"),
    "duplicado.json",
  );
  assert.equal(duplicate.changed, 0);
  assert.equal(duplicate.snapshotAdded, false);

  const secondImport = api.applyPriceUpdates(
    [{ id: second.id, price: secondPrice }],
    "segundo.json",
  );
  assert.equal(secondImport.snapshotAdded, true);
  assert.equal(api.state.marketPriceHistory.length, 2);
  assert.equal(api.priceMovementFor(first).latest, 0.5);
  assert.equal(api.priceMovementFor(second).latest, -0.5);
  assert.equal(api.marketPriceMovementSummary().risers[0].p.id, first.id);
  assert.equal(api.marketPriceMovementSummary().fallers[0].p.id, second.id);

  assert.throws(
    () => api.applyPriceUpdates([
      { id: first.id, price: firstPrice },
      { id: first.id, price: firstPrice + 0.5 },
    ]),
    /precios conflictivos/,
  );
});

test("limita el historial de mercado a 64 cortes secuenciales", async (t) => {
  const { api } = await setup(t);
  const player = api.players[0];
  const low = player.price;
  const high = Number((low + 0.5).toFixed(1));

  for (let index = 0; index < 65; index += 1) {
    api.applyPriceUpdates(
      [{ id: player.id, price: index % 2 === 0 ? high : low }],
      `corte-${index}.json`,
    );
  }

  assert.equal(api.state.marketPriceHistory.length, 64);
  assert.equal(api.state.marketPriceHistory[0].seq, 2);
  assert.equal(api.state.marketPriceHistory.at(-1).seq, 65);
});

test("respaldo v5 hace round-trip por las rutas reales de producción", async (t) => {
  const { api } = await setup(t);
  const player = api.players[0];
  const state = plain(api.state);
  state.gw = 7;
  state.history = [{
    gw: 6,
    decision: "Guardar transferencia",
    squadIds: plain(api.initial),
    xiIds: plain(api.initial.slice(0, 11)),
    captainId: api.initial[0],
    viceId: api.initial[1],
    forecastByPlayer: { [player.id]: 4.25 },
    transfers: [],
  }];
  state.actualsByGW = {
    6: {
      importedAt: "2026-09-30T12:00:00.000Z",
      source: "fanteam.csv",
      players: { [player.id]: { points: 7, minutes: 90, played: true } },
    },
  };
  state.priceOverrides = { [player.id]: Number((player.price + 0.5).toFixed(1)) };
  api.setState(state);

  const backup = plain(api.createSeasonBackup());
  const restored = api.parseSeasonBackup(plain(backup)).state;

  assert.equal(backup.app, "fanteam-season-lab");
  assert.equal(backup.v, 5);
  assert.equal(restored.gw, 7);
  assert.equal(restored.history.length, 1);
  assert.equal(restored.actualsByGW[6].players[player.id].points, 7);
  assert.equal(restored.priceOverrides[player.id], state.priceOverrides[player.id]);
  assert.throws(
    () => api.parseSeasonBackup({ v: 5, state: { squad: [player.id] } }),
    /estructura inválida/,
  );
});

test("mejor XI conserva formación válida y capitanía dentro del equipo", async (t) => {
  const { api } = await setup(t);
  const result = api.bestXI(api.state.squad, api.state.gw);

  assert.equal(result.xi.length, 11);
  assert.match(result.formation, /^(3-4-3|3-5-2|4-3-3|4-4-2|4-5-1|5-2-3|5-3-2|5-4-1)$/);
  assert.equal(result.xi.some((player) => player.id === result.cap.id), true);
  assert.equal(result.xi.some((player) => player.id === result.vice.id), true);
  assert.notEqual(result.cap.id, result.vice.id);
  assert.equal(Number.isFinite(result.pts), true);
});

test("Wildcard produce una plantilla determinista, válida y dentro del presupuesto", async (t) => {
  const { api } = await setup(t);
  const budget = api.buyingPower();
  const first = api.optimizeWildcard();
  const second = api.optimizeWildcard();

  assert.ok(first, "el optimizador debe encontrar una plantilla factible");
  assert.deepEqual(Array.from(first.ids), Array.from(second.ids));
  assert.equal(first.ids.length, 15);
  assert.equal(new Set(first.ids).size, 15);
  assert.equal(api.clubValid(first.ids), true);
  assert.ok(first.cost <= budget + 0.001);
  assert.equal(Number(first.cost.toFixed(1)), Number(api.value(first.ids).toFixed(1)));

  const positions = Object.fromEntries(Object.keys(plain(api.POS_QUOTA)).map((position) => [position, 0]));
  const clubs = {};
  for (const id of first.ids) {
    const player = api.players.find((candidate) => candidate.id === id);
    positions[player.pos] += 1;
    clubs[player.club] = (clubs[player.club] || 0) + 1;
  }
  assert.deepEqual(positions, plain(api.POS_QUOTA));
  assert.ok(Math.max(...Object.values(clubs)) <= 3);
  assert.equal(Number.isFinite(first.score), true);
  assert.equal(Number.isFinite(first.xiPts), true);
});


test("migra fixtures históricos v1-v5 y conserva las capacidades de cada versión", async (t) => {
  const { api } = await setup(t);
  const restored = {};

  for (const version of [1, 2, 3, 4, 5]) {
    const fixture = await loadBackupFixture(version);
    const parsed = api.parseSeasonBackup(fixture);
    const state = plain(parsed.state);

    assert.equal(fixture.v, version);
    assert.equal(state.gw, version + 1);
    assert.equal(state.squad.length, 15);
    assert.equal(new Set(state.squad).size, 15);
    assert.equal(parsed.endpoint, "https://example.test/worker");
    assert.deepEqual(plain(api.migrateState(plain(state))), state);
    restored[version] = state;
  }

  assert.deepEqual(restored[1].priceOverrides, {});
  assert.deepEqual(restored[1].actualsByGW, {});
  assert.deepEqual(restored[1].marketPriceHistory, []);

  assert.equal(restored[2].priceOverrides[4700673], 13);
  assert.equal(restored[2].purchasePrices[4700673], 12.5);
  assert.equal(restored[2].priceHistory[0].buyingPower, 102.5);

  assert.equal(restored[3].history[0].forecastByPlayer[4700673], 6.5);
  assert.equal(restored[3].actualsByGW[3].players[4700673].points, 9);

  const scored = restored[4].actualsByGW[4].players[4700673];
  assert.equal(scored.scoringVersion, "fanteam-v1");
  assert.equal(scored.points, 7.4);
  assert.equal(scored.reportedPoints, 8);
  assert.equal(scored.breakdown.goals, 4);

  assert.equal(restored[5].marketPriceHistory.length, 1);
  assert.equal(restored[5].marketPriceHistory[0].seq, 1);
  assert.deepEqual(restored[5].marketPriceHistory[0].changes[4700673], [12.5, 13]);
});

test("recomendador respeta FT, umbrales, presupuesto y doble cambio", async (t) => {
  const { api } = await setup(t);
  const optimized = api.optimizeWildcard();
  const optimizedFunds = api.value(optimized.ids);

  const unavailable = api.recommendationFor(optimized.ids, 2, 0, true, optimizedFunds);
  assert.equal(unavailable.type, "save");
  assert.match(unavailable.reason, /No hay transferencias libres/);

  const belowThreshold = api.recommendationFor(optimized.ids, 2, 1, true, optimizedFunds);
  assert.equal(belowThreshold.type, "save");
  assert.ok(belowThreshold.gain < 1.65);

  const lowerThreshold = api.recommendationFor(optimized.ids, 2, 2, true, optimizedFunds);
  assert.equal(lowerThreshold.type, "transfer");
  assert.equal(Boolean(lowerThreshold.double), false);
  assert.ok(lowerThreshold.gain >= 1.05);

  const poorSquad = buildWorstValidSquad(api);
  assert.equal(poorSquad.length, 15);
  assert.equal(api.clubValid(poorSquad), true);

  const single = api.recommendationFor(poorSquad, 2, 1, true, 100);
  assert.equal(single.type, "transfer");
  assert.equal(Boolean(single.double), false);
  assert.equal(single.out.pos, single.inn.pos);
  const singleSquad = api.idsAfterRecommendation(poorSquad, single);
  assert.equal(api.clubValid(singleSquad), true);
  assert.ok(api.value(singleSquad) <= 100.001);

  const double = api.recommendationFor(poorSquad, 2, 2, true, 100);
  assert.equal(double.type, "transfer");
  assert.equal(double.double, true);
  assert.equal(api.transferCount(double), 2);
  assert.ok(double.gain >= single.gain + 1.05);
  const doubleSquad = api.idsAfterRecommendation(poorSquad, double);
  assert.equal(new Set(doubleSquad).size, 15);
  assert.equal(api.clubValid(doubleSquad), true);
  assert.ok(api.value(doubleSquad) <= 100.001);
});

test("planner encadena seis jornadas sin mutar la plantilla de origen", async (t) => {
  const { api } = await setup(t);
  const squad = buildWorstValidSquad(api);
  const bank = Number((100 - api.value(squad)).toFixed(1));
  api.setState({
    ...plain(api.state),
    gw: 2,
    free: 2,
    squad,
    bank,
    history: [],
    decision: null,
  });

  const before = plain(api.state.squad);
  const plan = api.simulateSixWeekPlan();

  assert.equal(plan.start, 2);
  assert.equal(plan.end, 7);
  assert.equal(plan.weeks.length, 6);
  assert.equal(plan.weeks[0].recommendation.double, true);
  assert.equal(plan.weeks[0].used, 2);
  assert.equal(plan.weeks[0].freeAfter, 1);
  assert.equal(Number.isFinite(plan.total), true);
  assert.equal(Number.isFinite(plan.baseline), true);
  assert.equal(Number.isFinite(plan.advantage), true);

  let previousSquad = before;
  for (const [index, week] of plan.weeks.entries()) {
    assert.equal(week.gw, plan.start + index);
    assert.equal(week.squad.length, 15);
    assert.equal(new Set(week.squad).size, 15);
    assert.equal(api.clubValid(week.squad), true);
    assert.ok(week.bankAfter >= -0.001);
    assert.equal(week.freeAfter, api.freeAfterWeek(week.gw, week.freeBefore, week.used));

    const expected = week.recommendation.type === "transfer" && !week.recommendation.alreadyApplied
      ? Array.from(api.idsAfterRecommendation(previousSquad, week.recommendation))
      : previousSquad;
    assert.deepEqual(Array.from(week.squad), expected);
    assert.ok(Math.abs(api.value(week.squad) + week.bankAfter - 100) < 0.01);
    previousSquad = Array.from(week.squad);
  }

  assert.deepEqual(plain(api.state.squad), before);
  assert.equal(plan.finalFree, plan.weeks.at(-1).freeAfter);
  assert.equal(plan.finalBank, plan.weeks.at(-1).bankAfter);
});


test("planner limita GW35–38 y conserva recomendaciones ya aplicadas", async (t) => {
  const { dom } = await setup(t);
  const saveRecommendation = { type: "save", gain: 0, reason: "Guardar" };
  const planner = dom.window.FanTeamPlanner.create({
    recommendationFor: () => saveRecommendation,
    bestXI: (ids, gw) => ({ ids: ids.slice(), gw }),
    captainedTotal: (xi) => xi.gw,
    buyingPower: () => 100,
    transferCount: (recommendation) => (
      recommendation.type === "transfer" ? (recommendation.double ? 2 : 1) : 0
    ),
    idsAfterRecommendation: (ids, recommendation) => ids.map((id) => (
      id === recommendation.out.id ? recommendation.inn.id : id
    )),
    transferBankAfter: (bank, recommendation) => (
      bank + recommendation.out.price - recommendation.inn.price
    ),
    freeAfterWeek: (gw, free, used) => (
      gw === 1 ? 1 : Math.min(37, Math.max(0, free - used) + 1)
    ),
  });

  for (const start of [35, 36, 37, 38]) {
    const plan = planner.simulateSixWeekPlan({
      gameweek: start,
      squad: [1],
      free: 2,
      bank: 1,
    });
    assert.equal(plan.start, start);
    assert.equal(plan.end, 38);
    assert.equal(plan.weeks.length, 39 - start);
    assert.equal(plan.weeks.at(-1).gw, 38);
  }

  const applied = {
    type: "transfer",
    out: { id: 1, price: 5 },
    inn: { id: 2, price: 6 },
    gain: 2,
    reason: "Movimiento fijado",
    alreadyApplied: true,
  };
  const lockedPlan = planner.simulateSixWeekPlan({
    gameweek: 36,
    squad: [2],
    free: 2,
    bank: 0,
    lockedRecommendation: applied,
  });
  assert.deepEqual(plain(lockedPlan.weeks[0].squad), [2]);
  assert.equal(lockedPlan.weeks[0].bankAfter, 0);
  assert.equal(lockedPlan.weeks[0].moves, 1);
  assert.equal(lockedPlan.weeks[0].used, 1);

  const gw1Plan = planner.simulateSixWeekPlan({
    gameweek: 1,
    squad: [1],
    free: 1,
    bank: 1,
    lockedRecommendation: { ...applied, alreadyApplied: false },
  });
  assert.equal(gw1Plan.weeks[0].used, 0);
  assert.equal(gw1Plan.weeks[0].freeAfter, 1);
});

test("aplicación pura valida bloqueo, saldo y FT sin mutar entradas", async (t) => {
  const { api } = await setup(t);
  const squad = buildWorstValidSquad(api);
  const bank = Number((100 - api.value(squad)).toFixed(1));
  const recommendation = api.recommendationFor(squad, 2, 2, true, 100);
  assert.equal(recommendation.type, "transfer");
  assert.equal(recommendation.double, true);

  const state = {
    ...plain(api.state),
    gw: 2,
    free: 2,
    bank,
    squad,
    purchasePrices: Object.fromEntries(squad.map((id) => [id, api.byId(id).price])),
    history: [],
    decision: null,
  };
  const before = plain(state);
  const applied = api.applyCurrentDecision({ state, recommendation });

  assert.equal(applied.ok, true);
  assert.equal(applied.code, "transfer-applied");
  assert.equal(applied.count, 2);
  assert.equal(applied.state.free, 2);
  assert.equal(applied.state.decision.count, 2);
  assert.deepEqual(plain(applied.state.squad), plain(api.idsAfterRecommendation(squad, recommendation)));
  assert.equal(applied.state.bank, api.transferBankAfter(bank, recommendation));
  assert.equal(applied.state.purchasePrices[recommendation.out.id], undefined);
  assert.equal(applied.state.purchasePrices[recommendation.inn.id], recommendation.inn.price);
  assert.equal(applied.state.purchasePrices[recommendation.out2.id], undefined);
  assert.equal(applied.state.purchasePrices[recommendation.inn2.id], recommendation.inn2.price);
  assert.deepEqual(plain(state), before);

  const saved = api.applyCurrentDecision({
    state,
    recommendation: { type: "save", gain: 0, reason: "Guardar desde el plan" },
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.code, "saved");
  assert.equal(saved.state.free, 2);
  assert.equal(saved.state.decision.reason, "Guardar desde el plan");

  const locked = api.applyCurrentDecision({
    state: { ...state, decision: { type: "save" } },
    recommendation,
  });
  assert.deepEqual(plain(locked), { ok: false, code: "decision-locked" });

  const alreadyApplied = api.applyCurrentDecision({
    state,
    recommendation: { ...recommendation, alreadyApplied: true },
  });
  assert.deepEqual(plain(alreadyApplied), { ok: false, code: "already-applied" });

  const withoutEnoughFree = api.applyCurrentDecision({
    state: { ...state, free: 1 },
    recommendation,
  });
  assert.deepEqual(plain(withoutEnoughFree), { ok: false, code: "insufficient-free" });

  const unaffordable = {
    type: "transfer",
    double: false,
    out: recommendation.out,
    inn: {
      ...recommendation.inn,
      price: recommendation.out.price + bank + .2,
    },
    gain: recommendation.gain,
    reason: recommendation.reason,
  };
  const withoutEnoughBank = api.applyCurrentDecision({ state, recommendation: unaffordable });
  assert.deepEqual(plain(withoutEnoughBank), { ok: false, code: "insufficient-bank" });
  assert.deepEqual(plain(state), before);
});

test("adaptador persiste la decisión y difiere el consumo de FT al cierre", async (t) => {
  const { api, dom } = await setup(t);
  const squad = buildWorstValidSquad(api);
  const bank = Number((100 - api.value(squad)).toFixed(1));
  const recommendation = api.recommendationFor(squad, 2, 2, true, 100);
  api.setState({
    ...plain(api.state),
    gw: 2,
    free: 2,
    bank,
    squad,
    history: [],
    decision: null,
  });

  const result = api.applyDecisionToState(recommendation, "Decisión aplicada en prueba");
  assert.equal(result.ok, true);
  assert.equal(api.state.free, 2);
  assert.equal(api.state.decision.count, 2);
  assert.equal(dom.window.document.querySelector("#applyTransfer").disabled, true);
  assert.equal(dom.window.document.querySelector("#saveTransfer").disabled, true);
  assert.equal(dom.window.document.querySelector("#applyPlanFirst").style.display, "none");
  assert.match(dom.window.document.querySelector("#toast").textContent, /Decisión aplicada/);

  const persisted = JSON.parse(dom.window.localStorage.getItem("fanteam-season-lab-v1"));
  assert.equal(persisted.free, 2);
  assert.equal(persisted.decision.count, 2);
  assert.deepEqual(persisted.squad, plain(api.state.squad));

  const fixedState = plain(api.state);
  const blocked = api.applyDecisionToState(recommendation);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, "decision-locked");
  assert.deepEqual(plain(api.state), fixedState);
  assert.match(dom.window.document.querySelector("#toast").textContent, /ya está fijada/);

  dom.window.document.querySelector("#confirmWeek").click();
  assert.equal(api.state.gw, 3);
  assert.equal(api.state.free, 1);
  assert.equal(api.state.decision, null);
  assert.equal(api.state.history.at(-1).gw, 2);
});



test("GW1 permite ajustes consecutivos sin fijar ni consumir FT", async (t) => {
  const { api, dom } = await setup(t);
  const squad = buildWorstValidSquad(api, 1);
  const bank = Number((100 - api.value(squad)).toFixed(1));
  api.setState({
    ...plain(api.state),
    gw: 1,
    free: 1,
    bank,
    squad,
    history: [],
    decision: null,
  });

  const first = api.recommendationFor(squad, 1, 1, true, 100);
  assert.equal(first.type, "transfer");
  const firstResult = api.applyPlanFirstDecision(first);
  assert.equal(firstResult.ok, true);
  assert.equal(api.state.free, 1);
  assert.equal(api.state.decision, null);
  const afterFirst = plain(api.state.squad);
  assert.notDeepEqual(afterFirst, squad);

  const second = api.recommendationFor(
    api.state.squad,
    1,
    api.state.free,
    true,
    api.buyingPower(),
  );
  assert.equal(second.type, "transfer");
  const secondResult = api.applyTransferToState(second);
  assert.equal(secondResult.ok, true);
  assert.equal(api.state.free, 1);
  assert.equal(api.state.decision, null);
  assert.notDeepEqual(plain(api.state.squad), afterFirst);

  const persisted = JSON.parse(dom.window.localStorage.getItem("fanteam-season-lab-v1"));
  assert.equal(persisted.free, 1);
  assert.equal(persisted.decision, null);
  assert.deepEqual(persisted.squad, plain(api.state.squad));
});
