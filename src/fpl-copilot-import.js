(function attachFplCopilotImport(global) {
  "use strict";

  const Data = global.PremierLeagueData;
  if (!Data) throw new Error("PremierLeagueData debe cargarse antes del importador de FPL Copilot");

  const STORAGE_KEY = "fanteam-fpl-copilot-import-v1";
  const SCHEMA_VERSION = 1;
  const MAX_FILE_BYTES = 4 * 1024 * 1024;
  const MAX_PLAYERS = 1000;
  const MAX_GAMEWEEK = 38;

  function finite(value) {
    if (value == null || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function bounded(value, minimum, maximum) {
    const number = finite(value);
    return number == null ? null : Math.max(minimum, Math.min(maximum, number));
  }

  function positiveInteger(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  }

  function safeText(value, maximum = 120) {
    return String(value ?? "").trim().slice(0, maximum);
  }

  function safeDate(value) {
    if (!value) return null;
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
  }

  function normalizePosition(value) {
    const normalized = Data.normalize(value);
    return {
      "1": "GK",
      gk: "GK",
      gkp: "GK",
      goalkeeper: "GK",
      portero: "GK",
      "2": "DEF",
      d: "DEF",
      def: "DEF",
      defender: "DEF",
      defensa: "DEF",
      "3": "MID",
      m: "MID",
      mid: "MID",
      midfielder: "MID",
      medio: "MID",
      "4": "FWD",
      f: "FWD",
      fwd: "FWD",
      forward: "FWD",
      delantero: "FWD",
    }[normalized] || null;
  }

  function normalizeGameweek(raw, fallbackGameweek = null) {
    if (raw == null) return null;
    const source = typeof raw === "object" ? raw : { points: raw };
    const gameweek = positiveInteger(
      source.gw ?? source.gameweek ?? source.event ?? fallbackGameweek,
    );
    if (gameweek == null || gameweek > MAX_GAMEWEEK) return null;
    const points = bounded(
      source.points ?? source.xpts ?? source.expected_points ?? source.expectedPoints,
      -50,
      100,
    );
    if (points == null) return null;
    return {
      gw: gameweek,
      points,
      minutes: bounded(source.minutes ?? source.expected_minutes ?? source.expectedMinutes, 0, 180),
      basePoints: bounded(source.base_points ?? source.basePoints, -50, 100),
      baseMinutes: bounded(source.base_minutes ?? source.baseMinutes, 0, 180),
    };
  }

  function gameweekRows(source) {
    if (Array.isArray(source)) {
      return source.map((row, index) => normalizeGameweek(row, index + 1)).filter(Boolean);
    }
    if (!source || typeof source !== "object") return [];
    return Object.entries(source)
      .map(([gameweek, row]) => normalizeGameweek(row, gameweek))
      .filter(Boolean);
  }

  function normalizePlayer(raw) {
    if (!raw || typeof raw !== "object") return null;
    const id = positiveInteger(
      raw.fpl_id ?? raw.fplId ?? raw.element ?? raw.element_id ?? raw.elementId
        ?? raw.id ?? raw.player_id ?? raw.playerId,
    );
    const aliases = [...new Set([
      raw.name,
      [raw.first_name ?? raw.firstName, raw.second_name ?? raw.secondName].filter(Boolean).join(" "),
      raw.web_name,
      raw.webName,
      raw.player,
      ...(Array.isArray(raw.aliases) ? raw.aliases : []),
    ].map((value) => safeText(value, 100)).filter(Boolean))];
    const name = aliases[0] || "";
    const namedTeam = safeText(raw.team_name ?? raw.teamName ?? raw.club_name ?? raw.clubName, 80);
    const genericTeam = safeText(raw.team ?? raw.club, 80);
    const team = namedTeam || genericTeam;
    const position = normalizePosition(raw.position ?? raw.pos ?? raw.element_type ?? raw.elementType);
    if (!name || !team || !position) return null;

    const hasLongProjection = positiveInteger(raw.gw ?? raw.gameweek ?? raw.event) != null
      && finite(raw.points ?? raw.xpts ?? raw.expected_points ?? raw.expectedPoints) != null;
    const gameweeks = hasLongProjection
      ? gameweekRows([raw])
      : gameweekRows(raw.gameweeks ?? raw.expected_points ?? raw.expectedPoints ?? raw.projections);
    if (!gameweeks.length) return null;
    const uniqueGameweeks = new Map();
    for (const row of gameweeks) uniqueGameweeks.set(row.gw, row);

    let price = bounded(raw.price ?? raw.now_cost ?? raw.nowCost, 0, 300);
    if (price != null && price > 30) price /= 10;
    const teamCode = Data.resolveClubCode(raw.teamCode || namedTeam || genericTeam)
      || safeText(raw.teamCode || namedTeam || genericTeam, 12).toUpperCase();
    const fplCode = safeText(raw.fpl_code ?? raw.fplCode ?? raw.code, 40) || null;

    return {
      id,
      name,
      aliases,
      position,
      team,
      teamCode,
      price,
      fplCode,
      gameweeks: [...uniqueGameweeks.values()].sort((first, second) => first.gw - second.gw),
    };
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

  function pick(record, ...aliases) {
    for (const alias of aliases) {
      const value = record[Data.normalize(alias)];
      if (value != null && value !== "") return value;
    }
    return null;
  }

  function gameweeksFromCsvCell(value) {
    if (Array.isArray(value)) return value;
    const text = String(value ?? "").trim();
    if (!text) return [];

    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      // Some local exports serialize a list of numeric objects with Python-style
      // single quotes. Parse only the supported numeric projection fields; never eval.
    }

    const numericField = (source, names) => {
      for (const name of names) {
        const match = source.match(new RegExp(
          `(?:["']?${name}["']?\\s*:\\s*)(-?(?:\\d+\\.?\\d*|\\.\\d+))`,
          "i",
        ));
        if (match) return finite(match[1]);
      }
      return null;
    };

    const rows = [];
    for (const source of text.match(/\{[^{}]*\}/g) || []) {
      const gw = numericField(source, ["gw", "gameweek", "event"]);
      const points = numericField(source, ["points", "xpts", "expected_points", "expectedPoints"]);
      if (gw == null || points == null) continue;
      rows.push({
        gw,
        points,
        minutes: numericField(source, ["minutes", "expected_minutes", "expectedMinutes"]),
        base_points: numericField(source, ["base_points", "basePoints"]),
        base_minutes: numericField(source, ["base_minutes", "baseMinutes"]),
      });
    }
    return rows;
  }

  function parseCsv(text) {
    const matrix = parseCsvMatrix(text.replace(/^\uFEFF/, ""));
    if (matrix.length < 2) throw new Error("El CSV no contiene filas de datos");
    const headers = matrix[0].map((header) => Data.normalize(header));
    const grouped = new Map();

    for (const values of matrix.slice(1)) {
      const record = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
      const id = positiveInteger(pick(record, "fpl_id", "element", "element_id", "id", "player_id"));
      const fullName = safeText(pick(record, "name", "player"), 100);
      const webName = safeText(pick(record, "web_name"), 100);
      const name = fullName || webName;
      const namedTeam = safeText(pick(record, "team_name", "club_name"), 80);
      const genericTeam = safeText(pick(record, "team", "club"), 80);
      const team = namedTeam || genericTeam;
      if (!name || !team) continue;
      const key = id != null ? `id:${id}` : `identity:${Data.normalize(name)}|${Data.normalize(team)}`;
      let player = grouped.get(key);
      if (!player) {
        player = {
          id,
          name,
          aliases: [fullName, webName].filter(Boolean),
          team,
          position: pick(record, "position", "pos", "element_type"),
          price: pick(record, "price", "now_cost"),
          fpl_code: pick(record, "fpl_code", "code"),
          gameweeks: [],
        };
        grouped.set(key, player);
      }

      const gameweek = positiveInteger(pick(record, "gw", "gameweek", "event"));
      if (gameweek != null) {
        player.gameweeks.push({
          gw: gameweek,
          points: pick(record, "points", "xpts", "expected_points", "projected_points"),
          minutes: pick(record, "minutes", "expected_minutes"),
          base_points: pick(record, "base_points"),
          base_minutes: pick(record, "base_minutes"),
        });
        continue;
      }

      const serializedGameweeks = gameweeksFromCsvCell(pick(record, "gameweeks"));
      if (serializedGameweeks.length) {
        player.gameweeks.push(...serializedGameweeks);
        continue;
      }

      for (let gw = 1; gw <= MAX_GAMEWEEK; gw += 1) {
        const points = pick(
          record,
          `gw${gw}`,
          `gw${gw}_points`,
          `points_gw${gw}`,
          `points${gw}`,
          `xpts_gw${gw}`,
          `xpts${gw}`,
          `gameweek${gw}`,
        );
        if (finite(points) != null) player.gameweeks.push({ gw, points });
      }
    }
    return { players: [...grouped.values()] };
  }

  function findPlayers(raw) {
    if (Array.isArray(raw)) return raw;
    if (!raw || typeof raw !== "object") return null;
    const containers = [raw, raw.data].filter((value) => value && typeof value === "object");
    for (const container of containers) {
      for (const key of ["players", "expected_points", "expectedPoints", "rows", "data"]) {
        if (Array.isArray(container[key])) return container[key];
      }
    }
    return null;
  }

  function normalizePayload(raw, source = {}) {
    const rows = findPlayers(raw);
    if (!rows) throw new Error("No se encontró una lista de jugadores en el archivo");
    if (rows.length > MAX_PLAYERS) throw new Error(`El archivo supera el límite de ${MAX_PLAYERS} jugadores`);

    const players = rows.map(normalizePlayer).filter(Boolean);
    if (!players.length) {
      throw new Error("No hay jugadores válidos con nombre, equipo, posición y puntos por jornada");
    }
    const deduplicated = new Map();
    for (const player of players) {
      const key = player.id != null
        ? `id:${player.id}`
        : `identity:${Data.normalize(player.name)}|${Data.normalize(player.teamCode)}`;
      const existing = deduplicated.get(key);
      if (!existing) {
        deduplicated.set(key, player);
        continue;
      }
      const mergedGameweeks = new Map(existing.gameweeks.map((row) => [row.gw, row]));
      for (const row of player.gameweeks) mergedGameweeks.set(row.gw, row);
      existing.gameweeks = [...mergedGameweeks.values()].sort((first, second) => first.gw - second.gw);
      existing.aliases = [...new Set([...(existing.aliases || []), ...(player.aliases || [])])];
    }

    const root = raw && !Array.isArray(raw) && typeof raw === "object" ? raw : {};
    const meta = root.meta && typeof root.meta === "object"
      ? root.meta
      : root.metadata && typeof root.metadata === "object" ? root.metadata : {};
    return {
      version: SCHEMA_VERSION,
      importedAt: safeDate(source.importedAt ?? root.importedAt) || new Date().toISOString(),
      sourceUpdatedAt: safeDate(
        source.sourceUpdatedAt
          ?? root.sourceUpdatedAt
          ?? root.last_updated
          ?? root.lastUpdated
          ?? meta.last_updated
          ?? meta.lastUpdated,
      ),
      fileModifiedAt: safeDate(source.fileModifiedAt ?? root.fileModifiedAt),
      filename: safeText(source.filename ?? root.filename ?? "importación local", 120),
      meta: {
        nextGw: positiveInteger(meta.next_gw ?? meta.nextGw ?? root.next_gw ?? root.nextGw),
        stalenessWarning: Boolean(meta.staleness_warning ?? meta.stalenessWarning),
        stalenessHours: bounded(meta.staleness_hours ?? meta.stalenessHours, 0, 10000),
      },
      players: [...deduplicated.values()],
    };
  }

  async function parseFile(file) {
    if (!(file instanceof File)) throw new Error("Selecciona un archivo JSON o CSV");
    if (file.size <= 0) throw new Error("El archivo está vacío");
    if (file.size > MAX_FILE_BYTES) throw new Error("El archivo supera el límite local de 4 MB");
    const text = await file.text();
    let payload;
    const looksCsv = /\.csv$/i.test(file.name) || /text\/csv/i.test(file.type);
    try {
      payload = looksCsv ? parseCsv(text) : JSON.parse(text.replace(/^\uFEFF/, ""));
    } catch (error) {
      throw new Error(`No se pudo leer ${looksCsv ? "el CSV" : "el JSON"}: ${error.message}`);
    }
    return normalizePayload(payload, {
      filename: file.name,
      fileModifiedAt: file.lastModified ? new Date(file.lastModified).toISOString() : null,
    });
  }

  function read() {
    try {
      const raw = global.localStorage?.getItem(STORAGE_KEY);
      return raw ? normalizePayload(JSON.parse(raw)) : null;
    } catch (_) {
      return null;
    }
  }

  function save(dataset) {
    try {
      global.localStorage?.setItem(STORAGE_KEY, JSON.stringify(dataset));
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

  function pointsAt(player, gameweek) {
    const row = player?.gameweeks?.find((candidate) => candidate.gw === Number(gameweek));
    return row ? finite(row.points) : null;
  }

  function rangeTotal(player, startGameweek, count) {
    const start = positiveInteger(startGameweek);
    const expected = start == null
      ? 0
      : Math.max(0, Math.min(count, MAX_GAMEWEEK - start + 1));
    const points = [];
    for (let offset = 0; offset < expected; offset += 1) {
      const value = pointsAt(player, start + offset);
      if (value != null) points.push(value);
    }
    return {
      total: expected > 0 && points.length === expected
        ? points.reduce((sum, value) => sum + value, 0)
        : null,
      available: points.length,
      expected,
    };
  }

  function metric(player, gameweek) {
    const gw = pointsAt(player, gameweek);
    const price = finite(player?.price);
    const range3 = rangeTotal(player, gameweek, 3);
    const range6 = rangeTotal(player, gameweek, 6);
    return {
      gw,
      h3: range3.total,
      h6: range6.total,
      h3Coverage: `${range3.available}/${range3.expected}`,
      h6Coverage: `${range6.available}/${range6.expected}`,
      value: price > 0 && range6.total != null ? range6.total / price : null,
    };
  }

  global.FplCopilotImport = Object.freeze({
    MAX_FILE_BYTES,
    SCHEMA_VERSION,
    STORAGE_KEY,
    clear,
    metric,
    parseFile,
    pointsAt,
    read,
    save,
  });
})(globalThis);
