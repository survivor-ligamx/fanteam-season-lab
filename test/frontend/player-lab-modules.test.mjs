import assert from "node:assert/strict";
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
  const html = await import("node:fs/promises").then(({ readFile }) => (
    readFile(new URL("../../premier-player-lab.html", import.meta.url), "utf8")
  ));
  assert.match(html, /<script type="module" src="src\/premier-player-lab\.js\?v=4"><\/script>/);
});
