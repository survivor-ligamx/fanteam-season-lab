import { buildPayload, VERSION, BUILD_ID } from "./payload.js";
import { APIFootballCoordinator } from "./api-football.js";

const DEGRADED_TTL_SECONDS = 120;
const ALLOWED_ORIGINS = new Set(["https://survivor-ligamx.github.io", "null"]);

function allowedOrigin(request, env) {
  const origin = request?.headers?.get("Origin");
  if (!origin) return null;
  const configured = String(env?.CORS_ORIGINS || "").split(",").map((v) => v.trim()).filter(Boolean);
  if (ALLOWED_ORIGINS.has(origin) || configured.includes(origin)) return origin;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return null;
}

function responseJSON(data, status = 200, cacheSeconds = 0, request = null, env = {}) {
  const pretty = request ? new URL(request.url).searchParams.get("pretty") === "1" : false;
  const origin = allowedOrigin(request, env);
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": cacheSeconds ? `public, max-age=${cacheSeconds}` : "no-store",
    "Vary": "Origin"
  };
  if (origin) headers["Access-Control-Allow-Origin"] = origin;
  return new Response(JSON.stringify(data, null, pretty ? 2 : 0), { status, headers });
}

export { APIFootballCoordinator };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      const template = responseJSON(null, 200, 0, request, env);
      return new Response(null, { status: 204, headers: template.headers });
    }
    const latestRoute = url.pathname === "/" || url.pathname === "/latest";
    const healthRoute = url.pathname === "/health";
    if (!latestRoute && !healthRoute) {
      return responseJSON({ ok: false, error: "Route not found" }, 404, 0, request, env);
    }
    if (request.method !== "GET") {
      return responseJSON({ ok: false, error: "Method not allowed" }, 405, 0, request, env);
    }
    if (healthRoute) {
      return responseJSON({ ok: true, service: "FanTeam Data Engine", version: VERSION, build: BUILD_ID, updatedAt: new Date().toISOString() }, 200, 0, request, env);
    }
    const cache = caches.default;
    const originBucket = allowedOrigin(request, env) || "server";
    const pretty = url.searchParams.get("pretty") === "1" ? "pretty" : "compact";
    const { futbolFantasyEnabled } = await import("./futbolfantasy.js");
    const ffMode = futbolFantasyEnabled(env) ? "enabled" : "disabled";
    const cacheBase = `${url.origin}/__fanteam_cache_v12${url.pathname}?cors=${encodeURIComponent(originBucket)}&format=${pretty}&futbolFantasy=${ffMode}`;
    const healthyKey = new Request(`${cacheBase}&quality=healthy`, { method: "GET" });
    const degradedKey = new Request(`${cacheBase}&quality=degraded`, { method: "GET" });
    const cached = await cache.match(healthyKey) || await cache.match(degradedKey);
    if (cached) return cached;
    const payload = await buildPayload(env, cache, url.origin);
    const now = Date.now();
    const matchWindow = payload.liveFixtures.some((match) => {
      const kickoff = new Date(match.kickoff).getTime();
      return Number.isFinite(kickoff) && kickoff >= now - 3 * 3600000 && kickoff <= now + 4 * 3600000;
    });
    let ttl = payload.degraded ? DEGRADED_TTL_SECONDS : matchWindow ? 900 : 10800;
    const apiMeta = payload.sourceMeta?.apiFootball;
    const apiDeadline = Number(apiMeta?.stale ? apiMeta.staleUntil : apiMeta?.freshUntil);
    if (Number.isFinite(apiDeadline)) ttl = Math.min(ttl, Math.max(0, Math.floor((apiDeadline - now) / 1000)));
    payload.freshUntil = new Date(now + ttl * 1000).toISOString();
    const response = responseJSON(payload, 200, ttl, request, env);
    const cacheKey = payload.degraded ? degradedKey : healthyKey;
    if (ttl > 0) ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  }
};
