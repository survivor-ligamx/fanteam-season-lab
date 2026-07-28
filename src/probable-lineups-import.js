(function attachProbableLineupsImport(global) {
  "use strict";

  const Data = global.PremierLeagueData;
  if (!Data) throw new Error("PremierLeagueData debe cargarse antes del importador de alineaciones probables");

  const STORAGE_KEY = "fanteam-probable-lineups-import-v1";
  const SNAPSHOT_DISABLED_KEY = "fanteam-probable-lineups-local-disabled-v1";
  const SCHEMA_VERSION = 1;
  const EXPECTED_SEASON = "2026/27";
  const EXPECTED_GAMEWEEK = 1;
  const MAX_FILE_AGE_DAYS = 7;
  const MAX_FILE_BYTES = 1024 * 1024;
  const MAX_ROWS = 1000;
  const FUTURE_TOLERANCE_DAYS = 2;
  const SOURCE_NAME = "Fantasy Football Pundit";
  const SOURCE_URL = "https://www.fantasyfootballpundit.com/fantasy-premier-league-team-news/";
  const SOURCE_FINGERPRINT = "fantasy-football-pundit-predicted-lineups-2026-27-gw1-v1";
  const VERIFIED_CONTENT_SHA256 = "529aa2e9f3059a7d29c9e776a2071d2adaa12aea9179a5bf5e9865ce52b56ece";
  const SHA256_ROUND_CONSTANTS = Object.freeze([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const ROLES = Object.freeze(["probable", "alternative"]);
  const EXPECTED_CLUBS = Object.freeze(Object.keys(Data.TEAM_NAMES).sort());
  const PLAYER_ROW = /^(.+?) (GK|RB|LB|CB|RWB|LWB|DCM|CM|ACM|RM|LM|RF|LF|CF) (?:N\/A|\d+(?:\.\d+)?) (?:TBD|\d+(?:\.\d+)?%?)$/u;

  function safeText(value, maximum = 120) {
    return String(value ?? "").trim().slice(0, maximum);
  }

  function safeDate(value) {
    if (!value) return null;
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
  }

  function rotateRight(value, bits) {
    return (value >>> bits) | (value << (32 - bits));
  }

  function utf8Bytes(value) {
    const bytes = [];
    const text = String(value);
    for (let index = 0; index < text.length; index += 1) {
      const point = text.codePointAt(index);
      if (point > 0xffff) index += 1;
      if (point <= 0x7f) bytes.push(point);
      else if (point <= 0x7ff) {
        bytes.push(0xc0 | (point >>> 6), 0x80 | (point & 0x3f));
      } else if (point <= 0xffff) {
        bytes.push(
          0xe0 | (point >>> 12),
          0x80 | ((point >>> 6) & 0x3f),
          0x80 | (point & 0x3f),
        );
      } else {
        bytes.push(
          0xf0 | (point >>> 18),
          0x80 | ((point >>> 12) & 0x3f),
          0x80 | ((point >>> 6) & 0x3f),
          0x80 | (point & 0x3f),
        );
      }
    }
    return Uint8Array.from(bytes);
  }

  function sha256(value) {
    const bytes = utf8Bytes(value);
    const byteLength = Math.ceil((bytes.length + 9) / 64) * 64;
    const message = new Uint8Array(byteLength);
    message.set(bytes);
    message[bytes.length] = 0x80;
    const view = new DataView(message.buffer);
    const bitLength = bytes.length * 8;
    view.setUint32(byteLength - 8, Math.floor(bitLength / 0x100000000), false);
    view.setUint32(byteLength - 4, bitLength >>> 0, false);

    const hash = new Uint32Array([
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ]);
    const words = new Uint32Array(64);
    for (let offset = 0; offset < byteLength; offset += 64) {
      for (let index = 0; index < 16; index += 1) {
        words[index] = view.getUint32(offset + index * 4, false);
      }
      for (let index = 16; index < 64; index += 1) {
        const first = words[index - 15];
        const second = words[index - 2];
        const sigma0 = rotateRight(first, 7) ^ rotateRight(first, 18) ^ (first >>> 3);
        const sigma1 = rotateRight(second, 17) ^ rotateRight(second, 19) ^ (second >>> 10);
        words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
      }

      let [a, b, c, d, e, f, g, h] = hash;
      for (let index = 0; index < 64; index += 1) {
        const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
        const choose = (e & f) ^ (~e & g);
        const temporary1 = (h + sum1 + choose + SHA256_ROUND_CONSTANTS[index] + words[index]) >>> 0;
        const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
        const majority = (a & b) ^ (a & c) ^ (b & c);
        const temporary2 = (sum0 + majority) >>> 0;
        h = g;
        g = f;
        f = e;
        e = (d + temporary1) >>> 0;
        d = c;
        c = b;
        b = a;
        a = (temporary1 + temporary2) >>> 0;
      }
      hash[0] = (hash[0] + a) >>> 0;
      hash[1] = (hash[1] + b) >>> 0;
      hash[2] = (hash[2] + c) >>> 0;
      hash[3] = (hash[3] + d) >>> 0;
      hash[4] = (hash[4] + e) >>> 0;
      hash[5] = (hash[5] + f) >>> 0;
      hash[6] = (hash[6] + g) >>> 0;
      hash[7] = (hash[7] + h) >>> 0;
    }
    return [...hash].map((word) => word.toString(16).padStart(8, "0")).join("");
  }

  function normalizeName(value) {
    return Data.normalize(value);
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

  function normalizeEntry(raw) {
    if (!raw || typeof raw !== "object") return null;
    const name = safeText(raw.name, 100);
    const teamCode = Data.resolveClubCode(raw.teamCode);
    const role = safeText(raw.role, 20).toLowerCase();
    const gameweek = Number(raw.gameweek);
    if (!name || !teamCode || !ROLES.includes(role) || gameweek !== EXPECTED_GAMEWEEK) return null;
    return { name, teamCode, role, gameweek };
  }

  function entryKey(entry) {
    return `${normalizeName(entry.name)}|${entry.teamCode}|${entry.role}|${entry.gameweek}`;
  }

  function cleanEntries(rawEntries) {
    const deduplicated = new Map();
    let duplicateRows = 0;
    for (const raw of rawEntries) {
      const entry = normalizeEntry(raw);
      if (!entry) continue;
      const key = entryKey(entry);
      if (deduplicated.has(key)) duplicateRows += 1;
      else deduplicated.set(key, entry);
    }

    const identities = new Map();
    for (const entry of deduplicated.values()) {
      const key = normalizeName(entry.name);
      const identity = identities.get(key) || { names: new Set(), clubs: new Set(), roles: new Set() };
      identity.names.add(entry.name);
      identity.clubs.add(entry.teamCode);
      identity.roles.add(entry.role);
      identities.set(key, identity);
    }
    const conflictKeys = new Set([...identities.entries()]
      .filter(([, identity]) => identity.clubs.size > 1 || identity.roles.size > 1)
      .map(([key]) => key));
    const conflictNames = [...conflictKeys]
      .map((key) => [...identities.get(key).names].sort()[0])
      .sort((first, second) => first.localeCompare(second, "es"));
    const players = [...deduplicated.values()].filter((entry) => !conflictKeys.has(normalizeName(entry.name)));
    return {
      players,
      conflictNames,
      conflictRows: deduplicated.size - players.length,
      duplicateRows,
    };
  }

  function exactClubCoverage(value) {
    const clubs = Array.isArray(value)
      ? [...new Set(value.map((club) => Data.resolveClubCode(club)).filter(Boolean))].sort()
      : [];
    return clubs.length === EXPECTED_CLUBS.length
      && clubs.every((club, index) => club === EXPECTED_CLUBS[index]);
  }

  function validateCoverage(meta) {
    if (!exactClubCoverage(meta.coverageClubs)) {
      throw new Error("El CSV debe cubrir exactamente los 20 clubes Premier 2026/27");
    }
    const probableByClub = meta.probableByClub && typeof meta.probableByClub === "object"
      ? meta.probableByClub
      : {};
    if (!EXPECTED_CLUBS.every((club) => Number(probableByClub[club]) === 11)) {
      throw new Error("Cada club debe contener exactamente 11 titulares previstos para GW1");
    }
    if (Number(meta.rawProbableRows) !== EXPECTED_CLUBS.length * 11) {
      throw new Error("La cobertura de titulares previstos de GW1 no es completa");
    }
    if (Number(meta.rawAlternativeRows) < 100) {
      throw new Error("La cobertura de alternativas del CSV es insuficiente");
    }
  }

  function normalizeDataset(raw, source = {}) {
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.players)) {
      throw new Error("El dataset de alineaciones probables no contiene jugadores");
    }
    if (raw.players.length > MAX_ROWS) throw new Error(`El dataset supera el límite de ${MAX_ROWS} filas`);
    const meta = raw.meta && typeof raw.meta === "object" ? raw.meta : {};
    if (safeText(meta.season, 10) !== EXPECTED_SEASON) {
      throw new Error(`La temporada de alineaciones debe ser ${EXPECTED_SEASON}`);
    }
    if (Number(meta.gameweek) !== EXPECTED_GAMEWEEK) {
      throw new Error(`Las alineaciones deben corresponder a GW${EXPECTED_GAMEWEEK}`);
    }
    if (safeText(meta.sourceFingerprint, 100) !== SOURCE_FINGERPRINT) {
      throw new Error(`El archivo no coincide con el formato verificado de ${SOURCE_NAME}`);
    }
    if (safeText(meta.contentSha256, 64) !== VERIFIED_CONTENT_SHA256) {
      throw new Error(`El contenido no coincide con el snapshot verificado de ${SOURCE_NAME}`);
    }
    validateCoverage(meta);

    const cleaned = cleanEntries(raw.players);
    if (!cleaned.players.length) throw new Error("El dataset no contiene señales seguras");
    const storedConflicts = Array.isArray(meta.conflictNames)
      ? meta.conflictNames.map((name) => safeText(name, 100)).filter(Boolean)
      : [];
    return {
      version: SCHEMA_VERSION,
      importedAt: safeDate(source.importedAt ?? raw.importedAt) || new Date().toISOString(),
      fileModifiedAt: safeDate(source.fileModifiedAt ?? raw.fileModifiedAt),
      filename: safeText(source.filename ?? raw.filename ?? "alineaciones probables locales", 120),
      meta: {
        season: EXPECTED_SEASON,
        gameweek: EXPECTED_GAMEWEEK,
        sourceName: SOURCE_NAME,
        sourceUrl: SOURCE_URL,
        sourceFingerprint: SOURCE_FINGERPRINT,
        contentSha256: VERIFIED_CONTENT_SHA256,
        coverageClubs: EXPECTED_CLUBS.slice(),
        probableByClub: Object.fromEntries(EXPECTED_CLUBS.map((club) => [club, 11])),
        rawProbableRows: EXPECTED_CLUBS.length * 11,
        rawAlternativeRows: Number(meta.rawAlternativeRows),
        duplicateRows: Math.max(0, Number(meta.duplicateRows) || 0) + cleaned.duplicateRows,
        conflictRows: Math.max(0, Number(meta.conflictRows) || 0) + cleaned.conflictRows,
        conflictNames: [...new Set([...storedConflicts, ...cleaned.conflictNames])].sort((first, second) => first.localeCompare(second, "es")),
      },
      players: cleaned.players,
    };
  }

  function validateFingerprint(text, headers) {
    if (headers.length < 2
      || headers[0] !== "equipoojugador"
      || headers[1] !== "estatusenlineup") {
      throw new Error("El CSV debe incluir Equipo_O_Jugador y Estatus_En_Lineup");
    }
    const normalized = Data.normalize(text);
    const markers = [
      "predictedlineups",
      "pointspredictor",
      "potentialstartersposgw1minsstart",
      "categories",
      "fantasypremierleague",
    ];
    if (markers.some((marker) => !normalized.includes(marker))) {
      throw new Error(`El archivo no conserva la huella verificada de ${SOURCE_NAME}`);
    }
  }

  function parseText(value, source = {}) {
    const text = String(value ?? "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
    if (sha256(text) !== VERIFIED_CONTENT_SHA256) {
      throw new Error(`El contenido no coincide con el snapshot verificado de ${SOURCE_NAME}`);
    }
    const matrix = parseCsvMatrix(text);
    if (matrix.length < 2) throw new Error("El CSV de alineaciones no contiene datos");
    validateFingerprint(text, matrix[0].map((header) => Data.normalize(header)));

    const rows = matrix.slice(1).map((row) => safeText(row[0], 220)).filter(Boolean);
    const headings = new Map();
    const rawEntries = [];
    const probableByClub = Object.fromEntries(EXPECTED_CLUBS.map((club) => [club, 0]));
    let currentClub = null;
    let currentRole = null;

    for (const row of rows) {
      const heading = row.match(/^(.+?) PREDICTED LINEUP$/u);
      if (heading) {
        currentClub = Data.resolveClubCode(heading[1]);
        if (!currentClub || !EXPECTED_CLUBS.includes(currentClub)) {
          throw new Error(`Club no reconocido en alineaciones: ${heading[1]}`);
        }
        if (headings.has(currentClub)) throw new Error(`El club ${currentClub} aparece más de una vez`);
        headings.set(currentClub, heading[1]);
        currentRole = null;
        continue;
      }
      if (!currentClub) continue;
      if (/^PLAYER POS GW1 MINS START %$/u.test(row)) {
        currentRole = "probable";
        continue;
      }
      if (/^POTENTIAL STARTERS POS GW1 MINS START %$/u.test(row)) {
        currentRole = "alternative";
        continue;
      }
      if (!currentRole) continue;
      const player = row.match(PLAYER_ROW);
      if (!player) continue;
      const entry = {
        name: player[1],
        teamCode: currentClub,
        role: currentRole,
        gameweek: EXPECTED_GAMEWEEK,
      };
      rawEntries.push(entry);
      if (currentRole === "probable") probableByClub[currentClub] += 1;
    }

    const coverageClubs = [...headings.keys()].sort();
    const rawProbableRows = rawEntries.filter((entry) => entry.role === "probable").length;
    const rawAlternativeRows = rawEntries.filter((entry) => entry.role === "alternative").length;
    validateCoverage({ coverageClubs, probableByClub, rawProbableRows, rawAlternativeRows });
    const cleaned = cleanEntries(rawEntries);
    return normalizeDataset({
      importedAt: source.importedAt,
      fileModifiedAt: source.fileModifiedAt,
      filename: source.filename,
      meta: {
        season: EXPECTED_SEASON,
        gameweek: EXPECTED_GAMEWEEK,
        sourceFingerprint: SOURCE_FINGERPRINT,
        contentSha256: VERIFIED_CONTENT_SHA256,
        coverageClubs,
        probableByClub,
        rawProbableRows,
        rawAlternativeRows,
        duplicateRows: cleaned.duplicateRows,
        conflictRows: cleaned.conflictRows,
        conflictNames: cleaned.conflictNames,
      },
      players: cleaned.players,
    }, source);
  }

  async function parseFile(file) {
    if (!global.File || !(file instanceof global.File)) throw new Error("Selecciona un CSV de alineaciones probables");
    if (file.size <= 0) throw new Error("El CSV de alineaciones está vacío");
    if (file.size > MAX_FILE_BYTES) throw new Error("El CSV de alineaciones supera el límite local de 1 MB");
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

  function clear() {
    try {
      global.localStorage?.removeItem(STORAGE_KEY);
      return true;
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

  function datasetStatus(dataset, { gameweek = EXPECTED_GAMEWEEK, now = Date.now() } = {}) {
    if (!dataset?.players?.length) return { active: false, reason: "sin alineaciones probables" };
    if (dataset.meta?.season !== EXPECTED_SEASON) {
      return { active: false, reason: `temporada no verificada; se exige ${EXPECTED_SEASON}` };
    }
    if (Number(dataset.meta?.gameweek) !== EXPECTED_GAMEWEEK || Number(gameweek) !== EXPECTED_GAMEWEEK) {
      return { active: false, reason: `la señal solo corresponde a GW${EXPECTED_GAMEWEEK}` };
    }
    try {
      validateCoverage(dataset.meta || {});
    } catch (error) {
      return { active: false, reason: error.message };
    }
    const timestamp = new Date(dataset.fileModifiedAt || dataset.importedAt || "").getTime();
    if (!Number.isFinite(timestamp)) return { active: false, reason: "fecha del archivo no verificable" };
    const ageDays = (Number(now) - timestamp) / (24 * 60 * 60 * 1000);
    if (!Number.isFinite(ageDays) || ageDays > MAX_FILE_AGE_DAYS) {
      return { active: false, reason: `archivo con más de ${MAX_FILE_AGE_DAYS} días` };
    }
    if (ageDays < -FUTURE_TOLERANCE_DAYS) {
      return { active: false, reason: "fecha del archivo en el futuro" };
    }
    return { active: true, ageDays };
  }

  global.ProbableLineupsImport = Object.freeze({
    EXPECTED_GAMEWEEK,
    EXPECTED_SEASON,
    MAX_FILE_AGE_DAYS,
    MAX_FILE_BYTES,
    SCHEMA_VERSION,
    SNAPSHOT_DISABLED_KEY,
    SOURCE_NAME,
    SOURCE_URL,
    STORAGE_KEY,
    VERIFIED_CONTENT_SHA256,
    clear,
    datasetStatus,
    disableSnapshot,
    enableSnapshot,
    normalizeDataset,
    normalizeName,
    parseFile,
    parseText,
    read,
    save,
    snapshotEnabled,
  });
})(globalThis);
