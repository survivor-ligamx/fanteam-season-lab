(function attachFanTeamPlanner(global) {
  "use strict";

  const VERSION = "fanteam-planner-v1";
  const DEFAULT_MAX_GAMEWEEK = 38;

  function create(options) {
    const {
      recommendationFor,
      bestXI,
      captainedTotal,
      buyingPower,
      transferCount,
      idsAfterRecommendation,
      transferBankAfter,
      freeAfterWeek,
      maxGameweek = DEFAULT_MAX_GAMEWEEK,
    } = options || {};
    if (typeof recommendationFor !== "function") throw new Error("recommendationFor es obligatorio");
    if (typeof bestXI !== "function") throw new Error("bestXI es obligatorio");
    if (typeof captainedTotal !== "function") throw new Error("captainedTotal es obligatorio");
    if (typeof buyingPower !== "function") throw new Error("buyingPower es obligatorio");
    if (typeof transferCount !== "function") throw new Error("transferCount es obligatorio");
    if (typeof idsAfterRecommendation !== "function") {
      throw new Error("idsAfterRecommendation es obligatorio");
    }
    if (typeof transferBankAfter !== "function") throw new Error("transferBankAfter es obligatorio");
    if (typeof freeAfterWeek !== "function") throw new Error("freeAfterWeek es obligatorio");

    function applyCurrentDecision(input) {
      const { state, recommendation } = input || {};
      if (!state || typeof state !== "object" || !Array.isArray(state.squad)) {
        return { ok: false, code: "invalid-state" };
      }
      if (!recommendation || !["save", "transfer"].includes(recommendation.type)) {
        return { ok: false, code: "invalid-recommendation" };
      }
      if (recommendation.alreadyApplied) {
        return { ok: false, code: "already-applied" };
      }
      const decisionIsLocked = state.decision
        && !(state.gw === 1 && state.decision.type === "applied");
      if (decisionIsLocked) {
        return { ok: false, code: "decision-locked" };
      }
      if (recommendation.type === "save") {
        return {
          ok: true,
          code: "saved",
          state: {
            ...state,
            decision: {
              type: "save",
              gain: 0,
              rawGain: 0,
              reason: recommendation.reason || "Decidiste acumular la transferencia gratuita.",
            },
          },
        };
      }

      const count = transferCount(recommendation);
      if (state.gw > 1 && state.free < count) {
        return { ok: false, code: "insufficient-free" };
      }
      const nextBank = transferBankAfter(state.bank, recommendation);
      if (nextBank < -.001) {
        return { ok: false, code: "insufficient-bank" };
      }
      const purchasePrices = { ...(state.purchasePrices || {}) };
      delete purchasePrices[recommendation.out.id];
      purchasePrices[recommendation.inn.id] = recommendation.inn.price;
      if (recommendation.double) {
        delete purchasePrices[recommendation.out2.id];
        purchasePrices[recommendation.inn2.id] = recommendation.inn2.price;
      }
      return {
        ok: true,
        code: "transfer-applied",
        count,
        state: {
          ...state,
          bank: Math.max(0, nextBank),
          purchasePrices,
          squad: idsAfterRecommendation(state.squad, recommendation),
          decision: state.gw === 1
            ? null
            : {
              type: "applied",
              count,
              out: recommendation.out,
              inn: recommendation.inn,
              out2: recommendation.out2,
              inn2: recommendation.inn2,
              gain: recommendation.gain,
              rawGain: recommendation.rawGain,
              reason: recommendation.reason,
            },
        },
      };
    }

    function simulateSixWeekPlan(input) {
      const {
        gameweek,
        squad,
        free: initialFree,
        bank: initialBank,
        lockedRecommendation = null,
      } = input || {};
      const start = gameweek;
      const end = Math.min(maxGameweek, start + 5);
      const baselineIds = squad.slice();
      let ids = squad.slice();
      let free = initialFree;
      let bank = initialBank;
      let total = 0;
      let baseline = 0;
      let transfers = 0;
      const weeks = [];
      for (let gw = start; gw <= end; gw += 1) {
        const before = free;
        const bankBefore = bank;
        const recommendation = gw === start && lockedRecommendation
          ? lockedRecommendation
          : recommendationFor(ids, gw, free, true, buyingPower(ids, bank));
        if (recommendation.type === "transfer" && !recommendation.alreadyApplied) {
          bank = transferBankAfter(bank, recommendation);
          ids = idsAfterRecommendation(ids, recommendation);
        }
        const moves = transferCount(recommendation);
        const used = gw === 1 ? 0 : moves;
        const xi = bestXI(ids, gw);
        const baseXI = bestXI(baselineIds, gw);
        const points = captainedTotal(xi);
        const basePoints = captainedTotal(baseXI);
        const after = freeAfterWeek(gw, free, used);
        total += points;
        baseline += basePoints;
        transfers += moves;
        weeks.push({
          gw,
          freeBefore: before,
          freeAfter: after,
          bankBefore,
          bankAfter: bank,
          moves,
          used,
          recommendation,
          squad: ids.slice(),
          xi,
          points,
          basePoints,
        });
        free = after;
      }
      return {
        start,
        end,
        weeks,
        total,
        baseline,
        advantage: total - baseline,
        transfers,
        finalFree: free,
        finalBank: bank,
      };
    }

    return Object.freeze({ applyCurrentDecision, simulateSixWeekPlan });
  }

  global.FanTeamPlanner = Object.freeze({
    VERSION,
    DEFAULT_MAX_GAMEWEEK,
    create,
  });
})(globalThis);
