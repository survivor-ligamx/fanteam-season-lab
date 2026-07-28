(function attachDraftFantasyImport(global) {
  "use strict";

  const Data = global.PremierLeagueData;
  if (!Data) throw new Error("PremierLeagueData debe cargarse antes del importador de Draft Fantasy");

  const STORAGE_KEY = "fanteam-draft-fantasy-import-v1";
  const SNAPSHOT_DISABLED_KEY = "fanteam-draft-fantasy-local-disabled-v1";
  const SCHEMA_VERSION = 1;
  const EXPECTED_SEASON = "2026/27";
  const MAX_FILE_AGE_DAYS = 30;
  const MAX_FILE_BYTES = 4 * 1024 * 1024;
  const MAX_PLAYERS = 1000;
  const MAX_GAMEWEEK = 38;
  const MAX_PROJECTION_LINE = 600;

  function finite(value) {
    if (value == null || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function safeText(value, maximum = 120) {
    return String(value ?? "").trim().slice(0, maximum);
  }

  function safeDate(value) {
    if (!value) return null;
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
  }

  function canonicalText(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/ß/g, "ss")
      .replace(/ı/g, "i")
      .replace(/ø/g, "o")
      .replace(/đ/g, "d")
      .replace(/ð/g, "d")
      .replace(/ł/g, "l")
      .replace(/æ/g, "ae")
      .replace(/œ/g, "oe");
  }

  function normalizeName(value) {
    return canonicalText(value).replace(/[^a-z0-9]/g, "");
  }

  function nameTokens(value) {
    return canonicalText(value)
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  }

  function normalizeClub(value) {
    const raw = safeText(value, 20).toUpperCase();
    if (raw === "COV") return "CVC";
    return Data.resolveClubCode(raw) || (/^[A-Z]{3}$/.test(raw) ? raw : null);
  }

  function parseCsvMatrix(text) {
    const rows = [];
    let row = [];
    let value = "";
    let quoted = false;
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (quoted) {
        if (character === '"' && text[index + 1] === '"') {
          value += '"';
          index += 1;
        } else if (character === '"') {
          quoted = false;
        } else {
          value += character;
        }
      } else if (character === '"') {
        quoted = true;
      } else if (character === ",") {
        row.push(value);
        value = "";
      } else if (character === "\n" || character === "\r") {
        if (character === "\r" && text[index + 1] === "\n") index += 1;
        row.push(value);
        if (row.some((cell) => String(cell).trim())) rows.push(row);
        row = [];
        value = "";
      } else {
        value += character;
      }
    }
    row.push(value);
    if (row.some((cell) => String(cell).trim())) rows.push(row);
    if (quoted) throw new Error("El CSV termina dentro de un campo entre comillas");
    return rows;
  }

  function parseProjectionLine(value, firstGameweek) {
    const text = String(value ?? "").trim();
    if (!text || text.length > MAX_PROJECTION_LINE) return null;
    const match = text.match(
      /^(.+?) ([A-Z]{3}) · (?:GKP|DEF|MID|FWD) · £\d+(?:\.\d+)?m(?: · (?:peer estimate|availability adjusted))? ((?:-?\d+(?:\.\d+)? xP [A-Z]{3} [HA] ){4}-?\d+(?:\.\d+)? xP [A-Z]{3} [HA]) (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)$/u,
    );
    if (!match) return null;
    const name = safeText(match[1], 100);
    const teamCode = normalizeClub(match[2]);
    const points = [...match[3].matchAll(/(-?\d+(?:\.\d+)?) xP/g)]
      .map((candidate) => finite(candidate[1]));
    const rawTotal = finite(match[4]);
    if (!name || !teamCode || points.length !== 5 || points.some((point) => (
      point == null || point < -50 || point > 100
    ))) return null;
    const roundedTotal = points.reduce((total, point) => total + point, 0);
    if (rawTotal == null || Math.abs(roundedTotal - rawTotal) > 0.6) return null;
    return {
      name,
      teamCode,
      gameweeks: points.map((point, index) => ({ gw: firstGameweek + index, points: point })),
    };
  }

  function normalizeProjection(raw) {
    if (!raw || typeof raw !== "object") return null;
    const name = safeText(raw.name ?? raw.player, 100);
    const teamCode = normalizeClub(raw.teamCode ?? raw.club ?? raw.team);
    if (!name || !teamCode || !Array.isArray(raw.gameweeks)) return null;
    const gameweeks = new Map();
    for (const candidate of raw.gameweeks) {
      const gw = Number(candidate?.gw ?? candidate?.gameweek);
      const points = finite(candidate?.points ?? candidate?.xP ?? candidate?.xp);
      if (!Number.isSafeInteger(gw) || gw < 1 || gw > MAX_GAMEWEEK) continue;
      if (points == null || points < -50 || points > 100) continue;
      gameweeks.set(gw, { gw, points });
    }
    if (!gameweeks.size) return null;
    return {
      name,
      teamCode,
      gameweeks: [...gameweeks.values()].sort((first, second) => first.gw - second.gw),
    };
  }

  function projectionKey(player) {
    return `${normalizeName(player.name)}|${player.teamCode}`;
  }

  function projectionSignature(player) {
    return JSON.stringify(player.gameweeks.map((row) => [row.gw, row.points]));
  }

  function deduplicate(players) {
    const grouped = new Map();
    let duplicates = 0;
    for (const player of players) {
      const key = projectionKey(player);
      const existing = grouped.get(key);
      if (!existing) {
        grouped.set(key, player);
        continue;
      }
      if (projectionSignature(existing) !== projectionSignature(player)) {
        throw new Error(`Proyecciones Draft conflictivas para ${player.name} (${player.teamCode})`);
      }
      duplicates += 1;
    }
    return { players: [...grouped.values()], duplicates };
  }

  function normalizeDataset(raw, source = {}) {
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.players)) {
      throw new Error("El dataset Draft no contiene una lista de jugadores");
    }
    if (raw.players.length > MAX_PLAYERS) {
      throw new Error(`El dataset Draft supera el límite de ${MAX_PLAYERS} jugadores`);
    }
    const normalized = raw.players.map(normalizeProjection).filter(Boolean);
    if (!normalized.length) throw new Error("El dataset Draft no contiene proyecciones válidas");
    const deduplicated = deduplicate(normalized);
    const metadata = raw.meta && typeof raw.meta === "object" ? raw.meta : {};
    const season = safeText(metadata.season, 10);
    const firstGameweek = Number(metadata.firstGameweek);
    const lastGameweek = Number(metadata.lastGameweek);
    if (season !== EXPECTED_SEASON) {
      throw new Error(`La temporada Draft debe ser ${EXPECTED_SEASON}`);
    }
    if (!Number.isSafeInteger(firstGameweek) || !Number.isSafeInteger(lastGameweek)
      || firstGameweek < 1 || lastGameweek > MAX_GAMEWEEK || lastGameweek - firstGameweek !== 4) {
      throw new Error("La ventana Draft debe contener cinco jornadas consecutivas identificables");
    }
    const expectedGameweeks = Array.from({ length: 5 }, (_, index) => firstGameweek + index);
    if (deduplicated.players.some((player) => (
      player.gameweeks.length !== expectedGameweeks.length
        || player.gameweeks.some((row, index) => row.gw !== expectedGameweeks[index])
    ))) {
      throw new Error("Las proyecciones Draft no coinciden con la ventana declarada");
    }
    return {
      version: SCHEMA_VERSION,
      importedAt: safeDate(source.importedAt ?? raw.importedAt) || new Date().toISOString(),
      fileModifiedAt: safeDate(source.fileModifiedAt ?? raw.fileModifiedAt),
      filename: safeText(source.filename ?? raw.filename ?? "proyecciones Draft locales", 120),
      meta: {
        season,
        validRows: deduplicated.players.length,
        duplicateRows: Math.max(0, Number(metadata.duplicateRows) || 0) + deduplicated.duplicates,
        ignoredCells: Math.max(0, Number(metadata.ignoredCells) || 0),
        firstGameweek,
        lastGameweek,
      },
      players: deduplicated.players,
    };
  }

  function parseText(value, source = {}) {
    const text = String(value ?? "").replace(/^\uFEFF/, "");
    const matrix = parseCsvMatrix(text);
    if (matrix.length < 2) throw new Error("El CSV Draft no contiene filas de datos");
    const headers = matrix[0].map((header) => Data.normalize(header));
    if (!headers.includes("jugador") || !headers.includes("informacioncompleta")) {
      throw new Error("El CSV Draft debe incluir Jugador e Informacion_Completa");
    }
    const seasonMatch = text.match(/\bFPL\s+(20\d{2}\/\d{2})\s+guide\b/i);
    const season = seasonMatch?.[1] || null;
    if (season !== EXPECTED_SEASON) {
      throw new Error(`No se pudo verificar la temporada Draft ${EXPECTED_SEASON}`);
    }
    const windowMatch = text.match(
      /\bPlayer\s+GW(\d{1,2})\s+GW(\d{1,2})\s+GW(\d{1,2})\s+GW(\d{1,2})\s+GW(\d{1,2})\s+Raw xP\s+Decayed xP\b/i,
    );
    const gameweeks = windowMatch?.slice(1).map(Number) || [];
    if (gameweeks.length !== 5 || gameweeks.some((gameweek, index) => (
      !Number.isSafeInteger(gameweek) || gameweek < 1 || gameweek > MAX_GAMEWEEK
        || (index > 0 && gameweek !== gameweeks[index - 1] + 1)
    ))) {
      throw new Error("No se pudo verificar una ventana Draft de cinco jornadas consecutivas");
    }
    const [firstGameweek] = gameweeks;
    const cells = matrix.slice(1).flat();
    const observations = cells.map((cell) => parseProjectionLine(cell, firstGameweek)).filter(Boolean);
    if (!observations.length) {
      throw new Error("No se encontraron filas Draft con cinco proyecciones consecutivas válidas");
    }
    if (observations.length > MAX_PLAYERS * 4) {
      throw new Error("El CSV Draft contiene demasiadas observaciones");
    }
    const deduplicated = deduplicate(observations);
    return normalizeDataset({
      importedAt: source.importedAt,
      fileModifiedAt: source.fileModifiedAt,
      filename: source.filename,
      meta: {
        season,
        validRows: deduplicated.players.length,
        duplicateRows: deduplicated.duplicates,
        ignoredCells: cells.length - observations.length,
        firstGameweek,
        lastGameweek: gameweeks[4],
      },
      players: deduplicated.players,
    }, source);
  }

  async function parseFile(file) {
    if (!global.File || !(file instanceof global.File)) throw new Error("Selecciona un archivo CSV de Draft Fantasy");
    if (file.size <= 0) throw new Error("El archivo Draft está vacío");
    if (file.size > MAX_FILE_BYTES) throw new Error("El archivo Draft supera el límite local de 4 MB");
    return parseText(await file.text(), {
      filename: file.name,
      fileModifiedAt: file.lastModified ? new Date(file.lastModified).toISOString() : null,
    });
  }

  function read() {
    try {
      const raw = global.localStorage?.getItem(STORAGE_KEY);
      return raw ? normalizeDataset(JSON.parse(raw)) : null;
    } catch (_) {
      return null;
    }
  }

  function save(dataset) {
    try {
      const normalized = normalizeDataset(dataset);
      global.localStorage?.setItem(STORAGE_KEY, JSON.stringify(normalized));
      return global.localStorage?.getItem(STORAGE_KEY) != null;
    } catch (_) {
      return false;
    }
  }

  function snapshotEnabled() {
    try {
      return global.localStorage?.getItem(SNAPSHOT_DISABLED_KEY) !== "1";
    } catch (_) {
      return true;
    }
  }

  function enableSnapshot() {
    try {
      global.localStorage?.removeItem(SNAPSHOT_DISABLED_KEY);
      return true;
    } catch (_) {
      return false;
    }
  }

  function disableSnapshot() {
    try {
      global.localStorage?.setItem(SNAPSHOT_DISABLED_KEY, "1");
      return global.localStorage?.getItem(SNAPSHOT_DISABLED_KEY) === "1";
    } catch (_) {
      return false;
    }
  }

  function clear() {
    try {
      global.localStorage?.removeItem(STORAGE_KEY);
      return true;
    } catch (_) {
      return false;
    }
  }

  function pointsAt(player, gameweek) {
    const row = player?.gameweeks?.find((candidate) => candidate.gw === Number(gameweek));
    return row ? finite(row.points) : null;
  }

  function datasetStatus(dataset, { gameweek = 1, now = Date.now() } = {}) {
    if (!dataset?.players?.length) return { active: false, reason: "sin proyecciones Draft" };
    if (dataset.meta?.season !== EXPECTED_SEASON) {
      return { active: false, reason: `temporada no verificada; se exige ${EXPECTED_SEASON}` };
    }
    const firstGameweek = Number(dataset.meta?.firstGameweek);
    const lastGameweek = Number(dataset.meta?.lastGameweek);
    if (!Number.isSafeInteger(gameweek) || gameweek < firstGameweek || gameweek > lastGameweek) {
      return { active: false, reason: `la ventana Draft cubre GW${firstGameweek}–GW${lastGameweek}` };
    }
    const timestamp = new Date(dataset.fileModifiedAt || dataset.importedAt || "").getTime();
    if (!Number.isFinite(timestamp)) return { active: false, reason: "fecha del archivo no verificable" };
    const ageDays = (Number(now) - timestamp) / (24 * 60 * 60 * 1000);
    if (!Number.isFinite(ageDays) || ageDays > MAX_FILE_AGE_DAYS) {
      return { active: false, reason: `archivo Draft con más de ${MAX_FILE_AGE_DAYS} días` };
    }
    if (ageDays < -2) return { active: false, reason: "fecha del archivo Draft en el futuro" };
    return { active: true, ageDays };
  }

  function ownAliases(player) {
    const reference = player?.reference || {};
    return [...new Set([
      player?.name,
      player?.surname,
      String(player?.name || "").trim().split(/\s+/).pop(),
      ...(Array.isArray(player?.aliases) ? player.aliases : []),
      reference.name,
      reference.webName,
      reference.web_name,
    ].map((entry) => safeText(entry, 100)).filter(Boolean))];
  }

  function abbreviationTokenMatches(first, second) {
    return first === second
      || (first.length === 1 && second.startsWith(first))
      || (second.length === 1 && first.startsWith(second));
  }

  function orderedSubsetMatches(shorter, longer) {
    if (shorter.length < 2 || shorter.length >= longer.length) return false;
    let cursor = 0;
    for (const token of longer) {
      if (abbreviationTokenMatches(shorter[cursor], token)) cursor += 1;
      if (cursor === shorter.length) return true;
    }
    return false;
  }

  function abbreviatedNameMatches(firstValue, secondValue) {
    const first = nameTokens(firstValue);
    const second = nameTokens(secondValue);
    if (!first.length || !second.length) return false;
    if (first.length === 1 || second.length === 1) {
      const single = first.length === 1 ? first[0] : second[0];
      const other = first.length === 1 ? second : first;
      return single.length >= 3 && (single === other[0] || single === other[other.length - 1]);
    }
    if (first.length === second.length) {
      return first.every((token, index) => abbreviationTokenMatches(token, second[index]));
    }
    if (orderedSubsetMatches(first, second) || orderedSubsetMatches(second, first)) return true;
    return abbreviationTokenMatches(first[0], second[0])
      && abbreviationTokenMatches(first[first.length - 1], second[second.length - 1]);
  }

  function aliasesMatch(player, projection) {
    return ownAliases(player).some((alias) => abbreviatedNameMatches(alias, projection.name));
  }

  function addUnique(map, key, value) {
    if (!key) return;
    if (map.get(key) === value) return;
    if (map.has(key)) map.set(key, null);
    else map.set(key, value);
  }

  function matchPlayers(players, projections) {
    const catalog = Array.isArray(players) ? players : [];
    const rows = Array.isArray(projections) ? projections : [];
    const byIdentity = new Map();
    const ownIdentityCounts = new Map();
    const identity = (name, club) => `${normalizeName(name)}|${normalizeClub(club) || ""}`;

    for (const player of catalog) {
      const keys = new Set(ownAliases(player).map((alias) => identity(alias, player.club)));
      for (const key of keys) ownIdentityCounts.set(key, (ownIdentityCounts.get(key) || 0) + 1);
    }
    for (const row of rows) addUnique(byIdentity, identity(row.name, row.teamCode), row);

    const byPlayerId = new Map();
    const playerByProjection = new Map();
    const matchMethod = new Map();
    const claimed = new Set();
    for (const player of catalog) {
      for (const alias of ownAliases(player)) {
        const key = identity(alias, player.club);
        const match = ownIdentityCounts.get(key) === 1 ? byIdentity.get(key) : null;
        if (!match || claimed.has(match)) continue;
        claimed.add(match);
        byPlayerId.set(Number(player.id), match);
        playerByProjection.set(match, player);
        matchMethod.set(Number(player.id), alias === player.name ? "nombre + club" : "alias único + club");
        break;
      }
    }

    const unmatchedPlayers = catalog.filter((player) => !byPlayerId.has(Number(player.id)));
    const unclaimedRows = rows.filter((row) => !claimed.has(row));
    const candidates = unclaimedRows.map((row) => ({
      row,
      players: unmatchedPlayers.filter((player) => (
        normalizeClub(player.club) === normalizeClub(row.teamCode) && aliasesMatch(player, row)
      )),
    }));
    const ambiguous = [];
    for (const candidate of candidates) {
      if (candidate.players.length !== 1) {
        if (candidate.players.length > 1) ambiguous.push(candidate.row);
        continue;
      }
      const [player] = candidate.players;
      const competingRows = candidates.filter((other) => other.players.some((otherPlayer) => (
        Number(otherPlayer.id) === Number(player.id)
      )));
      if (competingRows.length !== 1 || byPlayerId.has(Number(player.id))) {
        ambiguous.push(candidate.row);
        continue;
      }
      claimed.add(candidate.row);
      byPlayerId.set(Number(player.id), candidate.row);
      playerByProjection.set(candidate.row, player);
      matchMethod.set(Number(player.id), "abreviatura única + club");
    }

    return {
      ambiguous,
      byPlayerId,
      matchMethod,
      playerByProjection,
      unmatchedRows: rows.filter((row) => !claimed.has(row)),
    };
  }

  global.DraftFantasyImport = Object.freeze({
    EXPECTED_SEASON,
    MAX_FILE_AGE_DAYS,
    MAX_FILE_BYTES,
    SCHEMA_VERSION,
    SNAPSHOT_DISABLED_KEY,
    STORAGE_KEY,
    clear,
    datasetStatus,
    disableSnapshot,
    enableSnapshot,
    matchPlayers,
    normalizeDataset,
    normalizeName,
    parseFile,
    parseText,
    pointsAt,
    read,
    save,
    snapshotEnabled,
  });
})(globalThis);
