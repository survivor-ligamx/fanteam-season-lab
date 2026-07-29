import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import vm from "node:vm";

const inputPath = "src/app.js";
const source = readFileSync(inputPath, "utf8");
const lines = source.split("\n");

const chunks = [];
let start = 0;
let acc = "";
for (let i = 0; i < lines.length; i++) {
  acc += (i === start ? "" : "\n") + lines[i];
  let ok = false;
  try {
    new vm.Script(acc, { filename: "prefix.js" });
    ok = true;
  } catch (error) {
    if (!/Unexpected end of input/.test(error.message)) throw error;
  }
  if (ok && acc.trim()) {
    chunks.push(acc);
    start = i + 1;
    acc = "";
  }
}
if (acc.trim()) throw new Error("Quedó un resto sin compilar al final de la fuente");
if (chunks.length !== 129) throw new Error(`Se esperaban 129 bloques, se obtuvieron ${chunks.length}`);

// Declaraciones puras que core.js necesita en tiempo de carga (antes eran hoisting
// implícito del script único): nrm, editorialProjectionFactor y autoDraftCoreHorizon6.
const SHARED_CHUNKS = [32, 65, 85];

const MODULES = [
  { name: "data.js", chunks: [[0, 0]] },
  { name: "shared.js", chunks: [[32, 32], [65, 65], [85, 85]] },
  { name: "core.js", chunks: [[1, 5]] },
  { name: "wildcard-worker.js", chunks: [[6, 9]] },
  { name: "odds.js", chunks: [[10, 13]] },
  { name: "market.js", chunks: [[14, 25]] },
  { name: "week-view.js", chunks: [[26, 31], [33, 43]] },
  { name: "history.js", chunks: [[44, 53]] },
  { name: "wildcards.js", chunks: [[54, 60]] },
  { name: "editorial.js", chunks: [[61, 64], [66, 70]] },
  { name: "health.js", chunks: [[71, 75]] },
  { name: "updates.js", chunks: [[76, 84], [86, 90]] },
  { name: "news.js", chunks: [[91, 108]] },
  { name: "sync.js", chunks: [[109, 116]] },
  { name: "bindings.js", chunks: [[117, 127]] },
  { name: "bootstrap.js", chunks: [[128, 128]] },
];

// Cada bloque original debe usarse exactamente una vez.
const used = [];
for (const mod of MODULES) for (const [a, b] of mod.chunks) for (let i = a; i <= b; i++) used.push(i);
used.sort((a, b) => a - b);
if (used.length !== 129 || used.some((value, index) => value !== index)) {
  throw new Error(`Cobertura de bloques inválida: ${used.length}`);
}

mkdirSync("src/app", { recursive: true });
const partFiles = [];
for (const mod of MODULES) {
  const pieces = [];
  for (const [a, b] of mod.chunks) pieces.push(chunks.slice(a, b + 1).join("\n"));
  const text = `${pieces.join("\n")}\n`;
  new vm.Script(text, { filename: mod.name });
  writeFileSync(`src/app/${mod.name}`, text);
  partFiles.push({ name: `app/${mod.name}`, bytes: Buffer.byteLength(text) });
}

const combined = partFiles.map((part) => readFileSync(`src/${part.name}`, "utf8")).join("");
new vm.Script(combined, { filename: "app-combined.js" });
if (Buffer.byteLength(combined) !== Buffer.byteLength(source)) {
  throw new Error(`Bytes combinados ${Buffer.byteLength(combined)} != originales ${Buffer.byteLength(source)}`);
}

// Las declaraciones compartidas deben aparecer antes de los puntos de cableado de core.js.
const mustPrecede = [
  ["function nrm(", "FanTeamData.create("],
  ["function editorialProjectionFactor(", "FanTeamProjection.create("],
  ["function autoDraftCoreHorizon6(", "FanTeamWildcard.create("],
];
for (const [declaration, usage] of mustPrecede) {
  const d = combined.indexOf(declaration);
  const u = combined.indexOf(usage);
  if (d === -1 || u === -1 || d > u) throw new Error(`${declaration} debe preceder a ${usage}`);
}

const manifest = {
  comment: "Orden de carga de los módulos clásicos de la aplicación. src/app.js los carga en este orden; app/shared.js declara las funciones que core.js necesita en tiempo de carga.",
  parts: partFiles.map((part) => part.name),
};
writeFileSync("src/app/manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);

const orchestrator = `"use strict";\n\n// Orquestador de la aplicación: carga los módulos clásicos de src/app/ en el\n// orden fijado por src/app/manifest.json. Funciona igual en HTTP/HTTPS y file://.\n(() => {\n  const scriptUrl = document.currentScript && document.currentScript.src;\n  const parts = [\n${partFiles.map((part) => `    "${part.name}",`).join("\n")}\n  ];\n\n  function loadModule(name) {\n    return new Promise((resolve, reject) => {\n      const script = document.createElement("script");\n      script.src = new URL(name, scriptUrl).href;\n      script.onload = resolve;\n      script.onerror = () => reject(new Error(\`No se pudo cargar ${'${'}name}\`));\n      document.head.append(script);\n    });\n  }\n\n  parts\n    .reduce((chain, name) => chain.then(() => loadModule(name)), Promise.resolve())\n    .catch((error) => console.error(error));\n})();\n`;
writeFileSync("src/app.js", orchestrator);
new vm.Script(orchestrator, { filename: "app.js" });
if (Buffer.byteLength(orchestrator) >= 20000) throw new Error("El orquestador supera 20 KB");

console.log(`orchestrator: ${Buffer.byteLength(orchestrator)} bytes`);
for (const part of partFiles) console.log(`${part.bytes} ${part.name}`);
console.log("all checks passed");
