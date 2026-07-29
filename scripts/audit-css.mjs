import { readFileSync, writeFileSync, readdirSync } from "node:fs";

// Auditoría estática y conservadora de src/fanteam-premium.css.
// --report: imprime el análisis en Markdown sin tocar archivos.
// --apply: escribe el CSS recortado + docs/css-audit-fanteam-premium.md.
// Regla de decisión: solo se retiran reglas/selectores demostrablemente sin uso
// en index.html y en los literales de los scripts que manipulan esa página.

const mode = process.argv.includes("--apply") ? "apply" : "report";
const CSS_PATH = "src/fanteam-premium.css";
const CATALOG_CLUBS = new Set([
  "ARS", "AVL", "BHA", "BOU", "BRE", "CHE", "CRY", "CVC", "EVE", "FUL",
  "HUL", "IPS", "LEE", "LIV", "MCI", "MUN", "NEW", "NFO", "SUN", "TOT",
]);

const css = readFileSync(CSS_PATH, "utf8");
const originalBytes = Buffer.byteLength(css);

// ---------- 1) Parser CSS tolerante ----------
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => " ".repeat(m.length));
}

function parseBlocks(text, context = []) {
  const rules = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    while (i < n && /\s/.test(text[i])) i++;
    if (i >= n) break;
    let preludeEnd = i;
    let paren = 0, bracket = 0;
    while (preludeEnd < n) {
      const c = text[preludeEnd];
      if (c === "(") paren++;
      else if (c === ")") paren--;
      else if (c === "[") bracket++;
      else if (c === "]") bracket--;
      else if (c === "{" && paren === 0 && bracket === 0) break;
      preludeEnd++;
    }
    if (preludeEnd >= n) break;
    const prelude = text.slice(i, preludeEnd).trim();
    let depth = 1;
    let j = preludeEnd + 1;
    let quote = null;
    while (j < n && depth > 0) {
      const c = text[j];
      if (quote) {
        if (c === "\\") j++;
        else if (c === quote) quote = null;
      } else if (c === '"' || c === "'") quote = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      j++;
    }
    const body = text.slice(preludeEnd + 1, j - 1);
    const full = text.slice(i, j);
    if (prelude.startsWith("@media")) {
      rules.push({ kind: "media", prelude, body, full, context, children: parseBlocks(body, [...context, prelude]) });
    } else if (prelude.startsWith("@keyframes")) {
      const name = prelude.replace(/^@keyframes\s+/, "").trim();
      rules.push({ kind: "keyframes", prelude, name, full, context });
    } else if (prelude.startsWith("@")) {
      rules.push({ kind: "at-rule", prelude, body, full, context });
    } else if (prelude) {
      rules.push({ kind: "rule", selector: prelude, body, full, context });
    }
    i = j;
  }
  return rules;
}

const parsed = parseBlocks(stripComments(css));

// ---------- 2) Tokens de uso ----------
function classTokensOf(selector) {
  const tokens = new Set();
  for (const match of selector.matchAll(/\.(-?[A-Za-z_][A-Za-z0-9_-]*)/g)) tokens.add(match[1]);
  return tokens;
}
function idTokensOf(selector) {
  const tokens = new Set();
  for (const match of selector.matchAll(/#([A-Za-z_][A-Za-z0-9_-]*)/g)) tokens.add(match[1]);
  return tokens;
}

const usedClasses = new Set();
const usedIds = new Set();

const html = readFileSync("index.html", "utf8");
for (const match of html.matchAll(/class="([^"]+)"/g)) {
  for (const token of match[1].split(/\s+/)) if (token) usedClasses.add(token);
}
for (const match of html.matchAll(/id="([^"]+)"/g)) usedIds.add(match[1]);

// Literales de los scripts que renderizan en index.html (app principal).
const jsFiles = readdirSync("src")
  .filter((name) => name.endsWith(".js") && !name.startsWith("premier-") && !name.startsWith("fpl-copilot") && !name.startsWith("draft-fantasy") && !name.startsWith("probable-lineups"))
  .map((name) => `src/${name}`);
let literals = 0;
for (const file of jsFiles) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/gs)) {
    const raw = match[1] ?? match[2] ?? match[3] ?? "";
    for (const token of raw.split(/[^A-Za-z0-9_-]+/)) {
      if (token) { usedClasses.add(token); literals++; }
    }
    for (const token of raw.split(/\s+/)) if (token) usedClasses.add(token);
  }
}

// Legacy congelado: solo cuenta como uso si referencia explícitamente esta hoja.
let legacyUsesSheet = false;
try {
  const legacy = readFileSync("legacy/index-v1.html", "utf8");
  legacyUsesSheet = legacy.includes("fanteam-premium.css");
  if (legacyUsesSheet) {
    for (const match of legacy.matchAll(/class="([^"]+)"/g)) {
      for (const token of match[1].split(/\s+/)) if (token) usedClasses.add(token);
    }
  }
} catch { /* sin legacy */ }

// Safelist documentada: clases que se construyen por interpolación con datos.
const SAFELIST = new Set();
for (const club of CATALOG_CLUBS) SAFELIST.add(`club-${club}`);
const SAFE_PREFIXES = [];
const isUsed = (token) => usedClasses.has(token) || SAFELIST.has(token) || SAFE_PREFIXES.some((prefix) => token.startsWith(prefix));

