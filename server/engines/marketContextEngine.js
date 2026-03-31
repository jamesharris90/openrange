const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');

const QUERY_TIMEOUT_MS = 500;
const MAX_QUERY_CONCURRENCY = 5;

function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function createLimiter(maxConcurrent) {
  let active = 0;
  const queue = [];

  const runNext = () => {
    if (active >= maxConcurrent || queue.length === 0) return;
    const task = queue.shift();
    active += 1;
    task()
      .catch(() => null)
      .finally(() => {
        active = Math.max(0, active - 1);
        runNext();
      });
  };

  return (fn) => new Promise((resolve, reject) => {
    queue.push(async () => {
      try {
        resolve(await fn());
      } catch (error) {
        reject(error);
      }
    });
    runNext();
  });
}

const limitQuery = createLimiter(MAX_QUERY_CONCURRENCY);

function ema(values, period) {
  if (!Array.isArray(values) || values.length < period) return null;
  const alpha = 2 / (period + 1);
  let current = values[0];
  for (let i = 1; i < values.length; i += 1) {
    current = (values[i] * alpha) + (current * (1 - alpha));
  }
  return current;
}

function classifyTrend(lastPrice, ema9, ema20, ema50) {
  if (![lastPrice, ema9, ema20, ema50].every((v) => Number.isFinite(v))) return 'neutral';
  if (lastPrice > ema9 && ema9 > ema20 && ema20 > ema50) return 'bullish';
  if (lastPrice < ema9 && ema9 < ema20 && ema20 < ema50) return 'bearish';
  return 'neutral';
}

function classifyBreadth(pct) {
  if (!Number.isFinite(pct)) return 'neutral';
  if (pct > 60) return 'bullish';
  if (pct < 40) return 'bearish';
  return 'neutral';
}

function classifyRegime(spyTrend, qqqTrend, breadthPercent, volatilityLevel) {
  const breadth = classifyBreadth(breadthPercent);

  if (spyTrend === 'bullish' && qqqTrend === 'bullish' && breadth === 'bullish' && volatilityLevel !== 'high') {
    return 'risk_on';
  }

  if (spyTrend === 'bearish' && qqqTrend === 'bearish' && breadth === 'bearish') {
    return 'risk_off';
  }

  return 'neutral';
}

async function safeQuery(sql, params, label) {
  try {
    return await limitQuery(() => queryWithTimeout(sql, params, {
      timeoutMs: QUERY_TIMEOUT_MS,
      maxRetries: 0,
      label,
    }));
  } catch (error) {
    logger.warn('[MARKET_CONTEXT] query failed', { label, error: error.message });
    return { rows: [] };
  }
}

