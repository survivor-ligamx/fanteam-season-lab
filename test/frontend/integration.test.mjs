import test, { after } from "node:test";
import assert from "node:assert/strict";
import * as vm from "node:vm";
import { readFile } from "node:fs/promises";
import { createFrontendHarness } from "./harness.mjs";

const workerSource = await readFile("src/fanteam-wildcard-worker.js", "utf8");
const harness = await createFrontendHarness();
const { api, dom } = harness;
const fallbackPlan = api.optimizeWildcard();

after(() => harness.close());

function workerReturning(data, capture = {}) {
  return class FakeWorker {
    constructor(url, options) {
      capture.url = String(url);
      capture.options = options;
      capture.instance = this;
    }

    postMessage(payload) {
      capture.payload = payload;
      queueMicrotask(() => this.onmessage?.({ data }));
    }

    terminate() {
      capture.terminated = true;
    }
  };
}

function workerRunningProductionSource(capture = {}) {
  return class SourceWorker {
    postMessage(payload) {
      const host = {
        postMessage: (data) => queueMicrotask(() => this.onmessage?.({ data })),
      };
      vm.runInNewContext(workerSource, { self: host });
      host.onmessage({ data: structuredClone(payload) });
    }

    terminate() {
      capture.terminated = true;
    }
  };
}

test("integra el Web Worker de Wildcard y revalida su resultado con el dominio actual", async () => {
  assert.ok(fallbackPlan, "el catálogo base debe producir una plantilla factible");
  const capture = {};
  const WorkerCtor = workerReturning({ type: "result", ids: fallbackPlan.ids }, capture);

  const result = await api.runWildcardOptimization({ WorkerCtor, timeoutMs: 1000 });

  assert.equal(result.ok, true);
  assert.equal(result.source, "worker");
  assert.equal(result.plan.ids.length, 15);
  assert.equal(result.plan.cost, api.value(result.plan.ids));
  assert.equal(api.clubValid(result.plan.ids), true);
  assert.match(capture.url, /\/src\/fanteam-wildcard-worker\.js$/);
  assert.equal(capture.options.name, "fanteam-wildcard");
  assert.equal(capture.payload.players.length, 580);
  assert.equal(capture.payload.scores.length, 580);
  assert.equal(capture.terminated, true);
});

test("mantiene paridad determinista entre el Worker y el optimizador síncrono", async () => {
  const capture = {};
  const result = await api.runWildcardOptimization({
    WorkerCtor: workerRunningProductionSource(capture),
    timeoutMs: 5000,
  });

  assert.equal(result.source, "worker");
  assert.deepEqual(Array.from(result.plan.ids), Array.from(fallbackPlan.ids));
  assert.equal(result.plan.score, fallbackPlan.score);
  assert.equal(capture.terminated, true);
});

test("usa el optimizador síncrono cuando Worker no está disponible", async () => {
  const result = await api.runWildcardOptimization({
    WorkerCtor: null,
    fallbackOptimizer: () => fallbackPlan,
  });

  assert.equal(result.ok, true);
  assert.equal(result.source, "fallback");
  assert.equal(result.error, "Worker no disponible");
  assert.deepEqual(Array.from(result.plan.ids), Array.from(fallbackPlan.ids));
});

test("rechaza un resultado inválido del Worker antes de usar el fallback", async () => {
  const WorkerCtor = workerReturning({ type: "result", ids: fallbackPlan.ids.slice(0, 14) });
  const result = await api.runWildcardOptimization({
    WorkerCtor,
    timeoutMs: 1000,
    fallbackOptimizer: () => fallbackPlan,
  });

  assert.equal(result.ok, true);
  assert.equal(result.source, "fallback");
  assert.match(result.error, /plantilla inválida/);
  assert.deepEqual(Array.from(result.plan.ids), Array.from(fallbackPlan.ids));
});

