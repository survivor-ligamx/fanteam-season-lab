const DEADLINES = (
  "2026-08-21,2026-08-28,2026-09-04,2026-09-12,2026-09-18," +
  "2026-10-10,2026-10-17,2026-10-24,2026-10-31,2026-11-07," +
  "2026-11-21,2026-11-28,2026-12-02,2026-12-05,2026-12-12," +
  "2026-12-19,2026-12-26,2026-12-30,2027-01-02,2027-01-06," +
  "2027-01-16,2027-01-23,2027-01-30,2027-02-06,2027-02-10," +
  "2027-02-20,2027-02-27,2027-03-03,2027-03-13,2027-03-20," +
  "2027-04-10,2027-04-17,2027-04-24,2027-05-01,2027-05-08," +
  "2027-05-15,2027-05-23,2027-05-30"
)
  .split(",")
  .map((date) => `${date}T17:00:00Z`);


const VERSION = "2.3.1";
const BUILD_ID = "api-football-resilience-v1";
const REQUEST_TIMEOUT_MS = 6000;
const API_FOOTBALL_REFRESH_BUDGET_MS = 15 * 1000;
const DEGRADED_TTL_SECONDS = 120;
const API_FOOTBALL_FRESH_MS = 15 * 60000;
const API_FOOTBALL_STALE_MS = 6 * 3600000;
const API_FOOTBALL_BACKOFF_BASE_MS = 15 * 60000;
const API_FOOTBALL_BACKOFF_MAX_MS = 6 * 3600000;
const MAX_LINEUP_REQUESTS = 10;
const FUTBOLFANTASY_HOME_URL = "https://www.futbolfantasy.com/premier-league/home";
const FUTBOLFANTASY_URLS = Object.freeze({
  news: "https://www.futbolfantasy.com/premier-league/noticias",
  injuries: "https://www.futbolfantasy.com/premier-league/lesionados",
  suspensions: "https://www.futbolfantasy.com/premier-league/sancionados",
  lineups: "https://www.futbolfantasy.com/premier-league/posibles-alineaciones"
});
const FUTBOLFANTASY_FRESH_MS = 6 * 3600000;
const FUTBOLFANTASY_STALE_MS = 72 * 3600000;
const FUTBOLFANTASY_MAX_HTML_BYTES = 1500000;
const ALLOWED_ORIGINS = new Set([
  "https://survivor-ligamx.github.io",
  "null"
]);

const TEAM_CODES = {
  Arsenal: "ARS",
  "Aston Villa": "AVL",
  Bournemouth: "BOU",
  "AFC Bournemouth": "BOU",
  Brentford: "BRE",
  Brighton: "BHA",
  "Brighton & Hove Albion": "BHA",
  Chelsea: "CHE",
  "Coventry City": "CVC",
  "Crystal Palace": "CRY",
  Everton: "EVE",
  Fulham: "FUL",
  "Hull City": "HUL",
  "Ipswich Town": "IPS",
  "Leeds United": "LEE",
  Liverpool: "LIV",
  "Manchester City": "MCI",
  "Manchester United": "MUN",
  Newcastle: "NEW",
  "Newcastle United": "NEW",
  "Nottingham Forest": "NFO",
  Sunderland: "SUN",
  Tottenham: "TOT",
  "Tottenham Hotspur": "TOT"
};


function currentGameweek(results = []) {
  const now = Date.now();
  const firstKickoffByGameweek = new Map();
  for (const match of results) {
    const gameweek = Number(match?.gameweek);
    const kickoff = new Date(match?.kickoff || "").getTime();
    if (!Number.isInteger(gameweek) || gameweek < 1 || gameweek > 38) continue;
    if (!Number.isFinite(kickoff)) continue;
    const previous = firstKickoffByGameweek.get(gameweek);
    if (previous == null || kickoff < previous) {
      firstKickoffByGameweek.set(gameweek, kickoff);
    }
  }
  const upcoming = Array.from(firstKickoffByGameweek, ([gameweek, kickoff]) => ({
    gameweek,
    deadline: kickoff - 90 * 60000
  }))
    .filter((entry) => entry.deadline > now)
    .sort((first, second) => first.deadline - second.deadline || first.gameweek - second.gameweek);
  if (upcoming.length) return upcoming[0].gameweek;

  for (let index = 0; index < DEADLINES.length; index++) {
    if (new Date(DEADLINES[index]).getTime() > now) {
      return index + 1;
    }
  }

  return 38;
}


