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
