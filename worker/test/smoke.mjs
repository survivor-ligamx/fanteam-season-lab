// Prueba local del Worker fanteam-data (v2.1.0) — sin red ni credenciales reales.
// Ejecutar: node worker/test/smoke.mjs
import worker from "../src/index.js";

const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();
let FIXTURE_KICKOFF = iso(now + 90 * 60000); // partido en 90 min (ventana en vivo)

const canned = () => ({
  injuries: {
    response: [
      // lesión reciente (2 días) → confianza 5
      { player: { name: "Rodri", type: "Missing Fixture", reason: "Knee Injury" }, team: { name: "Manchester City" }, fixture: { date: iso(now - 2 * 86400000) } },
      // lesión vieja (30 días) → descartada
      { player: { name: "Viejo Lesionado", type: "Missing Fixture", reason: "Hamstring" }, team: { name: "Chelsea" }, fixture: { date: iso(now - 30 * 86400000) } },
      // duda (1 día) → confianza 30
      { player: { name: "Cole Palmer", type: "Questionable", reason: "Knock" }, team: { name: "Chelsea" }, fixture: { date: iso(now - 1 * 86400000) } },
      // duplicado: registro viejo primero, reciente después → gana el reciente
      { player: { name: "Bukayo Saka", type: "Questionable", reason: "Duda vieja" }, team: { name: "Arsenal" }, fixture: { date: iso(now - 10 * 86400000) } },
      { player: { name: "Bukayo Saka", type: "Missing Fixture", reason: "Ankle Injury" }, team: { name: "Arsenal" }, fixture: { date: iso(now - 3 * 86400000) } },
    ],
  },
  fixtures: {
    response: [
      { fixture: { id: 111, date: FIXTURE_KICKOFF, status: { short: "NS" } }, teams: { home: { name: "Arsenal" }, away: { name: "Chelsea" } }, goals: { home: null, away: null } },
    ],
  },
  lineups: {
    response: [
      { team: { name: "Arsenal" }, startXI: [{ player: { name: "Viktor Gyökeres" } }], substitutes: [{ player: { name: "Gabriel Jesus" } }] },
    ],
  },
  matches: { matches: [{ id: 9, utcDate: FIXTURE_KICKOFF, status: "TIMED", homeTeam: { name: "Arsenal FC" }, awayTeam: { name: "Chelsea FC" }, score: { fullTime: { home: null, away: null } } }] },
  news: { articles: [{ title: "Saka injury blow", description: "x", url: "https://e.com/1", source: { name: "BBC" }, publishedAt: iso(now) }] },
});

function stubFetch(url) {
  const body = (data, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
  const c = canned();
  if (url.includes("/injuries")) return body(c.injuries);
  if (url.includes("/fixtures/lineups")) return body(c.lineups);
  if (url.includes("/fixtures?")) return body(c.fixtures);
  if (url.includes("football-data.org")) return body(c.matches);
  if (url.includes("the-odds-api.com")) return body({ message: "Unauthorized" }, 401); // reproduce el 401 real
  if (url.includes("gnews.io")) return body(c.news);
  throw new Error("URL inesperada: " + url);
}

const env = { API_FOOTBALL_KEY: "x", FOOTBALL_DATA_KEY: "x", ODDS_API_KEY: "bad", GNEWS_API_KEY: "x" };
const mkCtx = () => ({ waited: [], waitUntil(p) { this.waited.push(p); } });
const cacheStore = new Map();
globalThis.caches = {
  default: {
    async match(req) { return cacheStore.get(req.url); },
    async put(req, res) { cacheStore.set(req.url, res); },
  },
};

let failures = 0;
const check = (name, cond) => { console.log((cond ? " ✓ " : " ✗ ") + name); if (!cond) failures++; };

// ---------- Escenario 1: partido en ventana ----------
globalThis.fetch = (url, opts) => Promise.resolve(stubFetch(String(url)));
const ctx1 = mkCtx();
const res1 = await worker.fetch(new Request("https://w.dev/latest"), env, ctx1);
const d1 = await res1.json();
console.log("\n— Escenario 1: partido a +90 min (odds 401) —");
check("version 2.1.0", d1.version === "2.1.0");
check("Cache-Control 900s (ventana de partido)", res1.headers.get("Cache-Control").includes("max-age=900"));
check("errors.odds = HTTP 401", d1.errors.odds === "HTTP 401");
check("sources.odds = false", d1.sources.odds === false);
check("news 1 artículo", d1.news.length === 1);
const byName = Object.fromEntries(d1.players.map((p) => [p.name, p]));
check("lesión reciente → confianza 5", byName["Rodri"]?.confidence === 5 && byName["Rodri"]?.club === "MCI");
check("lesión de 30 días descartada", !byName["Viejo Lesionado"]);
check("Questionable → confianza 30", byName["Cole Palmer"]?.confidence === 30);
check("dedupe: gana el registro reciente", byName["Bukayo Saka"]?.status === "Ankle Injury" && byName["Bukayo Saka"]?.confidence === 5);
check("titular confirmado → 95", byName["Viktor Gyökeres"]?.confidence === 95);
check("suplente confirmado → 30", byName["Gabriel Jesus"]?.confidence === 30);
check("liveFixtures 1", d1.liveFixtures.length === 1);
check("results desde football-data", d1.results.length === 1);
check("cache.put invocado", ctx1.waited.length === 1 && cacheStore.size === 1);

// ---------- Escenario 2: caché sirve la respuesta ----------
const res2 = await worker.fetch(new Request("https://w.dev/otra-ruta"), env, mkCtx());
console.log("\n— Escenario 2: hit de caché —");
check("misma respuesta cacheada (clave v7 por origen)", res2 === cacheStore.get("https://w.dev/__fanteam_cache_v7"));

// ---------- Escenario 3: semana sin partidos ----------
cacheStore.clear();
FIXTURE_KICKOFF = iso(now + 3 * 86400000); // partido en 3 días
const res3 = await worker.fetch(new Request("https://w.dev/latest"), env, mkCtx());
const d3 = await res3.json();
console.log("\n— Escenario 3: sin partidos cercanos —");
check("Cache-Control 10800s", res3.headers.get("Cache-Control").includes("max-age=10800"));
check("sin alineaciones (nadie a <2h)", !d3.players.some((p) => p.status === "Titular confirmado"));

// ---------- Escenario 4: endpoints auxiliares ----------
const h = await (await worker.fetch(new Request("https://w.dev/health"), env, mkCtx())).json();
const o = await worker.fetch(new Request("https://w.dev/", { method: "OPTIONS" }), env, mkCtx());
const p = await worker.fetch(new Request("https://w.dev/", { method: "POST" }), env, mkCtx());
console.log("\n— Escenario 4: /health, OPTIONS, POST —");
check("/health v2.1.0 GW correcto", h.version === "2.1.0" && h.currentGW >= 1 && h.currentGW <= 38);
check("OPTIONS 204", o.status === 204);
check("POST 405", p.status === 405);

console.log(failures ? `\n${failures} PRUEBAS FALLARON ✗` : "\nTODAS LAS PRUEBAS PASARON ✓");
process.exit(failures ? 1 : 0);
