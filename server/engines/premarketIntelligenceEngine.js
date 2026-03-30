'use strict';

/**
 * premarketIntelligenceEngine.js
 * Step 2 — Premarket Intelligence Engine
 *
 * Schema facts (verified 2026-03-30):
 *   news_articles: symbols (ARRAY), symbol (nullable text), published_at,
 *                  headline, catalyst_type, detected_symbols (ARRAY), priority_score
 *   market_metrics: relative_volume, gap_percent, change_percent, avg_volume_30d,
 *                   volume, price, rsi, previous_close, float_shares, short_float, atr, vwap
 *   intraday_1m: symbol, "timestamp", open, high, low, close, volume, session
 *   earnings_events: symbol, report_date, eps_estimate, eps_actual, expected_move_percent,
 *                    rvol, score, price
 */

const { queryWithTimeout } = require('../db/pg');

// ── helpers ───────────────────────────────────────────────────────────────────

function asNum(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function minutesSince(ts) {
  if (!ts) return Infinity;
  return (Date.now() - new Date(ts).getTime()) / 60_000;
}

// ── Step 1: Build candidate symbol set ───────────────────────────────────────

async function buildCandidateSymbols() {
  // Symbols with news in last 72h (from ARRAY column)
  const newsSymbols = await queryWithTimeout(
    `SELECT DISTINCT unnest(symbols) AS symbol
     FROM news_articles
     WHERE published_at >= NOW() - INTERVAL '72 hours'
       AND array_length(symbols, 1) > 0`,
    [],
    { label: 'premarket.candidates.news', timeoutMs: 10000 }
  );

  // Symbols with upcoming earnings within 24h
  const earningsSymbols = await queryWithTimeout(
    `SELECT DISTINCT symbol
     FROM earnings_events
     WHERE report_date >= CURRENT_DATE AND report_date <= CURRENT_DATE + INTERVAL '1 day'
       AND symbol IS NOT NULL`,
    [],
    { label: 'premarket.candidates.earnings', timeoutMs: 8000 }
  );

  // Symbols with high RVOL or gap
  const metricsSymbols = await queryWithTimeout(
    `SELECT symbol
     FROM market_metrics
     WHERE (relative_volume > 2 OR gap_percent > 3)
       AND symbol IS NOT NULL`,
    [],
    { label: 'premarket.candidates.metrics', timeoutMs: 8000 }
  );

  const symbolSet = new Set([
    ...newsSymbols.rows.map(r => r.symbol),
    ...earningsSymbols.rows.map(r => r.symbol),
    ...metricsSymbols.rows.map(r => r.symbol),
  ].filter(Boolean));

  return [...symbolSet];
}

// ── Step 2: Fetch data for candidates ────────────────────────────────────────

async function fetchCandidateData(symbols) {
  if (symbols.length === 0) return { metrics: [], news: [], earnings: [] };

  const [metricsRes, newsRes, earningsRes] = await Promise.all([
    queryWithTimeout(
      `SELECT symbol, price, gap_percent, relative_volume, change_percent,
              avg_volume_30d, volume, rsi, vwap, previous_close, float_shares,
              short_float, atr, atr_percent, updated_at
       FROM market_metrics
       WHERE symbol = ANY($1)`,
      [symbols],
      { label: 'premarket.fetch.metrics', timeoutMs: 10000 }
    ),

    queryWithTimeout(
      `SELECT
         unnest(symbols) AS symbol,
         id, headline, published_at, catalyst_type, priority_score, sentiment,
         summary, catalyst_cluster
       FROM news_articles
       WHERE published_at >= NOW() - INTERVAL '72 hours'
         AND array_length(symbols, 1) > 0
         AND symbols && $1::text[]
       ORDER BY published_at DESC`,
      [symbols],
      { label: 'premarket.fetch.news', timeoutMs: 12000 }
    ),

    queryWithTimeout(
      `SELECT symbol, report_date, report_time, eps_estimate, eps_actual,
              expected_move_percent, rvol, score, price
       FROM earnings_events
       WHERE symbol = ANY($1)
         AND report_date >= CURRENT_DATE
         AND report_date <= CURRENT_DATE + INTERVAL '2 days'`,
      [symbols],
      { label: 'premarket.fetch.earnings', timeoutMs: 8000 }
    ),
  ]);

  return {
    metrics: metricsRes.rows,
    news: newsRes.rows,
    earnings: earningsRes.rows,
  };
}

// ── Step 3: Score each symbol ─────────────────────────────────────────────────

function classifyCatalystScore(newsRows) {
  if (!newsRows || newsRows.length === 0) return { level: 'NONE', weight: 0, latest_ts: null };

  const newest = newsRows.reduce((a, b) =>
    new Date(a.published_at) > new Date(b.published_at) ? a : b
  );
  const ageMin = minutesSince(newest.published_at);

  let level, weight;
  if (ageMin < 60 * 12) {
    level = 'HIGH';
    weight = 20;
  } else if (ageMin < 60 * 48) {
    level = 'MEDIUM';
    weight = 10;
  } else {
    level = 'LOW';
    weight = 3;
  }

  return { level, weight, latest_ts: newest.published_at, headline: newest.headline };
}

function classifyVolumeState(metrics) {
  const rvol = asNum(metrics?.relative_volume, 0);
  const vol = asNum(metrics?.volume, 0);
  const avg = asNum(metrics?.avg_volume_30d, 0);

  if (rvol === 0 && avg === 0) return 'UNKNOWN';
  if (rvol > 3) return 'SURGE';
  if (rvol > 1.5) return 'ELEVATED';
  if (rvol > 0.5) return 'NORMAL';
  return 'LOW';
}

function classifyPriceStructure(metrics) {
  const gap = asNum(metrics?.gap_percent, 0);
  const change = asNum(metrics?.change_percent, 0);
  const rsi = asNum(metrics?.rsi, null);

  if (gap > 5 || change > 5) return 'breakout';
  if (gap < -3 || change < -5) return 'fade';
  if (rsi !== null && rsi > 70) return 'extended';
  return 'flat';
}

function classifyLifecycle({ metrics, catalystScore, volumeState }) {
  const rvol = asNum(metrics?.relative_volume, 0);
  const change = asNum(metrics?.change_percent, 0);
  const rsi = asNum(metrics?.rsi, null);

  // DEAD: no catalyst + flat volume + minimal price move
  if (catalystScore.level === 'NONE' && rvol < 1 && Math.abs(change) < 1) {
    return 'DEAD';
  }

  // EXHAUSTION: extended RSI + volume dropping off
  if (rsi !== null && rsi > 75 && volumeState === 'LOW') {
    return 'EXHAUSTION';
  }

  // PRE_MOVE: early catalyst + volume not yet surging
  if (catalystScore.level === 'HIGH' && (volumeState === 'NORMAL' || volumeState === 'LOW')) {
    return 'PRE_MOVE';
  }

  // EXPANSION: high RVOL + real move happening
  if ((volumeState === 'SURGE' || volumeState === 'ELEVATED') && Math.abs(change) > 1) {
    return 'EXPANSION';
  }

  // Default
  if (catalystScore.level !== 'NONE') return 'PRE_MOVE';
  return 'DEAD';
}

function computeConfidence({ metrics, catalystScore, hasEarnings, volumeState }) {
  const rvol = asNum(metrics?.relative_volume, 0);
  const changeAbs = Math.abs(asNum(metrics?.change_percent, 0));
  const gap = Math.abs(asNum(metrics?.gap_percent, 0));
  const catalystWeight = catalystScore.weight;

  // Decay penalty: if data is stale
  const updatedAt = metrics?.updated_at;
  const ageMin = minutesSince(updatedAt);
  const decayPenalty = ageMin > 120 ? 10 : ageMin > 30 ? 5 : 0;

  // Earnings bonus
  const earningsBonus = hasEarnings ? 10 : 0;

  const raw = (rvol * 5) + (changeAbs * 3) + (gap * 2) + catalystWeight + earningsBonus - decayPenalty;
  return clamp(Math.round(raw), 0, 100);
}

function buildCatalystSummary(newsRows, hasEarnings) {
  if (hasEarnings) return 'Earnings event upcoming';
  if (!newsRows || newsRows.length === 0) return 'No recent catalyst — move likely technical or stale';

  const newest = newsRows[0];
  const headline = newest.headline || '';
  const type = newest.catalyst_type || 'news';
  const age = minutesSince(newest.published_at);
  const ageLabel = age < 60 ? `${Math.round(age)}m ago` : `${Math.round(age / 60)}h ago`;

  return `${type.toUpperCase()}: "${headline.slice(0, 100)}" (${ageLabel})`;
}

function buildTradeabilityVerdict(lifecycle, confidence, metrics) {
  const rvol = asNum(metrics?.relative_volume, 0);

  if (lifecycle === 'DEAD') {
    return { tradeable: false, reason: 'No catalyst, no volume, no structure' };
  }
  if (lifecycle === 'EXHAUSTION') {
    return { tradeable: false, reason: 'Extended — RSI high, volume fading' };
  }
  if (confidence < 20) {
    return { tradeable: false, reason: 'Confidence too low (<20)' };
  }
  if (rvol > 0 && rvol < 0.5) {
    return { tradeable: false, reason: 'Volume too thin (RVOL < 0.5)' };
  }
  return { tradeable: true, reason: null };
}

// ── Step 4: Upsert results ────────────────────────────────────────────────────

async function ensurePremarketTable() {
  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS premarket_intelligence (
      symbol              TEXT PRIMARY KEY,
      catalyst_summary    TEXT,
      news_count_72h      INTEGER,
      latest_news_ts      TIMESTAMPTZ,
      lifecycle_stage     TEXT,
      confidence          INTEGER,
      tradeable           BOOLEAN,
      reason_not_tradeable TEXT,
      catalyst_level      TEXT,
      volume_state        TEXT,
      price_structure     TEXT,
      rvol                NUMERIC,
      gap_percent         NUMERIC,
      change_percent      NUMERIC,
      has_earnings        BOOLEAN,
      updated_at          TIMESTAMPTZ DEFAULT NOW()
    )`,
    [],
    { label: 'premarket.ensure_table', timeoutMs: 10000, poolType: 'write' }
  );
}

async function upsertResults(results) {
  for (const r of results) {
    await queryWithTimeout(
      `INSERT INTO premarket_intelligence
         (symbol, catalyst_summary, news_count_72h, latest_news_ts, lifecycle_stage,
          confidence, tradeable, reason_not_tradeable, catalyst_level, volume_state,
          price_structure, rvol, gap_percent, change_percent, has_earnings, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW())
       ON CONFLICT (symbol) DO UPDATE SET
         catalyst_summary    = EXCLUDED.catalyst_summary,
         news_count_72h      = EXCLUDED.news_count_72h,
         latest_news_ts      = EXCLUDED.latest_news_ts,
         lifecycle_stage     = EXCLUDED.lifecycle_stage,
         confidence          = EXCLUDED.confidence,
         tradeable           = EXCLUDED.tradeable,
         reason_not_tradeable= EXCLUDED.reason_not_tradeable,
         catalyst_level      = EXCLUDED.catalyst_level,
         volume_state        = EXCLUDED.volume_state,
         price_structure     = EXCLUDED.price_structure,
         rvol                = EXCLUDED.rvol,
         gap_percent         = EXCLUDED.gap_percent,
         change_percent      = EXCLUDED.change_percent,
         has_earnings        = EXCLUDED.has_earnings,
         updated_at          = NOW()`,
      [
        r.symbol, r.catalyst_summary, r.news_count_72h, r.latest_news_ts,
        r.lifecycle_stage, r.confidence, r.tradeable, r.reason_not_tradeable,
        r.catalyst_level, r.volume_state, r.price_structure,
        r.rvol, r.gap_percent, r.change_percent, r.has_earnings,
      ],
      { label: 'premarket.upsert', timeoutMs: 5000, poolType: 'write' }
    );
  }
}

// ── Main function ─────────────────────────────────────────────────────────────

let running = false;
let lastReport = null;

async function runPremarketIntelligenceEngine() {
  if (running) {
    console.log('[PREMARKET] already running — skipping');
    return lastReport;
  }
  running = true;
  const startedAt = Date.now();

  try {
    await ensurePremarketTable();

    const symbols = await buildCandidateSymbols();
    console.log(`[PREMARKET] candidates: ${symbols.length} symbols`);

    if (symbols.length === 0) {
      lastReport = { status: 'NO_DATA', symbols_processed: 0, reason: 'No candidates from news, earnings, or metrics' };
      return lastReport;
    }

    const { metrics, news, earnings } = await fetchCandidateData(symbols);

    // Index by symbol for fast lookup
    const metricsBySymbol = new Map(metrics.map(m => [m.symbol, m]));
    const newsBySymbol = new Map();
    for (const n of news) {
      if (!newsBySymbol.has(n.symbol)) newsBySymbol.set(n.symbol, []);
      newsBySymbol.get(n.symbol).push(n);
    }
    const earningsBySymbol = new Set(earnings.map(e => e.symbol));

    const results = [];
    const rejected = [];

    for (const symbol of symbols) {
      const m = metricsBySymbol.get(symbol);
      const symbolNews = newsBySymbol.get(symbol) || [];
      const hasEarnings = earningsBySymbol.has(symbol);

      // Skip if absolutely no data
      if (!m && symbolNews.length === 0 && !hasEarnings) {
        rejected.push({ symbol, reason: 'no_data_in_any_source' });
        continue;
      }

      const catalystScore = classifyCatalystScore(symbolNews);
      const volumeState = classifyVolumeState(m);
      const priceStructure = classifyPriceStructure(m);
      const lifecycle = classifyLifecycle({ metrics: m, catalystScore, volumeState });
      const confidence = computeConfidence({ metrics: m, catalystScore, hasEarnings, volumeState });
      const catalystSummary = buildCatalystSummary(symbolNews, hasEarnings);
      const { tradeable, reason: reasonNotTradeable } = buildTradeabilityVerdict(lifecycle, confidence, m);

      results.push({
        symbol,
        catalyst_summary:      catalystSummary,
        news_count_72h:        symbolNews.length,
        latest_news_ts:        catalystScore.latest_ts,
        lifecycle_stage:       lifecycle,
        confidence,
        tradeable,
        reason_not_tradeable:  reasonNotTradeable,
        catalyst_level:        catalystScore.level,
        volume_state:          volumeState,
        price_structure:       priceStructure,
        rvol:                  asNum(m?.relative_volume),
        gap_percent:           asNum(m?.gap_percent),
        change_percent:        asNum(m?.change_percent),
        has_earnings:          hasEarnings,
      });
    }

    await upsertResults(results);

    const lifecycleDist = {};
    for (const r of results) {
      lifecycleDist[r.lifecycle_stage] = (lifecycleDist[r.lifecycle_stage] || 0) + 1;
    }
    const avgConf = results.length
      ? Math.round(results.reduce((s, r) => s + r.confidence, 0) / results.length)
      : 0;

    const durationMs = Date.now() - startedAt;
    console.log(`[PREMARKET] done: processed=${results.length} rejected=${rejected.length} avg_conf=${avgConf} duration_ms=${durationMs}`);
    console.log('[PREMARKET] lifecycle:', JSON.stringify(lifecycleDist));

    lastReport = {
      status: 'OK',
      symbols_processed: results.length,
      symbols_rejected: rejected.length,
      avg_confidence: avgConf,
      lifecycle_distribution: lifecycleDist,
      duration_ms: durationMs,
      top5: results
        .filter(r => r.tradeable)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 5)
        .map(r => ({
          symbol: r.symbol,
          confidence: r.confidence,
          lifecycle_stage: r.lifecycle_stage,
          catalyst_summary: r.catalyst_summary,
        })),
    };
    return lastReport;

  } catch (err) {
    console.error('[PREMARKET ERROR]', err.message);
    lastReport = { status: 'ERROR', error: err.message };
    return lastReport;
  } finally {
    running = false;
  }
}

function getLastPremarketReport() {
  return lastReport;
}

module.exports = {
  runPremarketIntelligenceEngine,
  getLastPremarketReport,
};
