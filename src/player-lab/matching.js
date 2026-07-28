export function createPlayerLabMatching({ state, Data, Draft, Consensus, Probable }) {
  function playerIdentity(name, club) {
    const clubCode = Data.resolveClubCode(club) || String(club || "").toUpperCase();
    return `${Data.normalize(name)}|${clubCode}`;
  }
  function ownNameAliases(player) {
    const reference = player.reference || {};
    return [...new Set([
      player.name,
      player.surname,
      String(player.name || "").trim().split(/\s+/).pop(),
      reference.name,
      reference.webName,
      reference.web_name,
    ].map((value) => String(value || "").trim()).filter(Boolean))];
  }
  function nameTokens(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
  }
  function abbreviationTokenMatches(first, second) {
    return first === second
      || (first.length === 1 && second.startsWith(first))
      || (second.length === 1 && first.startsWith(second));
  }
  function abbreviatedNameMatches(firstValue, secondValue) {
    const first = nameTokens(firstValue);
    const second = nameTokens(secondValue);
    if (!first.length || !second.length) return false;
    if (first.length === 1 || second.length === 1) {
      const single = first.length === 1 ? first[0] : second[0];
      const other = first.length === 1 ? second : first;
      return single.length >= 3 && (single === other[0] || single === other[other.length - 1]);
    }
    if (first.length === second.length) {
      return first.every((token, index) => abbreviationTokenMatches(token, second[index]));
    }
    return abbreviationTokenMatches(first[0], second[0])
      && abbreviationTokenMatches(first[first.length - 1], second[second.length - 1]);
  }
  function abbreviatedAliasesMatch(player, row) {
    const ownAliases = ownNameAliases(player);
    const importedAliases = [...new Set([row.name, ...(row.aliases || [])])];
    return ownAliases.some((ownAlias) => importedAliases.some((importedAlias) => (
      abbreviatedNameMatches(ownAlias, importedAlias)
    )));
  }
  function addUnique(map, key, value) {
    if (key == null || key === "") return;
    if (map.get(key) === value) return;
    if (map.has(key)) map.set(key, null);
    else map.set(key, value);
  }
  function referencedFplIds(player) {
    const reference = player.reference || {};
    const values = [
      player.fplId, player.fpl_id, player.elementId, player.element_id, player.element,
      reference.fplId, reference.fpl_id, reference.elementId, reference.element_id,
      reference.element, reference.id,
    ];
    if (Number(player.id) > 0 && Number(player.id) <= 10000) values.push(player.id);
    return [...new Set(values.map(Number).filter((value) => Number.isSafeInteger(value) && value > 0))];
  }
  function referencedFplCodes(player) {
    const reference = player.reference || {};
    return [...new Set([
      player.fplCode, player.fpl_code, player.code,
      reference.fplCode, reference.fpl_code, reference.code,
    ].map((value) => String(value ?? "").trim()).filter(Boolean))];
  }
  function rebuildCopilotMatches() {
    state.copilotByPlayerId = new Map();
    state.playerByCopilot = new Map();
    state.copilotMatchMethod = new Map();
    const rows = state.copilot?.players || [];
    if (!rows.length || !state.players.length) return;

    const byId = new Map();
    const byCode = new Map();
    const byIdentity = new Map();
    const ownIdentityCounts = new Map();
    for (const player of state.players) {
      const keys = new Set(ownNameAliases(player).map((alias) => playerIdentity(alias, player.club)));
      for (const key of keys) ownIdentityCounts.set(key, (ownIdentityCounts.get(key) || 0) + 1);
    }
    for (const row of rows) {
      addUnique(byId, row.id, row);
      addUnique(byCode, row.fplCode, row);
      const aliases = [...new Set([row.name, ...(row.aliases || [])])];
      for (const alias of aliases) {
        addUnique(byIdentity, playerIdentity(alias, row.teamCode || row.team), row);
      }
    }

    const claimed = new Set();
    for (const player of state.players) {
      let match = null;
      let method = null;
      for (const id of referencedFplIds(player)) {
        if (byId.get(id)) {
          match = byId.get(id);
          method = "FPL ID";
          break;
        }
      }
      if (!match) {
        for (const code of referencedFplCodes(player)) {
          if (byCode.get(code)) {
            match = byCode.get(code);
            method = "FPL code";
            break;
          }
        }
      }
      if (!match) {
        for (const alias of ownNameAliases(player)) {
          const identity = playerIdentity(alias, player.club);
          if (ownIdentityCounts.get(identity) === 1 && byIdentity.get(identity)) {
            match = byIdentity.get(identity);
            method = alias === player.name ? "nombre + club" : "alias único + club";
            break;
          }
        }
      }
      if (!match || claimed.has(match)) continue;
      claimed.add(match);
      state.copilotByPlayerId.set(Number(player.id), match);
      state.playerByCopilot.set(match, player);
      state.copilotMatchMethod.set(Number(player.id), method);
    }

    const unmatchedPlayers = state.players.filter((player) => (
      !state.copilotByPlayerId.has(Number(player.id))
    ));
    const unclaimedRows = rows.filter((row) => !claimed.has(row));
    const abbreviationCandidates = unclaimedRows.map((row) => {
      const club = Data.resolveClubCode(row.teamCode || row.team)
        || String(row.teamCode || row.team || "").toUpperCase();
      return {
        row,
        players: unmatchedPlayers.filter((player) => (
          player.club === club && abbreviatedAliasesMatch(player, row)
        )),
      };
    });
    for (const candidate of abbreviationCandidates) {
      if (candidate.players.length !== 1) continue;
      const [player] = candidate.players;
      const competingRows = abbreviationCandidates.filter((other) => (
        other.players.some((otherPlayer) => Number(otherPlayer.id) === Number(player.id))
      ));
      if (competingRows.length !== 1) continue;
      claimed.add(candidate.row);
      state.copilotByPlayerId.set(Number(player.id), candidate.row);
      state.playerByCopilot.set(candidate.row, player);
      state.copilotMatchMethod.set(Number(player.id), "abreviatura única + club");
    }
  }
  function copilotForPlayer(player) {
    return state.copilotByPlayerId.get(Number(player?.id)) || null;
  }
  function rebuildDraftMatches() {
    const result = Draft.matchPlayers(state.players, state.draft?.players || []);
    state.draftByPlayerId = result.byPlayerId;
    state.playerByDraft = result.playerByProjection;
    state.draftMatchMethod = result.matchMethod;
    state.draftUnmatchedRows = result.unmatchedRows;
    state.draftAmbiguousRows = result.ambiguous;
  }
  function draftForPlayer(player) {
    const status = Draft.datasetStatus(state.draft, { gameweek: Consensus.GAMEWEEK });
    return status.active ? state.draftByPlayerId.get(Number(player?.id)) || null : null;
  }
  function rebuildProbableMatches() {
    const result = Draft.matchPlayers(state.players, state.probable?.players || []);
    state.probableByPlayerId = result.byPlayerId;
    state.playerByProbable = result.playerByProjection;
    state.probableMatchMethod = result.matchMethod;
    state.probableUnmatchedRows = result.unmatchedRows;
    state.probableAmbiguousRows = result.ambiguous;
  }
  function probableForPlayer(player, gameweek = Probable.EXPECTED_GAMEWEEK) {
    const status = Probable.datasetStatus(state.probable, { gameweek });
    return status.active ? state.probableByPlayerId.get(Number(player?.id)) || null : null;
  }
  return {
    rebuildCopilotMatches, copilotForPlayer, rebuildDraftMatches, draftForPlayer,
    rebuildProbableMatches, probableForPlayer,
  };
}
