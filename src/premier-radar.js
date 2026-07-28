(function startPremierRadar() {
  "use strict";

  const Data = globalThis.PremierLeagueData;
  if (!Data) throw new Error("PremierLeagueData no está disponible");

  const $ = (selector) => document.querySelector(selector);
  const esc = Data.escapeHTML;
  const WEIGHTS = Object.freeze([1, .88, .74, .61, .49, .38]);
  const state = {
    workspace: null,
    gameweek: 1,
    club: null,
    order: "overall",
    metrics: [],
  };

  function toast(message) {
    const element = $("#toast");
    element.textContent = message;
    element.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => element.classList.remove("show"), 2100);
  }

  function mean(values) {
    const safe = values.filter(Number.isFinite);
    return safe.length ? safe.reduce((sum, value) => sum + value, 0) / safe.length : null;
  }

  function quality(advantage) {
    return Data.clamp(50 + (Data.finite(advantage) || 0) * .68, 4, 96);
  }

  function weightedQuality(schedule) {
    let total = 0;
    let weightTotal = 0;
    schedule.forEach((fixture, index) => {
      const weight = WEIGHTS[index] || .3;
      total += quality(fixture.adv) * weight;
      weightTotal += weight;
    });
    return weightTotal ? total / weightTotal : 0;
  }

  function attackEvidence(club) {
    const candidates = state.workspace.players
      .filter((player) => player.club === club && (player.pos === "MID" || player.pos === "FWD"))
      .map((player) => ({
        xg90: Data.finite(player.reference?.xg90),
        minutes: Data.finite(player.reference?.minutes) || 0,
      }))
      .filter((item) => item.xg90 != null && item.minutes >= 270)
      .sort((first, second) => second.xg90 - first.xg90)
      .slice(0, 5);
    if (!candidates.length) return null;
    const xg90 = mean(candidates.map((item) => item.xg90));
    return {
      score: Data.clamp(30 + xg90 * 105, 24, 92),
      count: candidates.length,
      label: `${xg90.toFixed(2)} xG/90 medio en ${candidates.length} atacantes`,
    };
  }

  function defenseEvidence(club) {
    const candidates = state.workspace.players
      .filter((player) => player.club === club && (player.pos === "GK" || player.pos === "DEF"))
      .map((player) => {
        const starts = Data.finite(player.reference?.starts);
        const cleanSheets = Data.finite(player.reference?.cleanSheets);
        const xgc90 = Data.finite(player.reference?.xgc90);
        const minutes = Data.finite(player.reference?.minutes) || 0;
        const cleanSheetRate = starts && cleanSheets != null ? cleanSheets / starts : null;
        const components = [];
        if (cleanSheetRate != null) components.push(Data.clamp(28 + cleanSheetRate * 115, 20, 92));
        if (xgc90 != null) components.push(Data.clamp(88 - xgc90 * 27, 18, 92));
        return { score: mean(components), minutes };
      })
      .filter((item) => item.score != null && item.minutes >= 270)
      .sort((first, second) => second.minutes - first.minutes)
      .slice(0, 6);
    if (!candidates.length) return null;
    return {
      score: mean(candidates.map((item) => item.score)),
      count: candidates.length,
      label: `señal agregada de ${candidates.length} defensores`,
    };
  }

  function clubCodes() {
    const codes = new Set();
    for (const gameweek of Object.values(state.workspace.fixtures || {})) {
      for (const code of Object.keys(gameweek || {})) codes.add(code);
    }
    return [...codes]
      .filter((code) => state.workspace.teamNames[code])
      .sort((first, second) => state.workspace.teamNames[first].localeCompare(state.workspace.teamNames[second], "es"));
  }

  function metricForClub(club) {
    const schedule = Data.scheduleFor(state.workspace.fixtures, club, state.gameweek, 6);
    const calendar = weightedQuality(schedule);
    const attackSignal = attackEvidence(club);
    const defenseSignal = defenseEvidence(club);
    const attack = attackSignal ? calendar * .78 + attackSignal.score * .22 : calendar;
    const defense = defenseSignal ? calendar * .8 + defenseSignal.score * .2 : calendar;
    return {
      club,
      name: state.workspace.teamNames[club] || club,
      schedule,
      calendar,
      attack,
      defense,
      overall: attack * .54 + defense * .46,
      next: schedule.length ? quality(schedule[0].adv) : 0,
      attackSignal,
      defenseSignal,
    };
  }

  function scoreValue(metric) {
    return metric[state.order] ?? metric.overall;
  }

  function sortedMetrics() {
    return state.metrics.slice().sort((first, second) => (
      scoreValue(second) - scoreValue(first)
      || second.overall - first.overall
      || first.name.localeCompare(second.name, "es")
    ));
  }

  function scoreClass(score) {
    return score >= 64 ? "easy" : score <= 39 ? "hard" : "medium";
  }

  function scoreLabel(score) {
    return score >= 70 ? "Excelente" : score >= 58 ? "Favorable" : score <= 32 ? "Muy exigente" : score <= 44 ? "Exigente" : "Equilibrado";
  }

  function scoreFromResult(match) {
    const homeGoals = Data.finite(
      match.homeGoals ?? match.goals?.home ?? match.score?.fullTime?.home ?? match.score?.home,
    );
    const awayGoals = Data.finite(
      match.awayGoals ?? match.goals?.away ?? match.score?.fullTime?.away ?? match.score?.away,
    );
    return homeGoals == null || awayGoals == null ? null : { homeGoals, awayGoals };
  }

  function recentForm(club) {
    const combined = [...state.workspace.results, ...state.workspace.liveFixtures];
    const records = [];
    const seen = new Set();
    for (const match of combined) {
      if (!match || typeof match !== "object") continue;
      const home = Data.resolveClubCode(match.home ?? match.homeTeam);
      const away = Data.resolveClubCode(match.away ?? match.awayTeam);
      if (home !== club && away !== club) continue;
      const score = scoreFromResult(match);
      if (!score) continue;
      const kickoff = match.kickoff || match.utcDate || match.date || "";
      const key = `${home}|${away}|${kickoff}|${score.homeGoals}-${score.awayGoals}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const isHome = home === club;
      const own = isHome ? score.homeGoals : score.awayGoals;
      const opponent = isHome ? score.awayGoals : score.homeGoals;
      records.push({
        result: own > opponent ? "W" : own < opponent ? "L" : "D",
        kickoff: new Date(kickoff || 0).getTime() || 0,
        label: `${home || "—"} ${score.homeGoals}–${score.awayGoals} ${away || "—"}`,
      });
    }
    return records.sort((first, second) => second.kickoff - first.kickoff).slice(0, 5);
  }

  function topAssets(club) {
    return state.workspace.players
      .filter((player) => player.club === club && player.confidence >= 45)
      .sort((first, second) => (
        (second.price * second.confidence) - (first.price * first.confidence)
        || first.name.localeCompare(second.name, "es")
      ))
      .slice(0, 5);
  }

  function fixtureTile(fixture) {
    const cssClass = fixture.diff === "Fácil" ? "easy" : fixture.diff === "Difícil" ? "hard" : "medium";
    return `<div class="fixture-tile ${cssClass}" title="${esc(fixture.diff || "Dificultad media")}">
      <small>GW${fixture.gw}</small>
      <strong>${esc(fixture.opp)}</strong>
      <span>${fixture.home ? "LOCAL" : "VISITA"}</span>
      <span>${esc(fixture.diff || "Medio")}</span>
    </div>`;
  }

  function renderRanking() {
    const ranking = sortedMetrics();
    const container = $("#radarRanking");
    if (!ranking.length) {
      container.innerHTML = '<div class="empty-state"><strong>Sin calendario disponible</strong>No se encontraron partidos para esta jornada.</div>';
      return;
    }
    container.innerHTML = ranking.map((metric, index) => `<button class="ranking-row ${metric.club === state.club ? "active" : ""}" type="button" data-club="${esc(metric.club)}" aria-pressed="${metric.club === state.club}">
      <span class="ranking-position">${index + 1}</span>
      <span class="club-badge club-${esc(metric.club)}" aria-hidden="true">${esc(metric.club)}</span>
      <span class="ranking-club"><strong>${esc(metric.name)}</strong><small>${esc(scoreLabel(metric.overall))} · ${metric.schedule.length} partidos</small></span>
      <span class="ranking-score"><strong>${metric.attack.toFixed(0)}</strong><small>ATAQUE</small></span>
      <span class="ranking-score"><strong>${metric.defense.toFixed(0)}</strong><small>DEFENSA</small></span>
    </button>`).join("");
  }

  function renderDetail() {
    const metric = state.metrics.find((item) => item.club === state.club);
    const container = $("#clubDetail");
    if (!metric) {
      container.innerHTML = '<div class="empty-state"><strong>Selecciona un club</strong>Verás su programa, señales y jugadores destacados.</div>';
      return;
    }
    const form = recentForm(metric.club);
    const assets = topAssets(metric.club);
    const playerIds = assets.slice(0, 3).map((player) => player.id).join(",");
    const labUrl = `premier-player-lab.html?club=${encodeURIComponent(metric.club)}${playerIds ? `&players=${playerIds}` : ""}&gw=${state.gameweek}`;
    const evidence = [metric.attackSignal?.label, metric.defenseSignal?.label].filter(Boolean);
    container.innerHTML = `
      <div class="club-detail-hero">
        <span class="club-badge club-${esc(metric.club)}" aria-hidden="true">${esc(metric.club)}</span>
        <div><h2>${esc(metric.name)}</h2><p>${esc(scoreLabel(metric.overall))} desde GW${state.gameweek} · ${metric.schedule.length} partidos analizados</p></div>
      </div>
      <div class="detail-score-grid">
        <div class="detail-score"><span>Ataque 6GW</span><strong>${metric.attack.toFixed(0)}</strong></div>
        <div class="detail-score"><span>Defensa 6GW</span><strong>${metric.defense.toFixed(0)}</strong></div>
        <div class="detail-score"><span>Próxima GW</span><strong>${metric.next.toFixed(0)}</strong></div>
      </div>
      <div class="fixture-strip">${metric.schedule.map(fixtureTile).join("") || '<div class="pl-note">Sin partidos en la ventana.</div>'}</div>
      <div class="form-row" aria-label="Forma reciente">
        <strong class="pl-note">Forma:</strong>
        ${form.length ? form.map((item) => `<span class="form-dot ${item.result === "W" ? "win" : item.result === "D" ? "draw" : "loss"}" title="${esc(item.label)}">${item.result === "W" ? "V" : item.result === "D" ? "E" : "D"}</span>`).join("") : '<span class="form-dot none" title="Sin resultados sincronizados">—</span><span class="pl-note">Sin resultados sincronizados</span>'}
      </div>
      <div class="asset-row">
        <strong class="pl-note">Activos:</strong>
        ${assets.map((player) => `<a class="asset-link" href="premier-player-lab.html?players=${player.id}&club=${esc(metric.club)}&gw=${state.gameweek}">${esc(player.name)} · ${player.price.toFixed(1)}M</a>`).join("") || '<span class="pl-note">Sin jugadores con confianza suficiente.</span>'}
      </div>
      <div class="pl-card-body" style="padding-top:0">
        <div class="pl-callout">${evidence.length ? `El score mezcla calendario con ${esc(evidence.join(" y "))}.` : "No hay muestra FPL suficiente: el score usa únicamente dificultad y localía del calendario incorporado."}</div>
        <div class="pl-hero-actions"><a class="pl-button primary" href="${labUrl}">Comparar jugadores de ${esc(metric.club)}</a><a class="pl-button" href="index.html#fixtures">Ver todos los partidos</a></div>
      </div>`;
  }

  function renderSummary() {
    const byAttack = state.metrics.slice().sort((a, b) => b.attack - a.attack)[0];
    const byDefense = state.metrics.slice().sort((a, b) => b.defense - a.defense)[0];
    const byNext = state.metrics.slice().sort((a, b) => b.next - a.next)[0];
    $("#clubsCovered").textContent = String(state.metrics.length);
    $("#coverageLabel").textContent = state.workspace.catalogSource === "catalog"
      ? "Catálogo completo compartido"
      : "Catálogo mínimo de respaldo";
    $("#bestAttack").textContent = byAttack?.club || "—";
    $("#bestAttackScore").textContent = byAttack ? `${byAttack.attack.toFixed(0)}/100 · ${byAttack.name}` : "—";
    $("#bestDefense").textContent = byDefense?.club || "—";
    $("#bestDefenseScore").textContent = byDefense ? `${byDefense.defense.toFixed(0)}/100 · ${byDefense.name}` : "—";
    $("#bestNext").textContent = byNext?.club || "—";
    $("#bestNextScore").textContent = byNext ? `${byNext.next.toFixed(0)}/100 · ${byNext.name}` : "—";
    const end = Math.min(Data.MAX_GAMEWEEK, state.gameweek + 5);
    $("#rankingWindow").textContent = `GW${state.gameweek}–GW${end}`;
    $("#sideRadarGw").textContent = `Desde GW${state.gameweek}`;
  }

  function syncURL() {
    const url = new URL(location.href);
    url.searchParams.set("gw", String(state.gameweek));
    if (state.club) url.searchParams.set("club", state.club);
    else url.searchParams.delete("club");
    if (state.order !== "overall") url.searchParams.set("sort", state.order);
    else url.searchParams.delete("sort");
    history.replaceState(null, "", url);
  }

  function render() {
    state.metrics = clubCodes().map(metricForClub).filter((metric) => metric.schedule.length);
    const ranking = sortedMetrics();
    if (!state.club || !state.metrics.some((metric) => metric.club === state.club)) {
      state.club = ranking[0]?.club || null;
    }
    $("#radarClub").value = state.club || "";
    renderSummary();
    renderRanking();
    renderDetail();
    syncURL();
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

  function populateControls() {
    const gameweeks = Data.availableGameweeks(state.workspace.fixtures);
    const gwSelect = $("#radarGw");
    gwSelect.innerHTML = gameweeks.map((gameweek) => `<option value="${gameweek}">Jornada ${gameweek}</option>`).join("");
    if (!gameweeks.includes(state.gameweek)) {
      state.gameweek = gameweeks.find((gameweek) => gameweek >= state.workspace.currentGW) || gameweeks[0] || 1;
    }
    gwSelect.value = String(state.gameweek);
    const clubSelect = $("#radarClub");
    clubSelect.innerHTML = '<option value="">Mejor clasificado</option>' + clubCodes()
      .map((club) => `<option value="${esc(club)}">${esc(state.workspace.teamNames[club])}</option>`)
      .join("");
  }

  async function copyCurrentURL() {
    try {
      await navigator.clipboard.writeText(location.href);
      toast("Vista del Radar copiada");
    } catch (_) {
      const input = document.createElement("textarea");
      input.value = location.href;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
      toast("Vista del Radar copiada");
    }
  }

  async function load({ force = false } = {}) {
    const button = $("#refreshRadar");
    button.disabled = true;
    button.textContent = force ? "Actualizando…" : "Preparando…";
    try {
      state.workspace = await Data.loadWorkspaceData({ force });
      const params = new URLSearchParams(location.search);
      const requestedGW = Number(params.get("gw"));
      state.gameweek = Number.isInteger(requestedGW) ? requestedGW : state.workspace.currentGW;
      const requestedClub = Data.resolveClubCode(params.get("club"));
      state.club = requestedClub || state.club;
      const requestedOrder = params.get("sort");
      state.order = ["overall", "attack", "defense", "next"].includes(requestedOrder)
        ? requestedOrder
        : state.order;
      $("#radarOrder").value = state.order;
      populateControls();
      renderSourceStatus();
      render();
      if (force) toast(state.workspace.remoteSource === "live" ? "Datos actualizados" : "Se mantiene el mejor dato disponible");
    } finally {
      button.disabled = false;
      button.textContent = "Actualizar";
    }
  }

  $("#radarRanking").addEventListener("click", (event) => {
    const button = event.target.closest("[data-club]");
    if (!button) return;
    state.club = button.dataset.club;
    $("#radarClub").value = state.club;
    render();
  });
  $("#radarGw").addEventListener("change", (event) => {
    state.gameweek = Number(event.target.value) || 1;
    render();
  });
  $("#radarClub").addEventListener("change", (event) => {
    state.club = event.target.value || sortedMetrics()[0]?.club || null;
    render();
  });
  $("#radarOrder").addEventListener("change", (event) => {
    state.order = event.target.value;
    render();
  });
  $("#refreshRadar").addEventListener("click", () => load({ force: true }));
  $("#copyRadarLink").addEventListener("click", copyCurrentURL);

  load().catch((error) => {
    $("#radarRanking").innerHTML = `<div class="empty-state"><strong>No se pudo abrir el Radar</strong>${esc(error.message)}</div>`;
    $("#dataStatus span").textContent = "Error al preparar datos";
  });
})();
