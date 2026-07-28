import { File } from "node:buffer";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [copilotArgument, draftArgument, probableArgument] = process.argv.slice(2);
const sources = {
  copilot: resolve(copilotArgument || `${homedir()}/Desktop/tabla_fpl_completa.csv`),
  draft: resolve(draftArgument || `${homedir()}/Desktop/tabla_draftfantasy_proyecciones.csv`),
  probable: resolve(probableArgument || `${homedir()}/Desktop/tabla_alineaciones_probables.csv`),
};
const output = resolve(root, "public-data/player-lab-signals.js");
const MAX_OUTPUT_BYTES = 700 * 1024;

async function readSource(path, maximumBytes) {
  const info = await stat(path);
  if (!info.isFile()) throw new Error(`No es un archivo: ${path}`);
  if (info.size <= 0) throw new Error(`El archivo está vacío: ${path}`);
  if (info.size > maximumBytes) throw new Error(`El archivo supera ${maximumBytes} bytes: ${path}`);
  return {
    filename: basename(path),
    fileModifiedAt: new Date(info.mtimeMs).toISOString(),
    lastModified: Math.trunc(info.mtimeMs),
    text: await readFile(path, "utf8"),
  };
}

const [copilotSource, draftSource, probableSource] = await Promise.all([
  readSource(sources.copilot, 4 * 1024 * 1024),
  readSource(sources.draft, 4 * 1024 * 1024),
  readSource(sources.probable, 1024 * 1024),
]);

globalThis.File = File;
await import("../src/premier-data.js");
await import("../src/fpl-copilot-import.js");
await import("../src/draft-fantasy-import.js");
await import("../src/probable-lineups-import.js");

const copilotParsed = await globalThis.FplCopilotImport.parseFile(new File(
  [copilotSource.text],
  copilotSource.filename,
  { type: "text/csv", lastModified: copilotSource.lastModified },
));
const copilot = globalThis.FplCopilotImport.normalizePayload(copilotParsed, {
  filename: copilotSource.filename,
  importedAt: copilotSource.fileModifiedAt,
  fileModifiedAt: copilotSource.fileModifiedAt,
});
const draft = globalThis.DraftFantasyImport.parseText(draftSource.text, {
  filename: draftSource.filename,
  importedAt: draftSource.fileModifiedAt,
  fileModifiedAt: draftSource.fileModifiedAt,
});
const probable = globalThis.ProbableLineupsImport.parseText(probableSource.text, {
  filename: probableSource.filename,
  importedAt: probableSource.fileModifiedAt,
  fileModifiedAt: probableSource.fileModifiedAt,
});

const compactCopilot = {
  version: copilot.version,
  importedAt: copilot.importedAt,
  sourceUpdatedAt: copilot.sourceUpdatedAt,
  fileModifiedAt: copilot.fileModifiedAt,
  filename: copilot.filename,
  meta: copilot.meta,
  players: copilot.players.map((player) => ({
    ...(player.id == null ? {} : { id: player.id }),
    name: player.name,
    aliases: player.aliases,
    position: player.position,
    team: player.team,
    teamCode: player.teamCode,
    ...(player.fplCode == null ? {} : { fplCode: player.fplCode }),
    gameweeks: player.gameweeks.map((row) => ({ gw: row.gw, points: row.points })),
  })),
};

const payload = {
  version: 1,
  generatedAt: new Date(Math.max(
    copilotSource.lastModified,
    draftSource.lastModified,
    probableSource.lastModified,
  )).toISOString(),
  copilot: compactCopilot,
  draft,
  probable,
};
const serialized = JSON.stringify(payload)
  .replaceAll("<", "\\u003c")
  .replaceAll("\u2028", "\\u2028")
  .replaceAll("\u2029", "\\u2029");

const outputSource = `// Datos derivados y normalizados; no contiene los CSV fuente.\n`
  + `globalThis.FanTeamPlayerLabSignals = Object.freeze(${serialized});\n`;
const outputBytes = Buffer.byteLength(outputSource, "utf8");
if (outputBytes > MAX_OUTPUT_BYTES) {
  throw new Error(`El snapshot público supera el límite de ${MAX_OUTPUT_BYTES} bytes`);
}

await mkdir(dirname(output), { recursive: true });
await writeFile(output, outputSource, "utf8");

console.log([
  `snapshot público generado: ${output}`,
  `${outputBytes} bytes`,
  `Copilot ${copilot.players.length}`,
  `Draft ${draft.players.length}`,
  `Alineaciones ${probable.players.length}`,
].join(" · "));
