const express = require('express');
const { Client } = require('pg');
const { resolveDatabaseUrl } = require('../db/connectionConfig');
const { getMarketSession } = require('../utils/marketSession');

const router = express.Router();
const CACHE_TTL_MS = 60_000;
const cache = new Map();

function dbClient() {
  const { dbUrl } = resolveDatabaseUrl();
  return new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
    statement_timeout: 10_000,
    query_timeout: 10_000,
  });
}

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit || (Date.now() - hit.cachedAt) > CACHE_TTL_MS) return null;
  return hit;
}

function cacheSet(key, data) {
  const entry = { data, cachedAt: Date.now() };
  cache.set(key, entry);
  return entry;
}

function pct(numerator, denominator) {
  return denominator > 0 ? Number(((numerator / denominator) * 100).toFixed(1)) : 0;
}

function timeoutReason(error) {
  return error?.code === '57014' || /timeout/i.test(String(error?.message || '')) ? 'query_timeout' : 'query_error';
}

async function safeQuery(client, sql, params = []) {
  try {
    const { rows } = await client.query(sql, params);
    return { ok: true, rows };
  } catch (error) {
    return { ok: false, reason: timeoutReason(error), error: error.message, rows: [] };
  }
}

function sla(status, measured, reason = null, extra = {}) {
  return { status, measured, reason, ...extra };
}

function summarizeHealth(slas) {
  const statuses = Object.values(slas).map((entry) => entry.status);
  if (statuses.every((status) => status === 'N/A')) return 'N/A';
  if (statuses.some((status) => status === 'FAIL' || status === 'unknown')) return 'DEGRADED';
  return 'PASS';
}

async function buildSummary() {
  const session = getMarketSession();
  const asOf = new Date().toISOString();
  const client = dbClient();
  await client.connect();
  try {
    const liveQuotes = await safeQuery(client, `WITH active AS (SELECT symbol FROM ticker_universe WHERE is_active = true)
        SELECT (SELECT COUNT(*) FROM active)::int AS active_universe,
               COUNT(mq.symbol)::int AS covered_total,
               COUNT(mq.symbol) FILTER (WHERE mq.updated_at >= NOW() - INTERVAL '5 minutes')::int AS fresh_5m,
               MAX(mq.updated_at) AS latest
        FROM active a LEFT JOIN market_quotes mq ON mq.symbol = a.symbol`);
    const intraday = await safeQuery(client, `SELECT COUNT(DISTINCT i.symbol) FILTER (WHERE i.timestamp >= NOW() - INTERVAL '10 minutes')::int AS symbols_10m,
               COUNT(DISTINCT i.symbol) FILTER (WHERE i.timestamp >= NOW() - INTERVAL '24 hours')::int AS symbols_24h,
               MAX(i.timestamp) AS latest
        FROM intraday_1m i JOIN ticker_universe tu ON tu.symbol = i.symbol AND tu.is_active = true`);
    const daily = await safeQuery(client, `WITH active AS (SELECT symbol FROM ticker_universe WHERE is_active = true)
        SELECT (SELECT COUNT(*) FROM active)::int AS active_universe,
               COUNT(DISTINCT d.symbol) FILTER (WHERE d.date >= CURRENT_DATE - INTERVAL '1 day')::int AS symbols_yesterday,
               MAX(d.date) AS latest_date
        FROM daily_ohlc d JOIN active a ON a.symbol = d.symbol`);
    const news = await safeQuery(client, `SELECT COUNT(*) FILTER (WHERE published_at >= NOW() - INTERVAL '24 hours')::int AS last_24h,
               MAX(published_at) AS latest
        FROM news_articles`);
    const earnings = await safeQuery(client, `SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE eps_estimate IS NOT NULL)::int AS with_est
        FROM earnings_events
        WHERE report_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '14 days'`);
    const catalysts = await safeQuery(client, `SELECT COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '1 hour')::int AS last_1h,
               MAX(created_at) AS latest
        FROM catalyst_signals`);

    const slas = {};
    if (session === 'CLOSED') {
      slas.live_quotes_freshness = sla('N/A', 'market closed', 'market_closed');
      slas.intraday_priority_10m = sla('N/A', 'market closed', 'market_closed');
    } else {
      slas.live_quotes_freshness = liveQuotes.ok
        ? sla(liveQuotes.rows[0].fresh_5m > 0 ? 'PASS' : 'FAIL', `${liveQuotes.rows[0].fresh_5m} active symbols fresh in 5m`, null)
        : sla('unknown', 'unavailable', liveQuotes.reason);
      slas.intraday_priority_10m = intraday.ok
        ? sla(intraday.rows[0].symbols_10m > 0 ? 'PASS' : 'FAIL', `${intraday.rows[0].symbols_10m} symbols in 10m`, null)
        : sla('unknown', 'unavailable', intraday.reason);
    }
    slas.live_quotes_coverage = liveQuotes.ok
      ? sla(pct(liveQuotes.rows[0].covered_total, liveQuotes.rows[0].active_universe) >= 95 ? 'PASS' : 'FAIL', `${pct(liveQuotes.rows[0].covered_total, liveQuotes.rows[0].active_universe)}%`, null)
      : sla('unknown', 'unavailable', liveQuotes.reason);
    slas.intraday_24h_coverage = intraday.ok && liveQuotes.ok
      ? sla(pct(intraday.rows[0].symbols_24h, liveQuotes.rows[0].active_universe) >= 70 ? 'PASS' : 'FAIL', `${pct(intraday.rows[0].symbols_24h, liveQuotes.rows[0].active_universe)}%`, null)
      : sla('unknown', 'unavailable', intraday.reason || liveQuotes.reason);
    slas.daily_ohlc_yesterday = daily.ok
      ? sla(pct(daily.rows[0].symbols_yesterday, daily.rows[0].active_universe) >= 99 ? 'PASS' : 'FAIL', `${pct(daily.rows[0].symbols_yesterday, daily.rows[0].active_universe)}%`, null)
      : sla('unknown', 'unavailable', daily.reason);
    slas.news_last_24h = news.ok
      ? sla(news.rows[0].last_24h > 0 ? 'PASS' : 'FAIL', `${news.rows[0].last_24h} rows`, null)
      : sla('unknown', 'unavailable', news.reason);
    slas.earnings_upcoming_estimates = earnings.ok
      ? sla(pct(earnings.rows[0].with_est, earnings.rows[0].total) >= 70 ? 'PASS' : 'FAIL', `${pct(earnings.rows[0].with_est, earnings.rows[0].total)}%`, earnings.rows[0].with_est === 0 ? 'split_table_issue_known' : null)
      : sla('unknown', 'unavailable', earnings.reason);
    slas.catalysts_active = catalysts.ok
      ? sla(catalysts.rows[0].last_1h > 0 ? 'PASS' : 'FAIL', `${catalysts.rows[0].last_1h} in last 1h`, null)
      : sla('unknown', 'unavailable', catalysts.reason);

    return { as_of: asOf, session: { status: session }, health: summarizeHealth(slas), slas };
  } finally {
    await client.end().catch(() => null);
  }
}

