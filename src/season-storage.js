(function attachSeasonStorage(global) {
  "use strict";

  const STATE_KEY = "fanteam-season-lab-v1";
  const ENDPOINT_KEY = "fanteam-data-endpoint";
  const CACHE_KEY = "fanteam-data-cache";
  const DEFAULT_ENDPOINT = "https://fanteam-data.brandonleon480.workers.dev/";

  function createMemoryStorage() {
    const values = Object.create(null);
    return {
      getItem(key) {
        return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
      },
      setItem(key, value) {
        values[key] = String(value);
      },
      removeItem(key) {
        delete values[key];
      },
    };
  }

  function resolveStorage() {
    try {
      const storage = global.localStorage;
      const probe = "__ft_probe__";
      storage.setItem(probe, "1");
      storage.removeItem(probe);
      return storage;
    } catch (_) {
      return createMemoryStorage();
    }
  }

  const storage = resolveStorage();

  function create({ migrateState, createInitialState }) {
    if (typeof migrateState !== "function" || typeof createInitialState !== "function") {
      throw new TypeError("migrateState y createInitialState son obligatorios");
    }

    function loadState() {
      try {
        const candidate = JSON.parse(storage.getItem(STATE_KEY));
        if (candidate && Array.isArray(candidate.squad) && candidate.squad.length === 15) {
          return migrateState(candidate);
        }
      } catch (_) {}
      return migrateState(createInitialState());
    }

    function getStateRaw() {
      try {
        return storage.getItem(STATE_KEY);
      } catch (_) {
        return null;
      }
    }

    function saveState(state) {
      storage.setItem(STATE_KEY, JSON.stringify(state));
    }

    function replaceState(state, endpoint) {
      const previousState = storage.getItem(STATE_KEY);
      const previousEndpoint = storage.getItem(ENDPOINT_KEY);
      try {
        storage.setItem(STATE_KEY, JSON.stringify(state));
        if (endpoint != null) storage.setItem(ENDPOINT_KEY, String(endpoint));
        return true;
      } catch (error) {
        try {
          if (previousState == null) storage.removeItem(STATE_KEY);
          else storage.setItem(STATE_KEY, previousState);
          if (previousEndpoint == null) storage.removeItem(ENDPOINT_KEY);
          else storage.setItem(ENDPOINT_KEY, previousEndpoint);
        } catch (_) {}
        throw error;
      }
    }

    function resetState() {
      storage.removeItem(STATE_KEY);
    }

    function getEndpoint() {
      return storage.getItem(ENDPOINT_KEY) || "";
    }

    function setEndpoint(endpoint) {
      storage.setItem(ENDPOINT_KEY, endpoint == null ? "" : String(endpoint));
    }

    function loadCache() {
      try {
        return JSON.parse(storage.getItem(CACHE_KEY) || "null");
      } catch (_) {
        return null;
      }
    }

    function saveCache(payload) {
      try {
        storage.setItem(CACHE_KEY, JSON.stringify(payload));
        return true;
      } catch (_) {
        return false;
      }
    }

    return Object.freeze({
      loadState,
      getStateRaw,
      saveState,
      replaceState,
      resetState,
      getEndpoint,
      setEndpoint,
      loadCache,
      saveCache,
    });
  }

  global.FanTeamSeasonStorage = Object.freeze({
    STATE_KEY,
    ENDPOINT_KEY,
    CACHE_KEY,
    DEFAULT_ENDPOINT,
    create,
  });
})(globalThis);
