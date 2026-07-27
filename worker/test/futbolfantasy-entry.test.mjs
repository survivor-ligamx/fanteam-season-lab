import assert from "node:assert/strict";
import test from "node:test";
import { mergeFutbolFantasyPayload } from "../src/entry-futbolfantasy.js";

const source = {
  ok: true,
  source: "FútbolFantasy",
  updatedAt: "2026-07-26T12:00:00.000Z",
  sourceUrl: "https://www.futbolfantasy.com/premier-league/home",
  news: [{
    title: "Saka es duda",
    url: "https://www.futbolfantasy.com/premier-league/noticias/saka",
    publishedAt: "2026-07-26T11:00:00.000Z",
  }],
  events: [],
  probableLineups: [{
    club: "Arsenal",
    status: "probable",
    players: [{ name: "Bukayo Saka" }],
  }],
  health: { pages: { home: true } },
  error: null,
};

test("mantiene FutbolFantasy separado de noticias y decisiones deportivas", () => {
  const payload = {
    news: [{ title: "GNews", url: "https://gnews.test/1", source: "GNews" }],
    players: [{ id: 1, name: "Bukayo Saka", club: "ARS", confidence: 32, minutes: 30 }],
    sources: { news: true },
    errors: { news: null },
    degraded: false,
  };
  const merged = mergeFutbolFantasyPayload(payload, source);

  assert.deepEqual(merged.news, payload.news);
  assert.deepEqual(merged.players, payload.players);
  assert.equal(merged.futbolFantasy.available, true);
  assert.equal(merged.futbolFantasy.news[0].category, "Disponibilidad");
  assert.doesNotMatch(merged.futbolFantasy.news[0].summary, /Saka es duda/);
  assert.deepEqual(merged.futbolFantasy.probableLineups[0].players, ["Bukayo Saka"]);
  assert.equal(merged.sources.futbolFantasy, true);
  assert.equal(merged.degraded, false);
});

test("la fuente desactivada conserva un enlace y no inicia extracción", () => {
  const payload = { news: [], players: [], degraded: false };
  const merged = mergeFutbolFantasyPayload(payload, source, false);

  assert.equal(merged.futbolFantasy.enabled, false);
  assert.equal(merged.futbolFantasy.available, false);
  assert.equal(
    merged.futbolFantasy.sourceUrl,
    "https://www.futbolfantasy.com/premier-league/home",
  );
  assert.deepEqual(merged.players, []);
  assert.deepEqual(merged.news, []);
  assert.equal(merged.degraded, false);
});
