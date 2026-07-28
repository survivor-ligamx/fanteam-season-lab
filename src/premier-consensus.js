(function attachPremierConsensus(global) {
  "use strict";

  const VERSION = "premier-consensus-v1";
  const GAMEWEEK = 1;
  const BUDGET = 100;
  const MAX_PLAYERS_PER_CLUB = 3;
  const POSITION_QUOTA = Object.freeze({ GK: 2, DEF: 5, MID: 5, FWD: 3 });
  // Copilot y Draft son señales opcionales. Los pesos disponibles siempre se
  // renormalizan: con Copilot y sin Draft se conserva exactamente 60/25/15;
  // sin archivos locales, FanTeam y contexto forman un fallback público 80/20.
  // Draft permanece limitado al 10% incluso cuando Copilot no está disponible.
  const FALLBACK_WEIGHTS = Object.freeze({ fanteam: 0.80, context: 0.20 });
  const WEIGHTS = Object.freeze({ fanteam: 0.54, copilot: 0.225, draft: 0.10, context: 0.135 });

  function finite(value) {
    if (value == null || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
  }

  function percentile(peers, selector, value) {
    const target = finite(value);
    const values = peers.map(selector).map(finite).filter((number) => number != null);
    if (target == null || !values.length) return 0;
    if (values.length === 1) return 100;
    const lower = values.filter((number) => number < target).length;
    const equal = values.filter((number) => number === target).length;
    return clamp(100 * (lower + Math.max(0, equal - 1) / 2) / (values.length - 1), 0, 100);
  }

  function confirmedUnavailable(status) {
    const text = String(status || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (!text) return false;
    return /\b(ruled out|confirmed out|unavailable|suspended|season ending|season-ending)\b/.test(text)
      || /\b(baja confirmada|no disponible|descartad[oa]|sancionad[oa])\b/.test(text);
  }

  function availability(player) {
    const confidence = clamp(finite(player?.confidence) ?? 0, 0, 100);
    const minutes = clamp(finite(player?.minutes) ?? confidence * 0.9, 0, 90);
    const hardOut = confidence <= 10 || confirmedUnavailable(player?.status);
    const doubt = !hardOut && confidence <= 25;
    const caution = !hardOut && !doubt && confidence < 45;
    const signal = hardOut ? 0 : clamp(0.65 * confidence + 0.35 * (minutes / 90 * 100), 0, 100);
    return {
      confidence,
      minutes,
      hardOut,
      doubt,
      caution,
      signal,
      multiplier: hardOut ? 0 : doubt ? 0.55 : caution ? 0.8 : 1,
      label: hardOut ? "Baja" : doubt ? "Duda fuerte" : caution ? "Precaución" : "Disponible",
    };
  }

  function fixtureSignal(fixture) {
    const advantage = finite(fixture?.adv);
    return advantage == null ? 35 : clamp(50 + advantage * 0.65, 5, 95);
  }

  function matchFor(odds, player, fixture, gameweek) {
    const matches = Array.isArray(odds) ? odds : [];
    return matches.find((match) => {
      if (Number(match?.gw) !== Number(gameweek)) return false;
      if (match.home !== player.club && match.away !== player.club) return false;
      if (!fixture?.opp) return true;
      return (match.home === player.club && match.away === fixture.opp)
        || (match.away === player.club && match.home === fixture.opp);
    }) || null;
  }

  function marketSignal(player, match) {
    if (!match) return null;
    const win = finite(player.club === match.home ? match.homeWin : match.awayWin);
    if (win == null) return null;
    const over = finite(match.over25);
    if (player.pos === "GK" || player.pos === "DEF") {
      return clamp(100 * (0.7 * win + 0.3 * (over == null ? 0.45 : 1 - over)), 0, 100);
    }
    return clamp(100 * (0.65 * win + 0.35 * (over == null ? 0.55 : over)), 0, 100);
  }

  function sourceSignals(rows, rawKey, signalKey, minimumPeers = 1) {
    const byPosition = new Map();
    for (const row of rows) {
      if (finite(row[rawKey]) == null) continue;
      if (!byPosition.has(row.player.pos)) byPosition.set(row.player.pos, []);
      byPosition.get(row.player.pos).push(row);
    }
    for (const row of rows) {
      if (finite(row[rawKey]) == null) {
        row[`${signalKey}PositionRank`] = null;
        row[`${signalKey}ValueRank`] = null;
        row[`${signalKey}BandRank`] = null;
        row[signalKey] = null;
        continue;
      }
      const peers = byPosition.get(row.player.pos) || [];
      if (peers.length < minimumPeers) {
        row[`${signalKey}PositionRank`] = null;
        row[`${signalKey}ValueRank`] = null;
        row[`${signalKey}BandRank`] = null;
        row[signalKey] = null;
        continue;
      }
      const priceBand = peers.filter((peer) => Math.abs(peer.price - row.price) <= 1.5);
      const positionRank = percentile(peers, (peer) => peer[rawKey], row[rawKey]);
      const value = row.price > 0 ? row[rawKey] / row.price : 0;
      const valueRank = percentile(
        peers,
        (peer) => (peer.price > 0 ? peer[rawKey] / peer.price : 0),
        value,
      );
      const bandRank = priceBand.length >= 5
        ? percentile(priceBand, (peer) => peer[rawKey], row[rawKey])
        : positionRank;
      row[`${signalKey}PositionRank`] = positionRank;
      row[`${signalKey}ValueRank`] = valueRank;
      row[`${signalKey}BandRank`] = bandRank;
      row[signalKey] = clamp(0.55 * positionRank + 0.25 * bandRank + 0.20 * valueRank, 0, 100);
    }
  }

  function agreementLabel(difference, opinionCount) {
    if (opinionCount < 2) return "sin contraste";
    if (difference <= 12) return "alto";
    if (difference <= 25) return "medio";
    return "bajo";
  }

  function effectiveWeights(copilotSignal, draftSignal) {
    const hasCopilot = finite(copilotSignal) != null;
    const hasDraft = finite(draftSignal) != null;
    if (hasCopilot) {
      if (hasDraft) return { ...WEIGHTS };
      const total = WEIGHTS.fanteam + WEIGHTS.copilot + WEIGHTS.context;
      return {
        fanteam: WEIGHTS.fanteam / total,
        copilot: WEIGHTS.copilot / total,
        context: WEIGHTS.context / total,
      };
    }
    const draft = hasDraft ? WEIGHTS.draft : 0;
    const remaining = 1 - draft;
    return {
      fanteam: remaining * FALLBACK_WEIGHTS.fanteam,
      ...(hasDraft ? { draft } : {}),
      context: remaining * FALLBACK_WEIGHTS.context,
    };
  }

  function create(options) {
    const {
      players,
      projection,
      copilotForPlayer,
      copilotPointsAt,
      draftForPlayer = () => null,
      draftPointsAt = () => null,
      fixture,
      getOdds = () => [],
      wildcard = global.FanTeamWildcard,
      formations = global.FanTeamProjection?.FORMATIONS,
      positionQuota = POSITION_QUOTA,
    } = options || {};
    if (!Array.isArray(players)) throw new Error("players es obligatorio");
    if (typeof projection !== "function") throw new Error("projection es obligatorio");
    if (typeof copilotForPlayer !== "function") throw new Error("copilotForPlayer es obligatorio");
    if (typeof copilotPointsAt !== "function") throw new Error("copilotPointsAt es obligatorio");
    if (typeof draftForPlayer !== "function") throw new Error("draftForPlayer debe ser una función");
    if (typeof draftPointsAt !== "function") throw new Error("draftPointsAt debe ser una función");
    if (typeof fixture !== "function") throw new Error("fixture es obligatorio");
    if (!wildcard || typeof wildcard.create !== "function") throw new Error("FanTeamWildcard no está disponible");
    if (!Array.isArray(formations)) throw new Error("formations es obligatorio");

    function scoreRows(gameweek) {
      const odds = getOdds();
      const rows = [];
      for (const player of players) {
        const copilot = copilotForPlayer(player);
        const draft = draftForPlayer(player);
        const fanteamPoints = finite(projection(player, gameweek));
        const copilotPoints = finite(copilotPointsAt(copilot, gameweek));
        const draftPoints = finite(draftPointsAt(draft, gameweek));
        const price = finite(player.price);
        if (fanteamPoints == null || price == null || price <= 0) continue;
        const scheduled = fixture(player, gameweek);
        const playerAvailability = availability(player);
        const match = matchFor(odds, player, scheduled, gameweek);
        const calendar = fixtureSignal(scheduled);
        const market = marketSignal(player, match);
        rows.push({
          player,
          copilot,
          draft,
          sourcePositionMismatch: Boolean(
            copilot?.position && copilot.position !== player.pos,
          ),
          price,
          fanteamPoints,
          copilotPoints,
          draftPoints,
          fixture: scheduled,
          availability: playerAvailability,
          fixtureSignal: calendar,
          marketSignal: market,
          marketUsed: market != null,
          contextSignal: clamp(
            0.45 * calendar
              + 0.25 * (market == null ? calendar : market)
              + 0.30 * playerAvailability.signal,
            0,
            100,
          ),
        });
      }

      sourceSignals(rows, "fanteamPoints", "fanteamSignal");
      sourceSignals(rows, "copilotPoints", "copilotSignal");
      sourceSignals(rows, "draftPoints", "draftSignal", 5);
      for (const row of rows) {
        const signals = {
          fanteam: row.fanteamSignal,
          copilot: row.copilotSignal,
          draft: row.draftSignal,
          context: row.contextSignal,
        };
        row.effectiveWeights = effectiveWeights(row.copilotSignal, row.draftSignal);
        row.baseScore = Object.entries(row.effectiveWeights).reduce((total, [key, weight]) => (
          total + weight * signals[key]
        ), 0);
        row.score = clamp(row.baseScore * row.availability.multiplier, 0, 100);
        const opinions = [row.fanteamSignal, row.copilotSignal, row.draftSignal]
          .map(finite)
          .filter((signal) => signal != null);
        row.disagreement = Math.max(...opinions) - Math.min(...opinions);
        row.agreement = agreementLabel(row.disagreement, opinions.length);
        row.eligible = Boolean(row.fixture) && !row.availability.hardOut;
        row.draftUsed = row.draftSignal != null;
        const percentage = (key) => `${(100 * (row.effectiveWeights[key] || 0)).toFixed(1).replace(/\.0$/, "")}%`;
        const risk = row.availability.multiplier < 1
          ? `; ajuste ${row.availability.label.toLowerCase()} ×${row.availability.multiplier.toFixed(2)}`
          : "";
        const positionNote = row.sourcePositionMismatch
          ? `; Copilot lo clasifica ${row.copilot.position} y FanTeam ${row.player.pos}`
          : "";
        const sourceNotes = [
          `FanTeam P${Math.round(row.fanteamSignal)} (${percentage("fanteam")})`,
        ];
        if (row.copilotSignal != null) {
          sourceNotes.push(`Copilot P${Math.round(row.copilotSignal)} (${percentage("copilot")})`);
        }
        if (row.draftUsed) {
          sourceNotes.push(`Draft P${Math.round(row.draftSignal)} (${percentage("draft")})`);
        }
        sourceNotes.push(`contexto ${Math.round(row.contextSignal)} (${percentage("context")})`);
        const agreementNote = row.agreement === "sin contraste"
          ? "sin contraste externo"
          : `acuerdo ${row.agreement}`;
        row.explanation = `${sourceNotes.join(", ")}; ${agreementNote}${risk}${positionNote}.`;
      }
      rows.sort((first, second) => second.score - first.score || first.player.name.localeCompare(second.player.name, "es"));
      rows.forEach((row, index) => { row.rank = index + 1; });
      return rows;
    }

    function build({ gameweek = GAMEWEEK, budget = BUDGET } = {}) {
      const safeGameweek = clamp(Math.round(Number(gameweek) || GAMEWEEK), 1, 38);
      const safeBudget = finite(budget);
      if (safeBudget == null || safeBudget <= 0) throw new Error("budget inválido");
      const rows = scoreRows(safeGameweek);
      const rowById = new Map(rows.map((row) => [Number(row.player.id), row]));
      const candidatePlayers = rows.map((row) => ({
        ...row.player,
        // FanTeamWildcard aplica un umbral genérico de confidence >=45. Aquí se
        // impone la política real: las bajas confirmadas quedan vetadas y las dudas
        // siguen disponibles únicamente después de su multiplicador explícito.
        confidence: row.eligible
          ? Math.max(45, finite(row.player.confidence) ?? 0)
          : finite(row.player.confidence) ?? 0,
      }));
      const candidateById = new Map(candidatePlayers.map((player) => [Number(player.id), player]));
      const value = (ids) => ids.reduce((total, id) => total + (candidateById.get(Number(id))?.price || 0), 0);
      const clubValid = (ids) => {
        const counts = {};
        for (const id of ids) {
          const player = candidateById.get(Number(id));
          if (!player) return false;
          counts[player.club] = (counts[player.club] || 0) + 1;
          if (counts[player.club] > MAX_PLAYERS_PER_CLUB) return false;
        }
        return true;
      };
      const warnings = [];
      for (const [position, quota] of Object.entries(positionQuota)) {
        const available = rows.filter((row) => (
          row.player.pos === position && row.eligible
        )).length;
        if (available < quota) warnings.push(`${position}: ${available}/${quota} candidatos elegibles`);
      }
      let squad = null;
      if (!warnings.length) {
        const optimizer = wildcard.create({
          players: candidatePlayers,
          byId: (id) => candidateById.get(Number(id)) || null,
          horizon6: (player) => rowById.get(Number(player.id))?.score || 0,
          value,
          clubValid,
          positionQuota,
          formations,
          eligible: (player) => Boolean(rowById.get(Number(player.id))?.eligible),
        });
        squad = optimizer.optimize({ gameweek: safeGameweek, budget: safeBudget });
        if (!squad) warnings.push("No se encontró una plantilla válida con el presupuesto y las restricciones actuales");
      }
      return {
        budget: safeBudget,
        gameweek: safeGameweek,
        rows,
        rowById,
        squad,
        warnings,
      };
    }

    return Object.freeze({ build, scoreRows });
  }

  global.PremierConsensus = Object.freeze({
    BUDGET,
    GAMEWEEK,
    MAX_PLAYERS_PER_CLUB,
    POSITION_QUOTA,
    VERSION,
    WEIGHTS,
    availability,
    confirmedUnavailable,
    create,
  });
})(globalThis);
