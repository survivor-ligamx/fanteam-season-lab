export function apiFootballFailure(error, status = null, retryAfterAt = null) {
  return { ok: false, error, status, retryAfterAt, data: null };
}


export async function readJSONCache(cache, key) {
  try {
    const response = await cache.match(key);
    return response ? await response.json() : null;
  } catch (error) {
    console.warn(JSON.stringify({
      event: "api_football_cache_read_failed",
      error: error?.message || "cache read failed"
    }));
    return null;
  }
}


export async function writeJSONCache(cache, key, value, retentionMs) {
  try {
    const response = new Response(JSON.stringify(value), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": `public, max-age=${Math.ceil(retentionMs / 1000)}`
      }
    });
    await cache.put(key, response);
    return { ok: true, error: null };
  } catch (error) {
    const message = error?.message || "cache write failed";
    console.warn(JSON.stringify({ event: "api_football_cache_write_failed", error: message }));
    return { ok: false, error: message };
  }
}


export function cachedAPIFootball(state, cacheStatus, warning = null) {
  const stale = cacheStatus === "stale-cache";
  const staleLineupsDropped = stale && Array.isArray(state.data?.lineups)
    && state.data.lineups.length > 0;
  return {
    ...state.data,
    lineups: stale ? [] : state.data.lineups,
    meta: {
      cacheStatus,
      cachedAt: state.cachedAt,
      freshUntil: state.freshUntil,
      staleUntil: state.staleUntil,
      cooldownUntil: state.cooldownUntil || null,
      stale,
      staleLineupsDropped,
      warning: staleLineupsDropped
        ? [warning, "alineaciones stale descartadas por seguridad"].filter(Boolean).join("; ")
        : warning
    }
  };
}
