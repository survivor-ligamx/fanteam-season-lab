import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const INDEX_PATH = fileURLToPath(new URL("../../index.html", import.meta.url));
const STORAGE_MODULE_PATH = fileURLToPath(new URL("../../src/season-storage.js", import.meta.url));
const SCORING_MODULE_PATH = fileURLToPath(new URL("../../src/fanteam-scoring.js", import.meta.url));
const IMPORT_MODULE_PATH = fileURLToPath(new URL("../../src/fanteam-import.js", import.meta.url));
const HISTORY_MODULE_PATH = fileURLToPath(new URL("../../src/fanteam-history.js", import.meta.url));
const FINANCE_MODULE_PATH = fileURLToPath(new URL("../../src/fanteam-finance.js", import.meta.url));
const STATE_MODULE_PATH = fileURLToPath(new URL("../../src/fanteam-state.js", import.meta.url));
const DATA_MODULE_PATH = fileURLToPath(new URL("../../src/fanteam-data.js", import.meta.url));
const EDITORIAL_MODULE_PATH = fileURLToPath(new URL("../../src/fanteam-editorial.js", import.meta.url));
const ODDS_MODULE_PATH = fileURLToPath(new URL("../../src/fanteam-odds.js", import.meta.url));
const PROJECTION_MODULE_PATH = fileURLToPath(new URL("../../src/fanteam-projection.js", import.meta.url));
const MARKET_MODULE_PATH = fileURLToPath(new URL("../../src/fanteam-market.js", import.meta.url));
const TRANSFERS_MODULE_PATH = fileURLToPath(new URL("../../src/fanteam-transfers.js", import.meta.url));
const WEEK_MODULE_PATH = fileURLToPath(new URL("../../src/fanteam-week.js", import.meta.url));
const PLANNER_MODULE_PATH = fileURLToPath(new URL("../../src/fanteam-planner.js", import.meta.url));
const PLANNER_VIEW_MODULE_PATH = fileURLToPath(new URL("../../src/fanteam-planner-view.js", import.meta.url));
const WILDCARD_MODULE_PATH = fileURLToPath(new URL("../../src/fanteam-wildcard.js", import.meta.url));
const DEADLINES_MODULE_PATH = fileURLToPath(new URL("../../src/fanteam-deadlines.js", import.meta.url));
const BACKUP_MODULE_PATH = fileURLToPath(new URL("../../src/season-backup.js", import.meta.url));
const BOOTSTRAP = "initAutomation();renderWeek();";

export async function createFrontendHarness() {
  const [html, storageModuleSource, scoringModuleSource, importModuleSource, historyModuleSource, financeModuleSource, stateModuleSource, dataModuleSource, editorialModuleSource, oddsModuleSource, projectionModuleSource, marketModuleSource, transfersModuleSource, weekModuleSource, plannerModuleSource, plannerViewModuleSource, wildcardModuleSource, deadlinesModuleSource, backupModuleSource] = await Promise.all([
    readFile(INDEX_PATH, "utf8"),
    readFile(STORAGE_MODULE_PATH, "utf8"),
    readFile(SCORING_MODULE_PATH, "utf8"),
    readFile(IMPORT_MODULE_PATH, "utf8"),
    readFile(HISTORY_MODULE_PATH, "utf8"),
    readFile(FINANCE_MODULE_PATH, "utf8"),
    readFile(STATE_MODULE_PATH, "utf8"),
    readFile(DATA_MODULE_PATH, "utf8"),
    readFile(EDITORIAL_MODULE_PATH, "utf8"),
    readFile(ODDS_MODULE_PATH, "utf8"),
    readFile(PROJECTION_MODULE_PATH, "utf8"),
    readFile(MARKET_MODULE_PATH, "utf8"),
    readFile(TRANSFERS_MODULE_PATH, "utf8"),
    readFile(WEEK_MODULE_PATH, "utf8"),
    readFile(PLANNER_MODULE_PATH, "utf8"),
    readFile(PLANNER_VIEW_MODULE_PATH, "utf8"),
    readFile(WILDCARD_MODULE_PATH, "utf8"),
    readFile(DEADLINES_MODULE_PATH, "utf8"),
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
      get sync() { return SYNC; },
      setState(next) { state = migrateState(next); MKT = { gw: 0, stamp: null, map: null }; return state; },
      createSeasonBackup,
      parseSeasonBackup,
      replaceSeasonFromBackup,
      migrateState,
      stateNormalize: STATE_MODEL.normalize,
      dataPreparePayload: DATA_MODEL.preparePayload,
      dataPreparePlayerUpdates: DATA_MODEL.preparePlayerUpdates,
      dataPrepareResults: DATA_MODEL.prepareResults,
      dataDetectGameweek: DATA_MODEL.detectGameweek,
      editorialEvaluate: FanTeamEditorial.evaluate,
      editorialFinalWindow: FanTeamEditorial.finalWindow,
      editorialProjectionFactor,
      refreshFantasyFinal,
      renderFantasyFinal,
      oddsMarketTime: ODDS_ENGINE.marketTime,
      oddsIsMarketFresh: ODDS_ENGINE.isMarketFresh,
      oddsHasFreshData: ODDS_ENGINE.hasFreshData,
      oddsNormalize: ODDS_ENGINE.normalize,
      normalizedOdds,
      resolveClubCode,
      applyPlayerUpdates,
      applyPayload,
      reviewAutoDraftGW1,
      recordShadowRecommendation,
      syncData,
      applyResults,
      prepareDeadlineState,
      deadlineList,
      gwDeadline,
      detectedGW,
      advanceDetectedGameweek,
      renderCountdown,
      normalizeFanTeamStats,
      calculateFanTeamPoints,
      parsePriceInput,
      applyActualUpdates,
      historyApplyActualUpdates: HISTORY_MODEL.applyActualUpdates,
      evaluateHistoryEntry: HISTORY_MODEL.evaluateHistoryEntry,
      modelAccuracySummary,
      applyPriceUpdates,
      priceMovementFor,
      marketPriceMovementSummary,
      marketMetrics,
      marketTracker,
      marketGoalModel: FanTeamMarket.marketGoalModel,
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
      wildcardWorkerPayload,
      validateWildcardCandidate,
      optimizeWildcardInWorker,
      runWildcardOptimization,
      clearWildcardPlan,
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
  dom.window.eval(historyModuleSource);
  dom.window.eval(financeModuleSource);
  dom.window.eval(stateModuleSource);
  dom.window.eval(dataModuleSource);
  dom.window.eval(editorialModuleSource);
  dom.window.eval(oddsModuleSource);
  dom.window.eval(projectionModuleSource);
  dom.window.eval(marketModuleSource);
  dom.window.eval(transfersModuleSource);
  dom.window.eval(weekModuleSource);
  dom.window.eval(plannerModuleSource);
  dom.window.eval(plannerViewModuleSource);
  dom.window.eval(wildcardModuleSource);
  dom.window.eval(deadlinesModuleSource);
  dom.window.eval(backupModuleSource);
  dom.window.eval(source);

  return {
    api: dom.window.__FANTEAM_TEST__,
    dom,
    source: scriptMatch[1],
    close: () => dom.window.close(),
  };
}
