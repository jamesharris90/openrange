CREATE EXTENSION IF NOT EXISTS pgcrypto;

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
);

CREATE OR REPLACE FUNCTION set_fmp_endpoint_registry_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fmp_endpoint_registry_updated_at ON fmp_endpoint_registry;
CREATE TRIGGER trg_fmp_endpoint_registry_updated_at
BEFORE UPDATE ON fmp_endpoint_registry
FOR EACH ROW
EXECUTE FUNCTION set_fmp_endpoint_registry_updated_at();

INSERT INTO fmp_endpoint_registry (
  endpoint_key,
  endpoint_url,
  endpoint_family,
  purpose,
  job_name,
  method,
  query_template,
  plan_required,
  notes
) VALUES
(
  'stable_quote',
  'https://financialmodelingprep.com/stable/quote',
  'stable',
  'single_symbol_quote',
  'quote_lookup',
  'GET',
  '{"symbol":"AAPL"}'::jsonb,
  'stable',
  'Use for one symbol spot quote checks. Do not use for broad watchlists where batch endpoints are more efficient.'
),
(
  'stable_quote_short',
  'https://financialmodelingprep.com/stable/quote-short',
  'stable',
  'single_symbol_quote_short',
  'quote_lookup_short',
  'GET',
  '{"symbol":"AAPL"}'::jsonb,
  'stable',
  'Use for low-latency quote snapshots when only price and small core fields are needed. Do not use when full quote context is required.'
),
(
  'stable_batch_quote',
  'https://financialmodelingprep.com/stable/batch-quote',
  'stable',
  'multi_symbol_quotes',
  'watchlist_and_market_snapshot',
  'GET',
  '{"symbols":"AAPL,MSFT,NVDA,SPY,QQQ"}'::jsonb,
  'stable',
  'Primary batch quote source for universe snapshots. Do not use for exchange-wide scans if endpoint limits are reached.'
),
(
  'stable_batch_quote_short',
  'https://financialmodelingprep.com/stable/batch-quote-short',
  'stable',
  'multi_symbol_quote_short',
  'lightweight_quote_snapshot',
  'GET',
  '{"symbols":"AAPL,MSFT,NVDA,SPY,QQQ"}'::jsonb,
  'stable',
  'Use when performance is favored over full contract richness. Do not use when downstream fields require full quote payloads.'
),
(
  'stable_aftermarket_trade',
  'https://financialmodelingprep.com/stable/aftermarket-trade',
  'stable',
  'single_symbol_afterhours_trade',
  'premarket_and_afterhours_signal_enrichment',
  'GET',
  '{"symbol":"AAPL"}'::jsonb,
  'stable',
  'Use for single symbol pre/post market last-trade context. Do not use as the primary regular-session quote endpoint.'
),
(
  'stable_aftermarket_quote',
  'https://financialmodelingprep.com/stable/aftermarket-quote',
  'stable',
  'single_symbol_afterhours_quote',
  'premarket_and_afterhours_signal_enrichment',
  'GET',
  '{"symbol":"AAPL"}'::jsonb,
  'stable',
  'Use for afterhours quote context per symbol. Do not use for portfolio-sized scans where batch aftermarket endpoints are available.'
),
(
  'stable_batch_aftermarket_trade',
  'https://financialmodelingprep.com/stable/batch-aftermarket-trade',
  'stable',
  'multi_symbol_afterhours_trade',
  'premarket_gap_and_afterhours_scan',
  'GET',
  '{"symbols":"AAPL,MSFT,NVDA"}'::jsonb,
  'stable',
  'Use for bulk afterhours trade snapshots. Do not use during regular session as replacement for batch-quote endpoints.'
),
(
  'stable_batch_aftermarket_quote',
  'https://financialmodelingprep.com/stable/batch-aftermarket-quote',
  'stable',
  'multi_symbol_afterhours_quote',
  'premarket_gap_and_afterhours_scan',
  'GET',
  '{"symbols":"AAPL,MSFT,NVDA"}'::jsonb,
  'stable',
  'Preferred bulk endpoint for premarket/afterhours quote scanning. Do not use for full-day historical bars.'
),
(
  'stable_stock_price_change',
  'https://financialmodelingprep.com/stable/stock-price-change',
  'stable',
  'multi_horizon_price_change',
  'momentum_and_context_enrichment',
  'GET',
  '{"symbol":"AAPL"}'::jsonb,
  'stable',
  'Use for multi-horizon percent-change enrichment. Do not use for candlestick-level charting.'
),
(
  'stable_batch_exchange_quote',
  'https://financialmodelingprep.com/stable/batch-exchange-quote',
  'stable',
  'exchange_wide_quotes',
  'universe_snapshot_and_market_breadth',
  'GET',
  '{"exchange":"NASDAQ","short":"true"}'::jsonb,
  'stable',
  'Use for exchange-wide snapshots and breadth calculations. Do not use when strict universe filters require screener fields.'
),
(
  'stable_stock_screener',
  'https://financialmodelingprep.com/stable/stock-screener',
  'stable',
  'universe_builder_and_filter_engine',
  'tradable_universe_builder',
  'GET',
  '{"exchange":"NASDAQ","limit":"100"}'::jsonb,
  'stable',
  'Primary endpoint for tradable universe construction. Do not assume unsupported filter params; validator must confirm contract first.'
),
(
  'stable_market_gainers',
  'https://financialmodelingprep.com/stable/market-gainers',
  'stable',
  'top_gainers_list',
  'premarket_and_open_movers',
  'GET',
  '{}'::jsonb,
  'stable',
  'Use for direct top-gainers lists. Do not use as sole mover source if endpoint is unavailable; fall back to computed movers.'
),
(
  'stable_market_losers',
  'https://financialmodelingprep.com/stable/market-losers',
  'stable',
  'top_losers_list',
  'premarket_and_open_movers',
  'GET',
  '{}'::jsonb,
  'stable',
  'Use for direct top-losers lists. Do not use as sole mover source if endpoint is unavailable; fall back to computed movers.'
),
(
  'stable_market_most_active',
  'https://financialmodelingprep.com/stable/market-actives',
  'stable',
  'most_active_list',
  'active_volume_scan',
  'GET',
  '{}'::jsonb,
  'stable',
  'Use for most-active volume scans. Do not use as a replacement for liquidity filtering logic in universe construction.'
),
(
  'stable_stock_news',
  'https://financialmodelingprep.com/stable/news/stock',
  'stable',
  'stock_news',
  'catalyst_news_ingestion',
  'GET',
  '{"symbol":"AAPL","limit":"50"}'::jsonb,
  'stable',
  'Preferred stock-news feed for catalyst ingestion. Do not use if symbol parameter contract fails validation.'
),
(
  'stable_press_releases',
  'https://financialmodelingprep.com/stable/news/press-releases',
  'stable',
  'press_releases',
  'catalyst_press_release_ingestion',
  'GET',
  '{"symbol":"AAPL","limit":"50"}'::jsonb,
  'stable',
  'Use as press-release catalyst feed and backup to stock news. Do not assume stock-news-like fields unless validated.'
),
(
  'stable_earnings_calendar',
  'https://financialmodelingprep.com/stable/earnings-calendar',
  'stable',
  'earnings_calendar',
  'earnings_ingestion',
  'GET',
  '{"from":"2026-03-23","to":"2026-03-30"}'::jsonb,
  'stable',
  'Use for earnings event ingestion with bounded date windows. Do not query unbounded historical ranges in hot-path jobs.'
),
(
  'stable_historical_chart_1min',
  'https://financialmodelingprep.com/stable/historical-chart/1min',
  'stable',
  'intraday_chart_data',
  'chart_ingestion_1m',
  'GET',
  '{"symbol":"AAPL"}'::jsonb,
  'stable',
  'Use for intraday 1-minute bars. Do not use for daily EOD ingestion where dedicated EOD endpoint exists.'
),
(
  'stable_historical_price_eod',
  'https://financialmodelingprep.com/stable/historical-price-eod/full',
  'stable',
  'daily_eod_data',
  'daily_ohlc_ingestion',
  'GET',
  '{"symbol":"AAPL"}'::jsonb,
  'stable',
  'Use for daily OHLC/EOD history. Do not use for real-time quote updates or intraday chart refreshes.'
)
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
  updated_at = NOW();