test("rechaza candidatos que incumplen la elegibilidad del optimizador", () => {
  let invalidIds = null;
  for (let index = 0; index < fallbackPlan.ids.length && !invalidIds; index += 1) {
    const outgoing = api.byId(fallbackPlan.ids[index]);
    for (const incoming of api.players) {
      if (
        incoming.pos !== outgoing.pos
        || incoming.confidence >= 45
        || fallbackPlan.ids.includes(incoming.id)
      ) continue;
      const candidate = fallbackPlan.ids.slice();
      candidate[index] = incoming.id;
      if (api.clubValid(candidate) && api.value(candidate) <= api.buyingPower() + 0.001) {
        invalidIds = candidate;
        break;
      }
    }
  }

  assert.ok(invalidIds, "el catálogo debe ofrecer un reemplazo estructural no elegible");
  assert.equal(api.validateWildcardCandidate({ ids: invalidIds }), null);
});

test("cancela y termina un Worker obsoleto al invalidar el plan", async () => {
  const capture = {};
  class HangingWorker {
    postMessage() {}
    terminate() { capture.terminated = true; }
  }
  const pending = api.runWildcardOptimization({ WorkerCtor: HangingWorker, timeoutMs: 5000 });
  await Promise.resolve();
  api.clearWildcardPlan();
  const result = await pending;

  assert.equal(result.source, "stale");
  assert.equal(capture.terminated, true);
});

test("integra deadlines oficiales, conserva el fallback y nunca retrocede la jornada", () => {
  const deadlines = api.prepareDeadlineState([
    { gameweek: 1, kickoff: "2026-08-21T19:00:00Z" },
    { gameweek: 1, kickoff: "2026-08-21T17:30:00Z" },
  ], [], {});
  assert.equal(deadlines.list[0], "2026-08-21T16:00:00.000Z");
  assert.equal(deadlines.sources[1], true);

  const fallback = api.prepareDeadlineState([], [], {});
  assert.equal(fallback.list[0], "2026-08-21T17:00:00Z");
  assert.equal(fallback.sources[1], undefined);

  api.applyResults([
    { gameweek: 5, kickoff: "2026-09-18T18:00:00Z" },
  ], []);
  api.setState({ ...api.state, gw: 5 });
  api.renderCountdown();

  assert.equal(api.sync.deadlines[4], "2026-09-18T16:30:00.000Z");
  assert.equal(api.gwDeadline(5).toISOString(), "2026-09-18T16:30:00.000Z");
  assert.equal(api.detectedGW(), 5);
  assert.match(dom.window.document.querySelector("#autoGwLabel").textContent, /primer partido oficial/);
});

test("prioriza la jornada oficial explícita sin duplicar el mismo fixture", () => {
  const raw = {
    home: "Arsenal",
    away: "Liverpool",
    gameweek: 2,
    kickoff: "2026-08-28T18:00:00Z",
  };
  const prepared = api.dataPrepareResults([raw], []);
  const deadlines = api.prepareDeadlineState([raw], [], prepared.deadlines);

  assert.equal(prepared.deadlines[1], undefined);
  assert.equal(prepared.deadlines[2], "2026-08-28T16:30:00.000Z");
  assert.equal(deadlines.list[0], "2026-08-21T17:00:00Z");
  assert.equal(deadlines.list[1], "2026-08-28T16:30:00.000Z");
});

test("avanza estado, cálculos y UI de forma atómica al cruzar un deadline", () => {
  const originalNow = dom.window.Date.now;
  try {
    dom.window.Date.now = () => new Date("2026-08-21T17:00:00.000Z").getTime();
    api.sync.deadlines = [];
    api.sync.deadlineSources = {};
    api.setState({
      ...api.state,
      gw: 1,
      free: 1,
      history: [],
      priceHistory: [],
      decision: { type: "save", reason: "obsoleta" },
    });

    assert.equal(api.advanceDetectedGameweek(), true);
    assert.equal(api.state.gw, 2);
    assert.equal(api.state.free, 1);
    assert.equal(api.state.history.length, 1);
    assert.equal(api.state.decision, null);
    assert.equal(dom.window.document.querySelector("#sideGW").textContent, "GW2");
    assert.equal(api.wildcardWorkerPayload().scores.length, 580);
  } finally {
    dom.window.Date.now = originalNow;
  }
});

