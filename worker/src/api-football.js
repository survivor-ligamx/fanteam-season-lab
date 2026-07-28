const REQUEST_TIMEOUT_MS = 6000;
const API_FOOTBALL_REFRESH_BUDGET_MS = 15 * 1000;
const API_FOOTBALL_FRESH_MS = 15 * 60000;
const API_FOOTBALL_STALE_MS = 6 * 3600000;
const API_FOOTBALL_BACKOFF_BASE_MS = 15 * 60000;
const API_FOOTBALL_BACKOFF_MAX_MS = 6 * 3600000;
const MAX_LINEUP_REQUESTS = 10;

const TEAM_CODES = {
  Arsenal: "ARS", "Aston Villa": "AVL", Bournemouth: "BOU", "AFC Bournemouth": "BOU",
  Brentford: "BRE", Brighton: "BHA", "Brighton & Hove Albion": "BHA", Chelsea: "CHE",
  "Coventry City": "CVC", "Crystal Palace": "CRY", Everton: "EVE", Fulham: "FUL",
  "Hull City": "HUL", "Ipswich Town": "IPS", "Leeds United": "LEE", Liverpool: "LIV",
  "Manchester City": "MCI", "Manchester United": "MUN", Newcastle: "NEW",
  "Newcastle United": "NEW", "Nottingham Forest": "NFO", Sunderland: "SUN",
  Tottenham: "TOT", "Tottenham Hotspur": "TOT"
};

function retryAfterTimestamp(value, now = Date.now()) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return now + seconds * 1000;
  const date = new Date(value).getTime();
  return Number.isFinite(date) && date >= now ? date : null;
}

async function safeRequest(url, options = {}) {
  const { timeoutMs = REQUEST_TIMEOUT_MS, ...fetchOptions } = options;
  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: fetchOptions.signal || AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) {
      return {
        ok: false, error: `HTTP ${response.status}`, status: response.status,
        retryAfterAt: response.status === 429
          ? retryAfterTimestamp(response.headers.get("Retry-After"), Date.now()) : null,
        data: null
      };
    }
    return { ok: true, status: response.status, data: await response.json() };
  } catch (error) {
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    return { ok: false, error: timedOut ? `timeout after ${timeoutMs}ms` : error.message, status: null, retryAfterAt: null, data: null };
  }
}

function apiFootballFailure(error, status = null, retryAfterAt = null) {
  return { ok: false, error, status, retryAfterAt, data: null };
}

async function readJSONCache(cache, key) {
  try {
    const response = await cache.match(key);
    return response ? await response.json() : null;
  } catch (error) {
    console.warn(JSON.stringify({ event: "api_football_cache_read_failed", error: error?.message || "cache read failed" }));
    return null;
  }
}

async function writeJSONCache(cache, key, value, retentionMs) {
  try {
    const response = new Response(JSON.stringify(value), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": `public, max-age=${Math.ceil(retentionMs / 1000)}` }
    });
    await cache.put(key, response);
    return { ok: true, error: null };
  } catch (error) {
    const message = error?.message || "cache write failed";
    console.warn(JSON.stringify({ event: "api_football_cache_write_failed", error: message }));
    return { ok: false, error: message };
  }
}

function cachedAPIFootball(state, cacheStatus, warning = null) {
  const stale = cacheStatus === "stale-cache";
  const staleLineupsDropped = stale && Array.isArray(state.data?.lineups) && state.data.lineups.length > 0;
  return {
    ...state.data,
    lineups: stale ? [] : state.data.lineups,
    meta: { cacheStatus, cachedAt: state.cachedAt, freshUntil: state.freshUntil, staleUntil: state.staleUntil, cooldownUntil: state.cooldownUntil || null, stale, staleLineupsDropped, warning: staleLineupsDropped ? [warning, "stale lineups discarded"].filter(Boolean).join("; ") : warning }
  };
}

