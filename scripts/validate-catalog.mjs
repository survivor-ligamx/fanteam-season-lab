import fs from "node:fs";

const catalogSources = ["index.html", "src/app.js", "src/app/data.js"]
  .filter((path) => fs.existsSync(path))
  .map((path) => fs.readFileSync(path, "utf8"));
const source = catalogSources.join("\n");
const match = source.match(/const PLAYERS\s*=\s*(\[[\s\S]*?\]);const FIXTURES/);
if (!match) throw new Error("PLAYERS catalog not found in frontend sources");
const players = Function(`return (${match[1]})`)();
const allowedClubs = new Set(["ARS", "AVL", "BHA", "BOU", "BRE", "CHE", "CRY", "CVC", "EVE", "FUL", "HUL", "IPS", "LEE", "LIV", "MCI", "MUN", "NEW", "NFO", "SUN", "TOT"]);
const allowedPositions = new Set(["GK", "DEF", "MID", "FWD"]);
const ids = new Set();
const identities = new Set();
const failures = [];
const normalize = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
for (const player of players) {
  if (ids.has(player.id)) failures.push(`duplicate id ${player.id}`);
  ids.add(player.id);
  const identity = `${normalize(player.name)}|${player.club}`;
  if (identities.has(identity)) failures.push(`duplicate identity ${identity}`);
  identities.add(identity);
  if (!allowedClubs.has(player.club)) failures.push(`invalid club ${player.id}: ${player.club}`);
  if (!allowedPositions.has(player.pos)) failures.push(`invalid position ${player.id}: ${player.pos}`);
  if (!Number.isFinite(player.price) || player.price <= 0) failures.push(`invalid price ${player.id}`);
  if (typeof player.name !== "string" || !player.name.trim()) failures.push(`empty name ${player.id}`);
}
if (players.length !== 580) failures.push(`expected 580 players, got ${players.length}`);
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(`catalog ok: ${players.length} players, ${ids.size} ids, ${identities.size} identities`);
