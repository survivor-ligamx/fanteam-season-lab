(function registerSeasonBackup(global) {
  "use strict";

  const APP = "fanteam-season-lab";
  const VERSION = 5;

  function create({ state, endpoint = "", now = new Date() }) {
    if (!state || typeof state !== "object") throw new Error("estado inválido");
    const exportedAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
    if (exportedAt === "Invalid Date") throw new Error("fecha de exportación inválida");
    return {
      app: APP,
      v: VERSION,
      exportedAt,
      state,
      endpoint: String(endpoint || ""),
    };
  }

  function parse(input, { migrateState } = {}) {
    if (typeof migrateState !== "function") {
      throw new Error("dependencias de migración inválidas");
    }
    const legacyState = input && input.state ? input.state : input;
    const validSquad = legacyState
      && Array.isArray(legacyState.squad)
      && legacyState.squad.length === 15
      && legacyState.squad.every((id) => (
        (typeof id === "number" || typeof id === "string")
        && String(id).trim() !== ""
        && Number.isSafeInteger(Number(id))
        && Number(id) > 0
      ));
    if (!validSquad) throw new Error("estructura inválida");

    const state = migrateState({
      ...legacyState,
      gw: Math.max(1, Math.min(38, Math.round(legacyState.gw || 1))),
      free: Math.max(0, Math.min(37, Math.round(legacyState.free || 0))),
      squad: legacyState.squad.slice(0, 15),
      history: Array.isArray(legacyState.history) ? legacyState.history : [],
      decision: legacyState.decision,
      wc1: Boolean(legacyState.wc1),
      wc2: Boolean(legacyState.wc2),
    });

    return {
      state,
      endpoint: typeof input?.endpoint === "string" ? input.endpoint.trim() : "",
    };
  }

  global.FanTeamSeasonBackup = Object.freeze({ APP, VERSION, create, parse });
})(globalThis);
