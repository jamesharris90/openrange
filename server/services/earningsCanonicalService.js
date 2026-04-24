function toNullableNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstNumber(...values) {
  for (const value of values) {
    const parsed = toNullableNumber(value);
    if (parsed !== null) {
      return parsed;
    }
  }

  return null;
}

function normalizeReportTime(value) {
  const text = String(value || '').trim().toUpperCase();
  return text || 'TBD';
}

function parseReportDate(value) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.getTime();
  }

  const text = String(value || '').trim();
  if (!text) {
    return null;
  }

  const directParsed = Date.parse(text);
  if (Number.isFinite(directParsed)) {
    return directParsed;
  }

  const dateOnlyText = text.slice(0, 10);
  const dateOnlyParsed = Date.parse(`${dateOnlyText}T00:00:00Z`);
  return Number.isFinite(dateOnlyParsed) ? dateOnlyParsed : null;
}

function getTodayStartMs(now = Date.now()) {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function calculateSurprisePercent(actualValue, estimateValue) {
  const actual = toNullableNumber(actualValue);
  const estimate = toNullableNumber(estimateValue);

  if (actual === null || estimate === null || estimate === 0) {
    return null;
  }

  return Number((((actual - estimate) / Math.abs(estimate)) * 100).toFixed(4));
}

function deriveEarningsOutcome(row) {
  const epsActual = toNullableNumber(row?.eps_actual);
  const epsEstimate = toNullableNumber(row?.eps_estimate);

  if (epsActual === null || epsEstimate === null) {
    return 'PENDING';
  }
  if (epsActual > epsEstimate) {
    return 'BEAT';
  }
  if (epsActual < epsEstimate) {
    return 'MISS';
  }
  return 'INLINE';
}

function deriveEarningsEventState(row, now = Date.now()) {
  const reportDateMs = parseReportDate(row?.report_date || row?.earnings_date);
  const todayStartMs = getTodayStartMs(now);
  const reportTime = normalizeReportTime(row?.report_time || row?.time);
  const hasKnownTime = reportTime !== 'TBD' && reportTime !== 'UNKNOWN';
  const epsEstimate = toNullableNumber(row?.eps_estimate);
  const epsActual = toNullableNumber(row?.eps_actual);
  const revenueEstimate = toNullableNumber(row?.revenue_estimate ?? row?.rev_estimate);
  const revenueActual = toNullableNumber(row?.revenue_actual ?? row?.rev_actual);
  const hasAnyEstimate = epsEstimate !== null || revenueEstimate !== null;
  const hasAnyActual = epsActual !== null || revenueActual !== null;
  const hasComparableEps = epsEstimate !== null && epsActual !== null;
  const hasComparableRevenue = revenueEstimate !== null && revenueActual !== null;

  if (reportDateMs === null) {
    return 'LIMITED_DATA';
  }

  if (reportDateMs > todayStartMs) {
    return hasAnyEstimate || hasKnownTime ? 'UPCOMING' : 'LIMITED_DATA';
  }

  if (hasComparableEps) {
    return hasComparableRevenue || (!hasAnyEstimate || revenueEstimate === null) ? 'REPORTED' : 'PARTIAL_RESULT';
  }

  if (hasAnyActual) {
    return 'PARTIAL_RESULT';
  }

  if (hasAnyEstimate || hasKnownTime) {
    return 'AWAITING_ACTUALS';
  }

  return 'LIMITED_DATA';
}

function attachCanonicalEarningsFields(row) {
  const normalizedRow = row || {};
  const eventState = deriveEarningsEventState(normalizedRow);
  const treatAsPending = eventState === 'UPCOMING' || eventState === 'AWAITING_ACTUALS';
  const epsSurprisePercent = firstNumber(
    normalizedRow.eps_surprise_pct,
    normalizedRow.surprise_percent,
    normalizedRow.surprise,
    calculateSurprisePercent(normalizedRow.eps_actual, normalizedRow.eps_estimate)
  );
  const revenueSurprisePercent = firstNumber(
    normalizedRow.revenue_surprise_pct,
    calculateSurprisePercent(
      normalizedRow.revenue_actual ?? normalizedRow.rev_actual,
      normalizedRow.revenue_estimate ?? normalizedRow.rev_estimate
    )
  );

  return {
    ...normalizedRow,
    eps_surprise_pct: treatAsPending ? null : epsSurprisePercent,
    revenue_surprise_pct: treatAsPending ? null : revenueSurprisePercent,
    earnings_outcome: treatAsPending ? 'PENDING' : deriveEarningsOutcome(normalizedRow),
    event_state: eventState,
    has_actuals: treatAsPending
      ? false
      : (toNullableNumber(normalizedRow.eps_actual) !== null || toNullableNumber(normalizedRow.revenue_actual ?? normalizedRow.rev_actual) !== null),
    has_estimates: toNullableNumber(normalizedRow.eps_estimate) !== null || toNullableNumber(normalizedRow.revenue_estimate ?? normalizedRow.rev_estimate) !== null,
  };
}

function normalizeResearchEarningsPayload(earnings) {
  const normalizedHistory = Array.isArray(earnings?.history)
    ? earnings.history.map((row) => attachCanonicalEarningsFields(row)).filter(Boolean)
    : [];

  return {
    latest: earnings?.latest ? attachCanonicalEarningsFields(earnings.latest) : null,
    next: earnings?.next ? attachCanonicalEarningsFields(earnings.next) : null,
    history: normalizedHistory,
  };
}

module.exports = {
  attachCanonicalEarningsFields,
  calculateSurprisePercent,
  deriveEarningsEventState,
  deriveEarningsOutcome,
  normalizeResearchEarningsPayload,
};