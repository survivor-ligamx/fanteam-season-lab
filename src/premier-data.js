(function attachPremierLeagueData(global) {
  "use strict";

  const VERSION = "premier-data-v1";
  const DEFAULT_ENDPOINT = "https://fanteam-data.brandonleon480.workers.dev/";
  const ENDPOINT_KEY = "fanteam-data-endpoint";
  const CACHE_KEY = "fanteam-data-cache";
  const STATE_KEY = "fanteam-season-lab-v1";
  const SHORTLIST_KEY = "fanteam-premier-shortlist-v1";
  const MAX_GAMEWEEK = 38;

  const TEAM_NAMES = Object.freeze({
    ARS: "Arsenal",
    AVL: "Aston Villa",
    BHA: "Brighton & Hove Albion",
    BOU: "AFC Bournemouth",
    BRE: "Brentford",
    CHE: "Chelsea",
    CRY: "Crystal Palace",
    CVC: "Coventry City",
    EVE: "Everton",
    FUL: "Fulham",
    HUL: "Hull City",
    IPS: "Ipswich Town",
    LEE: "Leeds United",
    LIV: "Liverpool",
    MCI: "Manchester City",
    MUN: "Manchester United",
    NEW: "Newcastle United",
    NFO: "Nottingham Forest",
    SUN: "Sunderland",
    TOT: "Tottenham Hotspur",
  });

  const FALLBACK_MATCHES = Object.freeze([
    [1, "ARS", "CVC", 70, "21–24 ago 2026"], [1, "HUL", "MUN", -27, "21–24 ago 2026"],
    [1, "EVE", "CRY", 14, "21–24 ago 2026"], [1, "IPS", "SUN", -5, "21–24 ago 2026"],
    [1, "NFO", "LEE", 2, "21–24 ago 2026"], [1, "BRE", "TOT", -6, "21–24 ago 2026"],
    [1, "BHA", "AVL", 0, "21–24 ago 2026"], [1, "MCI", "BOU", 33, "21–24 ago 2026"],
    [1, "NEW", "LIV", -10, "21–24 ago 2026"], [1, "FUL", "CHE", -15, "21–24 ago 2026"],
    [2, "CRY", "MCI", -29, "28–31 ago 2026"], [2, "LIV", "NFO", 47, "28–31 ago 2026"],
    [2, "BOU", "EVE", 14, "28–31 ago 2026"], [2, "CVC", "HUL", -1, "28–31 ago 2026"],
    [2, "TOT", "NEW", 14, "28–31 ago 2026"], [2, "CHE", "BHA", 19, "28–31 ago 2026"],
    [2, "LEE", "BRE", 1, "28–31 ago 2026"], [2, "SUN", "FUL", 5, "28–31 ago 2026"],
    [2, "MUN", "IPS", 49, "28–31 ago 2026"], [2, "AVL", "ARS", -15, "28–31 ago 2026"],
    [3, "IPS", "LIV", -40, "4–6 sep 2026"], [3, "NEW", "BOU", 12, "4–6 sep 2026"],
    [3, "BRE", "SUN", 17, "4–6 sep 2026"], [3, "BHA", "LEE", 21, "4–6 sep 2026"],
    [3, "FUL", "CRY", 10, "4–6 sep 2026"], [3, "MCI", "CVC", 62, "4–6 sep 2026"],
    [3, "NFO", "TOT", -19, "4–6 sep 2026"], [3, "HUL", "AVL", -22, "4–6 sep 2026"],
    [3, "EVE", "MUN", -13, "4–6 sep 2026"], [3, "ARS", "CHE", 28, "4–6 sep 2026"],
    [4, "BOU", "BRE", 12, "12–14 sep 2026"], [4, "AVL", "NFO", 35, "12–14 sep 2026"],
    [4, "CHE", "HUL", 41, "12–14 sep 2026"], [4, "CRY", "IPS", 22, "12–14 sep 2026"],
    [4, "LIV", "FUL", 40, "12–14 sep 2026"], [4, "TOT", "EVE", 24, "12–14 sep 2026"],
    [4, "SUN", "ARS", -38, "12–14 sep 2026"], [4, "CVC", "BHA", -23, "12–14 sep 2026"],
    [4, "MUN", "MCI", -2, "12–14 sep 2026"], [4, "LEE", "NEW", -7, "12–14 sep 2026"],
    [5, "BRE", "CHE", -9, "18–20 sep 2026"], [5, "TOT", "AVL", 8, "18–20 sep 2026"],
    [5, "BHA", "ARS", -23, "18–20 sep 2026"], [5, "EVE", "IPS", 28, "18–20 sep 2026"],
    [5, "LEE", "CRY", 9, "18–20 sep 2026"], [5, "MCI", "SUN", 46, "18–20 sep 2026"],
    [5, "NEW", "HUL", 32, "18–20 sep 2026"], [5, "NFO", "CVC", 20, "18–20 sep 2026"],
    [5, "BOU", "LIV", -14, "18–20 sep 2026"], [5, "FUL", "MUN", -17, "18–20 sep 2026"],
    [6, "ARS", "LEE", 52, "10 oct 2026"], [6, "AVL", "BRE", 22, "10 oct 2026"],
    [6, "CHE", "BOU", 21, "10 oct 2026"], [6, "CVC", "NEW", -25, "10 oct 2026"],
    [6, "CRY", "NFO", 13, "10 oct 2026"], [6, "HUL", "EVE", -6, "10 oct 2026"],
    [6, "IPS", "FUL", -8, "10 oct 2026"], [6, "LIV", "MCI", 5, "10 oct 2026"],
    [6, "MUN", "TOT", 13, "10 oct 2026"], [6, "SUN", "BHA", -7, "10 oct 2026"],
  ]);

  const FALLBACK_PLAYERS = Object.freeze([
    [4700623, "David Raya", "ARS", "GK", 6, 88, 80],
    [4700651, "Gianluigi Donnarumma", "MCI", "GK", 6, 88, 80],
    [4700698, "Alisson", "LIV", "GK", 5.5, 88, 80],
    [4700743, "Robert Sánchez", "CHE", "GK", 5, 88, 80],
    [4700782, "Guglielmo Vicario", "TOT", "GK", 5, 32, 30],
    [4700812, "Emiliano Martínez", "AVL", "GK", 5, 68, 62],
    [4700620, "Gabriel", "ARS", "DEF", 6.5, 88, 80],
    [4700622, "William Saliba", "ARS", "DEF", 6, 32, 30],
    [4700657, "Josko Gvardiol", "MCI", "DEF", 6, 88, 80],
    [4700687, "Virgil van Dijk", "LIV", "DEF", 6, 88, 80],
    [4700691, "Jeremie Frimpong", "LIV", "DEF", 5.5, 88, 80],
    [4700716, "Diogo Dalot", "MUN", "DEF", 5.5, 88, 80],
    [4700734, "Reece James", "CHE", "DEF", 5.5, 32, 30],
    [4700796, "Pedro Porro", "TOT", "DEF", 5.5, 88, 80],
    [4700637, "Bukayo Saka", "ARS", "MID", 10, 32, 30],
    [4700633, "Eberechi Eze", "ARS", "MID", 7.5, 88, 80],
    [4700645, "Phil Foden", "MCI", "MID", 8.5, 88, 80],
    [4700669, "Rayan Cherki", "MCI", "MID", 8, 32, 30],
    [4700675, "Antoine Semenyo", "MCI", "MID", 9.5, 88, 80],
    [4700683, "Florian Wirtz", "LIV", "MID", 8, 88, 80],
    [4700724, "Bruno Fernandes", "MUN", "MID", 10.5, 88, 80],
    [4700727, "Bryan Mbeumo", "MUN", "MID", 9, 88, 80],
    [4700753, "Cole Palmer", "CHE", "MID", 8.5, 88, 80],
    [4700785, "James Maddison", "TOT", "MID", 6, 88, 80],
    [4700870, "Kaoru Mitoma", "BHA", "MID", 5.5, 32, 30],
    [4700643, "Viktor Gyökeres", "ARS", "FWD", 9, 88, 80],
    [4700673, "Erling Haaland", "MCI", "FWD", 12.5, 88, 80],
    [4700702, "Alexander Isak", "LIV", "FWD", 9, 88, 80],
    [4700730, "Matheus Cunha", "MUN", "FWD", 8.5, 88, 80],
    [4700762, "João Pedro", "CHE", "FWD", 9, 88, 80],
    [4700834, "Ollie Watkins", "AVL", "FWD", 8.5, 88, 80],
  ].map(([id, name, club, pos, price, confidence, minutes]) => Object.freeze({
    id, name, surname: name.split(" ").pop(), club, clubName: TEAM_NAMES[club],
    pos, price, confidence, minutes,
  })));

  let catalogPromise = null;

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function finite(value) {
    if (value == null || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function normalize(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }

  const CLUB_ALIASES = Object.freeze(Object.fromEntries(
    Object.entries(TEAM_NAMES).flatMap(([code, name]) => {
      const values = [[normalize(code), code], [normalize(name), code]];
      if (code === "BOU") values.push(["bournemouth", code]);
      if (code === "BHA") values.push(["brighton", code]);
      if (code === "MCI") values.push(["mancity", code]);
      if (code === "MUN") values.push(["manutd", code], ["manunited", code]);
      if (code === "NEW") values.push(["newcastle", code]);
      if (code === "NFO") values.push(["forest", code], ["nottmforest", code]);
      if (code === "TOT") values.push(["spurs", code], ["tottenham", code]);
      return values;
    }),
  ));

  function resolveClubCode(value) {
    const raw = value && typeof value === "object"
      ? value.code || value.club || value.name || ""
      : value;
    const normalized = normalize(raw);
    if (!normalized) return null;
    if (CLUB_ALIASES[normalized]) return CLUB_ALIASES[normalized];
    const matches = Object.entries(CLUB_ALIASES)
      .filter(([alias]) => normalized.includes(alias) || alias.includes(normalized))
      .map(([, code]) => code);
    return new Set(matches).size === 1 ? matches[0] : null;
  }

  function difficulty(advantage) {
    const value = finite(advantage) || 0;
    return value >= 15 ? "Fácil" : value <= -15 ? "Difícil" : "Medio";
  }

  function fallbackFixtures() {
    const fixtures = {};
    for (const [gw, home, away, homeAdv, date] of FALLBACK_MATCHES) {
      const bucket = fixtures[String(gw)] || (fixtures[String(gw)] = {});
      bucket[home] = {
        opp: away, oppName: TEAM_NAMES[away], home: true,
        diff: difficulty(homeAdv), adv: homeAdv, date,
      };
      bucket[away] = {
        opp: home, oppName: TEAM_NAMES[home], home: false,
        diff: difficulty(-homeAdv), adv: -homeAdv, date,
      };
    }
    return fixtures;
  }

  function readStorage(key) {
    try {
      return global.localStorage?.getItem(key) || null;
    } catch (_) {
      return null;
    }
  }

  function writeStorage(key, value) {
    try {
      global.localStorage?.setItem(key, value);
      return true;
    } catch (_) {
      return false;
    }
  }

  function parseJSON(value) {
    try {
      return JSON.parse(value);
    } catch (_) {
      return null;
    }
  }

  function parseEmbeddedCatalog(source) {
    if (typeof source !== "string" || source.length < 1000) {
      throw new Error("El documento principal no contiene un catálogo legible.");
    }
    const playersMarker = "const PLAYERS=";
    const fixturesMarker = ";const FIXTURES=";
    const initialMarker = ";const INITIAL=";
    const playersStart = source.indexOf(playersMarker);
    const fixturesStart = source.indexOf(fixturesMarker, playersStart + playersMarker.length);
    const initialStart = source.indexOf(initialMarker, fixturesStart + fixturesMarker.length);
    if (playersStart < 0 || fixturesStart < 0 || initialStart < 0) {
      throw new Error("No se encontraron los límites seguros del catálogo.");
    }
    const players = JSON.parse(source.slice(
      playersStart + playersMarker.length,
      fixturesStart,
    ));
    const fixtures = JSON.parse(source.slice(
      fixturesStart + fixturesMarker.length,
      initialStart,
    ));
    if (!Array.isArray(players) || players.length < 20 || !fixtures || typeof fixtures !== "object") {
      throw new Error("El catálogo compartido tiene una forma inválida.");
    }
    return { players, fixtures };
  }

  async function fetchWithTimeout(url, options = {}, timeoutMs = 6000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async function loadCatalog({ force = false } = {}) {
    if (force) catalogPromise = null;
    if (catalogPromise) return catalogPromise;
    catalogPromise = (async () => {
      try {
        if (global.location?.protocol === "file:") throw new Error("modo archivo local");
        const url = new URL("index.html", document.baseURI);
        const response = await fetchWithTimeout(url, {
          cache: force ? "reload" : "default",
          credentials: "same-origin",
        }, 5000);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const parsed = parseEmbeddedCatalog(await response.text());
        return { ...parsed, source: "catalog", error: null };
      } catch (error) {
        return {
          players: FALLBACK_PLAYERS.map((player) => ({ ...player })),
          fixtures: fallbackFixtures(),
          source: "fallback",
          error: error?.message || "catálogo no disponible",
        };
      }
    })();
    return catalogPromise;
  }

  function cachedPayload() {
    const payload = parseJSON(readStorage(CACHE_KEY));
    return payload && typeof payload === "object" ? payload : null;
  }

  function endpoint() {
    const configured = String(readStorage(ENDPOINT_KEY) || "").trim();
    return configured || DEFAULT_ENDPOINT;
  }

  async function loadRemotePayload({ force = false } = {}) {
    const cached = cachedPayload();
    try {
      const url = new URL(endpoint(), document.baseURI);
      if (url.protocol !== "https:" && url.protocol !== "http:") {
        throw new Error("El endpoint debe usar HTTP o HTTPS.");
      }
      const response = await fetchWithTimeout(url, {
        cache: force ? "reload" : "no-cache",
        credentials: "omit",
        headers: { Accept: "application/json" },
      }, 6000);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      if (!payload || typeof payload !== "object") throw new Error("respuesta vacía");
      writeStorage(CACHE_KEY, JSON.stringify(payload));
      return { payload, source: "live", error: null };
    } catch (error) {
      if (cached) return { payload: cached, source: "cache", error: error?.message || "sin conexión" };
      return { payload: null, source: "base", error: error?.message || "sin conexión" };
    }
  }

  function readSeason() {
    const state = parseJSON(readStorage(STATE_KEY));
    return state && typeof state === "object" ? state : null;
  }

  function mergePlayers(catalogPlayers, payload, season) {
    const players = (Array.isArray(catalogPlayers) ? catalogPlayers : []).map((player) => ({
      ...player,
      basePrice: finite(player.basePrice) ?? finite(player.price) ?? 0,
      price: finite(player.price) ?? 0,
      priceSource: "base",
      reference: player.reference && typeof player.reference === "object"
        ? { ...player.reference }
        : null,
    }));
    const byId = new Map(players.map((player) => [Number(player.id), player]));
    const byIdentity = new Map();
    for (const player of players) {
      const key = `${normalize(player.name)}|${player.club}`;
      if (!byIdentity.has(key)) byIdentity.set(key, []);
      byIdentity.get(key).push(player);
    }

    const priceMap = season?.playerPrices && typeof season.playerPrices === "object"
      ? season.playerPrices
      : {};
    const squad = new Set(Array.isArray(season?.squad) ? season.squad.map(Number) : []);
    for (const player of players) {
      const priceState = priceMap[player.id];
      const price = finite(priceState?.price);
      const purchase = finite(priceState?.purchasePrice);
      if (price != null && price >= 2.5 && price <= 30) {
        player.price = price;
        player.priceSource = season?.priceUpdatedAt ? "imported" : "saved";
      }
      player.purchasePrice = purchase;
      player.inSquad = squad.has(Number(player.id));
    }

    for (const update of Array.isArray(payload?.players) ? payload.players : []) {
      if (!update || typeof update !== "object") continue;
      let player = byId.get(Number(update.id));
      if (!player) {
        const club = resolveClubCode(update.club);
        const matches = byIdentity.get(`${normalize(update.name)}|${club}`) || [];
        if (matches.length === 1) player = matches[0];
      }
      if (!player) continue;
      const confidence = finite(update.confidence);
      const minutes = finite(update.minutes);
      if (confidence != null) player.confidence = clamp(Math.round(confidence), 0, 100);
      if (minutes != null) player.minutes = clamp(Math.round(minutes), 0, 120);
      if (typeof update.status === "string" && update.status.trim()) {
        player.status = update.status.trim().slice(0, 120);
      }
      if (update.reference && typeof update.reference === "object") {
        player.reference = { ...(player.reference || {}), ...update.reference };
      }
    }
    return players;
  }

  function detectedGameweek(payload, season) {
    const remote = Number(payload?.currentGW);
    const saved = Number(season?.gw);
    const candidates = [remote, saved].filter((value) => (
      Number.isInteger(value) && value >= 1 && value <= MAX_GAMEWEEK
    ));
    return candidates.length ? Math.max(...candidates) : 1;
  }

  async function loadWorkspaceData({ force = false } = {}) {
    const [catalog, remote] = await Promise.all([
      loadCatalog({ force }),
      loadRemotePayload({ force }),
    ]);
    const season = readSeason();
    const payload = remote.payload;
    return Object.freeze({
      players: mergePlayers(catalog.players, payload, season),
      fixtures: catalog.fixtures,
      teamNames: TEAM_NAMES,
      results: Array.isArray(payload?.results) ? payload.results : [],
      liveFixtures: Array.isArray(payload?.liveFixtures) ? payload.liveFixtures : [],
      odds: Array.isArray(payload?.odds) ? payload.odds : [],
      news: Array.isArray(payload?.news) ? payload.news : [],
      currentGW: detectedGameweek(payload, season),
      updatedAt: payload?.updatedAt || null,
      freshUntil: payload?.freshUntil || null,
      sources: payload?.sources || null,
      sourceMeta: payload?.sourceMeta || null,
      catalogSource: catalog.source,
      catalogError: catalog.error,
      remoteSource: remote.source,
      remoteError: remote.error,
      season,
    });
  }

  function readShortlist() {
    const parsed = parseJSON(readStorage(SHORTLIST_KEY));
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))]
      .slice(0, 40);
  }

  function saveShortlist(ids) {
    const safe = [...new Set((Array.isArray(ids) ? ids : [])
      .map(Number)
      .filter((id) => Number.isSafeInteger(id) && id > 0))]
      .slice(0, 40);
    writeStorage(SHORTLIST_KEY, JSON.stringify(safe));
    return safe;
  }

  function fixtureFor(fixtures, club, gameweek) {
    return fixtures?.[String(gameweek)]?.[club] || null;
  }

  function scheduleFor(fixtures, club, gameweek, count = 6) {
    const rows = [];
    const start = clamp(Math.round(Number(gameweek) || 1), 1, MAX_GAMEWEEK);
    for (let gw = start; gw <= MAX_GAMEWEEK && rows.length < count; gw += 1) {
      const fixture = fixtureFor(fixtures, club, gw);
      if (fixture) rows.push({ gw, ...fixture });
    }
    return rows;
  }

  function availableGameweeks(fixtures) {
    return Object.keys(fixtures || {})
      .map(Number)
      .filter((gameweek) => Number.isInteger(gameweek) && gameweek >= 1 && gameweek <= MAX_GAMEWEEK)
      .sort((first, second) => first - second);
  }

  function formatFreshness(value) {
    const timestamp = new Date(value || "").getTime();
    if (!Number.isFinite(timestamp)) return "Sin sincronizar";
    const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
    if (minutes < 1) return "Ahora";
    if (minutes < 60) return `Hace ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `Hace ${hours} h`;
    return `Hace ${Math.floor(hours / 24)} d`;
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
    })[character]);
  }

  global.PremierLeagueData = Object.freeze({
    VERSION,
    MAX_GAMEWEEK,
    TEAM_NAMES,
    DEFAULT_ENDPOINT,
    SHORTLIST_KEY,
    availableGameweeks,
    clamp,
    escapeHTML,
    finite,
    fixtureFor,
    formatFreshness,
    loadCatalog,
    loadRemotePayload,
    loadWorkspaceData,
    normalize,
    readShortlist,
    resolveClubCode,
    saveShortlist,
    scheduleFor,
  });
})(globalThis);
