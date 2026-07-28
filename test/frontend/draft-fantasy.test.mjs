import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { JSDOM } from "jsdom";

const [dataSource, draftSource, consensusSource] = await Promise.all([
  readFile("src/premier-data.js", "utf8"),
  readFile("src/draft-fantasy-import.js", "utf8"),
  readFile("src/premier-consensus.js", "utf8"),
]);

const dom = new JSDOM("", {
  runScripts: "outside-only",
  url: "https://fanteam.test/player-lab",
});
dom.window.eval(dataSource);
dom.window.eval(draftSource);
dom.window.eval(consensusSource);

after(() => dom.window.close());

const Draft = dom.window.DraftFantasyImport;
const Consensus = dom.window.PremierConsensus;
const opponents = ["ARS H", "AVL A", "CHE H", "LIV A", "MCI H"];

function projectionLine(name, club, points, position = "MID") {
  const projection = points
    .map((value, index) => `${Number(value).toFixed(1)} xP ${opponents[index]}`)
    .join(" ");
  const raw = points.reduce((total, value) => total + Number(value), 0);
  return `"${name} ${club} · ${position} · £7.0m ${projection} ${raw.toFixed(1)} ${(raw * 0.82).toFixed(1)}"`;
}

function csvFor(lines, { firstGameweek = 1, season = "2026/27" } = {}) {
  const gameweeks = Array.from({ length: 5 }, (_, index) => firstGameweek + index);
  return [
    "Jugador,Informacion_Completa",
    `"Draft Fantasy FPL ${season} guide"`,
    `"Player ${gameweeks.map((gameweek) => `GW${gameweek}`).join(" ")} Raw xP Decayed xP"`,
    '"ruido DOM sin estructura de jugador"',
    ...lines,
  ].join("\n");
}

const sampleLines = [
  projectionLine("Groß", "BHA", [4.2, 4, 4.2, 4.3, 3.7]),
  projectionLine("B.Fernandes", "MUN", [7.7, 7.8, 6.6, 6.4, 6.5]),
  projectionLine("Wilson", "COV", [3.1, 3.8, 3.1, 3.4, 3.4], "GKP"),
  projectionLine("Ji-soo", "BRE", [3.4, 3, 3.4, 3, 2.9], "DEF"),
];

test("extrae solo identidad y xP, normaliza COV y deduplica ruido repetido", () => {
  const dataset = Draft.parseText(csvFor([...sampleLines, sampleLines[0]]), {
    filename: "draft.csv",
    fileModifiedAt: "2026-07-27T10:00:00.000Z",
  });

  assert.equal(dataset.players.length, 4);
  assert.equal(dataset.meta.duplicateRows, 1);
  assert.equal(dataset.players.find((player) => player.name === "Wilson").teamCode, "CVC");
  assert.equal(Draft.pointsAt(dataset.players[0], 1), 4.2);
  assert.deepEqual(Object.keys(dataset.players[0]), ["name", "teamCode", "gameweeks"]);
  assert.equal("price" in dataset.players[0], false);
  assert.equal("position" in dataset.players[0], false);
});

test("vincula acentos y abreviaturas solo cuando nombre y club son únicos", () => {
  const dataset = Draft.parseText(csvFor([
    ...sampleLines,
    projectionLine("O.Dango", "BRE", [4.4, 4.2, 4.5, 4.2, 4.3]),
  ]));
  const catalog = [
    { id: 1, name: "Pascal Gross", surname: "Gross", club: "BHA", pos: "MID", price: 6 },
    { id: 2, name: "Bruno Fernandes", surname: "Fernandes", club: "MUN", pos: "MID", price: 10 },
    { id: 3, name: "Ben Wilson", surname: "Wilson", club: "CVC", pos: "GK", price: 4.5 },
    { id: 4, name: "Ji-soo Kim", surname: "Kim", club: "BRE", pos: "DEF", price: 4.5 },
    { id: 5, name: "Dango Ouattara", surname: "Ouattara", club: "BRE", pos: "MID", price: 6.5 },
  ];

  const result = Draft.matchPlayers(catalog, dataset.players);

  assert.equal(result.byPlayerId.size, 4);
  assert.equal(result.ambiguous.length, 0);
  assert.deepEqual(Array.from(result.unmatchedRows, (row) => row.name), ["O.Dango"]);
  assert.equal(result.byPlayerId.get(1).name, "Groß");
  assert.equal(result.byPlayerId.get(3).teamCode, "CVC");
  assert.equal(result.byPlayerId.get(4).name, "Ji-soo");
});

test("rechaza duplicados con proyecciones conflictivas", () => {
  assert.throws(
    () => Draft.parseText(csvFor([
      projectionLine("Groß", "BHA", [4.2, 4, 4.2, 4.3, 3.7]),
      projectionLine("Gross", "BHA", [5.2, 4, 4.2, 4.3, 3.7]),
    ])),
    /Proyecciones Draft conflictivas/,
  );
});

