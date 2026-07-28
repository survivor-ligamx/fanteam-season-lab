export const DEADLINES = (
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


export const VERSION = "2.3.1";
export const BUILD_ID = "api-football-resilience-v1";
export const REQUEST_TIMEOUT_MS = 6000;
export const API_FOOTBALL_REFRESH_BUDGET_MS = 15 * 1000;
export const DEGRADED_TTL_SECONDS = 120;
export const API_FOOTBALL_FRESH_MS = 15 * 60000;
export const API_FOOTBALL_STALE_MS = 6 * 3600000;
export const API_FOOTBALL_BACKOFF_BASE_MS = 15 * 60000;
export const API_FOOTBALL_BACKOFF_MAX_MS = 6 * 3600000;
export const MAX_LINEUP_REQUESTS = 10;
export const FUTBOLFANTASY_HOME_URL = "https://www.futbolfantasy.com/premier-league/home";
export const FUTBOLFANTASY_URLS = Object.freeze({
  news: "https://www.futbolfantasy.com/premier-league/noticias",
  injuries: "https://www.futbolfantasy.com/premier-league/lesionados",
  suspensions: "https://www.futbolfantasy.com/premier-league/sancionados",
  lineups: "https://www.futbolfantasy.com/premier-league/posibles-alineaciones"
});
export const FUTBOLFANTASY_FRESH_MS = 6 * 3600000;
export const FUTBOLFANTASY_STALE_MS = 72 * 3600000;
export const FUTBOLFANTASY_MAX_HTML_BYTES = 1500000;
export const ALLOWED_ORIGINS = new Set([
  "https://survivor-ligamx.github.io",
  "null"
]);

export const TEAM_CODES = {
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