test("excluye fixtures cancelados también en el mapeo del payload", () => {
  const prepared = api.dataPrepareResults([
    {
      home: "Arsenal",
      away: "Liverpool",
      gameweek: 3,
      kickoff: "2026-09-04T12:00:00Z",
      status: "CANCELLED",
    },
    {
      home: "Chelsea",
      away: "Tottenham",
      gameweek: 3,
      kickoff: "2026-09-04T17:30:00Z",
      status: "TIMED",
    },
  ], []);

  assert.equal(prepared.deadlines[3], "2026-09-04T16:00:00.000Z");
});

test("deduplica el mismo fixture entre results y liveFixtures conservando la GW explícita", () => {
  const result = {
    id: 9001,
    home: "Arsenal",
    away: "Liverpool",
    gameweek: 2,
    kickoff: "2026-08-28T18:00:00Z",
    status: "TIMED",
  };
  const live = {
    id: 111,
    home: "Arsenal",
    away: "Liverpool",
    kickoff: "2026-08-28T18:00:00Z",
    status: "SCHEDULED",
  };
  const prepared = api.dataPrepareResults([result], [live]);

  assert.deepEqual(Object.keys(prepared.deadlines), ["2"]);
  assert.equal(prepared.deadlines[2], "2026-08-28T16:30:00.000Z");
});

test("el rollover consume dobles transferencias antes de conceder la siguiente", () => {
  const originalNow = dom.window.Date.now;
  try {
    const [out, incoming, out2, incoming2] = api.players.slice(0, 4);
    dom.window.Date.now = () => new Date("2026-08-28T17:00:00.000Z").getTime();
    api.sync.deadlines = [];
    api.sync.deadlineSources = {};
    api.setState({
      ...api.state,
      gw: 2,
      free: 5,
      history: [],
      priceHistory: [],
      seasonComplete: false,
      decision: null,
    });
    api.state.decision = {
      type: "applied",
      count: 2,
      out,
      inn: incoming,
      out2,
      inn2: incoming2,
      gain: 1,
      reason: "doble prueba",
    };

    assert.equal(api.advanceDetectedGameweek(), true);
    assert.equal(api.state.gw, 3);
    assert.equal(api.state.free, 4);
    assert.equal(api.state.history.length, 1);
    assert.equal(api.state.history[0].transfers.length, 2);
  } finally {
    dom.window.Date.now = originalNow;
  }
});

test("el rollover de varias jornadas acumula FT e historial sin saltarse semanas", () => {
  const originalNow = dom.window.Date.now;
  try {
    dom.window.Date.now = () => new Date("2026-09-18T17:00:00.000Z").getTime();
    api.sync.deadlines = [];
    api.sync.deadlineSources = {};
    api.setState({
      ...api.state,
      gw: 2,
      free: 5,
      history: [],
      priceHistory: [],
      seasonComplete: false,
      decision: { type: "save", reason: "guardar" },
    });

    assert.equal(api.advanceDetectedGameweek(), true);
    assert.equal(api.state.gw, 6);
    assert.equal(api.state.free, 9);
    assert.deepEqual(api.state.history.map((entry) => entry.gw), [2, 3, 4, 5]);
  } finally {
    dom.window.Date.now = originalNow;
  }
});

test("el último deadline cierra GW38 y marca la temporada completa", () => {
  const originalNow = dom.window.Date.now;
  try {
    dom.window.Date.now = () => new Date("2027-05-30T17:00:00.000Z").getTime();
    api.sync.deadlines = [];
    api.sync.deadlineSources = {};
    api.setState({
      ...api.state,
      gw: 38,
      history: [],
      priceHistory: [],
      seasonComplete: false,
      decision: { type: "save", reason: "última jornada" },
    });

    assert.equal(api.advanceDetectedGameweek(), true);
    assert.equal(api.state.gw, 38);
    assert.equal(api.state.seasonComplete, true);
    assert.deepEqual(api.state.history.map((entry) => entry.gw), [38]);
  } finally {
    dom.window.Date.now = originalNow;
  }
});



