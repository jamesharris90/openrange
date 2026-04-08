function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function parseTimestamp(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function isFreshWithin(value, maxAgeMs) {
  const parsed = parseTimestamp(value);
  return parsed !== null && (Date.now() - parsed) < maxAgeMs;
}

function normalizeSourceToken(source) {
  const text = String(source || '').trim().toLowerCase();
  if (!text) return null;
  if (text.includes('fallback') || text.includes('stale') || text === 'empty' || text === 'none' || text === 'error') {
    return 'fallback';
  }
  if (text.includes('cache')) return 'cache';
  if (text.includes('fmp')) return 'fmp';
  if (text.includes('snapshot')) return 'snapshot';
  if (text.includes('live')) return 'live';
  if (text.includes('db')) return 'db';
  return text;
}

function computeFreshnessScore({ priceUpdatedAt, dailyUpdatedAt, stale }) {
  if (isFreshWithin(priceUpdatedAt, 60 * 60 * 1000)) {
    return 100;
  }

  if (isFreshWithin(dailyUpdatedAt, 24 * 60 * 60 * 1000)) {
    return 70;
  }

  if (stale) {
    return 30;
  }

  return 0;
}

function computeSourceQuality(sources) {
  const normalized = (Array.isArray(sources) ? sources : [])
    .map(normalizeSourceToken)
    .filter(Boolean);

  if (normalized.length === 0) {
    return 0;
  }

  if (normalized.includes('fallback')) {
    return 40;
  }

  const unique = new Set(normalized);
  if (unique.size > 1) {
    return 100;
  }

  if (unique.size === 1) {
    return 70;
  }

  return 0;
}

function applyConfidenceCaps(score, coverage) {
  let capped = score;

  if (!coverage?.has_news || !coverage?.has_earnings || !coverage?.has_technicals) {
    capped = Math.min(capped, 64);
  }

  if (!coverage?.has_news && !coverage?.has_earnings && !coverage?.has_technicals) {
    capped = Math.min(capped, 39);
  }

  return capped;
}

function labelDataConfidence(score) {
  if (score >= 85) return 'HIGH';
  if (score >= 65) return 'MEDIUM';
  if (score >= 40) return 'LOW';
  return 'POOR';
}

function buildConfidencePayload({ coverage, freshnessScore, sourceQuality }) {
  const coverageScore = toNumber(coverage?.coverage_score);
  const rawScore = (coverageScore * 0.6) + (freshnessScore * 0.25) + (sourceQuality * 0.15);
  const dataConfidence = Number(applyConfidenceCaps(Number(rawScore.toFixed(2)), coverage).toFixed(2));
  const dataConfidenceLabel = labelDataConfidence(dataConfidence);

  return {
    data_confidence: dataConfidence,
    data_confidence_label: dataConfidenceLabel,
    freshness_score: freshnessScore,
    source_quality: sourceQuality,
    coverage_score: coverageScore,
  };
}

function computeSummaryDataConfidence({ coverage, priceUpdatedAt, dailyUpdatedAt, stale, sources }) {
  const freshnessScore = computeFreshnessScore({
    priceUpdatedAt,
    dailyUpdatedAt,
    stale: Boolean(stale),
  });
  const sourceQuality = computeSourceQuality(sources);

  return buildConfidencePayload({
    coverage,
    freshnessScore,
    sourceQuality,
  });
}

function computeDataConfidence({ payload, indicators, coverage }) {
  return computeSummaryDataConfidence({
    coverage,
    priceUpdatedAt: payload?.price?.updated_at,
    dailyUpdatedAt: indicators?.updated_at,
    stale: Boolean(payload?.meta?.stale),
    sources: [
      payload?.profile?.source,
      payload?.price?.source,
      payload?.fundamentals?.source,
      payload?.earnings?.source,
    ],
  });
}

function applyDataConfidenceGuard(decision, confidencePayload) {
  const nextDecision = {
    ...(decision || {}),
    risk_flags: Array.isArray(decision?.risk_flags) ? [...decision.risk_flags] : [],
  };

  if (toNumber(confidencePayload?.data_confidence) < 50) {
    nextDecision.tradeable = false;
    nextDecision.status = 'AVOID';
    if (!nextDecision.risk_flags.includes('LOW_DATA_CONFIDENCE')) {
      nextDecision.risk_flags.push('LOW_DATA_CONFIDENCE');
    }
  }

  return nextDecision;
}

module.exports = {
  computeDataConfidence,
  computeSummaryDataConfidence,
  computeFreshnessScore,
  computeSourceQuality,
  labelDataConfidence,
  applyDataConfidenceGuard,
};