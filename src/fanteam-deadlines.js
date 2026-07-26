(function attachFanTeamDeadlines(global) {
  "use strict";

  const VERSION = "fanteam-deadlines-v1";
  const MAX_GAMEWEEK = 38;
  const CLOSE_BEFORE_KICKOFF_MS = 90 * 60000;

  function validDate(value) {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
  }

  function derive(results, fallback = []) {
    const earliest = new Map();
    for (const item of Array.isArray(results) ? results : []) {
      const gw = Number(item?.gameweek ?? item?.gw);
      const kickoff = validDate(item?.kickoff ?? item?.utcDate ?? item?.date);
      if (!Number.isInteger(gw) || gw < 1 || gw > MAX_GAMEWEEK || !kickoff) continue;
      const previous = earliest.get(gw);
      if (!previous || kickoff < previous) earliest.set(gw, kickoff);
    }
    return Array.from({ length: MAX_GAMEWEEK }, (_, index) => {
      const gw = index + 1;
      const derived = earliest.get(gw);
      if (derived) return new Date(derived.getTime() - CLOSE_BEFORE_KICKOFF_MS).toISOString();
      return typeof fallback[index] === "string" ? fallback[index] : null;
    });
  }

  function next(now, deadlines) {
    const time = validDate(now)?.getTime() ?? Date.now();
    const list = Array.isArray(deadlines) ? deadlines : [];
    for (let index = 0; index < list.length; index += 1) {
      const deadline = validDate(list[index]);
      if (deadline && deadline.getTime() > time) return { gameweek: index + 1, deadline: deadline.toISOString() };
    }
    return { gameweek: MAX_GAMEWEEK, deadline: null };
  }

  global.FanTeamDeadlines = Object.freeze({ VERSION, MAX_GAMEWEEK, CLOSE_BEFORE_KICKOFF_MS, derive, next });
})(globalThis);
