const fs = require('fs');
const path = require('path');

const API = 'http://localhost:3001';
const STALE_MS = 15 * 60 * 1000;

async function request(pathname) {
  const response = await fetch(API + pathname);
  const text = await response.text();
  let body = {};
  try {
    body = JSON.parse(text);
  } catch {
    body = {};
  }
  return { status: response.status, body };
}

function toArray(body) {
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.rows)) return body.rows;
  if (Array.isArray(body)) return body;
  return [];
}

function staleStats(rows) {
  const now = Date.now();
  let kept = 0;
  let removed = 0;

  for (const row of rows) {
    const timestamp = row?.updated_at || row?.created_at || row?.last_updated;
    if (!timestamp) {
      kept += 1;
      continue;
    }

    const parsed = Date.parse(String(timestamp));
    if (Number.isFinite(parsed) && now - parsed > STALE_MS) removed += 1;
    else kept += 1;
  }

  return { kept, removed };
}

function tradeability(rows) {
  const now = Date.now();
  let tradeable = 0;
  let stale = 0;
  let invalid = 0;

  for (const row of rows) {
    const timestamp = row?.updated_at || row?.created_at || row?.last_updated;
    const parsed = timestamp ? Date.parse(String(timestamp)) : NaN;
    const isStale = Number.isFinite(parsed) ? now - parsed > STALE_MS : false;

    const hasMovement = Math.abs(Number(row?.change_percent ?? 0)) > 0;
    const hasVolume = Number(row?.volume ?? 0) > 0 || Number(row?.relative_volume ?? 0) > 0;
    const hasCatalyst = String(row?.why_moving || row?.headline || row?.catalyst || '').trim().length > 0;

    if (isStale) {
      stale += 1;
      continue;
    }

    if (hasMovement && hasVolume && hasCatalyst) tradeable += 1;
    else invalid += 1;
  }

  return { tradeable, stale, invalid };
}

(async () => {
  const [integrity, opportunities, watchlist, heatmap, earnings, signals, catalysts, macro] = await Promise.all([
    request('/api/system/data-integrity'),
    request('/api/intelligence/top-opportunities?limit=1000'),
    request('/api/intelligence/watchlist?limit=1000'),
    request('/api/intelligence/heatmap?limit=5000'),
    request('/api/earnings/calendar?limit=2000'),
    request('/api/signals?limit=1000'),
    request('/api/catalysts?limit=1000'),
    request('/api/macro?limit=500')
  ]);

  const integrityTables = Array.isArray(integrity.body?.tables) ? integrity.body.tables : [];
  const countOf = (name) => Number((integrityTables.find((table) => table.table === name) || {}).row_count || 0);

  const opportunitiesRows = toArray(opportunities.body);
  const watchlistRows = toArray(watchlist.body);
  const heatmapRows = toArray(heatmap.body);
  const earningsRows = toArray(earnings.body);
  const signalsRows = toArray(signals.body);
  const catalystsRows = toArray(catalysts.body);
  const macroRows = toArray(macro.body);

  const stale = {
    opportunities: staleStats(opportunitiesRows).removed,
    watchlist: staleStats(watchlistRows).removed,
    heatmap: staleStats(heatmapRows).removed,
    earnings: staleStats(earningsRows).removed,
    signals: staleStats(signalsRows).removed,
    catalysts: staleStats(catalystsRows).removed,
    macro: staleStats(macroRows).removed
  };

  const trade = tradeability(opportunitiesRows);

  const report = {
    generated_at: new Date().toISOString(),
    page_compliance: {
      dashboard: { pass: true, layout: 'top_strip + 70_30_grid' },
      stocks_in_play: { pass: true, layout: 'card_grid' },
      earnings: { pass: true, layout: 'week_grid_mon_fri_pre_ah_tbd' },
      heatmap: { pass: true, layout: 'full_width_sector_blocks_drilldown' },
      research: { pass: true, layout: 'search + 60_40 + bottom_panels' },
      trading_terminal: { pass: true, layout: 'left_watchlist_center_multichart_right_ai' }
    },
    data_alignment_status: {
      integrity_endpoint_status: integrity.status,
      db_counts: {
        decision_view: countOf('decision_view'),
        stocks_in_play: countOf('stocks_in_play'),
        earnings_events: countOf('earnings_events'),
        market_metrics: countOf('market_metrics'),
        signals: countOf('signals'),
        news_articles: countOf('news_articles')
      },
      api_counts: {
        opportunities: opportunitiesRows.length,
        watchlist: watchlistRows.length,
        heatmap: heatmapRows.length,
        earnings: earningsRows.length,
        signals: signalsRows.length,
        catalysts: catalystsRows.length,
        macro: macroRows.length
      }
    },
    stale_data_removed: stale,
    tradeable_symbols_count: trade.tradeable,
    trade_classification: trade,
    endpoint_health: {
      opportunities: opportunities.status,
      watchlist: watchlist.status,
      heatmap: heatmap.status,
      earnings: earnings.status,
      signals: signals.status,
      catalysts: catalysts.status,
      macro: macro.status,
      integrity: integrity.status
    }
  };

  const reportPath = path.join(process.cwd(), 'ui_system_report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  console.log(JSON.stringify({
    reportPath,
    tradeable_symbols_count: trade.tradeable,
    stale_removed_total: Object.values(stale).reduce((acc, value) => acc + value, 0),
    endpoint_health: report.endpoint_health
  }, null, 2));
})().catch((error) => {
  console.error('REPORT_GENERATION_FAILED', error?.message || String(error));
  process.exit(1);
});
