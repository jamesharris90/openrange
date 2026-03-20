const express = require('express');
const { queryWithTimeout } = require('../db/pg');
const {
  MARKET_QUOTES_TABLE,
  INTRADAY_TABLE,
  OPPORTUNITIES_TABLE,
  SIGNALS_TABLE,
} = require('../lib/data/authority');

const router = express.Router();

function success(data = [], meta = {}) {
  return {
    success: true,
    data: Array.isArray(data) ? data : [],
    meta,
  };
}

function failure(message = 'Unknown error') {
  return {
    success: false,
    data: [],
    error: message,
  };
}

function normalizeExpectedMove(row) {
  const normalized = { ...(row || {}) };
  const fields = ['expectedMove', 'expected_move', 'expected_move_percent'];
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(normalized, field)) {
      const value = normalized[field];
      if (value === 0 || value === '0' || value === '0.00' || value == null) {
        normalized[field] = null;
      }
    }
  }
  return normalized;
}

function toTickerNumber(value, options = {}) {
  const { allowZero = false, hasDataPoint = false } = options;
  if (value === null || value === undefined || value === '') return null;

  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n === 0 && !allowZero) return null;
  if (n === 0 && allowZero && !hasDataPoint) return null;
  return n;
}

async function latestCatalystsBySymbol(symbols = []) {
  if (!symbols.length) return new Map();

  try {
    const { rows } = await queryWithTimeout(
      `SELECT DISTINCT ON (symbol)
         symbol,
         COALESCE(catalyst_type, catalyst, headline) AS catalyst,
         COALESCE(timestamp, published_at, created_at) AS catalyst_ts
       FROM trade_catalysts
       WHERE symbol = ANY($1::text[])
       ORDER BY symbol ASC, COALESCE(timestamp, published_at, created_at) DESC NULLS LAST`,
      [symbols],
      { label: 'stability.tickerTape.catalyst_fallback', timeoutMs: 2500, maxRetries: 0 }
    );

    const map = new Map();
    for (const row of rows || []) {
      const symbol = String(row?.symbol || '').toUpperCase();
      if (!symbol) continue;
      map.set(symbol, {
        catalyst: String(row?.catalyst || '').trim(),
        catalystTs: row?.catalyst_ts || null,
      });
    }
    return map;
  } catch (_error) {
    return new Map();
  }
}

async function safeRows(sql, params, label) {
  try {
    const { rows } = await queryWithTimeout(sql, params, {
      label,
      timeoutMs: 4000,
      maxRetries: 0,
    });
    return Array.isArray(rows) ? rows : [];
  } catch (_error) {
    return [];
  }
}

router.get('/api/radar', async (_req, res) => {
  try {
    const signals = await safeRows(
      `SELECT symbol, strategy, score, expected_move, catalyst_headline AS catalyst, created_at
        FROM ${SIGNALS_TABLE}
       ORDER BY created_at DESC NULLS LAST
       LIMIT 50`,
      [],
      'stability.radar.signals'
    );

    const opportunities = await safeRows(
      `SELECT symbol,
          COALESCE(NULLIF(setup_type, ''), 'Momentum Continuation') AS strategy,
          score AS confidence,
          NULL::numeric AS expected_move,
          NULL::text AS catalyst,
          COALESCE(detected_at, updated_at) AS created_at
       FROM ${OPPORTUNITIES_TABLE}
       ORDER BY COALESCE(detected_at, updated_at) DESC NULLS LAST
       LIMIT 50`,
      [],
      'stability.radar.opportunities'
    );

    const sectors = await safeRows(
      `SELECT COALESCE(sector,'Unknown') AS sector, AVG(COALESCE(change_percent,0)) AS avg_change_percent
       FROM ${MARKET_QUOTES_TABLE}
       GROUP BY 1
       ORDER BY avg_change_percent DESC NULLS LAST
       LIMIT 12`,
      [],
      'stability.radar.sectors'
    );

    const breadthRows = await safeRows(
      `SELECT
         SUM(CASE WHEN COALESCE(change_percent,0) > 0 THEN 1 ELSE 0 END) AS advancers,
         SUM(CASE WHEN COALESCE(change_percent,0) < 0 THEN 1 ELSE 0 END) AS decliners
       FROM ${MARKET_QUOTES_TABLE}`,
      [],
      'stability.radar.breadth'
    );

    const breadth = breadthRows[0] || {};

    return res.json({
      success: true,
      data: {
        signals: signals.map(normalizeExpectedMove),
        opportunities: opportunities.map(normalizeExpectedMove),
        breadth,
        sectors,
      },
      meta: { source: 'stability-layer' },
    });
  } catch (_error) {
    return res.json({
      success: true,
      data: {
        signals: [],
        opportunities: [],
        breadth: {},
        sectors: [],
      },
      meta: { source: 'stability-layer-fallback' },
    });
  }
});

