const dependencies = [
  "season-storage.js",
  "fanteam-scoring.js",
  "fanteam-import.js",
  "fanteam-history.js",
  "fanteam-finance.js",
  "fanteam-state.js",
  "fanteam-data.js",
  "fanteam-editorial.js",
  "fanteam-odds.js",
  "fanteam-projection.js",
  "fanteam-market.js",
  "fanteam-transfers.js",
  "fanteam-week.js",
  "fanteam-planner.js",
  "fanteam-planner-view.js",
  "fanteam-wildcard.js",
  "fanteam-deadlines.js",
  "season-backup.js",
  "app.js",
];

function loadClassicScript(name) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = new URL(name, import.meta.url).href;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`No se pudo cargar ${name}`));
    document.head.append(script);
  });
}

for (const dependency of dependencies) {
  await loadClassicScript(dependency);
}
