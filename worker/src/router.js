import { BUILD_ID, DEGRADED_TTL_SECONDS, VERSION } from './config.js';
import { allowedOrigin, responseJSON } from './http.js';
import { buildPayload } from './payload.js';
import { futbolFantasyEnabled } from './futbolfantasy-source.js';

const worker = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      const template = responseJSON(null, 200, 0, request, env);
      return new Response(null, { status: 204, headers: template.headers });
    }

    const latestRoute = url.pathname === "/" || url.pathname === "/latest";
    const healthRoute = url.pathname === "/health";

    if (!latestRoute && !healthRoute) {
      return responseJSON(
        { ok: false, error: "Ruta no encontrada" },
        404,
        0,
        request,
        env
      );
    }

    if (request.method !== "GET") {
      return responseJSON(
        { ok: false, error: "Método no permitido" },
        405,
        0,
        request,
        env
      );
    }

    if (healthRoute) {
      return responseJSON({
        ok: true,
        service: "FanTeam Data Engine",
        version: VERSION,
        build: BUILD_ID,
        updatedAt: new Date().toISOString()
      }, 200, 0, request, env);
    }

    const cache = caches.default;
    const originBucket = allowedOrigin(request, env) || "server";
    const pretty = url.searchParams.get("pretty") === "1" ? "pretty" : "compact";
    const futbolFantasyCacheMode = futbolFantasyEnabled(env) ? "enabled" : "disabled";
    const cacheBase = `${url.origin}/__fanteam_cache_v12${url.pathname}`
      + `?cors=${encodeURIComponent(originBucket)}&format=${pretty}`
      + `&futbolFantasy=${futbolFantasyCacheMode}`;
    const healthyKey = new Request(`${cacheBase}&quality=healthy`, { method: "GET" });
    const degradedKey = new Request(`${cacheBase}&quality=degraded`, { method: "GET" });

    const cached = await cache.match(healthyKey) || await cache.match(degradedKey);
    if (cached) return cached;

    const payload = await buildPayload(env, cache, url.origin);

    // Caché adaptativa: los payloads completos duran 15 min durante partidos
    // o 3 h fuera de ventana. Una respuesta parcial usa una clave separada y
    // solo dura 2 min, para no reemplazar una respuesta sana con un fallo puntual.
    const now = Date.now();
    const matchWindow = payload.liveFixtures.some((match) => {
      const kickoff = new Date(match.kickoff).getTime();
      return (
        Number.isFinite(kickoff)
        && kickoff >= now - 3 * 3600000
        && kickoff <= now + 4 * 3600000
      );
    });
    let ttl = payload.degraded
      ? DEGRADED_TTL_SECONDS
      : matchWindow
        ? 900
        : 10800;
    const apiMeta = payload.sourceMeta?.apiFootball;
    const apiDeadline = Number(apiMeta?.stale ? apiMeta.staleUntil : apiMeta?.freshUntil);
    if (Number.isFinite(apiDeadline)) {
      ttl = Math.min(ttl, Math.max(0, Math.floor((apiDeadline - now) / 1000)));
    }
    payload.freshUntil = new Date(now + ttl * 1000).toISOString();
    const response = responseJSON(payload, 200, ttl, request, env);
    const cacheKey = payload.degraded ? degradedKey : healthyKey;

    if (ttl > 0) ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  }
};

export default worker;
