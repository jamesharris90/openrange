const express = require('express');
const { queryWithTimeout } = require('../db/pg');

const router = express.Router();

function asLimit(input, fallback = 100, max = 500) {
  const n = Number.parseInt(String(input || ''), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(n, max);
}

router.get('/api/earnings', async (req, res) => {
  const limit = asLimit(req.query.limit, 200, 1000);
  const symbol = String(req.query.symbol || '').trim().toUpperCase();
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();

  const params = [];
  const where = [];

  if (symbol) {
    params.push(symbol);
    where.push(`symbol = $${params.length}`);
  }
  if (from) {
    params.push(from);
    where.push(`event_date >= $${params.length}::date`);
  }
  if (to) {
    params.push(to);
    where.push(`event_date <= $${params.length}::date`);
  }

  params.push(limit);

  try {
    const sql = `
      SELECT
        symbol,
        event_date,
        last_updated_date,
        eps_estimate,
        eps_actual,
        revenue_estimate,
        revenue_actual,
        source,
        raw_json,
        ingested_at
      FROM earnings_calendar
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY event_date DESC, symbol ASC
      LIMIT $${params.length}
    `;

    const result = await queryWithTimeout(sql, params, {
      label: 'api.strict.earnings', timeoutMs: 3000, maxRetries: 1, retryDelayMs: 100,
    });

    return res.json({ success: true, data: result.rows || [] });
  } catch (error) {
    return res.status(500).json({ success: false, data: [], error: error.message || 'earnings query failed' });
  }
});

router.get('/api/news', async (req, res) => {
  const limit = asLimit(req.query.limit, 200, 1000);
  const symbol = String(req.query.symbol || '').trim().toUpperCase();
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();

  const params = [];
  const where = [];

  if (symbol) {
    params.push(symbol);
    where.push(`symbol = $${params.length}`);
  }
  if (from) {
    params.push(from);
    where.push(`published_date >= $${params.length}::timestamptz`);
  }
  if (to) {
    params.push(to);
    where.push(`published_date <= $${params.length}::timestamptz`);
  }

  params.push(limit);

  try {
    const sql = `
      SELECT
        symbol,
        published_date,
        title,
        body_text,
        source,
        publisher,
        site,
        url,
        image_url,
        raw_payload AS raw_json,
        ingested_at
      FROM news_articles
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY published_date DESC NULLS LAST
      LIMIT $${params.length}
    `;

    const result = await queryWithTimeout(sql, params, {
      label: 'api.strict.news', timeoutMs: 3000, maxRetries: 1, retryDelayMs: 100,
    });

    return res.json({ success: true, data: result.rows || [] });
  } catch (error) {
    return res.status(500).json({ success: false, data: [], error: error.message || 'news query failed' });
  }
});

router.get('/api/ipos', async (req, res) => {
  const limit = asLimit(req.query.limit, 200, 1000);
  const symbol = String(req.query.symbol || '').trim().toUpperCase();
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();

  const params = [];
  const where = [];

  if (symbol) {
    params.push(symbol);
    where.push(`symbol = $${params.length}`);
  }
  if (from) {
    params.push(from);
    where.push(`event_date >= $${params.length}::date`);
  }
  if (to) {
    params.push(to);
    where.push(`event_date <= $${params.length}::date`);
  }

  params.push(limit);

  try {
    const sql = `
      SELECT
        symbol,
        event_date,
        company,
        exchange,
        actions,
        price_range,
        shares,
        market_cap,
        source,
        raw_json,
        ingested_at
      FROM ipo_calendar
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY event_date DESC, symbol ASC
      LIMIT $${params.length}
    `;

    const result = await queryWithTimeout(sql, params, {
      label: 'api.strict.ipos', timeoutMs: 3000, maxRetries: 1, retryDelayMs: 100,
    });

    return res.json({ success: true, data: result.rows || [] });
  } catch (error) {
    return res.status(500).json({ success: false, data: [], error: error.message || 'ipos query failed' });
  }
});

router.get('/api/splits', async (req, res) => {
  const limit = asLimit(req.query.limit, 200, 1000);
  const symbol = String(req.query.symbol || '').trim().toUpperCase();
  const from = String(req.query.from || '').trim();
  const to = String(req.query.to || '').trim();

  const params = [];
  const where = [];

  if (symbol) {
    params.push(symbol);
    where.push(`symbol = $${params.length}`);
  }
  if (from) {
    params.push(from);
    where.push(`event_date >= $${params.length}::date`);
  }
  if (to) {
    params.push(to);
    where.push(`event_date <= $${params.length}::date`);
  }

  params.push(limit);

  try {
    const sql = `
      SELECT
        symbol,
        event_date,
        numerator,
        denominator,
        split_type,
        source,
        raw_json,
        ingested_at
      FROM stock_splits
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY event_date DESC, symbol ASC
      LIMIT $${params.length}
    `;

    const result = await queryWithTimeout(sql, params, {
      label: 'api.strict.splits', timeoutMs: 3000, maxRetries: 1, retryDelayMs: 100,
    });

    return res.json({ success: true, data: result.rows || [] });
  } catch (error) {
    return res.status(500).json({ success: false, data: [], error: error.message || 'splits query failed' });
  }
});

module.exports = router;
