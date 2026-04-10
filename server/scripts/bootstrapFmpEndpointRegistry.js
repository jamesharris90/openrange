require('dotenv').config({ path: require('path').join(__dirname, '..', '.env'), override: true });

const pool = require('../db/pool');

const rows = [
  {
    endpoint_key: 'stable_quote',
    endpoint_url: 'https://financialmodelingprep.com/stable/quote',
    endpoint_family: 'stable',
    purpose: 'single_symbol_quote',
    job_name: 'quote_lookup',
    query_template: { symbol: 'AAPL' },
    plan_required: 'stable',
    notes: 'Use for one symbol spot quote checks. Do not use for broad watchlists where batch endpoints are more efficient.'
  },
  {
    endpoint_key: 'stable_quote_short',
    endpoint_url: 'https://financialmodelingprep.com/stable/quote-short',
    endpoint_family: 'stable',
    purpose: 'single_symbol_quote_short',
    job_name: 'quote_lookup_short',
    query_template: { symbol: 'AAPL' },
    plan_required: 'stable',
    notes: 'Use for low-latency quote snapshots when only price and small core fields are needed. Do not use when full quote context is required.'
  },
  {
    endpoint_key: 'stable_batch_quote',
    endpoint_url: 'https://financialmodelingprep.com/stable/batch-quote',
    endpoint_family: 'stable',
    purpose: 'multi_symbol_quotes',
    job_name: 'watchlist_and_market_snapshot',
    query_template: { symbols: 'AAPL,MSFT,NVDA,SPY,QQQ' },
    plan_required: 'stable',
    notes: 'Primary batch quote source for universe snapshots. Do not use for exchange-wide scans if endpoint limits are reached.'
  },
  {
    endpoint_key: 'stable_batch_quote_short',
    endpoint_url: 'https://financialmodelingprep.com/stable/batch-quote-short',
    endpoint_family: 'stable',
    purpose: 'multi_symbol_quote_short',
    job_name: 'lightweight_quote_snapshot',
    query_template: { symbols: 'AAPL,MSFT,NVDA,SPY,QQQ' },
    plan_required: 'stable',
    notes: 'Use when performance is favored over full contract richness. Do not use when downstream fields require full quote payloads.'
  },
  {
    endpoint_key: 'stable_aftermarket_trade',
    endpoint_url: 'https://financialmodelingprep.com/stable/aftermarket-trade',
    endpoint_family: 'stable',
    purpose: 'single_symbol_afterhours_trade',
    job_name: 'premarket_and_afterhours_signal_enrichment',
    query_template: { symbol: 'AAPL' },
    plan_required: 'stable',
    notes: 'Use for single symbol pre/post market last-trade context. Do not use as the primary regular-session quote endpoint.'
  },
  {
    endpoint_key: 'stable_aftermarket_quote',
    endpoint_url: 'https://financialmodelingprep.com/stable/aftermarket-quote',
    endpoint_family: 'stable',
    purpose: 'single_symbol_afterhours_quote',
    job_name: 'premarket_and_afterhours_signal_enrichment',
    query_template: { symbol: 'AAPL' },
    plan_required: 'stable',
    notes: 'Use for afterhours quote context per symbol. Do not use for portfolio-sized scans where batch aftermarket endpoints are available.'
  },
  {
    endpoint_key: 'stable_batch_aftermarket_trade',
    endpoint_url: 'https://financialmodelingprep.com/stable/batch-aftermarket-trade',
    endpoint_family: 'stable',
    purpose: 'multi_symbol_afterhours_trade',
    job_name: 'premarket_gap_and_afterhours_scan',
    query_template: { symbols: 'AAPL,MSFT,NVDA' },
    plan_required: 'stable',
    notes: 'Use for bulk afterhours trade snapshots. Do not use during regular session as replacement for batch-quote endpoints.'
  },
  {
    endpoint_key: 'stable_batch_aftermarket_quote',
    endpoint_url: 'https://financialmodelingprep.com/stable/batch-aftermarket-quote',
    endpoint_family: 'stable',
    purpose: 'multi_symbol_afterhours_quote',
    job_name: 'premarket_gap_and_afterhours_scan',
    query_template: { symbols: 'AAPL,MSFT,NVDA' },
    plan_required: 'stable',
    notes: 'Preferred bulk endpoint for premarket/afterhours quote scanning. Do not use for full-day historical bars.'
  },
  {
    endpoint_key: 'stable_stock_price_change',
    endpoint_url: 'https://financialmodelingprep.com/stable/stock-price-change',
    endpoint_family: 'stable',
    purpose: 'multi_horizon_price_change',
    job_name: 'momentum_and_context_enrichment',
    query_template: { symbol: 'AAPL' },
    plan_required: 'stable',
    notes: 'Use for multi-horizon percent-change enrichment. Do not use for candlestick-level charting.'
  },
  {
    endpoint_key: 'stable_batch_exchange_quote',
    endpoint_url: 'https://financialmodelingprep.com/stable/batch-exchange-quote',
    endpoint_family: 'stable',
    purpose: 'exchange_wide_quotes',
    job_name: 'universe_snapshot_and_market_breadth',
    query_template: { exchange: 'NASDAQ', short: 'true' },
    plan_required: 'stable',
    notes: 'Use for exchange-wide snapshots and breadth calculations. Do not use when strict universe filters require screener fields.'
  },
  {
    endpoint_key: 'stable_stock_screener',
    endpoint_url: 'https://financialmodelingprep.com/stable/stock-screener',
    endpoint_family: 'stable',
    purpose: 'universe_builder_and_filter_engine',
    job_name: 'tradable_universe_builder',
    query_template: { exchange: 'NASDAQ', limit: '100' },
    plan_required: 'stable',
    notes: 'Primary endpoint for tradable universe construction. Do not assume unsupported filter params; validator must confirm contract first.'
  },
  {
    endpoint_key: 'stable_market_gainers',
    endpoint_url: 'https://financialmodelingprep.com/stable/market-gainers',
    endpoint_family: 'stable',
    purpose: 'top_gainers_list',
    job_name: 'premarket_and_open_movers',
    query_template: {},
    plan_required: 'stable',
    notes: 'Use for direct top-gainers lists. Do not use as sole mover source if endpoint is unavailable; fall back to computed movers.'
  },
  {
    endpoint_key: 'stable_market_losers',
    endpoint_url: 'https://financialmodelingprep.com/stable/market-losers',
    endpoint_family: 'stable',
    purpose: 'top_losers_list',
    job_name: 'premarket_and_open_movers',
    query_template: {},
    plan_required: 'stable',
    notes: 'Use for direct top-losers lists. Do not use as sole mover source if endpoint is unavailable; fall back to computed movers.'
  },
  {
    endpoint_key: 'stable_market_most_active',
    endpoint_url: 'https://financialmodelingprep.com/stable/market-actives',
    endpoint_family: 'stable',
    purpose: 'most_active_list',
    job_name: 'active_volume_scan',
    query_template: {},
    plan_required: 'stable',
    notes: 'Use for most-active volume scans. Do not use as a replacement for liquidity filtering logic in universe construction.'
  },
  {
    endpoint_key: 'stable_stock_news',
    endpoint_url: 'https://financialmodelingprep.com/stable/news/stock',
    endpoint_family: 'stable',
    purpose: 'stock_news',
    job_name: 'catalyst_news_ingestion',
    query_template: { symbol: 'AAPL', limit: '50' },
    plan_required: 'stable',
    notes: 'Preferred stock-news feed for catalyst ingestion. Do not use if symbol parameter contract fails validation.'
  },
  {
    endpoint_key: 'stable_press_releases',
    endpoint_url: 'https://financialmodelingprep.com/stable/news/press-releases',
    endpoint_family: 'stable',
    purpose: 'press_releases',
    job_name: 'catalyst_press_release_ingestion',
    query_template: { symbol: 'AAPL', limit: '50' },
    plan_required: 'stable',
    notes: 'Use as press-release catalyst feed and backup to stock news. Do not assume stock-news-like fields unless validated.'
  },
  {
    endpoint_key: 'stable_earnings_calendar',
    endpoint_url: 'https://financialmodelingprep.com/stable/earnings-calendar',
    endpoint_family: 'stable',
    purpose: 'earnings_calendar',
    job_name: 'earnings_ingestion',
    query_template: { from: '2026-03-23', to: '2026-03-30' },
    plan_required: 'stable',
    notes: 'Use for earnings event ingestion with bounded date windows. Do not query unbounded historical ranges in hot-path jobs.'
  },
  {
    endpoint_key: 'stable_historical_chart_1min',
    endpoint_url: 'https://financialmodelingprep.com/stable/historical-chart/1min',
    endpoint_family: 'stable',
    purpose: 'intraday_chart_data',
    job_name: 'chart_ingestion_1m',
    query_template: { symbol: 'AAPL' },
    plan_required: 'stable',
    notes: 'Use for intraday 1-minute bars. Do not use for daily EOD ingestion where dedicated EOD endpoint exists.'
  },
  {
    endpoint_key: 'stable_historical_price_eod',
    endpoint_url: 'https://financialmodelingprep.com/stable/historical-price-eod/full',
    endpoint_family: 'stable',
    purpose: 'daily_eod_data',
    job_name: 'daily_ohlc_ingestion',
    query_template: { symbol: 'AAPL' },
    plan_required: 'stable',
    notes: 'Use for daily OHLC/EOD history. Do not use for real-time quote updates or intraday chart refreshes.'
  }
];

