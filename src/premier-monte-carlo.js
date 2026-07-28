(function attachPremierMonteCarlo(global) {
  "use strict";

  const VERSION = "premier-monte-carlo-v1";
  const DEFAULT_SCENARIOS = 10000;
  const DEFAULT_CANDIDATES = 64;
  const MIN_SCENARIOS = 1000;
  const MAX_SCENARIOS = 25000;
  const MIN_CANDIDATES = 8;
  const MAX_CANDIDATES = 96;
  const MAX_PLAYERS_PER_CLUB = 3;
  const ALTERNATIVE_LINEUP_PENALTY = 0.35;
  const ALTERNATIVE_SIGMA_INCREMENT = 2;
  const BASE_MAX_SIGMA = 24;
  const POSITION_QUOTA = Object.freeze({ GK: 2, DEF: 5, MID: 5, FWD: 3 });
  const FORMATIONS = Object.freeze([
    Object.freeze([3, 5, 2]),
    Object.freeze([3, 4, 3]),
    Object.freeze([4, 5, 1]),
    Object.freeze([4, 4, 2]),
    Object.freeze([4, 3, 3]),
    Object.freeze([5, 4, 1]),
    Object.freeze([5, 3, 2]),
    Object.freeze([5, 2, 3]),
  ]);
  const BENCH_WEIGHT = 0.08;
  const DOWNSIDE_WEIGHT = 0.25;
  const CONSERVATIVE_SIGMA_WEIGHT = 0.35;
  const GLOBAL_SHOCK_WEIGHT = 0.15;
  const CLUB_SHOCK_WEIGHT = 0.30;
  const PLAYER_SHOCK_WEIGHT = Math.sqrt(
    1 - GLOBAL_SHOCK_WEIGHT ** 2 - CLUB_SHOCK_WEIGHT ** 2,
  );

  function finite(value) {
    if (value == null || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function boundedInteger(value, fallback, minimum, maximum) {
    const number = Number(value);
    const safe = Number.isSafeInteger(number) ? number : fallback;
    return clamp(safe, minimum, maximum);
  }

  function stableSeed(value) {
    const text = String(value || "");
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) || 1;
  }

  function uncertaintyFor(row) {
    const base = { GK: 8, DEF: 9.5, MID: 10.5, FWD: 11.5 }[row?.player?.pos] || 10;
    const disagreement = clamp(finite(row?.disagreement) ?? 0, 0, 100);
    let uncertainty = base + 0.14 * disagreement;
    if (!row?.draftUsed) uncertainty += 1;
    if (row?.sourcePositionMismatch) uncertainty += 1.5;
    const bounded = clamp(uncertainty, 6, BASE_MAX_SIGMA);
    return row?.probableLineupRole === "alternative"
      ? bounded + ALTERNATIVE_SIGMA_INCREMENT
      : bounded;
  }

  function normalizeQuotas(value) {
    const source = value && typeof value === "object" ? value : POSITION_QUOTA;
    const quotas = {};
    for (const position of Object.keys(POSITION_QUOTA)) {
      quotas[position] = boundedInteger(
        source[position],
        POSITION_QUOTA[position],
        1,
        15,
      );
    }
    if (Object.values(quotas).reduce((total, count) => total + count, 0) !== 15) {
      throw new Error("las cuotas Monte Carlo deben sumar 15 jugadores");
    }
    return quotas;
  }

  function normalizeFormations(value) {
    const source = Array.isArray(value) ? value : FORMATIONS;
    const formations = source.map((formation) => {
      if (!Array.isArray(formation) || formation.length !== 3) return null;
      const normalized = formation.map(Number);
      if (normalized.some((number) => !Number.isSafeInteger(number) || number < 0)) return null;
      if (1 + normalized.reduce((total, number) => total + number, 0) !== 11) return null;
      return normalized;
    }).filter(Boolean);
    if (!formations.length) throw new Error("no hay formaciones Monte Carlo válidas");
    return formations;
  }

  function createPayload(consensus, options = {}) {
    if (!consensus?.squad || !Array.isArray(consensus.squad.ids)) {
      throw new Error("se necesita una plantilla base para Monte Carlo");
    }
    if (!Array.isArray(consensus.rows) || !consensus.rows.length) {
      throw new Error("se necesitan filas de consenso para Monte Carlo");
    }
    const players = consensus.rows.filter((row) => row?.eligible).map((row) => ({
      id: Number(row.player?.id),
      pos: String(row.player?.pos || ""),
      club: String(row.player?.club || ""),
      price: finite(row.price),
      mean: finite(row.score),
      sigma: uncertaintyFor(row),
      lineupMean: finite(row.fanteamPoints),
      lineupPenalty: row.probableLineupRole === "alternative" ? ALTERNATIVE_LINEUP_PENALTY : 0,
    })).filter((player) => (
      Number.isSafeInteger(player.id)
        && player.id > 0
        && Object.prototype.hasOwnProperty.call(POSITION_QUOTA, player.pos)
        && player.club
        && player.price != null
        && player.price > 0
        && player.mean != null
        && player.lineupMean != null
    ));
    if (players.length < 15) throw new Error("no hay suficientes jugadores elegibles para Monte Carlo");

    const scenarioCount = boundedInteger(
      options.scenarioCount,
      DEFAULT_SCENARIOS,
      MIN_SCENARIOS,
      MAX_SCENARIOS,
    );
    const candidateLimit = boundedInteger(
      options.candidateLimit,
      DEFAULT_CANDIDATES,
      MIN_CANDIDATES,
      MAX_CANDIDATES,
    );
    const baseIds = consensus.squad.ids.map(Number);
    const seedMaterial = players.slice().sort((first, second) => first.id - second.id)
      .map((player) => `${player.id}:${player.mean.toFixed(4)}:${player.sigma.toFixed(4)}:${player.lineupPenalty.toFixed(2)}`)
      .join("|");
    const requestedSeed = Number(options.seed);
    const seed = Number.isSafeInteger(requestedSeed)
      ? requestedSeed >>> 0
      : stableSeed(`${VERSION}|${consensus.gameweek}|${baseIds.slice().sort((a, b) => a - b).join(",")}|${seedMaterial}`);

    return {
      type: "simulate",
      version: VERSION,
      seed: seed || 1,
      scenarioCount,
      candidateLimit,
      budget: finite(consensus.budget),
      quotas: normalizeQuotas(options.quotas),
      formations: normalizeFormations(options.formations),
      maxPlayersPerClub: MAX_PLAYERS_PER_CLUB,
      benchWeight: BENCH_WEIGHT,
      downsideWeight: DOWNSIDE_WEIGHT,
      baseIds,
      players,
    };
  }

  function preparePayload(payload) {
    if (!payload || payload.type !== "simulate" || payload.version !== VERSION) {
      throw new Error("payload Monte Carlo incompatible");
    }
    const scenarioCount = boundedInteger(
      payload.scenarioCount,
      DEFAULT_SCENARIOS,
      MIN_SCENARIOS,
      MAX_SCENARIOS,
    );
    const candidateLimit = boundedInteger(
      payload.candidateLimit,
      DEFAULT_CANDIDATES,
      MIN_CANDIDATES,
      MAX_CANDIDATES,
    );
    const budget = finite(payload.budget);
    if (budget == null || budget <= 0) throw new Error("presupuesto Monte Carlo inválido");
    const quotas = normalizeQuotas(payload.quotas);
    const formations = normalizeFormations(payload.formations);
    const players = Array.isArray(payload.players) ? payload.players.map((raw) => ({
      id: Number(raw?.id),
      pos: String(raw?.pos || ""),
      club: String(raw?.club || ""),
      price: finite(raw?.price),
      mean: finite(raw?.mean),
      sigma: finite(raw?.sigma),
      lineupMean: finite(raw?.lineupMean),
      lineupPenalty: clamp(finite(raw?.lineupPenalty) ?? 0, 0, ALTERNATIVE_LINEUP_PENALTY),
    })).filter((player) => (
      Number.isSafeInteger(player.id)
        && player.id > 0
        && Object.prototype.hasOwnProperty.call(quotas, player.pos)
        && player.club
        && player.price != null
        && player.price > 0
        && player.mean != null
        && player.sigma != null
        && player.sigma >= 0
        && player.lineupMean != null
    )) : [];
    const playerById = new Map(players.map((player) => [player.id, player]));
    if (playerById.size !== players.length || players.length < 15) {
      throw new Error("catálogo Monte Carlo inválido o duplicado");
    }
    const baseIds = Array.isArray(payload.baseIds) ? payload.baseIds.map(Number) : [];
    return {
      seed: (Number(payload.seed) >>> 0) || 1,
      scenarioCount,
      candidateLimit,
      budget,
      quotas,
      formations,
      maxPlayersPerClub: boundedInteger(
        payload.maxPlayersPerClub,
        MAX_PLAYERS_PER_CLUB,
        1,
        15,
      ),
      benchWeight: clamp(finite(payload.benchWeight) ?? BENCH_WEIGHT, 0, 1),
      downsideWeight: clamp(finite(payload.downsideWeight) ?? DOWNSIDE_WEIGHT, 0, 1),
      players,
      playerById,
      baseIds,
    };
  }

  function candidateKey(ids) {
    return ids.slice().sort((first, second) => first - second).join(",");
  }

  function validateIds(ids, data) {
    if (!Array.isArray(ids) || ids.length !== 15 || new Set(ids).size !== 15) return null;
    const players = ids.map((id) => data.playerById.get(Number(id)));
    if (players.some((player) => !player)) return null;
    const positions = {};
    const clubs = {};
    let cost = 0;
    for (const player of players) {
      positions[player.pos] = (positions[player.pos] || 0) + 1;
      clubs[player.club] = (clubs[player.club] || 0) + 1;
      if (clubs[player.club] > data.maxPlayersPerClub) return null;
      cost += player.price;
    }
    if (cost > data.budget + 0.001) return null;
    if (!Object.entries(data.quotas).every(([position, quota]) => positions[position] === quota)) {
      return null;
    }
    return { players, cost };
  }

  function ranked(players, key) {
    return players.slice().sort((first, second) => (
      second[key] - first[key]
        || second.mean - first.mean
        || first.id - second.id
    ));
  }

  function fixedLineup(ids, data) {
    const validation = validateIds(ids, data);
    if (!validation) return null;
    let selected = null;
    for (const [defenders, midfielders, forwards] of data.formations) {
      const lineupValue = (player) => player.lineupMean - player.lineupPenalty;
      const pick = (position, count) => validation.players
        .filter((player) => player.pos === position)
        .sort((first, second) => (
          lineupValue(second) - lineupValue(first)
            || second.lineupMean - first.lineupMean
            || first.id - second.id
        ))
        .slice(0, count);
      const xi = [
        ...pick("GK", 1),
        ...pick("DEF", defenders),
        ...pick("MID", midfielders),
        ...pick("FWD", forwards),
      ];
      if (xi.length !== 11) continue;
      const lineupTotal = xi.reduce((total, player) => total + player.lineupMean, 0);
      const lineupSelectionTotal = xi.reduce((total, player) => total + lineupValue(player), 0);
      if (!selected || lineupSelectionTotal > selected.lineupSelectionTotal + 1e-9) {
        selected = {
          xi,
          lineupTotal,
          lineupSelectionTotal,
          formation: `${defenders}-${midfielders}-${forwards}`,
        };
      }
    }
    if (!selected) return null;
    const xiSet = new Set(selected.xi.map((player) => player.id));
    const bench = validation.players.filter((player) => !xiSet.has(player.id));
    const expected = selected.xi.reduce((total, player) => total + player.mean, 0)
      + data.benchWeight * bench.reduce((total, player) => total + player.mean, 0);
    const safeValue = (player) => player.mean - CONSERVATIVE_SIGMA_WEIGHT * player.sigma;
    const conservative = selected.xi.reduce((total, player) => total + safeValue(player), 0)
      + data.benchWeight * bench.reduce((total, player) => total + safeValue(player), 0);
    return {
      ids: validation.players.map((player) => player.id),
      key: candidateKey(ids),
      cost: validation.cost,
      formation: selected.formation,
      xiIds: selected.xi.map((player) => player.id),
      benchIds: bench.map((player) => player.id),
      lineupPoints: selected.lineupTotal,
      expected,
      conservative,
    };
  }

  function compareCandidate(key) {
    return (first, second) => (
      second[key] - first[key]
        || second.expected - first.expected
        || first.key.localeCompare(second.key)
    );
  }

  function keepTop(list, candidate, key, limit) {
    if (list.some((existing) => existing.key === candidate.key)) return;
    if (list.length < limit) {
      list.push(candidate);
      list.sort(compareCandidate(key));
      return;
    }
    const comparator = compareCandidate(key);
    if (comparator(candidate, list[list.length - 1]) < 0) {
      list[list.length - 1] = candidate;
      list.sort(comparator);
    }
  }

  function playerPools(data) {
    const pools = {};
    for (const position of Object.keys(data.quotas)) {
      const players = data.players.filter((player) => player.pos === position);
      const expected = players.slice().sort((first, second) => (
        second.mean - first.mean || first.id - second.id
      )).slice(0, 16);
      const conservative = players.slice().sort((first, second) => (
        (second.mean - CONSERVATIVE_SIGMA_WEIGHT * second.sigma)
          - (first.mean - CONSERVATIVE_SIGMA_WEIGHT * first.sigma)
          || first.id - second.id
      )).slice(0, 10);
      const cheap = players.slice().sort((first, second) => (
        first.price - second.price || second.mean - first.mean || first.id - second.id
      )).slice(0, 6);
      pools[position] = [...new Map(
        expected.concat(conservative, cheap).map((player) => [player.id, player]),
      ).values()];
    }
    return pools;
  }

  function generateCandidates(data) {
    const base = fixedLineup(data.baseIds, data);
    if (!base) throw new Error("la plantilla base Monte Carlo no es válida");
    const expectedTop = [];
    const conservativeTop = [];
    const retain = Math.max(data.candidateLimit, 24);
    const consider = (ids) => {
      const candidate = fixedLineup(ids, data);
      if (!candidate) return;
      keepTop(expectedTop, candidate, "expected", retain);
      keepTop(conservativeTop, candidate, "conservative", retain);
    };
    consider(base.ids);

    const pools = playerPools(data);
    const baseSet = new Set(base.ids);
    for (let index = 0; index < base.ids.length; index += 1) {
      const outgoing = data.playerById.get(base.ids[index]);
      for (const incoming of pools[outgoing.pos]) {
        if (baseSet.has(incoming.id)) continue;
        const ids = base.ids.slice();
        ids[index] = incoming.id;
        consider(ids);
      }
    }

    for (let firstIndex = 0; firstIndex < base.ids.length; firstIndex += 1) {
      const firstOutgoing = data.playerById.get(base.ids[firstIndex]);
      for (let secondIndex = firstIndex + 1; secondIndex < base.ids.length; secondIndex += 1) {
        const secondOutgoing = data.playerById.get(base.ids[secondIndex]);
        for (const firstIncoming of pools[firstOutgoing.pos]) {
          if (baseSet.has(firstIncoming.id)) continue;
          for (const secondIncoming of pools[secondOutgoing.pos]) {
            if (baseSet.has(secondIncoming.id) || firstIncoming.id === secondIncoming.id) continue;
            const ids = base.ids.slice();
            ids[firstIndex] = firstIncoming.id;
            ids[secondIndex] = secondIncoming.id;
            consider(ids);
          }
        }
      }
    }

    const combined = new Map([[base.key, base]]);
    let expectedIndex = 0;
    let conservativeIndex = 0;
    while (combined.size < data.candidateLimit
      && (expectedIndex < expectedTop.length || conservativeIndex < conservativeTop.length)) {
      if (expectedIndex < expectedTop.length) {
        const candidate = expectedTop[expectedIndex];
        combined.set(candidate.key, candidate);
        expectedIndex += 1;
      }
      if (combined.size >= data.candidateLimit) break;
      if (conservativeIndex < conservativeTop.length) {
        const candidate = conservativeTop[conservativeIndex];
        combined.set(candidate.key, candidate);
        conservativeIndex += 1;
      }
    }
    return [...combined.values()].slice(0, data.candidateLimit);
  }

  function randomFactory(seed) {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6D2B79F5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  function normalSample(random) {
    let total = 0;
    for (let index = 0; index < 12; index += 1) total += random();
    return total - 6;
  }

  function quantile(sorted, probability) {
    if (!sorted.length) return 0;
    const position = (sorted.length - 1) * probability;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper) return sorted[lower];
    const weight = position - lower;
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }

  function simulate(payload) {
    const startedAt = Date.now();
    const data = preparePayload(payload);
    const candidates = generateCandidates(data);
    if (!candidates.length) throw new Error("no se generaron plantillas candidatas");

    const usedIds = [...new Set(candidates.flatMap((candidate) => candidate.ids))];
    const simulationPlayers = usedIds.map((id) => data.playerById.get(id));
    const indexById = new Map(simulationPlayers.map((player, index) => [player.id, index]));
    const clubs = [...new Set(simulationPlayers.map((player) => player.club))].sort();
    const clubIndex = new Map(clubs.map((club, index) => [club, index]));
    const xiIndexes = candidates.map((candidate) => candidate.xiIds.map((id) => indexById.get(id)));
    const benchIndexes = candidates.map((candidate) => candidate.benchIds.map((id) => indexById.get(id)));
    const outcomes = candidates.map(() => new Float64Array(data.scenarioCount));
    const totals = new Float64Array(candidates.length);
    const scenarioWins = new Uint32Array(candidates.length);
    const blockWins = new Uint32Array(candidates.length);
    const blockCount = Math.min(20, Math.max(4, Math.floor(data.scenarioCount / 250)));
    const blockSize = Math.ceil(data.scenarioCount / blockCount);
    const blockTotals = new Float64Array(candidates.length);
    let completedBlocks = 0;
    const values = new Float64Array(simulationPlayers.length);
    const clubShocks = new Float64Array(clubs.length);
    const random = randomFactory(data.seed);

    for (let scenario = 0; scenario < data.scenarioCount; scenario += 1) {
      const globalShock = normalSample(random);
      for (let index = 0; index < clubs.length; index += 1) {
        clubShocks[index] = normalSample(random);
      }
      for (let index = 0; index < simulationPlayers.length; index += 1) {
        const player = simulationPlayers[index];
        const shock = GLOBAL_SHOCK_WEIGHT * globalShock
          + CLUB_SHOCK_WEIGHT * clubShocks[clubIndex.get(player.club)]
          + PLAYER_SHOCK_WEIGHT * normalSample(random);
        values[index] = player.mean + player.sigma * shock;
      }

      let scenarioWinner = 0;
      let scenarioBest = -Infinity;
      for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
        let value = 0;
        for (const index of xiIndexes[candidateIndex]) value += values[index];
        for (const index of benchIndexes[candidateIndex]) value += data.benchWeight * values[index];
        outcomes[candidateIndex][scenario] = value;
        totals[candidateIndex] += value;
        blockTotals[candidateIndex] += value;
        if (value > scenarioBest + 1e-9
          || (Math.abs(value - scenarioBest) <= 1e-9
            && candidates[candidateIndex].key < candidates[scenarioWinner].key)) {
          scenarioBest = value;
          scenarioWinner = candidateIndex;
        }
      }
      scenarioWins[scenarioWinner] += 1;

      const blockFinished = (scenario + 1) % blockSize === 0
        || scenario === data.scenarioCount - 1;
      if (blockFinished) {
        let blockWinner = 0;
        for (let candidateIndex = 1; candidateIndex < candidates.length; candidateIndex += 1) {
          if (blockTotals[candidateIndex] > blockTotals[blockWinner] + 1e-9
            || (Math.abs(blockTotals[candidateIndex] - blockTotals[blockWinner]) <= 1e-9
              && candidates[candidateIndex].key < candidates[blockWinner].key)) {
            blockWinner = candidateIndex;
          }
        }
        blockWins[blockWinner] += 1;
        blockTotals.fill(0);
        completedBlocks += 1;
      }
    }

    const stats = candidates.map((candidate, index) => {
      const sorted = Float64Array.from(outcomes[index]);
      sorted.sort();
      const mean = totals[index] / data.scenarioCount;
      const p10 = quantile(sorted, 0.10);
      const p50 = quantile(sorted, 0.50);
      const p90 = quantile(sorted, 0.90);
      const downside = Math.max(0, mean - p10);
      return {
        index,
        ids: candidate.ids.slice(),
        key: candidate.key,
        cost: candidate.cost,
        formation: candidate.formation,
        mean,
        p10,
        p50,
        p90,
        downside,
        objective: mean - data.downsideWeight * downside,
        winRate: scenarioWins[index] / data.scenarioCount,
        stability: completedBlocks ? blockWins[index] / completedBlocks : 0,
      };
    });
    stats.sort((first, second) => (
      second.objective - first.objective
        || second.mean - first.mean
        || second.p10 - first.p10
        || first.key.localeCompare(second.key)
    ));
    const winner = stats[0];
    const baseKey = candidateKey(data.baseIds);
    const baseline = stats.find((candidate) => candidate.key === baseKey) || winner;
    const baseSet = new Set(data.baseIds);
    const changesFromBase = winner.ids.filter((id) => !baseSet.has(id)).length;

    return {
      type: "result",
      version: VERSION,
      seed: data.seed,
      scenarioCount: data.scenarioCount,
      candidateCount: candidates.length,
      durationMs: Math.max(0, Date.now() - startedAt),
      changesFromBase,
      winner: {
        ids: winner.ids,
        cost: winner.cost,
        formation: winner.formation,
        mean: winner.mean,
        p10: winner.p10,
        p50: winner.p50,
        p90: winner.p90,
        downside: winner.downside,
        objective: winner.objective,
        winRate: winner.winRate,
        stability: winner.stability,
      },
      baseline: {
        mean: baseline.mean,
        p10: baseline.p10,
        objective: baseline.objective,
      },
    };
  }

  function validateResult(message, payload) {
    const data = preparePayload(payload);
    if (!message || message.type !== "result" || message.version !== VERSION) {
      throw new Error("resultado Monte Carlo incompatible");
    }
    if (Number(message.seed) !== data.seed
      || Number(message.scenarioCount) !== data.scenarioCount) {
      throw new Error("el resultado Monte Carlo no corresponde a la solicitud activa");
    }
    const ids = Array.isArray(message.winner?.ids) ? message.winner.ids.map(Number) : [];
    const candidate = fixedLineup(ids, data);
    if (!candidate) throw new Error("Monte Carlo devolvió una plantilla ilegal");
    const metrics = {};
    for (const key of ["mean", "p10", "p50", "p90", "downside", "objective", "winRate", "stability"]) {
      const value = finite(message.winner?.[key]);
      if (value == null) throw new Error(`métrica Monte Carlo inválida: ${key}`);
      metrics[key] = value;
    }
    if (metrics.p10 > metrics.p50 + 1e-6 || metrics.p50 > metrics.p90 + 1e-6) {
      throw new Error("percentiles Monte Carlo desordenados");
    }
    if (metrics.winRate < 0 || metrics.winRate > 1 || metrics.stability < 0 || metrics.stability > 1) {
      throw new Error("estabilidad Monte Carlo fuera de rango");
    }
    const rawCandidateCount = Number(message.candidateCount);
    if (!Number.isSafeInteger(rawCandidateCount)
      || rawCandidateCount < 1 || rawCandidateCount > data.candidateLimit) {
      throw new Error("cantidad de candidatas Monte Carlo inválida");
    }
    const candidateCount = rawCandidateCount;
    const rawChangesFromBase = Number(message.changesFromBase);
    if (!Number.isSafeInteger(rawChangesFromBase)
      || rawChangesFromBase < 0 || rawChangesFromBase > 15) {
      throw new Error("cambios Monte Carlo fuera de rango");
    }
    const changesFromBase = rawChangesFromBase;
    const baselineObjective = finite(message.baseline?.objective);
    const baselineMean = finite(message.baseline?.mean);
    const baselineP10 = finite(message.baseline?.p10);
    if (baselineObjective == null || baselineMean == null || baselineP10 == null) {
      throw new Error("referencia Monte Carlo inválida");
    }
    return {
      squad: {
        ids: candidate.ids.slice(),
        cost: candidate.cost,
        score: candidate.expected,
        consensusIndex: candidate.expected,
        xiPts: candidate.lineupPoints,
        formation: candidate.formation,
      },
      monteCarlo: {
        status: "complete",
        version: VERSION,
        seed: data.seed,
        scenarioCount: data.scenarioCount,
        candidateCount,
        durationMs: Math.max(0, finite(message.durationMs) ?? 0),
        changesFromBase,
        mean: metrics.mean,
        p10: metrics.p10,
        p50: metrics.p50,
        p90: metrics.p90,
        downside: metrics.downside,
        objective: metrics.objective,
        winRate: metrics.winRate,
        stability: metrics.stability,
        objectiveGain: metrics.objective - baselineObjective,
        baselineMean,
        baselineP10,
      },
    };
  }

  global.PremierMonteCarlo = Object.freeze({
    ALTERNATIVE_LINEUP_PENALTY,
    ALTERNATIVE_SIGMA_INCREMENT,
    DEFAULT_CANDIDATES,
    DEFAULT_SCENARIOS,
    DOWNSIDE_WEIGHT,
    VERSION,
    createPayload,
    simulate,
    uncertaintyFor,
    validateResult,
  });
})(globalThis);
