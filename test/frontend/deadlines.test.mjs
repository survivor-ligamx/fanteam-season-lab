import test from "node:test";
import assert from "node:assert/strict";

const source = await import("node:fs/promises").then((fs) => fs.readFile("src/fanteam-deadlines.js", "utf8"));
const vm = await import("node:vm");
const context = { globalThis: {} };
vm.runInNewContext(source, context);
const deadlines = context.globalThis.FanTeamDeadlines;

test("derives each deadline from the earliest kickoff minus 90 minutes", () => {
  const result = deadlines.derive([
    { gameweek: 1, kickoff: "2026-08-21T19:00:00Z" },
    { gameweek: 1, kickoff: "2026-08-21T17:30:00Z" },
  ], []);
  assert.equal(result[0], "2026-08-21T16:00:00.000Z");
});

test("uses fallback only when fixtures do not provide a deadline", () => {
  const result = deadlines.derive([], ["2026-08-21T17:00:00Z"]);
  assert.equal(result[0], "2026-08-21T17:00:00Z");
});

test("returns the next open gameweek", () => {
  const result = deadlines.next("2026-08-21T16:30:00Z", ["2026-08-21T16:00:00Z", "2026-08-28T16:00:00Z"]);
  assert.deepEqual(result, { gameweek: 2, deadline: "2026-08-28T16:00:00.000Z" });
});
