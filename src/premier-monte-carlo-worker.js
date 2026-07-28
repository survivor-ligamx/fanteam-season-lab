/* Data-only Monte Carlo worker for the Player Lab consensus squad. */
importScripts("premier-monte-carlo.js");

self.onmessage = (event) => {
  const message = event.data || {};
  if (message.type !== "simulate") return;
  try {
    self.postMessage(self.PremierMonteCarlo.simulate(message));
  } catch (error) {
    self.postMessage({
      type: "error",
      version: self.PremierMonteCarlo?.VERSION,
      message: error?.message || "falló la simulación Monte Carlo",
    });
  }
};