function allowedOrigin(request, env) {
  const origin = request?.headers?.get("Origin");
  if (!origin) return null;
  const configured = String(env?.CORS_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (ALLOWED_ORIGINS.has(origin) || configured.includes(origin)) return origin;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return null;
}


function responseJSON(data, status = 200, cacheSeconds = 0, request = null, env = {}) {
  const pretty = request
    ? new URL(request.url).searchParams.get("pretty") === "1"
    : false;
  const origin = allowedOrigin(request, env);
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": cacheSeconds
      ? `public, max-age=${cacheSeconds}`
      : "no-store",
    "Vary": "Origin"
  };
  if (origin) headers["Access-Control-Allow-Origin"] = origin;

  return new Response(JSON.stringify(data, null, pretty ? 2 : 0), {
    status,
    headers
  });
}


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
        ok: false,
        error: `HTTP ${response.status}`,
        status: response.status,
        retryAfterAt: response.status === 429
          ? retryAfterTimestamp(response.headers.get("Retry-After"), Date.now())
          : null,
        data: null
      };
    }

    return {
      ok: true,
      status: response.status,
      data: await response.json()
    };
  } catch (error) {
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    return {
      ok: false,
      error: timedOut ? `timeout después de ${timeoutMs} ms` : error.message,
      status: null,
      retryAfterAt: null,
      data: null
    };
  }
}


async function safeTextRequest(url, options = {}) {
  const { timeoutMs = REQUEST_TIMEOUT_MS, ...fetchOptions } = options;
  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: fetchOptions.signal || AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) {
      return {
        ok: false,
        error: `HTTP ${response.status}`,
        status: response.status,
        retryAfterAt: response.status === 429
          ? retryAfterTimestamp(response.headers.get("Retry-After"), Date.now())
          : null,
        data: null
      };
    }
    const declaredLength = Number(response.headers.get("Content-Length"));
    if (Number.isFinite(declaredLength) && declaredLength > FUTBOLFANTASY_MAX_HTML_BYTES) {
      return { ok: false, error: "respuesta HTML demasiado grande", status: response.status, data: null };
    }
    const reader = response.body?.getReader();
    if (!reader) {
      return { ok: false, error: "respuesta HTML sin cuerpo legible", status: response.status, data: null };
    }
    const decoder = new TextDecoder();
    let data = "";
    let receivedBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value?.byteLength || 0;
      if (receivedBytes > FUTBOLFANTASY_MAX_HTML_BYTES) {
        await reader.cancel("límite de tamaño excedido");
        return { ok: false, error: "respuesta HTML demasiado grande", status: response.status, data: null };
      }
      data += decoder.decode(value, { stream: true });
    }
    data += decoder.decode();
    return { ok: true, status: response.status, data };
  } catch (error) {
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    return {
      ok: false,
      error: timedOut ? `timeout después de ${timeoutMs} ms` : error.message,
      status: null,
      retryAfterAt: null,
      data: null
    };
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
    console.warn(JSON.stringify({
      event: "api_football_cache_read_failed",
      error: error?.message || "cache read failed"
    }));
    return null;
  }
}


