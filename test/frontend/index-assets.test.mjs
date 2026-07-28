import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

test("index uses external CSS and JavaScript assets", async () => {
  const html = await readFile(new URL("../../index.html", import.meta.url), "utf8");
  assert.ok(Buffer.byteLength(html) < 100_000, "index.html should stay below 100 KB");
  assert.match(html, /href="src\/index-inline-1\.css\?v=1"/);
  assert.match(html, /src="src\/index-inline-1\.js\?v=1"/);
  assert.doesNotMatch(html, /<style(?:\s|>)/i);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)(?![^>]*\btype=["']application\/json["'])[^>]*>\s*\S/i);
  assert.ok((await stat(new URL("../../src/index-inline-1.css", import.meta.url))).size > 1_000);
  assert.ok((await stat(new URL("../../src/index-inline-1.js", import.meta.url))).size > 1_000);
});
