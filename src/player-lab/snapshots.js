export function createPlayerLabSnapshots({
  state, Copilot, Draft, Probable, PublicSignals, $, actions,
}) {
  const populateGameweeks = (...args) => actions.populateGameweeks(...args);
  const rebuildCopilotMatches = (...args) => actions.rebuildCopilotMatches(...args);
  const rebuildDraftMatches = (...args) => actions.rebuildDraftMatches(...args);
  const rebuildProbableMatches = (...args) => actions.rebuildProbableMatches(...args);
  const rebuildConsensus = (...args) => actions.rebuildConsensus(...args);
  const renderAll = (...args) => actions.renderAll(...args);
  const toast = (...args) => actions.toast(...args);

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
  return {
    loadSignalSnapshots, importCopilotFile, clearCopilotImport,
    importDraftFile, clearDraftImport, importProbableFile, clearProbableImport,
  };
}
