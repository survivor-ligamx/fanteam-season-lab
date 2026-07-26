/* Data-only worker adapter for FanTeamWildcard. The main app can post a serializable
   catalog and scoring snapshot here without moving DOM, storage, or network. */
self.onmessage = (event) => {
  const message = event.data || {};
  if (message.type !== "optimize") return;
  try {
    const { players, scores, budget, quotas, formations } = message;
    if (!Array.isArray(players) || !Array.isArray(scores) || !Number.isFinite(budget)) {
      throw new Error("payload de Wildcard inválido");
    }
    const scoreById = new Map(scores.map((item) => [Number(item.id), Number(item.value)]));
    const pool = { GK: [], DEF: [], MID: [], FWD: [] };
    for (const position of Object.keys(pool)) {
      const candidates = players.filter((player) => player.pos === position && player.confidence >= 45);
      const ranked = candidates.slice().sort((a, b) => scoreById.get(b.id) - scoreById.get(a.id)).slice(0, 45);
      const cheap = candidates.slice().sort((a, b) => a.price - b.price).slice(0, 8);
      const seen = new Map();
      for (const player of ranked.concat(cheap)) seen.set(player.id, player);
      pool[position] = [...seen.values()];
    }
    const ids = [];
    const clubs = {};
    for (const position of ["GK", "DEF", "MID", "FWD"]) {
      let selected = 0;
      for (const player of pool[position].slice().sort((a, b) => a.price - b.price)) {
        if (selected >= quotas[position]) break;
        if ((clubs[player.club] || 0) >= 3) continue;
        ids.push(player.id); clubs[player.club] = (clubs[player.club] || 0) + 1; selected += 1;
      }
      if (selected < quotas[position]) throw new Error(`sin candidatos suficientes para ${position}`);
    }
    const playerById = new Map(players.map((player) => [player.id, player]));
    const value = (candidateIds) => candidateIds.reduce((sum, id) => sum + playerById.get(id).price, 0);
    const valid = (candidateIds) => {
      if (value(candidateIds) > budget + 0.001) return false;
      const count = {};
      for (const id of candidateIds) { const club = playerById.get(id).club; count[club] = (count[club] || 0) + 1; if (count[club] > 3) return false; }
      return true;
    };
    const scoreSquad = (candidateIds) => {
      let best = -1; let formation = null;
      for (const [defenders, midfielders, forwards] of formations) {
        const pick = (position, count) => candidateIds.map((id) => playerById.get(id)).filter((player) => player.pos === position).sort((a, b) => scoreById.get(b.id) - scoreById.get(a.id)).slice(0, count);
        const eleven = [...pick("GK", 1), ...pick("DEF", defenders), ...pick("MID", midfielders), ...pick("FWD", forwards)];
        if (eleven.length !== 11) continue;
        const points = eleven.reduce((sum, player) => sum + scoreById.get(player.id), 0);
        if (points > best) { best = points; formation = `${defenders}-${midfielders}-${forwards}`; }
      }
      const bench = candidateIds.reduce((sum, id) => sum + scoreById.get(id), 0) - best;
      return { score: best + 0.08 * bench, xiPts: best, formation };
    };
    if (!valid(ids)) throw new Error("la semilla más barata no es factible");
    let current = scoreSquad(ids).score;
    const climb = () => {
      for (let pass = 0; pass < 60; pass += 1) {
        let bestGain = 1e-6; let bestIndex = -1; let bestIncoming = null;
        for (let index = 0; index < ids.length; index += 1) {
          const outgoing = playerById.get(ids[index]);
          for (const incoming of pool[outgoing.pos]) {
            if (ids.includes(incoming.id)) continue;
            ids[index] = incoming.id;
            if (valid(ids)) {
              const next = scoreSquad(ids).score;
              if (next - current > bestGain) {
                bestGain = next - current;
                bestIndex = index;
                bestIncoming = incoming.id;
              }
            }
            ids[index] = outgoing.id;
          }
        }
        if (bestIndex < 0) break;
        ids[bestIndex] = bestIncoming;
        current = scoreSquad(ids).score;
      }
    };
    climb();

    const top = {};
    for (const position of Object.keys(pool)) {
      top[position] = pool[position]
        .slice()
        .sort((a, b) => scoreById.get(b.id) - scoreById.get(a.id))
        .slice(0, 10);
    }
    let improved = true;
    let guard = 0;
    while (improved && guard < 4) {
      improved = false;
      guard += 1;
      for (let firstIndex = 0; firstIndex < ids.length && !improved; firstIndex += 1) {
        for (let secondIndex = firstIndex + 1; secondIndex < ids.length && !improved; secondIndex += 1) {
          const firstOutgoing = playerById.get(ids[firstIndex]);
          const secondOutgoing = playerById.get(ids[secondIndex]);
          for (const firstIncoming of top[firstOutgoing.pos]) {
            if (firstIncoming.id !== firstOutgoing.id && ids.includes(firstIncoming.id)) continue;
            for (const secondIncoming of top[secondOutgoing.pos]) {
              if (secondIncoming.id === firstIncoming.id) continue;
              if (secondIncoming.id !== secondOutgoing.id && ids.includes(secondIncoming.id)) continue;
              if (firstIncoming.id === firstOutgoing.id && secondIncoming.id === secondOutgoing.id) continue;
              const oldFirst = ids[firstIndex];
              const oldSecond = ids[secondIndex];
              ids[firstIndex] = firstIncoming.id;
              ids[secondIndex] = secondIncoming.id;
              if (valid(ids)) {
                const next = scoreSquad(ids).score;
                if (next > current + 1e-6) {
                  current = next;
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

    const result = scoreSquad(ids);
    self.postMessage({ type: "result", ids, cost: value(ids), score: result.score, xiPts: result.xiPts, formation: result.formation });
  } catch (error) {
    self.postMessage({ type: "error", message: error?.message || "error de optimización" });
  }
};
