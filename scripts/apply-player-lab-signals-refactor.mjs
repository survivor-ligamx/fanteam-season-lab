import { readFile, writeFile } from "node:fs/promises";

async function edit(path, transform) {
  const source = await readFile(path, "utf8");
  const result = transform(source);
  if (result === source) throw new Error(`No change applied to ${path}`);
  await writeFile(path, result);
}

await edit("premier-player-lab.html", (source) => source
  .replace('  <script src="public-data/player-lab-signals.js?v=1"></script>\n', "")
  .replace('src/premier-player-lab.js?v=4', 'src/premier-player-lab.js?v=5'));

await edit("src/premier-player-lab.js", (source) => {
  let result = source.replace(
    "import { createPlayerLabStatusRenderers } from './player-lab/status-renderers.js';\n",
    "import { createPlayerLabStatusRenderers } from './player-lab/status-renderers.js';\nimport { loadPlayerLabSignals } from './player-lab/signals-loader.js';\n",
  );
  result = result.replace('(function startPremierPlayerLab() {', 'async function startPremierPlayerLab() {');
  result = result.replace(
    '  const PublicSignals = globalThis.FanTeamPlayerLabSignals || null;',
    '  const PublicSignals = await loadPlayerLabSignals();',
  );
  const ending = '})();\n';
  if (!result.endsWith(ending)) throw new Error("Unexpected Player Lab entrypoint ending");
  const bootstrap = [
    '}',
    '',
    'startPremierPlayerLab().catch((error) => {',
    '  const grid = document.querySelector("#compareGrid");',
    '  if (grid) grid.innerHTML = `<div class="pl-card empty-state"><strong>No se pudo abrir Player Lab</strong>${String(error?.message || error)}</div>`;',
    '  const status = document.querySelector("#dataStatus span");',
    '  if (status) status.textContent = "Error al preparar datos";',
    '  console.error(error);',
    '});',
    '',
  ].join("\n");
  return result.slice(0, -ending.length) + bootstrap;
});

await edit("test/frontend/player-lab-modules.test.mjs", (source) => source.replace(
  'src\\/premier-player-lab\\.js\\?v=4',
  'src\\/premier-player-lab\\.js\\?v=5',
));

await edit("package.json", (source) => {
  const manifest = JSON.parse(source);
  manifest.scripts["generate:player-lab-signals"] = "node scripts/generate-player-lab-signals-json.mjs";
  return `${JSON.stringify(manifest, null, 2)}\n`;
});