async function getTableColumns(tableName) {
  const { rows } = await safeQuery(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = $1`,
    [tableName],
    `market_context.columns.${tableName}`
  );

  return new Set((rows || []).map((row) => String(row.column_name || '')));
}

async function tableExists(tableName) {
  const { rows } = await safeQuery(
    `SELECT to_regclass($1) AS regclass`,
    [`public.${tableName}`],
    `market_context.exists.${tableName}`
  );

  return Boolean(rows?.[0]?.regclass);
}

async function loadSeries(symbol) {
  const { rows } = await safeQuery(
    `SELECT timestamp, close
     FROM intraday_1m
     WHERE symbol = $1
       AND timestamp >= NOW() - INTERVAL '2 days'
     ORDER BY timestamp ASC
     LIMIT 400`,
    [symbol],
    `market_context.series.${symbol}`
  );

  return rows || [];
}

async function computeTrend(symbol, marketQuotesColumns, intradayColumns) {
  const hasIntraday = intradayColumns.has('symbol') && intradayColumns.has('timestamp') && intradayColumns.has('close');
  if (!hasIntraday) {
    logger.warn('[MARKET_CONTEXT] intraday_1m missing required columns for trend', { symbol });
    return 'neutral';
  }

  const series = await loadSeries(symbol);
  const closes = series.map((row) => toNumber(row.close)).filter((n) => Number.isFinite(n) && n > 0);

  let lastPrice = closes[closes.length - 1];
  if (!Number.isFinite(lastPrice) && marketQuotesColumns.has('symbol') && marketQuotesColumns.has('price')) {
    const quoteRes = await safeQuery(
      `SELECT price
       FROM market_quotes
       WHERE symbol = $1
       LIMIT 1`,
      [symbol],
      `market_context.quote.${symbol}`
    );
    lastPrice = toNumber(quoteRes.rows?.[0]?.price, NaN);
  }

  const ema9 = ema(closes, 9);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);

  return classifyTrend(lastPrice, ema9, ema20, ema50);
}

async function computeBreadth(intradayColumns) {
  const required = ['symbol', 'timestamp', 'open', 'close', 'volume'];
  const missing = required.filter((col) => !intradayColumns.has(col));
  if (missing.length > 0) {
    logger.warn('[MARKET_CONTEXT] breadth skipped; intraday columns missing', { missing });
    return null;
  }

  const { rows } = await safeQuery(
    `WITH latest_day AS (
       SELECT MAX(timestamp)::date AS d
       FROM intraday_1m
     ),
     per_symbol AS (
       SELECT
         i.symbol,
         (ARRAY_AGG(i.open ORDER BY i.timestamp ASC))[1] AS day_open,
         (ARRAY_AGG(i.close ORDER BY i.timestamp DESC))[1] AS last_close,
         SUM(i.close * i.volume)::numeric / NULLIF(SUM(i.volume), 0)::numeric AS vwap
       FROM intraday_1m i
       CROSS JOIN latest_day ld
       WHERE i.timestamp::date = ld.d
       GROUP BY i.symbol
     )
     SELECT
       COUNT(*)::int AS total_symbols,
       SUM(CASE WHEN last_close > day_open OR last_close > vwap THEN 1 ELSE 0 END)::int AS bullish_symbols
     FROM per_symbol`,
    [],
    'market_context.breadth'
  );

  const total = toNumber(rows?.[0]?.total_symbols, 0);
  const bullish = toNumber(rows?.[0]?.bullish_symbols, 0);
  if (total <= 0) return null;
  return Number(((bullish / total) * 100).toFixed(2));
}

async function computeVolatility(intradayColumns) {
  const required = ['symbol', 'timestamp', 'open', 'high', 'low'];
  const missing = required.filter((col) => !intradayColumns.has(col));
  if (missing.length > 0) {
    logger.warn('[MARKET_CONTEXT] volatility skipped; intraday columns missing', { missing });
    return 'normal';
  }

  const { rows } = await safeQuery(
    `SELECT open, high, low
     FROM intraday_1m
     WHERE symbol = 'SPY'
       AND timestamp >= NOW() - INTERVAL '3 days'
     ORDER BY timestamp DESC
     LIMIT 240`,
    [],
    'market_context.volatility.spy'
  );

  const bars = (rows || [])
    .map((row) => {
      const open = toNumber(row.open, NaN);
      const high = toNumber(row.high, NaN);
      const low = toNumber(row.low, NaN);
      if (![open, high, low].every((v) => Number.isFinite(v)) || open <= 0) return null;
      return ((high - low) / open) * 100;
    })
    .filter((v) => Number.isFinite(v) && v >= 0)
    .reverse();

  if (bars.length < 60) return 'normal';

  const recent = bars.slice(-30);
  const baseline = bars.slice(-150, -30);
  const recentAvg = recent.reduce((sum, v) => sum + v, 0) / recent.length;
  const baselineAvg = baseline.length > 0
    ? baseline.reduce((sum, v) => sum + v, 0) / baseline.length
    : recentAvg;

  if (!Number.isFinite(recentAvg) || !Number.isFinite(baselineAvg) || baselineAvg <= 0) return 'normal';
  return recentAvg > (baselineAvg * 1.15) ? 'high' : 'normal';
}

async function computeSectorLeaders(chartTrendColumns, marketQuotesColumns) {
  const hasTrend = chartTrendColumns.has('symbol') && chartTrendColumns.has('trend');
  const hasSector = marketQuotesColumns.has('symbol') && marketQuotesColumns.has('sector');

  if (!hasTrend || !hasSector) {
    logger.warn('[MARKET_CONTEXT] sector strength skipped; required columns missing', {
      chart_trends: hasTrend,
      market_quotes: hasSector,
    });
    return { strongest_sector: null, weakest_sector: null };
  }

  const { rows } = await safeQuery(
    `SELECT
       q.sector,
       AVG(
         CASE
           WHEN LOWER(COALESCE(ct.trend, '')) LIKE '%up%' OR LOWER(COALESCE(ct.trend, '')) LIKE '%bull%' THEN 1
           WHEN LOWER(COALESCE(ct.trend, '')) LIKE '%down%' OR LOWER(COALESCE(ct.trend, '')) LIKE '%bear%' THEN -1
           ELSE 0
         END
       ) AS trend_score,
       COUNT(*)::int AS members
     FROM chart_trends ct
     JOIN market_quotes q ON q.symbol = ct.symbol
     WHERE q.sector IS NOT NULL
       AND BTRIM(q.sector) <> ''
     GROUP BY q.sector
     HAVING COUNT(*) >= 2
     ORDER BY trend_score DESC, members DESC
     LIMIT 20`,
    [],
    'market_context.sector_strength'
  );

  if (!rows || rows.length === 0) {
    return { strongest_sector: null, weakest_sector: null };
  }

  const strongest = rows[0]?.sector || null;
  const weakest = rows[rows.length - 1]?.sector || null;

  return {
    strongest_sector: strongest,
    weakest_sector: weakest,
  };
}

async function insertSnapshot(snapshot, snapshotColumns) {
  const desiredColumns = [
    'spy_trend',
    'qqq_trend',
    'market_regime',
    'volatility_level',
    'strongest_sector',
    'weakest_sector',
    'breadth_percent',
    'created_at',
  ];

  const missing = desiredColumns.filter((column) => column !== 'created_at' && !snapshotColumns.has(column));
  if (missing.length > 0) {
    logger.warn('[MARKET_CONTEXT] snapshot columns missing; metrics will be partially persisted', { missing });
  }

  const insertColumns = desiredColumns.filter((column) => column === 'created_at' || snapshotColumns.has(column));
  const placeholders = insertColumns.map((_, idx) => `$${idx + 1}`);

  const values = insertColumns.map((column) => {
    if (column === 'created_at') return new Date().toISOString();
    return Object.prototype.hasOwnProperty.call(snapshot, column) ? snapshot[column] : null;
  });

  await safeQuery(
    `INSERT INTO market_context_snapshot (${insertColumns.join(', ')})
     VALUES (${placeholders.join(', ')})`,
    values,
    'market_context.insert_snapshot'
  );
}

async function runMarketContextEngine() {
  const startedAt = Date.now();

  try {
    const [quotesExists, intradayExists, trendsExists, snapshotExists] = await Promise.all([
      tableExists('market_quotes'),
      tableExists('intraday_1m'),
      tableExists('chart_trends'),
      tableExists('market_context_snapshot'),
    ]);

    if (!snapshotExists) {
      logger.warn('[MARKET_CONTEXT] market_context_snapshot table missing; run skipped');
      return { ok: false, skipped: true, reason: 'missing_snapshot_table' };
    }

    const [quotesColumns, intradayColumns, trendColumns, snapshotColumns] = await Promise.all([
      quotesExists ? getTableColumns('market_quotes') : Promise.resolve(new Set()),
      intradayExists ? getTableColumns('intraday_1m') : Promise.resolve(new Set()),
      trendsExists ? getTableColumns('chart_trends') : Promise.resolve(new Set()),
      getTableColumns('market_context_snapshot'),
    ]);

    const [spyTrend, qqqTrend, breadthPercent, volatilityLevel, sectorLeaders] = await Promise.all([
      computeTrend('SPY', quotesColumns, intradayColumns),
      computeTrend('QQQ', quotesColumns, intradayColumns),
      computeBreadth(intradayColumns),
      computeVolatility(intradayColumns),
      computeSectorLeaders(trendColumns, quotesColumns),
    ]);

    const snapshot = {
      spy_trend: spyTrend || 'neutral',
      qqq_trend: qqqTrend || 'neutral',
      market_regime: classifyRegime(spyTrend, qqqTrend, breadthPercent, volatilityLevel),
      volatility_level: volatilityLevel || 'normal',
      strongest_sector: sectorLeaders.strongest_sector,
      weakest_sector: sectorLeaders.weakest_sector,
      breadth_percent: breadthPercent == null ? null : toNumber(breadthPercent),
    };

    await insertSnapshot(snapshot, snapshotColumns);

    const runtimeMs = Date.now() - startedAt;
    logger.info('[MARKET_CONTEXT] snapshot complete', {
      ...snapshot,
      runtimeMs,
    });

    return {
      ok: true,
      snapshot,
      runtimeMs,
    };
  } catch (error) {
    const runtimeMs = Date.now() - startedAt;
    logger.error('[MARKET_CONTEXT] run failed', { error: error.message, runtimeMs });
    return {
      ok: false,
      runtimeMs,
      error: error.message,
    };
  }
}

// ── Per-Symbol Signal Context ─────────────────────────────────────────────────
//
// These functions compute intraday microstructure for a single symbol and are
// used by strategySignalEngine and opportunityEngine to inform stage overrides,
// entry gating, and narrative generation.
//
// Returns: { vwap_relation, volume_trend, structure, time_context }
// All values degrade to 'UNKNOWN' when candle data is absent.

function _signalVwapRelation(price, vwap, candles) {
  if (!vwap || vwap <= 0 || !price || price <= 0) return 'UNKNOWN';

  // RECLAIM: previous candle closed below VWAP, current price at/above
  if (candles.length >= 2) {
    const prevClose = Number(candles[candles.length - 2]?.close || 0);
    if (prevClose > 0 && prevClose < vwap && price >= vwap) return 'RECLAIM';
  }

  if (price >= vwap * 0.999) return 'ABOVE';
  return 'BELOW';
}

function _signalVolumeTrend(candles) {
  if (candles.length < 8) return 'UNKNOWN';

  const last5 = candles.slice(-5);
  const prev5 = candles.slice(-10, -5);
  if (prev5.length < 3) return 'UNKNOWN';

  const lastAvg = last5.reduce((s, c) => s + Number(c.volume || 0), 0) / last5.length;
  const prevAvg = prev5.reduce((s, c) => s + Number(c.volume || 0), 0) / prev5.length;
  if (prevAvg <= 0) return 'UNKNOWN';

  const ratio = lastAvg / prevAvg;
  if (ratio >= 1.15) return 'EXPANDING';
  if (ratio <= 0.85) return 'FADING';
  return 'NEUTRAL';
}

function _signalStructure(candles) {
  if (candles.length < 8) return 'UNKNOWN';

  const recent = candles.slice(-4);
  const prior  = candles.slice(-8, -4);

  const recentHigh = Math.max(...recent.map(c => Number(c.high || 0)));
  const recentLow  = Math.min(...recent.map(c => Number(c.low  || Infinity)));
  const priorHigh  = Math.max(...prior.map(c => Number(c.high || 0)));
  const priorLow   = Math.min(...prior.map(c => Number(c.low  || Infinity)));

  if (recentHigh <= 0 || priorHigh <= 0) return 'UNKNOWN';

  // Higher highs AND higher lows → trending
  if (recentHigh > priorHigh && recentLow > priorLow) return 'TRENDING_UP';

  // Lower highs by >0.5% → weakening
  if (recentHigh < priorHigh * 0.995) return 'WEAKENING';

  return 'CONSOLIDATING';
}

function computeTimeContext(now = new Date()) {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      hour:     '2-digit',
      minute:   '2-digit',
      hour12:   false,
    });
    const parts   = fmt.formatToParts(now);
    const hours   = parseInt(parts.find(p => p.type === 'hour').value,   10);
    const minutes = parseInt(parts.find(p => p.type === 'minute').value, 10);
    const total   = hours * 60 + minutes;

    if (total < 9 * 60 + 30) return 'PREMARKET';
    if (total < 10 * 60)     return 'OPEN';       // first 30 min — high volatility
    if (total < 15 * 60)     return 'MIDDAY';
    if (total < 16 * 60)     return 'POWER_HOUR';
    return 'AFTER_HOURS';
  } catch {
    return 'UNKNOWN';
  }
}

/**
 * Compute per-symbol intraday market context.
 *
 * @param {string} symbol
 * @param {{ price: number, vwap: number }} opts
 * @returns {Promise<{ vwap_relation, volume_trend, structure, time_context }>}
 */
async function computeMarketContext(symbol, { price = 0, vwap = 0 } = {}) {
  const timeCtx = computeTimeContext();

  const scalarVwapRelation =
    vwap > 0 && price > 0
      ? (price >= vwap * 0.999 ? 'ABOVE' : 'BELOW')
      : 'UNKNOWN';

  const fallback = {
    vwap_relation: scalarVwapRelation,
    volume_trend:  'UNKNOWN',
    structure:     'UNKNOWN',
    time_context:  timeCtx,
  };

  if (!symbol) return fallback;

  try {
    const { rows } = await limitQuery(() => queryWithTimeout(
      `SELECT high, low, close, volume
       FROM intraday_1m
       WHERE symbol = $1
         AND close > 0
         AND "timestamp" >= NOW() - INTERVAL '3 hours'
       ORDER BY "timestamp" ASC
       LIMIT 20`,
      [symbol],
      { timeoutMs: 4000, label: `marketCtx.${symbol}`, maxRetries: 0 }
    ));

    if (!rows || rows.length < 4) return fallback;

    return {
      vwap_relation: _signalVwapRelation(price, vwap, rows),
      volume_trend:  _signalVolumeTrend(rows),
      structure:     _signalStructure(rows),
      time_context:  timeCtx,
    };
  } catch {
    return fallback;
  }
}

module.exports = {
  runMarketContextEngine,
  computeMarketContext,
  computeTimeContext,
};
