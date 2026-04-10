const fs = require('fs');
const path = require('path');
require('/Users/jamesharris/Server/server/node_modules/dotenv').config({ path: '/Users/jamesharris/Server/server/.env' });
const { Pool } = require('/Users/jamesharris/Server/server/node_modules/pg');

function uniq(arr) { return [...new Set(arr.filter(Boolean))]; }
function pct(n, d) { return d > 0 ? Number(((n / d) * 100).toFixed(2)) : 0; }

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      ...(process.env.PROXY_API_KEY ? { 'x-api-key': process.env.PROXY_API_KEY } : {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

(async () => {
  const outPath = '/Users/jamesharris/Server/logs/prep_diagnostics.json';
  const apiBase = process.env.API_BASE || 'http://localhost:3016';
  const pool = new Pool({ connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.DB_URL });

  const report = {
    ts: new Date().toISOString(),
    watchlist_distribution: {},
    earnings_coverage: {},
    news_coverage: {},
    large_move_coverage: {},
    root_causes: [],
    verdict: 'OK',
  };

  try {
    const watchResp = await fetchJson(`${apiBase}/api/intelligence/watchlist?limit=100`);
    const watchRows = Array.isArray(watchResp.body?.data) ? watchResp.body.data : [];
    const totalWatch = watchRows.length;
    const reasonCounts = {};
    for (const row of watchRows) {
      const reason = String(row?.watch_reason || 'UNKNOWN');
      reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
    }
    const distribution = {};
    for (const [reason, count] of Object.entries(reasonCounts)) {
      distribution[reason] = { count, percent: pct(count, totalWatch) };
    }

    report.watchlist_distribution = {
      endpoint_status: watchResp.status,
      total_watchlist: totalWatch,
      by_reason: distribution,
    };

    const watchSymbols = uniq(watchRows.map((r) => String(r?.symbol || '').trim().toUpperCase()));

    const earningsTotalRes = await pool.query(
      `SELECT COUNT(*)::int AS n
       FROM earnings_events
       WHERE report_date BETWEEN NOW() AND NOW() + INTERVAL '3 days'`
    );

    const earningsSymbolsRes = await pool.query(
      `SELECT DISTINCT UPPER(symbol) AS symbol
       FROM earnings_events
       WHERE report_date BETWEEN NOW() AND NOW() + INTERVAL '3 days'
         AND symbol IS NOT NULL`
    );
    const earningsSymbols = uniq((earningsSymbolsRes.rows || []).map((r) => r.symbol));

    let earningsInDecision = 0;
    if (earningsSymbols.length) {
      const inDecision = await pool.query(
        `SELECT COUNT(DISTINCT UPPER(symbol))::int AS n
         FROM decision_view
         WHERE UPPER(symbol) = ANY($1::text[])`,
        [earningsSymbols]
      );
      earningsInDecision = Number(inDecision.rows?.[0]?.n || 0);
    }

    const earningsInWatch = earningsSymbols.filter((s) => watchSymbols.includes(s)).length;

    report.earnings_coverage = {
      earnings_symbols_total: earningsSymbols.length,
      earnings_events_rows_total: Number(earningsTotalRes.rows?.[0]?.n || 0),
      earnings_in_decision_view: earningsInDecision,
      earnings_in_watchlist: earningsInWatch,
      earnings_in_watchlist_percent: pct(earningsInWatch, earningsSymbols.length),
    };

    const newsRowsTotalRes = await pool.query(
      `SELECT COUNT(*)::int AS n
       FROM news_articles
       WHERE COALESCE(published_at, created_at) > NOW() - INTERVAL '6 hours'`
    );

    const newsSymbolsRes = await pool.query(
      `WITH direct AS (
         SELECT UPPER(symbol) AS symbol
         FROM news_articles
         WHERE symbol IS NOT NULL
           AND COALESCE(published_at, created_at) > NOW() - INTERVAL '6 hours'
       ), arr AS (
         SELECT UPPER(sym) AS symbol
         FROM news_articles
         CROSS JOIN LATERAL unnest(COALESCE(symbols, ARRAY[]::text[])) AS sym
         WHERE COALESCE(published_at, created_at) > NOW() - INTERVAL '6 hours'
       )
       SELECT DISTINCT symbol
       FROM (
         SELECT symbol FROM direct
         UNION ALL
         SELECT symbol FROM arr
       ) q
       WHERE symbol IS NOT NULL`
    );

    const newsSymbols = uniq((newsSymbolsRes.rows || []).map((r) => r.symbol));

    let newsInSignals = 0;
    let newsInDecision = 0;
    if (newsSymbols.length) {
      const inSignals = await pool.query(
        `SELECT COUNT(DISTINCT UPPER(symbol))::int AS n
         FROM signals
         WHERE UPPER(symbol) = ANY($1::text[])`,
        [newsSymbols]
      );
      const inDecision = await pool.query(
        `SELECT COUNT(DISTINCT UPPER(symbol))::int AS n
         FROM decision_view
         WHERE UPPER(symbol) = ANY($1::text[])`,
        [newsSymbols]
      );
      newsInSignals = Number(inSignals.rows?.[0]?.n || 0);
      newsInDecision = Number(inDecision.rows?.[0]?.n || 0);
    }

    const newsInWatch = newsSymbols.filter((s) => watchSymbols.includes(s)).length;

    report.news_coverage = {
      news_rows_last_6h: Number(newsRowsTotalRes.rows?.[0]?.n || 0),
      news_symbols_total: newsSymbols.length,
      news_in_signals: newsInSignals,
      news_in_decision_view: newsInDecision,
      news_in_watchlist: newsInWatch,
      news_in_watchlist_percent: pct(newsInWatch, newsSymbols.length),
    };

    const largeMoveRes = await pool.query(
      `SELECT DISTINCT UPPER(symbol) AS symbol
       FROM market_metrics
       WHERE symbol IS NOT NULL
         AND ABS(COALESCE(change_percent, 0)) >= 4`
    );
    const largeMoveSymbols = uniq((largeMoveRes.rows || []).map((r) => r.symbol));
    const largeMoveInWatch = largeMoveSymbols.filter((s) => watchSymbols.includes(s)).length;

    report.large_move_coverage = {
      large_move_symbols_total: largeMoveSymbols.length,
      large_move_in_watchlist: largeMoveInWatch,
      large_move_in_watchlist_percent: pct(largeMoveInWatch, largeMoveSymbols.length),
    };

    const reasons = Object.keys(reasonCounts);
    if (reasons.length === 1 && reasons[0] === 'HIGH_VOLATILITY') {
      report.root_causes.push('Only HIGH_VOLATILITY currently triggers in watchlist output.');
    }
    if (report.earnings_coverage.earnings_symbols_total > 0 && report.earnings_coverage.earnings_in_watchlist === 0) {
      report.root_causes.push('Upcoming earnings symbols are not entering watchlist.');
    }
    if (report.news_coverage.news_symbols_total > 0 && report.news_coverage.news_in_watchlist === 0) {
      report.root_causes.push('Recent news symbols are not entering watchlist.');
    }
    if (report.large_move_coverage.large_move_symbols_total > 0 && report.large_move_coverage.large_move_in_watchlist === 0) {
      report.root_causes.push('Large move symbols are not overlapping with watchlist candidates.');
    }
    if (!watchResp.ok) {
      report.root_causes.push(`Watchlist endpoint non-200: ${watchResp.status}`);
    }

    if (report.root_causes.length > 0) {
      report.verdict = 'DATA GAP';
    }

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

    console.log(JSON.stringify({ outPath, apiBase, verdict: report.verdict, root_causes: report.root_causes }, null, 2));
    console.log('PREP DIAGNOSTICS COMPLETE');
  } catch (error) {
    report.verdict = 'DATA GAP';
    report.root_causes.push(`Diagnostics execution error: ${error.message}`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ outPath, verdict: report.verdict, error: error.message }, null, 2));
    console.log('PREP DIAGNOSTICS COMPLETE');
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
  }
})();
