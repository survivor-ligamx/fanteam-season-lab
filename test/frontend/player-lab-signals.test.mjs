import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createPlayerLabSignalsLoader } from "../../src/player-lab/signals-loader.js";

const root = new URL("../../", import.meta.url);

test("JSON snapshot is exactly equivalent to the canonical JS snapshot", async () => {
  const source = await readFile(new URL("public-data/player-lab-signals.js", root), "utf8");
  const json = JSON.parse(await readFile(new URL("public-data/player-lab-signals.json", root), "utf8"));
  const prefix = "// Datos derivados y normalizados; no contiene los CSV fuente.\nglobalThis.FanTeamPlayerLabSignals = Object.freeze(";
  const suffix = ");\n";
  assert.deepEqual(json, JSON.parse(source.slice(prefix.length, -suffix.length)));
});

test("web loader fetches and memoizes the JSON snapshot", async () => {
  const payload = { version: 1, copilot: {}, draft: {}, probable: {} };
  const globalObject = {};
  let calls = 0;
  const load = createPlayerLabSignalsLoader({
    globalObject,
    locationObject: { protocol: "https:" },
    fetchImpl: async (url, options) => {
      calls += 1;
      assert.match(url, /player-lab-signals\.json$/);
      assert.equal(options.cache, "force-cache");
      return { ok: true, json: async () => payload };
    },
  });
  assert.equal(await load(), payload);
  assert.equal(await load(), payload);
  assert.equal(calls, 1);
});

test("file loader injects only the classic fallback", async () => {
  const globalObject = {};
  let appended;
  const documentObject = {
    createElement: () => ({ addEventListener(type, callback) { this[type] = callback; } }),
    head: { appendChild(script) { appended = script; globalObject.FanTeamPlayerLabSignals = { offline: true }; script.load(); } },
  };
  const load = createPlayerLabSignalsLoader({ globalObject, locationObject: { protocol: "file:" }, documentObject });
  assert.deepEqual(await load(), { offline: true });
  assert.match(appended.src, /player-lab-signals\.js$/);
});

test("Player Lab HTML does not load the heavy JS snapshot directly", async () => {
  const html = await readFile(new URL("premier-player-lab.html", root), "utf8");
  assert.doesNotMatch(html, /<script[^>]+player-lab-signals\.js/);
});
