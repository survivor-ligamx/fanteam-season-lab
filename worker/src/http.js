import { ALLOWED_ORIGINS, FUTBOLFANTASY_MAX_HTML_BYTES, REQUEST_TIMEOUT_MS } from './config.js';

export function allowedOrigin(request, env) {
  const origin = request?.headers?.get("Origin");
  if (!origin) return null;
  const configured = String(env?.CORS_ORIGINS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (ALLOWED_ORIGINS.has(origin) || configured.includes(origin)) return origin;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return null;
}


export function responseJSON(data, status = 200, cacheSeconds = 0, request = null, env = {}) {
  const pretty = request
    ? new URL(request.url).searchParams.get("pretty") === "1"
    : false;
  const origin = allowedOrigin(request, env);
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": cacheSeconds
      ? `public, max-age=${cacheSeconds}`
      : "no-store",
    "Vary": "Origin"
  };
  if (origin) headers["Access-Control-Allow-Origin"] = origin;

  return new Response(JSON.stringify(data, null, pretty ? 2 : 0), {
    status,
    headers
  });
}


export function retryAfterTimestamp(value, now = Date.now()) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return now + seconds * 1000;
  const date = new Date(value).getTime();
  return Number.isFinite(date) && date >= now ? date : null;
}


export async function safeRequest(url, options = {}) {
  const { timeoutMs = REQUEST_TIMEOUT_MS, ...fetchOptions } = options;
  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: fetchOptions.signal || AbortSignal.timeout(timeoutMs)
    });

    if (!response.ok) {
      return {
        ok: false,
        error: `HTTP ${response.status}`,
        status: response.status,
        retryAfterAt: response.status === 429
          ? retryAfterTimestamp(response.headers.get("Retry-After"), Date.now())
          : null,
        data: null
      };
    }

    return {
      ok: true,
      status: response.status,
      data: await response.json()
    };
  } catch (error) {
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    return {
      ok: false,
      error: timedOut ? `timeout después de ${timeoutMs} ms` : error.message,
      status: null,
      retryAfterAt: null,
      data: null
    };
  }
}


export async function safeTextRequest(url, options = {}) {
  const { timeoutMs = REQUEST_TIMEOUT_MS, ...fetchOptions } = options;
  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: fetchOptions.signal || AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) {
      return {
        ok: false,
        error: `HTTP ${response.status}`,
        status: response.status,
        retryAfterAt: response.status === 429
          ? retryAfterTimestamp(response.headers.get("Retry-After"), Date.now())
          : null,
        data: null
      };
    }
    const declaredLength = Number(response.headers.get("Content-Length"));
    if (Number.isFinite(declaredLength) && declaredLength > FUTBOLFANTASY_MAX_HTML_BYTES) {
      return { ok: false, error: "respuesta HTML demasiado grande", status: response.status, data: null };
    }
    const reader = response.body?.getReader();
    if (!reader) {
      return { ok: false, error: "respuesta HTML sin cuerpo legible", status: response.status, data: null };
    }
    const decoder = new TextDecoder();
    let data = "";
    let receivedBytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value?.byteLength || 0;
      if (receivedBytes > FUTBOLFANTASY_MAX_HTML_BYTES) {
        await reader.cancel("límite de tamaño excedido");
        return { ok: false, error: "respuesta HTML demasiado grande", status: response.status, data: null };
      }
      data += decoder.decode(value, { stream: true });
    }
    data += decoder.decode();
    return { ok: true, status: response.status, data };
  } catch (error) {
    const timedOut = error?.name === "TimeoutError" || error?.name === "AbortError";
    return {
      ok: false,
      error: timedOut ? `timeout después de ${timeoutMs} ms` : error.message,
      status: null,
      retryAfterAt: null,
      data: null
    };
  }
}
