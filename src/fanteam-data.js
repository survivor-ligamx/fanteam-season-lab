(function attachFanTeamData(global) {
  "use strict";

  const VERSION = "fanteam-data-v1";
  const MAX_GAMEWEEK = 38;

  function create(options) {
    const {
      players,
      fixtures,
      clubAliases,
      fallbackDeadlines,
      normalizeName,
    } = options || {};
    if (
      !Array.isArray(players)
      || !fixtures
      || typeof fixtures !== "object"
      || !clubAliases
      || typeof clubAliases !== "object"
      || !Array.isArray(fallbackDeadlines)
      || typeof normalizeName !== "function"
    ) {
      throw new TypeError("dependencias de datos inválidas");
    }

    const catalog = players.slice();
    const aliases = Object.fromEntries(
      Object.entries(clubAliases).map(([code, values]) => [
        code,
        Array.isArray(values) ? values.slice() : [],
      ]),
    );

    function resolveClubCode(value) {
      if (value == null) return null;
      const raw = String(
        typeof value === "object"
          ? value.name || value.club || value.code || ""
          : value,
      ).trim();
      if (!raw) return null;
      const upper = raw.toUpperCase();
      if (aliases[upper]) return upper;
      const normalized = normalizeName(raw).replace(/(afc|fc)$/, "");
      if (!normalized) return null;
      for (const [code, values] of Object.entries(aliases)) {
        if (values.includes(normalized)) return code;
      }
      const matches = Object.entries(aliases)
        .filter(([, values]) => values.some(
          (alias) => normalized.includes(alias) || alias.includes(normalized),
        ))
        .map(([code]) => code);
      return matches.length === 1 ? matches[0] : null;
    }

    function preparePlayerUpdates(list) {
      const result = { applied: 0, skipped: 0, updates: [] };
      if (!Array.isArray(list)) return result;
      for (const raw of list) {
        if (!raw || typeof raw !== "object") {
          result.skipped += 1;
          continue;
        }
        let player = null;
        if (raw.id != null) {
          player = catalog.find((candidate) => candidate.id === raw.id) || null;
        }
        const normalizedName = raw.name ? normalizeName(raw.name) : "";
        const club = raw.club != null ? resolveClubCode(raw.club) : null;
        if (!player && normalizedName) {
          if (club) {
            const exact = catalog.filter(
              (candidate) => candidate.club === club
                && normalizeName(candidate.name) === normalizedName,
            );
            if (exact.length === 1) player = exact[0];
          }
          if (!player) {
            const globalMatches = catalog.filter(
              (candidate) => normalizeName(candidate.name) === normalizedName,
            );
            if (
              globalMatches.length === 1
              && (!club || globalMatches[0].club === club)
            ) {
              player = globalMatches[0];
            }
          }
          if (!player && club) {
            const surnameMatches = catalog.filter((candidate) => {
              const surname = candidate.surname
                ? normalizeName(candidate.surname)
                : "";
              return candidate.club === club
                && surname.length > 2
                && normalizedName.endsWith(surname);
            });
            if (surnameMatches.length === 1) player = surnameMatches[0];
          }
        }
        if (!player) {
          result.skipped += 1;
          continue;
        }
        const update = { id: player.id };
        if (typeof raw.confidence === "number" && Number.isFinite(raw.confidence)) {
          update.confidence = Math.max(0, Math.min(100, Math.round(raw.confidence)));
        }
        if (typeof raw.minutes === "number" && Number.isFinite(raw.minutes)) {
          update.minutes = Math.max(0, Math.min(120, Math.round(raw.minutes)));
        }
        if (typeof raw.status === "string" && raw.status.trim()) {
          update.status = raw.status.trim().slice(0, 64);
        }
        result.updates.push(update);
        result.applied += 1;
      }
      return result;
    }

    function pairToGameweek(homeClub, awayClub) {
      for (let gameweek = 1; gameweek <= MAX_GAMEWEEK; gameweek += 1) {
        const fixture = fixtures[String(gameweek)]?.[homeClub];
        if (fixture && fixture.home && fixture.opp === awayClub) return gameweek;
      }
      return null;
    }

    function prepareResults(results, liveFixtures) {
      const live = {};
      const deadlines = {};
      const combined = [].concat(
        Array.isArray(results) ? results : [],
        Array.isArray(liveFixtures) ? liveFixtures : [],
      );
      const kickoffs = {};
      for (const raw of combined) {
        if (!raw || typeof raw !== "object") continue;
        const homeClub = resolveClubCode(raw.home);
        const awayClub = resolveClubCode(raw.away);
        if (!homeClub || !awayClub) continue;
        const gameweek = pairToGameweek(homeClub, awayClub);
        if (!gameweek) continue;
        const status = raw.status && typeof raw.status === "object"
          ? raw.status.short || raw.status.long || ""
          : raw.status || "";
        const kickoff = raw.kickoff || raw.utcDate || raw.date || null;
        const homeGoals = raw.homeGoals != null
          ? raw.homeGoals
          : raw.goals && raw.goals.home != null
            ? raw.goals.home
            : null;
        const awayGoals = raw.awayGoals != null
          ? raw.awayGoals
          : raw.goals && raw.goals.away != null
            ? raw.goals.away
            : null;
        (live[gameweek] = live[gameweek] || {})[homeClub] = {
          kickoff,
          status,
          hg: homeGoals,
          ag: awayGoals,
        };
        if (kickoff) {
          const time = new Date(kickoff).getTime();
          if (
            Number.isFinite(time)
            && (!kickoffs[gameweek] || time < kickoffs[gameweek])
          ) {
            kickoffs[gameweek] = time;
          }
        }
      }
      for (const gameweek of Object.keys(kickoffs)) {
        deadlines[gameweek] = new Date(kickoffs[gameweek]).toISOString();
      }
      return {
        live,
        deadlines,
        count: Object.keys(live).length,
      };
    }

    function gameweekDeadline(gameweek, deadlines) {
      const derived = deadlines && deadlines[gameweek];
      return derived
        ? new Date(derived)
        : new Date(fallbackDeadlines[gameweek - 1]);
    }

    function detectGameweek(now, deadlines) {
      for (let gameweek = 1; gameweek <= MAX_GAMEWEEK; gameweek += 1) {
        if (gameweekDeadline(gameweek, deadlines).getTime() > now) return gameweek;
      }
      return MAX_GAMEWEEK;
    }

    function preparePayload(payload, currentGameweek) {
      const source = payload && typeof payload === "object" ? payload : {};
      const playerUpdates = preparePlayerUpdates(source.players);
      const preparedResults = prepareResults(source.results, source.liveFixtures);
      let gameweek = currentGameweek;
      if (source.currentGW) {
        gameweek = Math.max(
          currentGameweek,
          Math.min(MAX_GAMEWEEK, Math.round(source.currentGW)),
        );
      }
      return {
        playerUpdates,
        results: preparedResults,
        odds: Array.isArray(source.odds) ? source.odds : [],
        oddsUpdatedAt: source.updatedAt || null,
        news: Array.isArray(source.news) ? source.news : [],
        sources: source.sources || null,
        errors: source.errors || null,
        updatedAt: source.updatedAt || null,
        gameweek,
      };
    }

    return Object.freeze({
      resolveClubCode,
      preparePlayerUpdates,
      prepareResults,
      gameweekDeadline,
      detectGameweek,
      preparePayload,
    });
  }

  global.FanTeamData = Object.freeze({
    VERSION,
    MAX_GAMEWEEK,
    create,
  });
})(globalThis);
