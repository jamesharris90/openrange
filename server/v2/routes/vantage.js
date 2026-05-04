const express = require('express');

const { queryWithTimeout } = require('../../db/pg');
const { generateJSON, MODEL } = require('../../services/anthropicClient');
const { getMarketOverview } = require('../../services/marketOverviewService');

const router = express.Router();

const CACHE_TTL_MS = 15 * 60 * 1000;

let contextCache = {
  expiresAt: 0,
  cachedAt: null,
  payload: null,
};

let refreshPromise = null;

function toFiniteNumber(value) {
  if (value == null || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatSignedPercent(value) {
  if (!Number.isFinite(value)) {
    return 'n/a';
  }
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function latestTimestamp(...values) {
  let latest = null;

  for (const value of values.flat()) {
    if (!value) {
      continue;
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      continue;
    }
    if (!latest || parsed.getTime() > latest.getTime()) {
      latest = parsed;
    }
  }

  return latest ? latest.toISOString() : null;
}

function classifyBreadth(pct) {
  if (!Number.isFinite(pct)) {
    return 'neutral';
  }
  if (pct > 60) {
    return 'bullish';
  }
  if (pct < 40) {
    return 'bearish';
  }
  return 'neutral';
}

function deriveMarketRegime({ snapshot, breadthPercent, volatilityLevel, indices }) {
  const spyChange = toFiniteNumber(indices?.SPY?.change_percent);
  const qqqChange = toFiniteNumber(indices?.QQQ?.change_percent);
  const breadth = classifyBreadth(breadthPercent);

  if (spyChange != null && qqqChange != null) {
    if (spyChange >= 0 && qqqChange >= 0 && breadth === 'bullish' && volatilityLevel !== 'high') {
      return 'risk_on';
    }

    if (spyChange < 0 && qqqChange < 0 && breadth === 'bearish') {
      return 'risk_off';
    }
  }

  return snapshot?.market_regime || 'neutral';
}

function deriveOpeningBias({ snapshot, strongestSector, weakestSector, indices }) {
  const regime = String(snapshot?.market_regime || 'neutral');
  const volatility = String(snapshot?.volatility_level || 'normal');
  const breadth = toFiniteNumber(snapshot?.breadth_percent);
  const spyChange = toFiniteNumber(indices?.SPY?.change_percent);
  const qqqChange = toFiniteNumber(indices?.QQQ?.change_percent);

  if ((regime === 'risk_on' || (breadth != null && breadth >= 55)) && volatility !== 'high') {
    return 'risk-on';
  }
  if (regime === 'risk_off' || (breadth != null && breadth <= 45) || (spyChange != null && spyChange < 0 && qqqChange != null && qqqChange < 0)) {
    return 'risk-off';
  }
  if (strongestSector && !weakestSector) {
    return `${strongestSector.toLowerCase()}-led`;
  }
  return 'mixed';
}

async function loadLatestSnapshot() {
  const result = await queryWithTimeout(
    `SELECT
       spy_trend,
       qqq_trend,
       market_regime,
       volatility_level,
       strongest_sector,
       weakest_sector,
       breadth_percent,
       created_at
     FROM market_context_snapshot
     ORDER BY created_at DESC
     LIMIT 1`,
    [],
    {
      label: 'vantage.context.snapshot',
      timeoutMs: 5000,
      poolType: 'read',
      maxRetries: 1,
    }
  );

  return result.rows[0] || null;
}

async function loadIndices() {
  const result = await queryWithTimeout(
    `SELECT
       q.symbol,
       q.price,
       q.change_percent,
       COALESCE(
         q.relative_volume,
         m.relative_volume,
         CASE
           WHEN m.avg_volume_30d IS NOT NULL AND m.avg_volume_30d > 0 AND q.volume IS NOT NULL
             THEN ROUND((q.volume / m.avg_volume_30d)::numeric, 2)
           WHEN m.avg_volume_30d IS NOT NULL AND m.avg_volume_30d > 0 AND m.volume IS NOT NULL
             THEN ROUND((m.volume / m.avg_volume_30d)::numeric, 2)
           ELSE NULL
         END
       ) AS relative_volume,
       q.updated_at AS quote_updated_at,
       m.updated_at AS metrics_updated_at
     FROM market_quotes q
     LEFT JOIN LATERAL (
       SELECT relative_volume, volume, avg_volume_30d, updated_at
       FROM market_metrics
       WHERE symbol = q.symbol
       ORDER BY updated_at DESC NULLS LAST
       LIMIT 1
     ) m ON TRUE
     WHERE q.symbol = ANY($1::text[])
     ORDER BY q.symbol ASC`,
    [['SPY', 'QQQ', 'IWM', 'DIA']],
    {
      label: 'vantage.context.indices',
      timeoutMs: 5000,
      poolType: 'read',
      maxRetries: 1,
    }
  );

  return (result.rows || []).reduce((accumulator, row) => {
    accumulator[row.symbol] = {
      price: toFiniteNumber(row.price),
      change_percent: toFiniteNumber(row.change_percent),
      relative_volume: toFiniteNumber(row.relative_volume),
      updated_at: latestTimestamp(row.quote_updated_at, row.metrics_updated_at),
    };
    return accumulator;
  }, {});
}

async function loadLiveBreadth() {
  try {
    const result = await queryWithTimeout(
      `SELECT
         COUNT(*)::int AS total_symbols,
         SUM(CASE WHEN change_percent > 0 THEN 1 ELSE 0 END)::int AS bullish_symbols,
         MAX(updated_at) AS updated_at
       FROM market_metrics
       WHERE change_percent IS NOT NULL`,
      [],
      {
        label: 'vantage.context.breadth',
        timeoutMs: 5000,
        poolType: 'read',
        maxRetries: 1,
      }
    );

    const totalSymbols = toFiniteNumber(result.rows?.[0]?.total_symbols);
    const bullishSymbols = toFiniteNumber(result.rows?.[0]?.bullish_symbols);

    if (!Number.isFinite(totalSymbols) || totalSymbols <= 0 || !Number.isFinite(bullishSymbols)) {
      return {
        breadth_percent: null,
        updated_at: result.rows?.[0]?.updated_at || null,
      };
    }

    return {
      breadth_percent: Number(((bullishSymbols / totalSymbols) * 100).toFixed(2)),
      updated_at: result.rows?.[0]?.updated_at || null,
    };
  } catch (_error) {
    return {
      breadth_percent: null,
      updated_at: null,
    };
  }
}

async function loadLiveVolatility() {
  try {
    const result = await queryWithTimeout(
      `SELECT timestamp, open, high, low
       FROM intraday_1m
       WHERE symbol = 'SPY'
         AND timestamp >= NOW() - INTERVAL '3 days'
       ORDER BY timestamp DESC
       LIMIT 240`,
      [],
      {
        label: 'vantage.context.volatility',
        timeoutMs: 5000,
        poolType: 'read',
        maxRetries: 1,
      }
    );

    const bars = (result.rows || [])
      .map((row) => {
        const open = toFiniteNumber(row.open);
        const high = toFiniteNumber(row.high);
        const low = toFiniteNumber(row.low);

        if (![open, high, low].every((value) => Number.isFinite(value)) || open <= 0) {
          return null;
        }

        return ((high - low) / open) * 100;
      })
      .filter((value) => Number.isFinite(value) && value >= 0)
      .reverse();

    if (bars.length < 60) {
      return {
        volatility_level: null,
        updated_at: result.rows?.[0]?.timestamp || null,
      };
    }

    const recent = bars.slice(-30);
    const baseline = bars.slice(-150, -30);
    const recentAvg = recent.reduce((sum, value) => sum + value, 0) / recent.length;
    const baselineAvg = baseline.length > 0
      ? baseline.reduce((sum, value) => sum + value, 0) / baseline.length
      : recentAvg;

    if (!Number.isFinite(recentAvg) || !Number.isFinite(baselineAvg) || baselineAvg <= 0) {
      return {
        volatility_level: null,
        updated_at: result.rows?.[0]?.timestamp || null,
      };
    }

    return {
      volatility_level: recentAvg > (baselineAvg * 1.15) ? 'high' : 'normal',
      updated_at: result.rows?.[0]?.timestamp || null,
    };
  } catch (_error) {
    return {
      volatility_level: null,
      updated_at: null,
    };
  }
}

async function loadSectorLeadership() {
  const result = await queryWithTimeout(
    `WITH sector_perf AS (
       SELECT
         q.sector,
         AVG(m.change_percent) AS avg_change,
         AVG(m.relative_volume) AS avg_rvol,
         COUNT(*)::int AS members
       FROM market_metrics m
       JOIN market_quotes q ON q.symbol = m.symbol
       WHERE q.sector IS NOT NULL
         AND BTRIM(q.sector) <> ''
         AND m.change_percent IS NOT NULL
       GROUP BY q.sector
       HAVING COUNT(*) >= 3
     )
     SELECT *
     FROM sector_perf
     ORDER BY avg_change DESC`,
    [],
    {
      label: 'vantage.context.sectors',
      timeoutMs: 5000,
      poolType: 'read',
      maxRetries: 1,
    }
  );

  const sectors = result.rows || [];
  return {
    strongest: sectors[0] || null,
    weakest: sectors[sectors.length - 1] || null,
  };
}

function buildFallbackNarrative({ bias, snapshot, strongestSector, weakestSector, overview, indices }) {
  const spyChange = formatSignedPercent(toFiniteNumber(indices?.SPY?.change_percent));
  const qqqChange = formatSignedPercent(toFiniteNumber(indices?.QQQ?.change_percent));
  const breadth = toFiniteNumber(snapshot?.breadth_percent);
  const breadthText = breadth == null ? 'breadth unavailable' : `${breadth.toFixed(1)}% breadth`;
  const earningsCount = Array.isArray(overview?.today?.earnings) ? overview.today.earnings.length : 0;
  const macroCount = Array.isArray(overview?.today?.macro) ? overview.today.macro.length : 0;

  return `${bias.toUpperCase()} bias with SPY ${spyChange} and QQQ ${qqqChange}; ${breadthText}, ${strongestSector || 'no clear leading'} leadership versus ${weakestSector || 'no clear lagging'} weakness, ${earningsCount} earnings names and ${macroCount} macro headlines on deck.`;
}

async function generateNarrative(context) {
  const systemPrompt = [
    'You write one concise premarket market-context sentence for active traders.',
    'Return strict JSON with keys: narrative, risk_flag.',
    'Keep narrative under 35 words, plain English, no hype, no bullet points.',
  ].join(' ');

  const { result, usage, error } = await generateJSON(systemPrompt, JSON.stringify(context));

  return {
    narrative: typeof result?.narrative === 'string' ? result.narrative.trim() : null,
    risk_flag: typeof result?.risk_flag === 'string' ? result.risk_flag.trim() : null,
    usage,
    error,
  };
}

async function buildContextPayload() {
  const [overview, snapshot, indices, sectorLeadership, liveBreadth, liveVolatility] = await Promise.all([
    getMarketOverview(),
    loadLatestSnapshot(),
    loadIndices(),
    loadSectorLeadership(),
    loadLiveBreadth(),
    loadLiveVolatility(),
  ]);

  const breadthPercent = liveBreadth.breadth_percent ?? toFiniteNumber(snapshot?.breadth_percent);
  const volatilityLevel = liveVolatility.volatility_level || snapshot?.volatility_level || 'normal';
  const marketRegime = deriveMarketRegime({
    snapshot,
    breadthPercent,
    volatilityLevel,
    indices,
  });
  const strongestSector = snapshot?.strongest_sector || sectorLeadership.strongest?.sector || overview?.themes?.[0]?.sector || null;
  const weakestSector = snapshot?.weakest_sector || sectorLeadership.weakest?.sector || null;
  const marketState = {
    market_regime: marketRegime,
    volatility_level: volatilityLevel,
    breadth_percent: breadthPercent,
  };
  const bias = deriveOpeningBias({ snapshot: marketState, strongestSector, weakestSector, indices });
  const sourceSnapshotAt = latestTimestamp(
    liveBreadth.updated_at,
    liveVolatility.updated_at,
    Object.values(indices || {}).map((index) => index?.updated_at)
  );

  const narrativeContext = {
    opening_bias: bias,
    market_regime: marketRegime,
    volatility_level: volatilityLevel,
    breadth_percent: breadthPercent,
    strongest_sector: strongestSector,
    weakest_sector: weakestSector,
    indices,
    earnings_today: Array.isArray(overview?.today?.earnings) ? overview.today.earnings.length : 0,
    earnings_week: Array.isArray(overview?.earnings_week) ? overview.earnings_week.slice(0, 5) : [],
    macro_today: Array.isArray(overview?.today?.macro) ? overview.today.macro.slice(0, 3) : [],
    macro_week: Array.isArray(overview?.macro_week?.headlines) ? overview.macro_week.headlines.slice(0, 3) : [],
  };

  const generated = await generateNarrative(narrativeContext);
  const fallbackNarrative = buildFallbackNarrative({
    bias,
    snapshot: marketState,
    strongestSector,
    weakestSector,
    overview,
    indices,
  });

  return {
    opening_bias: bias,
    market_regime: marketRegime,
    volatility_level: volatilityLevel,
    breadth_percent: breadthPercent,
    strongest_sector: strongestSector,
    weakest_sector: weakestSector,
    earnings_today_count: Array.isArray(overview?.today?.earnings) ? overview.today.earnings.length : 0,
    macro_today_count: Array.isArray(overview?.today?.macro) ? overview.today.macro.length : 0,
    indices,
    earnings: {
      today: Array.isArray(overview?.today?.earnings) ? overview.today.earnings.slice(0, 6) : [],
      week: Array.isArray(overview?.earnings_week) ? overview.earnings_week.slice(0, 6) : [],
    },
    macro: {
      today: Array.isArray(overview?.today?.macro) ? overview.today.macro.slice(0, 4) : [],
      week: Array.isArray(overview?.macro_week?.headlines) ? overview.macro_week.headlines.slice(0, 4) : [],
    },
    sector_leadership: {
      strongest: sectorLeadership.strongest,
      weakest: sectorLeadership.weakest,
    },
    narrative: generated.narrative || fallbackNarrative,
    risk_flag: generated.risk_flag || null,
    generated_by: generated.narrative ? MODEL : 'fallback',
    generated_at: new Date().toISOString(),
    source_snapshot_at: sourceSnapshotAt,
    narrative_error: generated.error || null,
    narrative_usage: generated.usage || null,
  };
}

router.get('/context', async (_req, res) => {
  const now = Date.now();
  if (contextCache.payload && contextCache.expiresAt > now) {
    return res.json({
      data: contextCache.payload,
      meta: {
        cache_hit: true,
        cached_at: contextCache.cachedAt,
        expires_at: new Date(contextCache.expiresAt).toISOString(),
      },
    });
  }

  if (!refreshPromise) {
    refreshPromise = buildContextPayload()
      .then((payload) => {
        contextCache = {
          payload,
          cachedAt: new Date().toISOString(),
          expiresAt: Date.now() + CACHE_TTL_MS,
        };
        return payload;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }

  try {
    const payload = await refreshPromise;
    return res.json({
      data: payload,
      meta: {
        cache_hit: false,
        cached_at: contextCache.cachedAt,
        expires_at: new Date(contextCache.expiresAt).toISOString(),
      },
    });
  } catch (error) {
    return res.status(500).json({
      error: 'vantage_context_failed',
      detail: error.message,
    });
  }
});

module.exports = router;
