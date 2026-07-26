(function attachFanTeamProjection(global) {
  "use strict";

  const VERSION = "fanteam-projection-v1";
  const MAX_GAMEWEEK = 38;
  const FORMATIONS = Object.freeze([
    Object.freeze([3, 5, 2]),
    Object.freeze([3, 4, 3]),
    Object.freeze([4, 5, 1]),
    Object.freeze([4, 4, 2]),
    Object.freeze([4, 3, 3]),
    Object.freeze([5, 4, 1]),
    Object.freeze([5, 3, 2]),
    Object.freeze([5, 2, 3]),
  ]);
  const HORIZON_WEIGHTS = Object.freeze([1, .65, .35]);
  const SIX_WEEK_WEIGHTS = Object.freeze([1, .85, .7, .55, .4, .28]);

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function availability(player) {
    return player.confidence <= 10 ? .12 : player.confidence <= 25 ? .5 : 1;
  }

  function create(options) {
    const {
      fixture,
      byId,
      getOdds,
      maxGameweek = MAX_GAMEWEEK,
    } = options || {};
    if (typeof fixture !== "function") throw new Error("fixture es obligatorio");
    if (typeof byId !== "function") throw new Error("byId es obligatorio");
    if (typeof getOdds !== "function") throw new Error("getOdds es obligatorio");

    function projection(player, gameweek) {
      const scheduled = fixture(player, gameweek);
      if (!scheduled) return 0;
      const base = { GK: 2.6, DEF: 2.5, MID: 2.7, FWD: 2.8 }[player.pos];
      const slope = { GK: .45, DEF: .65, MID: .8, FWD: .85 }[player.pos];
      const multiplier = clamp(1 + scheduled.adv / 250, .78, 1.22);
      const role = .58 + .42 * (player.confidence / 100);
      return Math.max(
        .1,
        (base + slope * (player.price - 4)) * multiplier * role * availability(player),
      );
    }

    function captainExpectedValue(player, gameweek) {
      const base = projection(player, gameweek);
      const clubMatches = getOdds().filter((match) => (
        match.gw === gameweek && (match.home === player.club || match.away === player.club)
      ));
      const scheduled = fixture(player, gameweek);
      const exact = scheduled
        ? clubMatches.find((match) => (
          (scheduled.home && match.home === player.club && match.away === scheduled.opp)
          || (!scheduled.home && match.away === player.club && match.home === scheduled.opp)
        ))
        : null;
      const match = exact || (clubMatches.length === 1 ? clubMatches[0] : null);
      if (!match) return { ev: base, base, used: false, match: null };
      const win = player.club === match.home ? match.homeWin : match.awayWin;
      const marketOver = Number.isFinite(match.over25) ? match.over25 : null;
      const over = marketOver ?? .55;
      const winDelta = win - .42;
      const overDelta = over - .55;
      const factor = player.pos === "GK" || player.pos === "DEF"
        ? clamp(1 + .22 * winDelta - .16 * overDelta, .84, 1.18)
        : clamp(1 + .30 * winDelta + .18 * overDelta, .84, 1.18);
      return { ev: base * factor, base, used: true, factor, win, over: marketOver, match };
    }

    function bestXI(ids, gameweek) {
      const squad = ids.map(byId);
      let best = null;
      for (const [defenders, midfielders, forwards] of FORMATIONS) {
        const pick = (position, count) => squad
          .filter((player) => player.pos === position)
          .sort((first, second) => projection(second, gameweek) - projection(first, gameweek))
          .slice(0, count);
        const xi = [
          ...pick("GK", 1),
          ...pick("DEF", defenders),
          ...pick("MID", midfielders),
          ...pick("FWD", forwards),
        ];
        if (xi.length !== 11) continue;
        const points = xi.reduce((total, player) => total + projection(player, gameweek), 0);
        if (!best || points > best.pts) {
          best = { xi, pts: points, formation: `${defenders}-${midfielders}-${forwards}` };
        }
      }
      const ranked = best.xi
        .map((player) => ({ p: player, metric: captainExpectedValue(player, gameweek) }))
        .sort((first, second) => second.metric.ev - first.metric.ev);
      best.cap = ranked[0].p;
      best.vice = ranked[1].p;
      best.capMetric = ranked[0].metric;
      best.viceMetric = ranked[1].metric;
      best.oddsUsed = ranked.some((candidate) => candidate.metric.used);
      return best;
    }

    function captainedTotal(xi) {
      return xi.pts - xi.capMetric.base + 2 * xi.capMetric.ev;
    }

    function weightedHorizon(player, gameweek, weights) {
      let total = 0;
      for (let index = 0; index < weights.length; index += 1) {
        if (gameweek + index > maxGameweek) break;
        total += weights[index] * projection(player, gameweek + index);
      }
      return total;
    }

    function horizon(player, gameweek) {
      return weightedHorizon(player, gameweek, HORIZON_WEIGHTS);
    }

    function horizon6(player, gameweek) {
      return weightedHorizon(player, gameweek, SIX_WEEK_WEIGHTS);
    }

    return Object.freeze({
      availability,
      bestXI,
      captainExpectedValue,
      captainedTotal,
      horizon,
      horizon6,
      projection,
    });
  }

  global.FanTeamProjection = Object.freeze({
    VERSION,
    FORMATIONS,
    HORIZON_WEIGHTS,
    MAX_GAMEWEEK,
    SIX_WEEK_WEIGHTS,
    availability,
    create,
  });
})(globalThis);
