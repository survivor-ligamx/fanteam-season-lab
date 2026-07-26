(function attachFanTeamImport(global) {
  "use strict";

  const VERSION = "fanteam-import-v1";

  function normalizeKey(value) {
    return (value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }

  function parseCsvRows(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      const next = text[index + 1];
      if (character === '"') {
        if (quoted && next === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = !quoted;
        }
      } else if (character === "," && !quoted) {
        row.push(cell.trim());
        cell = "";
      } else if ((character === "\n" || character === "\r") && !quoted) {
        if (character === "\r" && next === "\n") index += 1;
        row.push(cell.trim());
        if (row.some(Boolean)) rows.push(row);
        row = [];
        cell = "";
      } else {
        cell += character;
      }
    }
    row.push(cell.trim());
    if (row.some(Boolean)) rows.push(row);
    if (rows.length < 2) return [];
    const headers = rows[0].map(normalizeKey);
    return rows.slice(1).map((columns) => Object.fromEntries(
      headers.map((header, index) => [header, columns[index] ?? ""]),
    ));
  }

  function parsePriceInput(text, name = "") {
    if (/\.csv$/i.test(name)) return parseCsvRows(text);
    const data = JSON.parse(text);
    const list = Array.isArray(data)
      ? data
      : Array.isArray(data?.players)
        ? data.players
        : Array.isArray(data?.prices)
          ? data.prices
          : null;
    if (!list) throw new Error("el JSON debe ser un array o contener players[]/prices[]");
    return list;
  }

  function parseActualInput(text, name = "", fallbackGW = null) {
    if (/\.csv$/i.test(name)) return { defaultGW: fallbackGW, rows: parseCsvRows(text) };
    const data = JSON.parse(text);
    const rows = Array.isArray(data)
      ? data
      : Array.isArray(data?.players)
        ? data.players
        : Array.isArray(data?.actuals)
          ? data.actuals
          : null;
    if (!rows) throw new Error("el JSON debe ser un array o contener players[]/actuals[]");
    return {
      defaultGW: data && Number.isFinite(Number(data.gw)) ? Number(data.gw) : fallbackGW,
      rows,
    };
  }

  function matchPlayer(item, players, resolveClubCode, options = {}) {
    let player = null;
    if (item?.id != null && (!options.trimId || String(item.id).trim() !== "")) {
      const id = options.trimId ? String(item.id).trim() : String(item.id);
      player = players.find((candidate) => String(candidate.id) === id) || null;
    }
    if (!player && item?.name && item?.club != null && String(item.club).trim()) {
      const club = resolveClubCode(item.club || item.clubName);
      const name = normalizeKey(item.name);
      if (club) {
        const matches = players.filter((candidate) => (
          candidate.club === club && normalizeKey(candidate.name) === name
        ));
        if (matches.length === 1) player = matches[0];
      }
    }
    return player;
  }

  function preparePriceUpdates(list, options) {
    if (!Array.isArray(list)) throw new Error("lista de precios inválida");
    const { players, resolveClubCode, validPrice } = options;
    let applied = 0;
    let skipped = 0;
    const seen = new Map();
    const updates = [];
    for (const item of list) {
      if (!item || typeof item !== "object") {
        skipped += 1;
        continue;
      }
      const raw = item.price ?? item.currentPrice ?? item.value;
      const price = Math.round(Number(raw) * 10) / 10;
      if (!validPrice(price)) {
        skipped += 1;
        continue;
      }
      const player = matchPlayer(item, players, resolveClubCode);
      if (!player) {
        skipped += 1;
        continue;
      }
      if (seen.has(player.id)) {
        if (seen.get(player.id) !== price) {
          throw new Error(`precios conflictivos para ${player.name}`);
        }
        skipped += 1;
        continue;
      }
      seen.set(player.id, price);
      updates.push({ p: player, n: price });
      applied += 1;
    }
    if (!applied) throw new Error("ningún jugador coincidió de forma segura");
    return { applied, skipped, updates };
  }

  function prepareActualUpdates(input, options) {
    const rows = input?.rows;
    if (!Array.isArray(rows)) throw new Error("lista de puntos inválida");
    const {
      players,
      resolveClubCode,
      hasConfirmedSnapshot,
      actualFor,
      validActualPoints,
      scoring,
    } = options;
    const seen = new Map();
    const updates = [];
    const errors = [];
    let skipped = 0;
    let calculated = 0;
    let direct = 0;
    let mismatches = 0;
    const reject = (row, item, reason) => {
      skipped += 1;
      errors.push({ row: row + 1, id: item?.id ?? null, name: item?.name ?? null, reason });
    };

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const item = rows[rowIndex];
      if (!item || typeof item !== "object") {
        reject(rowIndex, item, "registro inválido");
        continue;
      }
      const gw = Math.round(Number(item.gw ?? item.gameweek ?? input.defaultGW));
      const player = matchPlayer(item, players, resolveClubCode, { trimId: true });
      if (gw < 1 || gw > 38) {
        reject(rowIndex, item, "jornada inválida");
        continue;
      }
      if (!player) {
        reject(rowIndex, item, "jugador sin coincidencia segura");
        continue;
      }
      if (!hasConfirmedSnapshot(gw)) {
        reject(rowIndex, item, `GW${gw} no está confirmada`);
        continue;
      }
      const hasPoints = Object.prototype.hasOwnProperty.call(item, "points")
        || Object.prototype.hasOwnProperty.call(item, "actualPoints")
        || Object.prototype.hasOwnProperty.call(item, "actual");
      const raw = Object.prototype.hasOwnProperty.call(item, "points")
        ? item.points
        : Object.prototype.hasOwnProperty.call(item, "actualPoints")
          ? item.actualPoints
          : item.actual;
      let statsMode = false;
      try {
        scoring.validateKeys(item);
        statsMode = scoring.hasStats(item);
      } catch (error) {
        reject(rowIndex, item, error.message || "campos de scoring inválidos");
        continue;
      }
      const remove = scoring.parseBoolean(item.delete) === true
        || (hasPoints && raw === null && !statsMode);
      if (remove && !actualFor(gw, player.id)) {
        reject(rowIndex, item, "no existe un resultado que eliminar");
        continue;
      }
      let entry = null;
      if (!remove && statsMode) {
        try {
          const stats = scoring.normalizeStats(item);
          const scored = scoring.calculatePoints(player, stats);
          if (!validActualPoints(scored.points)) {
            reject(rowIndex, item, "puntuación calculada fuera de rango");
            continue;
          }
          const reported = hasPoints && raw != null && String(raw).trim() !== ""
            ? Number(raw)
            : null;
          if (reported != null && !validActualPoints(reported)) {
            reject(rowIndex, item, "points reportado inválido");
            continue;
          }
          entry = {
            points: scored.points,
            minutes: stats.minutes,
            played: stats.minutes > 0,
            stats,
            breakdown: scored.breakdown,
            scoringVersion: scored.version,
          };
          if (reported != null) {
            entry.reportedPoints = +reported.toFixed(2);
            if (Math.abs(reported - scored.points) > .01) mismatches += 1;
          }
          calculated += 1;
        } catch (error) {
          reject(rowIndex, item, error.message || "estadísticas inválidas");
          continue;
        }
      } else if (!remove) {
        if (!hasPoints || raw == null || String(raw).trim() === "") {
          reject(rowIndex, item, "falta points o estadísticas de scoring");
          continue;
        }
        const points = Number(raw);
        const minutesRaw = item.minutes ?? item.mins;
        const minutes = minutesRaw == null || String(minutesRaw).trim() === ""
          ? null
          : Number(minutesRaw);
        const playedProvided = item.played != null && String(item.played).trim() !== "";
        const explicit = scoring.parseBoolean(item.played);
        if (!validActualPoints(points)) {
          reject(rowIndex, item, "points inválido");
          continue;
        }
        if (minutes != null && (!Number.isFinite(minutes) || minutes < 0 || minutes > 120)) {
          reject(rowIndex, item, "minutes inválido");
          continue;
        }
        if (playedProvided && explicit == null) {
          reject(rowIndex, item, "played inválido");
          continue;
        }
        const played = explicit == null ? (minutes == null ? true : minutes > 0) : explicit;
        if (played === false && ((minutes != null && minutes > 0) || points !== 0)) {
          reject(rowIndex, item, "played=false exige 0 minutos y 0 puntos");
          continue;
        }
        if (played === true && minutes === 0) {
          reject(rowIndex, item, "played=true no admite 0 minutos");
          continue;
        }
        entry = {
          points: +points.toFixed(2),
          minutes: minutes == null ? null : Math.round(minutes),
          played,
        };
        direct += 1;
      }
      const key = `${gw}:${player.id}`;
      const signature = entry == null ? "DELETE" : JSON.stringify(entry);
      if (seen.has(key)) {
        if (seen.get(key) !== signature) {
          throw new Error(`datos conflictivos para ${player.name} en GW${gw}`);
        }
        reject(rowIndex, item, "registro duplicado idéntico");
        continue;
      }
      seen.set(key, signature);
      updates.push({ gw, p: player, entry });
    }
    if (!updates.length) {
      throw new Error(`ningún registro válido: ${errors[0]?.reason || "sin coincidencias con jornadas confirmadas"}`);
    }
    return { updates, skipped, errors, calculated, direct, mismatches };
  }

  global.FanTeamImport = Object.freeze({
    VERSION,
    matchPlayer,
    normalizeKey,
    parseActualInput,
    parseCsvRows,
    parsePriceInput,
    prepareActualUpdates,
    preparePriceUpdates,
  });
})(globalThis);
