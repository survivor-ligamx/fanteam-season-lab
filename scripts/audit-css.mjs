import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const cssPath = resolve(root, "src/fanteam-premium.css");
const css = readFileSync(cssPath, "utf8");
const html = readFileSync(resolve(root, "index.html"), "utf8");
const js = readdirSync(resolve(root, "src"), { recursive: true })
  .filter((name) => String(name).endsWith(".js"))
  .map((name) => readFileSync(resolve(root, "src", name), "utf8")).join("\n");
const tokens = new Set(`${html}\n${js}`.match(/[A-Za-z_-][\w-]*/g) || []);
const classes = [...new Set([...css.matchAll(/\.([A-Za-z_-][\w-]*)/g)].map((m) => m[1]))];
const candidates = classes.filter((name) => !tokens.has(name));

async function browserCoverage() {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const cdp = await page.context().newCDPSession(page);
    const sheets = new Map();
    cdp.on("CSS.styleSheetAdded", ({ header }) => sheets.set(header.styleSheetId, header.sourceURL));
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    await cdp.send("CSS.startRuleUsageTracking");
    await page.goto(pathToFileURL(resolve(root, "index.html")).href);
    for (const button of await page.locator("[data-tab]").all()) await button.click();
    const { ruleUsage } = await cdp.send("CSS.stopRuleUsageTracking");
    const rules = ruleUsage.filter((rule) => sheets.get(rule.styleSheetId)?.endsWith("fanteam-premium.css"));
    const total = rules.reduce((sum, rule) => sum + rule.endOffset - rule.startOffset, 0);
    const used = rules.filter((rule) => rule.used).reduce((sum, rule) => sum + rule.endOffset - rule.startOffset, 0);
    return { total, used, percent: total ? +(used * 100 / total).toFixed(1) : 0 };
  } finally { await browser.close(); }
}

const coverage = process.argv.includes("--coverage") ? await browserCoverage() : null;
const report = ["# Auditoría conservadora de `src/fanteam-premium.css`", "", `- Tamaño: **${Buffer.byteLength(css)} bytes**`, `- Clases analizadas: **${classes.length}**`, `- Candidatos sin referencia literal: **${candidates.length}**`, coverage ? `- Cobertura CDP de reglas recorridas: **${coverage.percent}%**` : "- Cobertura CDP: ejecuta `node scripts/audit-css.mjs --coverage`.", "", "## Seguridad", "", "La cobertura y la búsqueda estática son evidencia, no autorización de borrado. Se conservan selectores dinámicos, estados interactivos, responsive, impresión y accesibilidad. Esta auditoría no elimina CSS automáticamente.", "", "## Safelist", "", "`club-*`, clases aplicadas desde JavaScript, pseudoestados y selectores sin referencia literal se mantienen hasta revisión humana.", "", "## Candidatos para revisar", "", ...candidates.map((name) => `- \`.${name}\``)].join("\n");
writeFileSync(resolve(root, "docs/css-audit-fanteam-premium.md"), `${report}\n`);
console.log(report);
