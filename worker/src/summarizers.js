import { TEAM_CODES } from './config.js';

export function summarizeFixtures(result) {
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


export function summarizeResults(result) {
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


export function summarizeOdds(result) {
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


export function summarizeNews(result) {
  if (!result.ok) return [];

  return (result.data?.articles || []).map((article) => ({
    title: article.title,
    description: article.description,
    url: article.url,
    source: article.source?.name,
    publishedAt: article.publishedAt
  }));
}


export function summarizeFPL(result, updatedAt) {
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
