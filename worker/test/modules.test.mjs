import assert from "node:assert/strict";
import test from "node:test";

import worker, { APIFootballCoordinator } from "../src/index.js";
import { BUILD_ID, VERSION } from "../src/config.js";

test("modular Worker preserves public exports", () => {
  assert.equal(typeof worker?.fetch, "function");
  assert.equal(typeof APIFootballCoordinator, "function");
  assert.equal(VERSION, "2.3.1");
  assert.equal(BUILD_ID, "api-football-resilience-v1");
});

test("modular Worker preserves the health contract", async () => {
  const response = await worker.fetch(
    new Request("https://fanteam-data.invalid/health"),
    {},
    { waitUntil() {} },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.service, "FanTeam Data Engine");
  assert.equal(body.version, VERSION);
  assert.equal(body.build, BUILD_ID);
  assert.equal(typeof body.updatedAt, "string");
});
