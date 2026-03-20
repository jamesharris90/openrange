/* eslint-disable @typescript-eslint/no-var-requires */
// Runtime bridge for the server-side outcome evaluator.

const {
  ensureTradeOutcomeTables,
  evaluateSignals,
  updateStrategyStats,
  getPerformanceMetrics,
  getTradeHistory,
  getStrategyPerformance,
} = require('../server/engines/tradeOutcomeEngine');

export {
  ensureTradeOutcomeTables,
  evaluateSignals,
  updateStrategyStats,
  getPerformanceMetrics,
  getTradeHistory,
  getStrategyPerformance,
};
