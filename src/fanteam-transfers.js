(function attachFanTeamTransfers(global) {
  "use strict";

  const VERSION = "fanteam-transfers-v1";

  function transferCount(recommendation) {
    return recommendation?.type === "transfer" ? (recommendation.double ? 2 : 1) : 0;
  }

  function idsAfterRecommendation(ids, recommendation) {
    if (recommendation?.type !== "transfer") return ids.slice();
    return ids.map((id) => (
      id === recommendation.out.id
        ? recommendation.inn.id
        : recommendation.double && id === recommendation.out2.id
          ? recommendation.inn2.id
          : id
    ));
  }

  function transferBankAfter(bank, recommendation) {
    if (recommendation?.type !== "transfer") return Number(bank || 0);
    let next = Number(bank || 0) + recommendation.out.price - recommendation.inn.price;
    if (recommendation.double) {
      next += recommendation.out2.price - recommendation.inn2.price;
    }
    return Math.round(next * 10) / 10;
  }

  function freeAfterWeek(gameweek, free, used) {
    return gameweek === 1 ? 1 : Math.min(37, Math.max(0, free - used) + 1);
  }

  function create(options) {
    const {
      players,
      byId,
      value,
      clubValid,
      horizon,
    } = options || {};
    if (!Array.isArray(players)) throw new Error("players es obligatorio");
    if (typeof byId !== "function") throw new Error("byId es obligatorio");
    if (typeof value !== "function") throw new Error("value es obligatorio");
    if (typeof clubValid !== "function") throw new Error("clubValid es obligatorio");
    if (typeof horizon !== "function") throw new Error("horizon es obligatorio");

    function selectedBy(player) {
      const value = Number(player?.reference?.selectedBy);
      return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
    }

    function differentialMeta(player) {
      const ownership = selectedBy(player);
      return ownership != null && ownership <= 15
        ? { selectedBy: ownership, source: "FPL" }
        : null;
    }

    function recommendationFor(ids, gameweek, free, allowDouble = true, funds = 100) {
      const horizonCache = new Map();
      const projected = (player) => {
        const key = `${player.id}|${gameweek}`;
        if (!horizonCache.has(key)) horizonCache.set(key, horizon(player, gameweek));
        return horizonCache.get(key);
      };
      if (gameweek > 1 && free <= 0) {
        return {
          type: "save",
          gain: 0,
          reason: "No hay transferencias libres disponibles. Conviene esperar; el modelo no recomienda movimientos con penalización de puntos.",
        };
      }
      const squad = ids.map(byId);
      const moves = [];
      for (const out of squad) {
        for (const inn of players) {
          if (inn.pos !== out.pos || ids.includes(inn.id) || inn.confidence < 45) continue;
          const next = ids.map((id) => (id === out.id ? inn.id : id));
          if (value(next) > funds + .001 || !clubValid(next)) continue;
          const gain = projected(inn, gameweek) - projected(out, gameweek);
          moves.push({
            out,
            inn,
            gain,
            differential: differentialMeta(inn),
          });
        }
      }
      const peak = moves.reduce((current, move) => (
        !current || move.gain > current.gain ? move : current
      ), null);
      let best = peak || { gain: -999 };
      if (peak && selectedBy(peak.inn) != null) {
        const competitive = moves
          .filter((move) => (
            move.out.id === peak.out.id
            && move.gain >= peak.gain - .05
            && selectedBy(move.inn) != null
          ))
          .sort((first, second) => (
            selectedBy(first.inn) - selectedBy(second.inn)
            || second.gain - first.gain
          ));
        if (competitive.length) best = competitive[0];
      }
      best.differentialTieBreak = Boolean(peak && best !== peak);
      let pair = null;
      if (allowDouble && free >= 2 && gameweek > 1) {
        const candidates = {};
        for (const position of ["GK", "DEF", "MID", "FWD"]) {
          candidates[position] = players
            .filter((player) => (
              player.pos === position && !ids.includes(player.id) && player.confidence >= 45
            ))
            .sort((first, second) => projected(second, gameweek) - projected(first, gameweek))
            .slice(0, 18);
        }
        for (let firstIndex = 0; firstIndex < squad.length; firstIndex += 1) {
          for (let secondIndex = firstIndex + 1; secondIndex < squad.length; secondIndex += 1) {
            const firstOut = squad[firstIndex];
            const secondOut = squad[secondIndex];
            const baseIds = ids.filter((id) => id !== firstOut.id && id !== secondOut.id);
            const budget = funds + .001 - value(baseIds);
            const outgoingHorizon = projected(firstOut, gameweek) + projected(secondOut, gameweek);
            for (const firstIn of candidates[firstOut.pos]) {
              for (const secondIn of candidates[secondOut.pos]) {
                if (secondIn.id === firstIn.id) continue;
                if (firstIn.price + secondIn.price > budget) continue;
                const gain = projected(firstIn, gameweek)
                  + projected(secondIn, gameweek)
                  - outgoingHorizon;
                if (pair && gain <= pair.gain) continue;
                const nextIds = baseIds.concat([firstIn.id, secondIn.id]);
                if (!clubValid(nextIds)) continue;
                pair = {
                  out: firstOut,
                  inn: firstIn,
                  out2: secondOut,
                  inn2: secondIn,
                  gain,
                };
              }
            }
          }
        }
      }
      const singleGain = Math.max(0, best.gain);
      if (pair && pair.gain >= singleGain + 1.05 && pair.gain >= 2.1) {
        return {
          type: "transfer",
          double: true,
          out: pair.out,
          inn: pair.inn,
          out2: pair.out2,
          inn2: pair.inn2,
          gain: pair.gain,
          reason: `Doble cambio con tus dos transferencias libres: mejora conjunta de ${pair.gain.toFixed(2)} puntos ponderados, ${(pair.gain - singleGain).toFixed(2)} más que el mejor cambio individual.`,
        };
      }
      const emergency = best.out && best.out.confidence < 25;
      const threshold = free > 1 ? 1.05 : 1.65;
      if (!best.out || (!emergency && best.gain < threshold)) {
        return {
          type: "save",
          gain: Math.max(0, best.gain),
          reason: `La mejor alternativa solo mejora ${Math.max(0, best.gain).toFixed(2)} puntos ponderados en tres jornadas. Conviene acumular la transferencia.`,
        };
      }
      const differential = differentialMeta(best.inn);
      const differentialNote = differential
        ? ` ${best.inn.name} tiene ${differential.selectedBy.toFixed(1)}% de selección FPL y se señala como alternativa diferencial; la ganancia esperada sigue siendo el criterio principal.`
        : "";
      const tieBreakNote = best.differentialTieBreak
        ? " La selección FPL solo desempató alternativas separadas por 0.05 puntos o menos."
        : "";
      return {
        type: "transfer",
        ...best,
        reason: (emergency
          ? "El jugador saliente tiene alto riesgo de no jugar."
          : `La mejora ponderada supera el umbral de ${threshold.toFixed(2)} puntos para gastar una transferencia.`) + differentialNote + tieBreakNote,
      };
    }

    return Object.freeze({
      freeAfterWeek,
      idsAfterRecommendation,
      recommendationFor,
      transferBankAfter,
      transferCount,
    });
  }

  global.FanTeamTransfers = Object.freeze({
    VERSION,
    create,
    freeAfterWeek,
    idsAfterRecommendation,
    transferBankAfter,
    transferCount,
  });
})(globalThis);