test("valida temporada, ventana de jornadas y frescura antes de activar Draft", () => {
  const shifted = Draft.parseText(
    csvFor([sampleLines[0]], { firstGameweek: 8 }),
    { fileModifiedAt: "2026-07-20T10:00:00.000Z" },
  );
  assert.equal(Draft.pointsAt(shifted.players[0], 1), null);
  assert.equal(Draft.pointsAt(shifted.players[0], 8), 4.2);
  assert.equal(
    Draft.datasetStatus(shifted, { gameweek: 1, now: Date.parse("2026-07-27T10:00:00.000Z") }).active,
    false,
  );
  assert.equal(
    Draft.datasetStatus(shifted, { gameweek: 8, now: Date.parse("2026-07-27T10:00:00.000Z") }).active,
    true,
  );

  const stale = Draft.parseText(csvFor([sampleLines[0]]), {
    fileModifiedAt: "2026-05-01T10:00:00.000Z",
  });
  assert.match(
    Draft.datasetStatus(stale, { gameweek: 1, now: Date.parse("2026-07-27T10:00:00.000Z") }).reason,
    /más de 30 días/,
  );
  assert.throws(
    () => Draft.parseText(csvFor([sampleLines[0]], { season: "2025/26" })),
    /temporada Draft 2026\/27/,
  );
});

test("persiste Draft en un esquema separado y permite desactivar el snapshot", () => {
  const dataset = Draft.parseText(csvFor(sampleLines));

  assert.equal(Draft.save(dataset), true);
  assert.equal(Draft.read().players.length, 4);
  assert.equal(dom.window.localStorage.getItem(Draft.STORAGE_KEY) != null, true);
  assert.equal(dom.window.localStorage.getItem("fanteam-fpl-copilot-import-v1"), null);
  assert.equal(Draft.disableSnapshot(), true);
  assert.equal(Draft.snapshotEnabled(), false);
  assert.equal(Draft.enableSnapshot(), true);
  assert.equal(Draft.snapshotEnabled(), true);
  assert.equal(Draft.clear(), true);
});

test("aplica Draft al 10% y conserva 60/25/15 cuando esa señal falta", () => {
  const players = [
    { id: 11, name: "Alpha", club: "ARS", pos: "MID", price: 5, confidence: 100, minutes: 90 },
    { id: 12, name: "Beta", club: "BHA", pos: "MID", price: 6, confidence: 100, minutes: 90 },
    { id: 13, name: "Gamma", club: "CHE", pos: "MID", price: 7, confidence: 100, minutes: 90 },
    { id: 14, name: "Delta", club: "LIV", pos: "MID", price: 8, confidence: 100, minutes: 90 },
    { id: 15, name: "Epsilon", club: "MCI", pos: "MID", price: 9, confidence: 100, minutes: 90 },
    { id: 16, name: "Zeta", club: "MUN", pos: "MID", price: 10, confidence: 100, minutes: 90 },
  ];
  const copilot = new Map(players.map((player, index) => [player.id, {
    position: "MID",
    points: 3 + index,
  }]));
  const draft = new Map([
    [11, { gameweeks: [{ gw: 1, points: 6 }] }],
    [12, { gameweeks: [{ gw: 1, points: 4 }] }],
    [13, { gameweeks: [{ gw: 1, points: 5 }] }],
    [14, { gameweeks: [{ gw: 1, points: 3 }] }],
    [15, { gameweeks: [{ gw: 1, points: 2 }] }],
  ]);
  const options = {
    players,
    projection: (player) => player.id - 7,
    copilotForPlayer: (player) => copilot.get(player.id),
    copilotPointsAt: (row) => row?.points,
    draftForPlayer: (player) => draft.get(player.id),
    draftPointsAt: Draft.pointsAt,
    fixture: () => ({ opp: "TOT", home: true, adv: 0 }),
    wildcard: { create() { throw new Error("scoreRows no debe crear el optimizador"); } },
    formations: [],
  };
  const engine = Consensus.create(options);

  const rows = engine.scoreRows(1);
  const withDraft = rows.find((row) => row.player.id === 11);
  const withoutDraft = rows.find((row) => row.player.id === 16);

  assert.equal(withDraft.draftUsed, true);
  assert.equal(withDraft.effectiveWeights.fanteam, 0.54);
  assert.equal(withDraft.effectiveWeights.copilot, 0.225);
  assert.equal(withDraft.effectiveWeights.draft, 0.1);
  assert.equal(withDraft.effectiveWeights.context, 0.135);
  assert.match(withDraft.explanation, /Draft P\d+ \(10%\)/);

  assert.equal(withoutDraft.draftUsed, false);
  assert.ok(Math.abs(withoutDraft.effectiveWeights.fanteam - 0.6) < 1e-12);
  assert.ok(Math.abs(withoutDraft.effectiveWeights.copilot - 0.25) < 1e-12);
  assert.ok(Math.abs(withoutDraft.effectiveWeights.context - 0.15) < 1e-12);
  assert.equal("draft" in withoutDraft.effectiveWeights, false);
  assert.doesNotMatch(withoutDraft.explanation, /Draft/);

  const sparseRows = Consensus.create({
    ...options,
    draftForPlayer: (player) => (player.id === 11 ? draft.get(11) : null),
  }).scoreRows(1);
  const sparse = sparseRows.find((row) => row.player.id === 11);
  assert.equal(sparse.draftUsed, false);
  assert.ok(Math.abs(sparse.effectiveWeights.fanteam - 0.6) < 1e-12);
  assert.doesNotMatch(sparse.explanation, /Draft/);
});