router.get('/api/scanner', async (_req, res) => {
  const rows = await safeRows(
    `SELECT symbol, COALESCE(change_percent,0) AS change_percent, COALESCE(volume,0) AS volume, sector, updated_at
      FROM ${MARKET_QUOTES_TABLE}
     ORDER BY ABS(COALESCE(change_percent,0)) DESC NULLS LAST
     LIMIT 100`,
    [],
    'stability.scanner'
  );
  return res.json(success(rows));
});

router.get('/api/signals', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 500, 1000));
    const symbol = String(req.query.symbol || '').trim().toUpperCase();

    const params = [];
    let whereClause = '';
    if (symbol) {
      params.push(symbol);
      whereClause = `WHERE symbol = $${params.length}`;
    }
    params.push(limit);

    const { rows } = await queryWithTimeout(
      `SELECT id, symbol, signal_type, score, confidence, catalyst_ids, created_at
       FROM signals
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params,
      { label: 'stability.strict.signals', timeoutMs: 2400, maxRetries: 1, retryDelayMs: 120 }
    );

    return res.json({ success: true, data: rows });
  } catch (error) {
    return res.status(500).json(failure(error.message || 'Failed to load signals'));
  }
});

router.get('/api/news', async (_req, res) => {
  const rows = await safeRows(
    `SELECT symbol, headline, source, created_at AS timestamp, url
     FROM news_articles
     WHERE created_at > NOW() - INTERVAL '24 hours'
     ORDER BY created_at DESC NULLS LAST
     LIMIT 100`,
    [],
    'stability.news'
  );
  return res.json(success(rows));
});

router.get('/api/catalysts', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 500, 1000));
    const { rows } = await queryWithTimeout(
      `SELECT
         event_uuid AS id,
         symbol,
         catalyst_type,
         headline,
         source_table,
         source_id,
         event_time,
         strength_score,
         sentiment_score,
         created_at
       FROM catalyst_events
       WHERE source_table IN ('news_articles', 'earnings_calendar', 'ipo_calendar', 'stock_splits')
       ORDER BY COALESCE(event_time, published_at, created_at) DESC
       LIMIT $1`,
      [limit],
      { label: 'stability.strict.catalysts', timeoutMs: 2400, maxRetries: 1, retryDelayMs: 120 }
    );

    return res.json({ success: true, data: rows });
  } catch (error) {
    return res.status(500).json(failure(error.message || 'Failed to load catalysts'));
  }
});

router.get('/api/market-breadth', async (_req, res) => {
  const rows = await safeRows(
    `SELECT
      SUM(CASE WHEN COALESCE(change_percent,0) > 0 THEN 1 ELSE 0 END) AS advancers,
      SUM(CASE WHEN COALESCE(change_percent,0) < 0 THEN 1 ELSE 0 END) AS decliners,
      SUM(CASE WHEN COALESCE(change_percent,0) = 0 THEN 1 ELSE 0 END) AS unchanged
      FROM ${MARKET_QUOTES_TABLE}`,
    [],
    'stability.marketBreadth'
  );
  return res.json(success(rows));
});

router.get('/api/sector-rotation', async (_req, res) => {
  const rows = await safeRows(
    `SELECT COALESCE(sector,'Unknown') AS sector, AVG(COALESCE(change_percent,0)) AS avg_change_percent
      FROM ${MARKET_QUOTES_TABLE}
     GROUP BY 1
     ORDER BY avg_change_percent DESC NULLS LAST`,
    [],
    'stability.sectorRotation'
  );
  return res.json(success(rows));
});

router.get('/api/intelligence-feed', async (_req, res) => {
  const rows = await safeRows(
    `SELECT symbol, strategy, score, catalyst_headline AS catalyst, created_at AS timestamp
      FROM ${SIGNALS_TABLE}
     ORDER BY created_at DESC NULLS LAST
     LIMIT 100`,
    [],
    'stability.intelligenceFeed'
  );
  return res.json(success(rows));
});

router.get('/api/trade-setups', async (_req, res) => {
  const rows = await safeRows(
    `SELECT symbol,
            setup_type,
            strategy_score,
            relative_volume,
            gap_percent,
            COALESCE(detected_at, updated_at) AS timestamp
      FROM ${OPPORTUNITIES_TABLE}
     ORDER BY COALESCE(detected_at, updated_at) DESC NULLS LAST
     LIMIT 100`,
    [],
    'stability.tradeSetups'
  );
  return res.json(success(rows));
});

router.get('/api/chart-data', async (_req, res) => {
  try {
    const rows = await safeRows(
      `SELECT symbol, timestamp, open, high, low, close, volume
        FROM ${INTRADAY_TABLE}
       ORDER BY timestamp DESC
       LIMIT 500`,
      [],
      'stability.chartData'
    );

    const ohlc = rows.map((row) => ({
      symbol: row.symbol,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
    }));
    const volume = rows.map((row) => row.volume ?? null);
    const timestamps = rows.map((row) => row.timestamp ?? null);

    return res.json({
      success: true,
      data: {
        ohlc: Array.isArray(ohlc) ? ohlc : [],
        volume: Array.isArray(volume) ? volume : [],
        timestamps: Array.isArray(timestamps) ? timestamps : [],
      },
      meta: { source: 'stability-layer' },
    });
  } catch (_error) {
    return res.json({
      success: true,
      data: {
        ohlc: [],
        volume: [],
        timestamps: [],
      },
      meta: { source: 'stability-layer-fallback' },
    });
  }
});

router.get('/api/ticker-tape', async (_req, res) => {
  const rows = await safeRows(
    `SELECT
       q.symbol,
       q.price,
       COALESCE((to_jsonb(q)->>'change')::numeric, (to_jsonb(m)->>'change')::numeric, NULL) AS change,
       q.change_percent,
       COALESCE(q.volume, m.volume, 0) AS volume,
       COALESCE(m.relative_volume, NULL) AS relative_volume,
       q.sector,
       COALESCE(q.updated_at, m.updated_at, NOW()) AS updated_at
      FROM ${MARKET_QUOTES_TABLE} q
     LEFT JOIN market_metrics m ON m.symbol = q.symbol
     ORDER BY ABS(COALESCE(q.change_percent,0)) DESC NULLS LAST
     LIMIT 50`,
    [],
    'stability.tickerTape'
  );

  const symbols = (rows || []).map((row) => String(row?.symbol || '').toUpperCase()).filter(Boolean);
  const catalystsBySymbol = await latestCatalystsBySymbol(symbols);

  const normalized = (rows || []).map((row) => {
    const symbol = String(row?.symbol || '').toUpperCase();
    const updatedAt = row?.updated_at || null;
    const hasDataPoint = Boolean(updatedAt);
    const catalystRow = catalystsBySymbol.get(symbol);
    const price = toTickerNumber(row?.price, { allowZero: false, hasDataPoint });

    return {
      symbol,
      price,
      change: toTickerNumber(row?.change, { allowZero: true, hasDataPoint }),
      changePercent: toTickerNumber(row?.change_percent, { allowZero: true, hasDataPoint }),
      change_percent: toTickerNumber(row?.change_percent, { allowZero: true, hasDataPoint }),
      volume: toTickerNumber(row?.volume, { allowZero: false, hasDataPoint }),
      relativeVolume: toTickerNumber(row?.relative_volume, { allowZero: false, hasDataPoint }),
      catalyst: catalystRow?.catalyst || 'No recent catalyst',
      updatedAt,
    };
  }).filter((row) => Number.isFinite(Number(row.price)));

  return res.json(success(normalized));
});

router.use('/api', (_req, res, next) => {
  if (!res.headersSent) return next();
  return undefined;
});

router.use((err, _req, res, _next) => {
  return res.json(failure(err?.message || 'Stability layer error'));
});

module.exports = router;
