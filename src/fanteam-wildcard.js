(function attachFanTeamWildcard(global) {
  "use strict";

  const VERSION = "fanteam-wildcard-v1";

  function timestamp(value, label) {
    const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
    if (!Number.isFinite(time)) throw new Error(`${label} inválido`);
    return time;
  }

  function status(number, options) {
    if (number !== 1 && number !== 2) throw new Error("Wildcard inválida");
    const {
      used = false,
      now = Date.now(),
      startsAt,
      expiresAt,
      seasonComplete = false,
    } = options || {};
    if (used) return "used";
    if (seasonComplete) return "expired";
    const current = timestamp(now, "now");
    const start = timestamp(startsAt, "startsAt");
    const expiry = timestamp(expiresAt, "expiresAt");
    if (expiry <= start) throw new Error("ventana de Wildcard inválida");
    if (current < start) return "future";
    if (current < expiry) return "available";
    return "expired";
  }

  function create(options) {
    const {
      players,
      byId,
      horizon6,
      value,
      clubValid,
      positionQuota,
      formations,
    } = options || {};
    if (!Array.isArray(players)) throw new Error("players es obligatorio");
    if (typeof byId !== "function") throw new Error("byId es obligatorio");
    if (typeof horizon6 !== "function") throw new Error("horizon6 es obligatorio");
    if (typeof value !== "function") throw new Error("value es obligatorio");
    if (typeof clubValid !== "function") throw new Error("clubValid es obligatorio");
    if (!positionQuota || typeof positionQuota !== "object") {
      throw new Error("positionQuota es obligatorio");
    }
    if (!Array.isArray(formations)) throw new Error("formations es obligatorio");

    function squadScore(ids, scores) {
      const squad = ids.map(byId);
      let best = -1;
      let formation = "";
      for (const [defenders, midfielders, forwards] of formations) {
        const pick = (position, count) => squad
          .filter((player) => player.pos === position)
          .sort((first, second) => scores.get(second.id) - scores.get(first.id))
          .slice(0, count);
        const eleven = [
          ...pick("GK", 1),
          ...pick("DEF", defenders),
          ...pick("MID", midfielders),
          ...pick("FWD", forwards),
        ];
        if (eleven.length !== 11) continue;
        const points = eleven.reduce((total, player) => total + scores.get(player.id), 0);
        if (points > best) {
          best = points;
          formation = `${defenders}-${midfielders}-${forwards}`;
        }
      }
      const total = ids.reduce((sum, id) => sum + scores.get(id), 0);
      return {
        score: best + .08 * (total - best),
        xiPts: best,
        formation,
      };
    }

    function optimize({ gameweek, budget }) {
      const scores = new Map();
      for (const player of players) scores.set(player.id, horizon6(player, gameweek));
      const pool = { GK: [], DEF: [], MID: [], FWD: [] };
      for (const position of Object.keys(pool)) {
        const candidates = players.filter((player) => (
          player.pos === position && player.confidence >= 45
        ));
        const byScore = candidates
          .slice()
          .sort((first, second) => scores.get(second.id) - scores.get(first.id))
          .slice(0, 45);
        const cheap = candidates
          .slice()
          .sort((first, second) => first.price - second.price)
          .slice(0, 8);
        const seen = new Map();
        for (const player of byScore.concat(cheap)) seen.set(player.id, player);
        pool[position] = Array.from(seen.values());
      }

      const ids = [];
      const clubCount = {};
      for (const position of ["GK", "DEF", "MID", "FWD"]) {
        const need = positionQuota[position];
        const sorted = pool[position].slice().sort((first, second) => first.price - second.price);
        let selected = 0;
        for (const player of sorted) {
          if (selected >= need) break;
          if ((clubCount[player.club] || 0) >= 3) continue;
          ids.push(player.id);
          clubCount[player.club] = (clubCount[player.club] || 0) + 1;
          selected += 1;
        }
        if (selected < need) return null;
      }

      const feasible = (candidateIds) => (
        value(candidateIds) <= budget + .001 && clubValid(candidateIds)
      );
      if (!feasible(ids)) return null;
      let current = squadScore(ids, scores).score;
      const climb = () => {
        for (let pass = 0; pass < 60; pass += 1) {
          let bestGain = 1e-6;
          let bestIndex = -1;
          let bestIncoming = null;
          for (let index = 0; index < 15; index += 1) {
            const outgoing = byId(ids[index]);
            for (const incoming of pool[outgoing.pos]) {
              if (ids.indexOf(incoming.id) >= 0) continue;
              ids[index] = incoming.id;
              if (feasible(ids)) {
                const score = squadScore(ids, scores).score;
                if (score - current > bestGain) {
                  bestGain = score - current;
                  bestIndex = index;
                  bestIncoming = incoming.id;
                }
              }
              ids[index] = outgoing.id;
            }
          }
          if (bestIndex < 0) break;
          ids[bestIndex] = bestIncoming;
          current = squadScore(ids, scores).score;
        }
      };
      climb();

      const top = {};
      for (const position of Object.keys(pool)) {
        top[position] = pool[position]
          .slice()
          .sort((first, second) => scores.get(second.id) - scores.get(first.id))
          .slice(0, 10);
      }
      let improved = true;
      let guard = 0;
      while (improved && guard < 4) {
        improved = false;
        guard += 1;
        for (let firstIndex = 0; firstIndex < 15 && !improved; firstIndex += 1) {
          for (let secondIndex = firstIndex + 1; secondIndex < 15 && !improved; secondIndex += 1) {
            const firstOutgoing = byId(ids[firstIndex]);
            const secondOutgoing = byId(ids[secondIndex]);
            for (const firstIncoming of top[firstOutgoing.pos]) {
              if (firstIncoming.id !== firstOutgoing.id && ids.indexOf(firstIncoming.id) >= 0) continue;
              for (const secondIncoming of top[secondOutgoing.pos]) {
                if (secondIncoming.id === firstIncoming.id) continue;
                if (secondIncoming.id !== secondOutgoing.id && ids.indexOf(secondIncoming.id) >= 0) continue;
                if (firstIncoming.id === firstOutgoing.id && secondIncoming.id === secondOutgoing.id) continue;
                const oldFirst = ids[firstIndex];
                const oldSecond = ids[secondIndex];
                ids[firstIndex] = firstIncoming.id;
                ids[secondIndex] = secondIncoming.id;
                if (feasible(ids)) {
                  const score = squadScore(ids, scores).score;
                  if (score > current + 1e-6) {
                    current = score;
                    improved = true;
                    break;
                  }
                }
                ids[firstIndex] = oldFirst;
                ids[secondIndex] = oldSecond;
              }
              if (improved) break;
            }
          }
        }
        if (improved) climb();
      }

      const result = squadScore(ids, scores);
      return {
        ids: ids.slice(),
        cost: value(ids),
        score: current,
        xiPts: result.xiPts,
        formation: result.formation,
      };
    }

    return Object.freeze({ optimize, squadScore });
  }

  global.FanTeamWildcard = Object.freeze({ VERSION, create, status });
})(globalThis);
