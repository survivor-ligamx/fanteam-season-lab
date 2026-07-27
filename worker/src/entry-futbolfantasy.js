import baseWorker, { APIFootballCoordinator } from "./index.js";
import { fetchFutbolFantasy } from "./futbolfantasy.js";

const CACHE_URL = "https://fanteam-data.invalid/__futbolfantasy_v1";
const CACHE_TTL_SECONDS = 15 * 60;
const CLUB_CODES = {
  Arsenal: "ARS",
  "Aston Villa": "AVL",
  Bournemouth: "BOU",
  "AFC Bournemouth": "BOU",
  Brentford: "BRE",
  Brighton: "BHA",
  "Brighton & Hove Albion": "BHA",
  Chelsea: "CHE",
  "Crystal Palace": "CRY",
  Everton: "EVE",
  Fulham: "FUL",
  "Leeds United": "LEE",
  Liverpool: "LIV",
  "Manchester City": "MCI",
  "Manchester United": "MUN",
  Newcastle: "NEW",
  "Newcastle United": "NEW",
  "Nottingham Forest": "NFO",
  Sunderland: "SUN",
  Tottenham: "TOT",
  "Tottenham Hotspur": "TOT",
};

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function sourceKey(item) {
  return item?.url || `${item?.title || ""}|${item?.sourceUrl || ""}`;
}

function mergeNews(payload, source) {
  const current = Array.isArray(payload.news) ? payload.news : [];
  const incoming = [...(source.news || []), ...(source.events || [])].map((item) => ({
    ...item,
    source: "FútbolFantasy",
    sourceUrl: item.sourceUrl || source.sourceUrl,
  }));
  const seen = new Set();
  return [...current, ...incoming].filter((item) => {
    const key = sourceKey(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function probableUpdates(source) {
  const updates = [];
  for (const lineup of source.probableLineups || []) {
    const club = CLUB_CODES[lineup.club] || lineup.club;
    if (!club || !Array.isArray(lineup.players)) continue;
    for (const player of lineup.players) {
      const name = String(player?.name || "").trim();
      if (name.length < 2 || name.length > 80) continue;
      updates.push({
        name,
        club,
        confidence: 75,
        minutes: 75,
        status: "Alineación probable · FútbolFantasy",
        probable: true,
        source: "FútbolFantasy",
      });
    }
  }
  return updates;
}

function mergeProbablePlayers(players, source) {
  const current = Array.isArray(players) ? players.map((player) => ({ ...player })) : [];
  const updates = probableUpdates(source);
  for (const update of updates) {
    const club = normalize(update.club);
    const name = normalize(update.name);
    const exact = current.filter((player) => normalize(player.club) === club && normalize(player.name) === name);
    const surname = name.split(" ").at(-1);
    const surnameMatches = current.filter((player) => (
      normalize(player.club) === club && normalize(player.name).split(" ").at(-1) === surname
    ));
    const matches = exact.length === 1 ? exact : surnameMatches.length === 1 ? surnameMatches : [];
    if (matches.length !== 1) continue;
    const player = matches[0];
    if (String(player.status || "").toLowerCase().includes("confirmad") || Number(player.confidence) >= 90) continue;
    Object.assign(player, update);
  }
  return current;
}

async function loadSource(ctx) {
  const cache = caches.default;
  const key = new Request(CACHE_URL, { method: "GET" });
  const cached = await cache.match(key);
  if (cached) return cached.json();
  const source = await fetchFutbolFantasy(fetch);
  const response = new Response(JSON.stringify(source), {
    headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}` },
  });
  if (CACHE_TTL_SECONDS > 0) ctx.waitUntil(cache.put(key, response.clone()));
  return source;
}

export function mergeFutbolFantasyPayload(payload, source) {
  const safeSource = source && typeof source === "object"
    ? source
    : { ok: false, news: [], events: [], probableLineups: [], error: "respuesta inválida" };
  return {
    ...payload,
    news: mergeNews(payload, safeSource),
    players: mergeProbablePlayers(payload.players, safeSource),
    futbolFantasy: safeSource,
    sources: { ...(payload.sources || {}), futbolFantasy: Boolean(safeSource.ok) },
    sourceMeta: { ...(payload.sourceMeta || {}), futbolFantasy: safeSource.health || null },
    errors: { ...(payload.errors || {}), futbolFantasy: safeSource.error || null },
    degraded: Boolean(payload.degraded || !safeSource.ok),
  };
}

export { APIFootballCoordinator };

export default {
  async fetch(request, env, ctx) {
    const baseResponse = await baseWorker.fetch(request, env, ctx);
    if (request.method !== "GET" || new URL(request.url).pathname === "/health") return baseResponse;
    try {
      const payload = await baseResponse.json();
      const source = await loadSource(ctx);
      const merged = mergeFutbolFantasyPayload(payload, source);
      const headers = new Headers(baseResponse.headers);
      headers.set("Content-Type", "application/json; charset=utf-8");
      headers.set("Cache-Control", "no-store");
      return new Response(JSON.stringify(merged), { status: baseResponse.status, headers });
    } catch (error) {
      return baseResponse;
    }
  },
};
