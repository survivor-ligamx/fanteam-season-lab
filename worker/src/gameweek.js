import { DEADLINES } from './config.js';

export function currentGameweek(results = []) {
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
