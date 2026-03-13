# Database Alignment Report

Generated: 2026-03-12T08:15:22.318Z

## Database Overview
| metric | value |
| --- | --- |
| Total schema tables | 106 |
| Total schema views | 1 |
| Tables used by code | 45 |
| Unused schema tables | 61 |
| Schema drift issues | 122 |

## Table Usage Map
| table | read_ops | write_ops | api_endpoints | engines | schedulers |
| --- | --- | --- | --- | --- | --- |
| activity_log | 1 | 1 | 0 | 0 | 0 |
| alert_history | 2 | 1 | 1 | 0 | 0 |
| alerts | 0 | 0 | 0 | 0 | 0 |
| audit_log | 0 | 0 | 0 | 0 | 0 |
| broker_executions | 0 | 3 | 1 | 0 | 0 |
| chart_trends | 0 | 0 | 0 | 0 | 0 |
| company_profiles | 1 | 0 | 0 | 0 | 0 |
| daily_ohlc | 5 | 0 | 0 | 0 | 0 |
| daily_reviews | 4 | 4 | 1 | 0 | 1 |
| daily_signal_snapshot | 0 | 0 | 0 | 0 | 0 |
| data_integrity | 0 | 0 | 0 | 0 | 0 |
| data_integrity_events | 0 | 0 | 0 | 0 | 0 |
| discovered_symbols | 3 | 1 | 1 | 0 | 0 |
| dynamic_watchlist | 0 | 0 | 0 | 0 | 0 |
| early_accumulation_signals | 1 | 0 | 1 | 0 | 0 |
| early_signal_outcomes | 1 | 0 | 1 | 0 | 0 |
| earnings_events | 6 | 0 | 1 | 0 | 0 |
| earnings_market_reaction | 2 | 0 | 0 | 0 | 0 |
| earnings_scores | 1 | 0 | 0 | 0 | 0 |
| engine_errors | 0 | 0 | 0 | 0 | 0 |
| engine_runtime | 0 | 0 | 0 | 0 | 0 |
| engine_status | 0 | 0 | 0 | 0 | 0 |
| engine_telemetry | 0 | 0 | 0 | 0 | 0 |
| event_log | 0 | 0 | 0 | 0 | 0 |
| expected_moves | 0 | 0 | 0 | 0 | 0 |
| feature_access_audit | 0 | 0 | 0 | 0 | 0 |
| feature_audit | 0 | 0 | 0 | 0 | 0 |
| feature_flags | 0 | 0 | 0 | 0 | 0 |
| feature_overrides | 0 | 0 | 0 | 0 | 0 |
| feature_registry | 0 | 0 | 0 | 0 | 0 |
| feature_roles | 0 | 0 | 0 | 0 | 0 |
| flow_signals | 0 | 0 | 0 | 0 | 0 |
| ingestion_state | 1 | 5 | 0 | 0 | 0 |
| institutional_flow | 0 | 0 | 0 | 0 | 0 |
| integrity_events | 0 | 0 | 0 | 0 | 0 |
| intel_news | 1 | 1 | 0 | 1 | 0 |
| intelligence_briefs | 0 | 0 | 0 | 0 | 0 |
| intelligence_emails | 1 | 2 | 3 | 0 | 0 |
| intraday_1h | 0 | 0 | 0 | 0 | 0 |
| intraday_1m | 5 | 2 | 0 | 0 | 0 |
| intraday_ohlc | 0 | 0 | 0 | 0 | 0 |
| market_metrics | 16 | 1 | 4 | 2 | 0 |
| market_narratives | 1 | 1 | 1 | 0 | 0 |
| market_news | 0 | 0 | 0 | 0 | 0 |
| market_quotes | 2 | 1 | 1 | 1 | 0 |
| morning_briefings | 0 | 0 | 0 | 0 | 0 |
| news_articles | 4 | 3 | 1 | 2 | 0 |
| news_catalysts | 1 | 0 | 1 | 0 | 0 |
| news_events | 3 | 3 | 1 | 0 | 0 |
| newsletter_campaigns | 0 | 0 | 0 | 0 | 0 |
| newsletter_send_history | 0 | 0 | 0 | 0 | 0 |
| newsletter_sends | 0 | 0 | 0 | 0 | 0 |
| newsletter_subscribers | 0 | 0 | 0 | 0 | 0 |
| opportunities | 0 | 0 | 0 | 0 | 0 |
| opportunities_v2 | 0 | 0 | 0 | 0 | 0 |
| opportunity_stream | 0 | 0 | 0 | 0 | 0 |
| options_cache | 0 | 0 | 0 | 0 | 0 |
| order_flow_signals | 1 | 0 | 1 | 0 | 0 |
| plan_features | 0 | 0 | 0 | 0 | 0 |
| profiles | 1 | 0 | 0 | 0 | 0 |
| provider_health | 0 | 0 | 0 | 0 | 0 |
| qualified_signals | 0 | 0 | 0 | 0 | 0 |
| roles | 0 | 0 | 0 | 0 | 0 |
| scheduler_status | 0 | 0 | 0 | 0 | 0 |
| schema_migrations | 1 | 0 | 0 | 0 | 0 |
| sector_heatmap | 0 | 0 | 0 | 0 | 0 |
| sector_momentum | 1 | 0 | 1 | 0 | 0 |
| settings | 2 | 1 | 0 | 0 | 0 |
| signal_alerts | 0 | 0 | 0 | 0 | 0 |
| signal_behaviour | 0 | 0 | 0 | 0 | 0 |
| signal_catalysts | 1 | 1 | 0 | 1 | 0 |
| signal_component_outcomes | 0 | 0 | 0 | 0 | 0 |
| signal_engine_metrics | 0 | 0 | 0 | 0 | 0 |
| signal_hierarchy | 0 | 0 | 0 | 0 | 0 |
| signal_narratives | 2 | 2 | 0 | 2 | 0 |
| signal_outcomes | 0 | 0 | 0 | 0 | 0 |
| signal_performance | 1 | 1 | 1 | 1 | 0 |
| signal_weight_calibration | 0 | 0 | 0 | 0 | 0 |
| sparkline_cache | 0 | 0 | 0 | 0 | 0 |
| squeeze_signals | 0 | 0 | 0 | 0 | 0 |
| stocks_in_play | 1 | 0 | 1 | 0 | 0 |
| strategy_accuracy | 0 | 0 | 0 | 0 | 0 |
| strategy_learning | 0 | 0 | 0 | 0 | 0 |
| strategy_signals | 7 | 1 | 1 | 5 | 0 |
| strategy_trades | 0 | 0 | 0 | 0 | 0 |
| symbol_queue | 4 | 3 | 0 | 0 | 0 |
| system_alerts | 0 | 0 | 0 | 0 | 0 |
| system_events | 0 | 0 | 0 | 0 | 0 |
| ticker_universe | 5 | 1 | 1 | 0 | 0 |
| tier_feature_defaults | 0 | 0 | 0 | 0 | 0 |
| tradable_universe | 0 | 0 | 0 | 0 | 0 |
| trade_catalysts | 7 | 1 | 2 | 0 | 0 |
| trade_metadata | 3 | 1 | 0 | 0 | 0 |
| trade_setups | 9 | 1 | 3 | 0 | 0 |
| trade_signals | 0 | 0 | 0 | 0 | 0 |
| trade_tags | 1 | 2 | 0 | 0 | 0 |
| trades | 5 | 6 | 2 | 0 | 1 |
| usage_events | 6 | 4 | 0 | 0 | 0 |
| user_alerts | 3 | 3 | 4 | 0 | 0 |
| user_feature_access | 0 | 0 | 0 | 0 | 0 |
| user_preferences | 0 | 1 | 0 | 0 | 0 |
| user_presets | 3 | 5 | 0 | 0 | 0 |
| user_roles | 0 | 0 | 0 | 0 | 0 |
| user_signal_feedback | 0 | 0 | 0 | 0 | 0 |
| user_watchlists | 1 | 3 | 0 | 0 | 0 |
| users | 14 | 15 | 0 | 0 | 0 |

