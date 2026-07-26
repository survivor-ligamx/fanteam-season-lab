(function attachFanTeamWeek(global) {
  "use strict";

  const VERSION = "fanteam-week-v1";
  const DEFAULT_MAX_GAMEWEEK = 38;

  function decisionDescription(decision) {
    if (decision?.type !== "applied") return "Guardar transferencia";
    return (decision.count || 1) === 2
      ? `${decision.out.name} → ${decision.inn.name} · ${decision.out2.name} → ${decision.inn2.name}`
      : `${decision.out.name} → ${decision.inn.name}`;
  }

  function closeWeek(input) {
    const {
      state,
      captainName,
      modelSnapshot,
      priceSnapshot,
      maxGameweek = DEFAULT_MAX_GAMEWEEK,
    } = input || {};
    if (!state || typeof state !== "object" || !Array.isArray(state.history)) {
      return { ok: false, code: "invalid-state" };
    }
    if (state.seasonComplete) return { ok: false, code: "season-complete" };
    if (!modelSnapshot || typeof modelSnapshot !== "object") {
      return { ok: false, code: "invalid-model-snapshot" };
    }
    if (!priceSnapshot || typeof priceSnapshot !== "object" || priceSnapshot.gw !== state.gw) {
      return { ok: false, code: "invalid-price-snapshot" };
    }

    const gameweek = state.gw;
    const used = state.decision?.type === "applied" ? (state.decision.count || 1) : 0;
    const historyEntry = {
      gw: gameweek,
      decision: decisionDescription(state.decision),
      captain: captainName,
      free: state.free,
      ...modelSnapshot,
    };
    const history = state.history.concat([historyEntry]);
    const priceHistory = Array.isArray(state.priceHistory) ? state.priceHistory.slice() : [];
    const priceIndex = priceHistory.findIndex((entry) => entry.gw === gameweek);
    if (priceIndex >= 0) priceHistory[priceIndex] = priceSnapshot;
    else priceHistory.push(priceSnapshot);
    priceHistory.sort((first, second) => first.gw - second.gw);

    const seasonComplete = gameweek === maxGameweek;
    const nextState = {
      ...state,
      history,
      priceHistory: priceHistory.slice(-38),
      decision: null,
    };
    if (seasonComplete) nextState.seasonComplete = true;
    else {
      nextState.free = gameweek === 1
        ? 1
        : Math.min(37, Math.max(0, state.free - used) + 1);
      nextState.gw = gameweek + 1;
    }

    return {
      ok: true,
      code: seasonComplete ? "season-complete" : "week-closed",
      used,
      historyEntry,
      priceEntry: priceSnapshot,
      state: nextState,
    };
  }

  global.FanTeamWeek = Object.freeze({
    VERSION,
    DEFAULT_MAX_GAMEWEEK,
    closeWeek,
  });
})(globalThis);
