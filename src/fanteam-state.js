(function attachFanTeamState(global) {
  "use strict";

  const VERSION = "fanteam-state-v1";
  const MAX_GAMEWEEK = 38;
  const MAX_FREE_TRANSFERS = 37;
  const MAX_MARKET_SNAPSHOTS = 64;

  function create(options) {
    const {
      players,
      initialSquad,
      validPrice,
      normalizeStats,
      calculatePoints,
    } = options || {};
    if (!Array.isArray(players) || !Array.isArray(initialSquad)) {
      throw new Error("catálogo y plantilla inicial son obligatorios");
    }
    if (
      typeof validPrice !== "function"
      || typeof normalizeStats !== "function"
      || typeof calculatePoints !== "function"
    ) {
      throw new Error("dependencias de estado inválidas");
    }

    const catalog = players.slice();
    const initial = initialSquad.slice();
    const playerByNumericId = new Map(catalog.map((player) => [Number(player.id), player]));
    const basePrices = new Map(catalog.map((player) => [
      player.id,
      validPrice(player.basePrice) ? Number(player.basePrice) : Number(player.price),
    ]));
    const knownPlayer = (id) => playerByNumericId.has(Number(id));
    const exactPlayer = (id) => catalog.find((player) => player.id === id) || null;
    const validActualPoints = (value) => (
      typeof value === "number"
      && Number.isFinite(value)
      && value >= -20
      && value <= 100
    );
    const expectedPositions = initial.reduce((counts, id) => {
      const player = playerByNumericId.get(Number(id));
      if (player) counts[player.pos] = (counts[player.pos] || 0) + 1;
      return counts;
    }, {});

    function normalizeSquad(rawSquad) {
      if (!Array.isArray(rawSquad)) {
        return {
          ids: initial.slice(),
          recovered: rawSquad !== undefined,
          unknown: 0,
          reason: "estructura inválida",
        };
      }

      const ids = [];
      const seen = new Set();
      let unknown = 0;
      for (const rawId of rawSquad) {
        const player = playerByNumericId.get(Number(rawId));
        if (!player) {
          unknown += 1;
          continue;
        }
        if (seen.has(player.id)) continue;
        seen.add(player.id);
        ids.push(player.id);
      }

      const positionCounts = ids.reduce((counts, id) => {
        const position = playerByNumericId.get(Number(id))?.pos;
        if (position) counts[position] = (counts[position] || 0) + 1;
        return counts;
      }, {});
      const clubCounts = ids.reduce((counts, id) => {
        const club = playerByNumericId.get(Number(id))?.club;
        if (club) counts[club] = (counts[club] || 0) + 1;
        return counts;
      }, {});
      const validPositions = Object.entries(expectedPositions).every(
        ([position, count]) => positionCounts[position] === count,
      );
      const validClubs = Object.values(clubCounts).every((count) => count <= 3);
      const valid = ids.length === 15
        && seen.size === 15
        && validPositions
        && validClubs;

      return {
        ids: valid ? ids : initial.slice(),
        recovered: !valid,
        unknown,
        reason: unknown
          ? `${unknown} jugador${unknown === 1 ? "" : "es"} ya no existe${unknown === 1 ? "" : "n"} en el catálogo`
          : "la plantilla no cumplía la estructura de 15 jugadores",
      };
    }

    function createInitialState() {
      return {
        gw: 1,
        free: 1,
        squad: initial.slice(),
        history: [],
        decision: null,
        wc1: false,
        wc2: false,
      };
    }

    function normalize(input) {
      const source = input && typeof input === "object" ? input : {};
      const state = { ...source };
      const squad = normalizeSquad(source.squad);
      const warnings = squad.recovered
        ? [{
          code: "squad-recovered",
          message: `${squad.reason}; se restauró la plantilla base para mantener la temporada editable y se conservaron las referencias financieras originales para conciliación.`,
          unknownPlayers: squad.unknown,
        }]
        : [];
      state.squad = squad.ids;
      if (squad.recovered) {
        const originalPurchasePrices = {};
        for (const id of Array.isArray(source.squad) ? source.squad : []) {
          const price = Number(source.purchasePrices?.[id]);
          if (validPrice(price)) originalPurchasePrices[id] = price;
        }
        state.recovery = {
          code: "squad-recovered",
          originalSquad: Array.isArray(source.squad) ? source.squad.slice() : [],
          originalFinances: {
            bank: Number.isFinite(Number(source.bank)) ? Number(source.bank) : null,
            purchasePrices: originalPurchasePrices,
          },
          message: warnings[0].message,
        };
      }
      state.gw = Math.max(1, Math.min(MAX_GAMEWEEK, Math.round(source.gw || 1)));
      state.free = Math.max(
        0,
        Math.min(
          MAX_FREE_TRANSFERS,
          Math.round(source.free == null ? 1 : source.free),
        ),
      );

      state.history = Array.isArray(source.history)
        ? source.history
          .filter((entry) => entry && Number.isFinite(Number(entry.gw)))
          .map((entry) => {
            const ids = (values) => Array.isArray(values)
              ? values
                .map(Number)
                .filter((id) => Number.isSafeInteger(id) && id > 0)
              : [];
            const forecasts = {};
            for (const [id, raw] of Object.entries(
              entry.forecastByPlayer && typeof entry.forecastByPlayer === "object"
                ? entry.forecastByPlayer
                : {},
            )) {
              const value = Number(raw);
              if (Number.isSafeInteger(Number(id)) && Number(id) > 0 && Number.isFinite(value) && value >= 0 && value <= 100) {
                forecasts[id] = +value.toFixed(3);
              }
            }
            const transfers = Array.isArray(entry.transfers)
              ? entry.transfers
                .map((transfer) => ({
                  outId: Number(transfer.outId),
                  inId: Number(transfer.inId),
                  projectedGain: Number(transfer.projectedGain) || 0,
                }))
                .filter((transfer) => (
                  Number.isSafeInteger(transfer.outId)
                  && transfer.outId > 0
                  && Number.isSafeInteger(transfer.inId)
                  && transfer.inId > 0
                ))
              : [];
            return {
              ...entry,
              gw: Math.max(1, Math.min(MAX_GAMEWEEK, Math.round(Number(entry.gw)))),
              squadIds: ids(entry.squadIds),
              xiIds: ids(entry.xiIds),
              captainId: Number.isSafeInteger(Number(entry.captainId))
                && Number(entry.captainId) > 0 ? Number(entry.captainId) : null,
              viceId: Number.isSafeInteger(Number(entry.viceId))
                && Number(entry.viceId) > 0 ? Number(entry.viceId) : null,
              projectedTotal: entry.projectedTotal != null
                && Number.isFinite(Number(entry.projectedTotal))
                ? Number(entry.projectedTotal)
                : null,
              forecastByPlayer: forecasts,
              transfers,
            };
          })
          .slice(-MAX_GAMEWEEK)
        : [];

      state.wc1 = Boolean(source.wc1);
      state.wc2 = Boolean(source.wc2);

      const playerPrices = {};
      for (const player of catalog) {
        const basePrice = basePrices.get(player.id);
        playerPrices[player.id] = { basePrice, price: basePrice };
      }
      state.priceOverrides = source.priceOverrides
        && typeof source.priceOverrides === "object"
        ? Array.isArray(source.priceOverrides)
          ? source.priceOverrides.slice()
          : { ...source.priceOverrides }
        : {};
      for (const [id, raw] of Object.entries(state.priceOverrides)) {
        const player = catalog.find((candidate) => String(candidate.id) === String(id));
        const value = Number(raw);
        if (player && validPrice(value)) {
          playerPrices[player.id].price = Math.round(value * 10) / 10;
        } else {
          delete state.priceOverrides[id];
        }
      }

      state.purchasePrices = squad.recovered
        ? {}
        : source.purchasePrices && typeof source.purchasePrices === "object"
          ? Array.isArray(source.purchasePrices)
            ? source.purchasePrices.slice()
            : { ...source.purchasePrices }
          : {};
      for (const id of state.squad) {
        const player = exactPlayer(id);
        const value = Number(state.purchasePrices[id]);
        if (player && !validPrice(value)) {
          state.purchasePrices[id] = playerPrices[player.id].price;
        }
      }

      state.priceHistory = Array.isArray(source.priceHistory)
        ? source.priceHistory
          .filter((entry) => (
            entry
            && Number.isFinite(entry.gw)
            && Number.isFinite(entry.currentValue)
            && Number.isFinite(entry.purchaseCost)
            && Number.isFinite(entry.bank)
          ))
          .map((entry) => ({
            ...entry,
            gain: Number.isFinite(entry.gain)
              ? entry.gain
              : +(entry.currentValue - entry.purchaseCost).toFixed(1),
            buyingPower: Number.isFinite(entry.buyingPower)
              ? entry.buyingPower
              : +(entry.currentValue + entry.bank).toFixed(1),
          }))
          .slice(-MAX_GAMEWEEK)
        : [];

      const cleanMarketSnapshots = [];
      for (const raw of Array.isArray(source.marketPriceHistory) ? source.marketPriceHistory : []) {
        if (
          !raw
          || typeof raw !== "object"
          || !raw.changes
          || typeof raw.changes !== "object"
          || Array.isArray(raw.changes)
        ) continue;
        const time = new Date(raw.at || "").getTime();
        if (!Number.isFinite(time)) continue;
        const changes = {};
        for (const [rawId, pair] of Object.entries(raw.changes)) {
          const player = catalog.find((candidate) => String(candidate.id) === String(rawId));
          const before = Math.round(Number(pair?.[0]) * 10) / 10;
          const after = Math.round(Number(pair?.[1]) * 10) / 10;
          if (player && validPrice(before) && validPrice(after) && before !== after) {
            changes[player.id] = [before, after];
          }
        }
        const count = Object.keys(changes).length;
        if (!count) continue;
        cleanMarketSnapshots.push({
          seq: cleanMarketSnapshots.length + 1,
          at: new Date(time).toISOString(),
          gw: Math.max(
            1,
            Math.min(MAX_GAMEWEEK, Math.round(Number(raw.gw) || state.gw)),
          ),
          source: typeof raw.source === "string" ? raw.source.slice(0, 120) : "",
          coverage: Math.max(
            count,
            Math.min(catalog.length, Math.round(Number(raw.coverage) || count)),
          ),
          changes,
        });
      }
      state.marketPriceHistory = cleanMarketSnapshots
        .slice(-MAX_MARKET_SNAPSHOTS)
        .map((snapshot, index) => ({ ...snapshot, seq: index + 1 }));

      const squadValue = state.squad.reduce((sum, id) => {
        const player = exactPlayer(id);
        return sum + (player ? playerPrices[player.id].price : 0);
      }, 0);
      state.bank = squad.recovered
        ? Math.max(0, Math.round((100 - squadValue) * 10) / 10)
        : Number.isFinite(Number(source.bank))
          ? Math.max(0, Math.round(Number(source.bank) * 10) / 10)
          : Math.max(0, Math.round((100 - squadValue) * 10) / 10);
      state.priceUpdatedAt = typeof source.priceUpdatedAt === "string"
        ? source.priceUpdatedAt
        : null;
      state.seasonComplete = Boolean(source.seasonComplete)
        || (state.gw === MAX_GAMEWEEK && state.history.some((entry) => entry?.gw === MAX_GAMEWEEK));

      const cleanActuals = {};
      if (source.actualsByGW && typeof source.actualsByGW === "object") {
        for (const [rawGameweek, bucket] of Object.entries(source.actualsByGW)) {
          const gameweek = Math.round(Number(rawGameweek));
          if (
            gameweek < 1
            || gameweek > MAX_GAMEWEEK
            || !bucket
            || typeof bucket !== "object"
          ) continue;
          const actualPlayers = {};
          for (const [rawId, actual] of Object.entries(
            bucket.players && typeof bucket.players === "object" ? bucket.players : {},
          )) {
            const id = Number(rawId);
            const player = playerByNumericId.get(id);
            const points = Number(actual?.points);
            const minutes = actual?.minutes == null ? null : Number(actual.minutes);
            if (!validActualPoints(points)) continue;
            let normalized = {
              points: +points.toFixed(2),
              minutes: Number.isFinite(minutes)
                ? Math.max(0, Math.min(120, Math.round(minutes)))
                : null,
              played: typeof actual.played === "boolean"
                ? actual.played
                : Number.isFinite(minutes)
                  ? minutes > 0
                  : true,
            };
            if (actual.scoringVersion === "fanteam-v1" && player) {
              if (!actual.stats || typeof actual.stats !== "object" || Array.isArray(actual.stats)) {
                continue;
              }
              try {
                const stats = normalizeStats({ stats: actual.stats });
                const scored = calculatePoints(player, stats);
                if (!validActualPoints(scored.points)) throw new Error("scoring fuera de rango");
                normalized = {
                  points: scored.points,
                  minutes: stats.minutes,
                  played: stats.minutes > 0,
                  stats,
                  breakdown: scored.breakdown,
                  scoringVersion: scored.version,
                };
                const reported = Number(actual.reportedPoints);
                if (validActualPoints(reported)) {
                  normalized.reportedPoints = +reported.toFixed(2);
                }
              } catch (_) {
                continue;
              }
            }
            actualPlayers[id] = normalized;
          }
          if (Object.keys(actualPlayers).length) {
            cleanActuals[gameweek] = {
              importedAt: typeof bucket.importedAt === "string" ? bucket.importedAt : null,
              source: typeof bucket.source === "string" ? bucket.source.slice(0, 120) : "",
              players: actualPlayers,
            };
          }
        }
      }
      state.actualsByGW = cleanActuals;

      const decision = source.decision;
      if (decision?.type === "applied") {
        const count = decision.count === 2 ? 2 : 1;
        const outgoing = exactPlayer(decision.out?.id);
        const incoming = exactPlayer(decision.inn?.id);
        const outgoing2 = count === 2 ? exactPlayer(decision.out2?.id) : null;
        const incoming2 = count === 2 ? exactPlayer(decision.inn2?.id) : null;
        const valid = outgoing
          && incoming
          && state.squad.includes(incoming.id)
          && !state.squad.includes(outgoing.id)
          && (
            count === 1
            || (
              outgoing2
              && incoming2
              && state.squad.includes(incoming2.id)
              && !state.squad.includes(outgoing2.id)
            )
          );
        state.decision = valid
          ? {
            type: "applied",
            count,
            out: outgoing,
            inn: incoming,
            out2: outgoing2,
            inn2: incoming2,
            gain: Number(decision.gain) || 0,
            reason: typeof decision.reason === "string" ? decision.reason : "",
          }
          : null;
      } else if (decision?.type === "save") {
        state.decision = {
          type: "save",
          gain: 0,
          reason: typeof decision.reason === "string"
            ? decision.reason
            : "Decidiste acumular la transferencia gratuita.",
        };
      } else {
        state.decision = null;
      }

      return { state, playerPrices, warnings };
    }

    return Object.freeze({ createInitialState, normalize });
  }

  global.FanTeamState = Object.freeze({
    VERSION,
    MAX_GAMEWEEK,
    MAX_FREE_TRANSFERS,
    MAX_MARKET_SNAPSHOTS,
    create,
  });
})(globalThis);
