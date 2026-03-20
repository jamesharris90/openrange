const fs = require('fs');
const path = require('path');
const { queryWithTimeout } = require('../db/pg');
const { recordOutcome } = require('../services/tradeOutcomeService');

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getUkMinutesSinceMidnight(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const hourPart = parts.find((part) => part.type === 'hour');
  const minutePart = parts.find((part) => part.type === 'minute');
  const hour = Number(hourPart?.value ?? 0);
  const minute = Number(minutePart?.value ?? 0);
  return (hour * 60) + minute;
}

function getMarketSession(date = new Date()) {
  const ukMinutes = getUkMinutesSinceMidnight(date);

  if (ukMinutes < 12 * 60) return 'premarket_early';
  if (ukMinutes < (14 * 60) + 30) return 'premarket_active';
  if (ukMinutes < 16 * 60) return 'market_open';
  if (ukMinutes < 19 * 60) return 'mid_day';
  if (ukMinutes < 21 * 60) return 'power_hour';
  return 'after_hours';
}

function getSessionMultiplier(session) {
  switch (session) {
    case 'premarket_early': return 0.85;
    case 'premarket_active': return 0.95;
    case 'market_open': return 1.1;
    case 'mid_day': return 1.0;
    case 'power_hour': return 1.05;
    case 'after_hours': return 0.9;
    default: return 1.0;
  }
}

function getVolumeMultiplier(rvol, session) {
  if (session === 'mid_day') {
    if (rvol >= 1.5) return 1.15;
    if (rvol >= 1.2) return 1.1;
    if (rvol >= 1.0) return 1.05;
    if (rvol < 0.6) return 0.9;
    if (rvol < 0.8) return 0.95;
    return 1.0;
  }

  if (rvol >= 2.0) return 1.15;
  if (rvol >= 1.5) return 1.1;
  if (rvol >= 1.2) return 1.05;
  if (rvol < 1.0) return 0.9;
  return 1.0;
}

function getRvolAdjusted(rvol, session) {
  if (session !== 'mid_day') return rvol;

  if (rvol >= 1.5) return 1.5;
  if (rvol >= 1.2) return 1.2;
  if (rvol >= 1.0) return 1.0;
  if (rvol < 0.6) return 0.6;
  if (rvol < 0.8) return 0.8;
  return rvol;
}

function toNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function parseConfidenceThreshold(rawValue) {
  const numeric = Number(rawValue);
  if (!Number.isFinite(numeric)) return null;
  const normalized = numeric > 1 ? numeric / 100 : numeric;
  return clamp(normalized, 0, 1);
}

function computeRvol(row) {
  const currentVolume = toNumber(
    row?.current_volume
      ?? row?.currentVolume
      ?? row?.volume
      ?? row?.intraday_volume
      ?? row?.quote_volume,
    NaN
  );

  const avgVolumeSameTime = toNumber(
    row?.avg_volume_same_time_last_5_days
      ?? row?.average_volume_same_time_last_5_days
      ?? row?.avg_volume_same_time_5d
      ?? row?.avg_volume_same_time
      ?? row?.avg_volume_5d_same_time
      ?? row?.avg_volume_5d,
    NaN
  );

  if (Number.isFinite(currentVolume) && Number.isFinite(avgVolumeSameTime) && avgVolumeSameTime > 0) {
    return Number((currentVolume / avgVolumeSameTime).toFixed(4));
  }

  return toNumber(row?.rvol, 0);
}

function logContextImpact(entry) {
  try {
    const logPath = path.join(__dirname, '../../logs/context-impact.json');
    fs.mkdirSync(path.dirname(logPath), { recursive: true });

    let existing = [];
    if (fs.existsSync(logPath)) {
      const parsed = JSON.parse(fs.readFileSync(logPath, 'utf8'));
      if (Array.isArray(parsed)) {
        existing = parsed;
      }
    }

    existing.push(entry);
    fs.writeFileSync(logPath, JSON.stringify(existing, null, 2), 'utf8');
  } catch (err) {
    console.error('[CONTEXT LOG ERROR]', err.message);
  }
}