## Unused Tables
- alerts
- audit_log
- chart_trends
- daily_signal_snapshot
- data_integrity
- data_integrity_events
- dynamic_watchlist
- engine_errors
- engine_runtime
- engine_status
- engine_telemetry
- event_log
- expected_moves
- feature_access_audit
- feature_audit
- feature_flags
- feature_overrides
- feature_registry
- feature_roles
- flow_signals
- institutional_flow
- integrity_events
- intelligence_briefs
- intraday_1h
- intraday_ohlc
- market_news
- morning_briefings
- newsletter_campaigns
- newsletter_send_history
- newsletter_sends
- newsletter_subscribers
- opportunities
- opportunities_v2
- opportunity_stream
- options_cache
- plan_features
- provider_health
- qualified_signals
- roles
- scheduler_status
- sector_heatmap
- signal_alerts
- signal_behaviour
- signal_component_outcomes
- signal_engine_metrics
- signal_hierarchy
- signal_outcomes
- signal_weight_calibration
- sparkline_cache
- squeeze_signals
- strategy_accuracy
- strategy_learning
- strategy_trades
- system_alerts
- system_events
- tier_feature_defaults
- tradable_universe
- trade_signals
- user_feature_access
- user_roles
- user_signal_feedback

## Duplicate Tables
| table_a | table_b | a_used | b_used |
| --- | --- | --- | --- |
| opportunities | opportunities_v2 | false | false |
| market_news | news_articles | false | true |
| alerts | signal_alerts | false | false |
| trade_signals | strategy_signals | false | true |

## Schema Drift Issues
### Tables referenced in code but missing from database
| table |
| --- |
| all_candidates |
| atr_14 |
| avg_30_volume |
| catalyst_candidates |
| daily |
| earnings_candidates |
| information_schema.columns |
| information_schema.tables |
| intraday |
| jsonb_to_recordset |
| latest_catalyst |
| latest_daily |
| latest_intraday |
| metric_rows |
| published_at |
| rsi_daily |
| rsi_parts |
| setup_candidates |
| symbols |
| target_symbols |
| timestamp |
| true_range_rows |

