(function startPremierPlayerLab() {
  "use strict";

  const Data = globalThis.PremierLeagueData;
  const Projection = globalThis.FanTeamProjection;
  const Copilot = globalThis.FplCopilotImport;
  const Draft = globalThis.DraftFantasyImport;
  const Probable = globalThis.ProbableLineupsImport;
  const Consensus = globalThis.PremierConsensus;
  const MonteCarlo = globalThis.PremierMonteCarlo;
  if (!Data || !Projection || !Copilot || !Draft || !Probable || !Consensus || !MonteCarlo) {
    throw new Error("Las dependencias de Player Lab no están disponibles");
  }

  const ALTERNATIVE_LINEUP_PENALTY = MonteCarlo.ALTERNATIVE_LINEUP_PENALTY;
  const PublicSignals = globalThis.FanTeamPlayerLabSignals || null;
  const storedCopilot = Copilot.read();
  const storedDraft = Draft.read();
  const storedProbable = Probable.read();

  const $ = (selector) => document.querySelector(selector);
  const esc = Data.escapeHTML;
  const state = {
    workspace: null,
    players: [],
    byId: new Map(),
    model: null,
    consensus: null,
    gameweek: 1,
    selected: [],
    shortlist: Data.readShortlist(),
    copilot: storedCopilot,
    copilotSource: storedCopilot ? "browser" : null,
    copilotByPlayerId: new Map(),
    playerByCopilot: new Map(),
    copilotMatchMethod: new Map(),
    draft: storedDraft,
    draftSource: storedDraft ? "browser" : null,
    draftByPlayerId: new Map(),
    playerByDraft: new Map(),
    draftMatchMethod: new Map(),
    draftUnmatchedRows: [],
    draftAmbiguousRows: [],
    probable: storedProbable,
    probableSource: storedProbable ? "browser" : null,
    probableByPlayerId: new Map(),
    playerByProbable: new Map(),
    probableMatchMethod: new Map(),
    probableUnmatchedRows: [],
    probableAmbiguousRows: [],
  };
  let monteCarloRequest = 0;
  let activeMonteCarloJob = null;
  let probableExpiryTimer = null;

  function localSnapshotAllowed() {
    return location.protocol === "file:"
      || ["localhost", "127.0.0.1", "::1"].includes(location.hostname);
  }

  function loadLocalCopilotSource() {
    if (!localSnapshotAllowed() || !Copilot.snapshotEnabled() || globalThis.FplCopilotLocalCsv) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = ".local-data/fpl-copilot-local.js";
      script.async = true;
      script.addEventListener("load", resolve, { once: true });
      script.addEventListener("error", resolve, { once: true });
      document.head.appendChild(script);
    });
  }

  async function loadLocalCopilotSnapshot() {
    if (state.copilot || !Copilot.snapshotEnabled()) return false;
    await loadLocalCopilotSource();
    const source = globalThis.FplCopilotLocalCsv;
    if (!source || typeof source.text !== "string" || !source.text.trim()) return false;
    const filename = String(source.filename || "tabla_fpl_completa.csv").slice(0, 120);
    const lastModified = Number(source.lastModified);
    const file = new File([source.text], filename, {
      type: "text/csv",
      lastModified: Number.isFinite(lastModified) ? Math.trunc(lastModified) : Date.now(),
    });
    state.copilot = await Copilot.parseFile(file);
    state.copilotSource = "local";
    return true;
  }

  function loadLocalDraftSource() {
    if (!localSnapshotAllowed() || !Draft.snapshotEnabled() || globalThis.DraftFantasyLocalCsv) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = ".local-data/draft-fantasy-local.js";
      script.async = true;
      script.addEventListener("load", resolve, { once: true });
      script.addEventListener("error", resolve, { once: true });
      document.head.appendChild(script);
    });
  }

  async function loadLocalDraftSnapshot() {
    if (state.draft || !Draft.snapshotEnabled()) return false;
    await loadLocalDraftSource();
    const source = globalThis.DraftFantasyLocalCsv;
    if (!source || typeof source.text !== "string" || !source.text.trim()) return false;
    const filename = String(source.filename || "tabla_draftfantasy_proyecciones.csv").slice(0, 120);
    const lastModified = Number(source.lastModified);
    const file = new File([source.text], filename, {
      type: "text/csv",
      lastModified: Number.isFinite(lastModified) ? Math.trunc(lastModified) : Date.now(),
    });
    state.draft = await Draft.parseFile(file);
    state.draftSource = "local";
    return true;
  }

  function loadLocalProbableSource() {
    if (!localSnapshotAllowed() || !Probable.snapshotEnabled() || globalThis.ProbableLineupsLocalCsv) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = ".local-data/probable-lineups-local.js";
      script.async = true;
      script.addEventListener("load", resolve, { once: true });
      script.addEventListener("error", resolve, { once: true });
      document.head.appendChild(script);
    });
  }

  async function loadLocalProbableSnapshot() {
    if (state.probable || !Probable.snapshotEnabled()) return false;
    await loadLocalProbableSource();
    const source = globalThis.ProbableLineupsLocalCsv;
    if (!source || typeof source.text !== "string" || !source.text.trim()) return false;
    const filename = String(source.filename || "tabla_alineaciones_probables.csv").slice(0, 120);
    const lastModified = Number(source.lastModified);
    const file = new File([source.text], filename, {
      type: "text/csv",
      lastModified: Number.isFinite(lastModified) ? Math.trunc(lastModified) : Date.now(),
    });
    state.probable = await Probable.parseFile(file);
    state.probableSource = "local";
    return true;
  }

  function loadPublicCopilotSnapshot() {
    if (state.copilot || !Copilot.snapshotEnabled() || !PublicSignals?.copilot) return false;
    state.copilot = Copilot.normalizePayload(PublicSignals.copilot);
    state.copilotSource = "public";
    return true;
  }

  function loadPublicDraftSnapshot() {
    if (state.draft || !Draft.snapshotEnabled() || !PublicSignals?.draft) return false;
    state.draft = Draft.normalizeDataset(PublicSignals.draft);
    state.draftSource = "public";
    return true;
  }

  function loadPublicProbableSnapshot() {
    if (state.probable || !Probable.snapshotEnabled() || !PublicSignals?.probable) return false;
    state.probable = Probable.normalizeDataset(PublicSignals.probable);
    state.probableSource = "public";
    return true;
  }

  async function safeSnapshotLoad(label, loader) {
    try {
      return await loader();
    } catch (error) {
      console.warn(`No se pudo cargar el snapshot ${label}`, error);
      return false;
    }
  }

  async function loadSignalSnapshots() {
    const localLoaded = await Promise.all([
      safeSnapshotLoad("local de Copilot", loadLocalCopilotSnapshot),
      safeSnapshotLoad("local de Draft", loadLocalDraftSnapshot),
      safeSnapshotLoad("local de alineaciones", loadLocalProbableSnapshot),
    ]);
    const publicLoaded = await Promise.all([
      safeSnapshotLoad("público de Copilot", loadPublicCopilotSnapshot),
      safeSnapshotLoad("público de Draft", loadPublicDraftSnapshot),
      safeSnapshotLoad("público de alineaciones", loadPublicProbableSnapshot),
    ]);
    return localLoaded.map((loaded, index) => loaded || publicLoaded[index]);
  }

  function toast(message) {
    const element = $("#toast");
    element.textContent = message;
    element.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => element.classList.remove("show"), 2100);
  }

  function fixture(player, gameweek) {
    return Data.fixtureFor(state.workspace.fixtures, player.club, gameweek);
  }

  function createProjectionModel() {
    state.model = Projection.create({
      fixture,
      byId: (id) => state.byId.get(Number(id)) || null,
      getOdds: () => state.workspace?.odds || [],
      differentialEligible: () => true,
      lineupPenalty: (player, gameweek) => (
        probableForPlayer(player, gameweek)?.role === "alternative"
          ? ALTERNATIVE_LINEUP_PENALTY
          : 0
      ),
    });
  }

  function metric(player) {
    const gw = state.model.projection(player, state.gameweek);
    const h3 = state.model.horizon(player, state.gameweek);
    const h6 = state.model.horizon6(player, state.gameweek);
    return {
      gw,
      h3,
      h6,
      value: player.price > 0 ? h6 / player.price : 0,
      confidence: Number(player.confidence) || 0,
      price: Number(player.price) || 0,
    };
  }

  function finiteLabel(value, suffix = "", digits = 1) {
    const number = Data.finite(value);
    return number == null ? "—" : `${number.toFixed(digits)}${suffix}`;
  }

  function compactNumber(value) {
    const number = Data.finite(value);
    if (number == null) return "—";
    const absolute = Math.abs(number);
    if (absolute >= 1000000) return `${(number / 1000000).toFixed(1)}M`;
    if (absolute >= 1000) return `${(number / 1000).toFixed(1)}k`;
    return Math.round(number).toLocaleString("es-MX");
  }

  function signedNumber(value) {
    const number = Data.finite(value);
    if (number == null) return "—";
    return `${number > 0 ? "+" : ""}${compactNumber(number)}`;
  }

  function formatDateTime(value) {
    const timestamp = new Date(value || "").getTime();
    if (!Number.isFinite(timestamp)) return null;
    return new Intl.DateTimeFormat("es-ES", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(timestamp);
  }

  function signalSourceLabel(source) {
    return {
      browser: "importación guardada en este navegador",
      local: "snapshot local de desarrollo",
      public: "datos precargados en la web",
    }[source] || "origen no indicado";
  }

  function playerIdentity(name, club) {
    const clubCode = Data.resolveClubCode(club) || String(club || "").toUpperCase();
    return `${Data.normalize(name)}|${clubCode}`;
  }

  function ownNameAliases(player) {
    const reference = player.reference || {};
    return [...new Set([
      player.name,
      player.surname,
      String(player.name || "").trim().split(/\s+/).pop(),
      reference.name,
      reference.webName,
      reference.web_name,
    ].map((value) => String(value || "").trim()).filter(Boolean))];
  }

  function nameTokens(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  }

  function abbreviationTokenMatches(first, second) {
    return first === second
      || (first.length === 1 && second.startsWith(first))
      || (second.length === 1 && first.startsWith(second));
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
    return abbreviationTokenMatches(first[0], second[0])
      && abbreviationTokenMatches(first[first.length - 1], second[second.length - 1]);
  }

  function abbreviatedAliasesMatch(player, row) {
    const ownAliases = ownNameAliases(player);
    const importedAliases = [...new Set([row.name, ...(row.aliases || [])])];
    return ownAliases.some((ownAlias) => importedAliases.some((importedAlias) => (
      abbreviatedNameMatches(ownAlias, importedAlias)
    )));
  }

  function addUnique(map, key, value) {
    if (key == null || key === "") return;
    if (map.get(key) === value) return;
    if (map.has(key)) map.set(key, null);
    else map.set(key, value);
  }

  function referencedFplIds(player) {
    const reference = player.reference || {};
    const values = [
      player.fplId, player.fpl_id, player.elementId, player.element_id, player.element,
      reference.fplId, reference.fpl_id, reference.elementId, reference.element_id,
      reference.element, reference.id,
    ];
    if (Number(player.id) > 0 && Number(player.id) <= 10000) values.push(player.id);
    return [...new Set(values.map(Number).filter((value) => Number.isSafeInteger(value) && value > 0))];
  }

  function referencedFplCodes(player) {
    const reference = player.reference || {};
    return [...new Set([
      player.fplCode, player.fpl_code, player.code,
      reference.fplCode, reference.fpl_code, reference.code,
    ].map((value) => String(value ?? "").trim()).filter(Boolean))];
  }

  function rebuildCopilotMatches() {
    state.copilotByPlayerId = new Map();
    state.playerByCopilot = new Map();
    state.copilotMatchMethod = new Map();
    const rows = state.copilot?.players || [];
    if (!rows.length || !state.players.length) return;

    const byId = new Map();
    const byCode = new Map();
    const byIdentity = new Map();
    const ownIdentityCounts = new Map();
    for (const player of state.players) {
      const keys = new Set(ownNameAliases(player).map((alias) => playerIdentity(alias, player.club)));
      for (const key of keys) ownIdentityCounts.set(key, (ownIdentityCounts.get(key) || 0) + 1);
    }
    for (const row of rows) {
      addUnique(byId, row.id, row);
      addUnique(byCode, row.fplCode, row);
      const aliases = [...new Set([row.name, ...(row.aliases || [])])];
      for (const alias of aliases) {
        addUnique(byIdentity, playerIdentity(alias, row.teamCode || row.team), row);
      }
    }

    const claimed = new Set();
    for (const player of state.players) {
      let match = null;
      let method = null;
      for (const id of referencedFplIds(player)) {
        if (byId.get(id)) {
          match = byId.get(id);
          method = "FPL ID";
          break;
        }
      }
      if (!match) {
        for (const code of referencedFplCodes(player)) {
          if (byCode.get(code)) {
            match = byCode.get(code);
            method = "FPL code";
            break;
          }
        }
      }
      if (!match) {
        for (const alias of ownNameAliases(player)) {
          const identity = playerIdentity(alias, player.club);
          if (ownIdentityCounts.get(identity) === 1 && byIdentity.get(identity)) {
            match = byIdentity.get(identity);
            method = alias === player.name ? "nombre + club" : "alias único + club";
            break;
          }
        }
      }
      if (!match || claimed.has(match)) continue;
      claimed.add(match);
      state.copilotByPlayerId.set(Number(player.id), match);
      state.playerByCopilot.set(match, player);
      state.copilotMatchMethod.set(Number(player.id), method);
    }

    const unmatchedPlayers = state.players.filter((player) => (
      !state.copilotByPlayerId.has(Number(player.id))
    ));
    const unclaimedRows = rows.filter((row) => !claimed.has(row));
    const abbreviationCandidates = unclaimedRows.map((row) => {
      const club = Data.resolveClubCode(row.teamCode || row.team)
        || String(row.teamCode || row.team || "").toUpperCase();
      return {
        row,
        players: unmatchedPlayers.filter((player) => (
          player.club === club && abbreviatedAliasesMatch(player, row)
        )),
      };
    });
    for (const candidate of abbreviationCandidates) {
      if (candidate.players.length !== 1) continue;
      const [player] = candidate.players;
      const competingRows = abbreviationCandidates.filter((other) => (
        other.players.some((otherPlayer) => Number(otherPlayer.id) === Number(player.id))
      ));
      if (competingRows.length !== 1) continue;
      claimed.add(candidate.row);
      state.copilotByPlayerId.set(Number(player.id), candidate.row);
      state.playerByCopilot.set(candidate.row, player);
      state.copilotMatchMethod.set(Number(player.id), "abreviatura única + club");
    }
  }

  function copilotForPlayer(player) {
    return state.copilotByPlayerId.get(Number(player?.id)) || null;
  }

  function rebuildDraftMatches() {
    const result = Draft.matchPlayers(state.players, state.draft?.players || []);
    state.draftByPlayerId = result.byPlayerId;
    state.playerByDraft = result.playerByProjection;
    state.draftMatchMethod = result.matchMethod;
    state.draftUnmatchedRows = result.unmatchedRows;
    state.draftAmbiguousRows = result.ambiguous;
  }

  function draftForPlayer(player) {
    const status = Draft.datasetStatus(state.draft, { gameweek: Consensus.GAMEWEEK });
    return status.active ? state.draftByPlayerId.get(Number(player?.id)) || null : null;
  }

  function rebuildProbableMatches() {
    const result = Draft.matchPlayers(state.players, state.probable?.players || []);
    state.probableByPlayerId = result.byPlayerId;
    state.playerByProbable = result.playerByProjection;
    state.probableMatchMethod = result.matchMethod;
    state.probableUnmatchedRows = result.unmatchedRows;
    state.probableAmbiguousRows = result.ambiguous;
  }

  function probableForPlayer(player, gameweek = Probable.EXPECTED_GAMEWEEK) {
    const status = Probable.datasetStatus(state.probable, { gameweek });
    return status.active ? state.probableByPlayerId.get(Number(player?.id)) || null : null;
  }

  function probableRoleLabel(role) {
    return role === "probable"
      ? "XI probable · no confirmado"
      : role === "alternative" ? "alternativa · no confirmado" : null;
  }

  function scheduleProbableExpiry() {
    if (probableExpiryTimer) clearTimeout(probableExpiryTimer);
    probableExpiryTimer = null;
    const status = Probable.datasetStatus(state.probable, { gameweek: Probable.EXPECTED_GAMEWEEK });
    if (!status.active) return;
    const modifiedAt = new Date(state.probable?.fileModifiedAt || state.probable?.importedAt || "").getTime();
    if (!Number.isFinite(modifiedAt)) return;
    const expiresAt = modifiedAt + Probable.MAX_FILE_AGE_DAYS * 24 * 60 * 60 * 1000;
    const delay = expiresAt - Date.now() + 1000;
    if (delay <= 0) return;
    probableExpiryTimer = setTimeout(() => {
      probableExpiryTimer = null;
      rebuildConsensus();
      renderAll();
    }, Math.min(delay, 0x7fffffff));
  }

  function cancelMonteCarloJob() {
    monteCarloRequest += 1;
    const job = activeMonteCarloJob;
    activeMonteCarloJob = null;
    if (job?.timer) clearTimeout(job.timer);
    try { job?.worker?.terminate(); } catch (_) { /* El Worker ya terminó. */ }
  }

  function monteCarloFallback(consensus, error, payload = null) {
    consensus.monteCarlo = {
      status: "fallback",
      scenarioCount: payload?.scenarioCount || MonteCarlo.DEFAULT_SCENARIOS,
      candidateCount: 0,
      error: error?.message || "Monte Carlo no disponible",
    };
  }

  function startMonteCarlo(consensus) {
    if (!consensus?.squad) return;
    const request = monteCarloRequest;
    let payload;
    try {
      payload = MonteCarlo.createPayload(consensus);
      consensus.monteCarlo = {
        status: "running",
        scenarioCount: payload.scenarioCount,
        candidateCount: payload.candidateLimit,
      };
    } catch (error) {
      monteCarloFallback(consensus, error);
      return;
    }
    if (typeof globalThis.Worker !== "function") {
      monteCarloFallback(consensus, new Error("Worker no disponible"), payload);
      return;
    }

    try {
      const worker = new Worker(
        new URL("src/premier-monte-carlo-worker.js", document.baseURI),
        { name: "premier-consensus-monte-carlo" },
      );
      const job = { worker, request, consensus, payload, timer: null };
      activeMonteCarloJob = job;
      const finish = () => {
        if (activeMonteCarloJob === job) activeMonteCarloJob = null;
        if (job.timer) clearTimeout(job.timer);
        try { worker.terminate(); } catch (_) { /* El Worker ya terminó. */ }
      };
      const fail = (error) => {
        if (activeMonteCarloJob !== job) return;
        finish();
        if (request !== monteCarloRequest || state.consensus !== consensus) return;
        monteCarloFallback(consensus, error, payload);
        renderConsensusSquad();
      };
      worker.onmessage = (event) => {
        if (activeMonteCarloJob !== job) return;
        const message = event.data || {};
        if (message.type === "error") {
          fail(new Error(message.message || "falló Monte Carlo"));
          return;
        }
        if (message.type !== "result") return;
        try {
          const validated = MonteCarlo.validateResult(message, payload);
          finish();
          if (request !== monteCarloRequest || state.consensus !== consensus) return;
          consensus.squad = validated.squad;
          consensus.monteCarlo = validated.monteCarlo;
          renderConsensusSquad();
        } catch (error) {
          fail(error);
        }
      };
      worker.onerror = (event) => {
        event.preventDefault?.();
        fail(new Error("falló el Worker Monte Carlo"));
      };
      job.timer = setTimeout(() => {
        fail(new Error("Monte Carlo excedió el límite de 30 segundos"));
      }, 30000);
      try {
        worker.postMessage(payload);
      } catch (error) {
        fail(error);
      }
    } catch (error) {
      monteCarloFallback(consensus, error, payload);
    }
  }

  function rebuildConsensus() {
    cancelMonteCarloJob();
    scheduleProbableExpiry();
    if (!state.model || !state.workspace) {
      state.consensus = null;
      return;
    }
    try {
      const engine = Consensus.create({
        players: state.players,
        projection: (player, gameweek) => state.model.projection(player, gameweek),
        copilotForPlayer,
        copilotPointsAt: Copilot.pointsAt,
        draftForPlayer,
        draftPointsAt: Draft.pointsAt,
        fixture,
        getOdds: () => state.workspace.odds || [],
      });
      state.consensus = engine.build({
        gameweek: Consensus.GAMEWEEK,
        budget: Consensus.BUDGET,
      });
      for (const row of state.consensus.rows || []) {
        row.probableLineupRole = probableForPlayer(row.player, state.consensus.gameweek)?.role || null;
      }
      startMonteCarlo(state.consensus);
    } catch (error) {
      state.consensus = {
        budget: Consensus.BUDGET,
        gameweek: Consensus.GAMEWEEK,
        rows: [],
        rowById: new Map(),
        squad: null,
        warnings: [error?.message || "No se pudo calcular el consenso"],
      };
    }
  }

  function renderCopilotStatus() {
    const status = $("#copilotStatus");
    const meta = $("#copilotMeta");
    const clearButton = $("#copilotClear");
    const sourceCard = status.closest(".copilot-source-card");
    const rows = state.copilot?.players || [];
    clearButton.disabled = !rows.length;
    clearButton.textContent = state.copilotSource === "browser"
      ? "Borrar Copilot importado"
      : "Ocultar Copilot precargado";
    sourceCard.classList.remove("warning");
    if (!rows.length) {
      status.textContent = Copilot.snapshotEnabled()
        ? "Sin datos de Copilot"
        : "Copilot precargado desactivado";
      meta.textContent = "Puedes reactivarlo importando un archivo autorizado.";
      return;
    }
    const sourceDate = formatDateTime(state.copilot.sourceUpdatedAt);
    const loadedDate = formatDateTime(state.copilot.importedAt);
    const warnings = [];
    if (state.copilot.meta?.stalenessWarning) {
      const hours = Data.finite(state.copilot.meta.stalenessHours);
      warnings.push(`origen marcado como desactualizado${hours == null ? "" : ` (${hours.toFixed(1)} h)`}`);
    }
    const nextGw = Data.finite(state.copilot.meta?.nextGw);
    if (Number.isInteger(nextGw) && nextGw >= 1 && nextGw <= Data.MAX_GAMEWEEK && nextGw !== state.gameweek) {
      warnings.push(`archivo preparado para GW${nextGw}; vista actual GW${state.gameweek}`);
    }
    sourceCard.classList.toggle("warning", warnings.length > 0);
    status.textContent = `${rows.length} jugadores · ${state.copilotByPlayerId.size} vinculados con FanTeam`;
    meta.textContent = [
      signalSourceLabel(state.copilotSource),
      state.copilot.filename,
      sourceDate ? `fuente actualizada ${sourceDate}` : "fecha de fuente no indicada",
      loadedDate ? `snapshot ${loadedDate}` : null,
      ...warnings,
    ].filter(Boolean).join(" · ");
  }

  function renderDraftStatus() {
    const status = $("#draftStatus");
    const meta = $("#draftMeta");
    const clearButton = $("#draftClear");
    const sourceCard = status.closest(".copilot-source-card");
    const rows = state.draft?.players || [];
    clearButton.disabled = !rows.length;
    clearButton.textContent = state.draftSource === "browser"
      ? "Borrar Draft importado"
      : "Ocultar Draft precargado";
    sourceCard.classList.remove("warning");
    if (!rows.length) {
      status.textContent = Draft.snapshotEnabled()
        ? "Sin proyecciones Draft"
        : "Draft precargado desactivado";
      meta.textContent = "Draft no modifica precio, posición ni scoring FanTeam.";
      return;
    }
    const modifiedDate = formatDateTime(state.draft.fileModifiedAt);
    const linked = state.draftByPlayerId.size;
    const coverage = rows.length ? linked / rows.length : 0;
    const usability = Draft.datasetStatus(state.draft, { gameweek: Consensus.GAMEWEEK });
    const warnings = [];
    if (state.draftAmbiguousRows.length) warnings.push(`${state.draftAmbiguousRows.length} ambiguas excluidas`);
    if (linked < 20) warnings.push("muestra vinculada insuficiente");
    if (coverage < 0.8) warnings.push(`cobertura baja (${Math.round(coverage * 100)}%)`);
    if (!usability.active) warnings.push(`señal inactiva: ${usability.reason}`);
    sourceCard.classList.toggle("warning", warnings.length > 0);
    status.textContent = `${rows.length} proyecciones · ${linked} vinculadas con FanTeam${usability.active ? "" : " · inactiva"}`;
    meta.textContent = [
      signalSourceLabel(state.draftSource),
      state.draft.filename,
      modifiedDate ? `archivo modificado ${modifiedDate}` : null,
      `${state.draftUnmatchedRows.length} sin match`,
      state.draft.meta?.duplicateRows ? `${state.draft.meta.duplicateRows} duplicadas deduplicadas` : null,
      ...warnings,
    ].filter(Boolean).join(" · ");
  }

  function renderProbableStatus() {
    const status = $("#probableStatus");
    const meta = $("#probableMeta");
    const clearButton = $("#probableClear");
    const sourceCard = status.closest(".copilot-source-card");
    const rows = state.probable?.players || [];
    clearButton.disabled = !rows.length;
    clearButton.textContent = state.probableSource === "browser"
      ? "Borrar alineaciones importadas"
      : "Ocultar alineaciones precargadas";
    sourceCard.classList.remove("warning");
    if (!rows.length) {
      status.textContent = Probable.snapshotEnabled()
        ? "Sin alineaciones probables"
        : "Alineaciones precargadas desactivadas";
      meta.textContent = "Probable no significa confirmado y no aporta puntos, precio ni posición.";
      return;
    }
    const modifiedDate = formatDateTime(state.probable.fileModifiedAt);
    const usability = Probable.datasetStatus(state.probable, { gameweek: Probable.EXPECTED_GAMEWEEK });
    const linked = state.probableByPlayerId.size;
    const coverage = rows.length ? linked / rows.length : 0;
    const probableRows = rows.filter((row) => row.role === "probable").length;
    const alternativeRows = rows.filter((row) => row.role === "alternative").length;
    const rawProbableRows = Number(state.probable.meta?.rawProbableRows) || probableRows;
    const warnings = [];
    if (state.probableAmbiguousRows.length) warnings.push(`${state.probableAmbiguousRows.length} ambiguas excluidas`);
    if (coverage < 0.8) warnings.push(`cobertura vinculada baja (${Math.round(coverage * 100)}%)`);
    if (!usability.active) warnings.push(`señal inactiva: ${usability.reason}`);
    sourceCard.classList.toggle("warning", warnings.length > 0);
    status.textContent = `GW1 · ${rawProbableRows} titulares previstos en 20 clubes · ${linked}/${rows.length} señales vinculadas${usability.active ? "" : " · inactiva"}`;
    meta.textContent = [
      "probable, no confirmado",
      signalSourceLabel(state.probableSource),
      state.probable.filename,
      modifiedDate ? `archivo modificado ${modifiedDate}` : null,
      `${probableRows} probables seguros + ${alternativeRows} alternativas seguras`,
      `${state.probableUnmatchedRows.length} sin match`,
      state.probable.meta?.conflictNames?.length
        ? `${state.probable.meta.conflictNames.length} identidades conflictivas excluidas: ${state.probable.meta.conflictNames.join(", ")}`
        : null,
      ...warnings,
    ].filter(Boolean).join(" · ");
  }

  async function importCopilotFile(file) {
    const button = $("#copilotImport");
    button.disabled = true;
    button.textContent = "Validando…";
    try {
      const dataset = await Copilot.parseFile(file);
      state.copilot = dataset;
      state.copilotSource = "browser";
      Copilot.enableSnapshot();
      const persisted = Copilot.save(dataset);
      if (state.workspace) populateGameweeks();
      rebuildCopilotMatches();
      rebuildConsensus();
      renderAll();
      toast(persisted
        ? `${dataset.players.length} jugadores de Copilot guardados en este navegador`
        : `${dataset.players.length} jugadores cargados solo para esta sesión`);
    } catch (error) {
      toast(error?.message || "No se pudo importar el archivo");
    } finally {
      $("#copilotFile").value = "";
      button.disabled = false;
      button.textContent = "Importar JSON/CSV autorizado";
      button.focus();
    }
  }

  function clearCopilotImport() {
    const rows = state.copilot?.players || [];
    if (!rows.length) return;
    if (!globalThis.confirm("¿Borrar u ocultar los datos de FPL Copilot en este navegador?")) return;
    if (!Copilot.clear() || !Copilot.disableSnapshot()) {
      toast("No se pudo desactivar Copilot; revisa los permisos de almacenamiento");
      return;
    }
    state.copilot = null;
    state.copilotSource = null;
    if (state.workspace) populateGameweeks();
    rebuildCopilotMatches();
    rebuildConsensus();
    renderAll();
    toast("Copilot eliminado y datos precargados desactivados en este navegador");
  }

  async function importDraftFile(file) {
    const button = $("#draftImport");
    button.disabled = true;
    button.textContent = "Validando…";
    try {
      const dataset = await Draft.parseFile(file);
      state.draft = dataset;
      state.draftSource = "browser";
      Draft.enableSnapshot();
      const persisted = Draft.save(dataset);
      if (state.workspace) populateGameweeks();
      rebuildDraftMatches();
      rebuildConsensus();
      renderAll();
      toast(persisted
        ? `${dataset.players.length} proyecciones Draft guardadas en este navegador`
        : `${dataset.players.length} proyecciones Draft cargadas solo para esta sesión`);
    } catch (error) {
      toast(error?.message || "No se pudo importar el CSV Draft");
    } finally {
      $("#draftFile").value = "";
      button.disabled = false;
      button.textContent = "Importar CSV Draft";
      button.focus();
    }
  }

  function clearDraftImport() {
    const rows = state.draft?.players || [];
    if (!rows.length) return;
    if (!globalThis.confirm("¿Borrar u ocultar las proyecciones Draft en este navegador?")) return;
    if (!Draft.clear() || !Draft.disableSnapshot()) {
      toast("No se pudo desactivar Draft; revisa los permisos de almacenamiento");
      return;
    }
    state.draft = null;
    state.draftSource = null;
    if (state.workspace) populateGameweeks();
    rebuildDraftMatches();
    rebuildConsensus();
    renderAll();
    toast("Draft eliminado y datos precargados desactivados en este navegador");
  }

  async function importProbableFile(file) {
    const button = $("#probableImport");
    button.disabled = true;
    button.textContent = "Validando…";
    try {
      const dataset = await Probable.parseFile(file);
      state.probable = dataset;
      state.probableSource = "browser";
      Probable.enableSnapshot();
      const persisted = Probable.save(dataset);
      rebuildProbableMatches();
      rebuildConsensus();
      renderAll();
      toast(persisted
        ? `${dataset.players.length} señales de alineación guardadas en este navegador`
        : `${dataset.players.length} señales de alineación cargadas solo para esta sesión`);
    } catch (error) {
      toast(error?.message || "No se pudo importar el CSV de alineaciones");
    } finally {
      $("#probableFile").value = "";
      button.disabled = false;
      button.textContent = "Importar alineaciones";
      button.focus();
    }
  }

  function clearProbableImport() {
    const rows = state.probable?.players || [];
    if (!rows.length) return;
    if (!globalThis.confirm("¿Borrar u ocultar las alineaciones probables en este navegador?")) return;
    if (!Probable.clear() || !Probable.disableSnapshot()) {
      toast("No se pudo desactivar el archivo de alineaciones; revisa los permisos de almacenamiento");
      return;
    }
    state.probable = null;
    state.probableSource = null;
    rebuildProbableMatches();
    rebuildConsensus();
    renderAll();
    toast("Alineaciones eliminadas y datos precargados desactivados en este navegador");
  }

  function priceSource(player) {
    return {
      imported: "precio FanTeam importado",
      saved: "precio guardado",
      base: "precio base incorporado",
    }[player.priceSource] || "precio base incorporado";
  }

  function fixtureClass(fixtureRow) {
    return fixtureRow.diff === "Fácil" ? "easy" : fixtureRow.diff === "Difícil" ? "hard" : "medium";
  }

  function playerSchedule(player) {
    return Data.scheduleFor(state.workspace.fixtures, player.club, state.gameweek, 6);
  }

  function renderSchedule(player) {
    const schedule = playerSchedule(player);
    return schedule.map((row) => `<div class="player-fixture ${fixtureClass(row)}" title="GW${row.gw} · ${esc(row.oppName || row.opp)} · ${row.home ? "local" : "visita"} · ${esc(row.diff || "Medio")}">GW${row.gw}<br>${esc(row.opp)}</div>`).join("")
      || '<div class="pl-note">Sin partidos</div>';
  }

  function netTransfers(player) {
    const incoming = Data.finite(player.reference?.transfersInEvent);
    const outgoing = Data.finite(player.reference?.transfersOutEvent);
    return incoming == null || outgoing == null ? null : incoming - outgoing;
  }

  function compareCard(player) {
    const current = metric(player);
    const reference = player.reference || {};
    const selectedBy = finiteLabel(reference.selectedBy, "%", 1);
    const ppg = finiteLabel(reference.pointsPerGame, "", 1);
    const xg90 = finiteLabel(reference.xg90, "", 2);
    const inShortlist = state.shortlist.includes(player.id);
    const transferLabel = signedNumber(netTransfers(player));
    const expectedMinutes = Data.finite(player.minutes);
    const copilot = copilotForPlayer(player);
    const copilotProjection = copilot ? Copilot.metric(copilot, state.gameweek) : null;
    const draft = draftForPlayer(player);
    const draftPoints = draft ? Draft.pointsAt(draft, state.gameweek) : null;
    const draftMethod = draft ? state.draftMatchMethod.get(Number(player.id)) : null;
    const probableLineup = probableForPlayer(player, state.gameweek);
    const probableLabel = probableRoleLabel(probableLineup?.role);
    const copilotCells = copilotProjection ? `
        <div class="player-metric"><span>Copilot GW · FPL</span><strong>${finiteLabel(copilotProjection.gw, "", 2)}</strong></div>
        <div class="player-metric"><span>Copilot 6GW · suma</span><strong title="Cobertura ${esc(copilotProjection.h6Coverage)}">${finiteLabel(copilotProjection.h6, "", 2)}</strong></div>` : "";
    const draftCells = draftPoints == null ? "" : `
        <div class="player-metric"><span>Draft GW · xP</span><strong title="Vínculo ${esc(draftMethod || "seguro")}; señal externa normalizada">${finiteLabel(draftPoints, "", 2)}</strong></div>`;
    const playerStatus = player.status
      ? player.status
      : `Minutos esperados: ${expectedMinutes == null ? "—" : Math.round(expectedMinutes)} · balance FPL: ${transferLabel}`;
    const status = esc([playerStatus, probableLabel].filter(Boolean).join(" · "));
    return `<article class="pl-card compare-card" data-player-card="${player.id}">
      <div class="player-head">
        <span class="club-badge club-${esc(player.club)}" aria-hidden="true">${esc(player.club)}</span>
        <div class="player-name"><strong title="${esc(player.name)}">${esc(player.name)}</strong><span>${esc(player.pos)} · ${player.price.toFixed(1)}M · ${esc(priceSource(player))}</span></div>
        <button class="icon-button" type="button" data-remove="${player.id}" aria-label="Quitar a ${esc(player.name)}">×</button>
      </div>
      <div class="player-metrics">
        <div class="player-metric"><span>Precio</span><strong>${player.price.toFixed(1)}M</strong></div>
        <div class="player-metric"><span>Proy. GW</span><strong>${current.gw.toFixed(2)}</strong></div>
        <div class="player-metric"><span>3GW</span><strong>${current.h3.toFixed(2)}</strong></div>
        <div class="player-metric"><span>6GW FT · ponderado</span><strong>${current.h6.toFixed(2)}</strong></div>
        <div class="player-metric"><span>Valor 6GW/M</span><strong>${current.value.toFixed(2)}</strong></div>
        <div class="player-metric"><span>Confianza</span><strong>${Math.round(current.confidence)}%</strong></div>
        <div class="player-metric"><span>PPG FPL</span><strong>${ppg}</strong></div>
        <div class="player-metric"><span>xG/90</span><strong>${xg90}</strong></div>
        <div class="player-metric"><span>Selec. FPL</span><strong>${selectedBy}</strong></div>
        ${copilotCells}
        ${draftCells}
      </div>
      <div class="player-schedule">${renderSchedule(player)}</div>
      <div class="player-status">${status}</div>
      <div class="player-footer">
        <button class="pl-button compact" type="button" data-shortlist="${player.id}">${inShortlist ? "Quitar shortlist" : "Guardar shortlist"}</button>
        <a class="pl-button compact" href="premier-radar.html?club=${esc(player.club)}&gw=${state.gameweek}">Radar ${esc(player.club)}</a>
      </div>
    </article>`;
  }

  function renderComparison() {
    const selectedPlayers = state.selected.map((id) => state.byId.get(id)).filter(Boolean);
    $("#sideCompareCount").textContent = `${selectedPlayers.length} / 4`;
    $("#sideLabGw").textContent = `Desde GW${state.gameweek}`;
    $("#compareHint").textContent = selectedPlayers.length < 2
      ? "Añade al menos dos jugadores para una comparación útil."
      : `${selectedPlayers.length} jugadores · proyección desde GW${state.gameweek}`;
    $("#compareGrid").innerHTML = selectedPlayers.length
      ? selectedPlayers.map(compareCard).join("")
      : '<div class="pl-card empty-state"><strong>Comparación vacía</strong>Busca candidatos o recupéralos desde tu shortlist.</div>';
  }

  function filteredPlayers() {
    const query = Data.normalize($("#labSearch").value);
    const position = $("#labPosition").value;
    const maxPrice = Number($("#labMaxPrice").value) || 30;
    const sort = $("#labSort").value;
    const rows = state.players.filter((player) => {
      const identity = Data.normalize(`${player.name} ${player.club} ${player.clubName || state.workspace.teamNames[player.club] || ""}`);
      return (!query || identity.includes(query))
        && (!position || player.pos === position)
        && player.price <= maxPrice;
    });
    rows.sort((first, second) => {
      const a = metric(first);
      const b = metric(second);
      const difference = sort === "value" ? b.value - a.value
        : sort === "gw" ? b.gw - a.gw
          : sort === "confidence" ? b.confidence - a.confidence
            : sort === "price" ? b.price - a.price
              : b.h6 - a.h6;
      return difference || first.name.localeCompare(second.name, "es");
    });
    return rows;
  }

  function projectionWindow() {
    const rows = [];
    for (let gameweek = state.gameweek; gameweek <= Data.MAX_GAMEWEEK && rows.length < 6; gameweek += 1) {
      rows.push(gameweek);
    }
    return rows;
  }

  function tableHead({ copilot = false } = {}) {
    const gameweeks = projectionWindow();
    const horizonLabel = copilot ? "6GW suma" : "6GW pond.";
    return `<tr><th scope="col">Jugador</th><th scope="col">Pos. FT</th><th scope="col">Precio FT</th>${gameweeks.map((gameweek) => `<th scope="col">GW${gameweek}</th>`).join("")}<th scope="col">${horizonLabel}</th></tr>`;
  }

  function tablePlayer(player, displayName = player.name, detail = `${player.club} · añadir al comparador`) {
    const disabled = state.selected.includes(Number(player.id)) || state.selected.length >= 4;
    return `<button class="model-player-button" type="button" data-add="${player.id}" ${disabled ? "disabled" : ""}><strong title="${esc(displayName)}">${esc(displayName)}</strong><small>${esc(detail)}</small></button>`;
  }

  function ownModelRow(player, gameweeks) {
    const current = metric(player);
    return `<tr>
      <td>${tablePlayer(player)}</td>
      <td>${esc(player.pos)}</td>
      <td title="Precio FanTeam usado por el constructor">${player.price.toFixed(1)}M FT</td>
      ${gameweeks.map((gameweek) => `<td>${state.model.projection(player, gameweek).toFixed(2)}</td>`).join("")}
      <td><strong>${current.h6.toFixed(2)}</strong></td>
    </tr>`;
  }

  function sharedCopilotRows() {
    const query = Data.normalize($("#labSearch").value);
    const position = $("#labPosition").value;
    const maxPrice = Number($("#labMaxPrice").value) || 30;
    const sort = $("#labSort").value;
    const rows = (state.copilot?.players || []).filter((row) => {
      const ownPlayer = state.playerByCopilot.get(row);
      const identity = Data.normalize(`${row.name} ${row.team} ${row.teamCode || ""} ${ownPlayer?.name || ""} ${ownPlayer?.club || ""}`);
      const fanteamPrice = Data.finite(ownPlayer?.price);
      const fanteamPosition = ownPlayer?.pos || null;
      const matchesPrice = maxPrice >= 30 || (fanteamPrice != null && fanteamPrice <= maxPrice);
      return (!query || identity.includes(query))
        && (!position || fanteamPosition === position)
        && matchesPrice;
    });
    rows.sort((first, second) => {
      const firstMetric = Copilot.metric(first, state.gameweek);
      const secondMetric = Copilot.metric(second, state.gameweek);
      const firstOwn = state.playerByCopilot.get(first);
      const secondOwn = state.playerByCopilot.get(second);
      const firstPrice = Data.finite(firstOwn?.price);
      const secondPrice = Data.finite(secondOwn?.price);
      const firstH6 = Data.finite(firstMetric.h6);
      const secondH6 = Data.finite(secondMetric.h6);
      const firstValue = firstPrice > 0 && firstH6 != null ? firstH6 / firstPrice : null;
      const secondValue = secondPrice > 0 && secondH6 != null ? secondH6 / secondPrice : null;
      const a = sort === "value" ? firstValue
        : sort === "gw" ? firstMetric.gw
          : sort === "confidence" ? Number(firstOwn?.confidence)
            : sort === "price" ? firstPrice
              : firstMetric.h6;
      const b = sort === "value" ? secondValue
        : sort === "gw" ? secondMetric.gw
          : sort === "confidence" ? Number(secondOwn?.confidence)
            : sort === "price" ? secondPrice
              : secondMetric.h6;
      const difference = (Number.isFinite(b) ? b : -Infinity) - (Number.isFinite(a) ? a : -Infinity);
      return difference || first.name.localeCompare(second.name, "es");
    });
    return rows;
  }

  function copilotModelRow(row, gameweeks) {
    const copilotMetric = Copilot.metric(row, state.gameweek);
    const ownPlayer = state.playerByCopilot.get(row);
    const method = ownPlayer ? state.copilotMatchMethod.get(Number(ownPlayer.id)) : null;
    const playerCell = ownPlayer
      ? tablePlayer(ownPlayer, row.name, `${row.teamCode || row.team} · vínculo ${method}`)
      : `<span class="model-player-static"><strong title="${esc(row.name)}">${esc(row.name)}</strong><small>${esc(row.teamCode || row.team)} · sin vínculo FanTeam</small></span>`;
    const fanteamPrice = Data.finite(ownPlayer?.price);
    const fanteamPosition = ownPlayer?.pos || null;
    const positionTitle = !ownPlayer
      ? `Sin vínculo FanTeam; posición Copilot ${row.position}`
      : ownPlayer.pos !== row.position
        ? `Posición FanTeam ${ownPlayer.pos}; Copilot lo clasifica ${row.position}`
        : "Posición FanTeam";
    return `<tr>
      <td>${playerCell}</td>
      <td title="${esc(positionTitle)}">${fanteamPosition ? esc(fanteamPosition) : "—"}</td>
      <td title="${ownPlayer ? "Precio FanTeam" : "Sin vínculo FanTeam"}">${fanteamPrice == null ? "—" : `${fanteamPrice.toFixed(1)}M FT`}</td>
      ${gameweeks.map((gameweek) => `<td>${finiteLabel(Copilot.pointsAt(row, gameweek), "", 2)}</td>`).join("")}
      <td><strong title="Cobertura ${esc(copilotMetric.h6Coverage)}">${finiteLabel(copilotMetric.h6, "", 2)}</strong></td>
    </tr>`;
  }

  function sharedConsensusRows() {
    const query = Data.normalize($("#labSearch").value);
    const position = $("#labPosition").value;
    const maxPrice = Number($("#labMaxPrice").value) || 30;
    const sort = $("#labSort").value;
    const rows = (state.consensus?.rows || []).filter((row) => {
      const player = row.player;
      const identity = Data.normalize(`${player.name} ${player.club} ${player.clubName || ""}`);
      return (!query || identity.includes(query))
        && (!position || player.pos === position)
        && player.price <= maxPrice;
    });
    rows.sort((first, second) => {
      const difference = sort === "value" ? second.score / second.price - first.score / first.price
        : sort === "confidence" ? second.player.confidence - first.player.confidence
          : sort === "price" ? second.price - first.price
            : second.score - first.score;
      return difference || first.player.name.localeCompare(second.player.name, "es");
    });
    return rows;
  }

  function consensusTableHead() {
    return `<tr><th scope="col">Jugador</th><th scope="col">Pos. FT</th><th scope="col">Precio FT</th><th scope="col">FT</th><th scope="col">CP</th><th scope="col">Draft · 10% máx.</th><th scope="col">Contexto</th><th scope="col">Consenso</th><th scope="col">Disponibilidad</th></tr>`;
  }

  function consensusModelRow(row) {
    const player = row.player;
    const availabilityClass = row.availability.hardOut
      ? "hard"
      : row.availability.doubt || row.availability.caution ? "medium" : "easy";
    const probableLabel = probableRoleLabel(row.probableLineupRole);
    const probableBadge = probableLabel
      ? `<span class="pl-chip ${row.probableLineupRole === "alternative" ? "medium" : "info"}" title="Predicción precargada o importada; no cambia puntos, precio, posición ni disponibilidad confirmada">${esc(probableLabel)}</span>`
      : "";
    const copilotCell = row.copilotSignal == null
      ? '<td title="Sin match Copilot seguro; el consenso renormaliza las señales disponibles">—</td>'
      : `<td title="Copilot GW1 ${row.copilotPoints.toFixed(2)}; percentil normalizado por posición, precio y valor">${Math.round(row.copilotSignal)}</td>`;
    const agreementDetail = row.agreement === "sin contraste"
      ? "sin contraste externo"
      : `acuerdo ${row.agreement}`;
    return `<tr>
      <td>${tablePlayer(player, player.name, `${player.club} · ${agreementDetail}`)}</td>
      <td>${esc(player.pos)}</td>
      <td title="Precio FanTeam usado por el constructor">${player.price.toFixed(1)}M FT</td>
      <td title="FanTeam GW1 ${row.fanteamPoints.toFixed(2)}; percentil normalizado por posición, precio y valor">${Math.round(row.fanteamSignal)}</td>
      ${copilotCell}
      <td title="${row.draftUsed ? `Draft GW1 ${row.draftPoints.toFixed(2)}; percentil por posición y precio FanTeam` : "Sin match Draft seguro; pesos restantes renormalizados"}">${row.draftUsed ? Math.round(row.draftSignal) : "—"}</td>
      <td title="Calendario, cuotas disponibles y disponibilidad estructurada">${Math.round(row.contextSignal)}</td>
      <td title="${esc(row.explanation)}"><strong>${row.score.toFixed(1)}</strong></td>
      <td><div class="model-status-stack"><span class="pl-chip ${availabilityClass}">${esc(row.availability.label)}</span>${probableBadge}</div></td>
    </tr>`;
  }

  function renderModelTables() {
    if (!state.model) return;
    const gameweeks = projectionWindow();
    const ownRows = filteredPlayers();
    $("#ownModelHead").innerHTML = tableHead();
    $("#copilotModelHead").innerHTML = tableHead({ copilot: true });
    $("#consensusModelHead").innerHTML = consensusTableHead();
    $("#ownModelCount").textContent = `${ownRows.length} visibles`;
    $("#ownModelBody").innerHTML = ownRows.length
      ? ownRows.map((player) => ownModelRow(player, gameweeks)).join("")
      : `<tr><td class="model-table-empty" colspan="${gameweeks.length + 4}">No hay jugadores FanTeam para estos filtros.</td></tr>`;

    const copilotRows = sharedCopilotRows();
    $("#copilotModelCount").textContent = state.copilot
      ? `${copilotRows.length}/${state.copilot.players.length} visibles`
      : "sin datos";
    $("#copilotModelBody").innerHTML = copilotRows.length
      ? copilotRows.map((row) => copilotModelRow(row, gameweeks)).join("")
      : `<tr><td class="model-table-empty" colspan="${gameweeks.length + 4}">${state.copilot ? "No hay jugadores Copilot para estos filtros." : "Importa un JSON/CSV autorizado para mostrar la segunda tabla completa."}</td></tr>`;

    const consensusRows = sharedConsensusRows();
    const draftStatus = Draft.datasetStatus(state.draft, { gameweek: Consensus.GAMEWEEK });
    const draftCoverage = draftStatus.active ? state.draftByPlayerId.size : 0;
    $("#consensusModelCount").textContent = consensusRows.length
      ? `${consensusRows.length} consensos · CP ${state.copilotByPlayerId.size} · Draft ${draftCoverage}`
      : "sin consenso";
    $("#consensusModelBody").innerHTML = consensusRows.length
      ? consensusRows.map(consensusModelRow).join("")
      : '<tr><td class="model-table-empty" colspan="9">No hay jugadores FanTeam elegibles para estos filtros.</td></tr>';
  }

  function consensusPlayerItem(player, role = "") {
    const row = state.consensus?.rowById?.get(Number(player.id));
    if (!row) return "";
    const scheduled = row.fixture;
    const fixtureLabel = scheduled
      ? `${scheduled.home ? "vs" : "@"} ${scheduled.opp} · ${scheduled.diff || "Medio"}`
      : "sin partido";
    const probableLabel = probableRoleLabel(row.probableLineupRole);
    return `<article class="consensus-player" title="${esc([row.explanation, probableLabel].filter(Boolean).join(" · "))}">
      <span class="club-badge club-${esc(player.club)}" aria-hidden="true">${esc(player.club)}</span>
      <div><strong>${esc(player.name)}</strong><small>${esc(player.pos)} · ${player.price.toFixed(1)}M FT · ${esc(fixtureLabel)}${probableLabel ? ` · ${esc(probableLabel)}` : ""}</small><span>${esc(row.explanation)}</span></div>
      <div class="consensus-player-score">${role ? `<em>${esc(role)}</em>` : ""}<strong>${row.score.toFixed(1)}</strong><small>consenso</small></div>
    </article>`;
  }

  function renderConsensusSquad() {
    const status = $("#consensusSquadStatus");
    const body = $("#consensusSquadBody");
    const result = state.consensus;
    if (!result?.squad) {
      const warnings = result?.warnings?.join(" · ") || "No hay suficientes jugadores FanTeam elegibles para construir la plantilla.";
      status.className = "pl-chip hard";
      status.textContent = "Sin plantilla";
      body.innerHTML = `<div class="empty-state"><strong>No se pudo construir un equipo completo</strong>${esc(warnings)}${result?.rows?.length ? ` · ${result.rows.length} consensos disponibles.` : ""}</div>`;
      return;
    }

    const best = state.model.bestXI(result.squad.ids, result.gameweek);
    if (!best?.xi?.length || !best.cap || !best.vice) {
      status.className = "pl-chip hard";
      status.textContent = "XI inválido";
      body.innerHTML = '<div class="empty-state"><strong>La plantilla existe, pero no produjo un XI legal.</strong>Revisa posiciones y disponibilidad.</div>';
      return;
    }

    const positionOrder = { GK: 0, DEF: 1, MID: 2, FWD: 3 };
    const xi = best.xi.slice().sort((first, second) => (
      positionOrder[first.pos] - positionOrder[second.pos]
        || (result.rowById.get(second.id)?.score || 0) - (result.rowById.get(first.id)?.score || 0)
    ));
    const xiIds = new Set(xi.map((player) => Number(player.id)));
    const bench = result.squad.ids.map((id) => state.byId.get(Number(id))).filter((player) => player && !xiIds.has(Number(player.id)));
    const benchGoalkeeper = bench.find((player) => player.pos === "GK") || null;
    const benchOutfield = bench.filter((player) => player.pos !== "GK").sort((first, second) => {
      const a = result.rowById.get(Number(first.id));
      const b = result.rowById.get(Number(second.id));
      const safety = (row) => row?.availability?.hardOut ? 0 : row?.availability?.doubt ? 1 : row?.availability?.caution ? 2 : 3;
      return safety(b) - safety(a) || (b?.score || 0) - (a?.score || 0);
    });
    const roleFor = (player) => Number(player.id) === Number(best.cap.id)
      ? "C"
      : Number(player.id) === Number(best.vice.id) ? "VC" : "";
    const remaining = result.budget - result.squad.cost;
    const draftCoverage = result.rows.filter((row) => row.draftUsed).length;
    const copilotCoverage = result.rows.filter((row) => row.copilotSignal != null).length;
    const monteCarlo = result.monteCarlo || { status: "idle" };
    const simulationComplete = monteCarlo.status === "complete";
    const simulationRunning = monteCarlo.status === "running";
    const formatCount = (value) => Math.max(0, Number(value) || 0).toLocaleString("es-ES");
    const monteCarloSummary = simulationComplete ? `
      <div title="Escenarios reproducibles con seed ${monteCarlo.seed}"><span>Escenarios MC</span><strong>${formatCount(monteCarlo.scenarioCount)}</strong></div>
      <div title="Plantillas FanTeam legales evaluadas; ${monteCarlo.changesFromBase} cambios frente al óptimo determinista"><span>Candidatas</span><strong>${monteCarlo.candidateCount} · ${monteCarlo.changesFromBase} cambios</strong></div>
      <div title="Media del índice normalizado de plantilla, no puntos FanTeam"><span>Media índice MC</span><strong>${monteCarlo.mean.toFixed(1)}</strong></div>
      <div title="Escenario de caída: percentil 10 del índice de plantilla"><span>Índice P10</span><strong>${monteCarlo.p10.toFixed(1)}</strong></div>
      <div title="Mediana y percentil 90 del índice de plantilla"><span>Índice P50 / P90</span><strong>${monteCarlo.p50.toFixed(1)} / ${monteCarlo.p90.toFixed(1)}</strong></div>
      <div title="Bloques de simulación donde esta candidata mantuvo la mejor media"><span>Estabilidad MC</span><strong>${Math.round(100 * monteCarlo.stability)}%</strong></div>` : `
      <div><span>Monte Carlo</span><strong>${simulationRunning ? "Simulando…" : "Base segura"}</strong></div>
      <div><span>Escenarios previstos</span><strong>${formatCount(monteCarlo.scenarioCount || MonteCarlo.DEFAULT_SCENARIOS)}</strong></div>`;
    const monteCarloExplanation = simulationComplete
      ? ` Monte Carlo evaluó ${formatCount(monteCarlo.scenarioCount)} escenarios reproducibles sobre ${monteCarlo.candidateCount} plantillas legales y eligió por media menos 25% de la caída hasta P10. El XI se fijó antes de simular; la incertidumbre combina desacuerdo y cobertura ausente de señales opcionales con shocks globales, de club y jugador, y añade +2 de sigma únicamente para una alternativa prevista. La distribución no se recorta para conservar su media. Sus P10/P50/P90 son índices de sensibilidad, no puntos FanTeam ni probabilidades calibradas.`
      : simulationRunning
        ? " Monte Carlo está evaluando la plantilla determinista en segundo plano; mientras termina se conserva una opción FanTeam válida."
        : " Monte Carlo no estuvo disponible, por lo que se conserva el óptimo determinista seguro.";

    status.className = `pl-chip ${simulationComplete ? "easy" : simulationRunning ? "info" : "medium"}`;
    status.textContent = simulationComplete
      ? `15 jugadores válidos · MC ${formatCount(monteCarlo.scenarioCount)}`
      : simulationRunning ? "15 jugadores válidos · simulando Monte Carlo" : "15 jugadores válidos · base determinista";
    body.innerHTML = `<div class="consensus-summary">
      <div><span>Presupuesto FT</span><strong>${result.budget.toFixed(1)}M</strong></div>
      <div><span>Coste FT</span><strong>${result.squad.cost.toFixed(1)}M</strong></div>
      <div><span>Saldo FT</span><strong>${remaining.toFixed(1)}M</strong></div>
      <div><span>Formación</span><strong>${esc(best.formation)}</strong></div>
      <div><span>Capitán</span><strong>${esc(best.cap.name)}</strong></div>
      <div><span>Vice</span><strong>${esc(best.vice.name)}</strong></div>
      ${monteCarloSummary}
    </div>
    <div class="consensus-roster-grid">
      <section aria-labelledby="consensusXiTitle">
        <div class="consensus-section-title"><h4 id="consensusXiTitle">XI titular GW1</h4><span>${best.xi.length}/11 · C y VC distintos</span></div>
        <div class="consensus-xi-grid">${xi.map((player) => consensusPlayerItem(player, roleFor(player))).join("")}</div>
      </section>
      <aside aria-labelledby="consensusBenchTitle">
        <div class="consensus-section-title"><h4 id="consensusBenchTitle">Banca</h4><span>orden por seguridad + consenso</span></div>
        <div class="consensus-bench-group"><small>Portero suplente</small>${benchGoalkeeper ? consensusPlayerItem(benchGoalkeeper) : '<div class="pl-note">No disponible</div>'}</div>
        <div class="consensus-bench-group"><small>Jugadores de campo · orden 1–3</small>${benchOutfield.map((player, index) => consensusPlayerItem(player, `B${index + 1}`)).join("")}</div>
      </aside>
    </div>
    <div class="consensus-explanation"><strong>Cómo se construyó:</strong> precio, presupuesto, posición, XI, C/VC y puntuación de partido son siempre FanTeam. La señal FanTeam se percentila contra el catálogo completo; cada señal externa usa únicamente su cobertura vinculada de forma segura. FanTeam conserva el mayor peso y Draft permanece limitado al 10%. Los pesos presentes se renormalizan: con Copilot y sin Draft se conserva 60% FanTeam, 25% Copilot y 15% contexto; sin archivos externos, el fallback público usa 80% FanTeam y 20% contexto. Ninguna fuente externa aporta precio ni puntos directos al total FanTeam. La señal de Fantasy Football Pundit permanece separada: “probable” es informativo y no recibe bonus; “alternative” resta solo ${ALTERNATIVE_LINEUP_PENALTY.toFixed(2)} al ordenar el XI y eleva sigma sin alterar la media. El optimizador respeta 2 GK, 5 DEF, 5 MID, 3 FWD, máximo tres por club y 100M FanTeam. Cobertura: ${result.rows.length} jugadores con FanTeam + contexto en GW1; ${copilotCoverage} incorporan Copilot y ${draftCoverage} incorporan Draft.${monteCarloExplanation}</div>`;
  }

  function searchResult(player) {
    const current = metric(player);
    const selected = state.selected.includes(player.id);
    return `<div class="search-result">
      <span class="club-badge club-${esc(player.club)}" aria-hidden="true">${esc(player.club)}</span>
      <div class="search-result-name"><strong>${esc(player.name)}</strong><small>${esc(player.pos)} · ${player.price.toFixed(1)}M · ${Math.round(player.confidence)}% conf.</small></div>
      <div class="search-result-score"><strong>${current.h6.toFixed(2)}</strong><small>6GW</small><button class="pl-button compact" type="button" data-add="${player.id}" ${selected || state.selected.length >= 4 ? "disabled" : ""}>${selected ? "Añadido" : "Comparar"}</button></div>
    </div>`;
  }

  function renderSearch() {
    const rows = filteredPlayers();
    $("#resultCount").textContent = String(rows.length);
    $("#searchResults").innerHTML = rows.length
      ? rows.slice(0, 60).map(searchResult).join("")
      : '<div class="empty-state"><strong>Sin coincidencias</strong>Ajusta nombre, posición o precio máximo.</div>';
  }

  function renderShortlist() {
    const players = state.shortlist.map((id) => state.byId.get(id)).filter(Boolean);
    $("#shortlistCount").textContent = String(players.length);
    $("#shortlistList").innerHTML = players.length
      ? players.map((player) => `<div class="shortlist-item"><div><strong>${esc(player.name)}</strong><small>${esc(player.club)} · ${esc(player.pos)} · ${player.price.toFixed(1)}M</small></div><div><button class="pl-button compact" type="button" data-add="${player.id}" ${state.selected.includes(player.id) || state.selected.length >= 4 ? "disabled" : ""}>Comparar</button> <button class="icon-button" type="button" data-shortlist-remove="${player.id}" aria-label="Quitar de shortlist">×</button></div></div>`).join("")
      : '<div class="pl-note">Guarda candidatos para volver a ellos en este navegador.</div>';
  }

  function renderAlternatives() {
    const selected = state.selected.map((id) => state.byId.get(id)).filter(Boolean);
    const chosen = new Set(state.selected);
    const alternatives = [];
    for (const player of selected) {
      const candidates = state.players
        .filter((candidate) => (
          candidate.pos === player.pos
          && !chosen.has(candidate.id)
          && Math.abs(candidate.price - player.price) <= 1.5
          && candidate.confidence >= 45
        ))
        .sort((first, second) => metric(second).h6 - metric(first).h6)
        .slice(0, 2);
      for (const candidate of candidates) {
        if (!alternatives.some((item) => item.id === candidate.id)) alternatives.push(candidate);
      }
    }
    $("#alternativesList").innerHTML = alternatives.length
      ? alternatives.slice(0, 6).map((player) => `<div class="alternative-item"><div><strong>${esc(player.name)}</strong><small>${esc(player.pos)} · ${player.price.toFixed(1)}M · ${metric(player).h6.toFixed(2)} pts 6GW</small></div><button class="pl-button compact" type="button" data-add="${player.id}" ${state.selected.length >= 4 ? "disabled" : ""}>Añadir</button></div>`).join("")
      : '<div class="pl-note">Añade un jugador para descubrir opciones de precio parecido.</div>';
  }

  function syncURL() {
    const url = new URL(location.href);
    if (state.selected.length) url.searchParams.set("players", state.selected.join(","));
    else url.searchParams.delete("players");
    url.searchParams.set("gw", String(state.gameweek));
    history.replaceState(null, "", url);
  }

  function renderAll() {
    renderCopilotStatus();
    renderDraftStatus();
    renderProbableStatus();
    renderComparison();
    renderModelTables();
    renderConsensusSquad();
    renderSearch();
    renderShortlist();
    renderAlternatives();
    syncURL();
  }

  function addPlayer(id) {
    const numericId = Number(id);
    if (!state.byId.has(numericId) || state.selected.includes(numericId)) return;
    if (state.selected.length >= 4) {
      toast("El comparador admite un máximo de cuatro jugadores");
      return;
    }
    state.selected.push(numericId);
    renderAll();
  }

  function removePlayer(id) {
    state.selected = state.selected.filter((candidate) => candidate !== Number(id));
    renderAll();
  }

  function toggleShortlist(id, forceRemove = false) {
    const numericId = Number(id);
    const exists = state.shortlist.includes(numericId);
    state.shortlist = forceRemove || exists
      ? state.shortlist.filter((candidate) => candidate !== numericId)
      : [...state.shortlist, numericId];
    state.shortlist = Data.saveShortlist(state.shortlist);
    renderAll();
    toast(forceRemove || exists ? "Jugador eliminado de la shortlist" : "Jugador guardado en la shortlist");
  }

  function defaultSelection(params) {
    const requested = String(params.get("players") || "")
      .split(",")
      .map(Number)
      .filter((id) => state.byId.has(id));
    if (requested.length) return [...new Set(requested)].slice(0, 4);
    const requestedClub = Data.resolveClubCode(params.get("club"));
    if (requestedClub) {
      const clubPlayers = state.players
        .filter((player) => player.club === requestedClub && player.confidence >= 45)
        .sort((first, second) => metric(second).h6 - metric(first).h6)
        .slice(0, 3)
        .map((player) => player.id);
      if (clubPlayers.length) return clubPlayers;
    }
    const preferred = [4700673, 4700637, 4700753, 4700702]
      .filter((id) => state.byId.has(id));
    if (preferred.length >= 2) return preferred.slice(0, 3);
    return state.players
      .filter((player) => player.confidence >= 45)
      .sort((first, second) => metric(second).h6 - metric(first).h6)
      .slice(0, 3)
      .map((player) => player.id);
  }

  function populateGameweeks() {
    const fixtureGameweeks = Data.availableGameweeks(state.workspace.fixtures);
    const copilotGameweeks = (state.copilot?.players || [])
      .flatMap((player) => player.gameweeks || [])
      .map((row) => Number(row.gw))
      .filter((gameweek) => Number.isInteger(gameweek) && gameweek >= 1 && gameweek <= Data.MAX_GAMEWEEK);
    const draftGameweeks = (state.draft?.players || [])
      .flatMap((player) => player.gameweeks || [])
      .map((row) => Number(row.gw))
      .filter((gameweek) => Number.isInteger(gameweek) && gameweek >= 1 && gameweek <= Data.MAX_GAMEWEEK);
    const gameweeks = [...new Set([...fixtureGameweeks, ...copilotGameweeks, ...draftGameweeks])]
      .sort((first, second) => first - second);
    const select = $("#labGw");
    select.innerHTML = gameweeks.map((gameweek) => `<option value="${gameweek}">GW${gameweek}</option>`).join("");
    if (!gameweeks.includes(state.gameweek)) {
      state.gameweek = gameweeks.find((gameweek) => gameweek >= state.workspace.currentGW) || gameweeks[0] || 1;
    }
    select.value = String(state.gameweek);
  }

  function renderSourceStatus() {
    const element = $("#dataStatus");
    const label = element.querySelector("span");
    const source = state.workspace.remoteSource;
    element.className = `pl-status ${source === "live" ? "live" : "base"}`;
    label.textContent = source === "live"
      ? `En vivo · ${Data.formatFreshness(state.workspace.updatedAt)}`
      : source === "cache"
        ? `Caché · ${Data.formatFreshness(state.workspace.updatedAt)}`
        : "Modo base · sin datos remotos";
    element.title = [state.workspace.remoteError, state.workspace.catalogError].filter(Boolean).join(" · ");
  }

  async function copyCurrentURL() {
    try {
      await navigator.clipboard.writeText(location.href);
      toast("Comparación copiada");
    } catch (_) {
      const input = document.createElement("textarea");
      input.value = location.href;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
      toast("Comparación copiada");
    }
  }

  async function load({ force = false, preserveSelection = false } = {}) {
    const button = $("#refreshLab");
    button.disabled = true;
    button.textContent = force ? "Actualizando…" : "Preparando…";
    try {
      const previous = preserveSelection ? state.selected.slice() : [];
      state.workspace = await Data.loadWorkspaceData({ force });
      state.players = state.workspace.players;
      state.byId = new Map(state.players.map((player) => [Number(player.id), player]));
      const params = new URLSearchParams(location.search);
      const requestedGW = Number(params.get("gw"));
      state.gameweek = Number.isInteger(requestedGW) ? requestedGW : state.workspace.currentGW;
      rebuildProbableMatches();
      createProjectionModel();
      rebuildCopilotMatches();
      rebuildDraftMatches();
      rebuildConsensus();
      populateGameweeks();
      state.selected = previous.filter((id) => state.byId.has(id));
      if (!state.selected.length) state.selected = defaultSelection(params);
      const requestedClub = Data.resolveClubCode(params.get("club"));
      if (requestedClub && !params.get("players")) $("#labSearch").value = requestedClub;
      state.shortlist = Data.readShortlist();
      renderSourceStatus();
      renderAll();
      if (force) toast(state.workspace.remoteSource === "live" ? "Datos actualizados" : "Se mantiene el mejor dato disponible");
    } finally {
      button.disabled = false;
      button.textContent = "Actualizar";
    }
  }

  function dispose() {
    cancelMonteCarloJob();
    if (probableExpiryTimer) clearTimeout(probableExpiryTimer);
    probableExpiryTimer = null;
  }

  document.addEventListener("click", (event) => {
    const add = event.target.closest("[data-add]");
    if (add) return addPlayer(add.dataset.add);
    const remove = event.target.closest("[data-remove]");
    if (remove) return removePlayer(remove.dataset.remove);
    const shortlist = event.target.closest("[data-shortlist]");
    if (shortlist) return toggleShortlist(shortlist.dataset.shortlist);
    const shortlistRemove = event.target.closest("[data-shortlist-remove]");
    if (shortlistRemove) return toggleShortlist(shortlistRemove.dataset.shortlistRemove, true);
  });
  ["#labSearch", "#labPosition", "#labMaxPrice", "#labSort"].forEach((selector) => {
    const element = $(selector);
    element.addEventListener(element.tagName === "INPUT" ? "input" : "change", () => {
      renderSearch();
      renderModelTables();
    });
  });
  $("#labGw").addEventListener("change", (event) => {
    state.gameweek = Number(event.target.value) || 1;
    renderAll();
  });
  $("#clearComparison").addEventListener("click", () => {
    state.selected = [];
    renderAll();
  });
  $("#copyLabLink").addEventListener("click", copyCurrentURL);
  $("#refreshLab").addEventListener("click", () => load({ force: true, preserveSelection: true }));
  $("#copilotImport").addEventListener("click", () => $("#copilotFile").click());
  $("#copilotFile").addEventListener("change", (event) => {
    const [file] = event.target.files || [];
    if (file) importCopilotFile(file);
  });
  $("#copilotClear").addEventListener("click", clearCopilotImport);
  $("#draftImport").addEventListener("click", () => $("#draftFile").click());
  $("#draftFile").addEventListener("change", (event) => {
    const [file] = event.target.files || [];
    if (file) importDraftFile(file);
  });
  $("#draftClear").addEventListener("click", clearDraftImport);
  $("#probableImport").addEventListener("click", () => $("#probableFile").click());
  $("#probableFile").addEventListener("change", (event) => {
    const [file] = event.target.files || [];
    if (file) importProbableFile(file);
  });
  $("#probableClear").addEventListener("click", clearProbableImport);
  globalThis.addEventListener("beforeunload", dispose);

  loadSignalSnapshots()
    .then(async ([copilotLoaded, draftLoaded, probableLoaded]) => {
      await load();
      const loaded = [
        copilotLoaded ? `${state.copilot.players.length} Copilot` : null,
        draftLoaded ? `${state.draft.players.length} Draft` : null,
        probableLoaded ? `${state.probable.players.length} señales de alineación` : null,
      ].filter(Boolean);
      if (loaded.length) toast(`${loaded.join(" + ")} cargados automáticamente`);
    })
    .catch((error) => {
      $("#compareGrid").innerHTML = `<div class="pl-card empty-state"><strong>No se pudo abrir Player Lab</strong>${esc(error.message)}</div>`;
      $("#dataStatus span").textContent = "Error al preparar datos";
    });
})();
