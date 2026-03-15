const express = require('express');
const { queryWithTimeout } = require('../db/pg');

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
       FROM strategy_signals
       ORDER BY created_at DESC NULLS LAST
       LIMIT 50`,
      [],
      'stability.radar.signals'
    );

    const opportunities = await safeRows(
      `SELECT symbol, strategy, confidence, expected_move, catalyst, created_at
       FROM opportunity_stream
       ORDER BY created_at DESC NULLS LAST
       LIMIT 50`,
      [],
      'stability.radar.opportunities'
    );

    const sectors = await safeRows(
      `SELECT COALESCE(sector,'Unknown') AS sector, AVG(COALESCE(change_percent,0)) AS avg_change_percent
       FROM market_quotes
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
       FROM market_quotes`,
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
     FROM market_quotes
     ORDER BY ABS(COALESCE(change_percent,0)) DESC NULLS LAST
     LIMIT 100`,
    [],
    'stability.scanner'
  );
  return res.json(success(rows));
});

router.get('/api/opportunities', async (_req, res) => {
  const rows = await safeRows(
    `SELECT symbol, strategy, confidence, expected_move, catalyst, created_at
     FROM opportunity_stream
     ORDER BY created_at DESC NULLS LAST
     LIMIT 100`,
    [],
    'stability.opportunities'
  );
  return res.json(success(rows.map(normalizeExpectedMove)));
});

router.get('/api/signals', async (_req, res) => {
  const rows = await safeRows(
    `SELECT symbol, strategy, score, expected_move, catalyst_headline AS catalyst, created_at
     FROM strategy_signals
     ORDER BY created_at DESC NULLS LAST
     LIMIT 100`,
    [],
    'stability.signals'
  );
  return res.json(success(rows.map(normalizeExpectedMove)));
});

router.get('/api/news', async (_req, res) => {
  const rows = await safeRows(
    `SELECT symbol, headline, source, published_at AS timestamp, url
     FROM news_articles
     ORDER BY published_at DESC NULLS LAST
     LIMIT 100`,
    [],
    'stability.news'
  );
  return res.json(success(rows));
});

router.get('/api/catalysts', async (_req, res) => {
  const catalystRows = await safeRows(
    `SELECT symbol, COALESCE(catalyst, catalyst_type, headline) AS catalyst, COALESCE(timestamp, published_at, created_at) AS timestamp
     FROM trade_catalysts
     ORDER BY COALESCE(timestamp, published_at, created_at) DESC NULLS LAST
     LIMIT 300`,
    [],
    'stability.catalysts'
  );

  if (catalystRows.length > 0) {
    return res.json(success(catalystRows));
  }

  const symbols = await safeRows(
    `SELECT DISTINCT symbol
     FROM strategy_signals
     WHERE symbol IS NOT NULL
     ORDER BY symbol ASC
     LIMIT 100`,
    [],
    'stability.catalysts.symbols'
  );

  const placeholders = symbols.map((row) => ({
    symbol: row.symbol,
    catalyst: 'No recent catalyst',
    timestamp: null,
  }));
  return res.json(success(placeholders));
});

router.get('/api/market-breadth', async (_req, res) => {
  const rows = await safeRows(
    `SELECT
      SUM(CASE WHEN COALESCE(change_percent,0) > 0 THEN 1 ELSE 0 END) AS advancers,
      SUM(CASE WHEN COALESCE(change_percent,0) < 0 THEN 1 ELSE 0 END) AS decliners,
      SUM(CASE WHEN COALESCE(change_percent,0) = 0 THEN 1 ELSE 0 END) AS unchanged
     FROM market_quotes`,
    [],
    'stability.marketBreadth'
  );
  return res.json(success(rows));
});

router.get('/api/sector-rotation', async (_req, res) => {
  const rows = await safeRows(
    `SELECT COALESCE(sector,'Unknown') AS sector, AVG(COALESCE(change_percent,0)) AS avg_change_percent
     FROM market_quotes
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
     FROM strategy_signals
     ORDER BY created_at DESC NULLS LAST
     LIMIT 100`,
    [],
    'stability.intelligenceFeed'
  );
  return res.json(success(rows));
});

router.get('/api/trade-setups', async (_req, res) => {
  const rows = await safeRows(
    `SELECT symbol, setup_type, strategy_score, relative_volume, gap_percent, created_at AS timestamp
     FROM trade_setups
     ORDER BY created_at DESC NULLS LAST
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
       FROM intraday_prices
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
    `SELECT symbol, price, change_percent, volume, sector
     FROM market_quotes
     ORDER BY ABS(COALESCE(change_percent,0)) DESC NULLS LAST
     LIMIT 50`,
    [],
    'stability.tickerTape'
  );
  return res.json(success(rows));
});

router.use('/api', (_req, res, next) => {
  if (!res.headersSent) return next();
  return undefined;
});

router.use((err, _req, res, _next) => {
  return res.json(failure(err?.message || 'Stability layer error'));
});

module.exports = router;
