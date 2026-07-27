import baseWorker, { APIFootballCoordinator } from "./index.js";
import { fetchFutbolFantasy, FUTBOL_FANTASY_URLS } from "./futbolfantasy.js";

const CACHE_URL = "https://fanteam-data.invalid/__futbolfantasy_adapter_v1";
const CACHE_TTL_SECONDS = 15 * 60;
const SOURCE_URL = FUTBOL_FANTASY_URLS.home;

function enabled(env) {
  return String(env?.FUTBOLFANTASY_ENABLED || "").trim().toLowerCase() === "true";
}

function trustedUrl(value, fallback = null) {
  try {
    const url = new URL(value);
    const trusted = url.hostname === "futbolfantasy.com"
      || url.hostname.endsWith(".futbolfantasy.com");
    return url.protocol === "https:" && trusted ? url.href : fallback;
  } catch {
    return fallback;
  }
}

function categoryFor(item) {
  const value = `${item?.type || ""} ${item?.title || ""}`.toLowerCase();
  if (/lesi|injur|duda|baja/.test(value)) return "Disponibilidad";
  if (/sanci|suspend/.test(value)) return "Sanciones";
  if (/alineac|titular|suplent/.test(value)) return "Alineaciones";
  if (/fichaj|traspas|mercado/.test(value)) return "Mercado";
  return "Actualidad";
}

function emptySource(isEnabled, error = null) {
  return {
    mode: "informational",
    enabled: isEnabled,
    available: false,
    observedAt: null,
    stale: false,
    sourceUrl: SOURCE_URL,
    news: [],
    injuries: [],
    suspensions: [],
    probableLineups: [],
    error,
  };
}

function normalizeSource(source, isEnabled = true) {
  if (!isEnabled) return emptySource(false);
  if (!source || typeof source !== "object") {
    return emptySource(true, "respuesta inválida");
  }

  const records = [...(source.news || []), ...(source.events || [])];
  const news = records.slice(0, 20).map((item) => {
    const category = categoryFor(item);
    const sourceUrl = trustedUrl(item?.url, trustedUrl(item?.sourceUrl, SOURCE_URL));
    if (!sourceUrl) return null;
    return {
      summary: `Nueva actualización de ${category.toLowerCase()} publicada por FutbolFantasy.`,
      category,
      clubs: [],
      publishedAt: item?.publishedAt || null,
      publishedLabel: "",
      sourceUrl,
    };
  }).filter(Boolean);

  const probableLineups = (source.probableLineups || []).slice(0, 30).map((lineup) => {
    const club = String(lineup?.club || "").replace(/\s+/g, " ").trim().slice(0, 48);
    const players = (lineup?.players || []).slice(0, 15).map((player) => (
      String(player?.name || player || "").replace(/\s+/g, " ").trim().slice(0, 80)
    )).filter(Boolean);
    if (!club || !players.length) return null;
    return {
      club,
      gameweek: "",
      players,
      sourceUrl: trustedUrl(lineup?.sourceUrl, FUTBOL_FANTASY_URLS.lineups),
    };
  }).filter(Boolean);

  return {
    mode: "informational",
    enabled: true,
    available: Boolean(news.length || probableLineups.length),
    observedAt: source.updatedAt || null,
    stale: false,
    sourceUrl: trustedUrl(source.sourceUrl, SOURCE_URL),
    news,
    injuries: [],
    suspensions: [],
    probableLineups,
    error: source.error || null,
  };
}

async function loadSource(ctx) {
  const cache = caches.default;
  const key = new Request(CACHE_URL, { method: "GET" });
  const cached = await cache.match(key);
  if (cached) return cached.json();

  const source = await fetchFutbolFantasy(fetch);
  const response = new Response(JSON.stringify(source), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}`,
    },
  });
  ctx.waitUntil(cache.put(key, response.clone()));
  return source;
}

export function mergeFutbolFantasyPayload(payload, source, isEnabled = true) {
  const futbolFantasy = normalizeSource(source, isEnabled);
  return {
    ...payload,
    // This source is informational only. It must not alter sports-authority
    // contracts consumed by availability, transfers, or automatic drafts.
    news: payload.news,
    players: payload.players,
    futbolFantasy,
    sources: {
      ...(payload.sources || {}),
      futbolFantasy: futbolFantasy.available,
    },
    sourceMeta: {
      ...(payload.sourceMeta || {}),
      futbolFantasy: source?.health || null,
    },
    errors: {
      ...(payload.errors || {}),
      futbolFantasy: futbolFantasy.error,
    },
    degraded: Boolean(payload.degraded),
  };
}

export { APIFootballCoordinator };

export default {
  async fetch(request, env, ctx) {
    const baseResponse = await baseWorker.fetch(request, env, ctx);
    const pathname = new URL(request.url).pathname;
    if (request.method !== "GET" || pathname === "/health") return baseResponse;

    try {
      const payload = await baseResponse.clone().json();
      // The base Worker in this repository already owns the guarded, stale-aware
      // FutbolFantasy contract. Avoid a second fetch and preserve that result.
      if (payload.futbolFantasy && typeof payload.futbolFantasy === "object") {
        return baseResponse;
      }

      const isEnabled = enabled(env);
      const source = isEnabled ? await loadSource(ctx) : null;
      const merged = mergeFutbolFantasyPayload(payload, source, isEnabled);
      const headers = new Headers(baseResponse.headers);
      headers.set("Content-Type", "application/json; charset=utf-8");
      return new Response(JSON.stringify(merged), {
        status: baseResponse.status,
        headers,
      });
    } catch {
      return baseResponse;
    }
  },
};
