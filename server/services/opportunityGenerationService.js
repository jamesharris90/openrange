const { queryWithTimeout } = require('../db/pg');
const {
  MARKET_QUOTES_TABLE,
  INTRADAY_TABLE,
} = require('../../lib/data/authority');

function clampLimit(limit, fallback = 50, max = 200) {
  const parsed = Number(limit);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.max(1, Math.trunc(parsed)), max);
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toPercentConfidence(value, fallback = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  if (numeric >= 0 && numeric <= 1) return numeric * 100;
  return numeric;
}

const DEFAULT_MIN_OPPORTUNITIES = clampLimit(process.env.OPPORTUNITIES_MIN_COUNT, 12, 300);

const STRICT_THRESHOLDS = Object.freeze({
  orbBreakoutBuffer: 0.001,
  vwapBreakoutBuffer: 0,
  minPriceChangeForMomentum: 1,
  minRelativeVolumeForMomentum: 1.2,
  minIntradaySlopeForMomentum: 0.15,
});

const RELAXED_THRESHOLDS = Object.freeze({
  orbBreakoutBuffer: 0,
  vwapBreakoutBuffer: -0.0005,
  minPriceChangeForMomentum: 0.45,
  minRelativeVolumeForMomentum: 0.75,
  minIntradaySlopeForMomentum: 0.03,
});

function normalizeOpportunityRow(row) {
  const baseConfidence = clamp(toPercentConfidence(row?.confidence, 0), 1, 99);
  const contextualConfidence = clamp(
    toPercentConfidence(row?.confidence_contextual ?? row?.confidence_context_percent ?? row?.confidence, 0),
    1,
    99
  );

  return {
    symbol: String(row?.symbol || '').trim().toUpperCase(),
    strategy: String(row?.strategy || '').trim(),
    probability: Math.max(1, Math.min(99, Number(row?.probability || 0))),
    confidence: contextualConfidence,
    confidence_percent: Number(baseConfidence.toFixed(2)),
    confidence_context_percent: Number(contextualConfidence.toFixed(2)),
    expected_move: Number(row?.expected_move || 0),
    timestamp: row?.timestamp || null,
  };
}