// ---------- 3) Evaluación de reglas ----------
const decisions = [];
function evaluate(selector, context) {
  const parts = selector.split(",").map((part) => part.trim()).filter(Boolean);
  const verdicts = parts.map((part) => {
    const classes = [...classTokensOf(part)];
    const ids = [...idTokensOf(part)];
    const idLive = ids.every((id) => usedIds.has(id));
    const live = (classes.length === 0 && ids.length === 0)
      || classes.some(isUsed)
      || (ids.length > 0 && idLive && classes.length === 0);
    const deadClasses = classes.filter((token) => !isUsed(token));
    return { part, live, classes, ids, deadClasses, idLive };
  });
  const liveParts = verdicts.filter((v) => v.live);
  const deadParts = verdicts.filter((v) => !v.live);
  return { selector, context, verdicts, liveParts, deadParts, status: liveParts.length === 0 ? "dead" : deadParts.length === 0 ? "live" : "mixed" };
}

function walk(rules) {
  for (const rule of rules) {
    if (rule.kind === "rule") decisions.push(evaluate(rule.selector, rule.context));
    else if (rule.kind === "media") walk(rule.children);
  }
}
walk(parsed);

// Keyframes: solo vivos si alguna regla los referencia en `animation`.
const animationRefs = new Set();
for (const match of css.matchAll(/animation:\s*([A-Za-z_][A-Za-z0-9_-]*)/g)) animationRefs.add(match[1]);
const keyframeRules = [];
function collectKeyframes(rules) {
  for (const rule of rules) {
    if (rule.kind === "keyframes") keyframeRules.push(rule);
    else if (rule.kind === "media") collectKeyframes(rule.children);
  }
}
collectKeyframes(parsed);
const deadKeyframes = keyframeRules.filter((rule) => !animationRefs.has(rule.name));

// ---------- 4) Reporte ----------
const deadRules = decisions.filter((d) => d.status === "dead");
const mixedRules = decisions.filter((d) => d.status === "mixed");
const removedSelectorsEstimate =
  deadRules.reduce((sum, d) => sum + d.selector.length, 0)
  + mixedRules.reduce((sum, d) => sum + d.deadParts.reduce((s, v) => s + v.part.length + 2, 0), 0)
  + deadKeyframes.reduce((sum, rule) => sum + rule.full.length, 0);

const lines = [];
lines.push(`# Auditoría de \`${CSS_PATH}\``);
lines.push("");
lines.push(`- Tamaño actual: **${originalBytes} bytes**`);
lines.push(`- Reglas de estilo evaluadas: **${decisions.length}**`);
lines.push(`- Clases con uso detectado (HTML + ${jsFiles.length} scripts, ${literals} literales): **${usedClasses.size}**`);
lines.push(`- Legacy \`legacy/index-v1.html\` referencia la hoja: **${legacyUsesSheet ? "sí" : "no"}**`);
lines.push(`- Estimación bruta retirable: **~${removedSelectorsEstimate} bytes**`);
lines.push("");
lines.push(`## Reglas muertas (${deadRules.length})`);
for (const d of deadRules) lines.push(`- \`${d.selector.replace(/\s+/g, " ")}\`${d.context.length ? ` (en ${d.context.join(" > ")})` : ""}`);
lines.push("");
lines.push(`## Selectores muertos dentro de reglas vivas (${mixedRules.length})`);
for (const d of mixedRules) {
  for (const v of d.deadParts) lines.push(`- \`${v.part}\` de \`${d.selector.replace(/\s+/g, " ")}\``);
}
lines.push("");
lines.push(`## Keyframes sin referencia (${deadKeyframes.length})`);
for (const rule of deadKeyframes) lines.push(`- \`${rule.name}\``);
lines.push("");
lines.push("## Safelist documentada");
lines.push(`- \`club-*\` para los 20 clubes del catálogo (se genera con \`club-\${player.club}\`): ${[...SAFELIST].join(", ")}`);

const report = `${lines.join("\n")}\n`;

if (mode === "report") {
  console.log(report);
} else {
  // --apply: retira reglas muertas completas, recorta selectores muertos de
  // reglas mixtas y elimina keyframes sin referencia. No toca nada más.
  const deadSelectorSet = new Set(deadRules.map((d) => d.selector));
  const deadKeyframeSet = new Set(deadKeyframes.map((rule) => rule.full));
  const mixedMap = new Map(mixedRules.map((d) => [d.selector, d]));

  function rewrite(rules, text) {
    function emit(blocks, source) {
      let local = "";
      let pos = 0;
      for (const block of blocks) {
        local += source.slice(pos, source.indexOf(block.full, pos));
        if (block.kind === "rule") {
          if (deadSelectorSet.has(block.selector)) {
            // retirar la regla completa
          } else if (mixedMap.has(block.selector)) {
            const d = mixedMap.get(block.selector);
            const kept = d.liveParts.map((v) => v.part).join(", ");
            local += `${kept} {${block.body}}`;
          } else {
            local += block.full;
          }
        } else if (block.kind === "keyframes") {
          if (!deadKeyframeSet.has(block.full)) local += block.full;
        } else if (block.kind === "media") {
          const inner = emit(block.children, block.body);
          if (inner.trim()) local += `${block.prelude} {${inner}}`;
        } else {
          local += block.full;
        }
        pos = source.indexOf(block.full, pos) + block.full.length;
      }
      local += source.slice(pos);
      return local;
    }
    return emit(rules, text);
  }

  const next = rewrite(parsed, css);
  writeFileSync(CSS_PATH, next);
  writeFileSync("docs/css-audit-fanteam-premium.md", report);
  console.log(`bytes: ${originalBytes} -> ${Buffer.byteLength(next)}`);
  console.log(`dead rules removed: ${deadRules.length}`);
  console.log(`mixed rules trimmed: ${mixedRules.length}`);
  console.log(`dead keyframes removed: ${deadKeyframes.length}`);
}