async function main() {
  await pool.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fmp_endpoint_registry (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      endpoint_key TEXT UNIQUE NOT NULL,
      endpoint_url TEXT NOT NULL,
      endpoint_family TEXT NOT NULL,
      purpose TEXT NOT NULL,
      job_name TEXT NOT NULL,
      method TEXT NOT NULL DEFAULT 'GET',
      query_template JSONB NOT NULL DEFAULT '{}'::jsonb,
      response_contract JSONB,
      plan_required TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      validation_status TEXT NOT NULL DEFAULT 'unvalidated',
      last_validated_at TIMESTAMPTZ,
      last_http_status INTEGER,
      last_error TEXT,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE OR REPLACE FUNCTION set_fmp_endpoint_registry_updated_at()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);

  await pool.query(`
    DROP TRIGGER IF EXISTS trg_fmp_endpoint_registry_updated_at ON fmp_endpoint_registry
  `);

  await pool.query(`
    CREATE TRIGGER trg_fmp_endpoint_registry_updated_at
    BEFORE UPDATE ON fmp_endpoint_registry
    FOR EACH ROW
    EXECUTE FUNCTION set_fmp_endpoint_registry_updated_at()
  `);

  for (const row of rows) {
    await pool.query(
      `
      INSERT INTO fmp_endpoint_registry (
        endpoint_key, endpoint_url, endpoint_family, purpose, job_name, method,
        query_template, plan_required, notes
      ) VALUES ($1,$2,$3,$4,$5,'GET',$6::jsonb,$7,$8)
      ON CONFLICT (endpoint_key)
      DO UPDATE SET
        endpoint_url = EXCLUDED.endpoint_url,
        endpoint_family = EXCLUDED.endpoint_family,
        purpose = EXCLUDED.purpose,
        job_name = EXCLUDED.job_name,
        method = EXCLUDED.method,
        query_template = EXCLUDED.query_template,
        plan_required = EXCLUDED.plan_required,
        notes = EXCLUDED.notes,
        updated_at = NOW()
      `,
      [
        row.endpoint_key,
        row.endpoint_url,
        row.endpoint_family,
        row.purpose,
        row.job_name,
        JSON.stringify(row.query_template),
        row.plan_required,
        row.notes
      ]
    );
  }

  const seeded = await pool.query(`
    SELECT endpoint_key, endpoint_url, endpoint_family, purpose, job_name, method,
           query_template, plan_required, is_active, validation_status, notes,
           created_at, updated_at
    FROM fmp_endpoint_registry
    ORDER BY endpoint_key
  `);

  console.log(`Seeded rows: ${seeded.rows.length}`);
  await pool.end();
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