async function fetchOpportunityCandidates(limit, relax = false, excludeSymbols = []) {
  const { rows } = await queryWithTimeout(
    `WITH latest_day AS (
       SELECT MAX((i.timestamp AT TIME ZONE 'UTC')::date) AS trading_day
       FROM ${INTRADAY_TABLE} i
     ),
     intraday_base AS (
       SELECT
         i.symbol,
         i.timestamp,
         i.open,
         i.high,
         i.low,
         i.close,
         COALESCE(i.volume, 0)::numeric AS volume
       FROM ${INTRADAY_TABLE} i
       WHERE (i.timestamp AT TIME ZONE 'UTC')::date = (SELECT trading_day FROM latest_day)
         AND (i.session = 'regular' OR i.session IS NULL)
         AND i.close IS NOT NULL
     ),
     intraday_window AS (
       SELECT
         symbol,
         MIN(timestamp) AS first_ts,
         MAX(timestamp) AS last_ts
       FROM intraday_base
       GROUP BY symbol
     ),
     intraday_agg AS (
       SELECT
         b.symbol,
         MAX(b.high) FILTER (WHERE b.timestamp <= w.first_ts + INTERVAL '30 minutes') AS or_high,
         MIN(b.low) FILTER (WHERE b.timestamp <= w.first_ts + INTERVAL '30 minutes') AS or_low,
         MIN(b.open) FILTER (WHERE b.timestamp = w.first_ts) AS day_open,
         MAX(b.high) AS day_high,
         MIN(b.low) AS day_low,
         SUM(b.volume) AS intraday_volume,
         SUM(b.close * b.volume) / NULLIF(SUM(b.volume), 0) AS vwap
       FROM intraday_base b
       JOIN intraday_window w ON w.symbol = b.symbol
       GROUP BY b.symbol
     ),
     latest_bar AS (
       SELECT DISTINCT ON (b.symbol)
         b.symbol,
         b.timestamp AS bar_ts,
         b.open AS bar_open,
         b.close AS bar_close,
         b.high AS bar_high,
         b.low AS bar_low,
         b.volume AS bar_volume
       FROM intraday_base b
       ORDER BY b.symbol ASC, b.timestamp DESC
     ),
     quote_base AS (
       SELECT
         q.symbol,
         q.price,
         q.change_percent,
         COALESCE(q.volume, 0) AS quote_volume,
         q.updated_at
       FROM ${MARKET_QUOTES_TABLE} q
       WHERE q.price IS NOT NULL
         AND q.price > 0
     ),
     scored AS (
       SELECT
         q.symbol,
         q.change_percent,
         q.quote_volume,
         q.updated_at,
         a.or_high,
         a.or_low,
         a.day_open,
         a.day_high,
         a.day_low,
         a.intraday_volume,
         a.vwap,
         l.bar_ts,
         l.bar_open,
         l.bar_close,
          first_bar.bar_close AS first_close,
          GREATEST(COALESCE(a.intraday_volume, 0), 0) AS intraday_volume_resolved,
          GREATEST(COALESCE(q.quote_volume, 0), 0) AS quote_volume_resolved,
          CASE
            WHEN COALESCE(a.intraday_volume, 0) > 0
              THEN COALESCE(q.quote_volume, 0)::numeric / NULLIF(a.intraday_volume, 0)
            ELSE 0
          END AS relative_volume_proxy
       FROM quote_base q
       JOIN intraday_agg a ON a.symbol = q.symbol
       JOIN latest_bar l ON l.symbol = q.symbol
        LEFT JOIN LATERAL (
          SELECT b.close AS bar_close
          FROM intraday_base b
          WHERE b.symbol = q.symbol
          ORDER BY b.timestamp ASC
          LIMIT 1
        ) first_bar ON TRUE
        WHERE CARDINALITY($3::text[]) = 0 OR q.symbol <> ALL($3::text[])
     )
     SELECT
       symbol,
         COALESCE(change_percent, 0) AS change_percent,
         quote_volume_resolved AS quote_volume,
         intraday_volume_resolved AS intraday_volume,
         relative_volume_proxy,
         day_open,
         day_high,
         day_low,
         or_high,
         or_low,
         vwap,
         bar_open,
         bar_close,
         first_close,
         CASE
           WHEN first_close IS NOT NULL AND first_close > 0
             THEN ((bar_close - first_close) / NULLIF(first_close, 0)) * 100
           ELSE 0
         END AS intraday_slope_percent,
         CASE
           WHEN day_high > day_low
             THEN ((bar_close - day_low) / NULLIF(day_high - day_low, 0))
           ELSE 0
         END AS range_position,
         COALESCE(bar_ts, updated_at) AS timestamp,
         $2::boolean AS relaxed_run
     FROM scored
       WHERE bar_close IS NOT NULL
         AND ($2::boolean = true OR ABS(COALESCE(change_percent, 0)) >= 0.1)
       ORDER BY ABS(COALESCE(change_percent, 0)) DESC, COALESCE(quote_volume_resolved, 0) DESC
     LIMIT $1`,
      [limit, relax, excludeSymbols],
      { label: 'services.opportunities.dynamic.candidates', timeoutMs: 3500, maxRetries: 1, retryDelayMs: 120 }
  );

  return Array.isArray(rows) ? rows : [];
}

  function evaluateSymbolStrategy(row, thresholds, forceMomentum = false) {
    const symbol = String(row?.symbol || '').trim().toUpperCase();
    if (!symbol) return null;

    const changePercent = toNumber(row?.change_percent, 0);
    const relativeVolume = toNumber(row?.relative_volume_proxy, 0);
    const intradaySlope = toNumber(row?.intraday_slope_percent, 0);
    const rangePosition = toNumber(row?.range_position, 0);
    const barClose = toNumber(row?.bar_close, 0);
    const barOpen = toNumber(row?.bar_open, 0);
    const orHigh = toNumber(row?.or_high, 0);
    const vwap = toNumber(row?.vwap, 0);

    const orbTriggered = orHigh > 0
      && barClose > (orHigh * (1 + thresholds.orbBreakoutBuffer))
      && changePercent > 0;

    const vwapTriggered = vwap > 0
      && barOpen <= vwap
      && barClose >= (vwap * (1 + thresholds.vwapBreakoutBuffer));

    const momentumTriggered = Math.abs(changePercent) >= thresholds.minPriceChangeForMomentum
      && relativeVolume >= thresholds.minRelativeVolumeForMomentum
      && intradaySlope >= thresholds.minIntradaySlopeForMomentum;

    let strategy = null;
    let strategyReason = 'none';
    if (orbTriggered) {
      strategy = 'ORB';
      strategyReason = 'orb_trigger';
    } else if (vwapTriggered) {
      strategy = 'VWAP reclaim';
      strategyReason = 'vwap_trigger';
    } else if (momentumTriggered || forceMomentum) {
      strategy = 'momentum continuation';
      strategyReason = momentumTriggered ? 'momentum_trigger' : 'momentum_forced';
    }

    if (!strategy) {
      return {
        symbol,
        strategy: null,
        evaluated: ['ORB', 'VWAP reclaim', 'momentum continuation'],
        orb_triggered: orbTriggered,
        vwap_triggered: vwapTriggered,
        momentum_triggered: momentumTriggered,
        strategy_reason: strategyReason,
      };
    }

    const expectedMoveRaw = Math.max(
      0.4,
      Math.abs(changePercent) * 0.55 + Math.max(0, rangePosition) * 1.25 + Math.max(0, intradaySlope) * 0.45
    );

    const strategyBoost = strategy === 'ORB' ? 10 : strategy === 'VWAP reclaim' ? 8 : 6;
    const probability = clamp(
      50 + Math.abs(changePercent) * 4 + Math.max(0, relativeVolume - 1) * 7 + strategyBoost,
      1,
      99
    );
    const confidence = clamp(
      45 + Math.abs(changePercent) * 2.6 + Math.max(0, relativeVolume - 1) * 6 + Math.max(0, intradaySlope) * 8,
      1,
      99
    );

    return {
      symbol,
      strategy,
      probability,
      confidence,
      expected_move: Number(expectedMoveRaw.toFixed(2)),
      timestamp: row?.timestamp || null,
      evaluated: ['ORB', 'VWAP reclaim', 'momentum continuation'],
      orb_triggered: orbTriggered,
      vwap_triggered: vwapTriggered,
      momentum_triggered: momentumTriggered,
      strategy_reason: strategyReason,
      metrics: {
        change_percent: Number(changePercent.toFixed(3)),
        relative_volume: Number(relativeVolume.toFixed(3)),
        intraday_slope_percent: Number(intradaySlope.toFixed(3)),
      },
    };
  }

  function rankOpportunityRows(rows = []) {
    return rows
      .slice()
      .sort((a, b) => {
          const contextualDiff = toNumber(
            b?.confidence_contextual ?? b?.confidence_context_percent ?? b?.confidence,
            0
          ) - toNumber(
            a?.confidence_contextual ?? a?.confidence_context_percent ?? a?.confidence,
            0
          );
          if (contextualDiff !== 0) return contextualDiff;

        const probabilityDiff = toNumber(b?.probability, 0) - toNumber(a?.probability, 0);
        if (probabilityDiff !== 0) return probabilityDiff;
        const confidenceDiff = toNumber(b?.confidence, 0) - toNumber(a?.confidence, 0);
        if (confidenceDiff !== 0) return confidenceDiff;
        return toNumber(b?.expected_move, 0) - toNumber(a?.expected_move, 0);
      });
  }

  function dedupeBySymbol(rows = []) {
    const bestBySymbol = new Map();
    for (const row of rankOpportunityRows(rows)) {
      const symbol = String(row?.symbol || '').trim().toUpperCase();
      if (!symbol || bestBySymbol.has(symbol)) continue;
      bestBySymbol.set(symbol, row);
    }
    return Array.from(bestBySymbol.values());
  }

  async function buildOpportunitiesPass(targetCount, thresholds, options = {}) {
    const { relax = false, excludeSymbols = [], forceMomentum = false } = options;
    const candidateLimit = clampLimit(targetCount * 4, Math.max(40, targetCount * 2), 1000);
    const candidates = await fetchOpportunityCandidates(candidateLimit, relax, excludeSymbols);

    const evaluated = candidates
      .map((row) => evaluateSymbolStrategy(row, thresholds, forceMomentum))
      .filter(Boolean);

    const triggered = evaluated.filter((row) => row.strategy);
    return {
      triggered: dedupeBySymbol(triggered),
      evaluatedCount: evaluated.length,
      candidateCount: candidates.length,
    };
}

