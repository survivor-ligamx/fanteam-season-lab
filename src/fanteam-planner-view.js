(function attachFanTeamPlannerView(global) {
  "use strict";

  const VERSION = "fanteam-planner-view-v1";

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;",
    })[character]);
  }

  function transferDescription(recommendation) {
    if (recommendation?.type !== "transfer") return "Guardar transferencia";
    return recommendation.double
      ? `${recommendation.out.name} + ${recommendation.out2.name} → ${recommendation.inn.name} + ${recommendation.inn2.name}`
      : `${recommendation.out.name} → ${recommendation.inn.name}`;
  }

  function present(input) {
    const { plan, gameweek, decisionLocked = false } = input || {};
    if (!plan || !Array.isArray(plan.weeks)) throw new Error("plan es obligatorio");

    const summaryHtml = `<div class="card metric"><span>Proyección plan</span><strong>${plan.total.toFixed(1)}</strong></div><div class="card metric"><span>Sin transferencias</span><strong>${plan.baseline.toFixed(1)}</strong></div><div class="card metric"><span>Ventaja estimada</span><strong>${plan.advantage >= 0 ? "+" : ""}${plan.advantage.toFixed(1)}</strong></div><div class="card metric"><span>Movimientos · FT finales</span><strong>${plan.transfers} · ${plan.finalFree}</strong></div>`;
    const timelineHtml = plan.weeks.map((week, index) => {
      const recommendation = week.recommendation;
      const free = week.gw === 1 ? "∞" : week.freeBefore;
      const cost = week.gw === 1 ? "ajuste ilimitado" : `${week.used} FT`;
      const movement = recommendation.type === "transfer"
        ? `+${recommendation.gain.toFixed(2)} pts ponderados · ${cost}`
        : "Acumular FT";
      const viceIsDifferential = week.xi.differential
        && week.xi.differentialMetric
        && week.xi.differential.id === week.xi.vice.id;
      const viceDifferential = viceIsDifferential
        ? ` · DIF ${Number(week.xi.differentialMetric.selectedBy).toFixed(1)}% FPL`
        : "";
      const differential = week.xi.differential
        && week.xi.differentialMetric
        && !viceIsDifferential
        ? `<br><small class="plannerDifferential">DIF ${escapeHtml(week.xi.differential.name)} · ${Number(week.xi.differentialMetric.selectedBy).toFixed(1)}% FPL</small>`
        : "";
      return `<div class="card week ${index === 0 ? "current" : ""}"><strong>GW${week.gw}</strong><div><b>${escapeHtml(transferDescription(recommendation))}</b><br><small>${movement} · saldo ${free} → ${week.freeAfter}</small></div><span>© ${escapeHtml(week.xi.cap.name)}<br><small${viceIsDifferential ? " class=\"plannerDifferential\"" : ""}>(V) ${escapeHtml(week.xi.vice.name)}${viceDifferential}</small>${differential}</span><span>${week.points.toFixed(1)} pts<br><small>${week.xi.formation}</small></span></div>`;
    }).join("");

    const first = plan.weeks[0];
    const action = {
      visible: !decisionLocked && Boolean(first),
      label: first?.recommendation.type === "transfer"
        ? "Aplicar primer movimiento"
        : "Guardar esta jornada",
      recommendation: first?.recommendation || null,
    };
    const note = decisionLocked
      ? "La decisión de la jornada actual ya está fijada; la simulación la conserva y encadena las siguientes."
      : first?.recommendation.type === "transfer"
        ? gameweek === 1
          ? "GW1 permite ajustes ilimitados: aplica este movimiento y el plan se recalculará inmediatamente para buscar el siguiente."
          : "Puedes aplicar únicamente el primer movimiento. El resto se recalculará después de cada jornada con datos nuevos."
        : "El plan recomienda guardar ahora para acumular la transferencia; puedes registrar esa decisión desde aquí.";

    return Object.freeze({
      summaryHtml,
      timelineHtml,
      note,
      action: Object.freeze(action),
    });
  }

  global.FanTeamPlannerView = Object.freeze({
    VERSION,
    present,
  });
})(globalThis);
