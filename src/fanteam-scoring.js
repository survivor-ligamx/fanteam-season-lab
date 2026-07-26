(function attachFanTeamScoring(global) {
  "use strict";

  const VERSION = "fanteam-v1";
  const STAT_ALIASES = {
    goals: ["goles"],
    assists: ["asistencias"],
    fantasyAssists: ["fantasyassist", "asistenciasfantasy"],
    shotsOnTarget: ["sot", "tirosapuerta"],
    saves: ["atajadas", "paradas"],
    penaltiesSaved: ["penaltysaves", "penaltisatajados"],
    cleanSheet: ["cs", "porteriaacero"],
    goalsConceded: ["gc", "golesrecibidos"],
    fullMatch: ["partidocompleto"],
    penaltiesMissed: ["penaltisfallados"],
    ownGoals: ["autogoles"],
    yellowCards: ["yellows", "amarillas"],
    redCards: ["reds", "rojas"],
    penaltiesConceded: ["penaltiescommitted", "penaltiscometidos"],
    freeKickGoalsConceded: ["freekickerrors", "faltascongol"],
    positiveImpacts: ["impactpositive", "impactospositivos"],
    negativeImpacts: ["impactnegative", "impactosnegativos"],
  };
  const STAT_NAMES = [
    ["minutes", "mins", "minutos"],
    ...Object.entries(STAT_ALIASES).map(([key, aliases]) => [key, ...aliases]),
  ];
  const STAT_LOOKUP = new Map(
    STAT_NAMES.flatMap((names) => names.map((name) => [normalizeKey(name), names[0]])),
  );
  const IMPORT_META = new Set([
    "stats",
    "gw",
    "gameweek",
    "id",
    "name",
    "club",
    "clubname",
    "pos",
    "position",
    "points",
    "actualpoints",
    "actual",
    "played",
    "delete",
  ].map(normalizeKey));

  function normalizeKey(value) {
    return (value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }

  function parseBoolean(value) {
    if (typeof value === "boolean") return value;
    if (value == null || String(value).trim() === "") return null;
    const normalized = normalizeKey(String(value));
    if (["true", "yes", "si", "1", "played", "jugo"].includes(normalized)) return true;
    if (["false", "no", "0", "dnp", "nojugo"].includes(normalized)) return false;
    return null;
  }

  function rawValue(item, names) {
    const wanted = names.map(normalizeKey);
    for (const source of [item?.stats, item]) {
      if (!source || typeof source !== "object") continue;
      for (const [key, value] of Object.entries(source)) {
        if (wanted.includes(normalizeKey(key))) return value;
      }
    }
    return undefined;
  }

  function textDistance(first, second) {
    const row = Array.from({ length: second.length + 1 }, (_, index) => index);
    for (let i = 1; i <= first.length; i += 1) {
      let previous = row[0];
      row[0] = i;
      for (let j = 1; j <= second.length; j += 1) {
        const old = row[j];
        row[j] = Math.min(
          row[j] + 1,
          row[j - 1] + 1,
          previous + (first[i - 1] === second[j - 1] ? 0 : 1),
        );
        previous = old;
      }
    }
    return row[second.length];
  }

  function validateKeys(item) {
    const check = (source, strict) => {
      if (!source || typeof source !== "object" || Array.isArray(source)) return;
      for (const key of Object.keys(source)) {
        const normalized = normalizeKey(key);
        if (STAT_LOOKUP.has(normalized) || (!strict && IMPORT_META.has(normalized))) continue;
        if (strict) throw new Error(`campo stats desconocido: ${key}`);
        let suggestion = null;
        let distance = Infinity;
        for (const known of STAT_LOOKUP.keys()) {
          const candidateDistance = textDistance(normalized, known);
          if (candidateDistance < distance) {
            distance = candidateDistance;
            suggestion = STAT_LOOKUP.get(known);
          }
        }
        if (distance <= 2) {
          throw new Error(`campo de scoring desconocido: ${key} (¿${suggestion}?)`);
        }
      }
    };
    check(item?.stats, true);
    check(item, false);
  }

  function hasStats(item) {
    return Object.entries(STAT_ALIASES).some(([key, aliases]) => {
      const value = rawValue(item, [key, ...aliases]);
      return value != null && String(value).trim() !== "";
    });
  }

  function normalizeStats(item) {
    validateKeys(item);
    const count = (key, aliases = [], max = 50) => {
      const raw = rawValue(item, [key, ...aliases]);
      if (raw == null || String(raw).trim() === "") return 0;
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 0 || value > max) {
        throw new Error(`${key} inválido`);
      }
      return value;
    };
    const bool = (key, aliases = [], fallback = false) => {
      const raw = rawValue(item, [key, ...aliases]);
      if (raw == null || String(raw).trim() === "") return fallback;
      const value = parseBoolean(raw);
      if (value == null) throw new Error(`${key} inválido`);
      return value;
    };
    const minutesRaw = rawValue(item, ["minutes", "mins", "minutos"]);
    const minutes = Number(minutesRaw);
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > 120) {
      throw new Error("minutes inválido");
    }
    const stats = {
      minutes,
      goals: count("goals", ["goles"], 20),
      assists: count("assists", ["asistencias"], 20),
      fantasyAssists: count("fantasyAssists", ["fantasyassist", "asistenciasfantasy"], 20),
      shotsOnTarget: count("shotsOnTarget", ["sot", "tirosapuerta"], 50),
      saves: count("saves", ["atajadas", "paradas"], 50),
      penaltiesSaved: count("penaltiesSaved", ["penaltysaves", "penaltisatajados"], 10),
      cleanSheet: bool("cleanSheet", ["cs", "porteriaacero"]),
      goalsConceded: count("goalsConceded", ["gc", "golesrecibidos"], 20),
      fullMatch: bool("fullMatch", ["partidocompleto"], minutes >= 90),
      penaltiesMissed: count("penaltiesMissed", ["penaltisfallados"], 10),
      ownGoals: count("ownGoals", ["autogoles"], 10),
      yellowCards: count("yellowCards", ["yellows", "amarillas"], 5),
      redCards: count("redCards", ["reds", "rojas"], 3),
      penaltiesConceded: count("penaltiesConceded", ["penaltiescommitted", "penaltiscometidos"], 10),
      freeKickGoalsConceded: count("freeKickGoalsConceded", ["freekickerrors", "faltascongol"], 10),
      positiveImpacts: count("positiveImpacts", ["impactpositive", "impactospositivos"], 100),
      negativeImpacts: count("negativeImpacts", ["impactnegative", "impactosnegativos"], 100),
    };
    if (stats.fullMatch && minutes < 90) throw new Error("fullMatch exige 90+ minutos");
    if (
      minutes === 0
      && Object.entries(stats).some(([key, value]) => (
        key !== "minutes" && (typeof value === "boolean" ? value : value > 0)
      ))
    ) {
      throw new Error("un jugador sin minutos no puede registrar acciones");
    }
    return stats;
  }

  function calculatePoints(player, stats) {
    if (!player || !["GK", "DEF", "MID", "FWD"].includes(player.pos)) {
      throw new Error("posición inválida");
    }
    const breakdown = {
      appearance: stats.minutes > 0 ? 1 : 0,
      minutes60: stats.minutes >= 60 ? 1 : 0,
      assists: 3 * (stats.assists + stats.fantasyAssists),
      penaltiesConceded: -2 * stats.penaltiesConceded,
      freeKickGoalsConceded: -2 * stats.freeKickGoalsConceded,
      penaltiesMissed: -2 * stats.penaltiesMissed,
      ownGoals: -2 * stats.ownGoals,
      yellowCards: -stats.yellowCards,
      redCards: -3 * stats.redCards,
      impact: +(.3 * (stats.positiveImpacts - stats.negativeImpacts)).toFixed(2),
      goals: 0,
      shotsOnTarget: 0,
      cleanSheet: 0,
      saves: 0,
      penaltiesSaved: 0,
      goalsConceded: 0,
      fullMatch: 0,
    };
    const goalValue = { GK: 8, DEF: 6, MID: 5, FWD: 4 }[player.pos];
    const shotValue = { GK: 1, DEF: .6, MID: .4, FWD: .4 }[player.pos];
    breakdown.goals = goalValue * stats.goals;
    breakdown.shotsOnTarget = +(shotValue * stats.shotsOnTarget).toFixed(2);
    if (stats.cleanSheet && stats.minutes >= 60) {
      breakdown.cleanSheet = { GK: 4, DEF: 4, MID: 1, FWD: 0 }[player.pos];
    }
    if (player.pos === "GK") {
      breakdown.saves = +(.5 * stats.saves).toFixed(2);
      breakdown.penaltiesSaved = 5 * stats.penaltiesSaved;
    }
    if (player.pos === "GK" || player.pos === "DEF") {
      breakdown.goalsConceded = -Math.floor(stats.goalsConceded / 2);
    }
    if ((player.pos === "MID" || player.pos === "FWD") && stats.fullMatch) {
      breakdown.fullMatch = 1;
    }
    const points = +Object.values(breakdown).reduce((sum, value) => sum + value, 0).toFixed(2);
    return { points, breakdown, version: VERSION };
  }

  global.FanTeamScoring = Object.freeze({
    VERSION,
    calculatePoints,
    hasStats,
    normalizeStats,
    parseBoolean,
    validateKeys,
  });
})(globalThis);
