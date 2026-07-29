import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createPlayerLabMatching } from "../../src/player-lab/matching.js";
import { createPlayerLabMonteCarlo } from "../../src/player-lab/monte-carlo.js";
import { createPlayerLabSnapshots } from "../../src/player-lab/snapshots.js";
import { createPlayerLabStatusRenderers } from "../../src/player-lab/status-renderers.js";

test("Player Lab focused modules expose factories", () => {
  assert.equal(typeof createPlayerLabMatching, "function");
  assert.equal(typeof createPlayerLabMonteCarlo, "function");
  assert.equal(typeof createPlayerLabSnapshots, "function");
  assert.equal(typeof createPlayerLabStatusRenderers, "function");
});

test("Player Lab HTML loads the ES module entrypoint", async () => {
  const html = await readFile(new URL("../../premier-player-lab.html", import.meta.url), "utf8");
  assert.match(html, /<script type="module" src="src\/premier-player-lab\.js\?v=5"><\/script>/);
});

test("Player Lab entrypoint imports every focused module", async () => {
  const source = await readFile(new URL("../../src/premier-player-lab.js", import.meta.url), "utf8");
  for (const moduleName of ["matching", "monte-carlo", "snapshots", "status-renderers"]) {
    assert.match(source, new RegExp(`from './player-lab/${moduleName}\\.js'`));
  }
});
