import { API_FOOTBALL_BACKOFF_BASE_MS, API_FOOTBALL_BACKOFF_MAX_MS, API_FOOTBALL_FRESH_MS, API_FOOTBALL_REFRESH_BUDGET_MS, API_FOOTBALL_STALE_MS, MAX_LINEUP_REQUESTS, REQUEST_TIMEOUT_MS } from './config.js';
import { safeRequest } from './http.js';
import { apiFootballFailure, cachedAPIFootball, readJSONCache, writeJSONCache } from './cache.js';

export async function getAPIFootballRegional(env, cache = caches.default, cacheOrigin = "https://fanteam-data.invalid") {
  if (!env.API_FOOTBALL_KEY) {
    return {
      injuries: apiFootballFailure("API_FOOTBALL_KEY no configurada"),
      fixtures: apiFootballFailure("API_FOOTBALL_KEY no configurada"),
      lineups: [],
      meta: { cacheStatus: "unavailable", stale: false, warning: "API_FOOTBALL_KEY no configurada" }
    };
  }

  const cacheKey = new Request(
    `${cacheOrigin}/__fanteam_api_football_v1/state`,
    { method: "GET" }
  );
  const state = await readJSONCache(cache, cacheKey) || {};
  const now = Date.now();
  const hasFreshCache = state.data && Number(state.freshUntil) > now;
  const hasStaleCache = state.data && Number(state.staleUntil) > now;

  if (hasFreshCache) return cachedAPIFootball(state, "fresh-cache");

  if (Number(state.cooldownUntil) > now) {
    const warning = `API-Football en pausa por límite de cuota hasta ${new Date(state.cooldownUntil).toISOString()}`;
    if (hasStaleCache) return cachedAPIFootball(state, "stale-cache", warning);
    return {
      injuries: apiFootballFailure(warning, 429),
      fixtures: apiFootballFailure(warning, 429),
      lineups: [],
      meta: {
        cacheStatus: "cooldown",
        cooldownUntil: state.cooldownUntil,
        stale: false,
        warning
      }
    };
  }

  const headers = { "x-apisports-key": env.API_FOOTBALL_KEY };
  const deadline = now + API_FOOTBALL_REFRESH_BUDGET_MS;
  const requestWithinDeadline = (url) => safeRequest(url, {
    headers,
    timeoutMs: Math.max(1, Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now()))
  });
  const today = new Date(now);
  const from = today.toISOString().slice(0, 10);
  const future = new Date(now + 8 * 86400000).toISOString().slice(0, 10);

  const fixtures = await requestWithinDeadline(
    `https://v3.football.api-sports.io/fixtures?league=39&season=2026&from=${from}&to=${future}`
  );
  const nearbyFixtures = fixtures.ok && Array.isArray(fixtures.data?.response)
    ? fixtures.data.response
      .filter((item) => {
        const kickoff = new Date(item.fixture.date).getTime();
        const difference = kickoff - now;
        return difference >= -30 * 60000 && difference <= 90 * 60000;
      })
      .sort((first, second) => (
        new Date(first.fixture.date).getTime() - new Date(second.fixture.date).getTime()
      ))
    : [];
  const lineupTargets = nearbyFixtures.slice(0, MAX_LINEUP_REQUESTS);
  const lineups = [];
  let rateLimited = fixtures.status === 429 ? fixtures : null;

  if (!rateLimited && fixtures.ok) {
    for (const item of lineupTargets) {
      const result = await requestWithinDeadline(
        `https://v3.football.api-sports.io/fixtures/lineups?fixture=${item.fixture.id}`
      );
      lineups.push(result);
      if (result.status === 429) {
        rateLimited = result;
        break;
      }
    }
  }

  const injuries = rateLimited
    ? apiFootballFailure("omitida por límite de cuota", 429, rateLimited.retryAfterAt)
    : await requestWithinDeadline(
      "https://v3.football.api-sports.io/injuries?league=39&season=2026"
    );
  if (!rateLimited && injuries.status === 429) rateLimited = injuries;

  const coverageComplete = nearbyFixtures.length <= MAX_LINEUP_REQUESTS
    && lineups.length === lineupTargets.length
    && lineups.every((result) => result.ok);
  const complete = fixtures.ok && injuries.ok && coverageComplete;

  if (complete) {
    const data = { injuries, fixtures, lineups };
    const nextState = {
      data,
      cachedAt: new Date(now).toISOString(),
      freshUntil: now + API_FOOTBALL_FRESH_MS,
      staleUntil: now + API_FOOTBALL_STALE_MS,
      cooldownUntil: null,
      failures: 0
    };
    const cacheWrite = await writeJSONCache(
      cache,
      cacheKey,
      nextState,
      API_FOOTBALL_STALE_MS
    );
    return {
      ...data,
      meta: {
        cacheStatus: "live",
        cachedAt: nextState.cachedAt,
        freshUntil: nextState.freshUntil,
        staleUntil: nextState.staleUntil,
        cooldownUntil: null,
        stale: false,
        warning: cacheWrite.ok ? null : `snapshot no persistido: ${cacheWrite.error}`
      }
    };
  }

  const firstFailure = [fixtures, injuries, ...lineups].find((result) => !result.ok);
  const error = firstFailure?.error || (
    nearbyFixtures.length > MAX_LINEUP_REQUESTS
      ? `alineaciones limitadas a ${MAX_LINEUP_REQUESTS} partidos`
      : "respuesta incompleta de API-Football"
  );
  let cooldownUntil = null;
  let failures = Number(state.failures) || 0;

  if (rateLimited) {
    failures += 1;
    const exponential = API_FOOTBALL_BACKOFF_BASE_MS * (2 ** (failures - 1));
    const localBackoff = Math.min(API_FOOTBALL_BACKOFF_MAX_MS, exponential);
    const localCooldownUntil = Date.now() + localBackoff;
    cooldownUntil = Math.max(
      localCooldownUntil,
      Number(rateLimited.retryAfterAt) || 0
    );
    const cacheWrite = await writeJSONCache(cache, cacheKey, {
      ...state,
      cooldownUntil,
      failures,
      lastError: error
    }, Math.max(API_FOOTBALL_STALE_MS, cooldownUntil - Date.now()));
    if (!cacheWrite.ok) {
      state.cacheWarning = `no se pudo persistir cooldown: ${cacheWrite.error}`;
    }
  }

  const upstreamWarning = rateLimited
    ? `${error}; reintento después de ${new Date(cooldownUntil).toISOString()}`
    : `${error}; usando el último snapshot válido si está disponible`;
  const warning = [upstreamWarning, state.cacheWarning].filter(Boolean).join("; ");
  if (hasStaleCache) {
    return cachedAPIFootball({ ...state, cooldownUntil, failures }, "stale-cache", warning);
  }

  return {
    injuries,
    fixtures,
    lineups,
    meta: {
      cacheStatus: rateLimited ? "cooldown" : "unavailable",
      cooldownUntil,
      stale: false,
      warning,
      lineupRequestsSkipped: Math.max(0, nearbyFixtures.length - lineups.length)
    }
  };
}


