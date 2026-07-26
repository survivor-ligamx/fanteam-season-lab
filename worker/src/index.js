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


const VERSION = "2.3.0";
const REQUEST_TIMEOUT_MS = 6000;
const DEGRADED_TTL_SECONDS = 120;
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


async function safeRequest(url, options = {}) {
  const { timeoutMs = REQUEST_TIMEOUT_MS, ...fetchOptions } = options;
  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: fetchOptions.signal || AbortSignal.timeout(timeoutMs)
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return {
      ok: true,
      data: await response.json()
    };
  } catch (error) {
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    return {
      ok: false,
      error: timedOut ? `timeout después de ${timeoutMs} ms` : error.message,
      data: null
    };
  }
}


async function getAPIFootball(env) {
  if (!env.API_FOOTBALL_KEY) {
    return {
      injuries: { ok: false, error: "API_FOOTBALL_KEY no configurada" },
      fixtures: { ok: false, error: "API_FOOTBALL_KEY no configurada" },
      lineups: []
    };
  }

  const headers = {
    "x-apisports-key": env.API_FOOTBALL_KEY
  };
  const deadline = Date.now() + REQUEST_TIMEOUT_MS;
  const requestWithinDeadline = (url) => safeRequest(url, {
    headers,
    timeoutMs: Math.max(1, deadline - Date.now())
  });

  const today = new Date();
  const from = today.toISOString().slice(0, 10);
  const future = new Date(today.getTime() + 8 * 86400000)
    .toISOString()
    .slice(0, 10);

  const [injuries, fixtures] = await Promise.all([
    requestWithinDeadline(
      "https://v3.football.api-sports.io/injuries?league=39&season=2026"
    ),
    requestWithinDeadline(
      `https://v3.football.api-sports.io/fixtures?league=39&season=2026&from=${from}&to=${future}`
    )
  ]);

  const nearbyFixtures =
    fixtures.ok && Array.isArray(fixtures.data?.response)
      ? fixtures.data.response
          .filter((item) => {
            const kickoff = new Date(item.fixture.date).getTime();
            const difference = kickoff - Date.now();

            return difference >= -30 * 60000 && difference <= 120 * 60000;
          })
          .slice(0, 2)
      : [];

  const lineups = await Promise.all(
    nearbyFixtures.map((item) => requestWithinDeadline(
      `https://v3.football.api-sports.io/fixtures/lineups?fixture=${item.fixture.id}`
    ))
  );

  return { injuries, fixtures, lineups };
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


async function buildPayload(env) {
  const settled = await Promise.allSettled([
    getAPIFootball(env),
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
    && apiFootball.lineups.every((result) => result?.ok);
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
    degraded: activeSources < Object.keys(sources).length,
    service: "FanTeam Data Engine",
    version: VERSION,
    updatedAt,
    currentGW: currentGameweek(results),

    players: [
      ...summarizeFPL(fpl, updatedAt),
      ...parsePlayerUpdates(apiFootball)
    ],
    liveFixtures: summarizeFixtures(apiFootball.fixtures),
    results,
    odds: summarizeOdds(odds),
    news: summarizeNews(news),

    sources,

    errors: {
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

    if (request.method === "OPTIONS") {
      const template = responseJSON(null, 200, 0, request, env);
      return new Response(null, { status: 204, headers: template.headers });
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
        updatedAt: new Date().toISOString()
      }, 200, 0, request, env);
    }

    const cache = caches.default;
    const originBucket = allowedOrigin(request, env) || "server";
    const pretty = url.searchParams.get("pretty") === "1" ? "pretty" : "compact";
    const cacheBase = `${url.origin}/__fanteam_cache_v10${url.pathname}`
      + `?cors=${encodeURIComponent(originBucket)}&format=${pretty}`;
    const healthyKey = new Request(`${cacheBase}&quality=healthy`, { method: "GET" });
    const degradedKey = new Request(`${cacheBase}&quality=degraded`, { method: "GET" });

    const cached = await cache.match(healthyKey) || await cache.match(degradedKey);
    if (cached) return cached;

    const payload = await buildPayload(env);

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
    const ttl = payload.degraded
      ? DEGRADED_TTL_SECONDS
      : matchWindow
        ? 900
        : 10800;
    const response = responseJSON(payload, 200, ttl, request, env);
    const cacheKey = payload.degraded ? degradedKey : healthyKey;

    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  }
};
