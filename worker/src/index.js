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
    getFPLBootstrap()
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
    const cacheBase = `${url.origin}/__fanteam_cache_v11${url.pathname}`
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