async function getAPIFootballRegional(env, cache = caches.default, cacheOrigin = "https://fanteam-data.invalid") {
  if (!env.API_FOOTBALL_KEY) {
    return { injuries: apiFootballFailure("API_FOOTBALL_KEY not configured"), fixtures: apiFootballFailure("API_FOOTBALL_KEY not configured"), lineups: [], meta: { cacheStatus: "unavailable", stale: false, warning: "API_FOOTBALL_KEY not configured" } };
  }
  const cacheKey = new Request(`${cacheOrigin}/__fanteam_api_football_v1/state`, { method: "GET" });
  const state = await readJSONCache(cache, cacheKey) || {};
  const now = Date.now();
  const hasFreshCache = state.data && Number(state.freshUntil) > now;
  const hasStaleCache = state.data && Number(state.staleUntil) > now;
  if (hasFreshCache) return cachedAPIFootball(state, "fresh-cache");
  if (Number(state.cooldownUntil) > now) {
    const warning = `API-Football cooldown until ${new Date(state.cooldownUntil).toISOString()}`;
    if (hasStaleCache) return cachedAPIFootball(state, "stale-cache", warning);
    return { injuries: apiFootballFailure(warning, 429), fixtures: apiFootballFailure(warning, 429), lineups: [], meta: { cacheStatus: "cooldown", cooldownUntil: state.cooldownUntil, stale: false, warning } };
  }
  const headers = { "x-apisports-key": env.API_FOOTBALL_KEY };
  const deadline = now + API_FOOTBALL_REFRESH_BUDGET_MS;
  const requestWithinDeadline = (url) => safeRequest(url, { headers, timeoutMs: Math.max(1, Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now())) });
  const today = new Date(now);
  const from = today.toISOString().slice(0, 10);
  const future = new Date(now + 8 * 86400000).toISOString().slice(0, 10);
  const fixtures = await requestWithinDeadline(`https://v3.football.api-sports.io/fixtures?league=39&season=2026&from=${from}&to=${future}`);
  const nearbyFixtures = fixtures.ok && Array.isArray(fixtures.data?.response)
    ? fixtures.data.response.filter((item) => { const kickoff = new Date(item.fixture.date).getTime(); const difference = kickoff - now; return difference >= -30 * 60000 && difference <= 90 * 60000; }).sort((first, second) => new Date(first.fixture.date).getTime() - new Date(second.fixture.date).getTime())
    : [];
  const lineupTargets = nearbyFixtures.slice(0, MAX_LINEUP_REQUESTS);
  const lineups = [];
  let rateLimited = fixtures.status === 429 ? fixtures : null;
  if (!rateLimited && fixtures.ok) {
    for (const item of lineupTargets) {
      const result = await requestWithinDeadline(`https://v3.football.api-sports.io/fixtures/lineups?fixture=${item.fixture.id}`);
      lineups.push(result);
      if (result.status === 429) { rateLimited = result; break; }
    }
  }
  const injuries = rateLimited ? apiFootballFailure("skipped due to rate limit", 429, rateLimited.retryAfterAt) : await requestWithinDeadline("https://v3.football.api-sports.io/injuries?league=39&season=2026");
  if (!rateLimited && injuries.status === 429) rateLimited = injuries;
  const coverageComplete = nearbyFixtures.length <= MAX_LINEUP_REQUESTS && lineups.length === lineupTargets.length && lineups.every((result) => result.ok);
  const complete = fixtures.ok && injuries.ok && coverageComplete;
  if (complete) {
    const data = { injuries, fixtures, lineups };
    const nextState = { data, cachedAt: new Date(now).toISOString(), freshUntil: now + API_FOOTBALL_FRESH_MS, staleUntil: now + API_FOOTBALL_STALE_MS, cooldownUntil: null, failures: 0 };
    await writeJSONCache(cache, cacheKey, nextState, API_FOOTBALL_STALE_MS);
    return { ...data, meta: { cacheStatus: "live", cachedAt: nextState.cachedAt, freshUntil: nextState.freshUntil, staleUntil: nextState.staleUntil, cooldownUntil: null, stale: false, warning: null } };
  }
  const firstFailure = [fixtures, injuries, ...lineups].find((result) => !result.ok);
  const error = firstFailure?.error || (nearbyFixtures.length > MAX_LINEUP_REQUESTS ? `lineups limited to ${MAX_LINEUP_REQUESTS} matches` : "incomplete API-Football response");
  let cooldownUntil = null;
  let failures = Number(state.failures) || 0;
  if (rateLimited) {
    failures += 1;
    const exponential = API_FOOTBALL_BACKOFF_BASE_MS * (2 ** (failures - 1));
    const localBackoff = Math.min(API_FOOTBALL_BACKOFF_MAX_MS, exponential);
    cooldownUntil = Math.max(Date.now() + localBackoff, Number(rateLimited.retryAfterAt) || 0);
    await writeJSONCache(cache, cacheKey, { ...state, cooldownUntil, failures, lastError: error }, Math.max(API_FOOTBALL_STALE_MS, cooldownUntil - Date.now()));
  }
  const upstreamWarning = rateLimited ? `${error}; retry after ${new Date(cooldownUntil).toISOString()}` : `${error}; using last valid snapshot if available`;
  if (hasStaleCache) return cachedAPIFootball({ ...state, cooldownUntil, failures }, "stale-cache", upstreamWarning);
  return { injuries, fixtures, lineups, meta: { cacheStatus: rateLimited ? "cooldown" : "unavailable", cooldownUntil, stale: false, warning: upstreamWarning, lineupRequestsSkipped: Math.max(0, nearbyFixtures.length - lineups.length) } };
}

async function getAPIFootball(env, cache, cacheOrigin) {
  const namespace = env.API_FOOTBALL_COORDINATOR;
  if (!namespace) {
    const result = await getAPIFootballRegional(env, cache, cacheOrigin);
    result.meta = { ...result.meta, coordinator: "regional-cache" };
    return result;
  }
  try {
    const id = namespace.idFromName("api-football-primary");
    const stub = namespace.get(id);
    const response = await stub.fetch("https://api-football-coordinator.internal/snapshot");
    if (!response.ok) throw new Error(`coordinator HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    const warning = `API-Football coordinator unavailable: ${error?.message || "unexpected error"}`;
    return { injuries: apiFootballFailure(warning), fixtures: apiFootballFailure(warning), lineups: [], meta: { cacheStatus: "coordinator-error", coordinator: "durable-object", stale: false, warning } };
  }
}

export class APIFootballCoordinator {
  constructor(state, env) { this.state = state; this.env = env; this.memorySnapshot = null; }
  async fetch() {
    return this.state.blockConcurrencyWhile(async () => {
      const storageCache = {
        match: async (request) => {
          let value = this.memorySnapshot;
          if (value == null) { value = await this.state.storage.get(request.url); if (value != null) this.memorySnapshot = value; }
          return value == null ? undefined : new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json; charset=utf-8" } });
        },
        put: async (request, response) => { const value = await response.json(); this.memorySnapshot = value; await this.state.storage.put(request.url, value); }
      };
      const result = await getAPIFootballRegional(this.env, storageCache, "https://api-football-coordinator.internal");
      result.meta = { ...result.meta, coordinator: "durable-object" };
      return new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json; charset=utf-8" } });
    });
  }
}

export { getAPIFootball, TEAM_CODES };
