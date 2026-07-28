export function createPlayerLabMonteCarlo({ state, MonteCarlo, actions }) {
  let monteCarloRequest = 0;
  let activeMonteCarloJob = null;
  const renderConsensusSquad = (...args) => actions.renderConsensusSquad(...args);

  function cancelMonteCarloJob() {
    monteCarloRequest += 1;
    const job = activeMonteCarloJob;
    activeMonteCarloJob = null;
    if (job?.timer) clearTimeout(job.timer);
    try { job?.worker?.terminate(); } catch (_) { /* El Worker ya terminó. */ }
  }
  function monteCarloFallback(consensus, error, payload = null) {
    consensus.monteCarlo = {
      status: "fallback",
      scenarioCount: payload?.scenarioCount || MonteCarlo.DEFAULT_SCENARIOS,
      candidateCount: 0,
      error: error?.message || "Monte Carlo no disponible",
    };
  }
  function startMonteCarlo(consensus) {
    if (!consensus?.squad) return;
    const request = monteCarloRequest;
    let payload;
    try {
      payload = MonteCarlo.createPayload(consensus);
      consensus.monteCarlo = {
        status: "running",
        scenarioCount: payload.scenarioCount,
        candidateCount: payload.candidateLimit,
      };
    } catch (error) {
      monteCarloFallback(consensus, error);
      return;
    }
    if (typeof globalThis.Worker !== "function") {
      monteCarloFallback(consensus, new Error("Worker no disponible"), payload);
      return;
    }

    try {
      const worker = new Worker(
        new URL("src/premier-monte-carlo-worker.js", document.baseURI),
        { name: "premier-consensus-monte-carlo" },
      );
      const job = { worker, request, consensus, payload, timer: null };
      activeMonteCarloJob = job;
      const finish = () => {
        if (activeMonteCarloJob === job) activeMonteCarloJob = null;
        if (job.timer) clearTimeout(job.timer);
        try { worker.terminate(); } catch (_) { /* El Worker ya terminó. */ }
      };
      const fail = (error) => {
        if (activeMonteCarloJob !== job) return;
        finish();
        if (request !== monteCarloRequest || state.consensus !== consensus) return;
        monteCarloFallback(consensus, error, payload);
        renderConsensusSquad();
      };
      worker.onmessage = (event) => {
        if (activeMonteCarloJob !== job) return;
        const message = event.data || {};
        if (message.type === "error") {
          fail(new Error(message.message || "falló Monte Carlo"));
          return;
        }
        if (message.type !== "result") return;
        try {
          const validated = MonteCarlo.validateResult(message, payload);
          finish();
          if (request !== monteCarloRequest || state.consensus !== consensus) return;
          consensus.squad = validated.squad;
          consensus.monteCarlo = validated.monteCarlo;
          renderConsensusSquad();
        } catch (error) {
          fail(error);
        }
      };
      worker.onerror = (event) => {
        event.preventDefault?.();
        fail(new Error("falló el Worker Monte Carlo"));
      };
      job.timer = setTimeout(() => {
        fail(new Error("Monte Carlo excedió el límite de 30 segundos"));
      }, 30000);
      try {
        worker.postMessage(payload);
      } catch (error) {
        fail(error);
      }
    } catch (error) {
      monteCarloFallback(consensus, error, payload);
    }
  }
  return { cancelMonteCarloJob, monteCarloFallback, startMonteCarlo };
}
