import { FUTBOLFANTASY_FRESH_MS, FUTBOLFANTASY_HOME_URL, FUTBOLFANTASY_STALE_MS, FUTBOLFANTASY_URLS } from './config.js';
import { readJSONCache, writeJSONCache } from './cache.js';
import { safeTextRequest } from './http.js';

const FUTBOLFANTASY_CLUBS = Object.freeze([
  ["Arsenal", ["arsenal"]],
  ["Aston Villa", ["aston villa"]],
  ["Bournemouth", ["bournemouth", "afc bournemouth"]],
  ["Brentford", ["brentford"]],
  ["Brighton", ["brighton", "brighton hove albion"]],
  ["Burnley", ["burnley"]],
  ["Chelsea", ["chelsea"]],
  ["Coventry City", ["coventry", "coventry city"]],
  ["Crystal Palace", ["crystal palace"]],
  ["Everton", ["everton"]],
  ["Fulham", ["fulham"]],
  ["Hull City", ["hull", "hull city"]],
  ["Ipswich Town", ["ipswich", "ipswich town"]],
  ["Leeds United", ["leeds", "leeds united"]],
  ["Liverpool", ["liverpool"]],
  ["Manchester City", ["manchester city", "man city"]],
  ["Manchester United", ["manchester united", "man utd"]],
  ["Newcastle United", ["newcastle", "newcastle united"]],
  ["Nottingham Forest", ["nottingham forest", "nottm forest"]],
  ["Sunderland", ["sunderland"]],
  ["Tottenham", ["tottenham", "tottenham hotspur", "spurs"]],
  ["West Ham", ["west ham", "west ham united"]],
  ["Wolverhampton", ["wolverhampton", "wolves"]]
]);


export function futbolFantasyEnabled(env) {
  return /^(1|true|yes|on)$/i.test(String(env?.FUTBOLFANTASY_ENABLED || "").trim());
}


function decodeHTML(value) {
  const named = {
    amp: "&", apos: "'", gt: ">", hellip: "…", laquo: "«", lt: "<",
    nbsp: " ", ndash: "–", quot: '"', raquo: "»", rsquo: "’"
  };
  return String(value || "")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (entity, code) => {
      const numeric = code[0].toLowerCase() === "x"
        ? Number.parseInt(code.slice(1), 16)
        : Number.parseInt(code, 10);
      try {
        return Number.isFinite(numeric) ? String.fromCodePoint(numeric) : entity;
      } catch {
        return entity;
      }
    })
    .replace(/&([a-z]+);/gi, (entity, name) => named[name.toLowerCase()] ?? entity);
}


