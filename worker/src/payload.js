import { TEAM_CODES } from "./api-football.js";
import { summarizeFPL } from "./sources.js";

const VERSION = "2.3.1";
const BUILD_ID = "api-football-resilience-v1";

function summarizeFixtures(result) {
  if (!result.ok) return [];
  return (result.data?.response || []).map((item) => ({
    id: item.fixture?.id, kickoff: item.fixture?.date, status: item.fixture?.status?.short,
    home: item.teams?.home?.name, away: item.teams?.away?.name,
    homeGoals: item.goals?.home, awayGoals: item.goals?.away
  }));
}

function normalizePlayerKey(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function mergePlayerRecords(referencePlayers, liveUpdates) {
  const merged = new Map();
  const aliases = new Map();
  const aliasFor = (name, club) => {
    const normalizedName = normalizePlayerKey(name);
    const normalizedClub = normalizePlayerKey(club);
    return normalizedName && normalizedClub ? `${normalizedName}|${normalizedClub}` : null;
  };
  const nameVariants = (player) => {
    const name = normalizePlayerKey(player?.name);
    if (!name) return [];
    const tokens = name.split(" ");
    return [...new Set([name, tokens.slice(-2).join(" "), tokens.at(-1), tokens[0]].filter(Boolean))];
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
    const key = (idKey && merged.has(idKey) && idKey) || exactKey || resolveAlias(update) || idKey || (exactAlias && `alias:${exactAlias}`);
    if (!key) continue;
    merged.set(key, { ...(merged.get(key) || {}), ...update });
    registerAliases(update, key);
  }
  return [...merged.values()];
}

function parsePlayerUpdates(apiFootball) {
  const updates = new Map();
  if (apiFootball.injuries.ok) {
    const injuries = apiFootball.injuries.data?.response || [];
    const now = Date.now();
    const maxAge = 21 * 86400000;
    const seen = new Map();
    for (const item of injuries) {
      const name = item.player?.name;
      const club = TEAM_CODES[item.team?.name];
      if (!name) continue;
      const parsed = item.fixture?.date ? new Date(item.fixture.date).getTime() : NaN;
      const when = Number.isFinite(parsed) ? parsed : now;
      if (now - when > maxAge) continue;
      const key = `${name}|${club || ""}`;
      if (seen.has(key) && seen.get(key) >= when) continue;
      seen.set(key, when);
      const questionable = item.player?.type === "Questionable";
      updates.set(key, { name, club, confidence: questionable ? 30 : 5, minutes: questionable ? 30 : 0, status: item.player?.reason || item.player?.type || "Lesion" });
    }
  }
  for (const lineupResult of apiFootball.lineups) {
    if (!lineupResult.ok) continue;
    for (const team of lineupResult.data?.response || []) {
      const club = TEAM_CODES[team.team?.name];
      for (const item of team.startXI || []) {
        const name = item.player?.name;
        if (!name) continue;
        updates.set(`${name}|${club || ""}`, { name, club, confidence: 95, minutes: 85, status: "Titular confirmado" });
      }
      for (const item of team.substitutes || []) {
        const name = item.player?.name;
        if (!name) continue;
        if (!updates.has(`${name}|${club || ""}`)) {
          updates.set(`${name}|${club || ""}`, { name, club, confidence: 30, minutes: 25, status: "Suplente confirmado" });
        }
      }
    }
  }
  return [...updates.values()];
}

function currentGameweek(results = []) {
  const DEADLINES = ("2026-08-21,2026-08-28,2026-09-04,2026-09-12,2026-09-18,2026-10-10,2026-10-17,2026-10-24,2026-10-31,2026-11-07,2026-11-21,2026-11-28,2026-12-02,2026-12-05,2026-12-12,2026-12-19,2026-12-26,2026-12-30,2027-01-02,2027-01-06,2027-01-16,2027-01-23,2027-01-30,2027-02-06,2027-02-10,2027-02-20,2027-02-27,2027-03-03,2027-03-13,2027-03-20,2027-04-10,2027-04-17,2027-04-24,2027-05-01,2027-05-08,2027-05-15,2027-05-23,2027-05-30").split(",").map((date) => `${date}T17:00:00Z`);
  const now = Date.now();
  const firstKickoffByGameweek = new Map();
  for (const match of results) {
    const gameweek = Number(match?.gameweek);
    const kickoff = new Date(match?.kickoff || "").getTime();
    if (!Number.isInteger(gameweek) || gameweek < 1 || gameweek > 38) continue;
    if (!Number.isFinite(kickoff)) continue;
    const previous = firstKickoffByGameweek.get(gameweek);
    if (previous == null || kickoff < previous) firstKickoffByGameweek.set(gameweek, kickoff);
  }
  const upcoming = Array.from(firstKickoffByGameweek, ([gameweek, kickoff]) => ({ gameweek, deadline: kickoff - 90 * 60000 })).filter((entry) => entry.deadline > now).sort((first, second) => first.deadline - second.deadline || first.gameweek - second.gameweek);
  if (upcoming.length) return upcoming[0].gameweek;
  for (let index = 0; index < DEADLINES.length; index++) { if (new Date(DEADLINES[index]).getTime() > now) return index + 1; }
  return 38;
}

async function buildPayload(env, cache = caches.default, cacheOrigin = "https://fanteam-data.invalid") {
  const { getAPIFootball } = await import("./api-football.js");
  const { getFootballData, getOdds, getNews, getFPLBootstrap, summarizeResults, summarizeOdds, summarizeNews } = await import("./sources.js");
  const m = await import("./futbolfantasy.js");
  const settled = await Promise.allSettled([
    getAPIFootball(env, cache, cacheOrigin),
    getFootballData(env), getOdds(env), getNews(env),
    getFPLBootstrap(),
    m.getFutbolFantasy(env, cache, cacheOrigin)
  ]);
  const failure = (result, label) => ({ ok: false, error: result.status === "rejected" ? `${label}: ${result.reason?.message || "unexpected error"}` : `${label}: invalid response`, data: null });
  const apiFootball = settled[0].status === "fulfilled" ? settled[0].value : { injuries: failure(settled[0], "API-Football injuries"), fixtures: failure(settled[0], "API-Football fixtures"), lineups: [] };
  const footballData = settled[1].status === "fulfilled" ? settled[1].value : failure(settled[1], "football-data");
  const odds = settled[2].status === "fulfilled" ? settled[2].value : failure(settled[2], "odds");
  const news = settled[3].status === "fulfilled" ? settled[3].value : failure(settled[3], "news");
  const fpl = settled[4].status === "fulfilled" ? settled[4].value : failure(settled[4], "FPL");
  const futbolFantasy = settled[5].status === "fulfilled" ? settled[5].value : m.emptyFutbolFantasy({ enabled: m.futbolFantasyEnabled(env), error: failure(settled[5], "FutbolFantasy").error, cacheStatus: "unavailable" });
  const updatedAt = new Date().toISOString();
  const lineupsHealthy = Array.isArray(apiFootball.lineups) && apiFootball.lineups.every((result) => result?.ok) && !apiFootball.meta?.lineupRequestsSkipped;
  const apiFootballStale = apiFootball.meta?.stale === true;
  const sources = { apiFootball: Boolean(apiFootball.fixtures?.ok && apiFootball.injuries?.ok && lineupsHealthy), footballData: Boolean(footballData.ok), odds: Boolean(odds.ok), news: Boolean(news.ok), fpl: Boolean(fpl.ok) };
  const activeSources = Object.values(sources).filter(Boolean).length;
  const hasUsableData = Boolean(apiFootball.fixtures?.ok || apiFootball.injuries?.ok || footballData.ok || odds.ok || news.ok || fpl.ok);
  const results = summarizeResults(footballData);
  return {
    ok: hasUsableData, degraded: activeSources < Object.keys(sources).length || apiFootballStale,
    service: "FanTeam Data Engine", version: VERSION, build: BUILD_ID, updatedAt,
    currentGW: currentGameweek(results),
    players: mergePlayerRecords(summarizeFPL(fpl, updatedAt, TEAM_CODES), parsePlayerUpdates(apiFootball)),
    liveFixtures: summarizeFixtures(apiFootball.fixtures), results, odds: summarizeOdds(odds),
    news: summarizeNews(news), futbolFantasy, sources,
    sourceMeta: { apiFootball: apiFootball.meta || null },
    errors: {
      apiFootballCache: apiFootball.meta?.warning || null,
      apiFootballFixtures: apiFootball.fixtures?.ok ? null : apiFootball.fixtures?.error,
      apiFootballInjuries: apiFootball.injuries?.ok ? null : apiFootball.injuries?.error,
      apiFootballLineups: lineupsHealthy ? null : apiFootball.lineups.filter((r) => !r?.ok).map((r) => r?.error || "invalid response").join("; "),
      footballData: footballData.ok ? null : footballData.error, odds: odds.ok ? null : odds.error, news: news.ok ? null : news.error, fpl: fpl.ok ? null : fpl.error
    }
  };
}

export { buildPayload, VERSION, BUILD_ID, currentGameweek };
