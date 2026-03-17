const express = require('express');
const router = express.Router();
const { queryWithTimeout } = require('../db/pg');
const { runQueryTree } = require('../services/queryEngine');
const { fetchRadarData } = require('../engines/radarEngine');

router.get('/', async (_req, res) => {
  try {
    const rows = (await runQueryTree({ AND: [] }, { limit: 120 })).rows || [];
    const safeRows = Array.isArray(rows) ? rows : [];
    const buckets = { A: [], B: [], C: [] };

    safeRows.forEach((row) => {
      const klass = String(row?.class || '').toUpperCase();
      const target = klass === 'A' ? 'A' : klass === 'B' ? 'B' : 'C';
      buckets[target].push(row);
    });

    const sectors = Array.from(
      new Set(
        safeRows
          .map((row) => String(row?.sector || row?.sector_context || '').trim())
          .filter(Boolean)
      )
    );

    return res.json({
      signals: safeRows,
      opportunities: safeRows,
      sectors,
      A: buckets.A,
      B: buckets.B,
      C: buckets.C,
      status: 'ok',
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    return res.json({
      signals: [],
      opportunities: [],
      sectors: [],
      A: [],
      B: [],
      C: [],
      status: 'error',
      message: 'Radar temporarily unavailable',
    });
  }
});

router.get('/summary', async (_req, res) => {
  try {
    const primary = await queryWithTimeout(
      `SELECT
         m.*,
         COALESCE(m.updated_at, m.last_updated) AS updated_at
       FROM market_metrics m
       WHERE COALESCE(m.updated_at, m.last_updated) > NOW() - INTERVAL '24 hours'
       ORDER BY COALESCE(m.relative_volume, 0) DESC NULLS LAST,
                ABS(COALESCE(m.gap_percent, 0)) DESC NULLS LAST,
                COALESCE(m.updated_at, m.last_updated) DESC NULLS LAST
       LIMIT 100`,
      [],
      { timeoutMs: 7000, label: 'api.radar.summary.market_metrics.primary', maxRetries: 0 }
    );

    console.log('[DATA CHECK]', {
      table: 'market_metrics',
      rows: primary.rows.length
    });

    let rows = primary.rows;
    if (!rows.length) {
      const fallback = await queryWithTimeout(
        `SELECT *
         FROM market_metrics
         ORDER BY updated_at DESC NULLS LAST
         LIMIT 50`,
        [],
        { timeoutMs: 7000, label: 'api.radar.summary.market_metrics.fallback', maxRetries: 0 }
      );

      console.log('[DATA CHECK]', {
        table: 'market_metrics',
        rows: fallback.rows.length
      });

      rows = fallback.rows;
    }

    res.json({
      success: true,
      count: rows.length,
      data: rows,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to load radar summary',
      detail: error.message,
    });
  }
});

router.get('/today', async (_req, res) => {
  try {
    const radar = await fetchRadarData();
    return res.json({
      ok: true,
      generated_at: new Date().toISOString(),
      radar,
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: 'Radar today fetch failed',
      detail: error.message,
    });
  }
});

module.exports = router;