function cleanHTMLText(value, maximum = 180) {
  return decodeHTML(String(value || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);
}


function normalizedFutbolFantasyText(value) {
  return cleanHTMLText(value, 500)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}


function htmlAttribute(openingTag, name) {
  const escaped = String(name).replace(/[^a-z0-9_-]/gi, "");
  const match = String(openingTag || "").match(
    new RegExp(`\\s${escaped}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i")
  );
  return match?.[2] || "";
}


function classTokens(openingTag) {
  return htmlAttribute(openingTag, "class").split(/\s+/).filter(Boolean);
}


function blocksByClasses(html, tag, requiredClasses, maximum = 100) {
  const opening = new RegExp(`<${tag}\\b[^>]*>`, "gi");
  const starts = [];
  let match;
  while ((match = opening.exec(String(html || "")))) {
    const classes = new Set(classTokens(match[0]));
    if (requiredClasses.every((name) => classes.has(name))) {
      starts.push({ index: match.index, bodyStart: opening.lastIndex, openingTag: match[0] });
      if (starts.length >= maximum + 1) break;
    }
  }
  return starts.slice(0, maximum).map((start, index) => ({
    openingTag: start.openingTag,
    body: String(html || "").slice(
      start.bodyStart,
      starts[index + 1]?.index ?? String(html || "").length
    )
  }));
}


function classElements(html, requiredClass, maximum = 100) {
  const source = String(html || "");
  const elements = [];
  const opening = /<([a-z][\w:-]*)\b[^>]*>/gi;
  let match;
  while ((match = opening.exec(source))) {
    if (!classTokens(match[0]).includes(requiredClass)) continue;
    const closingTag = `</${match[1]}>`;
    const bodyEnd = source.toLowerCase().indexOf(closingTag.toLowerCase(), opening.lastIndex);
    if (bodyEnd < 0) continue;
    const body = source.slice(opening.lastIndex, bodyEnd);
    elements.push({ openingTag: match[0], body, text: cleanHTMLText(body) });
    if (elements.length >= maximum) break;
  }
  return elements;
}


function firstClassText(html, requiredClass, maximum = 180) {
  const element = classElements(html, requiredClass, 1)[0];
  return element ? cleanHTMLText(element.body, maximum) : "";
}


function futbolFantasyUrl(value, base = FUTBOLFANTASY_HOME_URL) {
  try {
    const parsed = new URL(decodeHTML(value), base);
    const hostAllowed = parsed.hostname === "futbolfantasy.com"
      || parsed.hostname.endsWith(".futbolfantasy.com");
    return parsed.protocol === "https:" && hostAllowed ? parsed.href.slice(0, 500) : null;
  } catch {
    return null;
  }
}


function futbolFantasyClub(value) {
  const normalized = normalizedFutbolFantasyText(value);
  if (!normalized) return null;
  for (const [club, aliases] of FUTBOLFANTASY_CLUBS) {
    if (aliases.some((alias) => normalized.includes(alias))) return club;
  }
  return null;
}


function futbolFantasyClubs(value) {
  const normalized = normalizedFutbolFantasyText(value);
  return FUTBOLFANTASY_CLUBS
    .filter(([, aliases]) => aliases.some((alias) => normalized.includes(alias)))
    .map(([club]) => club)
    .slice(0, 4);
}


function futbolFantasyDate(value) {
  const text = cleanHTMLText(value, 60);
  const matched = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:\D+(\d{1,2}):(\d{2}))?/);
  if (!matched) return { publishedAt: null, publishedLabel: text };
  const year = Number(matched[3]) < 100 ? 2000 + Number(matched[3]) : Number(matched[3]);
  const timestamp = Date.UTC(
    year,
    Number(matched[2]) - 1,
    Number(matched[1]),
    Number(matched[4]) || 0,
    Number(matched[5]) || 0
  );
  return Number.isFinite(timestamp)
    ? { publishedAt: new Date(timestamp).toISOString(), publishedLabel: text }
    : { publishedAt: null, publishedLabel: text };
}


function summarizeFutbolFantasyHeadline(headline) {
  const normalized = normalizedFutbolFantasyText(headline);
  const clubs = futbolFantasyClubs(headline);
  const categories = [
    ["Lesiones", ["lesion", "baja", "molest", "operacion", "recupera", "duda"]],
    ["Sanciones", ["sancion", "suspend", "tarjeta", "expulsion"]],
    ["Selecciones", ["seleccion", "internacional", "fecha fifa"]],
    ["Alineaciones", ["alineacion", "once", "titular", "suplente", "convocatoria"]],
    ["Entrenamiento", ["entren", "sesion", "grupo"]],
    ["Mercado oficial", ["hace oficial el fichaje", "fichaje oficial", "nuevo jugador", "anuncia la contratacion", "traspaso confirmado", "firma por", "se incorpora"]],
    ["Rumores", ["fichaje", "traspaso", "cesion", "renov", "acuerdo", "oferta", "interes", "negocia", "mercado", "podria"]],
    ["Declaraciones", ["rueda de prensa", "declara", "confirma"]],
    ["Partidos", ["partido", "victoria", "derrota", "empate"]]
  ];
  const marketContext = [
    "fichaje", "traspaso", "cesion", "renov", "acuerdo", "oferta",
    "interes", "negocia", "mercado", "nuevo jugador", "firma"
  ].some((keyword) => normalized.includes(keyword));
  const uncertainMarket = [
    "podria", "oferta", "interes", "negocia", "rumor", "valora", "estudia"
  ].some((keyword) => normalized.includes(keyword));
  const category = marketContext && uncertainMarket
    ? "Rumores"
    : categories.find(([, keywords]) => (
      keywords.some((keyword) => normalized.includes(keyword))
    ))?.[0] || "Actualidad";
  const subjects = clubs.length ? ` relacionada con ${clubs.join(" y ")}` : " de la Premier League";
  const lead = {
    Lesiones: "Actualización informativa sobre disponibilidad o lesión",
    Sanciones: "Actualización informativa sobre una posible sanción",
    Alineaciones: "Actualización editorial sobre convocatoria o alineación",
    Selecciones: "Actualización informativa sobre convocatoria o actividad internacional",
    "Mercado oficial": "Actualización informativa sobre un movimiento oficial de mercado",
    Rumores: "Actualización editorial sobre un rumor o negociación de mercado",
    Entrenamiento: "Novedad informativa procedente de un entrenamiento",
    Declaraciones: "Novedad informativa procedente de declaraciones",
    Partidos: "Actualización informativa relacionada con un partido",
    Actualidad: "Nueva actualización editorial"
  }[category];
  return { category, clubs, summary: `${lead}${subjects}.` };
}


function parseFutbolFantasyNews(html) {
  return blocksByClasses(html, "div", ["noticia"], Number.POSITIVE_INFINITY)
    .map((block) => {
      const link = classElements(block.body, "link", 1)[0];
      const sourceUrl = link ? futbolFantasyUrl(htmlAttribute(link.openingTag, "href")) : null;
      const headline = link ? cleanHTMLText(link.body, 240) : "";
      if (!sourceUrl || !headline) return null;
      const summary = summarizeFutbolFantasyHeadline(headline);
      const date = futbolFantasyDate(firstClassText(block.body, "date", 60));
      return { ...summary, ...date, sourceUrl };
    })
    .filter(Boolean)
    .slice(0, 20);
}


function parseFutbolFantasyAvailability(html, kind, sourceUrl) {
  const sectionClass = kind === "injuries" ? "lesionados" : "sancionados";
  const itemClass = kind === "injuries" ? "lesionado" : "sancionado";
  const records = [];
  for (const section of blocksByClasses(
    html,
    "section",
    ["mod", sectionClass],
    Number.POSITIVE_INFINITY
  )) {
    const club = futbolFantasyClub(firstClassText(section.body, "title", 100));
    if (!club) continue;
    for (const item of blocksByClasses(
      section.body,
      "div",
      ["elemento", itemClass],
      Number.POSITIVE_INFINITY
    )) {
      const player = firstClassText(item.body, "jugador", 80);
      if (!player) continue;
      const issue = firstClassText(item.body, kind === "injuries" ? "lesion" : "sancion", 120);
      const statusElement = classElements(item.body, "gravedad-0", 1)[0]
        || classElements(item.body, "gravedad-1", 1)[0]
        || classElements(item.body, "gravedad-2", 1)[0]
        || classElements(item.body, "gravedad-3", 1)[0];
      const itemText = cleanHTMLText(item.body, 400);
      const since = itemText.match(/(?:Desde|Sancionado desde)\s+[^|·]{1,70}/i)?.[0] || "";
      records.push({
        club,
        player,
        issue,
        status: statusElement?.text || "",
        since: cleanHTMLText(since, 80),
        sourceUrl
      });
      if (records.length >= 80) return records;
    }
  }
  return records;
}


function parseFutbolFantasyLineups(html) {
  const gameweek = cleanHTMLText(html, 10000).match(/\bJornada\s+(\d{1,2})\b/i)?.[1] || "";
  const lineups = new Map();
  for (const section of blocksByClasses(
    html,
    "section",
    ["alineacion_wrapper"],
    Number.POSITIVE_INFINITY
  )) {
    const club = futbolFantasyClub(section.body);
    if (!club) continue;
    const teamLink = classElements(section.body, "equipo", 1)[0];
    const sourceUrl = teamLink
      ? futbolFantasyUrl(htmlAttribute(teamLink.openingTag, "href"))
      : FUTBOLFANTASY_URLS.lineups;
    const players = classElements(section.body, "jugador", Number.POSITIVE_INFINITY)
      .map((element) => element.text)
      .filter(Boolean)
      .slice(0, 15);
    lineups.set(club, { club, gameweek, players, sourceUrl });
  }

  const anchorPattern = /<a\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
  let anchor;
  while ((anchor = anchorPattern.exec(String(html || "")))) {
    const sourceUrl = futbolFantasyUrl(anchor[2]);
    if (!sourceUrl || !/\/premier-league\/equipos\//i.test(sourceUrl)) continue;
    const club = futbolFantasyClub(cleanHTMLText(anchor[3], 100));
    if (!club || lineups.has(club)) continue;
    lineups.set(club, { club, gameweek, players: [], sourceUrl });
  }
  return [...lineups.values()].slice(0, 30);
}


export function emptyFutbolFantasy(overrides = {}) {
  return {
    mode: "informational",
    enabled: false,
    available: false,
    observedAt: null,
    stale: false,
    sourceUrl: FUTBOLFANTASY_HOME_URL,
    news: [],
    injuries: [],
    suspensions: [],
    probableLineups: [],
    error: null,
    cacheStatus: "disabled",
    ...overrides
  };
}


export async function getFutbolFantasy(env, cache = caches.default, cacheOrigin = "https://fanteam-data.invalid") {
  if (!futbolFantasyEnabled(env)) return emptyFutbolFantasy();

  const cacheKey = new Request(`${cacheOrigin}/__fanteam_futbolfantasy_v1/state`, { method: "GET" });
  const state = await readJSONCache(cache, cacheKey) || {};
  const now = Date.now();
  const hasFreshCache = state.data && Number(state.freshUntil) > now;
  const hasStaleCache = state.data && Number(state.staleUntil) > now;
  if (hasFreshCache) {
    return { ...state.data, enabled: true, stale: false, cacheStatus: "fresh-cache" };
  }
  if (Number(state.cooldownUntil) > now) {
    const error = `fuente en pausa hasta ${new Date(state.cooldownUntil).toISOString()}`;
    return hasStaleCache
      ? { ...state.data, enabled: true, stale: true, error, cacheStatus: "stale-cache" }
      : emptyFutbolFantasy({ enabled: true, error, cacheStatus: "cooldown" });
  }

  const headers = {
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "es-MX,es;q=0.9,en;q=0.8",
    "User-Agent": "Mozilla/5.0 (compatible; FanTeamData/2.3; +https://survivor-ligamx.github.io/fanteam-season-lab/)"
  };
  const labels = Object.keys(FUTBOLFANTASY_URLS);
  const responses = {};
  const refreshDeadline = Date.now() + 8000;
  for (const label of labels) {
    const remaining = refreshDeadline - Date.now();
    if (remaining <= 0) {
      responses[label] = { ok: false, error: "presupuesto de actualización agotado", data: null };
      continue;
    }
    responses[label] = await safeTextRequest(FUTBOLFANTASY_URLS[label], {
      headers,
      redirect: "follow",
      timeoutMs: Math.min(3000, remaining)
    });
    if (responses[label].status === 403 || responses[label].status === 429) break;
  }
  for (const label of labels) {
    if (!responses[label]) {
      responses[label] = {
        ok: false,
        error: "omitida tras bloqueo de la fuente",
        data: null
      };
    }
  }
  const failures = labels
    .filter((label) => !responses[label].ok)
    .map((label) => `${label}: ${responses[label].error}`);
  const blocked = labels
    .map((label) => responses[label])
    .find((response) => response.status === 403 || response.status === 429);
  const cooldownUntil = blocked
    ? Math.max(Number(blocked.retryAfterAt) || 0, now + FUTBOLFANTASY_FRESH_MS)
    : null;

  if (failures.length && hasStaleCache) {
    if (cooldownUntil) {
      await writeJSONCache(cache, cacheKey, {
        ...state,
        cooldownUntil,
        lastError: failures.join("; ")
      }, Math.max(FUTBOLFANTASY_STALE_MS, cooldownUntil - now));
    }
    return {
      ...state.data,
      enabled: true,
      stale: true,
      error: failures.join("; "),
      cacheStatus: "stale-cache"
    };
  }

  const data = emptyFutbolFantasy({
    enabled: true,
    observedAt: new Date(now).toISOString(),
    news: responses.news.ok ? parseFutbolFantasyNews(responses.news.data) : [],
    injuries: responses.injuries.ok
      ? parseFutbolFantasyAvailability(responses.injuries.data, "injuries", FUTBOLFANTASY_URLS.injuries)
      : [],
    suspensions: responses.suspensions.ok
      ? parseFutbolFantasyAvailability(responses.suspensions.data, "suspensions", FUTBOLFANTASY_URLS.suspensions)
      : [],
    probableLineups: responses.lineups.ok
      ? parseFutbolFantasyLineups(responses.lineups.data)
      : [],
    error: failures.join("; ") || null,
    cacheStatus: failures.length ? "partial" : "live"
  });
  data.available = Boolean(
    data.news.length || data.injuries.length || data.suspensions.length || data.probableLineups.length
  );

  if (data.available) {
    const nextState = {
      data: { ...data, cacheStatus: "live" },
      freshUntil: now + FUTBOLFANTASY_FRESH_MS,
      staleUntil: now + FUTBOLFANTASY_STALE_MS,
      cooldownUntil
    };
    await writeJSONCache(cache, cacheKey, nextState, FUTBOLFANTASY_STALE_MS);
  } else if (cooldownUntil) {
    await writeJSONCache(cache, cacheKey, {
      ...state,
      cooldownUntil,
      lastError: data.error
    }, Math.max(FUTBOLFANTASY_STALE_MS, cooldownUntil - now));
  }
  return data;
}