test("syncData corta solicitudes colgadas y conserva la temporada", async () => {
  dom.window.localStorage.setItem("fanteam-data-endpoint", "https://timeout.test/worker");
  api.setState({ ...api.state, autoDraft: { ...api.state.autoDraft, enabled: false } });
  const before = JSON.parse(JSON.stringify(api.state));
  const fetchFn = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal?.addEventListener("abort", () => reject(
      new dom.window.DOMException("abortada", "AbortError"),
    ), { once: true });
  });

  const result = await api.syncData(false, { fetchFn, timeoutMs: 10 });

  assert.deepEqual(JSON.parse(JSON.stringify(api.state.squad)), before.squad);
  assert.equal(result.code, "fallback");
  assert.match(result.error, /tiempo límite/);
  assert.match(dom.window.document.querySelector("#syncMessage").textContent, /Se conserva/);
});

test("caché fresca declarada nunca consume la migración automática", () => {
  const now = Date.now();
  api.setState({
    ...api.state,
    gw: 1,
    history: [],
    seasonComplete: false,
    autoDraft: {
      ...api.state.autoDraft,
      enabled: true,
      policyVersion: "budget-enabler-mid-v2",
      lastInputFingerprint: "legacy",
      history: [],
    },
  });
  const before = Array.from(api.state.squad);
  const payload = {
    ok: true,
    updatedAt: new Date(now).toISOString(),
    freshUntil: new Date(now + 60_000).toISOString(),
    currentGW: 1,
    players: api.players.map((player) => ({
      id: player.id,
      name: player.name,
      club: player.club,
      reference: { minutes: 900, pointsPerGame: 4, xg90: 0.1 },
    })),
    results: [],
    liveFixtures: [],
    odds: [],
    news: [],
    sources: { apiFootball: true, footballData: false, news: false, odds: false, fpl: true },
    sourceMeta: { apiFootball: { stale: true, cacheStatus: "stale-cache" } },
    errors: {},
  };

  api.applyPayload(payload, true);

  assert.deepEqual(Array.from(api.state.squad), before);
  assert.equal(api.state.autoDraft.policyVersion, "budget-enabler-mid-v2");
  assert.equal(api.state.autoDraft.history.length, 0);
  assert.equal(api.sync.fromCache, true);
});

test("API-Football stale no aplica confidence, minutes ni status caducados", () => {
  const selected = api.byId(api.state.squad[0]);
  api.setState({
    ...api.state,
    autoDraft: { ...api.state.autoDraft, enabled: false },
  });
  const before = Array.from(api.state.squad);
  const payload = {
    ok: true,
    updatedAt: new Date().toISOString(),
    freshUntil: new Date(Date.now() + 60_000).toISOString(),
    currentGW: 1,
    players: [{
      id: selected.id,
      name: selected.name,
      club: selected.club,
      confidence: 1,
      minutes: 0,
      status: "Out stale",
      reference: { minutes: 900, pointsPerGame: 4, xg90: 0.1 },
    }],
    results: [],
    liveFixtures: [],
    odds: [],
    news: [],
    sources: { apiFootball: true, footballData: false, news: false, odds: false, fpl: true },
    sourceMeta: { apiFootball: { stale: true, cacheStatus: "stale-cache" } },
    errors: {},
  };

  api.applyPayload(payload, false);

  assert.deepEqual(Array.from(api.state.squad), before);
  assert.equal(selected.confidence, selected.baseConfidence);
  assert.equal(selected.minutes, selected.baseMinutes);
  assert.notEqual(selected.status, "Out stale");
  assert.equal(api.state.autoDraft.status, "paused");
});

