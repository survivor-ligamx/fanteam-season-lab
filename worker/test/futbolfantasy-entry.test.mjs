import assert from "node:assert/strict";
import test from "node:test";
import { mergeFutbolFantasyPayload } from "../src/entry-futbolfantasy.js";

test("mezcla noticias de FútbolFantasy y conserva el contrato existente", () => {
  const payload = {
    news: [{ title: "GNews", url: "https://gnews.test/1", source: "GNews" }],
    players: [{ id: 1, name: "Bukayo Saka", club: "ARS", confidence: 32, minutes: 30 }],
    sources: { news: true },
    errors: { news: null },
  };
  const source = {
    ok: true,
    source: "FútbolFantasy",
    sourceUrl: "https://www.futbolfantasy.com/premier-league/home",
    news: [{ title: "Saka es duda", url: "https://www.futbolfantasy.com/premier-league/noticias/saka" }],
    events: [],
    probableLineups: [{ club: "Arsenal", status: "probable", players: [{ name: "Bukayo Saka" }] }],
    health: { pages: { home: true } },
    error: null,
  };
  const merged = mergeFutbolFantasyPayload(payload, source);
  assert.equal(merged.news.length, 2);
  assert.equal(merged.news[1].source, "FútbolFantasy");
  assert.equal(merged.players[0].status, "Alineación probable · FútbolFantasy");
  assert.equal(merged.players[0].probable, true);
  assert.equal(merged.sources.futbolFantasy, true);
});

test("no pisa una alineación confirmada con una probable", () => {
  const merged = mergeFutbolFantasyPayload({
    news: [],
    players: [{ id: 1, name: "Bukayo Saka", club: "ARS", confidence: 95, minutes: 85, status: "Titular confirmado" }],
  }, {
    ok: true,
    news: [],
    events: [],
    probableLineups: [{ club: "Arsenal", players: [{ name: "Bukayo Saka" }] }],
  });
  assert.equal(merged.players[0].status, "Titular confirmado");
  assert.equal(merged.players[0].confidence, 95);
});