export async function getAPIFootball(env, cache, cacheOrigin) {
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
    const warning = `coordinador API-Football no disponible: ${error?.message || "error inesperado"}`;
    return {
      injuries: apiFootballFailure(warning),
      fixtures: apiFootballFailure(warning),
      lineups: [],
      meta: {
        cacheStatus: "coordinator-error",
        coordinator: "durable-object",
        stale: false,
        warning
      }
    };
  }
}


export class APIFootballCoordinator {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.memorySnapshot = null;
  }

  async fetch() {
    return this.state.blockConcurrencyWhile(async () => {
      const storageCache = {
        match: async (request) => {
          let value = this.memorySnapshot;
          if (value == null) {
            value = await this.state.storage.get(request.url);
            if (value != null) this.memorySnapshot = value;
          }
          return value == null
            ? undefined
            : new Response(JSON.stringify(value), {
              headers: { "Content-Type": "application/json; charset=utf-8" }
            });
        },
        put: async (request, response) => {
          const value = await response.json();
          // Conserva el cooldown en la instancia aun si la persistencia falla,
          // evitando un nuevo golpe inmediato al upstream.
          this.memorySnapshot = value;
          await this.state.storage.put(request.url, value);
        }
      };
      const result = await getAPIFootballRegional(
        this.env,
        storageCache,
        "https://api-football-coordinator.internal"
      );
      result.meta = { ...result.meta, coordinator: "durable-object" };
      return new Response(JSON.stringify(result), {
        headers: { "Content-Type": "application/json; charset=utf-8" }
      });
    });
  }
}
