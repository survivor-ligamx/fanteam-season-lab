(function attachFanTeamMarket(global) {
  "use strict";

  const VERSION = "fanteam-market-v1";
  const MAX_GAMEWEEK = 38;
  const POSITIONS = Object.freeze(["GK", "DEF", "MID", "FWD"]);

  function finite(value) {
    if (value == null || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function rounded(value, digits = 2) {
    if (!Number.isFinite(value)) return null;
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  function poisson(lambda, goals) {
    let probability = Math.exp(-lambda);
    for (let index = 1; index <= goals; index += 1) {
      probability *= lambda / index;
    }
    return probability;
  }

  function outcomeProbabilities(homeLambda, awayLambda) {
    let home = 0;
    let draw = 0;
    let away = 0;
    const limit = 14;
    for (let homeGoals = 0; homeGoals <= limit; homeGoals += 1) {
      const homeProbability = poisson(homeLambda, homeGoals);
      for (let awayGoals = 0; awayGoals <= limit; awayGoals += 1) {
        const probability = homeProbability * poisson(awayLambda, awayGoals);
        if (homeGoals > awayGoals) home += probability;
        else if (homeGoals < awayGoals) away += probability;
        else draw += probability;
      }
    }
    const total = home + draw + away;
    return total > 0
      ? { home: home / total, draw: draw / total, away: away / total }
      : null;
  }

  function overTwoAndHalf(lambda) {
    return 1 - Math.exp(-lambda) * (1 + lambda + lambda * lambda / 2);
  }

  function totalGoalsLambda(over25) {
    if (!Number.isFinite(over25) || over25 <= 0 || over25 >= 1) return null;
    let low = 0.05;
    let high = 8;
    for (let iteration = 0; iteration < 60; iteration += 1) {
      const middle = (low + high) / 2;
      if (overTwoAndHalf(middle) < over25) low = middle;
      else high = middle;
    }
    return (low + high) / 2;
  }

  function marketGoalModel(match) {
    const homeWin = finite(match?.homeWin);
    const awayWin = finite(match?.awayWin);
    const over25 = finite(match?.over25);
    if (
      homeWin == null
      || awayWin == null
      || over25 == null
      || homeWin <= 0
      || awayWin <= 0
      || homeWin + awayWin >= 1
    ) return null;
    const totalLambda = totalGoalsLambda(over25);
    if (!totalLambda) return null;
    const targets = { home: homeWin, away: awayWin, draw: 1 - homeWin - awayWin };
    let best = null;
    let low = 0.02;
    let high = totalLambda - 0.02;
    for (let pass = 0; pass < 4; pass += 1) {
      const step = (high - low) / 120;
      for (let index = 0; index <= 120; index += 1) {
        const homeLambda = low + step * index;
        const awayLambda = totalLambda - homeLambda;
        if (homeLambda <= 0 || awayLambda <= 0) continue;
        const outcomes = outcomeProbabilities(homeLambda, awayLambda);
        const error = (
          (outcomes.home - targets.home) ** 2
          + (outcomes.draw - targets.draw) ** 2
          + (outcomes.away - targets.away) ** 2
        );
        if (!best || error < best.error) {
          best = { homeLambda, awayLambda, outcomes, error };
        }
      }
      const radius = Math.max(step * 2, 0.001);
      low = Math.max(0.01, best.homeLambda - radius);
      high = Math.min(totalLambda - 0.01, best.homeLambda + radius);
    }
    return best && Object.freeze({
      homeXg: rounded(best.homeLambda, 3),
      awayXg: rounded(best.awayLambda, 3),
      homeCleanSheet: rounded(Math.exp(-best.awayLambda), 4),
      awayCleanSheet: rounded(Math.exp(-best.homeLambda), 4),
    });
  }

  function normalizeReference(reference) {
    if (!reference || typeof reference !== "object") return null;
    const fields = [
      "points",
      "pointsPerGame",
      "minutes",
      "starts",
      "cleanSheets",
      "xg",
      "xg90",
      "xgc",
      "xgc90",
      "selectedBy",
      "transfersInEvent",
      "transfersOutEvent",
    ];
    const result = {};
    for (const field of fields) {
      const value = finite(reference[field]);
      result[field] = value == null ? null : value;
    }
    result.id = reference.id == null ? null : Number(reference.id);
    result.updatedAt = typeof reference.updatedAt === "string" ? reference.updatedAt : null;
    return result;
  }

  function actualSummary(player, actualsByGW) {
    let points = 0;
    let minutes = 0;
    let matches = 0;
    let records = 0;
    let knownMinutes = 0;
    for (const bucket of Object.values(actualsByGW || {})) {
      const actual = bucket?.players?.[player.id];
      if (
        !actual
        || actual.points == null
        || actual.points === ""
        || !Number.isFinite(Number(actual.points))
      ) continue;
      records += 1;
      points += Number(actual.points);
      if (
        actual.minutes != null
        && actual.minutes !== ""
        && Number.isFinite(Number(actual.minutes))
      ) {
        knownMinutes += 1;
        minutes += Number(actual.minutes);
      }
      if (actual.played !== false) matches += 1;
    }
    if (!records) return null;
    return {
      source: "FanTeam",
      points: rounded(points, 2),
      pointsPerGame: matches ? rounded(points / matches, 2) : null,
      minutes: knownMinutes ? Math.round(minutes) : null,
      matches,
    };
  }

  function referenceSummary(player) {
    const reference = normalizeReference(player?.reference);
    if (!reference) return null;
    const hasData = [
      reference.points,
      reference.pointsPerGame,
      reference.minutes,
      reference.starts,
    ].some((value) => value != null);
    if (!hasData) return null;
    return {
      source: "FPL",
      points: reference.points,
      pointsPerGame: reference.pointsPerGame,
      minutes: reference.minutes,
      matches: reference.starts,
    };
  }

  function priceMovementFor(player, snapshots, validPrice) {
    const history = Array.isArray(snapshots) ? snapshots : [];
    const snapshot = history
      .slice()
      .reverse()
      .find((entry) => (
        Array.isArray(entry?.changes?.[player.id])
        && entry.changes[player.id].length === 2
      ));
    const base = Number(player.basePrice);
    const baselinePrice = validPrice(base) ? base : Number(player.price);
    const baseline = rounded(Number(player.price) - baselinePrice, 1) ?? 0;
    if (!snapshot) {
      return { latest: null, baseline, previous: null, observed: null, at: null };
    }
    const previous = Number(snapshot.changes[player.id][0]);
    const observed = Number(snapshot.changes[player.id][1]);
    return {
      latest: rounded(observed - previous, 1),
      baseline,
      previous,
      observed,
      at: snapshot.at,
    };
  }

  function priceMovementSummary(players, snapshots, validPrice) {
    const history = Array.isArray(snapshots) ? snapshots : [];
    const movements = players
      .map((player) => ({
        p: player,
        ...priceMovementFor(player, history, validPrice),
      }))
      .filter((movement) => movement.latest != null && Math.abs(movement.latest) > 0.001);
    const risers = movements
      .filter((movement) => movement.latest > 0)
      .sort((first, second) => (
        second.latest - first.latest
        || second.baseline - first.baseline
        || first.p.name.localeCompare(second.p.name)
      ));
    const fallers = movements
      .filter((movement) => movement.latest < 0)
      .sort((first, second) => (
        first.latest - second.latest
        || first.baseline - second.baseline
        || first.p.name.localeCompare(second.p.name)
      ));
    return {
      snapshots: history,
      latest: history[history.length - 1] || null,
      movements,
      risers,
      fallers,
    };
  }

  function create(options) {
    const {
      projection,
      horizon,
      horizon6,
      availability,
      fixture,
      validPrice,
      maxGameweek = MAX_GAMEWEEK,
    } = options || {};
    for (const [name, dependency] of Object.entries({
      projection,
      horizon,
      horizon6,
      availability,
      fixture,
      validPrice,
    })) {
      if (typeof dependency !== "function") throw new Error(`${name} es obligatorio`);
    }

    function schedule(player, gameweek, count = 3) {
      const rows = [];
      const end = Math.min(maxGameweek, gameweek + Math.max(0, count - 1));
      for (let gw = gameweek; gw <= end; gw += 1) {
        const scheduled = fixture(player, gw);
        if (!scheduled) continue;
        rows.push(Object.freeze({
          gw,
          home: Boolean(scheduled.home),
          opp: scheduled.opp,
          oppName: scheduled.oppName || scheduled.opp,
          diff: scheduled.diff || null,
          date: scheduled.date || null,
        }));
      }
      return Object.freeze(rows);
    }

    function cleanSheetChance(player, gameweek, odds) {
      const scheduled = fixture(player, gameweek);
      if (!scheduled || !Array.isArray(odds)) return null;
      const exact = odds.find((match) => (
        match.gw === gameweek
        && (
          (scheduled.home && match.home === player.club && match.away === scheduled.opp)
          || (!scheduled.home && match.away === player.club && match.home === scheduled.opp)
        )
      ));
      const model = marketGoalModel(exact);
      if (!model) return null;
      return player.club === exact.home ? model.homeCleanSheet : model.awayCleanSheet;
    }

    function metrics(players, input) {
      if (!Array.isArray(players)) throw new Error("players debe ser una lista");
      const gameweek = Math.max(
        1,
        Math.min(maxGameweek, Math.round(Number(input?.gameweek) || 1)),
      );
      const actualsByGW = input?.actualsByGW || {};
      const odds = Array.isArray(input?.odds) ? input.odds : [];
      const map = new Map();
      const byPosition = Object.fromEntries(POSITIONS.map((position) => [position, []]));
      for (const player of players) {
        const pgw = projection(player, gameweek);
        const h3 = horizon(player, gameweek);
        const h6 = horizon6(player, gameweek);
        const value = player.price > 0 ? h3 / player.price : 0;
        const reference = normalizeReference(player.reference);
        const performance = actualSummary(player, actualsByGW) || referenceSummary(player);
        const points = performance?.points ?? null;
        const starts = reference?.starts ?? null;
        const cleanSheets = reference?.cleanSheets ?? null;
        const netTransfers = reference?.transfersInEvent != null
          && reference?.transfersOutEvent != null
          ? reference.transfersInEvent - reference.transfersOutEvent
          : null;
        const selectedBy = reference?.selectedBy ?? null;
        map.set(player.id, {
          pgw,
          h3,
          h6,
          val: value,
          rank: 0,
          tag: null,
          schedule: schedule(player, gameweek),
          performanceSource: performance?.source || null,
          points,
          pointsPerGame: performance?.pointsPerGame ?? null,
          pointsPerMillion: points != null && player.price > 0
            ? points / player.price
            : null,
          historicalMinutes: performance?.minutes ?? null,
          matches: performance?.matches ?? null,
          xg: reference?.xg ?? null,
          xg90: reference?.xg90 ?? null,
          xgc90: reference?.xgc90 ?? null,
          cleanSheets,
          cleanSheetRate: starts > 0 && cleanSheets != null ? cleanSheets / starts : null,
          cleanSheetNext: cleanSheetChance(player, gameweek, odds),
          selectedBy,
          differentialScore: null,
          isDifferential: false,
          netTransfers,
        });
        if (byPosition[player.pos]) byPosition[player.pos].push(player);
      }

      for (const position of POSITIONS) {
        const ranked = byPosition[position]
          .slice()
          .sort((first, second) => map.get(second.id).h3 - map.get(first.id).h3);
        ranked.forEach((player, index) => {
          map.get(player.id).rank = index + 1;
        });
        const values = ranked
          .map((player) => map.get(player.id).val)
          .filter((value) => value > 0)
          .sort((first, second) => first - second);
        const medianValue = values.length ? values[Math.floor(values.length / 2)] : 0;
        const topValue = values.length ? values[Math.floor(values.length * 0.9)] : 0;
        const horizons = ranked
          .map((player) => map.get(player.id).h3)
          .sort((first, second) => first - second);
        const medianHorizon = horizons.length
          ? horizons[Math.floor(horizons.length / 2)]
          : 0;
        for (const player of ranked) {
          const metric = map.get(player.id);
          metric.isDifferential = metric.selectedBy != null
            && metric.selectedBy <= 15
            && metric.h3 >= medianHorizon
            && player.confidence >= 45;
          metric.differentialScore = metric.isDifferential
            ? metric.h3 * (1 + (15 - metric.selectedBy) / 100)
            : null;
          let tag = { t: "—", c: "tagNeutral" };
          if (availability(player) < 1 || metric.h3 <= 0.4) {
            tag = { t: "EVITAR", c: "tagEvitar" };
          } else if (metric.isDifferential) {
            tag = { t: "DIFERENCIAL", c: "tagDifferential" };
          } else if (metric.rank <= 6 && player.price >= 8.5) {
            tag = {
              t: metric.val >= topValue ? "PREMIUM+VALOR" : "PREMIUM",
              c: "tagPremium",
            };
          } else if (
            metric.val >= topValue
            && metric.h3 >= medianHorizon
            && player.confidence >= 45
          ) {
            tag = { t: "GEMA", c: "tagGema" };
          } else if (player.price >= 8 && metric.val < medianValue) {
            tag = { t: "TRAMPA", c: "tagTrampa" };
          }
          metric.tag = tag;
        }
      }
      return map;
    }

    function tracker(players, snapshots) {
      const prices = priceMovementSummary(players, snapshots, validPrice);
      const transfers = players
        .map((player) => {
          const reference = normalizeReference(player.reference);
          if (
            !reference
            || reference.transfersInEvent == null
            || reference.transfersOutEvent == null
          ) return null;
          return {
            p: player,
            net: reference.transfersInEvent - reference.transfersOutEvent,
            selectedBy: reference.selectedBy,
          };
        })
        .filter(Boolean);
      return {
        prices,
        transferRisers: transfers
          .filter((entry) => entry.net > 0)
          .sort((first, second) => second.net - first.net || first.p.name.localeCompare(second.p.name)),
        transferFallers: transfers
          .filter((entry) => entry.net < 0)
          .sort((first, second) => first.net - second.net || first.p.name.localeCompare(second.p.name)),
      };
    }

    return Object.freeze({
      cleanSheetChance,
      metrics,
      priceMovementFor: (player, snapshots) => priceMovementFor(player, snapshots, validPrice),
      priceMovementSummary: (players, snapshots) => (
        priceMovementSummary(players, snapshots, validPrice)
      ),
      schedule,
      tracker,
    });
  }

  global.FanTeamMarket = Object.freeze({
    VERSION,
    MAX_GAMEWEEK,
    create,
    marketGoalModel,
  });
})(globalThis);