### Columns queried in code but missing from database
| table | column | file | line | snippet |
| --- | --- | --- | --- | --- |
| news_articles | ai_analysis | server/engines/intelAnalysisEngine.js | 104 | UPDATE news_articles SET ai_analysis = $1 WHERE id = $2 |
| market_metrics | close | server/engines/mcpContextEngine.js | 14 | SELECT symbol, close, change_percent FROM market_metrics WHERE symbol IN ('SPY', 'QQQ', 'IWM', 'VIX') ORDER BY symbol |
| market_metrics | sector | server/engines/mcpContextEngine.js | 21 | SELECT sector, AVG(change_percent) AS avg_change_percent, COUNT(*) AS symbols FROM market_metrics WHERE updated_at >= NOW() - INTERVAL '1 day' AND sector IS NOT NULL GROUP BY sector ORDER BY avg_change_percent DESC NULLS |
| signal_narratives | strategy | server/engines/signalNarrativeEngine.js | 91 | INSERT INTO signal_narratives (signal_id, symbol, strategy, headline, source, catalyst_type, news_score, published_at, mcp_context, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NOW()) |
| signal_narratives | headline | server/engines/signalNarrativeEngine.js | 91 | INSERT INTO signal_narratives (signal_id, symbol, strategy, headline, source, catalyst_type, news_score, published_at, mcp_context, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NOW()) |
| signal_narratives | catalyst_type | server/engines/signalNarrativeEngine.js | 91 | INSERT INTO signal_narratives (signal_id, symbol, strategy, headline, source, catalyst_type, news_score, published_at, mcp_context, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NOW()) |
| signal_narratives | news_score | server/engines/signalNarrativeEngine.js | 91 | INSERT INTO signal_narratives (signal_id, symbol, strategy, headline, source, catalyst_type, news_score, published_at, mcp_context, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NOW()) |
| signal_narratives | published_at | server/engines/signalNarrativeEngine.js | 91 | INSERT INTO signal_narratives (signal_id, symbol, strategy, headline, source, catalyst_type, news_score, published_at, mcp_context, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NOW()) |
| trade_setups | catalyst_type | server/index.js | 1211 | SELECT s.*, c.catalyst_type, c.headline AS catalyst_headline, c.source AS catalyst_source, c.sentiment AS catalyst_sentiment, c.published_at AS catalyst_published_at, c.score AS catalyst_score FROM trade_setups s LEFT JO |
| trade_setups | headline | server/index.js | 1211 | SELECT s.*, c.catalyst_type, c.headline AS catalyst_headline, c.source AS catalyst_source, c.sentiment AS catalyst_sentiment, c.published_at AS catalyst_published_at, c.score AS catalyst_score FROM trade_setups s LEFT JO |
| trade_setups | source | server/index.js | 1211 | SELECT s.*, c.catalyst_type, c.headline AS catalyst_headline, c.source AS catalyst_source, c.sentiment AS catalyst_sentiment, c.published_at AS catalyst_published_at, c.score AS catalyst_score FROM trade_setups s LEFT JO |
| trade_setups | sentiment | server/index.js | 1211 | SELECT s.*, c.catalyst_type, c.headline AS catalyst_headline, c.source AS catalyst_source, c.sentiment AS catalyst_sentiment, c.published_at AS catalyst_published_at, c.score AS catalyst_score FROM trade_setups s LEFT JO |
| trade_setups | published_at | server/index.js | 1211 | SELECT s.*, c.catalyst_type, c.headline AS catalyst_headline, c.source AS catalyst_source, c.sentiment AS catalyst_sentiment, c.published_at AS catalyst_published_at, c.score AS catalyst_score FROM trade_setups s LEFT JO |
| market_metrics | company_name | server/index.js | 1282 | SELECT m.symbol, u.company_name, u.sector, u.industry, m.price, m.gap_percent, m.relative_volume, m.atr, m.float_rotation, s.setup, s.grade, s.score AS setup_score FROM market_metrics m JOIN ticker_universe u ON m.symbol |
| market_metrics | sector | server/index.js | 1282 | SELECT m.symbol, u.company_name, u.sector, u.industry, m.price, m.gap_percent, m.relative_volume, m.atr, m.float_rotation, s.setup, s.grade, s.score AS setup_score FROM market_metrics m JOIN ticker_universe u ON m.symbol |
| market_metrics | industry | server/index.js | 1282 | SELECT m.symbol, u.company_name, u.sector, u.industry, m.price, m.gap_percent, m.relative_volume, m.atr, m.float_rotation, s.setup, s.grade, s.score AS setup_score FROM market_metrics m JOIN ticker_universe u ON m.symbol |
| market_metrics | setup | server/index.js | 1282 | SELECT m.symbol, u.company_name, u.sector, u.industry, m.price, m.gap_percent, m.relative_volume, m.atr, m.float_rotation, s.setup, s.grade, s.score AS setup_score FROM market_metrics m JOIN ticker_universe u ON m.symbol |
| market_metrics | grade | server/index.js | 1282 | SELECT m.symbol, u.company_name, u.sector, u.industry, m.price, m.gap_percent, m.relative_volume, m.atr, m.float_rotation, s.setup, s.grade, s.score AS setup_score FROM market_metrics m JOIN ticker_universe u ON m.symbol |
| market_metrics | score | server/index.js | 1282 | SELECT m.symbol, u.company_name, u.sector, u.industry, m.price, m.gap_percent, m.relative_volume, m.atr, m.float_rotation, s.setup, s.grade, s.score AS setup_score FROM market_metrics m JOIN ticker_universe u ON m.symbol |
| ticker_universe | price | server/index.js | 1282 | SELECT m.symbol, u.company_name, u.sector, u.industry, m.price, m.gap_percent, m.relative_volume, m.atr, m.float_rotation, s.setup, s.grade, s.score AS setup_score FROM market_metrics m JOIN ticker_universe u ON m.symbol |
| ticker_universe | gap_percent | server/index.js | 1282 | SELECT m.symbol, u.company_name, u.sector, u.industry, m.price, m.gap_percent, m.relative_volume, m.atr, m.float_rotation, s.setup, s.grade, s.score AS setup_score FROM market_metrics m JOIN ticker_universe u ON m.symbol |
| ticker_universe | relative_volume | server/index.js | 1282 | SELECT m.symbol, u.company_name, u.sector, u.industry, m.price, m.gap_percent, m.relative_volume, m.atr, m.float_rotation, s.setup, s.grade, s.score AS setup_score FROM market_metrics m JOIN ticker_universe u ON m.symbol |
| ticker_universe | atr | server/index.js | 1282 | SELECT m.symbol, u.company_name, u.sector, u.industry, m.price, m.gap_percent, m.relative_volume, m.atr, m.float_rotation, s.setup, s.grade, s.score AS setup_score FROM market_metrics m JOIN ticker_universe u ON m.symbol |
| ticker_universe | float_rotation | server/index.js | 1282 | SELECT m.symbol, u.company_name, u.sector, u.industry, m.price, m.gap_percent, m.relative_volume, m.atr, m.float_rotation, s.setup, s.grade, s.score AS setup_score FROM market_metrics m JOIN ticker_universe u ON m.symbol |
| ticker_universe | setup | server/index.js | 1282 | SELECT m.symbol, u.company_name, u.sector, u.industry, m.price, m.gap_percent, m.relative_volume, m.atr, m.float_rotation, s.setup, s.grade, s.score AS setup_score FROM market_metrics m JOIN ticker_universe u ON m.symbol |
| ticker_universe | grade | server/index.js | 1282 | SELECT m.symbol, u.company_name, u.sector, u.industry, m.price, m.gap_percent, m.relative_volume, m.atr, m.float_rotation, s.setup, s.grade, s.score AS setup_score FROM market_metrics m JOIN ticker_universe u ON m.symbol |
| ticker_universe | score | server/index.js | 1282 | SELECT m.symbol, u.company_name, u.sector, u.industry, m.price, m.gap_percent, m.relative_volume, m.atr, m.float_rotation, s.setup, s.grade, s.score AS setup_score FROM market_metrics m JOIN ticker_universe u ON m.symbol |
| trade_setups | company_name | server/index.js | 1282 | SELECT m.symbol, u.company_name, u.sector, u.industry, m.price, m.gap_percent, m.relative_volume, m.atr, m.float_rotation, s.setup, s.grade, s.score AS setup_score FROM market_metrics m JOIN ticker_universe u ON m.symbol |
| trade_setups | sector | server/index.js | 1282 | SELECT m.symbol, u.company_name, u.sector, u.industry, m.price, m.gap_percent, m.relative_volume, m.atr, m.float_rotation, s.setup, s.grade, s.score AS setup_score FROM market_metrics m JOIN ticker_universe u ON m.symbol |
| trade_setups | industry | server/index.js | 1282 | SELECT m.symbol, u.company_name, u.sector, u.industry, m.price, m.gap_percent, m.relative_volume, m.atr, m.float_rotation, s.setup, s.grade, s.score AS setup_score FROM market_metrics m JOIN ticker_universe u ON m.symbol |
| trade_setups | price | server/index.js | 1282 | SELECT m.symbol, u.company_name, u.sector, u.industry, m.price, m.gap_percent, m.relative_volume, m.atr, m.float_rotation, s.setup, s.grade, s.score AS setup_score FROM market_metrics m JOIN ticker_universe u ON m.symbol |
| market_metrics | source | server/index.js | 1313 | SELECT m.*, d.source, d.score AS discovery_score FROM discovered_symbols d JOIN market_metrics m ON d.symbol = m.symbol WHERE m.gap_percent > 3 AND m.relative_volume > 2 ORDER BY m.gap_percent DESC LIMIT 50 |
| market_metrics | score | server/index.js | 1313 | SELECT m.*, d.source, d.score AS discovery_score FROM discovered_symbols d JOIN market_metrics m ON d.symbol = m.symbol WHERE m.gap_percent > 3 AND m.relative_volume > 2 ORDER BY m.gap_percent DESC LIMIT 50 |
| intraday_1m | date | server/metrics/calc_market_metrics.js | 95 | WITH target_symbols AS ( SELECT UNNEST($1::text[]) AS symbol ), daily AS ( SELECT d.symbol, d.date, d.open, d.high, d.low, d.close, d.volume, ROW_NUMBER() OVER (PARTITION BY d.symbol ORDER BY d.date DESC) AS rn, LAG(d.cl |
| company_profiles | date | server/metrics/calc_market_metrics.js | 95 | WITH target_symbols AS ( SELECT UNNEST($1::text[]) AS symbol ), daily AS ( SELECT d.symbol, d.date, d.open, d.high, d.low, d.close, d.volume, ROW_NUMBER() OVER (PARTITION BY d.symbol ORDER BY d.date DESC) AS rn, LAG(d.cl |
| company_profiles | open | server/metrics/calc_market_metrics.js | 95 | WITH target_symbols AS ( SELECT UNNEST($1::text[]) AS symbol ), daily AS ( SELECT d.symbol, d.date, d.open, d.high, d.low, d.close, d.volume, ROW_NUMBER() OVER (PARTITION BY d.symbol ORDER BY d.date DESC) AS rn, LAG(d.cl |
| company_profiles | high | server/metrics/calc_market_metrics.js | 95 | WITH target_symbols AS ( SELECT UNNEST($1::text[]) AS symbol ), daily AS ( SELECT d.symbol, d.date, d.open, d.high, d.low, d.close, d.volume, ROW_NUMBER() OVER (PARTITION BY d.symbol ORDER BY d.date DESC) AS rn, LAG(d.cl |
| company_profiles | low | server/metrics/calc_market_metrics.js | 95 | WITH target_symbols AS ( SELECT UNNEST($1::text[]) AS symbol ), daily AS ( SELECT d.symbol, d.date, d.open, d.high, d.low, d.close, d.volume, ROW_NUMBER() OVER (PARTITION BY d.symbol ORDER BY d.date DESC) AS rn, LAG(d.cl |
| company_profiles | close | server/metrics/calc_market_metrics.js | 95 | WITH target_symbols AS ( SELECT UNNEST($1::text[]) AS symbol ), daily AS ( SELECT d.symbol, d.date, d.open, d.high, d.low, d.close, d.volume, ROW_NUMBER() OVER (PARTITION BY d.symbol ORDER BY d.date DESC) AS rn, LAG(d.cl |
| company_profiles | volume | server/metrics/calc_market_metrics.js | 95 | WITH target_symbols AS ( SELECT UNNEST($1::text[]) AS symbol ), daily AS ( SELECT d.symbol, d.date, d.open, d.high, d.low, d.close, d.volume, ROW_NUMBER() OVER (PARTITION BY d.symbol ORDER BY d.date DESC) AS rn, LAG(d.cl |
| profiles | date | server/metrics/calc_market_metrics.js | 95 | WITH target_symbols AS ( SELECT UNNEST($1::text[]) AS symbol ), daily AS ( SELECT d.symbol, d.date, d.open, d.high, d.low, d.close, d.volume, ROW_NUMBER() OVER (PARTITION BY d.symbol ORDER BY d.date DESC) AS rn, LAG(d.cl |
| profiles | open | server/metrics/calc_market_metrics.js | 95 | WITH target_symbols AS ( SELECT UNNEST($1::text[]) AS symbol ), daily AS ( SELECT d.symbol, d.date, d.open, d.high, d.low, d.close, d.volume, ROW_NUMBER() OVER (PARTITION BY d.symbol ORDER BY d.date DESC) AS rn, LAG(d.cl |
| profiles | high | server/metrics/calc_market_metrics.js | 95 | WITH target_symbols AS ( SELECT UNNEST($1::text[]) AS symbol ), daily AS ( SELECT d.symbol, d.date, d.open, d.high, d.low, d.close, d.volume, ROW_NUMBER() OVER (PARTITION BY d.symbol ORDER BY d.date DESC) AS rn, LAG(d.cl |
| profiles | low | server/metrics/calc_market_metrics.js | 95 | WITH target_symbols AS ( SELECT UNNEST($1::text[]) AS symbol ), daily AS ( SELECT d.symbol, d.date, d.open, d.high, d.low, d.close, d.volume, ROW_NUMBER() OVER (PARTITION BY d.symbol ORDER BY d.date DESC) AS rn, LAG(d.cl |
| profiles | close | server/metrics/calc_market_metrics.js | 95 | WITH target_symbols AS ( SELECT UNNEST($1::text[]) AS symbol ), daily AS ( SELECT d.symbol, d.date, d.open, d.high, d.low, d.close, d.volume, ROW_NUMBER() OVER (PARTITION BY d.symbol ORDER BY d.date DESC) AS rn, LAG(d.cl |
| profiles | volume | server/metrics/calc_market_metrics.js | 95 | WITH target_symbols AS ( SELECT UNNEST($1::text[]) AS symbol ), daily AS ( SELECT d.symbol, d.date, d.open, d.high, d.low, d.close, d.volume, ROW_NUMBER() OVER (PARTITION BY d.symbol ORDER BY d.date DESC) AS rn, LAG(d.cl |
| daily_ohlc | table_name | server/monitoring/ingestionHealth.js | 4 | SELECT table_name, row_count, last_update FROM ( SELECT 'daily_ohlc'::text AS table_name, COUNT(*)::int AS row_count, MAX(date::timestamp) AS last_update FROM daily_ohlc UNION ALL SELECT 'intraday_1m'::text AS table_name |
| daily_ohlc | row_count | server/monitoring/ingestionHealth.js | 4 | SELECT table_name, row_count, last_update FROM ( SELECT 'daily_ohlc'::text AS table_name, COUNT(*)::int AS row_count, MAX(date::timestamp) AS last_update FROM daily_ohlc UNION ALL SELECT 'intraday_1m'::text AS table_name |
| daily_ohlc | last_update | server/monitoring/ingestionHealth.js | 4 | SELECT table_name, row_count, last_update FROM ( SELECT 'daily_ohlc'::text AS table_name, COUNT(*)::int AS row_count, MAX(date::timestamp) AS last_update FROM daily_ohlc UNION ALL SELECT 'intraday_1m'::text AS table_name |
| intraday_1m | table_name | server/monitoring/ingestionHealth.js | 4 | SELECT table_name, row_count, last_update FROM ( SELECT 'daily_ohlc'::text AS table_name, COUNT(*)::int AS row_count, MAX(date::timestamp) AS last_update FROM daily_ohlc UNION ALL SELECT 'intraday_1m'::text AS table_name |
| intraday_1m | row_count | server/monitoring/ingestionHealth.js | 4 | SELECT table_name, row_count, last_update FROM ( SELECT 'daily_ohlc'::text AS table_name, COUNT(*)::int AS row_count, MAX(date::timestamp) AS last_update FROM daily_ohlc UNION ALL SELECT 'intraday_1m'::text AS table_name |
| intraday_1m | last_update | server/monitoring/ingestionHealth.js | 4 | SELECT table_name, row_count, last_update FROM ( SELECT 'daily_ohlc'::text AS table_name, COUNT(*)::int AS row_count, MAX(date::timestamp) AS last_update FROM daily_ohlc UNION ALL SELECT 'intraday_1m'::text AS table_name |
| news_articles | table_name | server/monitoring/ingestionHealth.js | 4 | SELECT table_name, row_count, last_update FROM ( SELECT 'daily_ohlc'::text AS table_name, COUNT(*)::int AS row_count, MAX(date::timestamp) AS last_update FROM daily_ohlc UNION ALL SELECT 'intraday_1m'::text AS table_name |
| news_articles | row_count | server/monitoring/ingestionHealth.js | 4 | SELECT table_name, row_count, last_update FROM ( SELECT 'daily_ohlc'::text AS table_name, COUNT(*)::int AS row_count, MAX(date::timestamp) AS last_update FROM daily_ohlc UNION ALL SELECT 'intraday_1m'::text AS table_name |
| news_articles | last_update | server/monitoring/ingestionHealth.js | 4 | SELECT table_name, row_count, last_update FROM ( SELECT 'daily_ohlc'::text AS table_name, COUNT(*)::int AS row_count, MAX(date::timestamp) AS last_update FROM daily_ohlc UNION ALL SELECT 'intraday_1m'::text AS table_name |
| earnings_events | table_name | server/monitoring/ingestionHealth.js | 4 | SELECT table_name, row_count, last_update FROM ( SELECT 'daily_ohlc'::text AS table_name, COUNT(*)::int AS row_count, MAX(date::timestamp) AS last_update FROM daily_ohlc UNION ALL SELECT 'intraday_1m'::text AS table_name |
| earnings_events | row_count | server/monitoring/ingestionHealth.js | 4 | SELECT table_name, row_count, last_update FROM ( SELECT 'daily_ohlc'::text AS table_name, COUNT(*)::int AS row_count, MAX(date::timestamp) AS last_update FROM daily_ohlc UNION ALL SELECT 'intraday_1m'::text AS table_name |
| earnings_events | last_update | server/monitoring/ingestionHealth.js | 4 | SELECT table_name, row_count, last_update FROM ( SELECT 'daily_ohlc'::text AS table_name, COUNT(*)::int AS row_count, MAX(date::timestamp) AS last_update FROM daily_ohlc UNION ALL SELECT 'intraday_1m'::text AS table_name |
| market_metrics | sector | server/narrative/narrative_engine.js | 44 | SELECT u.sector, COUNT(*)::int AS symbol_count, AVG(COALESCE(m.relative_volume, 0)) AS avg_rvol, AVG(COALESCE(s.score, 0)) AS avg_setup_score FROM market_metrics m JOIN ticker_universe u ON u.symbol = m.symbol LEFT JOIN  |
| trade_setups | sector | server/narrative/narrative_engine.js | 44 | SELECT u.sector, COUNT(*)::int AS symbol_count, AVG(COALESCE(m.relative_volume, 0)) AS avg_rvol, AVG(COALESCE(s.score, 0)) AS avg_setup_score FROM market_metrics m JOIN ticker_universe u ON u.symbol = m.symbol LEFT JOIN  |
| user_alerts | symbol | server/routes/alerts.js | 106 | SELECT h.alert_id, h.symbol, h.triggered_at, h.message FROM alert_history h JOIN user_alerts a ON a.alert_id = h.alert_id WHERE a.user_id = $1 ORDER BY h.triggered_at DESC LIMIT $2 |
| user_alerts | triggered_at | server/routes/alerts.js | 106 | SELECT h.alert_id, h.symbol, h.triggered_at, h.message FROM alert_history h JOIN user_alerts a ON a.alert_id = h.alert_id WHERE a.user_id = $1 ORDER BY h.triggered_at DESC LIMIT $2 |
| user_alerts | message | server/routes/alerts.js | 106 | SELECT h.alert_id, h.symbol, h.triggered_at, h.message FROM alert_history h JOIN user_alerts a ON a.alert_id = h.alert_id WHERE a.user_id = $1 ORDER BY h.triggered_at DESC LIMIT $2 |
| early_accumulation_signals | max_move_percent | server/routes/intelligence.js | 206 | SELECT s.id, s.symbol, s.price, s.volume, s.avg_volume_30d, s.relative_volume, s.float_rotation, s.liquidity_surge, s.accumulation_score, s.pressure_level, s.sector, s.detected_at, o.max_move_percent FROM early_accumulat |
| early_signal_outcomes | price | server/routes/intelligence.js | 206 | SELECT s.id, s.symbol, s.price, s.volume, s.avg_volume_30d, s.relative_volume, s.float_rotation, s.liquidity_surge, s.accumulation_score, s.pressure_level, s.sector, s.detected_at, o.max_move_percent FROM early_accumulat |
| early_signal_outcomes | volume | server/routes/intelligence.js | 206 | SELECT s.id, s.symbol, s.price, s.volume, s.avg_volume_30d, s.relative_volume, s.float_rotation, s.liquidity_surge, s.accumulation_score, s.pressure_level, s.sector, s.detected_at, o.max_move_percent FROM early_accumulat |
| early_signal_outcomes | avg_volume_30d | server/routes/intelligence.js | 206 | SELECT s.id, s.symbol, s.price, s.volume, s.avg_volume_30d, s.relative_volume, s.float_rotation, s.liquidity_surge, s.accumulation_score, s.pressure_level, s.sector, s.detected_at, o.max_move_percent FROM early_accumulat |
| early_signal_outcomes | relative_volume | server/routes/intelligence.js | 206 | SELECT s.id, s.symbol, s.price, s.volume, s.avg_volume_30d, s.relative_volume, s.float_rotation, s.liquidity_surge, s.accumulation_score, s.pressure_level, s.sector, s.detected_at, o.max_move_percent FROM early_accumulat |
| early_signal_outcomes | float_rotation | server/routes/intelligence.js | 206 | SELECT s.id, s.symbol, s.price, s.volume, s.avg_volume_30d, s.relative_volume, s.float_rotation, s.liquidity_surge, s.accumulation_score, s.pressure_level, s.sector, s.detected_at, o.max_move_percent FROM early_accumulat |
| early_signal_outcomes | liquidity_surge | server/routes/intelligence.js | 206 | SELECT s.id, s.symbol, s.price, s.volume, s.avg_volume_30d, s.relative_volume, s.float_rotation, s.liquidity_surge, s.accumulation_score, s.pressure_level, s.sector, s.detected_at, o.max_move_percent FROM early_accumulat |
| early_signal_outcomes | accumulation_score | server/routes/intelligence.js | 206 | SELECT s.id, s.symbol, s.price, s.volume, s.avg_volume_30d, s.relative_volume, s.float_rotation, s.liquidity_surge, s.accumulation_score, s.pressure_level, s.sector, s.detected_at, o.max_move_percent FROM early_accumulat |
| early_signal_outcomes | pressure_level | server/routes/intelligence.js | 206 | SELECT s.id, s.symbol, s.price, s.volume, s.avg_volume_30d, s.relative_volume, s.float_rotation, s.liquidity_surge, s.accumulation_score, s.pressure_level, s.sector, s.detected_at, o.max_move_percent FROM early_accumulat |
| early_signal_outcomes | sector | server/routes/intelligence.js | 206 | SELECT s.id, s.symbol, s.price, s.volume, s.avg_volume_30d, s.relative_volume, s.float_rotation, s.liquidity_surge, s.accumulation_score, s.pressure_level, s.sector, s.detected_at, o.max_move_percent FROM early_accumulat |
| early_signal_outcomes | detected_at | server/routes/intelligence.js | 206 | SELECT s.id, s.symbol, s.price, s.volume, s.avg_volume_30d, s.relative_volume, s.float_rotation, s.liquidity_surge, s.accumulation_score, s.pressure_level, s.sector, s.detected_at, o.max_move_percent FROM early_accumulat |
| market_metrics | sector | server/routes/marketContextRoutes.js | 7 | WITH symbols(symbol) AS ( VALUES ('SPY'), ('QQQ'), ('VIX'), ('SMH'), ('XLF'), ('EURUSD'), ('BTC') ), metric_rows AS ( SELECT m.symbol, COALESCE((to_jsonb(m)->>'close')::numeric, (to_jsonb(m)->>'price')::numeric, q.price) |
| user_presets | fieldsjoin | server/services/presetService.js | 193 | UPDATE user_presets SET ${fields.join(', ')} WHERE id = $${idx++} AND user_id = $${idx++} RETURNING * |
| users | fieldsjoin | server/services/presetService.js | 299 | UPDATE users SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${idx} RETURNING id |
| market_metrics | catalyst_type | server/services/queryEngine.js | 85 | WITH latest_catalyst AS ( SELECT DISTINCT ON (symbol) symbol, catalyst_type, headline, sentiment, score, published_at FROM trade_catalysts ORDER BY symbol, published_at DESC NULLS LAST ) SELECT m.symbol, m.price, m.chang |
| market_metrics | headline | server/services/queryEngine.js | 85 | WITH latest_catalyst AS ( SELECT DISTINCT ON (symbol) symbol, catalyst_type, headline, sentiment, score, published_at FROM trade_catalysts ORDER BY symbol, published_at DESC NULLS LAST ) SELECT m.symbol, m.price, m.chang |
| market_metrics | sentiment | server/services/queryEngine.js | 85 | WITH latest_catalyst AS ( SELECT DISTINCT ON (symbol) symbol, catalyst_type, headline, sentiment, score, published_at FROM trade_catalysts ORDER BY symbol, published_at DESC NULLS LAST ) SELECT m.symbol, m.price, m.chang |
| market_metrics | score | server/services/queryEngine.js | 85 | WITH latest_catalyst AS ( SELECT DISTINCT ON (symbol) symbol, catalyst_type, headline, sentiment, score, published_at FROM trade_catalysts ORDER BY symbol, published_at DESC NULLS LAST ) SELECT m.symbol, m.price, m.chang |
| market_metrics | published_at | server/services/queryEngine.js | 85 | WITH latest_catalyst AS ( SELECT DISTINCT ON (symbol) symbol, catalyst_type, headline, sentiment, score, published_at FROM trade_catalysts ORDER BY symbol, published_at DESC NULLS LAST ) SELECT m.symbol, m.price, m.chang |
| trade_setups | catalyst_type | server/services/queryEngine.js | 85 | WITH latest_catalyst AS ( SELECT DISTINCT ON (symbol) symbol, catalyst_type, headline, sentiment, score, published_at FROM trade_catalysts ORDER BY symbol, published_at DESC NULLS LAST ) SELECT m.symbol, m.price, m.chang |
| trade_setups | headline | server/services/queryEngine.js | 85 | WITH latest_catalyst AS ( SELECT DISTINCT ON (symbol) symbol, catalyst_type, headline, sentiment, score, published_at FROM trade_catalysts ORDER BY symbol, published_at DESC NULLS LAST ) SELECT m.symbol, m.price, m.chang |
| trade_setups | sentiment | server/services/queryEngine.js | 85 | WITH latest_catalyst AS ( SELECT DISTINCT ON (symbol) symbol, catalyst_type, headline, sentiment, score, published_at FROM trade_catalysts ORDER BY symbol, published_at DESC NULLS LAST ) SELECT m.symbol, m.price, m.chang |
| trade_setups | published_at | server/services/queryEngine.js | 85 | WITH latest_catalyst AS ( SELECT DISTINCT ON (symbol) symbol, catalyst_type, headline, sentiment, score, published_at FROM trade_catalysts ORDER BY symbol, published_at DESC NULLS LAST ) SELECT m.symbol, m.price, m.chang |
| trades | fieldsjoin | server/services/trades/tradeModel.js | 48 | UPDATE trades SET ${fields.join(', ')} WHERE trade_id = $${idx} AND user_id = $${idx + 1} RETURNING * |
| trades | setup_type | server/services/trades/tradeModel.js | 92 | SELECT t.*, tm.setup_type, tm.conviction, tm.notes, tm.review_status FROM trades t LEFT JOIN trade_metadata tm ON tm.trade_id = t.trade_id WHERE ${conditions.join(' AND ')} ORDER BY t.opened_at DESC LIMIT $${idx} OFFSET  |
| trades | conviction | server/services/trades/tradeModel.js | 92 | SELECT t.*, tm.setup_type, tm.conviction, tm.notes, tm.review_status FROM trades t LEFT JOIN trade_metadata tm ON tm.trade_id = t.trade_id WHERE ${conditions.join(' AND ')} ORDER BY t.opened_at DESC LIMIT $${idx} OFFSET  |
| trades | notes | server/services/trades/tradeModel.js | 92 | SELECT t.*, tm.setup_type, tm.conviction, tm.notes, tm.review_status FROM trades t LEFT JOIN trade_metadata tm ON tm.trade_id = t.trade_id WHERE ${conditions.join(' AND ')} ORDER BY t.opened_at DESC LIMIT $${idx} OFFSET  |
| trades | review_status | server/services/trades/tradeModel.js | 92 | SELECT t.*, tm.setup_type, tm.conviction, tm.notes, tm.review_status FROM trades t LEFT JOIN trade_metadata tm ON tm.trade_id = t.trade_id WHERE ${conditions.join(' AND ')} ORDER BY t.opened_at DESC LIMIT $${idx} OFFSET  |
| trades | setup_type | server/services/trades/tradeModel.js | 105 | SELECT t.*, tm.setup_type, tm.conviction, tm.notes, tm.screenshot_url, tm.tags_json, tm.review_status FROM trades t LEFT JOIN trade_metadata tm ON tm.trade_id = t.trade_id WHERE t.trade_id = $1 AND t.user_id = $2 |
| trades | conviction | server/services/trades/tradeModel.js | 105 | SELECT t.*, tm.setup_type, tm.conviction, tm.notes, tm.screenshot_url, tm.tags_json, tm.review_status FROM trades t LEFT JOIN trade_metadata tm ON tm.trade_id = t.trade_id WHERE t.trade_id = $1 AND t.user_id = $2 |
| trades | notes | server/services/trades/tradeModel.js | 105 | SELECT t.*, tm.setup_type, tm.conviction, tm.notes, tm.screenshot_url, tm.tags_json, tm.review_status FROM trades t LEFT JOIN trade_metadata tm ON tm.trade_id = t.trade_id WHERE t.trade_id = $1 AND t.user_id = $2 |
| trades | screenshot_url | server/services/trades/tradeModel.js | 105 | SELECT t.*, tm.setup_type, tm.conviction, tm.notes, tm.screenshot_url, tm.tags_json, tm.review_status FROM trades t LEFT JOIN trade_metadata tm ON tm.trade_id = t.trade_id WHERE t.trade_id = $1 AND t.user_id = $2 |
| trades | tags_json | server/services/trades/tradeModel.js | 105 | SELECT t.*, tm.setup_type, tm.conviction, tm.notes, tm.screenshot_url, tm.tags_json, tm.review_status FROM trades t LEFT JOIN trade_metadata tm ON tm.trade_id = t.trade_id WHERE t.trade_id = $1 AND t.user_id = $2 |
| trades | review_status | server/services/trades/tradeModel.js | 105 | SELECT t.*, tm.setup_type, tm.conviction, tm.notes, tm.screenshot_url, tm.tags_json, tm.review_status FROM trades t LEFT JOIN trade_metadata tm ON tm.trade_id = t.trade_id WHERE t.trade_id = $1 AND t.user_id = $2 |
| users | fieldsjoin | server/users/model.js | 114 | UPDATE users SET ${fields.join(', ')} WHERE id = $${paramIndex} |
| daily_ohlc | countexact | scripts/systemAudit.ts | 131 | supabase.from(daily_ohlc).select |
| daily_ohlc | headtrue | scripts/systemAudit.ts | 131 | supabase.from(daily_ohlc).select |

### Columns in database never used in code (heuristic)
| table | unused_count | sample_columns |
| --- | --- | --- |
| activity_log | 2 | id, created_at |
| alert_history | 1 | id |
| alerts | 8 | id, type, source, severity, message, acknowledged, created_at, updated_at |
| audit_log | 5 | id, actor, action, target, created_at |
| broker_executions | 2 | exec_id, created_at |
| chart_trends | 8 | symbol, trend, support, resistance, channel, breakouts, computed_at, updated_at |
| company_profiles | 15 | symbol, company_name, exchange, sector, industry, description, ceo, website, country, market_cap |
| daily_reviews | 3 | review_id, created_at, updated_at |
| daily_signal_snapshot | 11 | id, symbol, score, confidence, strategy, catalyst, sector, entry_price, snapshot_time, snapshot_date |
| data_integrity | 5 | id, symbol, issue, payload, created_at |
| data_integrity_events | 8 | id, event_type, source, symbol, issue, severity, payload, created_at |
| dynamic_watchlist | 14 | id, symbol, score, confidence, catalyst_type, sector, float_rotation, liquidity_surge, created_at, strategy |
| early_accumulation_signals | 4 | float_shares, volume_delta, catalyst_type, alert_sent |
| early_signal_outcomes | 11 | signal_id, entry_price, price_1h, price_4h, price_1d, price_5d, price_30d, result_label, evaluated_at, created_at |
| earnings_events | 9 | id, rev_surprise_pct, guidance_direction, created_at, company, earnings_date, revenue_estimate, updated_at, time |
| earnings_market_reaction | 15 | id, symbol, report_date, pre_market_gap_pct, open_gap_pct, high_of_day_pct, low_of_day_pct, close_pct, volume_vs_avg, rvol |
| earnings_scores | 13 | id, symbol, report_date, surprise_score, guidance_score, reaction_score, positioning_score, total_score, tier, created_at |
| engine_errors | 6 | id, engine, message, stack, timestamp, metadata |
| engine_runtime | 7 | id, engine_name, status, execution_time_ms, details, created_at, updated_at |
| engine_status | 5 | engine, status, last_run, runtime_ms, updated_at |
| engine_telemetry | 4 | id, engine, payload, updated_at |
| event_log | 4 | id, event_type, payload, created_at |
| expected_moves | 6 | symbol, expected_move, atr_percent, price, earnings_date, updated_at |
| feature_access_audit | 8 | id, admin_user_id, target_user_id, feature_key, old_enabled, new_enabled, created_at, changed_at |
| feature_audit | 7 | id, actor_id, action, target, metadata, created_at, changed_at |
| feature_flags | 4 | key, enabled, description, category |
| feature_overrides | 5 | id, user_id, feature_key, enabled, updated_at |
| feature_registry | 12 | id, feature_key, feature_name, category, description, release_stage, default_free, default_pro, default_ultimate, default_admin |
| feature_roles | 5 | id, user_id, role, updated_at, changed_at |
| flow_signals | 9 | id, symbol, flow_score, pressure_level, relative_volume, float_rotation, liquidity_surge, detected_at, timestamp |
| institutional_flow | 7 | id, symbol, relative_volume, volume, breakout_score, score, detected_at |
| integrity_events | 7 | id, source, issue, severity, payload, created_at, updated_at |
| intel_news | 6 | symbol, source, url, published_at, sentiment, updated_at |
| intelligence_briefs | 8 | id, email_id, summary, market_sentiment, geopolitical_score, sector_tags, tickers, created_at |
| intelligence_emails | 1 | created_at |
| intraday_1h | 7 | symbol, timestamp, open, high, low, close, volume |
| intraday_1m | 2 | symbol, timestamp |
| intraday_ohlc | 9 | id, symbol, timeframe, open, high, low, close, volume, timestamp |
| market_metrics | 8 | avg_volume_30d, updated_at, volume, previous_high, float_shares, atr_percent, short_float, liquidity_surge |
| market_news | 7 | id, symbol, headline, source, url, published_at, created_at |
| market_quotes | 4 | short_float, float, relative_volume, premarket_volume |
| morning_briefings | 9 | id, created_at, signals, market, news, as_of_date, narrative, email_status, stocks_in_play |
| news_articles | 4 | created_at, symbol, sector, narrative |
| news_catalysts | 3 | id, created_at, updated_at |
| news_events | 2 | id, created_at |
| newsletter_campaigns | 5 | id, subject, content_html, content_text, created_at |
| newsletter_send_history | 9 | id, subject, recipients_count, provider_id, status, open_rate, click_rate, sent_at, created_at |
| newsletter_sends | 6 | id, campaign_id, email, opened, clicked, sent_at |
| newsletter_subscribers | 7 | id, email, name, plan, confirmed, created_at, is_active |
| opportunities | 4 | id, symbol, score, created_at |
| opportunities_v2 | 8 | symbol, score, change_percent, relative_volume, gap_percent, strategy, volume, updated_at |
| opportunity_stream | 7 | id, symbol, event_type, headline, score, source, created_at |
| options_cache | 8 | symbol, expiration, atm_iv, expected_move_pct, expected_move_dollar, days_to_expiry, fetched_at, null_reason |
| plan_features | 2 | plan, feature |
| profiles | 7 | id, username, role, created_at, plan, trial_end, is_active |
| provider_health | 6 | id, provider, status, latency, created_at, updated_at |
| qualified_signals | 21 | id, signal_id, symbol, strategy, class, score, probability, signal_time, signal_origin, scanner_name |
| roles | 4 | id, user_id, role, created_at |
| scheduler_status | 3 | id, last_heartbeat, jobs_run |
| schema_migrations | 1 | applied_at |
| sector_heatmap | 6 | sector, avg_change, total_volume, stocks, leaders, updated_at |
| signal_alerts | 9 | id, symbol, score, confidence, alert_type, message, created_at, acknowledged, strategy |
| signal_behaviour | 15 | id, signal_id, symbol, entry_price, peak_price, peak_time, low_price, low_time, max_upside, max_drawdown |
| signal_catalysts | 2 | raw_payload, created_at |
| signal_component_outcomes | 20 | id, symbol, snapshot_date, score, gap_percent, rvol, float_rotation, liquidity_surge, catalyst_score, sector_score |
| signal_engine_metrics | 16 | id, symbol, rvol, gap_percent, atr_percent, float_shares, volume, avg_volume_30d, float_rotation, liquidity_surge |
| signal_hierarchy | 9 | id, symbol, hierarchy_rank, signal_class, strategy, score, confidence, created_at, updated_at |
| signal_narratives | 4 | narrative_type, sentiment, summary, confidence_score |
| signal_outcomes | 8 | id, symbol, entry_price, exit_price, return_percent, hold_minutes, strategy, created_at |
| signal_performance | 4 | id, created_at, snapshot_date, exit_price |
| signal_weight_calibration | 8 | id, component, weight, success_rate, updated_at, avg_move, signals_analyzed, created_at |
| sparkline_cache | 3 | symbol, data, updated_at |
| squeeze_signals | 9 | id, symbol, short_float, relative_volume, price_change, float_shares, score, detected_at, timestamp |
| strategy_accuracy | 6 | strategy, total_signals, wins, losses, accuracy_rate, updated_at |
| strategy_learning | 11 | id, strategy, sector, catalyst_type, time_of_day, signals_count, win_count, avg_upside, avg_drawdown, win_rate |
| strategy_signals | 10 | probability, change_percent, gap_percent, relative_volume, volume, entry_price, created_at, exit_price, result, timestamp |
| strategy_trades | 10 | id, symbol, strategy, entry_price, exit_price, entry_time, exit_time, max_move, result_percent, created_at |
| system_alerts | 7 | id, type, source, severity, message, acknowledged, created_at |
| system_events | 6 | id, event_type, source, symbol, payload, created_at |
| tier_feature_defaults | 3 | feature_key, role, enabled |
| tradable_universe | 8 | symbol, price, change_percent, relative_volume, volume, avg_volume_30d, updated_at, gap_percent |
| trade_metadata | 3 | metadata_id, created_at, updated_at |
| trade_signals | 27 | id, symbol, strategy, score, gap_percent, rvol, atr_percent, created_at, updated_at, signal_explanation |
| trade_tags | 2 | tag_id, created_at |
| trades | 1 | created_at |
| usage_events | 1 | id |
| user_alerts | 1 | id |
| user_feature_access | 7 | id, feature_key, enabled, source, created_at, updated_at, user_id |
| user_preferences | 2 | min_price, max_price |
| user_presets | 3 | id, created_at, updated_at |
| user_roles | 5 | id, role, created_at, updated_at, user_id |
| user_signal_feedback | 5 | id, user_id, signal_id, rating, created_at |
| user_watchlists | 3 | id, added_at, created_at |
| users | 3 | password_hash, plan, role |

### Views incorrectly treated as tables
| view_name | used_in_code |
| --- | --- |
| tier_feature_defaults | false |

## Missing Data Fields
| field | exists_in_database_schema |
| --- | --- |
| opportunities_24h | false |
| provider_latency | false |
| ui_error_count | false |

## Pipeline Data Flow
| provider | engine | table | api | frontend |
| --- | --- | --- | --- | --- |
| unknown_provider | (none) | user_alerts | GET /alerts | (none) |
| unknown_provider | (none) | alert_history | GET /alerts/history | (none) |
| unknown_provider | (none) | ticker_universe | GET /api/scanner | client/src/pages/InstitutionalScreener.jsx |
| unknown_provider | server/engines/intelAnalysisEngine.js | news_articles | GET /test-news-db | (none) |
| unknown_provider | (none) | trade_catalysts | GET /api/setups | client/src/components/ai-quant/AIQuantPage.jsx |
| unknown_provider | (none) | usage_events | (none) | (none) |
| unknown_provider | (none) | schema_migrations | (none) | (none) |
| unknown_provider | (none) | trade_setups | GET /api/setups | client/src/components/ai-quant/AIQuantPage.jsx |
| unknown_provider | (none) | earnings_events | GET /api/earnings/calendar | (none) |
| unknown_provider | (none) | discovered_symbols | GET /api/premarket | (none) |
| fmp | server/engines/fmpMarketIngestion.js | market_quotes | GET / | (none) |
| fmp | server/engines/intelNarrativeEngine.js | intel_news | (none) | (none) |
| unknown_provider | server/engines/mcpContextEngine.js | strategy_signals | GET / | (none) |
| unknown_provider | server/engines/mcpContextEngine.js | market_metrics | GET /api/scanner | client/src/pages/InstitutionalScreener.jsx |
| fmp | server/engines/mcpNarrativeEngine.js | signal_narratives | (none) | (none) |
| unknown_provider | server/engines/signalNarrativeEngine.js | signal_catalysts | (none) | (none) |
| unknown_provider | server/engines/signalPerformanceEngine.js | signal_performance | GET /strategy | (none) |
| unknown_provider | (none) | market_narratives | GET /api/market-narrative | client/src/components/narrative/MarketNarrative.jsx |
| unknown_provider | (none) | intraday_1m | (none) | (none) |
| unknown_provider | (none) | symbol_queue | (none) | (none) |
| unknown_provider | (none) | daily_ohlc | (none) | (none) |
| unknown_provider | (none) | company_profiles | (none) | (none) |
| unknown_provider | (none) | profiles | (none) | (none) |
| unknown_provider | (none) | news_events | GET /news | (none) |
| unknown_provider | (none) | intelligence_emails | POST /api/intelligence/email-ingest | (none) |
| unknown_provider | (none) | news_catalysts | GET /api/intelligence/catalysts | (none) |
| unknown_provider | (none) | early_accumulation_signals | GET /api/intelligence/early-accumulation | client/src/pages/SignalIntelligenceAdmin.jsx |
| unknown_provider | (none) | early_signal_outcomes | GET /api/intelligence/early-accumulation | client/src/pages/SignalIntelligenceAdmin.jsx |
| unknown_provider | (none) | order_flow_signals | GET /api/intelligence/order-flow | client/src/pages/SignalIntelligenceAdmin.jsx |
| unknown_provider | (none) | sector_momentum | GET /api/intelligence/sector-momentum | (none) |
| unknown_provider | (none) | stocks_in_play | GET /api/stocks/in-play | (none) |
| unknown_provider | (none) | trades | DELETE /api/trades/admin/demo/:tradeId | (none) |
| unknown_provider | (none) | broker_executions | DELETE /api/trades/admin/demo | (none) |
| unknown_provider | (none) | daily_reviews | DELETE /api/trades/admin/demo | (none) |
| unknown_provider | (none) | earnings_market_reaction | (none) | (none) |
| unknown_provider | (none) | earnings_scores | (none) | (none) |
| unknown_provider | (none) | user_presets | (none) | (none) |
| unknown_provider | (none) | users | (none) | (none) |
| unknown_provider | (none) | user_watchlists | (none) | (none) |
| unknown_provider | (none) | trade_metadata | (none) | (none) |
| unknown_provider | (none) | trade_tags | (none) | (none) |
| unknown_provider | (none) | activity_log | (none) | (none) |
| unknown_provider | (none) | settings | (none) | (none) |
| unknown_provider | (none) | ingestion_state | (none) | (none) |
| unknown_provider | (none) | user_preferences | (none) | (none) |

## Performance Risks
| table | file | function | line | issues | query_snippet |
| --- | --- | --- | --- | --- | --- |
| intraday_1m | server/metrics/calc_market_metrics.js | getAllSymbols | 77 | no_time_filter, no_limit | SELECT DISTINCT symbol FROM ( SELECT symbol FROM daily_ohlc UNION SELECT symbol FROM intraday_1m ) s WHERE symbol IS NOT NULL AND symbol <> '' ORDER BY symbol ASC |
| intraday_1m | server/metrics/calc_market_metrics.js | calculateBatchMetrics | 95 | no_where_clause | WITH target_symbols AS ( SELECT UNNEST($1::text[]) AS symbol ), daily AS ( SELECT d.symbol, d.date, d.open, d.high, d.low, d.close, d.volume, ROW_NUMBER() OVER (PARTITION BY d.symbol ORDER BY d.date DESC) AS rn, LAG(d.cl |
| intraday_1m | server/monitoring/ingestionHealth.js | getIngestionHealth | 4 | no_where_clause, no_symbol_filter, no_limit | SELECT table_name, row_count, last_update FROM ( SELECT 'daily_ohlc'::text AS table_name, COUNT(*)::int AS row_count, MAX(date::timestamp) AS last_update FROM daily_ohlc UNION ALL SELECT 'intraday_1m'::text AS table_name |
| intraday_1m | server/routes/chartV2.ts | readIntraday1mFromDB | 53 | no_limit | SELECT EXTRACT(EPOCH FROM "timestamp")::bigint AS ts_unix, open, high, low, close, volume FROM intraday_1m WHERE symbol = $1 AND "timestamp" >= $2 ORDER BY "timestamp" ASC |
| intraday_1m | server/services/candleUpdateService.ts | quoted | 239 | no_symbol_filter | DELETE FROM intraday_1m WHERE "timestamp" < $1 |
| intraday_1m | scripts/fullMarketIngestion.ts | runIntradayRetention | 188 | no_symbol_filter | DELETE FROM intraday_1m WHERE "timestamp" < $1 |
| daily_ohlc | server/metrics/calc_market_metrics.js | getAllSymbols | 77 | no_time_filter, no_limit | SELECT DISTINCT symbol FROM ( SELECT symbol FROM daily_ohlc UNION SELECT symbol FROM intraday_1m ) s WHERE symbol IS NOT NULL AND symbol <> '' ORDER BY symbol ASC |
| daily_ohlc | server/metrics/calc_market_metrics.js | calculateBatchMetrics | 95 | no_where_clause | WITH target_symbols AS ( SELECT UNNEST($1::text[]) AS symbol ), daily AS ( SELECT d.symbol, d.date, d.open, d.high, d.low, d.close, d.volume, ROW_NUMBER() OVER (PARTITION BY d.symbol ORDER BY d.date DESC) AS rn, LAG(d.cl |
| daily_ohlc | server/monitoring/ingestionHealth.js | getIngestionHealth | 4 | no_where_clause, no_symbol_filter, no_limit | SELECT table_name, row_count, last_update FROM ( SELECT 'daily_ohlc'::text AS table_name, COUNT(*)::int AS row_count, MAX(date::timestamp) AS last_update FROM daily_ohlc UNION ALL SELECT 'intraday_1m'::text AS table_name |
| daily_ohlc | server/routes/chartV2.ts | readDailyFromDB | 30 | no_limit | SELECT date::text AS d, open, high, low, close, volume FROM daily_ohlc WHERE symbol = $1 AND date >= $2 ORDER BY date ASC |
| daily_ohlc | scripts/systemAudit.ts | runSql | 131 | no_where_clause, no_symbol_filter, no_time_filter | supabase.from(daily_ohlc).select |
| news_events | scripts/newsSmokeInsert.js | toIsoTimestamp | 60 | no_where_clause, no_symbol_filter, no_time_filter, no_limit | SELECT count(*)::int AS count FROM public.news_events |
| news_events | server/services/candleUpdateService.ts | quoted | 311 | no_symbol_filter | DELETE FROM news_events WHERE published_at < $1 |
| news_events | server/services/candleUpdateService.ts | quoted | 463 | no_symbol_filter | DELETE FROM news_events WHERE published_at < $1 |
| news_events | scripts/newsSmokeInsert.js | toIsoTimestamp | 49 | no_where_clause | INSERT INTO public.news_events (symbol, published_at, headline, source, url) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (symbol, published_at, headline) DO UPDATE SET source = EXCLUDED.source, url = EXCLUDED.url RETURNING i |

## Recommended Fixes
- Replace legacy duplicate table references (`opportunities`, `market_news`, `alerts`) with canonical targets.
- Add symbol/time filters and LIMIT on large-table queries where missing.
- Add CI schema contract checks comparing query map usage vs snapshot columns.
- Verify frontend expected fields against API payload contracts before release.
