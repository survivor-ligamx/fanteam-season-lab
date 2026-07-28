export function createPlayerLabStatusRenderers({
  state, $, Data, Copilot, Draft, Probable, Consensus,
}) {
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
  return { renderCopilotStatus, renderDraftStatus, renderProbableStatus };
}