async function generateDynamicOpportunities(options = {}) {
  const limit = clampLimit(options.limit);
    const minCount = clampLimit(
      options.minCount != null ? options.minCount : process.env.OPPORTUNITIES_MIN_COUNT,
      DEFAULT_MIN_OPPORTUNITIES,
      300
    );
    const targetCount = Math.max(limit, minCount);

    const strictPass = await buildOpportunitiesPass(targetCount, STRICT_THRESHOLDS, {
      relax: false,
      excludeSymbols: [],
      forceMomentum: false,
    });

    if (strictPass.triggered.length >= targetCount) {
      return rankOpportunityRows(strictPass.triggered)
        .slice(0, targetCount)
        .map(normalizeOpportunityRow);
    }

    const relaxedPass = await buildOpportunitiesPass(targetCount, RELAXED_THRESHOLDS, {
      relax: true,
      excludeSymbols: strictPass.triggered.map((row) => row.symbol),
      forceMomentum: false,
    });

    const merged = dedupeBySymbol([...strictPass.triggered, ...relaxedPass.triggered]);
    if (merged.length >= targetCount) {
      return rankOpportunityRows(merged)
        .slice(0, targetCount)
        .map(normalizeOpportunityRow);
    }

    // Last-resort expansion still uses real market data, but forces momentum evaluation on qualified symbols.
    const expandedPass = await buildOpportunitiesPass(targetCount, RELAXED_THRESHOLDS, {
      relax: true,
      excludeSymbols: merged.map((row) => row.symbol),
      forceMomentum: true,
    });

    const guaranteed = dedupeBySymbol([...merged, ...expandedPass.triggered]);
    return rankOpportunityRows(guaranteed)
      .slice(0, targetCount)
      .map(normalizeOpportunityRow);
}

module.exports = {
  generateDynamicOpportunities,
};
