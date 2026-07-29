import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const cssPath = resolve(root, "src/fanteam-premium.css");
const htmlPath = resolve(root, "index.html");
const reportPath = resolve(root, "docs/css-audit-fanteam-premium.md");
const css = readFileSync(cssPath, "utf8");
const html = readFileSync(htmlPath, "utf8");
const sources = [html, ...readdirSync(resolve(root, "src"))
  .filter((name) => name.endsWith(".js"))
  .map((name) => readFileSync(resolve(root, "src", name), "utf8"))].join("\n");
const selectors = [...css.matchAll(/(^|})\s*([^@}{][^{]+)\{/gm)]
  .flatMap((match) => match[2].split(",").map((selector) => selector.trim()))
  .filter(Boolean);
const classes = new Set([...css.matchAll(/\.([A-Za-z_-][\w-]*)/g)].map((match) => match[1]));
const sourceTokens = new Set(sources.match(/[A-Za-z_-][\w-]*/g) || []);
const uncertain = [...classes].filter((name) => !sourceTokens.has(name));
const report = [
  "# Auditoría conservadora de CSS",
  "",
  `- Tamaño: **${Buffer.byteLength(css)} bytes**`,
  `- Selectores analizados: **${selectors.length}**`,
  `- Clases detectadas: **${classes.size}**`,
  `- Candidatos estáticos sin referencia literal: **${uncertain.length}**`,
  "",
  "## Regla de seguridad",
  "",
  "Este script no elimina CSS. Una clase sin referencia literal puede generarse dinámicamente, depender de datos, media queries, impresión o accesibilidad. Solo puede eliminarse después de confirmar su ausencia mediante cobertura de navegador y revisión humana.",
  "",
  "## Reproducción",
  "",
  "Ejecuta `node scripts/audit-css.mjs`. El reporte se actualiza sin modificar la hoja de estilos.",
  "",
  "## Safelist implícita",
  "",
  "Se conservan todas las clases, incluidos estados de UI, clases interpoladas como `club-*`, clases de datos y selectores responsive. No se retiraron selectores en esta primera auditoría segura.",
  "",
  "## Candidatos para revisión manual",
  "",
  ...uncertain.map((name) => `- \`.${name}\``),
].join("\n");
writeFileSync(reportPath, `${report}\n`);
console.log(report);
