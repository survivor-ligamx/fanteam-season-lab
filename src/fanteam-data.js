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

    const matchesPlayerName = (player, normalizedName) => (
      [player.name, ...(player.aliases || [])]
        .some((name) => normalizeName(name) === normalizedName)
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

    function prepareReference(raw) {
      if (!raw || typeof raw !== "object") return null;
      const limits = {
        points: [-100, 2000],
        pointsPerGame: [-20, 100],
        minutes: [0, 10000],
        starts: [0, 100],
        cleanSheets: [0, 100],
        xg: [0, 200],
        xg90: [0, 20],
        xgc: [0, 300],
        xgc90: [0, 20],
        selectedBy: [0, 100],
        transfersInEvent: [0, 100000000],
        transfersOutEvent: [0, 100000000],
      };
      const reference = {};
      for (const [field, [minimum, maximum]] of Object.entries(limits)) {
        if (raw[field] == null || raw[field] === "") continue;
        const number = Number(raw[field]);
        if (Number.isFinite(number)) {
          reference[field] = Math.max(minimum, Math.min(maximum, number));
        }
      }
      const id = Number(raw.id);
      if (Number.isSafeInteger(id) && id > 0) reference.id = id;
      if (typeof raw.updatedAt === "string" && raw.updatedAt.trim()) {
        reference.updatedAt = raw.updatedAt.trim().slice(0, 40);
      }
      return Object.keys(reference).length ? reference : null;
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
                && matchesPlayerName(candidate, normalizedName),
            );
            if (exact.length === 1) player = exact[0];
          }
          if (!player) {
            const globalMatches = catalog.filter(
              (candidate) => matchesPlayerName(candidate, normalizedName),
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
        const reference = prepareReference(raw.reference);
        if (reference) update.reference = reference;
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

    function fixtureCanSetDeadline(statusValue) {
      const raw = statusValue && typeof statusValue === "object"
        ? statusValue.short || statusValue.long || ""
        : statusValue || "";
      const status = String(raw).trim().toUpperCase().replace(/[^A-Z]/g, "");
      return ![
        "CANCELLED",
        "CANCELED",
        "CANC",
        "SUSPENDED",
        "SUSP",
        "ABANDONED",
        "ABD",
        "POSTPONED",
        "PST",
      ].includes(status);
    }

    function prepareResults(results, liveFixtures) {
      const live = {};
      const deadlines = {};
      const combined = [].concat(
        Array.isArray(results) ? results : [],
        Array.isArray(liveFixtures) ? liveFixtures : [],
      );
      const keyed = new Map();
      const unkeyed = [];
      const explicitGameweek = (raw) => {
        const gameweek = Number(raw?.gameweek ?? raw?.gw);
        return Number.isInteger(gameweek) && gameweek >= 1 && gameweek <= MAX_GAMEWEEK
          ? gameweek
          : null;
      };
      for (const raw of combined) {
        if (!raw || typeof raw !== "object") continue;
        const homeClub = resolveClubCode(raw.home);
        const awayClub = resolveClubCode(raw.away);
        if (!homeClub || !awayClub) continue;
        const fixtureId = raw.id ?? raw.fixture?.id ?? raw.match?.id;
        const kickoff = raw.kickoff || raw.utcDate || raw.date || null;
        const kickoffTime = new Date(kickoff || "").getTime();
        const key = Number.isFinite(kickoffTime)
          ? `pair:${homeClub}:${awayClub}:${kickoffTime}`
          : fixtureId != null && String(fixtureId).trim()
            ? `id:${String(fixtureId).trim()}`
            : null;
        if (!key) {
          unkeyed.push({ raw, homeClub, awayClub });
          continue;
        }
        const previous = keyed.get(key);
        if (!previous) {
          keyed.set(key, { raw, homeClub, awayClub });
          continue;
        }
        const previousGameweek = explicitGameweek(previous.raw);
        const incomingGameweek = explicitGameweek(raw);
        const merged = { ...previous.raw, ...raw };
        if (previousGameweek && !incomingGameweek) merged.gameweek = previousGameweek;
        keyed.set(key, { raw: merged, homeClub, awayClub });
      }
      const records = [...keyed.values(), ...unkeyed];
      const kickoffs = {};
      for (const { raw, homeClub, awayClub } of records) {
        const providedGameweek = explicitGameweek(raw);
        const gameweek = Number.isInteger(providedGameweek)
          && providedGameweek >= 1
          && providedGameweek <= MAX_GAMEWEEK
          ? providedGameweek
          : pairToGameweek(homeClub, awayClub);
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
        if (kickoff && fixtureCanSetDeadline(status)) {
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
        // FanTeam closes roughly 90 minutes before the first kickoff.
        deadlines[gameweek] = new Date(kickoffs[gameweek] - 90 * 60000).toISOString();
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

    function prepareFutbolFantasy(raw) {
      const sourceUrl = "https://www.futbolfantasy.com/premier-league/home";
      const empty = {
        mode: "informational",
        enabled: false,
        available: false,
        observedAt: null,
        stale: false,
        sourceUrl,
        news: [],
        injuries: [],
        suspensions: [],
        probableLineups: [],
        error: null,
      };
      if (!raw || typeof raw !== "object") return empty;

      const text = (value, maximum) => (
        typeof value === "string"
          ? value.replace(/\s+/g, " ").trim().slice(0, maximum)
          : ""
      );
      const url = (value, fallback = null) => {
        try {
          const parsed = new URL(value);
          const trusted = parsed.hostname === "futbolfantasy.com"
            || parsed.hostname.endsWith(".futbolfantasy.com");
          return parsed.protocol === "https:" && trusted
            ? parsed.href.slice(0, 500)
            : fallback;
        } catch {
          return fallback;
        }
      };
      const date = (value) => {
        const result = text(value, 40);
        return result && Number.isFinite(new Date(result).getTime()) ? result : null;
      };
      const list = (value, maximum, prepare) => (
        Array.isArray(value)
          ? value.slice(0, maximum).map(prepare).filter(Boolean)
          : []
      );
      const clubs = (value) => list(value, 4, (club) => text(club, 48) || null);
      const availability = (value) => list(value, 80, (item) => {
        if (!item || typeof item !== "object") return null;
        const player = text(item.player, 80);
        const club = text(item.club, 48);
        if (!player || !club) return null;
        return {
          club,
          player,
          issue: text(item.issue, 120),
          status: text(item.status, 120),
          since: text(item.since, 80),
          sourceUrl: url(item.sourceUrl, url(raw.sourceUrl, sourceUrl)),
        };
      });

      return {
        mode: "informational",
        enabled: raw.enabled === true,
        available: raw.available === true,
        observedAt: date(raw.observedAt),
        stale: raw.stale === true,
        sourceUrl: url(raw.sourceUrl, sourceUrl),
        news: list(raw.news, 20, (item) => {
          if (!item || typeof item !== "object") return null;
          const summary = text(item.summary, 220);
          const source = url(item.sourceUrl);
          if (!summary || !source) return null;
          return {
            summary,
            category: text(item.category, 40) || "Actualidad",
            clubs: clubs(item.clubs),
            publishedAt: date(item.publishedAt),
            publishedLabel: text(item.publishedLabel, 60),
            sourceUrl: source,
          };
        }),
        injuries: availability(raw.injuries),
        suspensions: availability(raw.suspensions),
        probableLineups: list(raw.probableLineups, 30, (item) => {
          if (!item || typeof item !== "object") return null;
          const club = text(item.club, 48);
          const source = url(item.sourceUrl);
          if (!club || !source) return null;
          return {
            club,
            gameweek: text(item.gameweek, 32),
            players: list(item.players, 15, (player) => text(player, 80) || null),
            sourceUrl: source,
          };
        }),
        error: text(raw.error, 180) || null,
      };
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
        futbolFantasy: prepareFutbolFantasy(source.futbolFantasy),
        sources: source.sources || null,
        sourceMeta: source.sourceMeta || null,
        errors: source.errors || null,
        updatedAt: source.updatedAt || null,
        freshUntil: source.freshUntil || null,
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
