import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const CSS_URL = new URL("../../src/fanteam-premium.css", import.meta.url);
const REPORT_URL = new URL("../../docs/css-audit-fanteam-premium.md", import.meta.url);
// Presupuesto post-auditoría: la hoja no debe volver a crecer más allá del recorte.
const MAX_BYTES = 40_000;

test("fanteam-premium.css stays within the post-audit size budget", async () => {
  const size = (await stat(CSS_URL)).size;
  assert.ok(size <= MAX_BYTES, `fanteam-premium.css must stay <= ${MAX_BYTES} bytes, got ${size}`);
  assert.ok(size > 30_000, "the sheet must keep its real styles, got suspiciously small");
});

test("audit removed only provably dead legacy selectors", async () => {
  const css = await readFile(CSS_URL, "utf8");
  for (const removed of [".club-WOL", ".club-WHU", ".club-BUR"]) {
    assert.ok(!css.includes(removed), `${removed} must stay removed (no catalog club can generate it)`);
  }
  for (const kept of [".club-ARS", ".club-MCI", ".newsTag", ".newsCard", ".editorialNewsCard", ".ffSection", ".lineupNames", ".newsDesc", ".newsMetaLine", ".dataHealth", ".toast", ".pill", ".diffEasy", ".player", ".benchCard"]) {
    assert.ok(css.includes(kept), `${kept} must be preserved`);
  }
});

test("audit report is versioned with before/after sizes and the safelist", async () => {
  const report = await readFile(REPORT_URL, "utf8");
  assert.match(report, /Tamaño actual: \*\*41688 bytes\*\*/);
  assert.match(report, /Safelist documentada/);
  assert.match(report, /20 clubes del catálogo/);
});
