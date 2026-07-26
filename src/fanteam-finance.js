(function attachFanTeamFinance(global) {
  "use strict";

  const VERSION = "fanteam-finance-v1";
  const MAX_PLAYERS_PER_CLUB = 3;

  function validPrice(value) {
    return typeof value === "number"
      && isFinite(value)
      && value >= 3
      && value <= 20;
  }

  function create(options) {
    const { byId, getState } = options || {};
    if (typeof byId !== "function") throw new Error("byId es obligatorio");
    if (typeof getState !== "function") throw new Error("getState es obligatorio");

    function value(ids) {
      return ids.reduce((total, id) => {
        const player = byId(id);
        return total + (player ? player.price : 0);
      }, 0);
    }

    function purchaseCost(ids) {
      const state = getState();
      const squadIds = ids === undefined ? state.squad : ids;
      return squadIds.reduce((total, id) => {
        const player = byId(id);
        if (!player) return total;
        const stored = Number(state.purchasePrices?.[id]);
        return total + (validPrice(stored) ? stored : player.price);
      }, 0);
    }

    function squadGain(ids) {
      const squadIds = ids === undefined ? getState().squad : ids;
      return value(squadIds) - purchaseCost(squadIds);
    }

    function buyingPower(ids, bank) {
      const state = getState();
      const squadIds = ids === undefined ? state.squad : ids;
      const availableBank = bank === undefined ? state.bank : bank;
      return value(squadIds) + Number(availableBank || 0);
    }

    function clubValid(ids) {
      const counts = {};
      for (const id of ids) {
        const player = byId(id);
        if (!player) return false;
        const club = player.club;
        counts[club] = (counts[club] || 0) + 1;
        if (counts[club] > MAX_PLAYERS_PER_CLUB) return false;
      }
      return true;
    }

    return Object.freeze({
      buyingPower,
      clubValid,
      purchaseCost,
      squadGain,
      value,
    });
  }

  global.FanTeamFinance = Object.freeze({
    VERSION,
    MAX_PLAYERS_PER_CLUB,
    create,
    validPrice,
  });
})(globalThis);
