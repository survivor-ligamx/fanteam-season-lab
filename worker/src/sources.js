const REQUEST_TIMEOUT_MS = 6000;

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
    const response = await fetch(url, { ...fetchOptions, signal: fetchOptions.signal || AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      return {
        ok: false, error: `HTTP ${response.status}`, status: response.status,
        retryAfterAt: response.status === 429 ? retryAfterTimestamp(response.headers.get("Retry-After"), Date.now()) : null,
        data: null
      };
    }
    return { ok: true, status: response.status, data: await response.json() };
  } catch (error) {
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    return { ok: false, error: timedOut ? `timeout after ${timeoutMs}ms` : error.message, status: null, retryAfterAt: null, data: null };
  }
}

async function getFootballData(env) {
  if (!env.FOOTBALL_DATA_KEY) return { ok: false, error: "FOOTBALL_DATA_KEY not configured" };
  return safeRequest("https://api.football-data.org/v4/competitions/PL/matches?season=2026", {
    headers: { "X-Auth-Token": env.FOOTBALL_DATA_KEY }
  });
}

async function getOdds(env) {
  if (!env.ODDS_API_KEY) return { ok: false, error: "ODDS_API_KEY not configured" };
  const parameters = new URLSearchParams({ apiKey: env.ODDS_API_KEY, regions: "uk", markets: "h2h,totals", oddsFormat: "decimal", dateFormat: "iso" });
  return safeRequest(`https://api.the-odds-api.com/v4/sports/soccer_epl/odds?${parameters}`);
}

async function getNews(env) {
  if (!env.GNEWS_API_KEY) return { ok: false, error: "GNEWS_API_KEY not configured" };
  const parameters = new URLSearchParams({ q: '"Premier League" injury OR lineup OR suspension', lang: "en", country: "gb", max: "10", apikey: env.GNEWS_API_KEY });
  return safeRequest(`https://gnews.io/api/v4/search?${parameters}`);
}

async function getFPLBootstrap() {
  return safeRequest("https://fantasy.premierleague.com/api/bootstrap-static/");
}

function summarizeResults(result) {
  if (!result.ok) return [];
  return (result.data?.matches || []).map((match) => ({
    id: match.id, gameweek: match.matchday, kickoff: match.utcDate, status: match.status,
    home: match.homeTeam?.name, away: match.awayTeam?.name,
    homeGoals: match.score?.fullTime?.home, awayGoals: match.score?.fullTime?.away
  }));
}

function summarizeOdds(result) {
  if (!result.ok || !Array.isArray(result.data)) return [];
  return result.data.map((event) => ({
    id: event.id, kickoff: event.commence_time, home: event.home_team, away: event.away_team,
    bookmakers: (event.bookmakers || []).slice(0, 5).map((book) => ({ name: book.title, markets: book.markets }))
  }));
}

function summarizeNews(result) {
  if (!result.ok) return [];
  return (result.data?.articles || []).map((article) => ({
    title: article.title, description: article.description, url: article.url,
    source: article.source?.name, publishedAt: article.publishedAt
  }));
}

function summarizeFPL(result, updatedAt, TEAM_CODES) {
  if (!result.ok || !Array.isArray(result.data?.elements)) return [];
  const teams = new Map((result.data.teams || []).map((team) => [team.id, team]));
  const numeric = (value) => { if (value == null || value === "") return null; const number = Number(value); return Number.isFinite(number) ? number : null; };
  return result.data.elements.map((element) => {
    const team = teams.get(element.team);
    const shortCode = team?.short_name === "COV" ? "CVC" : team?.short_name;
    const club = TEAM_CODES[team?.name] || shortCode || null;
    return {
      id: element.id,
      name: element.web_name || `${element.first_name || ""} ${element.second_name || ""}`.trim(),
      club,
      reference: {
        id: element.id, points: numeric(element.total_points), pointsPerGame: numeric(element.points_per_game),
        minutes: numeric(element.minutes), starts: numeric(element.starts), cleanSheets: numeric(element.clean_sheets),
        xg: numeric(element.expected_goals), xg90: numeric(element.expected_goals_per_90),
        xgc: numeric(element.expected_goals_conceded), xgc90: numeric(element.expected_goals_conceded_per_90),
        selectedBy: numeric(element.selected_by_percent),
        transfersInEvent: numeric(element.transfers_in_event), transfersOutEvent: numeric(element.transfers_out_event),
        updatedAt
      }
    };
  });
}

export { safeRequest, getFootballData, getOdds, getNews, getFPLBootstrap, summarizeResults, summarizeOdds, summarizeNews, summarizeFPL };
