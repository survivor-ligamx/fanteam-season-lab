import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

test("index uses external CSS and a single compatibility loader", async () => {
  const html = await readFile(new URL("../../index.html", import.meta.url), "utf8");
  assert.ok(Buffer.byteLength(html) < 100_000, "index.html should stay below 100 KB");
  assert.match(html, /href="src\/app\.css\?v=1"/);
  assert.match(html, /<script src="src\/app-loader\.js\?v=1"><\/script>/);
  assert.doesNotMatch(html, /<script src="src\/app\.js\?v=1"><\/script>/);
  assert.equal((html.match(/<script\b/gi) || []).length, 1, "index should expose one script entrypoint");
  assert.doesNotMatch(html, /<scriptsrc=/i);
  assert.doesNotMatch(html, /<style(?:\s|>)/i);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)(?![^>]*\btype=["']application\/json["'])[^>]*>\s*\S/i);
  assert.ok((await stat(new URL("../../src/app.css", import.meta.url))).size > 1_000);
  assert.ok((await stat(new URL("../../src/app.js", import.meta.url))).size > 1_000);
});

test("web loader delegates to an ES module and preserves file fallback", async () => {
  const loader = await readFile(new URL("../../src/app-loader.js", import.meta.url), "utf8");
  const entry = await readFile(new URL("../../src/app-entry.js", import.meta.url), "utf8");
  assert.match(loader, /location\.protocol === "file:"/);
  assert.match(loader, /import\("\.\/app-entry\.js"\)/);
  const dependencies = ["season-storage.js", "fanteam-scoring.js", "fanteam-state.js", "fanteam-data.js", "fanteam-wildcard.js", "season-backup.js", "app.js"];
  let previous = -1;
  for (const dependency of dependencies) {
    const position = entry.indexOf(`"${dependency}"`);
    assert.ok(position > previous, `${dependency} must preserve dependency order`);
    previous = position;
  }
});
