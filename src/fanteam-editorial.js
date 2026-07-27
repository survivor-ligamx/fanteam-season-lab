(function attachFanTeamEditorial(global) {
  "use strict";

  const VERSION = "fanteam-editorial-v1";
  const TYPES = Object.freeze({
    probable: Object.freeze({ factor: 1.04, label: "Alineación probable" }),
    editorialInjury: Object.freeze({ factor: 0.72, label: "Lesión editorial" }),
    editorialSuspension: Object.freeze({ factor: 0.6, label: "Sanción editorial" }),
  });

  function validDate(value) {
    const time = new Date(value || "").getTime();
    return Number.isFinite(time) ? time : null;
  }

  function finalWindow(deadlineValue, nowValue = Date.now()) {
    const deadline = validDate(deadlineValue);
    const now = Number(nowValue);
    if (deadline == null || !Number.isFinite(now)) {
      return { phase: "unknown", deadline: null, opensAt: null, remainingMs: null };
    }
    const opensAt = deadline - 24 * 60 * 60 * 1000;
    if (now >= deadline) {
      return { phase: "closed", deadline, opensAt, remainingMs: 0 };
    }
    if (now >= opensAt) {
      return { phase: "open", deadline, opensAt, remainingMs: deadline - now };
    }
    return { phase: "preparing", deadline, opensAt, remainingMs: opensAt - now };
  }

  function confirmedByPrimarySource(player) {
    const status = String(player?.status || "").toLowerCase();
    return /(?:titular|suplente)\s+confirmad[oa]/.test(status);
  }

  function activeSignals(signals, player, gameweek, context = {}) {
    if (!Array.isArray(signals) || !player) return [];
    const targetGameweek = Math.max(1, Math.min(38, Math.round(Number(gameweek) || 1)));
    const deadline = validDate(context.deadline);
    const sourceObservedAt = validDate(context.observedAt);
    if (context.stale === true || sourceObservedAt == null) return [];
    if (deadline != null && sourceObservedAt >= deadline) return [];
    return signals.filter((signal) => {
      if (!signal || Number(signal.playerId) !== Number(player.id) || !TYPES[signal.type]) {
        return false;
      }
      const signalGameweek = Number(signal.gameweek);
      if (Number.isInteger(signalGameweek) && signalGameweek !== targetGameweek) return false;
      if (!Number.isInteger(signalGameweek) && targetGameweek !== Number(context.currentGameweek)) {
        return false;
      }
      const observedAt = validDate(signal.observedAt) ?? sourceObservedAt;
      return observedAt != null && (deadline == null || observedAt < deadline) && signal.stale !== true;
    });
  }

  function evaluate(signals, player, gameweek, context = {}) {
    const active = activeSignals(signals, player, gameweek, context);
    if (!active.length) return { factor: 1, active: [], primaryOverride: false };
    if (confirmedByPrimarySource(player)) {
      return { factor: 1, active, primaryOverride: true };
    }
    const risks = active.filter((signal) => signal.type !== "probable");
    const relevant = risks.length ? risks : active.filter((signal) => signal.type === "probable");
    const factor = relevant.reduce(
      (current, signal) => Math.min(current, TYPES[signal.type].factor),
      risks.length ? 1 : TYPES.probable.factor,
    );
    return {
      factor: Math.max(0.55, Math.min(1.04, factor)),
      active: relevant,
      primaryOverride: false,
    };
  }

  function projectionFactor(signals, player, gameweek, context = {}) {
    return evaluate(signals, player, gameweek, context).factor;
  }

  function snapshotSignals(signals, players, gameweek, context = {}) {
    if (!Array.isArray(players)) return [];
    const result = [];
    for (const player of players) {
      const evaluation = evaluate(signals, player, gameweek, context);
      for (const signal of evaluation.active) {
        result.push({
          playerId: player.id,
          type: signal.type,
          label: TYPES[signal.type].label,
          factor: evaluation.primaryOverride ? 1 : TYPES[signal.type].factor,
          primaryOverride: evaluation.primaryOverride,
          observedAt: signal.observedAt || context.observedAt || null,
          sourceUrl: signal.sourceUrl || null,
        });
      }
    }
    return result.slice(0, 30);
  }

  global.FanTeamEditorial = Object.freeze({
    VERSION,
    TYPES,
    activeSignals,
    evaluate,
    finalWindow,
    projectionFactor,
    snapshotSignals,
  });
})(globalThis);