test("sincronizaciones concurrentes aplican solo la solicitud más reciente", async () => {
  dom.window.localStorage.setItem("fanteam-data-endpoint", "https://race.test/worker");
  api.setState({ ...api.state, autoDraft: { ...api.state.autoDraft, enabled: false } });
  const firstFetch = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal?.addEventListener("abort", () => reject(
      new dom.window.DOMException("abortada", "AbortError"),
    ), { once: true });
  });
  const latestPayload = {
    ok: true,
    updatedAt: "2026-07-27T02:00:00.000Z",
    freshUntil: "2026-07-27T02:02:00.000Z",
    currentGW: 1,
    players: [],
    results: [],
    liveFixtures: [],
    odds: [],
    news: [],
    sources: { apiFootball: false, footballData: false, news: false, odds: false, fpl: false },
    sourceMeta: {},
    errors: {},
  };
  const secondFetch = async () => ({ ok: true, status: 200, json: async () => latestPayload });

  const first = api.syncData(false, { fetchFn: firstFetch, timeoutMs: 1000 });
  await Promise.resolve();
  const second = api.syncData(false, { fetchFn: secondFetch, timeoutMs: 1000 });
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(firstResult.code, "superseded");
  assert.equal(secondResult.code, "updated");
  assert.equal(api.sync.updatedAt, latestPayload.updatedAt);
  assert.equal(api.sync.lastError, null);
});



test("modo sombra registra una recomendación fresca sin alterar plantilla ni decisión", () => {
  const now = Date.now();
  api.setState({
    ...api.state,
    gw: 2,
    history: [],
    seasonComplete: false,
    decision: { type: "save", gain: 0, reason: "Decisión manual preservada" },
    shadowMode: { enabled: true, history: [] },
  });
  const protectedState = {
    squad: Array.from(api.state.squad),
    bank: api.state.bank,
    purchasePrices: JSON.parse(JSON.stringify(api.state.purchasePrices)),
    decision: JSON.parse(JSON.stringify(api.state.decision)),
  };
  const payload = {
    ok: true,
    updatedAt: new Date(now).toISOString(),
    freshUntil: new Date(now + 60_000).toISOString(),
    currentGW: 2,
    players: [],
    results: [],
    liveFixtures: [],
    odds: [],
    news: [],
    sources: { apiFootball: false, footballData: false, news: false, odds: false, fpl: true },
    sourceMeta: {},
    errors: {},
  };

  api.applyPayload(payload, false);
  api.applyPayload(payload, false);

  assert.deepEqual(Array.from(api.state.squad), protectedState.squad);
  assert.equal(api.state.bank, protectedState.bank);
  assert.deepEqual(JSON.parse(JSON.stringify(api.state.purchasePrices)), protectedState.purchasePrices);
  assert.deepEqual(JSON.parse(JSON.stringify(api.state.decision)), protectedState.decision);
  assert.equal(api.state.shadowMode.history.length, 1);
  const entry = api.state.shadowMode.history[0];
  assert.equal(entry.gw, 2);
  assert.deepEqual(Array.from(entry.squadIds), protectedState.squad);
  assert.match(entry.fingerprint, /^[0-9a-f]{8}$/);
  assert.equal(["save", "transfer"].includes(entry.recommendation.type), true);
});

test("modo sombra ignora caché y respeta desactivación explícita", () => {
  const now = Date.now();
  api.setState({
    ...api.state,
    gw: 2,
    seasonComplete: false,
    shadowMode: { enabled: false, history: [] },
  });
  const payload = {
    ok: true,
    updatedAt: new Date(now).toISOString(),
    freshUntil: new Date(now + 60_000).toISOString(),
    currentGW: 2,
    players: [],
    results: [],
    liveFixtures: [],
    odds: [],
    news: [],
    sources: { apiFootball: false, footballData: false, news: false, odds: false, fpl: true },
    sourceMeta: {},
    errors: {},
  };

  api.applyPayload(payload, false);
  assert.equal(api.state.shadowMode.history.length, 0);

  api.setState({ ...api.state, shadowMode: { enabled: true, history: [] } });
  api.applyPayload(payload, true);
  assert.equal(api.state.shadowMode.history.length, 0);
});



