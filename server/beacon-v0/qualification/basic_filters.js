const DEFAULT_ALLOWED_EXCHANGES = new Set(['NYSE', 'NASDAQ', 'AMEX']);

function qualifyCandidate(candidate, options = {}) {
  const reasons = [];
  const primarySignal = candidate.signals?.[0];
  const evidence = primarySignal?.evidence || {};
  const minAlignmentCount = Number(options.minAlignmentCount ?? 2);
  const minPrice = Number(options.minPrice ?? 2);
  const maxPrice = Number(options.maxPrice ?? 50);
  const minMarketCap = Number(options.minMarketCap ?? 50_000_000);
  const allowedExchanges = options.allowedExchanges || DEFAULT_ALLOWED_EXCHANGES;
  const isSimpleCountAlignment = candidate.alignment?.mode === 'simple_count';

  if (!candidate.symbol) reasons.push('missing_symbol');
  if (isSimpleCountAlignment) {
    if (Number(candidate.alignment.alignmentCount || 0) < minAlignmentCount) {
      reasons.push('alignment_count_below_threshold');
    }
  } else if (!evidence.earningsDate) {
    reasons.push('missing_earnings_date');
  }
  if (!isSimpleCountAlignment && evidence.exchange && !allowedExchanges.has(String(evidence.exchange).toUpperCase())) {
    reasons.push('unsupported_exchange');
  }
  if (!isSimpleCountAlignment && evidence.price !== null && (evidence.price < minPrice || evidence.price > maxPrice)) {
    reasons.push('outside_price_range');
  }
  if (!isSimpleCountAlignment && evidence.marketCap !== null && evidence.marketCap < minMarketCap) {
    reasons.push('below_market_cap_floor');
  }

  const qualified = reasons.length === 0;

  return {
    ...candidate,
    qualified,
    disqualifiedReasons: reasons,
    confidenceQualification: qualified ? candidate.confidenceQualification || 'basic_data_quality_passed' : 'disqualified',
  };
}

function qualifyBeaconCandidates(candidates, options = {}) {
  return (candidates || []).map((candidate) => qualifyCandidate(candidate, options));
}

module.exports = {
  DEFAULT_ALLOWED_EXCHANGES,
  qualifyBeaconCandidates,
  qualifyCandidate,
};