import { BUILD_ID, VERSION } from './config.js';
import { currentGameweek } from './gameweek.js';
import { getAPIFootball } from './api-football.js';
import { getFootballData, getNews, getOdds } from './external-sources.js';
import { emptyFutbolFantasy, futbolFantasyEnabled, getFutbolFantasy } from './futbolfantasy-source.js';
import { getFPLBootstrap } from './fpl-source.js';
import { mergePlayerRecords, parsePlayerUpdates } from './players.js';
import { summarizeFixtures, summarizeFPL, summarizeNews, summarizeOdds, summarizeResults } from './summarizers.js';

export async function buildPayload(env, cache = caches.default, cacheOrigin = "https://fanteam-data.invalid") {
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
