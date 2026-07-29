import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import vm from "node:vm";

// División mecánica y conservadora de src/app.js en módulos clásicos ordenados.
// Garantías: (1) la concatenación de las partes en orden del manifiesto reproduce
// byte a byte el archivo original; (2) cada parte compila como script clásico;
// (3) src/app.js queda como orquestador < 20 KB.

const source = readFileSync("src/app.js", "utf8");
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
if (acc.trim()) throw new Error("Quedó un resto sin compilar al final de src/app.js");
if (chunks.length !== 129) throw new Error(`Se esperaban 129 bloques, se obtuvieron ${chunks.length}`);

const MODULES = [
  { name: "data.js", from: 0, to: 0 },
  { name: "core.js", from: 1, to: 5 },
  { name: "wildcard-worker.js", from: 6, to: 9 },
  { name: "odds.js", from: 10, to: 13 },
  { name: "market.js", from: 14, to: 25 },
  { name: "week-view.js", from: 26, to: 43 },
  { name: "history.js", from: 44, to: 53 },
  { name: "wildcards.js", from: 54, to: 60 },
  { name: "editorial.js", from: 61, to: 70 },
  { name: "health.js", from: 71, to: 75 },
  { name: "updates.js", from: 76, to: 90 },
  { name: "news.js", from: 91, to: 108 },
  { name: "sync.js", from: 109, to: 116 },
  { name: "bindings.js", from: 117, to: 127 },
  { name: "bootstrap.js", from: 128, to: 128 },
];

mkdirSync("src/app", { recursive: true });
const partFiles = [];
for (const mod of MODULES) {
  const text = `${chunks.slice(mod.from, mod.to + 1).join("\n")}\n`;
  new vm.Script(text, { filename: mod.name });
  writeFileSync(`src/app/${mod.name}`, text);
  partFiles.push({ name: `app/${mod.name}`, bytes: Buffer.byteLength(text) });
}

const combined = partFiles.map((part) => readFileSync(`src/${part.name}`, "utf8")).join("");
if (combined !== source) throw new Error("La concatenación de módulos no reproduce src/app.js original");
new vm.Script(combined, { filename: "app-combined.js" });

const manifest = {
  comment: "Orden de carga de los módulos clásicos de la aplicación. src/app.js los carga en este orden; la concatenación en este orden reproduce el comportamiento original.",
  parts: partFiles.map((part) => part.name),
};
writeFileSync("src/app/manifest.json", `${JSON.stringify(manifest, null, 2)}\n`);

const orchestrator = `"use strict";\n\n// Orquestador de la aplicación: carga los módulos clásicos de src/app/ en el\n// orden fijado por src/app/manifest.json. Funciona igual en HTTP/HTTPS y file://.\n(() => {\n  const scriptUrl = document.currentScript && document.currentScript.src;\n  const parts = [\n${partFiles.map((part) => `    "${part.name}",`).join("\n")}\n  ];\n\n  function loadModule(name) {\n    return new Promise((resolve, reject) => {\n      const script = document.createElement("script");\n      script.src = new URL(name, scriptUrl).href;\n      script.onload = resolve;\n      script.onerror = () => reject(new Error(\`No se pudo cargar ${'${'}name}\`));\n      document.head.append(script);\n    });\n  }\n\n  parts\n    .reduce((chain, name) => chain.then(() => loadModule(name)), Promise.resolve())\n    .catch((error) => console.error(error));\n})();\n`;
writeFileSync("src/app.js", orchestrator);
new vm.Script(orchestrator, { filename: "app.js" });
if (Buffer.byteLength(orchestrator) >= 20000) throw new Error("El orquestador supera 20 KB");

console.log(`orchestrator: ${Buffer.byteLength(orchestrator)} bytes`);
for (const part of partFiles) console.log(`${part.bytes} ${part.name}`);
console.log("combined == original: true");
