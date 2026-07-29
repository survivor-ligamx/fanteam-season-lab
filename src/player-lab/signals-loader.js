const JSON_URL = new URL("../../public-data/player-lab-signals.json", import.meta.url);
const FALLBACK_URL = new URL("../../public-data/player-lab-signals.js", import.meta.url);

export function createPlayerLabSignalsLoader({
  globalObject = globalThis,
  locationObject = globalThis.location,
  documentObject = globalThis.document,
  fetchImpl = globalThis.fetch?.bind(globalThis),
} = {}) {
  let pending = null;

  function loadClassicFallback() {
    return new Promise((resolve, reject) => {
      const script = documentObject.createElement("script");
      script.src = FALLBACK_URL.href;
      script.async = true;
      script.addEventListener("load", () => resolve(globalObject.FanTeamPlayerLabSignals), { once: true });
      script.addEventListener("error", () => reject(new Error("No se pudo cargar el snapshot local de Player Lab")), { once: true });
      documentObject.head.appendChild(script);
    });
  }

  async function load() {
    if (globalObject.FanTeamPlayerLabSignals) return globalObject.FanTeamPlayerLabSignals;
    if (locationObject?.protocol === "file:") return loadClassicFallback();
    if (typeof fetchImpl !== "function") throw new Error("Este navegador no permite cargar las señales de Player Lab");

    const response = await fetchImpl(JSON_URL.href, {
      cache: "force-cache",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`No se pudieron cargar las señales de Player Lab (${response.status})`);
    const payload = await response.json();
    if (!payload || payload.version !== 1 || !payload.copilot || !payload.draft || !payload.probable) {
      throw new Error("El snapshot de Player Lab no tiene el formato esperado");
    }
    globalObject.FanTeamPlayerLabSignals = Object.freeze(payload);
    return globalObject.FanTeamPlayerLabSignals;
  }

  return () => {
    pending ||= load().catch((error) => {
      pending = null;
      throw error;
    });
    return pending;
  };
}

export const loadPlayerLabSignals = createPlayerLabSignalsLoader();