test("vaciar el endpoint supersede una respuesta cuyo body seguía pendiente", async () => {
  dom.window.localStorage.setItem("fanteam-data-endpoint", "https://body-race.test/worker");
  api.setState({
    ...api.state,
    gw: 1,
    history: [],
    seasonComplete: false,
    autoDraft: { ...api.state.autoDraft, enabled: false },
  });
  const before = Array.from(api.state.squad);
  let resolveBody;
  const body = new Promise((resolve) => { resolveBody = resolve; });
  const fetchFn = async () => ({ ok: true, status: 200, json: () => body });
  const pending = api.syncData(false, { fetchFn, timeoutMs: 1000 });
  await Promise.resolve();
  dom.window.localStorage.setItem("fanteam-data-endpoint", "");
  const base = await api.syncData(false, { fetchFn, timeoutMs: 1000 });
  resolveBody({
    ok: true,
    updatedAt: new Date().toISOString(),
    freshUntil: new Date(Date.now() + 60_000).toISOString(),
    currentGW: 2,
    players: [], results: [], liveFixtures: [], odds: [], news: [],
    sources: { apiFootball: false, footballData: true, news: false, odds: false, fpl: false },
    sourceMeta: {}, errors: {},
  });
  const stale = await pending;

  assert.equal(base.code, "base");
  assert.equal(stale.code, "superseded");
  assert.deepEqual(Array.from(api.state.squad), before);
  assert.equal(api.state.gw, 1);
  assert.equal(api.sync.sources, null);
});

test("timeout también cubre un body JSON que nunca termina", async () => {
  dom.window.localStorage.setItem("fanteam-data-endpoint", "https://body-timeout.test/worker");
  const fetchFn = async () => ({
    ok: true,
    status: 200,
    json: () => new Promise(() => {}),
  });

  const result = await api.syncData(false, { fetchFn, timeoutMs: 10 });

  assert.equal(result.code, "fallback");
  assert.match(result.error, /tiempo límite/);
});

test("modo sombra rechaza payload news-only y limpia disponibilidad heredada", () => {
  const selected = api.byId(api.state.squad[0]);
  const now = Date.now();
  api.setState({
    ...api.state,
    gw: 2,
    history: [],
    seasonComplete: false,
    shadowMode: { enabled: true, history: [] },
  });
  const sportsPayload = {
    ok: true,
    updatedAt: new Date(now).toISOString(),
    freshUntil: new Date(now + 60_000).toISOString(),
    currentGW: 2,
    players: [{
      id: selected.id,
      name: selected.name,
      club: selected.club,
      confidence: 55,
      minutes: 45,
      status: "Duda fresca",
    }],
    results: [], liveFixtures: [], odds: [], news: [],
    sources: { apiFootball: true, footballData: false, news: false, odds: false, fpl: false },
    sourceMeta: { apiFootball: { stale: false } },
    errors: {},
  };
  api.applyPayload(sportsPayload, false);
  assert.equal(api.state.shadowMode.history.length, 1);
  assert.equal(selected.confidence, 55);

  const newsOnly = {
    ...sportsPayload,
    updatedAt: new Date(now + 1_000).toISOString(),
    players: [],
    news: [{ title: "Solo noticia", description: "sin señal deportiva" }],
    sources: { apiFootball: false, footballData: false, news: true, odds: false, fpl: false },
    sourceMeta: {},
  };
  api.applyPayload(newsOnly, false);

  assert.equal(api.state.shadowMode.history.length, 1);
  assert.equal(selected.confidence, selected.baseConfidence);
  assert.equal(selected.minutes, selected.baseMinutes);
  assert.notEqual(selected.status, "Duda fresca");
});
