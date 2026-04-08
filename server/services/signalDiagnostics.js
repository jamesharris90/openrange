function analyzeDecisionFailures(decisions) {
  const list = Array.isArray(decisions) ? decisions : [];

  const stats = {
    total: list.length,
    truth_fail: 0,
    execution_fail: 0,
    no_setup: 0,
    insufficient_data: 0,
    low_score: 0,
    class_distribution: {
      A: 0,
      B: 0,
      C: 0,
      UNTRADEABLE: 0,
    },
  };

  list.forEach((d) => {
    if (!d?.truth_valid) stats.truth_fail += 1;
    if (!d?.execution_valid) stats.execution_fail += 1;
    if (d?.setup === 'WATCHLIST_ONLY') stats.no_setup += 1;
    if (d?.execution_reason === 'INSUFFICIENT_DATA') stats.insufficient_data += 1;
    if (Number(d?.trade_quality_score || 0) < 60) stats.low_score += 1;

    const tradeClass = String(d?.trade_class || 'UNTRADEABLE').toUpperCase();
    if (!Object.prototype.hasOwnProperty.call(stats.class_distribution, tradeClass)) {
      stats.class_distribution.UNTRADEABLE += 1;
      return;
    }

    stats.class_distribution[tradeClass] += 1;
  });

  return stats;
}

module.exports = {
  analyzeDecisionFailures,
};