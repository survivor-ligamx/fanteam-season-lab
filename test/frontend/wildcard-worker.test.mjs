import test from "node:test";
import assert from "node:assert/strict";
import * as vm from "node:vm";
import { readFile } from "node:fs/promises";

test("wildcard worker devuelve una plantilla factible y serializable", async () => {
  const source = await readFile("src/fanteam-wildcard-worker.js", "utf8");
  const messages = [];
  const worker = {
    postMessage(message) {
      messages.push(JSON.parse(JSON.stringify(message)));
    },
  };
  const context = vm.createContext({ self: worker });
  vm.runInContext(source, context);
  const players = [];
  for (const [pos, count] of [["GK", 4], ["DEF", 10], ["MID", 10], ["FWD", 8]]) {
    for (let index = 0; index < count; index += 1) {
      players.push({
        id: players.length + 1,
        pos,
        club: `${pos}${index % 5}`,
        price: pos === "FWD" ? 7 : 5,
        confidence: 90,
      });
    }
  }
  const scores = players.map((player) => ({
    id: player.id,
    value: player.pos === "FWD" ? 8 : 5,
  }));
  worker.onmessage({
    data: {
      type: "optimize",
      players,
      scores,
      budget: 100,
      quotas: { GK: 2, DEF: 5, MID: 5, FWD: 3 },
      formations: [[3, 5, 2], [4, 4, 2], [3, 4, 3]],
    },
  });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, "result");
  assert.equal(messages[0].ids.length, 15);
  assert.ok(messages[0].cost <= 100.001);
});
