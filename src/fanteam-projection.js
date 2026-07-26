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

  function finite(value) {
    if (value == null || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function ownership(player) {
    const selectedBy = finite(player?.reference?.selectedBy);
    return selectedBy == null ? null : clamp(selectedBy, 0, 100);
  }

  function referenceFormFactor(player, expectedPoints) {
    const reference = player?.reference;
    if (!reference || typeof reference !== "object") return 1;
    const starts = finite(reference.starts) || 0;
    const minutes = finite(reference.minutes) || 0;
    const sample = Math.max(starts, minutes / 90);
    const pointsPerGame = finite(reference.pointsPerGame);
    if (sample < 3 || pointsPerGame == null || pointsPerGame <= 0) return 1;

    const performance = clamp(pointsPerGame / Math.max(2, expectedPoints), .65, 1.35);
    let factor = 1 + .28 * (performance - 1);
    const xg90 = finite(reference.xg90);
    if ((player.pos === "MID" || player.pos === "FWD") && xg90 != null) {
      const benchmark = player.pos === "FWD" ? .42 : .28;
      factor += .08 * clamp((xg90 - benchmark) / benchmark, -.5, .5);
    }
    return clamp(factor, .88, 1.12);
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
      const scheduled = fixture(player, gameweek);
      const fixtureMultiplier = scheduled
        ? clamp(1 + scheduled.adv / 250, .78, 1.22)
        : 1;
      // Captaincy rewards weekly ceiling more than a season-long price signal. The base
      // projection already includes one fixture multiplier; this adds a measured ceiling
      // adjustment so difficult/easy fixtures can rotate C/VC instead of locking one premium.
      const fixtureCeiling = fixtureMultiplier ** 1.5;
      const formFactor = referenceFormFactor(player, base);
      const selectedBy = ownership(player);
      const clubMatches = getOdds().filter((match) => (
        match.gw === gameweek && (match.home === player.club || match.away === player.club)
      ));
      const exact = scheduled
        ? clubMatches.find((match) => (
          (scheduled.home && match.home === player.club && match.away === scheduled.opp)
          || (!scheduled.home && match.away === player.club && match.home === scheduled.opp)
        ))
        : null;
      const match = exact || (clubMatches.length === 1 ? clubMatches[0] : null);
      if (!match) {
        return {
          ev: base * fixtureCeiling * formFactor,
          base,
          used: false,
          match: null,
          fixtureCeiling,
          formFactor,
          selectedBy,
        };
      }
      const win = player.club === match.home ? match.homeWin : match.awayWin;
      const marketOver = Number.isFinite(match.over25) ? match.over25 : null;
      const over = marketOver ?? .55;
      const winDelta = win - .42;
      const overDelta = over - .55;
      const factor = player.pos === "GK" || player.pos === "DEF"
        ? clamp(1 + .32 * winDelta - .22 * overDelta, .78, 1.24)
        : clamp(1 + .48 * winDelta + .28 * overDelta, .76, 1.32);
      return {
        ev: base * fixtureCeiling * formFactor * factor,
        base,
        used: true,
        factor,
        fixtureCeiling,
        formFactor,
        selectedBy,
        win,
        over: marketOver,
        match,
      };
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
      const differential = ranked
        .filter((candidate) => (
          candidate.p.id !== best.cap.id
          && candidate.metric.selectedBy != null
          && candidate.metric.selectedBy <= 15
          && candidate.metric.ev >= best.capMetric.ev * .72
          && candidate.p.confidence >= 45
        ))
        .sort((first, second) => {
          const firstScore = first.metric.ev
            * (1 + (15 - first.metric.selectedBy) / 100);
          const secondScore = second.metric.ev
            * (1 + (15 - second.metric.selectedBy) / 100);
          return secondScore - firstScore || second.metric.ev - first.metric.ev;
        })[0] || null;
      best.differential = differential?.p || null;
      best.differentialMetric = differential?.metric || null;
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
