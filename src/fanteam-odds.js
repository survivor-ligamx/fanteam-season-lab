(function attachFanTeamOdds(global) {
  "use strict";

  const VERSION = "fanteam-odds-v1";
  const DEFAULT_MAX_AGE_MS = 6 * 3600000;
  const DEFAULT_FUTURE_TOLERANCE_MS = 5 * 60000;
  const DEFAULT_MAX_GAMEWEEK = 38;

  function create(options) {
    const {
      resolveClubCode,
      pairToGameweek,
      maxAgeMs = DEFAULT_MAX_AGE_MS,
      futureToleranceMs = DEFAULT_FUTURE_TOLERANCE_MS,
      maxGameweek = DEFAULT_MAX_GAMEWEEK,
    } = options || {};
    if (
      typeof resolveClubCode !== "function"
      || typeof pairToGameweek !== "function"
      || !Number.isFinite(maxAgeMs)
      || maxAgeMs < 0
      || !Number.isFinite(futureToleranceMs)
      || futureToleranceMs < 0
      || !Number.isInteger(maxGameweek)
      || maxGameweek < 1
    ) {
      throw new TypeError("dependencias de momios inválidas");
    }

    function marketTime(market) {
      const time = new Date(market?.last_update || "").getTime();
      return Number.isFinite(time) ? time : null;
    }

    function isMarketFresh(market, now) {
      const time = marketTime(market);
      if (time == null || !Number.isFinite(now)) return false;
      const age = now - time;
      return age >= -futureToleranceMs && age <= maxAgeMs;
    }

    function hasFreshData(events, now) {
      return Array.isArray(events) && events.some((event) => (
        (event?.bookmakers || []).some((bookmaker) => (
          (bookmaker?.markets || []).some((market) => (
            market?.key === "h2h" && isMarketFresh(market, now)
          ))
        ))
      ));
    }

    function kickoffGameweek(value, gameweekDeadline) {
      const time = new Date(value || "").getTime();
      if (!Number.isFinite(time) || typeof gameweekDeadline !== "function") return null;
      for (let gameweek = 1; gameweek <= maxGameweek; gameweek += 1) {
        const start = gameweekDeadline(gameweek).getTime();
        const end = gameweek < maxGameweek
          ? gameweekDeadline(gameweek + 1).getTime()
          : Infinity;
        if (time >= start && time < end) return gameweek;
      }
      return null;
    }

    function normalize(events, settings) {
      const {
        now,
        gameweekDeadline,
      } = settings || {};
      if (!Array.isArray(events) || !Number.isFinite(now)) return [];
      const matches = [];
      for (const event of events) {
        if (!event || typeof event !== "object") continue;
        const home = resolveClubCode(event.home);
        const away = resolveClubCode(event.away);
        if (!home || !away) continue;
        const gameweek = kickoffGameweek(event.kickoff, gameweekDeadline)
          || pairToGameweek(home, away);
        if (!gameweek) continue;
        const homeWins = [];
        const awayWins = [];
        const overs = [];
        const bookmakers = new Set();
        const updates = [];
        for (const bookmaker of event.bookmakers || []) {
          const markets = Array.isArray(bookmaker.markets) ? bookmaker.markets : [];
          const h2h = markets.find((market) => (
            market.key === "h2h" && isMarketFresh(market, now)
          ));
          if (h2h && Array.isArray(h2h.outcomes)) {
            const priced = h2h.outcomes.filter((outcome) => Number(outcome.price) > 1);
            const total = priced.reduce(
              (sum, outcome) => sum + 1 / Number(outcome.price),
              0,
            );
            const homePrice = priced.find(
              (outcome) => resolveClubCode(outcome.name) === home,
            );
            const awayPrice = priced.find(
              (outcome) => resolveClubCode(outcome.name) === away,
            );
            if (total && homePrice && awayPrice) {
              homeWins.push((1 / Number(homePrice.price)) / total);
              awayWins.push((1 / Number(awayPrice.price)) / total);
              bookmakers.add(bookmaker.name || "Bookmaker");
              updates.push(marketTime(h2h));
            }
          }
          const totals = markets.find((market) => (
            market.key === "totals" && isMarketFresh(market, now)
          ));
          if (totals && Array.isArray(totals.outcomes)) {
            const over = totals.outcomes.find((outcome) => (
              String(outcome.name).toLowerCase() === "over"
              && Math.abs(Number(outcome.point) - 2.5) < .01
            ));
            const under = totals.outcomes.find((outcome) => (
              String(outcome.name).toLowerCase() === "under"
              && Math.abs(Number(outcome.point) - 2.5) < .01
            ));
            if (
              over
              && under
              && Number(over.price) > 1
              && Number(under.price) > 1
            ) {
              const overImplied = 1 / Number(over.price);
              const underImplied = 1 / Number(under.price);
              overs.push(overImplied / (overImplied + underImplied));
              bookmakers.add(bookmaker.name || "Bookmaker");
              updates.push(marketTime(totals));
            }
          }
        }
        if (!homeWins.length) continue;
        const average = (values) => (
          values.reduce((sum, value) => sum + value, 0) / values.length
        );
        matches.push({
          id: event.id,
          gw: gameweek,
          home,
          away,
          kickoff: event.kickoff,
          homeWin: average(homeWins),
          awayWin: average(awayWins),
          over25: overs.length ? average(overs) : null,
          bookmakers: bookmakers.size,
          updatedAt: new Date(
            Math.min(...updates.filter(Number.isFinite)),
          ).toISOString(),
        });
      }
      return matches;
    }

    return Object.freeze({
      marketTime,
      isMarketFresh,
      hasFreshData,
      kickoffGameweek,
      normalize,
    });
  }

  global.FanTeamOdds = Object.freeze({
    VERSION,
    DEFAULT_MAX_AGE_MS,
    DEFAULT_FUTURE_TOLERANCE_MS,
    DEFAULT_MAX_GAMEWEEK,
    create,
  });
})(globalThis);
