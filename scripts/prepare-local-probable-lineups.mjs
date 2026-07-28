import { readFile, stat, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MAX_FILE_BYTES = 1024 * 1024;
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const input = resolve(process.argv[2] || `${homedir()}/Desktop/tabla_alineaciones_probables.csv`);
const output = resolve(root, ".local-data/probable-lineups-local.js");

const info = await stat(input);
if (!info.isFile()) throw new Error(`No es un archivo: ${input}`);
if (info.size <= 0) throw new Error("El CSV local de alineaciones está vacío");
if (info.size > MAX_FILE_BYTES) throw new Error("El CSV local de alineaciones supera el límite de 1 MB");

const text = await readFile(input, "utf8");
const payload = {
  filename: basename(input),
  lastModified: Math.trunc(info.mtimeMs),
  text,
};

await mkdir(dirname(output), { recursive: true });
await writeFile(
  output,
  `globalThis.ProbableLineupsLocalCsv = Object.freeze(${JSON.stringify(payload)});\n`,
  "utf8",
);

console.log(`snapshot local de alineaciones preparado: ${basename(input)} (${info.size} bytes)`);
