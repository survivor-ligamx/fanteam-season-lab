(function attachFanTeamHistory(global) {
  "use strict";

  const VERSION = "fanteam-history-v1";
  const TRANSFER_WEIGHTS = Object.freeze([1, 0.65, 0.35]);

  function actualFor(actualsByGW, gameweek, playerId) {
    return actualsByGW?.[gameweek]?.players?.[playerId] || null;
  }

  function applyActualUpdates(input) {
    const {
      actualsByGW,
      updates,
      importedAt,
      source = "",
    } = input || {};
    if (!Array.isArray(updates)) throw new Error("updates debe ser una lista");

    const nextActuals = actualsByGW && typeof actualsByGW === "object"
      ? { ...actualsByGW }
      : {};
    const gws = new Set();
    const normalizedSource = String(source || "importación local").slice(0, 120);
    let changed = 0;
    let removed = 0;

    for (const update of updates) {
      const gameweek = update?.gw;
      const playerId = update?.p?.id ?? update?.playerId;
      const entry = update?.entry;
      if (!Number.isFinite(Number(gameweek)) || playerId == null) {
        throw new Error("actualización de puntos inválida");
      }

      const bucket = nextActuals[gameweek];
      if (entry == null) {
        if (bucket?.players && Object.prototype.hasOwnProperty.call(bucket.players, playerId)) {
          const players = { ...bucket.players };
          delete players[playerId];
          changed += 1;
          removed += 1;
          if (Object.keys(players).length) nextActuals[gameweek] = { ...bucket, players };
          else delete nextActuals[gameweek];
        }
      } else {
        const players = { ...(bucket?.players || {}) };
        if (JSON.stringify(players[playerId]) !== JSON.stringify(entry)) changed += 1;
        players[playerId] = entry;
        nextActuals[gameweek] = {
          ...(bucket || {}),
          importedAt,
          source: normalizedSource,
          players,
        };
      }
      gws.add(Number(gameweek));
    }

    return {
      actualsByGW: nextActuals,
      changed,
      removed,
      gws: Array.from(gws).sort((first, second) => first - second),
    };
  }

  function evaluateHistoryEntry(historyEntry, actualsByGW) {
    const forecasts = historyEntry.forecastByPlayer || {};
    const actuals = actualsByGW?.[historyEntry.gw]?.players || {};
    const errors = [];
    for (const [playerId, actual] of Object.entries(actuals)) {
      const forecast = Number(forecasts[playerId]);
      if (Number.isFinite(forecast)) errors.push(actual.points - forecast);
    }

    const mae = errors.length
      ? errors.reduce((sum, error) => sum + Math.abs(error), 0) / errors.length
      : null;
    const bias = errors.length
      ? errors.reduce((sum, error) => sum + error, 0) / errors.length
      : null;
    const rmse = errors.length
      ? Math.sqrt(errors.reduce((sum, error) => sum + error * error, 0) / errors.length)
      : null;

    const xi = Array.isArray(historyEntry.xiIds) ? historyEntry.xiIds : [];
    const xiReady = xi.length === 11
      && xi.every((playerId) => actualFor(actualsByGW, historyEntry.gw, playerId));
    let effectiveCaptainId = historyEntry.captainId;
    const captain = actualFor(actualsByGW, historyEntry.gw, historyEntry.captainId);
    let effectiveCaptain = captain;
    if (captain && captain.played === false) {
      const vice = actualFor(actualsByGW, historyEntry.gw, historyEntry.viceId);
      effectiveCaptain = vice && vice.played === true ? vice : null;
      effectiveCaptainId = effectiveCaptain ? historyEntry.viceId : null;
    }

    const captainReady = xiReady && Boolean(captain);
    let actualTotal = null;
    let captainHit = null;
    let captainRegret = null;
    if (captainReady) {
      const xiPoints = xi.reduce(
        (sum, playerId) => sum + actualFor(actualsByGW, historyEntry.gw, playerId).points,
        0,
      );
      const best = Math.max(
        ...xi.map((playerId) => actualFor(actualsByGW, historyEntry.gw, playerId).points),
      );
      const bonus = effectiveCaptain ? effectiveCaptain.points : 0;
      actualTotal = xiPoints + bonus;
      captainRegret = best - bonus;
      captainHit = Boolean(effectiveCaptain) && captainRegret <= 1e-9;
    }

    let transferNet = null;
    let transferObservedNet = null;
    let transferObserved = 0;
    let transferPossible = 0;
    if (Array.isArray(historyEntry.transfers) && historyEntry.transfers.length) {
      let net = 0;
      for (const transfer of historyEntry.transfers) {
        for (let offset = 0; offset < TRANSFER_WEIGHTS.length && historyEntry.gw + offset <= 38; offset += 1) {
          transferPossible += 1;
          const incoming = actualFor(actualsByGW, historyEntry.gw + offset, transfer.inId);
          const outgoing = actualFor(actualsByGW, historyEntry.gw + offset, transfer.outId);
          if (incoming && outgoing) {
            net += TRANSFER_WEIGHTS[offset] * (incoming.points - outgoing.points);
            transferObserved += 1;
          }
        }
      }
      if (transferObserved) transferObservedNet = net;
      if (transferObserved === transferPossible) transferNet = net;
    }

    return {
      h: historyEntry,
      comparisons: errors.length,
      mae,
      bias,
      rmse,
      actualTotal,
      captainHit,
      captainRegret,
      effectiveCaptainId,
      transferNet,
      transferObservedNet,
      transferObserved,
      transferPossible,
    };
  }

  function modelAccuracySummary(input) {
    const history = Array.isArray(input?.history) ? input.history : [];
    const actualsByGW = input?.actualsByGW || {};
    const evaluations = history
      .filter((entry) => Object.keys(entry.forecastByPlayer || {}).length)
      .map((entry) => evaluateHistoryEntry(entry, actualsByGW));
    const errors = [];
    for (const evaluation of evaluations) {
      const actuals = actualsByGW?.[evaluation.h.gw]?.players || {};
      for (const [playerId, actual] of Object.entries(actuals)) {
        const forecast = Number(evaluation.h.forecastByPlayer[playerId]);
        if (Number.isFinite(forecast)) errors.push(actual.points - forecast);
      }
    }

    const captains = evaluations.filter((evaluation) => evaluation.captainHit != null);
    const transfers = evaluations.filter((evaluation) => evaluation.transferNet != null);
    return {
      evaluations,
      gwWithData: evaluations.filter((evaluation) => evaluation.comparisons > 0).length,
      mae: errors.length
        ? errors.reduce((sum, error) => sum + Math.abs(error), 0) / errors.length
        : null,
      rmse: errors.length
        ? Math.sqrt(errors.reduce((sum, error) => sum + error * error, 0) / errors.length)
        : null,
      bias: errors.length
        ? errors.reduce((sum, error) => sum + error, 0) / errors.length
        : null,
      captainCount: captains.length,
      captainHits: captains.filter((evaluation) => evaluation.captainHit).length,
      transferCount: transfers.length,
      transferNet: transfers.length
        ? transfers.reduce((sum, evaluation) => sum + evaluation.transferNet, 0)
        : null,
    };
  }

  global.FanTeamHistory = Object.freeze({
    VERSION,
    TRANSFER_WEIGHTS,
    actualFor,
    applyActualUpdates,
    evaluateHistoryEntry,
    modelAccuracySummary,
  });
})(globalThis);