async function getOpportunities(req, res) {
  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 500, 1000));
    const symbol = String(req.query.symbol || '').trim().toUpperCase();
    const minContextualConfidence = parseConfidenceThreshold(
      req.query.min_confidence_contextual ?? req.query.min_confidence
    );

    const params = [];
    const where = ['signal_ids IS NOT NULL', 'array_length(signal_ids, 1) > 0'];

    if (symbol) {
      params.push(symbol);
      where.push(`symbol = $${params.length}`);
    }

    const fetchLimit = Math.max(limit, Math.min(limit * 3, 2000));
    params.push(fetchLimit);

    const { rows } = await queryWithTimeout(
      `SELECT *
       FROM opportunities
       WHERE ${where.join(' AND ')}
       ORDER BY updated_at DESC NULLS LAST, created_at DESC
       LIMIT $${params.length}`,
      params,
      { label: 'controller.opportunities', timeoutMs: 2400, maxRetries: 1, retryDelayMs: 120 }
    );

    const data = Array.isArray(rows) ? rows : [];

    const processed = data.map((row) => {
      const base = clamp(toNumber(row.confidence, 0), 0, 1);
      const rvol = computeRvol(row);

      const session = getMarketSession();
      const sessionMultiplier = getSessionMultiplier(session);
      const volumeMultiplier = getVolumeMultiplier(rvol, session);
      const sessionAdjustments = [];
      const rvolAdjusted = getRvolAdjusted(rvol, session);

      const contextualRaw = base * sessionMultiplier * volumeMultiplier;
      let contextual = Number.isFinite(contextualRaw) ? contextualRaw : base;

      if (session === 'premarket_active' && rvol >= 1.2) {
        contextual += 0.05;
        sessionAdjustments.push('premarket_active_rvol_boost');
      }

      if (session === 'market_open' && rvol >= 1.5) {
        contextual += 0.1;
        sessionAdjustments.push('market_open_rvol_boost');
      }

      contextual = clamp(contextual, 0, 0.99);

      const enriched = {
        ...row,
        market_session: session,
        session_multiplier: sessionMultiplier,
        rvol,
        volume_multiplier: volumeMultiplier,
        confidence_contextual: contextual,
        confidence_percent: Number((base * 100).toFixed(2)),
        confidence_context_percent: Number((contextual * 100).toFixed(2)),
      };

      logContextImpact({
        symbol: enriched.symbol,
        base_confidence: base,
        contextual_confidence: contextual,
        base_confidence_percent: enriched.confidence_percent,
        contextual_confidence_percent: enriched.confidence_context_percent,
        market_session: session,
        session_multiplier: sessionMultiplier,
        rvol,
        rvol_adjusted: rvolAdjusted,
        volume_multiplier: volumeMultiplier,
        session_adjustment_applied: sessionAdjustments,
        timestamp: new Date().toISOString(),
      });

      try {
        recordOutcome(enriched);
      } catch (error) {
        console.error('[OUTCOME LOG ERROR]', error.message);
      }

      return enriched;
    });

    const ranked = processed
      .filter((row) => {
        if (minContextualConfidence == null) return true;
        return toNumber(row?.confidence_contextual, 0) >= minContextualConfidence;
      })
      .sort((a, b) => {
        const contextualDiff = toNumber(b?.confidence_contextual, 0) - toNumber(a?.confidence_contextual, 0);
        if (contextualDiff !== 0) return contextualDiff;

        const probabilityDiff = toNumber(b?.probability, 0) - toNumber(a?.probability, 0);
        if (probabilityDiff !== 0) return probabilityDiff;

        return toNumber(b?.expected_move, 0) - toNumber(a?.expected_move, 0);
      })
      .slice(0, limit);

    return res.json({ success: true, data: ranked });
  } catch (err) {
    console.error('[OPPORTUNITIES ERROR]', err.message);
    return res.status(500).json({ success: false, error: 'opportunities_failed' });
  }
}

module.exports = { getOpportunities };
