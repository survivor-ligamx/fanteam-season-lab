import { safeRequest } from './http.js';

export async function getFootballData(env) {
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


export async function getOdds(env) {
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


export async function getNews(env) {
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
