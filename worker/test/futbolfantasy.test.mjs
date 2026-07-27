import assert from "node:assert/strict";
import test from "node:test";
import { FUTBOL_FANTASY_URLS, fetchFutbolFantasy, parseFutbolFantasyPage } from "../src/futbolfantasy.js";

const now = new Date("2026-07-26T12:00:00.000Z");

const home = `<!doctype html><html><body>
  <h2><a href="/premier-league/noticias/saka-duda">Saka es duda para la jornada</a></h2>
  <h2><a href="/premier-league/noticias/arsenal-previa">Previa del Arsenal y novedades</a></h2>
</body></html>`;
const lineups = `<section data-team="Arsenal" data-fixture="Arsenal - Chelsea">
  <span data-player="David Raya" data-role="GK"></span>
  <span data-player="Bukayo Saka" data-role="MID"></span>
</section>`;
const changes = `<h3><a href="/premier-league/eventos/saka-recuperado">Saka está ahora recuperado</a></h3>`;

function fakeFetch(url) {
  const body = url === FUTBOL_FANTASY_URLS.home ? home : url === FUTBOL_FANTASY_URLS.lineups ? lineups : changes;
  return Promise.resolve(new Response(body, { status: 200, headers: { "content-type": "text/html" } }));
}

test("parsea noticias y conserva atribución", () => {
  const result = parseFutbolFantasyPage(home, FUTBOL_FANTASY_URLS.home, "home", now);
  assert.equal(result.ok, true);
  assert.equal(result.news.length, 2);
  assert.equal(result.news[0].source, "FútbolFantasy");
  assert.equal(result.news[0].sourceUrl, FUTBOL_FANTASY_URLS.home);
});

test("parsea alineación probable sin llamarla confirmada", () => {
  const result = parseFutbolFantasyPage(lineups, FUTBOL_FANTASY_URLS.lineups, "probableLineups", now);
  assert.equal(result.probableLineups.length, 1);
  assert.equal(result.probableLineups[0].status, "probable");
  assert.equal(result.probableLineups[0].players[0].name, "David Raya");
});

test("parsea eventos y rechaza HTML inválido o demasiado grande", () => {
  const result = parseFutbolFantasyPage(changes, FUTBOL_FANTASY_URLS.changes, "changes", now);
  assert.equal(result.events.length, 1);
  assert.equal(parseFutbolFantasyPage("", FUTBOL_FANTASY_URLS.home, "home", now).ok, false);
  assert.equal(parseFutbolFantasyPage("x".repeat(800_001), FUTBOL_FANTASY_URLS.home, "home", now).ok, false);
});

test("fetch agregado conserva fallos parciales y no rompe el payload", async () => {
  const result = await fetchFutbolFantasy(fakeFetch, now);
  assert.equal(result.ok, true);
  assert.equal(result.news.length, 2);
  assert.equal(result.events.length, 1);
  assert.equal(result.probableLineups.length, 1);
  assert.deepEqual(result.health.errors, []);
});

test("un fallo de una página queda observable sin perder las otras", async () => {
  const result = await fetchFutbolFantasy((url) => {
    if (url === FUTBOL_FANTASY_URLS.lineups) return Promise.resolve(new Response("blocked", { status: 503 }));
    return fakeFetch(url);
  }, now);
  assert.equal(result.ok, true);
  assert.equal(result.news.length, 2);
  assert.equal(result.probableLineups.length, 0);
  assert.match(result.error, /lineups: HTTP 503/);
});