async function writeJSONCache(cache, key, value, retentionMs) {
  try {
    const response = new Response(JSON.stringify(value), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": `public, max-age=${Math.ceil(retentionMs / 1000)}`
      }
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
  const staleLineupsDropped = stale && Array.isArray(state.data?.lineups)
    && state.data.lineups.length > 0;
  return {
    ...state.data,
    lineups: stale ? [] : state.data.lineups,
    meta: {
      cacheStatus,
      cachedAt: state.cachedAt,
      freshUntil: state.freshUntil,
      staleUntil: state.staleUntil,
      cooldownUntil: state.cooldownUntil || null,
      stale,
      staleLineupsDropped,
      warning: staleLineupsDropped
        ? [warning, "alineaciones stale descartadas por seguridad"].filter(Boolean).join("; ")
        : warning
    }
  };
}


async function getAPIFootballRegional(env, cache = caches.default, cacheOrigin = "https://fanteam-data.invalid") {
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


async function getFootballData(env) {
  if (!env.FOOTBALL_DATA_KEY) {
    return {
      ok: false,
      error: "FOOTBALL_DATA_KEY no configurada"
    };
  }

  return safeRequest(
    "https://api.football-data.org/v4/competitions/PL/matches?season=2026",
    {
      headers: {
        "X-Auth-Token": env.FOOTBALL_DATA_KEY
      }
    }
  );
}


async function getOdds(env) {
  if (!env.ODDS_API_KEY) {
    return {
      ok: false,
      error: "ODDS_API_KEY no configurada"
    };
  }

  const parameters = new URLSearchParams({
    apiKey: env.ODDS_API_KEY,
    regions: "uk",
    markets: "h2h,totals",
    oddsFormat: "decimal",
    dateFormat: "iso"
  });

  return safeRequest(
    `https://api.the-odds-api.com/v4/sports/soccer_epl/odds?${parameters}`
  );
}


async function getNews(env) {
  if (!env.GNEWS_API_KEY) {
    return {
      ok: false,
      error: "GNEWS_API_KEY no configurada"
    };
  }

  const parameters = new URLSearchParams({
    q: '"Premier League" injury OR lineup OR suspension',
    lang: "en",
    country: "gb",
    max: "10",
    apikey: env.GNEWS_API_KEY
  });

  return safeRequest(
    `https://gnews.io/api/v4/search?${parameters}`
  );
}


const FUTBOLFANTASY_CLUBS = Object.freeze([
  ["Arsenal", ["arsenal"]],
  ["Aston Villa", ["aston villa"]],
  ["Bournemouth", ["bournemouth", "afc bournemouth"]],
  ["Brentford", ["brentford"]],
  ["Brighton", ["brighton", "brighton hove albion"]],
  ["Burnley", ["burnley"]],
  ["Chelsea", ["chelsea"]],
  ["Coventry City", ["coventry", "coventry city"]],
  ["Crystal Palace", ["crystal palace"]],
  ["Everton", ["everton"]],
  ["Fulham", ["fulham"]],
  ["Hull City", ["hull", "hull city"]],
  ["Ipswich Town", ["ipswich", "ipswich town"]],
  ["Leeds United", ["leeds", "leeds united"]],
  ["Liverpool", ["liverpool"]],
  ["Manchester City", ["manchester city", "man city"]],
  ["Manchester United", ["manchester united", "man utd"]],
  ["Newcastle United", ["newcastle", "newcastle united"]],
  ["Nottingham Forest", ["nottingham forest", "nottm forest"]],
  ["Sunderland", ["sunderland"]],
  ["Tottenham", ["tottenham", "tottenham hotspur", "spurs"]],
  ["West Ham", ["west ham", "west ham united"]],
  ["Wolverhampton", ["wolverhampton", "wolves"]]
]);


function futbolFantasyEnabled(env) {
  return /^(1|true|yes|on)$/i.test(String(env?.FUTBOLFANTASY_ENABLED || "").trim());
}


function decodeHTML(value) {
  const named = {
    amp: "&", apos: "'", gt: ">", hellip: "…", laquo: "«", lt: "<",
    nbsp: " ", ndash: "–", quot: '"', raquo: "»", rsquo: "’"
  };
  return String(value || "")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (entity, code) => {
      const numeric = code[0].toLowerCase() === "x"
        ? Number.parseInt(code.slice(1), 16)
        : Number.parseInt(code, 10);
      try {
        return Number.isFinite(numeric) ? String.fromCodePoint(numeric) : entity;
      } catch {
        return entity;
      }
    })
    .replace(/&([a-z]+);/gi, (entity, name) => named[name.toLowerCase()] ?? entity);
}


function cleanHTMLText(value, maximum = 180) {
  return decodeHTML(String(value || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}


function normalizedFutbolFantasyText(value) {
  return cleanHTMLText(value, 500)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}


function htmlAttribute(openingTag, name) {
  const escaped = String(name).replace(/[^a-z0-9_-]/gi, "");
  const match = String(openingTag || "").match(
    new RegExp(`\\s${escaped}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i")
  );
  return match?.[2] || "";
}


function classTokens(openingTag) {
  return htmlAttribute(openingTag, "class").split(/\s+/).filter(Boolean);
}


function blocksByClasses(html, tag, requiredClasses, maximum = 100) {
  const opening = new RegExp(`<${tag}\\b[^>]*>`, "gi");
  const starts = [];
  let match;
  while ((match = opening.exec(String(html || "")))) {
    const classes = new Set(classTokens(match[0]));
    if (requiredClasses.every((name) => classes.has(name))) {
      starts.push({ index: match.index, bodyStart: opening.lastIndex, openingTag: match[0] });
      if (starts.length >= maximum + 1) break;
    }
  }
  return starts.slice(0, maximum).map((start, index) => ({
    openingTag: start.openingTag,
    body: String(html || "").slice(
      start.bodyStart,
      starts[index + 1]?.index ?? String(html || "").length
    )
  }));
}


function classElements(html, requiredClass, maximum = 100) {
  const source = String(html || "");
  const elements = [];
  const opening = /<([a-z][\w:-]*)\b[^>]*>/gi;
  let match;
  while ((match = opening.exec(source))) {
    if (!classTokens(match[0]).includes(requiredClass)) continue;
    const closingTag = `</${match[1]}>`;
    const bodyEnd = source.toLowerCase().indexOf(closingTag.toLowerCase(), opening.lastIndex);
    if (bodyEnd < 0) continue;
    const body = source.slice(opening.lastIndex, bodyEnd);
    elements.push({ openingTag: match[0], body, text: cleanHTMLText(body) });
    if (elements.length >= maximum) break;
  }
  return elements;
}


function firstClassText(html, requiredClass, maximum = 180) {
  const element = classElements(html, requiredClass, 1)[0];
  return element ? cleanHTMLText(element.body, maximum) : "";
}


function futbolFantasyUrl(value, base = FUTBOLFANTASY_HOME_URL) {
  try {
    const parsed = new URL(decodeHTML(value), base);
    const hostAllowed = parsed.hostname === "futbolfantasy.com"
      || parsed.hostname.endsWith(".futbolfantasy.com");
    return parsed.protocol === "https:" && hostAllowed ? parsed.href.slice(0, 500) : null;
  } catch {
    return null;
  }
}


function futbolFantasyClub(value) {
  const normalized = normalizedFutbolFantasyText(value);
  if (!normalized) return null;
  for (const [club, aliases] of FUTBOLFANTASY_CLUBS) {
    if (aliases.some((alias) => normalized.includes(alias))) return club;
  }
  return null;
}


function futbolFantasyClubs(value) {
  const normalized = normalizedFutbolFantasyText(value);
  return FUTBOLFANTASY_CLUBS
    .filter(([, aliases]) => aliases.some((alias) => normalized.includes(alias)))
    .map(([club]) => club)
    .slice(0, 4);
}


function futbolFantasyDate(value) {
  const text = cleanHTMLText(value, 60);
  const matched = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:\D+(\d{1,2}):(\d{2}))?/);
  if (!matched) return { publishedAt: null, publishedLabel: text };
  const year = Number(matched[3]) < 100 ? 2000 + Number(matched[3]) : Number(matched[3]);
  const timestamp = Date.UTC(
    year,
    Number(matched[2]) - 1,
    Number(matched[1]),
    Number(matched[4]) || 0,
    Number(matched[5]) || 0
  );
  return Number.isFinite(timestamp)
    ? { publishedAt: new Date(timestamp).toISOString(), publishedLabel: text }
    : { publishedAt: null, publishedLabel: text };
}


function summarizeFutbolFantasyHeadline(headline) {
  const normalized = normalizedFutbolFantasyText(headline);
  const clubs = futbolFantasyClubs(headline);
  const categories = [
    ["Lesiones", ["lesion", "baja", "molest", "operacion", "recupera", "duda"]],
    ["Sanciones", ["sancion", "suspend", "tarjeta", "expulsion"]],
    ["Alineaciones", ["alineacion", "once", "titular", "suplente", "convocatoria"]],
    ["Mercado", ["fichaje", "traspaso", "cesion", "renov", "acuerdo", "oficial"]],
    ["Entrenamiento", ["entren", "sesion", "grupo"]],
    ["Declaraciones", ["rueda de prensa", "declara", "confirma"]],
    ["Partidos", ["partido", "victoria", "derrota", "empate"]]
  ];
  const category = categories.find(([, keywords]) => (
    keywords.some((keyword) => normalized.includes(keyword))
  ))?.[0] || "Actualidad";
  const subjects = clubs.length ? ` relacionada con ${clubs.join(" y ")}` : " de la Premier League";
  const lead = {
    Lesiones: "Actualización informativa sobre disponibilidad o lesión",
    Sanciones: "Actualización informativa sobre una posible sanción",
    Alineaciones: "Actualización editorial sobre convocatoria o alineación",
    Mercado: "Actualización informativa del mercado de fichajes",
    Entrenamiento: "Novedad informativa procedente de un entrenamiento",
    Declaraciones: "Novedad informativa procedente de declaraciones",
    Partidos: "Actualización informativa relacionada con un partido",
    Actualidad: "Nueva actualización editorial"
  }[category];
  return { category, clubs, summary: `${lead}${subjects}.` };
}


function parseFutbolFantasyNews(html) {
  return blocksByClasses(html, "div", ["noticia"], 20)
    .map((block) => {
      const link = classElements(block.body, "link", 1)[0];
      const sourceUrl = link ? futbolFantasyUrl(htmlAttribute(link.openingTag, "href")) : null;
      const headline = link ? cleanHTMLText(link.body, 240) : "";
      if (!sourceUrl || !headline) return null;
      const summary = summarizeFutbolFantasyHeadline(headline);
      const date = futbolFantasyDate(firstClassText(block.body, "date", 60));
      return { ...summary, ...date, sourceUrl };
    })
    .filter(Boolean)
    .slice(0, 20);
}


function parseFutbolFantasyAvailability(html, kind, sourceUrl) {
  const sectionClass = kind === "injuries" ? "lesionados" : "sancionados";
  const itemClass = kind === "injuries" ? "lesionado" : "sancionado";
  const records = [];
  for (const section of blocksByClasses(html, "section", ["mod", sectionClass], 30)) {
    const club = futbolFantasyClub(firstClassText(section.body, "title", 100));
    if (!club) continue;
    for (const item of blocksByClasses(
      section.body,
      "div",
      ["elemento", itemClass],
      Math.max(1, 80 - records.length)
    )) {
      const player = firstClassText(item.body, "jugador", 80);
      if (!player) continue;
      const issue = firstClassText(item.body, kind === "injuries" ? "lesion" : "sancion", 120);
      const statusElement = classElements(item.body, "gravedad-0", 1)[0]
        || classElements(item.body, "gravedad-1", 1)[0]
        || classElements(item.body, "gravedad-2", 1)[0]
        || classElements(item.body, "gravedad-3", 1)[0];
      const itemText = cleanHTMLText(item.body, 400);
      const since = itemText.match(/(?:Desde|Sancionado desde)\s+[^|·]{1,70}/i)?.[0] || "";
      records.push({
        club,
        player,
        issue,
        status: statusElement?.text || "",
        since: cleanHTMLText(since, 80),
        sourceUrl
      });
      if (records.length >= 80) return records;
    }
  }
  return records;
}


function parseFutbolFantasyLineups(html) {
  const gameweek = cleanHTMLText(html, 10000).match(/\bJornada\s+(\d{1,2})\b/i)?.[1] || "";
  const lineups = new Map();
  for (const section of blocksByClasses(html, "section", ["alineacion_wrapper"], 30)) {
    const club = futbolFantasyClub(section.body);
    if (!club) continue;
    const teamLink = classElements(section.body, "equipo", 1)[0];
    const sourceUrl = teamLink
      ? futbolFantasyUrl(htmlAttribute(teamLink.openingTag, "href"))
      : FUTBOLFANTASY_URLS.lineups;
    const players = classElements(section.body, "jugador", 15)
      .map((element) => element.text)
      .filter(Boolean)
      .slice(0, 15);
    lineups.set(club, { club, gameweek, players, sourceUrl });
  }

  const anchorPattern = /<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let anchor;
  while ((anchor = anchorPattern.exec(String(html || "")))) {
    const sourceUrl = futbolFantasyUrl(anchor[2]);
    if (!sourceUrl || !/\/premier-league\/equipos\//i.test(sourceUrl)) continue;
    const club = futbolFantasyClub(cleanHTMLText(anchor[3], 100));
    if (!club || lineups.has(club)) continue;
    lineups.set(club, { club, gameweek, players: [], sourceUrl });
  }
  return [...lineups.values()].slice(0, 30);
}


function emptyFutbolFantasy(overrides = {}) {
  return {
    mode: "informational",
    enabled: false,
    available: false,
    observedAt: null,
    stale: false,
    sourceUrl: FUTBOLFANTASY_HOME_URL,
    news: [],
    injuries: [],
    suspensions: [],
    probableLineups: [],
    error: null,
    cacheStatus: "disabled",
    ...overrides
  };
}


async function getFutbolFantasy(env, cache = caches.default, cacheOrigin = "https://fanteam-data.invalid") {
  if (!futbolFantasyEnabled(env)) return emptyFutbolFantasy();

  const cacheKey = new Request(`${cacheOrigin}/__fanteam_futbolfantasy_v1/state`, { method: "GET" });
  const state = await readJSONCache(cache, cacheKey) || {};
  const now = Date.now();
  const hasFreshCache = state.data && Number(state.freshUntil) > now;
  const hasStaleCache = state.data && Number(state.staleUntil) > now;
  if (hasFreshCache) {
    return { ...state.data, enabled: true, stale: false, cacheStatus: "fresh-cache" };
  }
  if (Number(state.cooldownUntil) > now) {
    const error = `fuente en pausa hasta ${new Date(state.cooldownUntil).toISOString()}`;
    return hasStaleCache
      ? { ...state.data, enabled: true, stale: true, error, cacheStatus: "stale-cache" }
      : emptyFutbolFantasy({ enabled: true, error, cacheStatus: "cooldown" });
  }

  const headers = {
    "Accept": "text/html,application/xhtml+xml",
    "User-Agent": "FanTeamSeasonLab/1.0 (informational integration; contact via GitHub)"
  };
  const labels = Object.keys(FUTBOLFANTASY_URLS);
  const responses = {};
  const refreshDeadline = Date.now() + 8000;
  for (const label of labels) {
    const remaining = refreshDeadline - Date.now();
    if (remaining <= 0) {
      responses[label] = { ok: false, error: "presupuesto de actualización agotado", data: null };
      continue;
    }
    responses[label] = await safeTextRequest(FUTBOLFANTASY_URLS[label], {
      headers,
      timeoutMs: Math.min(3000, remaining)
    });
    if (responses[label].status === 403 || responses[label].status === 429) break;
  }
  for (const label of labels) {
    if (!responses[label]) {
      responses[label] = {
        ok: false,
        error: "omitida tras bloqueo de la fuente",
        data: null
      };
    }
  }
  const failures = labels
    .filter((label) => !responses[label].ok)
    .map((label) => `${label}: ${responses[label].error}`);
  const blocked = labels
    .map((label) => responses[label])
    .find((response) => response.status === 403 || response.status === 429);
  const cooldownUntil = blocked
    ? Math.max(Number(blocked.retryAfterAt) || 0, now + FUTBOLFANTASY_FRESH_MS)
    : null;

  if (failures.length && hasStaleCache) {
    if (cooldownUntil) {
      await writeJSONCache(cache, cacheKey, {
        ...state,
        cooldownUntil,
        lastError: failures.join("; ")
      }, Math.max(FUTBOLFANTASY_STALE_MS, cooldownUntil - now));
    }
    return {
      ...state.data,
      enabled: true,
      stale: true,
      error: failures.join("; "),
      cacheStatus: "stale-cache"
    };
  }

  const data = emptyFutbolFantasy({
    enabled: true,
    observedAt: new Date(now).toISOString(),
    news: responses.news.ok ? parseFutbolFantasyNews(responses.news.data) : [],
    injuries: responses.injuries.ok
      ? parseFutbolFantasyAvailability(responses.injuries.data, "injuries", FUTBOLFANTASY_URLS.injuries)
      : [],
    suspensions: responses.suspensions.ok
      ? parseFutbolFantasyAvailability(responses.suspensions.data, "suspensions", FUTBOLFANTASY_URLS.suspensions)
      : [],
    probableLineups: responses.lineups.ok
      ? parseFutbolFantasyLineups(responses.lineups.data)
      : [],
    error: failures.join("; ") || null,
    cacheStatus: failures.length ? "partial" : "live"
  });
  data.available = Boolean(
    data.news.length || data.injuries.length || data.suspensions.length || data.probableLineups.length
  );

  if (data.available) {
    const nextState = {
      data: { ...data, cacheStatus: "live" },
      freshUntil: now + FUTBOLFANTASY_FRESH_MS,
      staleUntil: now + FUTBOLFANTASY_STALE_MS,
      cooldownUntil
    };
    await writeJSONCache(cache, cacheKey, nextState, FUTBOLFANTASY_STALE_MS);
  } else if (cooldownUntil) {
    await writeJSONCache(cache, cacheKey, {
      ...state,
      cooldownUntil,
      lastError: data.error
    }, Math.max(FUTBOLFANTASY_STALE_MS, cooldownUntil - now));
  }
  return data;
}


async function getFPLBootstrap() {
  return safeRequest(
    "https://fantasy.premierleague.com/api/bootstrap-static/"
  );
}


function parsePlayerUpdates(apiFootball) {
  const updates = new Map();

  if (apiFootball.injuries.ok) {
    const injuries = apiFootball.injuries.data?.response || [];
    const now = Date.now();
    const maxAge = 21 * 86400000; // lesiones con más de 21 días se descartan
    const seen = new Map(); // key -> timestamp del registro usado

    for (const item of injuries) {
      const name = item.player?.name;
      const club = TEAM_CODES[item.team?.name];

      if (!name) continue;

      const parsed = item.fixture?.date
        ? new Date(item.fixture.date).getTime()
        : NaN;
      const when = Number.isFinite(parsed) ? parsed : now;

      if (now - when > maxAge) continue;

      const key = `${name}|${club || ""}`;

      if (seen.has(key) && seen.get(key) >= when) continue;

      seen.set(key, when);

      const questionable = item.player?.type === "Questionable";

      updates.set(key, {
        name,
        club,
        confidence: questionable ? 30 : 5,
        minutes: questionable ? 30 : 0,
        status: item.player?.reason || item.player?.type || "Lesión"
      });
    }
  }

  for (const lineupResult of apiFootball.lineups) {
    if (!lineupResult.ok) continue;

    for (const team of lineupResult.data?.response || []) {
      const club = TEAM_CODES[team.team?.name];

      for (const item of team.startXI || []) {
        const name = item.player?.name;

        if (!name) continue;

        updates.set(`${name}|${club || ""}`, {
          name,
          club,
          confidence: 95,
          minutes: 85,
          status: "Titular confirmado"
        });
      }

      for (const item of team.substitutes || []) {
        const name = item.player?.name;

        if (!name) continue;

        if (!updates.has(`${name}|${club || ""}`)) {
          updates.set(`${name}|${club || ""}`, {
            name,
            club,
            confidence: 30,
            minutes: 25,
            status: "Suplente confirmado"
          });
        }
      }
    }
  }

  return [...updates.values()];
}


function normalizePlayerKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}


function mergePlayerRecords(referencePlayers, liveUpdates) {
  const merged = new Map();
  const aliases = new Map();
  const aliasFor = (name, club) => {
    const normalizedName = normalizePlayerKey(name);
    const normalizedClub = normalizePlayerKey(club);
    return normalizedName && normalizedClub
      ? `${normalizedName}|${normalizedClub}`
      : null;
  };
  const nameVariants = (player) => {
    const name = normalizePlayerKey(player?.name);
    if (!name) return [];
    const tokens = name.split(" ");
    return [...new Set([
      name,
      tokens.slice(-2).join(" "),
      tokens.at(-1),
      tokens[0]
    ].filter(Boolean))];
  };
  const registerAliases = (player, key) => {
    for (const variant of nameVariants(player)) {
      const alias = aliasFor(variant, player.club);
      if (!alias) continue;
      if (!aliases.has(alias)) aliases.set(alias, new Set());
      aliases.get(alias).add(key);
    }
  };
  const resolveAlias = (player) => {
    for (const variant of nameVariants(player)) {
      const owners = aliases.get(aliasFor(variant, player.club));
      if (owners?.size === 1) return [...owners][0];
    }
    return null;
  };

  for (const player of referencePlayers) {
    const exactAlias = aliasFor(player.name, player.club);
    const key = player.id != null ? `id:${player.id}` : `alias:${exactAlias}`;
    merged.set(key, { ...player });
    registerAliases(player, key);
  }

  for (const update of liveUpdates) {
    const exactAlias = aliasFor(update.name, update.club);
    const idKey = update.id != null ? `id:${update.id}` : null;
    const exactOwners = exactAlias ? aliases.get(exactAlias) : null;
    const exactKey = exactOwners?.size === 1 ? [...exactOwners][0] : null;
    const key = (idKey && merged.has(idKey) && idKey)
      || exactKey
      || resolveAlias(update)
      || idKey
      || (exactAlias && `alias:${exactAlias}`);
    if (!key) continue;
    merged.set(key, { ...(merged.get(key) || {}), ...update });
    registerAliases(update, key);
  }

  return [...merged.values()];
}


function summarizeFixtures(result) {
  if (!result.ok) return [];

  return (result.data?.response || []).map((item) => ({
    id: item.fixture?.id,
    kickoff: item.fixture?.date,
    status: item.fixture?.status?.short,
    home: item.teams?.home?.name,
    away: item.teams?.away?.name,
    homeGoals: item.goals?.home,
    awayGoals: item.goals?.away
  }));
}


function summarizeResults(result) {
  if (!result.ok) return [];

  return (result.data?.matches || []).map((match) => ({
    id: match.id,
    gameweek: match.matchday,
    kickoff: match.utcDate,
    status: match.status,
    home: match.homeTeam?.name,
    away: match.awayTeam?.name,
    homeGoals: match.score?.fullTime?.home,
    awayGoals: match.score?.fullTime?.away
  }));
}


function summarizeOdds(result) {
  if (!result.ok || !Array.isArray(result.data)) return [];

  return result.data.map((event) => ({
    id: event.id,
    kickoff: event.commence_time,
    home: event.home_team,
    away: event.away_team,
    bookmakers: (event.bookmakers || []).slice(0, 5).map((book) => ({
      name: book.title,
      markets: book.markets
    }))
  }));
}


function summarizeNews(result) {
  if (!result.ok) return [];

  return (result.data?.articles || []).map((article) => ({
    title: article.title,
    description: article.description,
    url: article.url,
    source: article.source?.name,
    publishedAt: article.publishedAt
  }));
}


function summarizeFPL(result, updatedAt) {
  if (!result.ok || !Array.isArray(result.data?.elements)) return [];

  const teams = new Map(
    (result.data.teams || []).map((team) => [team.id, team])
  );
  const numeric = (value) => {
    if (value == null || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };

  return result.data.elements.map((element) => {
    const team = teams.get(element.team);
    const shortCode = team?.short_name === "COV"
      ? "CVC"
      : team?.short_name;
    const club = TEAM_CODES[team?.name] || shortCode || null;

    return {
      id: element.id,
      name: element.web_name
        || `${element.first_name || ""} ${element.second_name || ""}`.trim(),
      club,
      reference: {
        id: element.id,
        points: numeric(element.total_points),
        pointsPerGame: numeric(element.points_per_game),
        minutes: numeric(element.minutes),
        starts: numeric(element.starts),
        cleanSheets: numeric(element.clean_sheets),
        xg: numeric(element.expected_goals),
        xg90: numeric(element.expected_goals_per_90),
        xgc: numeric(element.expected_goals_conceded),
        xgc90: numeric(element.expected_goals_conceded_per_90),
        selectedBy: numeric(element.selected_by_percent),
        transfersInEvent: numeric(element.transfers_in_event),
        transfersOutEvent: numeric(element.transfers_out_event),
        updatedAt
      }
    };
  });
}


async function buildPayload(env, cache = caches.default, cacheOrigin = "https://fanteam-data.invalid") {
  const settled = await Promise.allSettled([
    getAPIFootball(env, cache, cacheOrigin),
    getFootballData(env),
    getOdds(env),
    getNews(env),
    getFPLBootstrap(),
    getFutbolFantasy(env, cache, cacheOrigin)
  ]);
  const failure = (result, label) => ({
    ok: false,
    error: result.status === "rejected"
      ? `${label}: ${result.reason?.message || "error inesperado"}`
      : `${label}: respuesta inválida`,
    data: null
  });
  const apiFootball = settled[0].status === "fulfilled"
    ? settled[0].value
    : {
      injuries: failure(settled[0], "API-Football injuries"),
      fixtures: failure(settled[0], "API-Football fixtures"),
      lineups: []
    };
  const footballData = settled[1].status === "fulfilled"
    ? settled[1].value
    : failure(settled[1], "football-data");
  const odds = settled[2].status === "fulfilled"
    ? settled[2].value
    : failure(settled[2], "odds");
  const news = settled[3].status === "fulfilled"
    ? settled[3].value
    : failure(settled[3], "news");
  const fpl = settled[4].status === "fulfilled"
    ? settled[4].value
    : failure(settled[4], "FPL");
  const futbolFantasy = settled[5].status === "fulfilled"
    ? settled[5].value
    : emptyFutbolFantasy({
      enabled: futbolFantasyEnabled(env),
      error: failure(settled[5], "FutbolFantasy").error,
      cacheStatus: "unavailable"
    });
  const updatedAt = new Date().toISOString();
  const lineupsHealthy = Array.isArray(apiFootball.lineups)
    && apiFootball.lineups.every((result) => result?.ok)
    && !apiFootball.meta?.lineupRequestsSkipped;
  const apiFootballStale = apiFootball.meta?.stale === true;
  const sources = {
    apiFootball: Boolean(
      apiFootball.fixtures?.ok
      && apiFootball.injuries?.ok
      && lineupsHealthy
    ),
    footballData: Boolean(footballData.ok),
    odds: Boolean(odds.ok),
    news: Boolean(news.ok),
    fpl: Boolean(fpl.ok)
  };
  const activeSources = Object.values(sources).filter(Boolean).length;
  const hasUsableData = Boolean(
    apiFootball.fixtures?.ok
    || apiFootball.injuries?.ok
    || footballData.ok
    || odds.ok
    || news.ok
    || fpl.ok
  );
  const results = summarizeResults(footballData);

  return {
    ok: hasUsableData,
    degraded: activeSources < Object.keys(sources).length || apiFootballStale,
    service: "FanTeam Data Engine",
    version: VERSION,
    build: BUILD_ID,
    updatedAt,
    currentGW: currentGameweek(results),

    players: mergePlayerRecords(
      summarizeFPL(fpl, updatedAt),
      parsePlayerUpdates(apiFootball)
    ),
    liveFixtures: summarizeFixtures(apiFootball.fixtures),
    results,
    odds: summarizeOdds(odds),
    news: summarizeNews(news),
    futbolFantasy,

    sources,
    sourceMeta: {
      apiFootball: apiFootball.meta || null
    },

    errors: {
      apiFootballCache: apiFootball.meta?.warning || null,
      apiFootballFixtures:
        apiFootball.fixtures?.ok ? null : apiFootball.fixtures?.error,
      apiFootballInjuries:
        apiFootball.injuries?.ok ? null : apiFootball.injuries?.error,
      apiFootballLineups: lineupsHealthy
        ? null
        : apiFootball.lineups
          .filter((result) => !result?.ok)
          .map((result) => result?.error || "respuesta inválida")
          .join("; "),
      footballData:
        footballData.ok ? null : footballData.error,
      odds:
        odds.ok ? null : odds.error,
      news:
        news.ok ? null : news.error,
      fpl:
        fpl.ok ? null : fpl.error
    }
  };
}


export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      const template = responseJSON(null, 200, 0, request, env);
      return new Response(null, { status: 204, headers: template.headers });
    }

    const latestRoute = url.pathname === "/" || url.pathname === "/latest";
    const healthRoute = url.pathname === "/health";

    if (!latestRoute && !healthRoute) {
      return responseJSON(
        { ok: false, error: "Ruta no encontrada" },
        404,
        0,
        request,
        env
      );
    }

    if (request.method !== "GET") {
      return responseJSON(
        { ok: false, error: "Método no permitido" },
        405,
        0,
        request,
        env
      );
    }

    if (healthRoute) {
      return responseJSON({
        ok: true,
        service: "FanTeam Data Engine",
        version: VERSION,
        build: BUILD_ID,
        updatedAt: new Date().toISOString()
      }, 200, 0, request, env);
    }

    const cache = caches.default;
    const originBucket = allowedOrigin(request, env) || "server";
    const pretty = url.searchParams.get("pretty") === "1" ? "pretty" : "compact";
    const cacheBase = `${url.origin}/__fanteam_cache_v12${url.pathname}`
      + `?cors=${encodeURIComponent(originBucket)}&format=${pretty}`;
    const healthyKey = new Request(`${cacheBase}&quality=healthy`, { method: "GET" });
    const degradedKey = new Request(`${cacheBase}&quality=degraded`, { method: "GET" });

    const cached = await cache.match(healthyKey) || await cache.match(degradedKey);
    if (cached) return cached;

    const payload = await buildPayload(env, cache, url.origin);

    // Caché adaptativa: los payloads completos duran 15 min durante partidos
    // o 3 h fuera de ventana. Una respuesta parcial usa una clave separada y
    // solo dura 2 min, para no reemplazar una respuesta sana con un fallo puntual.
    const now = Date.now();
    const matchWindow = payload.liveFixtures.some((match) => {
      const kickoff = new Date(match.kickoff).getTime();
      return (
        Number.isFinite(kickoff)
        && kickoff >= now - 3 * 3600000
        && kickoff <= now + 4 * 3600000
      );
    });
    let ttl = payload.degraded
      ? DEGRADED_TTL_SECONDS
      : matchWindow
        ? 900
        : 10800;
    const apiMeta = payload.sourceMeta?.apiFootball;
    const apiDeadline = Number(apiMeta?.stale ? apiMeta.staleUntil : apiMeta?.freshUntil);
    if (Number.isFinite(apiDeadline)) {
      ttl = Math.min(ttl, Math.max(0, Math.floor((apiDeadline - now) / 1000)));
    }
    payload.freshUntil = new Date(now + ttl * 1000).toISOString();
    const response = responseJSON(payload, 200, ttl, request, env);
    const cacheKey = payload.degraded ? degradedKey : healthyKey;

    if (ttl > 0) ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  }
};
