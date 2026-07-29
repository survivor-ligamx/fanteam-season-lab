"use strict";

// Orquestador de la aplicación: carga los módulos clásicos de src/app/ en el
// orden fijado por src/app/manifest.json. Funciona igual en HTTP/HTTPS y file://.
(() => {
  const scriptUrl = document.currentScript && document.currentScript.src;
  const parts = [
    "app/data.js",
    "app/shared.js",
    "app/core.js",
    "app/wildcard-worker.js",
    "app/odds.js",
    "app/market.js",
    "app/week-view.js",
    "app/history.js",
    "app/wildcards.js",
    "app/editorial.js",
    "app/health.js",
    "app/updates.js",
    "app/news.js",
    "app/sync.js",
    "app/bindings.js",
    "app/bootstrap.js",
  ];

  function loadModule(name) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = new URL(name, scriptUrl).href;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`No se pudo cargar ${name}`));
      document.head.append(script);
    });
  }

  parts
    .reduce((chain, name) => chain.then(() => loadModule(name)), Promise.resolve())
    .catch((error) => console.error(error));
})();