async function buildSymbol(symbol) {
  const client = dbClient();
  await client.connect();
  try {
    const result = await safeQuery(client, `SELECT tu.symbol, mq.price AS quote_price, mq.updated_at AS quote_updated,
             mm.price AS metric_price,
             (SELECT MAX(timestamp) FROM intraday_1m WHERE symbol = tu.symbol) AS latest_intraday,
             (SELECT MAX(date) FROM daily_ohlc WHERE symbol = tu.symbol) AS latest_daily,
             (SELECT COUNT(*)::int FROM news_articles WHERE symbol = tu.symbol AND published_at >= NOW() - INTERVAL '7 days') AS news_7d
      FROM ticker_universe tu
      LEFT JOIN market_quotes mq ON mq.symbol = tu.symbol
      LEFT JOIN market_metrics mm ON mm.symbol = tu.symbol
      WHERE tu.symbol = $1 AND tu.is_active = true`, [symbol]);
    if (!result.ok) return { as_of: new Date().toISOString(), symbol, health: 'DEGRADED', reason: result.reason };
    const row = result.rows[0] || null;
    if (!row) return { as_of: new Date().toISOString(), symbol, health: 'N/A', reason: 'symbol_not_found' };
    const staleQuote = !row.quote_updated || (Date.now() - new Date(row.quote_updated).getTime()) > 300_000;
    return {
      as_of: new Date().toISOString(),
      session: { status: getMarketSession() },
      symbol,
      health: staleQuote ? 'DEGRADED' : 'PASS',
      trust: {
        quote: { price: row.quote_price, updated_at: row.quote_updated, stale: staleQuote },
        market_metric_price: row.metric_price,
        intraday_latest: row.latest_intraday,
        daily_latest: row.latest_daily,
        news_7d: row.news_7d,
      },
    };
  } finally {
    await client.end().catch(() => null);
  }
}

async function respondCached(res, key, builder, projector = (value) => value) {
  const hit = cacheGet(key);
  if (hit) {
    return res.status(200).json({ ...projector(hit.data), cached_at: new Date(hit.cachedAt).toISOString(), cache_age_seconds: Math.floor((Date.now() - hit.cachedAt) / 1000) });
  }
  const data = await builder();
  const entry = cacheSet(key, data);
  return res.status(200).json({ ...projector(data), cached_at: new Date(entry.cachedAt).toISOString(), cache_age_seconds: 0 });
}

router.get('/summary', async (_req, res) => {
  try {
    return await respondCached(res, 'summary', buildSummary);
  } catch (error) {
    console.error('[data_trust] summary failed', { message: error?.message, stack: error?.stack });
    return res.status(500).json({ as_of: new Date().toISOString(), health: 'FAIL', error: 'data_trust_summary_failed' });
  }
});

router.get('/sla', async (_req, res) => {
  try {
    return await respondCached(res, 'summary', buildSummary, (data) => ({ as_of: data.as_of, session: data.session, health: data.health, slas: data.slas }));
  } catch (error) {
    console.error('[data_trust] sla failed', { message: error?.message, stack: error?.stack });
    return res.status(500).json({ as_of: new Date().toISOString(), health: 'FAIL', error: 'data_trust_sla_failed' });
  }
});

router.get('/symbol/:symbol', async (req, res) => {
  const symbol = String(req.params.symbol || '').trim().toUpperCase();
  if (!symbol) return res.status(400).json({ as_of: new Date().toISOString(), error: 'symbol_required' });
  try {
    return await respondCached(res, `symbol:${symbol}`, () => buildSymbol(symbol));
  } catch (error) {
    console.error('[data_trust] symbol failed', { symbol, message: error?.message, stack: error?.stack });
    return res.status(500).json({ as_of: new Date().toISOString(), health: 'FAIL', error: 'data_trust_symbol_failed' });
  }
});

module.exports = router;