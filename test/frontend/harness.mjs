import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const INDEX_PATH = fileURLToPath(new URL("../../index.html", import.meta.url));
const STORAGE_MODULE_PATH = fileURLToPath(new URL("../../src/season-storage.js", import.meta.url));
const SCORING_MODULE_PATH = fileURLToPath(new URL("../../src/fanteam-scoring.js", import.meta.url));
const IMPORT_MODULE_PATH = fileURLToPath(new URL("../../src/fanteam-import.js", import.meta.url));
const FINANCE_MODULE_PATH = fileURLToPath(new URL("../../src/fanteam-finance.js", import.meta.url));
const PROJECTION_MODULE_PATH = fileURLToPath(new URL("../../src/fanteam-projection.js", import.meta.url));
const TRANSFERS_MODULE_PATH = fileURLToPath(new URL("../../src/fanteam-transfers.js", import.meta.url));
const WEEK_MODULE_PATH = fileURLToPath(new URL("../../src/fanteam-week.js", import.meta.url));
const PLANNER_MODULE_PATH = fileURLToPath(new URL("../../src/fanteam-planner.js", import.meta.url));
const PLANNER_VIEW_MODULE_PATH = fileURLToPath(new URL("../../src/fanteam-planner-view.js", import.meta.url));
const WILDCARD_MODULE_PATH = fileURLToPath(new URL("../../src/fanteam-wildcard.js", import.meta.url));
const BACKUP_MODULE_PATH = fileURLToPath(new URL("../../src/season-backup.js", import.meta.url));
const BOOTSTRAP = "initAutomation();renderWeek();";

export async function createFrontendHarness() {
  const [html, storageModuleSource, scoringModuleSource, importModuleSource, financeModuleSource, projectionModuleSource, transfersModuleSource, weekModuleSource, plannerModuleSource, plannerViewModuleSource, wildcardModuleSource, backupModuleSource] = await Promise.all([
    readFile(INDEX_PATH, "utf8"),
    readFile(STORAGE_MODULE_PATH, "utf8"),
    readFile(SCORING_MODULE_PATH, "utf8"),
    readFile(IMPORT_MODULE_PATH, "utf8"),
    readFile(FINANCE_MODULE_PATH, "utf8"),
    readFile(PROJECTION_MODULE_PATH, "utf8"),
    readFile(TRANSFERS_MODULE_PATH, "utf8"),
    readFile(WEEK_MODULE_PATH, "utf8"),
    readFile(PLANNER_MODULE_PATH, "utf8"),
    readFile(PLANNER_VIEW_MODULE_PATH, "utf8"),
    readFile(WILDCARD_MODULE_PATH, "utf8"),
    readFile(BACKUP_MODULE_PATH, "utf8"),
  ]);
  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!scriptMatch) throw new Error("No se encontró el script principal de index.html");
  if (!scriptMatch[1].includes(BOOTSTRAP)) throw new Error("Cambió el arranque esperado del frontend");

  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    url: "https://fanteam.test/",
  });

  const exposure = `
    globalThis.__FANTEAM_TEST__ = {
      get players() { return PLAYERS; },
      get initial() { return INITIAL.slice(); },
      get state() { return state; },
      setState(next) { state = migrateState(next); return state; },
      createSeasonBackup,
      parseSeasonBackup,
      migrateState,
      normalizeFanTeamStats,
      calculateFanTeamPoints,
      parsePriceInput,
      applyPriceUpdates,
      priceMovementFor,
      marketPriceMovementSummary,
      bestXI,
      recommendationFor,
      simulateSixWeekPlan,
      applyCurrentDecision,
      applyDecisionToState,
      applyPlanFirstDecision,
      applyTransferToState,
      closeWeek: WEEK_MODEL.closeWeek,
      confirmCurrentWeek,
      idsAfterRecommendation,
      transferCount,
      freeAfterWeek,
      transferBankAfter,
      projection,
      horizon,
      byId,
      optimizeWildcard,
      wildcardStatus,
      applyWildcard,
      buyingPower,
      value,
      clubValid,
      renderWeek,
      POS_QUOTA,
    };
  `;

  const source = scriptMatch[1].replace(BOOTSTRAP, exposure);
  dom.window.eval(storageModuleSource);
  dom.window.eval(scoringModuleSource);
  dom.window.eval(importModuleSource);
  dom.window.eval(financeModuleSource);
  dom.window.eval(projectionModuleSource);
  dom.window.eval(transfersModuleSource);
  dom.window.eval(weekModuleSource);
  dom.window.eval(plannerModuleSource);
  dom.window.eval(plannerViewModuleSource);
  dom.window.eval(wildcardModuleSource);
  dom.window.eval(backupModuleSource);
  dom.window.eval(source);

  return {
    api: dom.window.__FANTEAM_TEST__,
    dom,
    source: scriptMatch[1],
    close: () => dom.window.close(),
  };
}
