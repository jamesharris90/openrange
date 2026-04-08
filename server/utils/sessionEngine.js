function getSessionContext(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(now);

  const weekday = parts.find((p) => p.type === 'weekday')?.value || 'Sun';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value || 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value || 0);
  const minutes = (hour * 60) + minute;
  const isWeekend = weekday === 'Sat' || weekday === 'Sun';

  if (isWeekend) {
    return {
      session: 'WEEKEND',
      mode: 'PREP',
      tradeWindow: false,
      scoreWeight: 0.65,
      minRvol: Infinity,
      minQuality: Infinity,
      reasonBlock: 'SESSION_CLOSED_WEEKEND',
    };
  }

  if (minutes >= (8 * 60) && minutes < (10 * 60) + 30) {
    return {
      session: 'OPENING_DRIVE',
      mode: 'LIVE',
      tradeWindow: true,
      scoreWeight: 1.1,
      minRvol: 1.2,
      minQuality: 55,
      reasonBlock: null,
    };
  }

  if (minutes >= (10 * 60) + 30 && minutes < (13 * 60) + 30) {
    return {
      session: 'MIDDAY_DRIFT',
      mode: 'LIVE',
      tradeWindow: true,
      scoreWeight: 0.88,
      minRvol: 1.8,
      minQuality: 65,
      reasonBlock: 'LOW_SESSION_LIQUIDITY',
    };
  }

  if (minutes >= (13 * 60) + 30 && minutes < (16 * 60) + 30) {
    return {
      session: 'CLOSING_FLOW',
      mode: 'LIVE',
      tradeWindow: true,
      scoreWeight: 1.05,
      minRvol: 1.1,
      minQuality: 55,
      reasonBlock: null,
    };
  }

  if (minutes >= (6 * 60) && minutes < (8 * 60)) {
    return {
      session: 'PREMARKET',
      mode: 'PREP',
      tradeWindow: false,
      scoreWeight: 0.75,
      minRvol: Infinity,
      minQuality: Infinity,
      reasonBlock: 'SESSION_PREMARKET_PREP_ONLY',
    };
  }

  return {
    session: 'AFTER_HOURS',
    mode: 'PREP',
    tradeWindow: false,
    scoreWeight: 0.7,
    minRvol: Infinity,
    minQuality: Infinity,
    reasonBlock: 'SESSION_AFTER_HOURS_PREP_ONLY',
  };
}

function normalizeNumber(...values) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

function applySessionWeighting(score, sessionContext = getSessionContext()) {
  const raw = Number(score);
  if (!Number.isFinite(raw)) return null;
  const weight = Number.isFinite(Number(sessionContext?.scoreWeight))
    ? Number(sessionContext.scoreWeight)
    : 1;
  return Number((raw * weight).toFixed(4));
}

function applySessionGating(payload, sessionContext = getSessionContext()) {
  const decision = { ...(payload || {}) };
  const baseTradeable = Boolean(decision.tradeable);
  const rvol = normalizeNumber(decision.rvol, decision.relative_volume, 0) || 0;
  const qualityScore = normalizeNumber(decision.trade_quality_score, decision.trade_quality, 0) || 0;

  decision.session = decision.session || sessionContext.session;
  decision.mode = sessionContext.mode;
  decision.session_weight = Number(sessionContext.scoreWeight || 1);

  let tradeable = baseTradeable;
  let reasonBlock = null;

  if (!sessionContext.tradeWindow) {
    tradeable = false;
    reasonBlock = sessionContext.reasonBlock || 'SESSION_CLOSED';
  } else if (rvol < Number(sessionContext.minRvol || 0)) {
    tradeable = false;
    reasonBlock = 'LOW_SESSION_LIQUIDITY';
  } else if (qualityScore < Number(sessionContext.minQuality || 0)) {
    tradeable = false;
    reasonBlock = 'LOW_SESSION_QUALITY';
  }

  decision.tradeable = tradeable;
  decision.reason_block = tradeable ? null : reasonBlock;

  if (!tradeable) {
    decision.action = 'AVOID';
    decision.trade_class = 'UNTRADEABLE';
  }

  return decision;
}

module.exports = {
  getSessionContext,
  applySessionWeighting,
  applySessionGating,
};