export const FUTBOL_FANTASY_URLS = Object.freeze({
  home: "https://www.futbolfantasy.com/premier-league/home",
  lineups: "https://www.futbolfantasy.com/premier-league/posibles-alineaciones",
  changes: "https://www.futbolfantasy.com/premier-league/ultimos-cambios",
});

const SOURCE = "FútbolFantasy";
const MAX_HTML_BYTES = 800_000;
const REQUEST_TIMEOUT_MS = 5000;
const MAX_ITEMS = 40;

function decode(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function text(value) {
  return decode(String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim());
}

function attr(tag, name) {
  const match = String(tag || "").match(new RegExp(`${name}\\s*=\\s*["']([^"']+)`, "i"));
  return match ? decode(match[1]).trim() : "";
}

function absoluteUrl(href, baseUrl) {
  try {
    const url = new URL(href, baseUrl);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function unique(items, key = (item) => item) {
  const seen = new Set();
  return items.filter((item) => {
    const value = key(item);
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function dateFromText(value, now = new Date()) {
  const match = String(value || "").match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?:\s+(\d{1,2}):(\d{2}))?\b/);
  if (!match) return null;
  const year = match[3] ? (match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3])) : now.getUTCFullYear();
  const date = new Date(Date.UTC(year, Number(match[2]) - 1, Number(match[1]), Number(match[4] || 0), Number(match[5] || 0)));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function linksFrom(html, baseUrl) {
  const links = [];
  const pattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(pattern)) {
    const href = absoluteUrl(attr(match[1], "href"), baseUrl);
    const label = text(match[2]);
    if (!href || label.length < 12 || label.length > 220) continue;
    links.push({ title: label, url: href });
  }
  return unique(links, (item) => `${item.title}|${item.url}`);
}

function parseArticleList(html, sourceUrl, kind) {
  const links = linksFrom(html, sourceUrl);
  const filtered = links.filter((item) => {
    const path = new URL(item.url).pathname;
    if (item.url === sourceUrl) return false;
    if (path.includes("/equipos/") || path.includes("/jugadores/")) return false;
    return /noticia|previa|alineacion|lesion|sancion|fichaje|evento|cambio/i.test(`${path} ${item.title}`);
  });
  return filtered.slice(0, MAX_ITEMS).map((item) => ({
    title: item.title,
    description: item.title,
    url: item.url,
    source: SOURCE,
    sourceUrl,
    type: kind,
    publishedAt: dateFromText(item.title),
  }));
}

function parseProbableLineups(html, sourceUrl) {
  const result = [];
  const blocks = /<(?:article|section|div)\b([^>]*(?:data-team|data-club|data-fixture)[^>]*)>([\s\S]*?)<\/(?:article|section|div)>/gi;
  for (const match of html.matchAll(blocks)) {
    const club = attr(match[1], "data-team") || attr(match[1], "data-club");
    const fixture = attr(match[1], "data-fixture");
    if (!club) continue;
    const players = [];
    const playerPattern = /<(?:a|span|li)\b([^>]*(?:data-player|data-name)[^>]*)>([\s\S]*?)<\/(?:a|span|li)>/gi;
    for (const playerMatch of match[2].matchAll(playerPattern)) {
      const name = attr(playerMatch[1], "data-player") || attr(playerMatch[1], "data-name") || text(playerMatch[2]);
      const role = attr(playerMatch[1], "data-role") || attr(playerMatch[1], "data-position") || null;
      if (name && name.length >= 2 && name.length <= 80) players.push({ name, role });
    }
    const uniquePlayers = unique(players, (player) => `${player.name}|${player.role || ""}`);
    if (uniquePlayers.length) result.push({ club, fixture: fixture || null, status: "probable", players: uniquePlayers, source: SOURCE, sourceUrl });
  }
  return unique(result, (item) => `${item.club}|${item.fixture || ""}`).slice(0, 40);
}

export function parseFutbolFantasyPage(html, sourceUrl, kind, now = new Date()) {
  const byteLength = typeof html === "string" ? new TextEncoder().encode(html).byteLength : 0;
  if (typeof html !== "string" || !html.trim() || byteLength > MAX_HTML_BYTES) {
    return { ok: false, error: "HTML vacío o demasiado grande", news: [], events: [], probableLineups: [] };
  }
  const clean = html.replace(/<!--[\s\S]*?-->/g, " ");
  const articles = parseArticleList(clean, sourceUrl, kind);
  const probableLineups = kind === "probableLineups" ? parseProbableLineups(clean, sourceUrl) : [];
  const items = articles.map((item) => ({ ...item, publishedAt: item.publishedAt || now.toISOString() }));
  return {
    ok: true,
    error: null,
    news: kind === "home" ? items : [],
    events: kind === "changes" ? items : [],
    probableLineups,
  };
}

async function fetchPage(url, fetchImpl) {
  try {
    const response = await fetchImpl(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "es-MX,es;q=0.9,en;q=0.8",
        "User-Agent": "Mozilla/5.0 (compatible; FanTeamData/2.3; +https://survivor-ligamx.github.io/fanteam-season-lab/)"
      }
    });
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_HTML_BYTES) return { ok: false, error: "respuesta demasiado grande" };
    return { ok: true, html: new TextDecoder().decode(buffer) };
  } catch (error) {
    return { ok: false, error: error?.name === "TimeoutError" ? "timeout" : error?.message || "error de red" };
  }
}

export async function fetchFutbolFantasy(fetchImpl = fetch, now = new Date()) {
  const entries = Object.entries(FUTBOL_FANTASY_URLS);
  const fetched = await Promise.all(entries.map(async ([kind, url]) => [kind, url, await fetchPage(url, fetchImpl)]));
  const parsed = fetched.map(([kind, url, result]) => result.ok
    ? parseFutbolFantasyPage(result.html, url, kind === "lineups" ? "probableLineups" : kind, now)
    : { ok: false, error: result.error, news: [], events: [], probableLineups: [] });
  const errors = fetched.filter(([, , result]) => !result.ok).map(([kind, , result]) => `${kind}: ${result.error}`);
  return {
    ok: parsed.some((item) => item.ok && (item.news.length || item.events.length || item.probableLineups.length)),
    source: SOURCE,
    updatedAt: now.toISOString(),
    sourceUrl: FUTBOL_FANTASY_URLS.home,
    news: parsed.flatMap((item) => item.news),
    events: parsed.flatMap((item) => item.events),
    probableLineups: parsed.flatMap((item) => item.probableLineups),
    error: errors.length ? errors.join("; ") : null,
    health: { pages: Object.fromEntries(fetched.map(([kind, , result]) => [kind, result.ok])), errors },
  };
}
