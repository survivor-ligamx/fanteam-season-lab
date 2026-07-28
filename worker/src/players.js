import { TEAM_CODES } from './config.js';

export function parsePlayerUpdates(apiFootball) {
  const updates = new Map();

  if (apiFootball.injuries.ok) {
    const injuries = apiFootball.injuries.data?.response || [];
    const now = Date.now();
    const maxAge = 21 * 86400000; // lesiones con más de 21 días se descartan
    const seen = new Map(); // key -> timestamp del registro usado

    for (const item of injuries) {
      const name = item.player?.name;
      const club = TEAM_CODES[item.team?.name];

      if (!name) continue;

      const parsed = item.fixture?.date
        ? new Date(item.fixture.date).getTime()
        : NaN;
      const when = Number.isFinite(parsed) ? parsed : now;

      if (now - when > maxAge) continue;

      const key = `${name}|${club || ""}`;

      if (seen.has(key) && seen.get(key) >= when) continue;

      seen.set(key, when);

      const questionable = item.player?.type === "Questionable";

      updates.set(key, {
        name,
        club,
        confidence: questionable ? 30 : 5,
        minutes: questionable ? 30 : 0,
        status: item.player?.reason || item.player?.type || "Lesión"
      });
    }
  }

  for (const lineupResult of apiFootball.lineups) {
    if (!lineupResult.ok) continue;

    for (const team of lineupResult.data?.response || []) {
      const club = TEAM_CODES[team.team?.name];

      for (const item of team.startXI || []) {
        const name = item.player?.name;

        if (!name) continue;

        updates.set(`${name}|${club || ""}`, {
          name,
          club,
          confidence: 95,
          minutes: 85,
          status: "Titular confirmado"
        });
      }

      for (const item of team.substitutes || []) {
        const name = item.player?.name;

        if (!name) continue;

        if (!updates.has(`${name}|${club || ""}`)) {
          updates.set(`${name}|${club || ""}`, {
            name,
            club,
            confidence: 30,
            minutes: 25,
            status: "Suplente confirmado"
          });
        }
      }
    }
  }

  return [...updates.values()];
}


export function normalizePlayerKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}


export function mergePlayerRecords(referencePlayers, liveUpdates) {
  const merged = new Map();
  const aliases = new Map();
  const aliasFor = (name, club) => {
    const normalizedName = normalizePlayerKey(name);
    const normalizedClub = normalizePlayerKey(club);
    return normalizedName && normalizedClub
      ? `${normalizedName}|${normalizedClub}`
      : null;
  };
  const nameVariants = (player) => {
    const name = normalizePlayerKey(player?.name);
    if (!name) return [];
    const tokens = name.split(" ");
    return [...new Set([
      name,
      tokens.slice(-2).join(" "),
      tokens.at(-1),
      tokens[0]
    ].filter(Boolean))];
  };
  const registerAliases = (player, key) => {
    for (const variant of nameVariants(player)) {
      const alias = aliasFor(variant, player.club);
      if (!alias) continue;
      if (!aliases.has(alias)) aliases.set(alias, new Set());
      aliases.get(alias).add(key);
    }
  };
  const resolveAlias = (player) => {
    for (const variant of nameVariants(player)) {
      const owners = aliases.get(aliasFor(variant, player.club));
      if (owners?.size === 1) return [...owners][0];
    }
    return null;
  };

  for (const player of referencePlayers) {
    const exactAlias = aliasFor(player.name, player.club);
    const key = player.id != null ? `id:${player.id}` : `alias:${exactAlias}`;
    merged.set(key, { ...player });
    registerAliases(player, key);
  }

  for (const update of liveUpdates) {
    const exactAlias = aliasFor(update.name, update.club);
    const idKey = update.id != null ? `id:${update.id}` : null;
    const exactOwners = exactAlias ? aliases.get(exactAlias) : null;
    const exactKey = exactOwners?.size === 1 ? [...exactOwners][0] : null;
    const key = (idKey && merged.has(idKey) && idKey)
      || exactKey
      || resolveAlias(update)
      || idKey
      || (exactAlias && `alias:${exactAlias}`);
    if (!key) continue;
    merged.set(key, { ...(merged.get(key) || {}), ...update });
    registerAliases(update, key);
  }

  return [...merged.values()];
}
