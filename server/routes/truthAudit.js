const express = require('express');

const { queryWithTimeout } = require('../db/pg');
const { getResearchTerminalPayload, normalizeSymbol } = require('../services/researchCacheService');
const { buildTruthDecisionFromPayload } = require('../services/truthEngine');

const router = express.Router();
const NEWS_LOOKBACK_DAYS = 7;

function uniqueTickers(values) {
  const out = [];
  const seen = new Set();
  for (const value of values || []) {
    const symbol = normalizeSymbol(value);
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    out.push(symbol);
  }
  return out;
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeDateKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

async function loadSupportMaps(tickers) {
  const [marketResult, newsResult] = await Promise.all([
    queryWithTimeout(
      `WITH latest_market AS (
         SELECT DISTINCT ON (UPPER(COALESCE(mq.symbol, mm.symbol)))
           UPPER(COALESCE(mq.symbol, mm.symbol)) AS symbol,
           COALESCE(mq.price, mm.price)::numeric AS price,
           COALESCE(mq.change_percent, mm.change_percent)::numeric AS change_percent,
           COALESCE(mq.volume, mm.volume)::numeric AS volume,
           mm.relative_volume::numeric AS relative_volume,
           mm.avg_volume_30d::numeric AS avg_volume_30d,
           COALESCE(mq.last_updated, mq.updated_at, mm.updated_at) AS updated_at
         FROM market_quotes mq
         FULL OUTER JOIN market_metrics mm
           ON UPPER(mm.symbol) = UPPER(mq.symbol)
         WHERE UPPER(COALESCE(mq.symbol, mm.symbol)) = ANY($1::text[])
         ORDER BY UPPER(COALESCE(mq.symbol, mm.symbol)), COALESCE(mq.last_updated, mq.updated_at, mm.updated_at) DESC NULLS LAST
       )
       SELECT symbol, price, change_percent, volume, relative_volume, avg_volume_30d, updated_at
       FROM latest_market`,
      [tickers],
      {
        timeoutMs: 12000,
        label: 'truth_audit_route.market_support',
        maxRetries: 0,
      }
    ).catch(() => ({ rows: [] })),
    queryWithTimeout(
      `SELECT UPPER(symbol) AS symbol, COUNT(*)::int AS news_count
       FROM news_articles
       WHERE UPPER(symbol) = ANY($1::text[])
         AND COALESCE(published_at, published_date, created_at) >= NOW() - ($2::text || ' days')::interval
       GROUP BY UPPER(symbol)`,
      [tickers, String(NEWS_LOOKBACK_DAYS)],
      {
        timeoutMs: 12000,
        label: 'truth_audit_route.news_support',
        maxRetries: 0,
      }
    ).catch(() => ({ rows: [] })),
  ]);

  return {
    marketByTicker: new Map((marketResult.rows || []).map((row) => [normalizeSymbol(row.symbol), {
      price: toNumber(row.price),
      change_percent: toNumber(row.change_percent),
      volume: toNumber(row.volume),
      relative_volume: toNumber(row.relative_volume),
      avg_volume_30d: toNumber(row.avg_volume_30d),
      updated_at: row.updated_at || null,
    }])),
    newsByTicker: new Map((newsResult.rows || []).map((row) => [normalizeSymbol(row.symbol), Number(row.news_count || 0)])),
  };
}

router.get('/api/truth-audit', async (req, res) => {
  const tickers = uniqueTickers(String(req.query.tickers || '').split(','));
  if (!tickers.length) {
    return res.status(400).json({
      success: false,
      error: 'tickers_required',
      message: 'Provide a comma-separated tickers query parameter.',
      rows: [],
    });
  }

  try {
    const supportMaps = await loadSupportMaps(tickers);
    const rows = [];

    for (const ticker of tickers) {
      try {
        const payload = await getResearchTerminalPayload(ticker);
        const decision = await buildTruthDecisionFromPayload({
          symbol: ticker,
          payload,
          includeNarrative: false,
          allowRemoteNarrative: false,
        });
        const market = supportMaps.marketByTicker.get(ticker) || {};
        const newsCount = supportMaps.newsByTicker.get(ticker) || 0;
        const next = payload?.earnings?.next || null;

        rows.push({
          ticker,
          openrange: {
            ticker,
            price: toNumber(payload?.price?.price) ?? market.price,
            change_percent: toNumber(payload?.price?.change_percent) ?? market.change_percent,
            relative_volume: market.relative_volume,
            volume: market.volume,
            avg_volume_30d: market.avg_volume_30d,
            earnings: {
              next_date: normalizeDateKey(next?.date || next?.report_date),
              expected_move: toNumber(next?.expected_move_percent ?? next?.expected_move ?? next?.expectedMove),
            },
            news_count: newsCount,
            driver: String(decision.driver || 'NO_DRIVER').trim().toUpperCase() || 'NO_DRIVER',
            tradeability: String(decision.status || 'UNKNOWN').trim().toUpperCase() || 'UNKNOWN',
            confidence: toNumber(decision.confidence) ?? 0,
            source_endpoint: `/api/research/${encodeURIComponent(ticker)}/full`,
            updated_at: market.updated_at || payload?.meta?.updated_at || null,
          },
          status: 'complete',
        });
      } catch (error) {
        rows.push({
          ticker,
          openrange: null,
          status: 'missing',
          error: error.message || 'openrange_fetch_failed',
        });
      }
    }

    return res.json({
      success: true,
      tickers_requested: tickers,
      tickers_processed: rows.length,
      rows,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: 'truth_audit_failed',
      message: error.message,
      rows: tickers.map((ticker) => ({ ticker, openrange: null, status: 'missing' })),
    });
  }
});

module.exports = router;