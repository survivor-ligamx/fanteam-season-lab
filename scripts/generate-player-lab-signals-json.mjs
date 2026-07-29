import { readFile, writeFile } from "node:fs/promises";

// Keep the compact JSON byte-for-byte reproducible from the canonical offline snapshot.
const sourceUrl = new URL("../public-data/player-lab-signals.js", import.meta.url);
const targetUrl = new URL("../public-data/player-lab-signals.json", import.meta.url);
const prefix = "// Datos derivados y normalizados; no contiene los CSV fuente.\nglobalThis.FanTeamPlayerLabSignals = Object.freeze(";
const suffix = ");\n";
const source = await readFile(sourceUrl, "utf8");

if (!source.startsWith(prefix) || !source.endsWith(suffix)) {
  throw new Error("public-data/player-lab-signals.js no usa el wrapper canónico esperado");
}
const payload = JSON.parse(source.slice(prefix.length, -suffix.length));
await writeFile(targetUrl, `${JSON.stringify(payload)}\n`);
console.log(`Generated ${targetUrl.pathname}`);
