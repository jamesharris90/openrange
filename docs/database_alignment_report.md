# Database Alignment Report

Generated: 2026-03-12T07:07:55.015Z

## 1. Tables used in code

| table_name | read_ops | write_ops | total_ops | sample_reference |
| --- | --- | --- | --- | --- |
| market_metrics | 49 | 5 | 54 | server/engines/earlyAccumulationEngine.js:92 |
| market_quotes | 49 | 4 | 53 | scripts/run-acceptance-smoke.js:115 |
| SET | 0 | 39 | 39 | scripts/smoke-personalization.js:41 |
| users | 21 | 16 | 37 | scripts/repairAdminUser.js:43 |
| (dynamic-sql) | 23 | 3 | 26 | scripts/fullMarketIngestion.ts:416 |
| strategy_signals | 17 | 5 | 22 | server/engines/mcpContextEngine.js:6 |
| news_articles | 12 | 5 | 17 | server/catalyst/catalyst_engine.js:87 |
| earnings_events | 15 | 1 | 16 | server/discovery/discovery_engine.js:11 |
| intel_news | 11 | 4 | 15 | server/engines/intelNarrativeEngine.js:150 |
| intraday_1m | 12 | 2 | 14 | scripts/fullMarketIngestion.ts:188 |
| trade_catalysts | 11 | 2 | 13 | server/catalyst/catalyst_engine.js:140 |
| trade_setups | 12 | 1 | 13 | server/discovery/discovery_engine.js:11 |
| LATERAL | 11 | 0 | 11 | server/engines/metricsEngine.js:29 |
| trade_signals | 8 | 3 | 11 | server/engines/morningBriefEngine.js:45 |
| trades | 5 | 6 | 11 | server/routes/trades.js:233 |
| daily_ohlc | 9 | 1 | 10 | scripts/systemAudit.ts:131 |
| usage_events | 6 | 4 | 10 | server/db/index.js:27 |
| news_catalysts | 8 | 1 | 9 | server/engines/catalystEngine.js:167 |
| market_narratives | 5 | 3 | 8 | server/engines/marketNarrativeEngine.js:100 |
| daily_reviews | 4 | 4 | 8 | server/routes/trades.js:256 |
| user_presets | 3 | 5 | 8 | server/services/presetService.js:85 |
| strategy_trades | 3 | 4 | 7 | server/engines/strategyEvaluationEngine.js:46 |
| symbol_queue | 4 | 3 | 7 | server/metrics/calc_market_metrics.js:37 |
| ingestion_state | 1 | 5 | 6 | scripts/fullMarketIngestion.ts:253 |
| news_events | 4 | 2 | 6 | scripts/systemAudit.ts:245 |
| user_alerts | 3 | 3 | 6 | server/alerts/alert_engine.js:121 |
| ticker_universe | 5 | 1 | 6 | server/catalyst/catalyst_engine.js:77 |
| jsonb_to_recordset | 0 | 6 | 6 | server/catalyst/catalyst_engine.js:140 |
| tradable_universe | 4 | 2 | 6 | server/engines/opportunityEngine.js:36 |
| intelligence_emails | 4 | 2 | 6 | server/index.js:2165 |
| information_schema.tables | 5 | 0 | 5 | scripts/generate-system-health-report.js:29 |
| user_watchlists | 2 | 3 | 5 | scripts/smoke-personalization.js:54 |
| ranked | 5 | 0 | 5 | server/engines/sectorEngine.js:23 |
| alert_history | 3 | 1 | 4 | server/alerts/alert_engine.js:201 |
| discovered_symbols | 3 | 1 | 4 | server/discovery/discovery_engine.js:73 |
| signal_narratives | 2 | 2 | 4 | server/engines/mcpNarrativeEngine.js:60 |
| morning_briefings | 2 | 2 | 4 | server/engines/morningBriefEngine.js:253 |
| sector_momentum | 3 | 1 | 4 | server/engines/newsletterEngine.js:240 |
| signal_component_outcomes | 2 | 2 | 4 | server/engines/signalLearningEngine.js:235 |
| signal_performance | 1 | 3 | 4 | server/engines/signalPerformanceEngine.js:241 |
| system_events | 3 | 1 | 4 | server/events/eventLogger.js:30 |
| user_signal_feedback | 3 | 1 | 4 | server/index.js:2274 |
| trade_metadata | 3 | 1 | 4 | server/services/trades/tradeModel.js:92 |
| timestamp | 3 | 0 | 3 | server/cache/sparklineCacheEngine.js:33 |
| data_integrity_events | 2 | 1 | 3 | server/engines/dataIntegrityEngine.js:37 |
| early_accumulation_signals | 2 | 1 | 3 | server/engines/earlyAccumulationEngine.js:132 |
| daily_signal_snapshot | 1 | 2 | 3 | server/engines/newsletterEngine.js:155 |
| signal_hierarchy | 2 | 1 | 3 | server/engines/newsletterEngine.js:206 |
| newsletter_subscribers | 2 | 1 | 3 | server/engines/newsletterEngine.js:256 |
| opportunity_stream | 0 | 3 | 3 | server/engines/opportunityRanker.js:86 |
| order_flow_signals | 2 | 1 | 3 | server/engines/orderFlowImbalanceEngine.js:109 |
| base | 3 | 0 | 3 | server/engines/sectorEngine.js:23 |
| sparkline_cache | 2 | 1 | 3 | server/engines/sparklineCacheEngine.js:57 |
| system_alerts | 2 | 1 | 3 | server/engines/systemAlertEngine.js:58 |
| dynamic_watchlist | 1 | 2 | 3 | server/routes/signals.js:14 |
| broker_executions | 0 | 3 | 3 | server/routes/trades.js:255 |
| user_roles | 1 | 2 | 3 | server/services/featureAccessService.js:27 |
| user_feature_access | 2 | 1 | 3 | server/services/featureAccessService.js:77 |
| trade_tags | 1 | 2 | 3 | server/services/trades/tradeModel.js:186 |
| settings | 2 | 1 | 3 | server/users/model.js:309 |
| opportunities | 2 | 0 | 2 | scripts/generate-data-recovery-report.js:11 |
| engine_errors | 1 | 1 | 2 | scripts/generate-stability-report.js:30 |
| information_schema.columns | 2 | 0 | 2 | server/alerts/alert_engine.js:44 |
| setup_candidates | 2 | 0 | 2 | server/discovery/discovery_engine.js:11 |
| catalyst_candidates | 2 | 0 | 2 | server/discovery/discovery_engine.js:11 |
| earnings_candidates | 2 | 0 | 2 | server/discovery/discovery_engine.js:11 |
| all_candidates | 2 | 0 | 2 | server/discovery/discovery_engine.js:11 |
| early_signal_outcomes | 1 | 1 | 2 | server/engines/earlySignalOutcomeEngine.js:95 |
| flow_signals | 1 | 1 | 2 | server/engines/flowDetectionEngine.js:86 |
| sector_agg | 2 | 0 | 2 | server/engines/morningBriefEngine.js:135 |
| newsletter_send_history | 1 | 1 | 2 | server/engines/newsletterEngine.js:263 |
| squeeze_signals | 1 | 1 | 2 | server/engines/shortSqueezeEngine.js:83 |
| signal_weight_calibration | 1 | 1 | 2 | server/engines/signalLearningEngine.js:203 |
| signal_catalysts | 1 | 1 | 2 | server/engines/signalNarrativeEngine.js:5 |
| stocks_in_play | 1 | 1 | 2 | server/engines/stocksInPlayEngine.js:117 |
| chart_trends | 1 | 1 | 2 | server/engines/trendDetectionEngine.js:147 |
| earnings_market_reaction | 2 | 0 | 2 | server/services/earnings/earningsController.ts:28 |
| feature_access_audit | 0 | 2 | 2 | server/services/featureAccessService.js:141 |
| signal_alerts | 0 | 2 | 2 | server/system/signalRouter.js:137 |
| activity_log | 1 | 1 | 2 | server/users/model.js:232 |
| user_preferences | 0 | 1 | 1 | scripts/smoke-personalization.js:41 |
| schema_migrations | 1 | 0 | 1 | server/db/migrate.js:21 |
| expected_moves | 0 | 1 | 1 | server/engines/expectedMoveEngine.js:54 |
| institutional_flow | 0 | 1 | 1 | server/engines/institutionalFlowEngine.js:53 |
| signal_engine_metrics | 0 | 1 | 1 | server/engines/liquiditySurgeEngine.js:85 |
| opportunities_v2 | 0 | 1 | 1 | server/engines/opportunityEngine.js:55 |
| provider_health | 0 | 1 | 1 | server/engines/providerHealthEngine.js:94 |
| sector_heatmap | 0 | 1 | 1 | server/engines/sectorEngine.js:62 |
| sector_base | 1 | 0 | 1 | server/engines/sectorMomentumEngine.js:24 |
| sector_rank | 1 | 0 | 1 | server/engines/sectorMomentumEngine.js:24 |
| catalyst_scores | 1 | 0 | 1 | server/engines/sectorMomentumEngine.js:24 |
| top_symbol | 1 | 0 | 1 | server/engines/sectorMomentumEngine.js:24 |
| i.timestamp | 1 | 0 | 1 | server/engines/sparklineCacheEngine.js:27 |
| active | 1 | 0 | 1 | server/engines/sparklineCacheEngine.js:27 |
| spark | 1 | 0 | 1 | server/engines/sparklineCacheEngine.js:27 |
| top5 | 1 | 0 | 1 | server/index.js:2478 |
| agg | 0 | 1 | 1 | server/index.js:3370 |
| strategy_accuracy | 0 | 1 | 1 | server/index.js:3370 |
| audit_log | 1 | 0 | 1 | server/routes/admin.js:224 |
| published_at | 1 | 0 | 1 | server/routes/chartV2.ts:287 |
| symbols | 1 | 0 | 1 | server/routes/marketContextRoutes.js:7 |
| metric_rows | 1 | 0 | 1 | server/routes/marketContextRoutes.js:7 |
| ohlc_latest | 0 | 1 | 1 | server/scripts/backfillMarketMetrics.js:16 |
| earnings_scores | 1 | 0 | 1 | server/services/earnings/earningsController.ts:42 |
| tier_feature_defaults | 1 | 0 | 1 | server/services/featureAccessService.js:55 |
| catalyst_rows | 1 | 0 | 1 | server/services/marketNewsFallback.js:24 |
| article_rows | 1 | 0 | 1 | server/services/marketNewsFallback.js:24 |
| email_rows | 1 | 0 | 1 | server/services/marketNewsFallback.js:24 |
| latest_catalyst | 1 | 0 | 1 | server/services/queryEngine.js:85 |
| feature_registry | 0 | 1 | 1 | server/system/featureBootstrap.js:131 |

### Per-occurrence extract (capped to first 600 entries)

| file_path:line | operation_type | table_name | columns_referenced | call_type |
| --- | --- | --- | --- | --- |
| scripts/fullMarketIngestion.ts:188 | write | intraday_1m | (none) | sql.query |
| scripts/fullMarketIngestion.ts:253 | read | ingestion_state | id, phase, last_symbol_index, status | sql.query |
| scripts/fullMarketIngestion.ts:259 | write | ingestion_state | id, phase, last_symbol_index, status, last_updated | sql.query |
| scripts/fullMarketIngestion.ts:281 | write | ingestion_state | last_symbol_index, phase, status, last_updated | sql.query |
| scripts/fullMarketIngestion.ts:295 | write | ingestion_state | phase, last_symbol_index, status, last_updated | sql.query |
| scripts/fullMarketIngestion.ts:315 | write | ingestion_state | status, last_updated | sql.query |
| scripts/fullMarketIngestion.ts:324 | write | ingestion_state | phase, status, last_symbol_index, last_updated | sql.query |
| scripts/fullMarketIngestion.ts:416 | read | (dynamic-sql) | count::int | sql.query |
| scripts/fullMarketIngestion.ts:422 | read | (dynamic-sql) | count::int | sql.query |
| scripts/generate-data-recovery-report.js:11 | read | opportunities | COUNT::int | sql.query |
| scripts/generate-engine-health-report.js:11 | read | opportunities | COUNT::int | sql.query |
| scripts/generate-integrity-report.js:12 | read | (dynamic-sql) | COUNT::bigint | sql.query |
| scripts/generate-integrity-report.js:25 | read | (dynamic-sql) | join(', ')} | sql.query |
| scripts/generate-performance-report.js:55 | read | (dynamic-sql) | (none) | sql.query |
| scripts/generate-stability-report.js:15 | read | (dynamic-sql) | COUNT::bigint | sql.query |
| scripts/generate-stability-report.js:30 | read | engine_errors | timestamp, engine, message | sql.query |
| scripts/generate-system-health-report.js:29 | read | information_schema.tables | table_name | sql.query |
| scripts/repairAdminUser.js:43 | read | users | id, username, email, is_admin, plan, is_active | supabase.select |
| scripts/run-acceptance-smoke.js:115 | read | market_quotes | COUNT::int | sql.query |
| scripts/smoke-personalization.js:41 | write | user_preferences | user_id, min_rvol, min_gap, preferred_sectors, enabled_strategies, updated_at | sql.query |
| scripts/smoke-personalization.js:41 | write | SET | user_id, min_rvol, min_gap, preferred_sectors, enabled_strategies, updated_at | sql.query |
| scripts/smoke-personalization.js:54 | write | user_watchlists | user_id, symbol | sql.query |
| scripts/systemAudit.ts:131 | read | daily_ohlc | symbol, {, head: | supabase.select |
| scripts/systemAudit.ts:235 | read | intraday_1m | symbol, {, head: | supabase.select |
| scripts/systemAudit.ts:245 | read | news_events | symbol, {, head: | supabase.select |
| scripts/systemAudit.ts:255 | read | daily_ohlc | symbol | supabase.select |
| scripts/systemAudit.ts:304 | read | news_events | symbol, {, head: | supabase.select |
| server/alerts/alert_engine.js:44 | read | information_schema.columns | table_name, column_name | sql.query |
| server/alerts/alert_engine.js:121 | read | user_alerts | alert_id, user_id, alert_name, query_tree, message_template, frequency, enabled, created_at, last_triggered | sql.query |
| server/alerts/alert_engine.js:201 | read | alert_history | symbol | sql.query |
| server/alerts/alert_engine.js:208 | read | alert_history | symbol | sql.query |
| server/alerts/alert_engine.js:243 | write | user_alerts | last_triggered | sql.query |
| server/alerts/alert_scheduler.js:18 | read | information_schema.tables | table_name | sql.query |
| server/alerts/notification_service.js:5 | write | alert_history | alert_id, symbol, message | sql.query |
| server/cache/sparklineCacheEngine.js:19 | read | market_quotes | symbol | sql.query |
| server/cache/sparklineCacheEngine.js:33 | read | timestamp | EXTRACT(EPOCH | sql.query |
| server/cache/sparklineCacheEngine.js:33 | read | intraday_1m | EXTRACT(EPOCH | sql.query |
| server/cache/tickerCache.js:18 | read | market_quotes | symbol, price, change_percent | sql.query |
| server/cache/tickerCache.js:26 | read | market_quotes | symbol, price, change_percent | sql.query |
| server/cache/tickerCache.js:34 | read | market_quotes | symbol, price, change_percent | sql.query |
| server/cache/tickerCache.js:42 | read | market_quotes | symbol, price, change_percent | sql.query |
| server/catalyst/catalyst_engine.js:77 | read | ticker_universe | symbol | sql.query |
| server/catalyst/catalyst_engine.js:87 | read | news_articles | headline, source, published_at, summary, symbols | sql.query |
| server/catalyst/catalyst_engine.js:140 | write | jsonb_to_recordset | symbol, catalyst_type, headline, source, sentiment, published_at, score, NOW(), created_at | sql.query |
| server/catalyst/catalyst_engine.js:140 | write | trade_catalysts | symbol, catalyst_type, headline, source, sentiment, published_at, score, NOW(), created_at | sql.query |
| server/catalyst/catalyst_engine.js:140 | write | SET | symbol, catalyst_type, headline, source, sentiment, published_at, score, NOW(), created_at | sql.query |
| server/catalyst/run_catalyst.js:9 | read | trade_catalysts | catalyst_type, COUNT::int | sql.query |
| server/db/index.js:27 | write | usage_events | ts, user, path | sql.query |
| server/db/index.js:31 | write | usage_events | (none) | sql.query |
| server/db/index.js:42 | read | usage_events | COUNT | sql.query |
| server/db/index.js:45 | read | usage_events | user, COUNT | sql.query |
| server/db/index.js:51 | read | usage_events | path, COUNT | sql.query |
| server/db/migrate.js:21 | read | schema_migrations | version | sql.query |
| server/db/sqlite_legacy.js:28 | write | usage_events | ts, user, path | sql.query |
| server/db/sqlite_legacy.js:33 | write | usage_events | (none) | sql.query |
| server/db/sqlite_legacy.js:44 | read | usage_events | COUNT | sql.query |
| server/db/sqlite_legacy.js:47 | read | usage_events | user, COUNT | sql.query |
| server/db/sqlite_legacy.js:53 | read | usage_events | path, COUNT | sql.query |
| server/discovery/discovery_engine.js:11 | read | trade_setups | UPPER, 'setup'::text, COALESCE(score, 0)::numeric | sql.query |
| server/discovery/discovery_engine.js:11 | read | trade_catalysts | UPPER, 'setup'::text, COALESCE(score, 0)::numeric | sql.query |
| server/discovery/discovery_engine.js:11 | read | earnings_events | UPPER, 'setup'::text, COALESCE(score, 0)::numeric | sql.query |
| server/discovery/discovery_engine.js:11 | read | setup_candidates | UPPER, 'setup'::text, COALESCE(score, 0)::numeric | sql.query |
| server/discovery/discovery_engine.js:11 | read | catalyst_candidates | UPPER, 'setup'::text, COALESCE(score, 0)::numeric | sql.query |
| server/discovery/discovery_engine.js:11 | read | earnings_candidates | UPPER, 'setup'::text, COALESCE(score, 0)::numeric | sql.query |
| server/discovery/discovery_engine.js:11 | read | all_candidates | UPPER, 'setup'::text, COALESCE(score, 0)::numeric | sql.query |
| server/discovery/discovery_engine.js:20 | read | trade_setups | UPPER, 'setup'::text, COALESCE(score, 0)::numeric | sql.query |
| server/discovery/discovery_engine.js:20 | read | trade_catalysts | UPPER, 'setup'::text, COALESCE(score, 0)::numeric | sql.query |
| server/discovery/discovery_engine.js:20 | read | earnings_events | UPPER, 'setup'::text, COALESCE(score, 0)::numeric | sql.query |
| server/discovery/discovery_engine.js:20 | read | setup_candidates | UPPER, 'setup'::text, COALESCE(score, 0)::numeric | sql.query |
| server/discovery/discovery_engine.js:20 | read | catalyst_candidates | UPPER, 'setup'::text, COALESCE(score, 0)::numeric | sql.query |
| server/discovery/discovery_engine.js:20 | read | earnings_candidates | UPPER, 'setup'::text, COALESCE(score, 0)::numeric | sql.query |
| server/discovery/discovery_engine.js:20 | read | all_candidates | UPPER, 'setup'::text, COALESCE(score, 0)::numeric | sql.query |
| server/discovery/discovery_engine.js:73 | write | jsonb_to_recordset | symbol, source, score, NOW(), detected_at | sql.query |
| server/discovery/discovery_engine.js:73 | write | discovered_symbols | symbol, source, score, NOW(), detected_at | sql.query |
| server/discovery/discovery_engine.js:73 | write | SET | symbol, source, score, NOW(), detected_at | sql.query |
| server/discovery/run_discovery.js:9 | read | discovered_symbols | source, COUNT::int | sql.query |
| server/engines/candleIntegrityEngine.js:15 | read | market_quotes | symbol | sql.query |
| server/engines/candleIntegrityEngine.js:29 | read | intraday_1m | timestamp | sql.query |
| server/engines/catalystEngine.js:109 | read | market_quotes | UPPER | sql.query |
| server/engines/catalystEngine.js:120 | read | news_articles | id, headline, source, published_at | sql.query |
| server/engines/catalystEngine.js:167 | write | news_catalysts | symbol, catalyst_type, headline, source, sentiment, impact_score, published_at, updated_at | sql.query |
| server/engines/catalystEngine.js:167 | write | SET | symbol, catalyst_type, headline, source, sentiment, impact_score, published_at, updated_at | sql.query |
| server/engines/dataIntegrityEngine.js:37 | write | data_integrity_events | event_type, source, symbol, issue, severity, payload, created_at | sql.query |
| server/engines/duplicateTickEngine.js:10 | read | intraday_1m | symbol, timestamp, COUNT::int | sql.query |
| server/engines/duplicateTickEngine.js:20 | read | market_quotes | symbol, COUNT::int | sql.query |
| server/engines/earlyAccumulationEngine.js:92 | read | market_metrics | symbol, price, 0), volume, avg_volume_30d, relative_volume, float_shares, market_cap, 0) > 0 THEN  ELSE 0 END, 0 ), change_percent, sector, 'Unknown') | sql.query |
| server/engines/earlyAccumulationEngine.js:92 | read | market_quotes | symbol, price, 0), volume, avg_volume_30d, relative_volume, float_shares, market_cap, 0) > 0 THEN  ELSE 0 END, 0 ), change_percent, sector, 'Unknown') | sql.query |
| server/engines/earlyAccumulationEngine.js:132 | write | early_accumulation_signals | $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW() WHERE NOT EXISTS ( SELECT 1, symbol, price, volume, avg_volume_30d, relative_volume, float_shares, float_rotation, liquidity_surge, volume_delta, accumulation_score, pressure_level, sector, detected_at | sql.query |
| server/engines/earlySignalOutcomeEngine.js:55 | read | early_accumulation_signals | id, symbol, price, detected_at | sql.query |
| server/engines/earlySignalOutcomeEngine.js:55 | read | market_quotes | id, symbol, price, detected_at | sql.query |
| server/engines/earlySignalOutcomeEngine.js:95 | write | early_signal_outcomes | signal_id, symbol, entry_price, price_1h, price_4h, price_1d, price_5d, price_30d, max_move_percent, updated_at | sql.query |
| server/engines/earlySignalOutcomeEngine.js:95 | write | SET | signal_id, symbol, entry_price, price_1h, price_4h, price_1d, price_5d, price_30d, max_move_percent, updated_at | sql.query |
| server/engines/earningsEngine.js:81 | write | earnings_events | symbol, company, earnings_date, time, eps_estimate, revenue_estimate, sector, updated_at | sql.query |
| server/engines/earningsEngine.js:81 | write | SET | symbol, company, earnings_date, time, eps_estimate, revenue_estimate, sector, updated_at | sql.query |
| server/engines/engineErrorIsolation.js:33 | write | engine_errors | engine, message, stack, timestamp | sql.query |
| server/engines/expectedMoveEngine.js:23 | read | earnings_events | symbol, earnings_date, price, 0), atr_percent, price)) * 100 ELSE NULL END, ABS, change_percent, change_percent)), 0 ) | sql.query |
| server/engines/expectedMoveEngine.js:23 | read | market_metrics | symbol, earnings_date, price, 0), atr_percent, price)) * 100 ELSE NULL END, ABS, change_percent, change_percent)), 0 ) | sql.query |
| server/engines/expectedMoveEngine.js:23 | read | market_quotes | symbol, earnings_date, price, 0), atr_percent, price)) * 100 ELSE NULL END, ABS, change_percent, change_percent)), 0 ) | sql.query |
| server/engines/expectedMoveEngine.js:54 | write | expected_moves | symbol, expected_move, atr_percent, price, earnings_date, updated_at | sql.query |
| server/engines/expectedMoveEngine.js:54 | write | SET | symbol, expected_move, atr_percent, price, earnings_date, updated_at | sql.query |
| server/engines/flowDetectionEngine.js:53 | read | market_metrics | symbol, COALESCE(relative_volume, 0), COALESCE(float_rotation, COALESCE(liquidity_surge, CASE WHEN COALESCE(relative_volume, 0) >= 4 THEN 'aggressive' WHEN COALESCE(relative_volume, 0) >= 2 THEN 'building' ELSE 'watch' END | sql.query |
| server/engines/flowDetectionEngine.js:86 | write | flow_signals | symbol, flow_score, pressure_level, relative_volume, float_rotation, liquidity_surge, detected_at | sql.query |
| server/engines/flowDetectionEngine.js:132 | read | flow_signals | id, symbol, flow_score, pressure_level, relative_volume, float_rotation, liquidity_surge, detected_at | sql.query |
| server/engines/fmpMarketIngestion.js:254 | write | market_quotes | symbol, price, change_percent, volume, market_cap, sector, updated_at | sql.query |
| server/engines/fmpMarketIngestion.js:254 | write | SET | symbol, price, change_percent, volume, market_cap, sector, updated_at | sql.query |
| server/engines/fmpMarketIngestion.js:399 | read | market_quotes | symbol | sql.query |
| server/engines/institutionalFlowEngine.js:28 | read | market_metrics | symbol, COALESCE(relative_volume, 0), COALESCE(volume, COALESCE(change_percent, CASE WHEN COALESCE(change_percent, 0) >= 4 THEN 1 WHEN COALESCE(change_percent, 3 END | sql.query |
| server/engines/institutionalFlowEngine.js:53 | write | institutional_flow | symbol, relative_volume, volume, breakout_score, score, detected_at | sql.query |
| server/engines/intelAnalysisEngine.js:104 | write | news_articles | ai_analysis | sql.query |
| server/engines/intelNarrativeEngine.js:150 | read | intel_news | id, headline | sql.query |
| server/engines/intelNarrativeEngine.js:208 | write | intel_news | narrative, detected_symbols, catalyst_type, expected_move, score_breakdown, narrative_confidence, narrative_type, time_horizon, regime | sql.query |
| server/engines/intelNewsEngine.js:49 | write | intel_news | symbol, headline, source, url, published_at, sentiment, updated_at | sql.query |
| server/engines/intelNewsEngine.js:49 | write | SET | symbol, headline, source, url, published_at, sentiment, updated_at | sql.query |
| server/engines/liquiditySurgeEngine.js:85 | write | signal_engine_metrics | symbol, engine, metric_value, score_contribution, payload, updated_at | sql.query |
| server/engines/liquiditySurgeEngine.js:85 | write | SET | symbol, engine, metric_value, score_contribution, payload, updated_at | sql.query |
| server/engines/marketNarrativeEngine.js:100 | write | market_narratives | narrative, regime, created_at | sql.query |
| server/engines/marketNarrativeEngine.js:133 | read | market_narratives | narrative, regime, created_at | sql.query |
| server/engines/mcpContextEngine.js:6 | read | strategy_signals | symbol, strategy, score | sql.query |
| server/engines/mcpContextEngine.js:14 | read | market_metrics | symbol, close, change_percent | sql.query |
| server/engines/mcpContextEngine.js:21 | read | market_metrics | sector, AVG, COUNT | sql.query |
| server/engines/mcpContextEngine.js:33 | read | strategy_signals | symbol, strategy, score, updated_at | sql.query |
| server/engines/mcpNarrativeEngine.js:42 | read | strategy_signals | id, symbol, strategy, updated_at | sql.query |
| server/engines/mcpNarrativeEngine.js:60 | read | signal_narratives | id, mcp_context | sql.query |
| server/engines/mcpNarrativeEngine.js:89 | write | signal_narratives | mcp_context | sql.query |
| server/engines/metricsEngine.js:29 | read | market_quotes | symbol, price, volume, market_cap, avg_volume_30d, change_percent END, avg_volume_30d ELSE NULL END, price ELSE NULL END, high_price, low_price, 0) > 0 THEN  * 100 ELSE NULL END | sql.query |
| server/engines/metricsEngine.js:29 | read | daily_ohlc | symbol, price, volume, market_cap, avg_volume_30d, change_percent END, avg_volume_30d ELSE NULL END, price ELSE NULL END, high_price, low_price, 0) > 0 THEN  * 100 ELSE NULL END | sql.query |
| server/engines/metricsEngine.js:29 | read | LATERAL | symbol, price, volume, market_cap, avg_volume_30d, change_percent END, avg_volume_30d ELSE NULL END, price ELSE NULL END, high_price, low_price, 0) > 0 THEN  * 100 ELSE NULL END | sql.query |
| server/engines/metricsEngine.js:123 | write | market_metrics | symbol, price, change_percent, gap_percent, relative_volume, volume, avg_volume_30d, float_shares, atr_percent, updated_at | sql.query |
| server/engines/metricsEngine.js:123 | write | SET | symbol, price, change_percent, gap_percent, relative_volume, volume, avg_volume_30d, float_shares, atr_percent, updated_at | sql.query |
| server/engines/morningBriefEngine.js:45 | read | trade_signals | symbol, strategy, score, confidence, narrative, catalyst_type, 'unknown'), updated_at, relative_volume, 0) | sql.query |
| server/engines/morningBriefEngine.js:45 | read | news_catalysts | symbol, strategy, score, confidence, narrative, catalyst_type, 'unknown'), updated_at, relative_volume, 0) | sql.query |
| server/engines/morningBriefEngine.js:45 | read | market_metrics | symbol, strategy, score, confidence, narrative, catalyst_type, 'unknown'), updated_at, relative_volume, 0) | sql.query |
| server/engines/morningBriefEngine.js:45 | read | LATERAL | symbol, strategy, score, confidence, narrative, catalyst_type, 'unknown'), updated_at, relative_volume, 0) | sql.query |
| server/engines/morningBriefEngine.js:74 | read | market_metrics | symbol, price, change_percent, updated_at | sql.query |
| server/engines/morningBriefEngine.js:92 | read | news_articles | headline, source, url, published_at, summary, symbols, news_score | sql.query |
| server/engines/morningBriefEngine.js:105 | read | trade_signals | symbol, strategy, score, gap_percent, rvol, atr_percent, created_at | sql.query |
| server/engines/morningBriefEngine.js:118 | read | news_catalysts | symbol, catalyst_type, headline, impact_score, published_at | sql.query |
| server/engines/morningBriefEngine.js:135 | read | sector_agg | sector, market_cap, volume, relative_volume, price_change | sql.query |
| server/engines/morningBriefEngine.js:152 | read | earnings_events | symbol, company, earnings_date::text, eps_estimate, revenue_estimate | sql.query |
| server/engines/morningBriefEngine.js:170 | read | market_metrics | symbol, price, change_percent | sql.query |
| server/engines/morningBriefEngine.js:253 | write | morning_briefings | signals, market, news, stocks_in_play, narrative, email_status | sql.query |
| server/engines/morningBriefEngine.js:310 | write | morning_briefings | email_status | sql.query |
| server/engines/narrativeEngine.js:20 | read | news_catalysts | symbol, catalyst_type, headline, impact_score, published_at | sql.query |
| server/engines/narrativeEngine.js:29 | read | news_articles | headline, source, published_at | sql.query |
| server/engines/narrativeEngine.js:38 | read | market_metrics | symbol, change_percent, relative_volume, volume | sql.query |
| server/engines/narrativeEngine.js:69 | write | market_narratives | narrative, regime, created_at | sql.query |
| server/engines/newsletterEngine.js:155 | write | daily_signal_snapshot | (none) | sql.query |
| server/engines/newsletterEngine.js:163 | write | daily_signal_snapshot | $1::date, symbol, score, confidence, strategy, catalyst, sector, entry_price, NOW(), snapshot_date, created_at | sql.query |
| server/engines/newsletterEngine.js:206 | read | signal_hierarchy | symbol, score, confidence, strategy, strategy), catalyst_type, 'unknown'), sector, 'Unknown'), price, 0), signal_class, hierarchy_rank | sql.query |
| server/engines/newsletterEngine.js:206 | read | news_catalysts | symbol, score, confidence, strategy, strategy), catalyst_type, 'unknown'), sector, 'Unknown'), price, 0), signal_class, hierarchy_rank | sql.query |
| server/engines/newsletterEngine.js:206 | read | trade_signals | symbol, score, confidence, strategy, strategy), catalyst_type, 'unknown'), sector, 'Unknown'), price, 0), signal_class, hierarchy_rank | sql.query |
| server/engines/newsletterEngine.js:206 | read | LATERAL | symbol, score, confidence, strategy, strategy), catalyst_type, 'unknown'), sector, 'Unknown'), price, 0), signal_class, hierarchy_rank | sql.query |
| server/engines/newsletterEngine.js:206 | read | market_quotes | symbol, score, confidence, strategy, strategy), catalyst_type, 'unknown'), sector, 'Unknown'), price, 0), signal_class, hierarchy_rank | sql.query |
| server/engines/newsletterEngine.js:232 | read | news_catalysts | symbol, catalyst_type, impact_score | sql.query |
| server/engines/newsletterEngine.js:240 | read | sector_momentum | sector, momentum_score | sql.query |
| server/engines/newsletterEngine.js:248 | read | market_narratives | narrative | sql.query |
| server/engines/newsletterEngine.js:256 | read | newsletter_subscribers | COUNT::int | sql.query |
| server/engines/newsletterEngine.js:263 | read | newsletter_send_history | sent_at, recipients_count, open_rate, click_rate, status | sql.query |
| server/engines/opportunityEngine.js:36 | read | tradable_universe | symbol, change_percent, relative_volume, volume, gap_percent, 0), 0) * 3)) | sql.query |
| server/engines/opportunityEngine.js:36 | read | market_metrics | symbol, change_percent, relative_volume, volume, gap_percent, 0), 0) * 3)) | sql.query |
| server/engines/opportunityEngine.js:55 | write | opportunities_v2 | symbol, score, change_percent, relative_volume, gap_percent, strategy, volume, updated_at | sql.query |
| server/engines/opportunityEngine.js:55 | write | SET | symbol, score, change_percent, relative_volume, gap_percent, strategy, volume, updated_at | sql.query |
| server/engines/opportunityRanker.js:33 | read | market_metrics | symbol, gap_percent, 0), relative_volume, score, change_percent | sql.query |
| server/engines/opportunityRanker.js:33 | read | trade_setups | symbol, gap_percent, 0), relative_volume, score, change_percent | sql.query |
| server/engines/opportunityRanker.js:33 | read | trade_catalysts | symbol, gap_percent, 0), relative_volume, score, change_percent | sql.query |
| server/engines/opportunityRanker.js:33 | read | LATERAL | symbol, gap_percent, 0), relative_volume, score, change_percent | sql.query |
| server/engines/opportunityRanker.js:86 | write | opportunity_stream | symbol, event_type, headline, score, source, created_at | sql.query |
| server/engines/orderFlowImbalanceEngine.js:45 | read | market_metrics | symbol, price, 0), relative_volume, volume, avg_volume_30d, float_shares, market_cap, 0) > 0 THEN  ELSE 0 END, 0 ), change_percent | sql.query |
| server/engines/orderFlowImbalanceEngine.js:45 | read | market_quotes | symbol, price, 0), relative_volume, volume, avg_volume_30d, float_shares, market_cap, 0) > 0 THEN  ELSE 0 END, 0 ), change_percent | sql.query |
| server/engines/orderFlowImbalanceEngine.js:109 | write | order_flow_signals | $1, $2, $3, $4, $5, $6, $7, NOW() WHERE NOT EXISTS ( SELECT 1, symbol, price, relative_volume, float_rotation, liquidity_surge, pressure_score, pressure_level, detected_at | sql.query |
| server/engines/priceAnomalyEngine.js:18 | read | market_quotes | symbol | sql.query |
| server/engines/priceAnomalyEngine.js:32 | read | intraday_1m | timestamp, close, volume | sql.query |
| server/engines/providerHealthEngine.js:94 | write | jsonb_to_recordset | provider, status, latency, NOW(), created_at | sql.query |
| server/engines/providerHealthEngine.js:94 | write | provider_health | provider, status, latency, NOW(), created_at | sql.query |
| server/engines/radarEngine.js:14 | read | strategy_signals | (none) | sql.query |
| server/engines/sectorEngine.js:23 | read | market_metrics | sector, 'Unknown'), symbol, change_percent, 0), volume | sql.query |
| server/engines/sectorEngine.js:23 | read | base | sector, 'Unknown'), symbol, change_percent, 0), volume | sql.query |
| server/engines/sectorEngine.js:23 | read | ranked | sector, 'Unknown'), symbol, change_percent, 0), volume | sql.query |
| server/engines/sectorEngine.js:23 | read | market_quotes | sector, 'Unknown'), symbol, change_percent, 0), volume | sql.query |
| server/engines/sectorEngine.js:62 | write | sector_heatmap | sector, avg_change, total_volume, stocks, leaders, updated_at | sql.query |
| server/engines/sectorEngine.js:62 | write | SET | sector, avg_change, total_volume, stocks, leaders, updated_at | sql.query |
| server/engines/sectorMomentumEngine.js:24 | read | news_catalysts | symbol, MAX(COALESCE(impact_score, 0)) | sql.query |
| server/engines/sectorMomentumEngine.js:24 | read | market_metrics | symbol, MAX(COALESCE(impact_score, 0)) | sql.query |
| server/engines/sectorMomentumEngine.js:24 | read | sector_base | symbol, MAX(COALESCE(impact_score, 0)) | sql.query |
| server/engines/sectorMomentumEngine.js:24 | read | sector_rank | symbol, MAX(COALESCE(impact_score, 0)) | sql.query |
| server/engines/sectorMomentumEngine.js:24 | read | market_quotes | symbol, MAX(COALESCE(impact_score, 0)) | sql.query |
| server/engines/sectorMomentumEngine.js:24 | read | catalyst_scores | symbol, MAX(COALESCE(impact_score, 0)) | sql.query |
| server/engines/sectorMomentumEngine.js:24 | read | top_symbol | symbol, MAX(COALESCE(impact_score, 0)) | sql.query |
| server/engines/sectorMomentumEngine.js:78 | write | sector_momentum | sector, momentum_score, avg_gap, avg_rvol, top_symbol, updated_at | sql.query |
| server/engines/sectorMomentumEngine.js:78 | write | SET | sector, momentum_score, avg_gap, avg_rvol, top_symbol, updated_at | sql.query |
| server/engines/shortSqueezeEngine.js:53 | read | market_metrics | symbol, COALESCE(short_float, 0), COALESCE(relative_volume, COALESCE(change_percent, COALESCE(float_shares | sql.query |
| server/engines/shortSqueezeEngine.js:83 | write | squeeze_signals | symbol, short_float, relative_volume, price_change, float_shares, score, detected_at | sql.query |
| server/engines/shortSqueezeEngine.js:129 | read | squeeze_signals | id, symbol, short_float, relative_volume, price_change, float_shares, score, detected_at | sql.query |
| server/engines/signalHierarchyEngine.js:78 | read | trade_signals | symbol, strategy, score, confidence, rvol, gap_percent, float_rotation, liquidity_surge, catalyst_score | sql.query |
| server/engines/signalHierarchyEngine.js:121 | write | signal_hierarchy | symbol, hierarchy_rank, signal_class, strategy, score, confidence, updated_at | sql.query |
| server/engines/signalHierarchyEngine.js:121 | write | SET | symbol, hierarchy_rank, signal_class, strategy, score, confidence, updated_at | sql.query |
| server/engines/signalLearningEngine.js:203 | write | signal_weight_calibration | component, weight, success_rate, avg_move, signals_analyzed, updated_at | sql.query |
| server/engines/signalLearningEngine.js:203 | write | SET | component, weight, success_rate, avg_move, signals_analyzed, updated_at | sql.query |
| server/engines/signalLearningEngine.js:235 | read | signal_component_outcomes | (none) | sql.query |
| server/engines/signalNarrativeEngine.js:5 | read | signal_catalysts | id | sql.query |
| server/engines/signalNarrativeEngine.js:16 | write | signal_catalysts | signal_id, symbol, strategy, catalyst_type, catalyst_source, headline, source, strength, published_at | sql.query |
| server/engines/signalNarrativeEngine.js:51 | read | strategy_signals | id, symbol, strategy, class, score, updated_at | sql.query |
| server/engines/signalNarrativeEngine.js:62 | read | signal_narratives | id | sql.query |
| server/engines/signalNarrativeEngine.js:74 | read | news_articles | headline, news_score, catalyst_type, source, published_at | sql.query |
| server/engines/signalNarrativeEngine.js:91 | write | signal_narratives | signal_id, symbol, strategy, headline, source, catalyst_type, news_score, published_at, mcp_context, created_at | sql.query |
| server/engines/signalNarrativeEngine.js:116 | write | strategy_signals | catalyst_count | sql.query |
| server/engines/signalOutcomeWriter.js:92 | read | trade_signals | score, gap_percent, rvol, float_rotation, liquidity_surge, catalyst_score, sector_score, confirmation_score | sql.query |
| server/engines/signalOutcomeWriter.js:117 | write | signal_component_outcomes | snapshot_date, snapshot_day, symbol, score, gap_percent, rvol, float_rotation, liquidity_surge, catalyst_score, sector_score, confirmation_score, created_at | sql.query |
| server/engines/signalOutcomeWriter.js:167 | read | signal_component_outcomes | id, symbol | sql.query |
| server/engines/signalOutcomeWriter.js:187 | read | market_metrics | open, price, 0), high | sql.query |
| server/engines/signalOutcomeWriter.js:187 | read | daily_ohlc | open, price, 0), high | sql.query |
| server/engines/signalOutcomeWriter.js:187 | read | LATERAL | open, price, 0), high | sql.query |
| server/engines/signalOutcomeWriter.js:215 | write | signal_component_outcomes | move_percent, success, outcome_updated_at | sql.query |
| server/engines/signalPerformanceEngine.js:200 | read | daily_signal_snapshot | symbol, entry_price, price, 0) | sql.query |
| server/engines/signalPerformanceEngine.js:200 | read | market_quotes | symbol, entry_price, price, 0) | sql.query |
| server/engines/signalPerformanceEngine.js:241 | write | signal_performance | (none) | sql.query |
| server/engines/signalPerformanceEngine.js:249 | write | signal_performance | $1::date, symbol, entry_price, current_price, return_percent, NOW(), snapshot_date, updated_at, created_at | sql.query |
| server/engines/signalPerformanceEngine.js:290 | read | strategy_signals | (none) | sql.query |
| server/engines/signalPerformanceEngine.js:299 | read | market_metrics | COALESCE(price, 0) | sql.query |
| server/engines/signalPerformanceEngine.js:324 | write | signal_performance | signal_id, symbol, strategy, class, score, probability, entry_price, current_price, return_percent, max_upside, max_drawdown, outcome, evaluated_at, updated_at | sql.query |
| server/engines/signalScoringEngine.js:143 | read | signal_weight_calibration | component, weight | sql.query |
| server/engines/signalScoringEngine.js:178 | read | order_flow_signals | pressure_level, pressure_score | sql.query |
| server/engines/signalScoringEngine.js:201 | read | sector_momentum | momentum_score | sql.query |
| server/engines/sparklineCacheEngine.js:27 | read | market_quotes | symbol | sql.query |
| server/engines/sparklineCacheEngine.js:27 | read | i.timestamp | symbol | sql.query |
| server/engines/sparklineCacheEngine.js:27 | read | intraday_1m | symbol | sql.query |
| server/engines/sparklineCacheEngine.js:27 | read | active | symbol | sql.query |
| server/engines/sparklineCacheEngine.js:27 | read | spark | symbol | sql.query |
| server/engines/sparklineCacheEngine.js:57 | write | sparkline_cache | symbol, data, updated_at | sql.query |
| server/engines/sparklineCacheEngine.js:57 | write | SET | symbol, data, updated_at | sql.query |
| server/engines/sparklineCacheEngine.js:99 | read | sparkline_cache | data | sql.query |
| server/engines/sparklineCacheEngine.js:115 | read | sparkline_cache | COUNT::int, MAX | sql.query |
| server/engines/stocksInPlayEngine.js:117 | write | stocks_in_play | symbol, gap_percent, rvol, catalyst, score, detected_at | sql.query |
| server/engines/stocksInPlayEngine.js:249 | write | trade_signals | symbol, strategy, score, gap_percent, rvol, atr_percent, confidence, score_breakdown, float_rotation, liquidity_surge, catalyst_score, sector_score, confirmation_score, narrative, catalyst_type, sector, signal_explanation, rationale, created_at, updated_at | sql.query |
| server/engines/stocksInPlayEngine.js:249 | write | SET | symbol, strategy, score, gap_percent, rvol, atr_percent, confidence, score_breakdown, float_rotation, liquidity_surge, catalyst_score, sector_score, confirmation_score, narrative, catalyst_type, sector, signal_explanation, rationale, created_at, updated_at | sql.query |
| server/engines/strategyEngine.js:74 | write | strategy_signals | (none) | sql.query |
| server/engines/strategyEngine.js:81 | write | strategy_signals | ctid, ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY updated_at DESC NULLS LAST, ctid DESC) | sql.query |
| server/engines/strategyEngine.js:111 | read | tradable_universe | symbol, price, price), change_percent, 0), gap_percent, relative_volume, volume, previous_close | sql.query |
| server/engines/strategyEngine.js:111 | read | daily_ohlc | symbol, price, price), change_percent, 0), gap_percent, relative_volume, volume, previous_close | sql.query |
| server/engines/strategyEngine.js:111 | read | market_metrics | symbol, price, price), change_percent, 0), gap_percent, relative_volume, volume, previous_close | sql.query |
| server/engines/strategyEngine.js:111 | read | LATERAL | symbol, price, price), change_percent, 0), gap_percent, relative_volume, volume, previous_close | sql.query |
| server/engines/strategyEngine.js:149 | write | strategy_signals | symbol, strategy, class, score, probability, change_percent, gap_percent, relative_volume, volume, updated_at | sql.query |
| server/engines/strategyEngine.js:149 | write | SET | symbol, strategy, class, score, probability, change_percent, gap_percent, relative_volume, volume, updated_at | sql.query |
| server/engines/strategyEvaluationEngine.js:46 | write | trade_signals | symbol, strategy, price, NOW(), entry_price, entry_time, created_at | sql.query |
| server/engines/strategyEvaluationEngine.js:46 | write | strategy_trades | symbol, strategy, price, NOW(), entry_price, entry_time, created_at | sql.query |
| server/engines/strategyEvaluationEngine.js:46 | write | market_quotes | symbol, strategy, price, NOW(), entry_price, entry_time, created_at | sql.query |
| server/engines/strategyEvaluationEngine.js:80 | read | strategy_trades | id, symbol, strategy, entry_price, entry_time, price, change_percent, atr_percent | sql.query |
| server/engines/strategyEvaluationEngine.js:80 | read | market_quotes | id, symbol, strategy, entry_price, entry_time, price, change_percent, atr_percent | sql.query |
| server/engines/strategyEvaluationEngine.js:80 | read | market_metrics | id, symbol, strategy, entry_price, entry_time, price, change_percent, atr_percent | sql.query |
| server/engines/strategyEvaluationEngine.js:123 | write | strategy_trades | exit_price, exit_time, max_move, result_percent | sql.query |
| server/engines/strategyEvaluationEngine.js:142 | read | strategy_trades | strategy, COUNT::int, ROUND::numeric, 4), 2), ROUND(  AVG(CASE WHEN result_percent > 0 THEN result_percent END, 0), 0 )::numeric, 4 ) | sql.query |
| server/engines/systemAlertEngine.js:58 | write | system_alerts | type, source, severity, message, acknowledged, created_at | sql.query |
| server/engines/trendDetectionEngine.js:107 | read | daily_ohlc | date::text, open, high, low, close, volume | sql.query |
| server/engines/trendDetectionEngine.js:147 | write | chart_trends | symbol, trend, support, resistance, channel, breakouts, computed_at, updated_at | sql.query |
| server/engines/trendDetectionEngine.js:147 | write | SET | symbol, trend, support, resistance, channel, breakouts, computed_at, updated_at | sql.query |
| server/engines/trendDetectionEngine.js:188 | read | tradable_universe | symbol | sql.query |
| server/engines/universeBuilder.js:31 | read | market_metrics | symbol, price, change_percent, gap_percent, relative_volume, volume, avg_volume_30d, updated_at | sql.query |
| server/engines/universeBuilder.js:62 | write | tradable_universe | symbol, price, change_percent, gap_percent, relative_volume, volume, avg_volume_30d, updated_at | sql.query |
| server/engines/universeBuilder.js:62 | write | SET | symbol, price, change_percent, gap_percent, relative_volume, volume, avg_volume_30d, updated_at | sql.query |
| server/engines/universeBuilder.js:95 | write | tradable_universe | 1 | sql.query |
| server/engines/universeBuilder.js:95 | write | market_metrics | 1 | sql.query |
| server/events/eventLogger.js:30 | write | system_events | event_type, source, symbol, payload, created_at | sql.query |
| server/index.js:707 | read | market_metrics | symbol, (to_jsonb(m, ::numeric, gap_percent, 0), relative_volume, sector, 'Unknown') | sql.query |
| server/index.js:707 | read | market_quotes | symbol, (to_jsonb(m, ::numeric, gap_percent, 0), relative_volume, sector, 'Unknown') | sql.query |
| server/index.js:738 | read | news_articles | symbol, headline, source, published_at, url | sql.query |
| server/index.js:944 | read | information_schema.tables | table_name | sql.query |
| server/index.js:972 | read | (dynamic-sql) | COUNT::int | sql.query |
| server/index.js:1101 | read | system_events | id, event_type, source, symbol, payload, created_at | sql.query |
| server/index.js:1118 | read | data_integrity_events | id, event_type, source, symbol, issue, severity, payload, created_at | sql.query |
| server/index.js:1135 | read | system_alerts | id, type, source, severity, message, acknowledged, created_at | sql.query |
| server/index.js:1211 | read | trade_setups | catalyst_type, headline, source, sentiment, published_at, score | sql.query |
| server/index.js:1211 | read | trade_catalysts | catalyst_type, headline, source, sentiment, published_at, score | sql.query |
| server/index.js:1211 | read | LATERAL | catalyst_type, headline, source, sentiment, published_at, score | sql.query |
| server/index.js:1244 | read | trade_setups | setup, COUNT::int | sql.query |
| server/index.js:1260 | read | trade_catalysts | symbol, catalyst_type, headline, source, sentiment, published_at, score, created_at | sql.query |
| server/index.js:1282 | read | market_metrics | symbol, company_name, sector, industry, price, gap_percent, relative_volume, atr, float_rotation, setup, grade, score | sql.query |
| server/index.js:1282 | read | ticker_universe | symbol, company_name, sector, industry, price, gap_percent, relative_volume, atr, float_rotation, setup, grade, score | sql.query |
| server/index.js:1282 | read | trade_setups | symbol, company_name, sector, industry, price, gap_percent, relative_volume, atr, float_rotation, setup, grade, score | sql.query |
| server/index.js:1313 | read | discovered_symbols | source, score | sql.query |
| server/index.js:1313 | read | market_metrics | source, score | sql.query |
| server/index.js:1334 | read | market_metrics | (none) | sql.query |
| server/index.js:1996 | read | earnings_events | symbol, earnings_date::text, company, time, eps_estimate, revenue_estimate, sector, updated_at | sql.query |
| server/index.js:2017 | read | earnings_events | symbol, company, earnings_date::text, time, eps_estimate, revenue_estimate, sector, updated_at | sql.query |
| server/index.js:2074 | read | earnings_events | symbol, company, earnings_date::text, time, eps_estimate, revenue_estimate, sector, updated_at | sql.query |
| server/index.js:2095 | read | earnings_events | symbol, earnings_date::text, company, time, eps_estimate, revenue_estimate, sector, updated_at | sql.query |
| server/index.js:2131 | read | trade_setups | NULLIF(to_jsonb(ts, ''), NULLIF->>'setup', NULLIF->>'strategy', 'Momentum Continuation'), (to_jsonb(ts, ::numeric, 0), ::timestamptz, NOW, symbol | sql.query |
| server/index.js:2165 | read | strategy_signals | symbol, strategy, score, class, gap_percent, relative_volume, sector, headline, subject, 'No catalyst available') | sql.query |
| server/index.js:2165 | read | intel_news | symbol, strategy, score, class, gap_percent, relative_volume, sector, headline, subject, 'No catalyst available') | sql.query |
| server/index.js:2165 | read | intelligence_emails | symbol, strategy, score, class, gap_percent, relative_volume, sector, headline, subject, 'No catalyst available') | sql.query |
| server/index.js:2165 | read | market_quotes | symbol, strategy, score, class, gap_percent, relative_volume, sector, headline, subject, 'No catalyst available') | sql.query |
| server/index.js:2165 | read | LATERAL | symbol, strategy, score, class, gap_percent, relative_volume, sector, headline, subject, 'No catalyst available') | sql.query |
| server/index.js:2226 | read | user_watchlists | symbol, strategy, class, score, probability, change_percent, gap_percent, relative_volume, volume, sector, updated_at | sql.query |
| server/index.js:2226 | read | strategy_signals | symbol, strategy, class, score, probability, change_percent, gap_percent, relative_volume, volume, sector, updated_at | sql.query |
| server/index.js:2226 | read | market_quotes | symbol, strategy, class, score, probability, change_percent, gap_percent, relative_volume, volume, sector, updated_at | sql.query |
| server/index.js:2274 | write | user_signal_feedback | user_id, signal_id, rating, created_at | sql.query |
| server/index.js:2274 | write | SET | user_id, signal_id, rating, created_at | sql.query |
| server/index.js:2300 | read | user_signal_feedback | COUNT::int | sql.query |
| server/index.js:2311 | read | user_signal_feedback | strategy, 'Unknown'), AVG::numeric | sql.query |
| server/index.js:2311 | read | strategy_signals | strategy, 'Unknown'), AVG::numeric | sql.query |
| server/index.js:2326 | read | user_signal_feedback | strategy, 'Unknown'), AVG::numeric | sql.query |
| server/index.js:2326 | read | strategy_signals | strategy, 'Unknown'), AVG::numeric | sql.query |
| server/index.js:2379 | read | market_quotes | symbol, price, change_percent, volume, market_cap, sector, updated_at | sql.query |
| server/index.js:2397 | read | market_quotes | symbol, price, change_percent, volume, market_cap, sector, relative_volume, gap_percent, updated_at | sql.query |
| server/index.js:2397 | read | market_metrics | symbol, price, change_percent, volume, market_cap, sector, relative_volume, gap_percent, updated_at | sql.query |
| server/index.js:2423 | read | market_metrics | sector, 'Unknown'), symbol, change_percent, 0), volume | sql.query |
| server/index.js:2423 | read | base | sector, 'Unknown'), symbol, change_percent, 0), volume | sql.query |
| server/index.js:2423 | read | ranked | sector, 'Unknown'), symbol, change_percent, 0), volume | sql.query |
| server/index.js:2423 | read | market_quotes | sector, 'Unknown'), symbol, change_percent, 0), volume | sql.query |
| server/index.js:2478 | read | market_quotes | sector, 'Unknown'), symbol, market_cap, 0), (to_jsonb(m, change_percent, gap_percent, 0) DESC NULLS LAST ) | sql.query |
| server/index.js:2478 | read | ranked | sector, 'Unknown'), symbol, market_cap, 0), (to_jsonb(m, change_percent, gap_percent, 0) DESC NULLS LAST ) | sql.query |
| server/index.js:2478 | read | top5 | sector, 'Unknown'), symbol, market_cap, 0), (to_jsonb(m, change_percent, gap_percent, 0) DESC NULLS LAST ) | sql.query |
| server/index.js:2478 | read | market_metrics | sector, 'Unknown'), symbol, market_cap, 0), (to_jsonb(m, change_percent, gap_percent, 0) DESC NULLS LAST ) | sql.query |
| server/index.js:2539 | read | market_metrics | symbol, price, price), change_percent, change_percent), gap_percent, relative_volume, volume, volume), sector, 'Unknown') | sql.query |
| server/index.js:2539 | read | market_quotes | symbol, price, price), change_percent, change_percent), gap_percent, relative_volume, volume, volume), sector, 'Unknown') | sql.query |
| server/index.js:2566 | read | market_quotes | symbol, price, change_percent | sql.query |
| server/index.js:2591 | read | market_quotes | symbol, price, change_percent, sector | sql.query |
| server/index.js:2645 | read | earnings_events | symbol, price, 0), atr, gap_percent, change_percent, change_percent)), 0)) / 100, 0 ), 1)) * 100 ELSE NULL END, earnings_date, updated_at, now | sql.query |
| server/index.js:2645 | read | market_metrics | symbol, price, 0), atr, gap_percent, change_percent, change_percent)), 0)) / 100, 0 ), 1)) * 100 ELSE NULL END, earnings_date, updated_at, now | sql.query |
| server/index.js:2645 | read | market_quotes | symbol, price, 0), atr, gap_percent, change_percent, change_percent)), 0)) / 100, 0 ), 1)) * 100 ELSE NULL END, earnings_date, updated_at, now | sql.query |
| server/index.js:2761 | read | tradable_universe | symbol, price, change_percent, gap_percent, relative_volume, volume, avg_volume_30d, sector, market_cap, strategy | sql.query |
| server/index.js:2761 | read | market_quotes | symbol, price, change_percent, gap_percent, relative_volume, volume, avg_volume_30d, sector, market_cap, strategy | sql.query |
| server/index.js:2761 | read | strategy_signals | symbol, price, change_percent, gap_percent, relative_volume, volume, avg_volume_30d, sector, market_cap, strategy | sql.query |
| server/index.js:2862 | read | market_metrics | symbol, NULLIF(TRIM(sector, ''), 'Unknown'), COALESCE(change_percent, 0), COALESCE(relative_volume, COALESCE(volume | sql.query |
| server/index.js:2862 | read | base | symbol, NULLIF(TRIM(sector, ''), 'Unknown'), COALESCE(change_percent, 0), COALESCE(relative_volume, COALESCE(volume | sql.query |
| server/index.js:2862 | read | ranked | symbol, NULLIF(TRIM(sector, ''), 'Unknown'), COALESCE(change_percent, 0), COALESCE(relative_volume, COALESCE(volume | sql.query |
| server/index.js:2953 | read | market_narratives | id, narrative, regime, created_at | sql.query |
| server/index.js:2971 | read | market_quotes | symbol, (to_jsonb(m, ::numeric, gap_percent, change_percent, 0), market_cap | sql.query |
| server/index.js:2971 | read | market_metrics | symbol, (to_jsonb(m, ::numeric, gap_percent, change_percent, 0), market_cap | sql.query |
| server/index.js:3000 | read | market_metrics | symbol, (to_jsonb(m, ::numeric, price, 0), change_percent | sql.query |
| server/index.js:3000 | read | market_quotes | symbol, (to_jsonb(m, ::numeric, price, 0), change_percent | sql.query |
| server/index.js:3012 | read | market_quotes | sector, 'Unknown'), AVG((to_jsonb(m, change_percent, gap_percent, 0)), market_cap | sql.query |
| server/index.js:3012 | read | sector_agg | sector, 'Unknown'), AVG((to_jsonb(m, change_percent, gap_percent, 0)), market_cap | sql.query |
| server/index.js:3012 | read | market_metrics | sector, 'Unknown'), AVG((to_jsonb(m, change_percent, gap_percent, 0)), market_cap | sql.query |
| server/index.js:3030 | read | news_articles | symbol, headline, url, source, published_at | sql.query |
| server/index.js:3256 | read | strategy_signals | COUNT::int | sql.query |
| server/index.js:3278 | read | strategy_signals | COALESCE(NULLIF(strategy, ''), 'Momentum Continuation'), COUNT::int, SUM(CASE WHEN COALESCE(result, exit_price > entry_price, false) THEN 1 ELSE 0 END)::int, ROUND( SUM(CASE WHEN COALESCE(result, false) THEN 1 ELSE 0 END)::decimal / NULLIF, 0) * 100, 1 ), ROUND( AVG( CASE WHEN COALESCE(entry_price, 0) > 0 AND exit_price IS NOT NULL THEN ::numeric, ROUND( MIN( CASE WHEN COALESCE(entry_price | sql.query |
| server/index.js:3323 | read | earnings_events | symbol, company, earnings_date, eps_estimate, revenue_estimate, CASE WHEN earnings_date::date = CURRENT_DATE THEN 'Today' WHEN earnings_date::date = CURRENT_DATE + INTERVAL '1 day' THEN 'Tomorrow' ELSE 'After Hours' END | sql.query |
| server/index.js:3370 | write | strategy_signals | COALESCE(NULLIF(strategy, ''), 'Momentum Continuation'), COUNT::int, SUM(CASE WHEN COALESCE(change_percent, 0) >= 0 THEN 1 ELSE 0 END)::int, 0) < 0 THEN 1 ELSE 0 END)::int, strategy, total_signals, wins, losses, accuracy_rate, updated_at | sql.query |
| server/index.js:3370 | write | agg | COALESCE(NULLIF(strategy, ''), 'Momentum Continuation'), COUNT::int, SUM(CASE WHEN COALESCE(change_percent, 0) >= 0 THEN 1 ELSE 0 END)::int, 0) < 0 THEN 1 ELSE 0 END)::int, strategy, total_signals, wins, losses, accuracy_rate, updated_at | sql.query |
| server/index.js:3370 | write | strategy_accuracy | COALESCE(NULLIF(strategy, ''), 'Momentum Continuation'), COUNT::int, SUM(CASE WHEN COALESCE(change_percent, 0) >= 0 THEN 1 ELSE 0 END)::int, 0) < 0 THEN 1 ELSE 0 END)::int, strategy, total_signals, wins, losses, accuracy_rate, updated_at | sql.query |
| server/index.js:3370 | write | SET | COALESCE(NULLIF(strategy, ''), 'Momentum Continuation'), COUNT::int, SUM(CASE WHEN COALESCE(change_percent, 0) >= 0 THEN 1 ELSE 0 END)::int, 0) < 0 THEN 1 ELSE 0 END)::int, strategy, total_signals, wins, losses, accuracy_rate, updated_at | sql.query |
| server/index.js:3418 | read | market_metrics | price, 0), atr, gap_percent, change_percent, change_percent)), 0)) / 100, 0 ) | sql.query |
| server/index.js:3418 | read | market_quotes | price, 0), atr, gap_percent, change_percent, change_percent)), 0)) / 100, 0 ) | sql.query |
| server/index.js:4464 | read | intel_news | symbol, headline, source, url, published_at, sentiment, updated_at | sql.query |
| server/index.js:4527 | read | intel_news | id, symbol, sector, headline, source, url, sentiment, published_at | sql.query |
| server/index.js:4527 | read | news_articles | id, symbol, sector, headline, source, url, sentiment, published_at | sql.query |
| server/index.js:4527 | read | market_quotes | id, symbol, sector, headline, source, url, sentiment, published_at | sql.query |
| server/index.js:4624 | read | intel_news | COUNT::int, MAX | sql.query |
| server/index.js:4640 | read | news_articles | COUNT::int, MAX | sql.query |
| server/index.js:4656 | read | market_quotes | COUNT::int | sql.query |
| server/index.js:4685 | read | timestamp | EXTRACT(EPOCH | sql.query |
| server/index.js:4685 | read | intraday_1m | EXTRACT(EPOCH | sql.query |
| server/index.js:4744 | read | chart_trends | symbol, trend, support, resistance, channel, breakouts, updated_at | sql.query |
| server/index.js:5351 | read | (dynamic-sql) | (none) | sql.query |
| server/index.js:5403 | read | intel_news | COUNT::int | sql.query |
| server/ingestion/fmp_universe_ingest.js:119 | read | ticker_universe | symbol | sql.query |
| server/ingestion/fmp_universe_ingest.js:147 | write | jsonb_to_recordset | symbol, company_name, exchange, sector, industry, market_cap, is_active, NOW(), last_updated | sql.query |
| server/ingestion/fmp_universe_ingest.js:147 | write | ticker_universe | symbol, company_name, exchange, sector, industry, market_cap, is_active, NOW(), last_updated | sql.query |
| server/ingestion/fmp_universe_ingest.js:147 | write | SET | symbol, company_name, exchange, sector, industry, market_cap, is_active, NOW(), last_updated | sql.query |
| server/metrics/calc_market_metrics.js:14 | read | intraday_1m | symbol | sql.query |
| server/metrics/calc_market_metrics.js:18 | read | intraday_1m | symbol | sql.query |
| server/metrics/calc_market_metrics.js:37 | read | symbol_queue | COUNT::int, MIN | sql.query |
| server/metrics/calc_market_metrics.js:51 | read | symbol_queue | symbol | sql.query |
| server/metrics/calc_market_metrics.js:67 | write | symbol_queue | (none) | sql.query |
| server/metrics/calc_market_metrics.js:77 | read | daily_ohlc | symbol | sql.query |
| server/metrics/calc_market_metrics.js:77 | read | intraday_1m | symbol | sql.query |
| server/metrics/calc_market_metrics.js:227 | write | jsonb_to_recordset | symbol, price, gap_percent, relative_volume, atr, rsi, vwap, float_rotation, NOW(), last_updated | sql.query |
| server/metrics/calc_market_metrics.js:227 | write | market_metrics | symbol, price, gap_percent, relative_volume, atr, rsi, vwap, float_rotation, NOW(), last_updated | sql.query |
| server/metrics/calc_market_metrics.js:227 | write | SET | symbol, price, gap_percent, relative_volume, atr, rsi, vwap, float_rotation, NOW(), last_updated | sql.query |
| server/metrics/expected_move.js:12 | read | market_metrics | symbol, price, atr, ::numeric, last_updated | sql.query |
| server/metrics/queue_symbol.js:22 | write | symbol_queue | symbol, reason, created_at | sql.query |
| server/metrics/queue_symbol.js:22 | write | SET | symbol, reason, created_at | sql.query |
| server/metrics/test_queue.js:8 | write | symbol_queue | (none) | sql.query |
| server/metrics/test_queue.js:10 | read | market_metrics | symbol | sql.query |
| server/metrics/test_queue.js:26 | read | market_metrics | symbol, last_updated | sql.query |
| server/metrics/test_queue.js:36 | read | symbol_queue | COUNT::int | sql.query |
| server/middleware/requireFeature.js:32 | read | users | id, username, email, is_admin, NULLIF(TRIM(plan, ''), CASE WHEN COALESCE(is_admin, 0) = 1 THEN 'admin' ELSE 'free' END) | sql.query |
| server/middleware/requireFeature.js:57 | read | users | id, username, email, is_admin | sql.query |
| server/modules/marketData/marketDataRoutes.js:165 | read | market_metrics | symbol, NULL::numeric, change_percent, 0), price | sql.query |
| server/modules/marketData/marketDataRoutes.js:165 | read | market_quotes | symbol, NULL::numeric, change_percent, 0), price | sql.query |
| server/modules/marketData/marketDataRoutes.js:178 | read | market_quotes | symbol, NULL::numeric, change_percent, 0), price | sql.query |
| server/monitoring/catalystHealth.js:4 | read | trade_catalysts | COUNT::int, MAX | sql.query |
| server/monitoring/discoveryHealth.js:5 | read | discovered_symbols | COUNT::int, MAX | sql.query |
| server/monitoring/ingestionHealth.js:4 | read | daily_ohlc | table_name, row_count, last_update | sql.query |
| server/monitoring/ingestionHealth.js:4 | read | intraday_1m | table_name, row_count, last_update | sql.query |
| server/monitoring/ingestionHealth.js:4 | read | news_articles | table_name, row_count, last_update | sql.query |
| server/monitoring/ingestionHealth.js:4 | read | earnings_events | table_name, row_count, last_update | sql.query |
| server/monitoring/metricsHealth.js:4 | read | market_metrics | COUNT::int, MAX | sql.query |
| server/monitoring/queueHealth.js:4 | read | symbol_queue | COUNT::int, MIN | sql.query |
| server/monitoring/setupHealth.js:4 | read | trade_setups | COUNT::int, MAX | sql.query |
| server/monitoring/systemHealth.js:30 | read | market_quotes | MAX | sql.query |
| server/monitoring/universeHealth.js:4 | read | ticker_universe | COUNT::int, MAX | sql.query |
| server/narrative/narrative_engine.js:42 | read | market_metrics | symbol, price, vwap, relative_volume | sql.query |
| server/narrative/narrative_engine.js:43 | read | market_metrics | symbol, change_percent, gap_percent | sql.query |
| server/narrative/narrative_engine.js:44 | read | market_metrics | sector, COUNT::int, relative_volume, 0)), score | sql.query |
| server/narrative/narrative_engine.js:44 | read | ticker_universe | sector, COUNT::int, relative_volume, 0)), score | sql.query |
| server/narrative/narrative_engine.js:44 | read | trade_setups | sector, COUNT::int, relative_volume, 0)), score | sql.query |
| server/narrative/narrative_engine.js:57 | read | trade_setups | symbol, NULLIF(TRIM(setup, ''), 'Setup detected'), score | sql.query |
| server/narrative/narrative_engine.js:65 | read | trade_catalysts | symbol, headline | sql.query |
| server/narrative/narrative_engine.js:111 | write | market_narratives | narrative, regime | sql.query |
| server/opportunity/stream_engine.js:29 | write | trade_catalysts | symbol, 'catalyst', headline, ''), 'Catalyst detected'), score, 'catalyst_engine', event_type, source | sql.query |
| server/opportunity/stream_engine.js:29 | write | opportunity_stream | symbol, 'catalyst', headline, ''), 'Catalyst detected'), score, 'catalyst_engine', event_type, source | sql.query |
| server/opportunity/stream_engine.js:58 | write | market_metrics | symbol, 'market', 'Unusual volume or gap detected', relative_volume, 0), gap_percent, 0))::numeric, 'market_metrics_engine', event_type, headline, score, source | sql.query |
| server/opportunity/stream_engine.js:58 | write | opportunity_stream | symbol, 'market', 'Unusual volume or gap detected', relative_volume, 0), gap_percent, 0))::numeric, 'market_metrics_engine', event_type, headline, score, source | sql.query |
| server/repositories/alertsRepository.js:24 | read | (dynamic-sql) | ${selectColumns} | sql.query |
| server/repositories/newsRepository.js:33 | read | (dynamic-sql) | ${selectColumns} | sql.query |
| server/repositories/newsRepository.js:45 | read | (dynamic-sql) | ${selectColumns} | sql.query |
| server/repositories/opportunityRepository.js:24 | read | (dynamic-sql) | ${selectColumns} | sql.query |
| server/repositories/opportunityRepository.js:61 | read | ranked | symbol, score, headline, created_at, event_type, source, ROW_NUMBER | sql.query |
| server/repositories/opportunityRepository.js:103 | read | (dynamic-sql) | COUNT::int | sql.query |
| server/repositories/signalsRepository.js:24 | read | (dynamic-sql) | ${selectColumns} | sql.query |
| server/routes/admin.js:30 | read | (dynamic-sql) | (none) | sql.query |
| server/routes/admin.js:45 | read | (dynamic-sql) | (none) | sql.query |
| server/routes/admin.js:57 | read | (dynamic-sql) | COUNT::int | sql.query |
| server/routes/admin.js:129 | read | users | id, username, email, is_admin, is_active, created_at | sql.query |
| server/routes/admin.js:224 | read | audit_log | id, actor, action, target, created_at | sql.query |
| server/routes/admin.js:244 | read | system_events | id, event_type, source, symbol, payload, created_at | sql.query |
| server/routes/admin.js:256 | read | data_integrity_events | id, event_type, source, symbol, issue, severity, payload, created_at | sql.query |
| server/routes/admin.js:268 | read | system_alerts | id, type, source, severity, message, acknowledged, created_at | sql.query |
| server/routes/alerts.js:22 | read | user_alerts | alert_id, user_id, alert_name, query_tree, message_template, frequency, enabled, created_at, last_triggered | sql.query |
| server/routes/alerts.js:64 | write | user_alerts | user_id, alert_name, query_tree, message_template, frequency, enabled | sql.query |
| server/routes/alerts.js:85 | write | user_alerts | enabled | sql.query |
| server/routes/alerts.js:106 | read | alert_history | alert_id, symbol, triggered_at, message | sql.query |
| server/routes/alerts.js:106 | read | user_alerts | alert_id, symbol, triggered_at, message | sql.query |
| server/routes/briefingRoutes.js:7 | read | morning_briefings | to_jsonb | sql.query |
| server/routes/chartV2.ts:30 | read | daily_ohlc | date::text, open, high, low, close, volume | sql.query |
| server/routes/chartV2.ts:53 | read | timestamp | EXTRACT(EPOCH | sql.query |
| server/routes/chartV2.ts:53 | read | intraday_1m | EXTRACT(EPOCH | sql.query |
| server/routes/chartV2.ts:287 | read | published_at | headline, source, url, EXTRACT(EPOCH | sql.query |
| server/routes/chartV2.ts:287 | read | news_events | headline, source, url, EXTRACT(EPOCH | sql.query |
| server/routes/chartV2.ts:343 | read | earnings_events | report_date, eps_estimate, eps_actual, rev_estimate, rev_actual | sql.query |
| server/routes/chartV2.ts:480 | read | news_events | (none) | sql.query |
| server/routes/earnings.js:17 | read | earnings_events | symbol, COUNT | sql.query |
| server/routes/earnings.js:91 | read | earnings_events | symbol, report_date::text, report_time, eps_estimate, eps_actual, eps_surprise_pct, rev_estimate, rev_actual, market_cap, float, sector, industry | sql.query |
| server/routes/intelDetails.js:48 | read | intel_news | id, symbol, headline, source, url, sentiment, published_at, narrative, score_breakdown, narrative_confidence, narrative_type, time_horizon, regime, detected_symbols, raw_html, raw_text, sender, subject, received_at | sql.query |
| server/routes/intelDetails.js:48 | read | intelligence_emails | id, symbol, headline, source, url, sentiment, published_at, narrative, score_breakdown, narrative_confidence, narrative_type, time_horizon, regime, detected_symbols, raw_html, raw_text, sender, subject, received_at | sql.query |
| server/routes/intelDetails.js:48 | read | LATERAL | id, symbol, headline, source, url, sentiment, published_at, narrative, score_breakdown, narrative_confidence, narrative_type, time_horizon, regime, detected_symbols, raw_html, raw_text, sender, subject, received_at | sql.query |
| server/routes/intelDetails.js:110 | read | market_narratives | narrative, regime, created_at | sql.query |
| server/routes/intelDetails.js:152 | read | trade_signals | symbol, strategy, score, confidence, score_breakdown, narrative, catalyst_type, sector | sql.query |
| server/routes/intelDetails.js:168 | read | intel_news | headline, source, url | sql.query |
| server/routes/intelDetails.js:198 | read | intel_news | headline, source, url, sentiment | sql.query |
| server/routes/intelligence.js:93 | write | intelligence_emails | sender, subject, received_at, raw_text, raw_html, source_tag | sql.query |
| server/routes/intelligence.js:139 | read | intelligence_emails | id, subject, sender, source_tag, received_at, LEFT(raw_text, 300), NULL::numeric, raw_text, processed | sql.query |
| server/routes/intelligence.js:179 | read | news_catalysts | symbol, catalyst_type, headline, source, sentiment, impact_score, published_at | sql.query |
| server/routes/intelligence.js:206 | read | early_accumulation_signals | id, symbol, price, volume, avg_volume_30d, relative_volume, float_rotation, liquidity_surge, accumulation_score, pressure_level, sector, detected_at, max_move_percent | sql.query |
| server/routes/intelligence.js:206 | read | early_signal_outcomes | id, symbol, price, volume, avg_volume_30d, relative_volume, float_rotation, liquidity_surge, accumulation_score, pressure_level, sector, detected_at, max_move_percent | sql.query |
| server/routes/intelligence.js:238 | read | order_flow_signals | id, symbol, price, relative_volume, float_rotation, liquidity_surge, pressure_score, pressure_level, detected_at | sql.query |
| server/routes/intelligence.js:266 | read | sector_momentum | sector, momentum_score, avg_gap, avg_rvol, top_symbol, updated_at | sql.query |
| server/routes/intelligence.js:317 | read | stocks_in_play | id, symbol, gap_percent, rvol, catalyst, score, detected_at | sql.query |
| server/routes/intelligence.js:360 | write | intelligence_emails | processed | sql.query |
| server/routes/marketContextRoutes.js:7 | read | market_metrics | symbol, (to_jsonb(m, ::numeric, price), price, change_percent, 0)), sector | sql.query |
| server/routes/marketContextRoutes.js:7 | read | symbols | symbol, (to_jsonb(m, ::numeric, price), price, change_percent, 0)), sector | sql.query |
| server/routes/marketContextRoutes.js:7 | read | market_quotes | symbol, (to_jsonb(m, ::numeric, price), price, change_percent, 0)), sector | sql.query |
| server/routes/marketContextRoutes.js:7 | read | metric_rows | symbol, (to_jsonb(m, ::numeric, price), price, change_percent, 0)), sector | sql.query |
| server/routes/newsletter.js:29 | write | newsletter_subscribers | email, is_active, created_at | sql.query |
| server/routes/newsletter.js:29 | write | SET | email, is_active, created_at | sql.query |
| server/routes/performanceRoutes.js:7 | read | signal_performance | strategy, COUNT, AVG | sql.query |
| server/routes/radarRoutes.deprecated.js:7 | read | strategy_signals | (none) | sql.query |
| server/routes/radarRoutes.js:41 | read | strategy_signals | symbol, score, strategy, catalyst, created_at, status | sql.query |
| server/routes/radarRoutes.js:58 | read | strategy_signals | symbol, created_at | sql.query |
| server/routes/signals.js:14 | read | dynamic_watchlist | (none) | sql.query |
| server/routes/signals.js:46 | read | trade_signals | symbol, score, score_breakdown, narrative, confidence, catalyst_type, 'unknown'), sector, 'Unknown'), updated_at | sql.query |
| server/routes/signals.js:46 | read | news_catalysts | symbol, score, score_breakdown, narrative, confidence, catalyst_type, 'unknown'), sector, 'Unknown'), updated_at | sql.query |
| server/routes/signals.js:46 | read | LATERAL | symbol, score, score_breakdown, narrative, confidence, catalyst_type, 'unknown'), sector, 'Unknown'), updated_at | sql.query |
| server/routes/signals.js:46 | read | market_quotes | symbol, score, score_breakdown, narrative, confidence, catalyst_type, 'unknown'), sector, 'Unknown'), updated_at | sql.query |
| server/routes/signals.js:86 | read | signal_hierarchy | symbol, hierarchy_rank, signal_class, strategy, score, confidence, updated_at | sql.query |
| server/routes/strategyIntelligence.js:21 | read | strategy_trades | id, symbol, strategy, entry_price, exit_price, entry_time, exit_time, max_move, result_percent, created_at, confidence, catalyst_type, 'unknown'), sector, 'Unknown'), exit_time IS NOT NULL THEN EXTRACT(EPOCH | sql.query |
| server/routes/strategyIntelligence.js:21 | read | trade_signals | id, symbol, strategy, entry_price, exit_price, entry_time, exit_time, max_move, result_percent, created_at, confidence, catalyst_type, 'unknown'), sector, 'Unknown'), exit_time IS NOT NULL THEN EXTRACT(EPOCH | sql.query |
| server/routes/strategyIntelligence.js:21 | read | market_quotes | id, symbol, strategy, entry_price, exit_price, entry_time, exit_time, max_move, result_percent, created_at, confidence, catalyst_type, 'unknown'), sector, 'Unknown'), exit_time IS NOT NULL THEN EXTRACT(EPOCH | sql.query |
| server/routes/strategyIntelligence.js:68 | read | market_narratives | id, narrative, regime, created_at | sql.query |
| server/routes/testNewsDb.js:7 | read | news_articles | COUNT | sql.query |
| server/routes/trades.js:233 | read | trades | trade_id | sql.query |
| server/routes/trades.js:240 | write | trades | (none) | sql.query |
| server/routes/trades.js:254 | write | trades | (none) | sql.query |
| server/routes/trades.js:255 | write | broker_executions | (none) | sql.query |
| server/routes/trades.js:256 | write | daily_reviews | (none) | sql.query |
| server/scripts/backfillMarketMetrics.js:16 | write | daily_ohlc | symbol, high, low | sql.query |
| server/scripts/backfillMarketMetrics.js:16 | write | market_quotes | symbol, high, low | sql.query |
| server/scripts/backfillMarketMetrics.js:16 | write | ohlc_latest | symbol, high, low | sql.query |
| server/scripts/backfillMarketMetrics.js:16 | write | market_metrics | symbol, high, low | sql.query |
| server/scripts/backfillMarketMetrics.js:55 | read | market_metrics | COUNT | sql.query |
| server/scripts/db_stabilize_verify.js:23 | read | information_schema.tables | table_name | sql.query |
| server/scripts/db_stabilize_verify.js:44 | read | (dynamic-sql) | COUNT::int | sql.query |
| server/scripts/testDBConnection.js:14 | read | (dynamic-sql) | (none) | sql.query |
| server/scripts/testMorningBrief.js:18 | read | market_metrics | COUNT::int | sql.query |
| server/scripts/testMorningBrief.js:23 | read | market_quotes | COUNT::int | sql.query |
| server/services/candleUpdateService.ts:239 | write | intraday_1m | (none) | sql.query |
| server/services/candleUpdateService.ts:311 | write | news_events | (none) | sql.query |
| server/services/candleUpdateService.ts:463 | write | news_events | (none) | sql.query |
| server/services/earnings/earningsController.ts:14 | read | earnings_events | (none) | sql.query |
| server/services/earnings/earningsController.ts:28 | read | earnings_market_reaction | (none) | sql.query |
| server/services/earnings/earningsController.ts:42 | read | earnings_scores | (none) | sql.query |
| server/services/earnings/layer2/continuationModel.ts:18 | read | earnings_market_reaction | day2_followthrough_pct | sql.query |
| server/services/emailIntelBridge.js:62 | write | intel_news | symbol, headline, source, url, published_at, sentiment, updated_at | sql.query |
| server/services/emailIntelBridge.js:62 | write | SET | symbol, headline, source, url, published_at, sentiment, updated_at | sql.query |
| server/services/featureAccessService.js:27 | read | user_roles | role | sql.query |
| server/services/featureAccessService.js:39 | read | users | is_admin | sql.query |
| server/services/featureAccessService.js:55 | read | tier_feature_defaults | feature_key, enabled | sql.query |
| server/services/featureAccessService.js:77 | read | user_feature_access | feature_key, enabled | sql.query |
| server/services/featureAccessService.js:121 | read | users | id | sql.query |
| server/services/featureAccessService.js:132 | write | user_roles | user_id, role, updated_by, updated_at | sql.query |
| server/services/featureAccessService.js:132 | write | SET | user_id, role, updated_by, updated_at | sql.query |
| server/services/featureAccessService.js:141 | write | feature_access_audit | user_id, feature_key, old_enabled, new_enabled, old_role, new_role, action, reason, changed_by, changed_at | sql.query |
| server/services/featureAccessService.js:175 | read | users | id | sql.query |
| server/services/featureAccessService.js:184 | read | user_feature_access | enabled | sql.query |
| server/services/featureAccessService.js:195 | write | user_feature_access | user_id, feature_key, enabled, reason, updated_by, updated_at | sql.query |
| server/services/featureAccessService.js:195 | write | SET | user_id, feature_key, enabled, reason, updated_by, updated_at | sql.query |
| server/services/featureAccessService.js:208 | write | feature_access_audit | user_id, feature_key, old_enabled, new_enabled, old_role, new_role, action, reason, changed_by, changed_at | sql.query |
| server/services/intelNewsRunner.js:31 | write | intel_news | symbol, headline, source, url, published_at, sentiment, updated_at | sql.query |
| server/services/intelNewsRunner.js:31 | write | SET | symbol, headline, source, url, published_at, sentiment, updated_at | sql.query |
| server/services/marketNewsFallback.js:24 | read | trade_catalysts | symbol, headline, source, NULL::text, published_at | sql.query |
| server/services/marketNewsFallback.js:24 | read | news_articles | symbol, headline, source, NULL::text, published_at | sql.query |
| server/services/marketNewsFallback.js:24 | read | intelligence_emails | symbol, headline, source, NULL::text, published_at | sql.query |
| server/services/marketNewsFallback.js:24 | read | catalyst_rows | symbol, headline, source, NULL::text, published_at | sql.query |
| server/services/marketNewsFallback.js:24 | read | article_rows | symbol, headline, source, NULL::text, published_at | sql.query |
| server/services/marketNewsFallback.js:24 | read | email_rows | symbol, headline, source, NULL::text, published_at | sql.query |
| server/services/marketNewsFallback.js:77 | read | intel_news | symbol, headline, source, published_at, url | sql.query |
| server/services/newsEngineV3.js:381 | write | news_articles | (none) | sql.query |
| server/services/newsEngineV3.js:394 | write | news_articles | id, headline, symbols, source, url, published_at, summary, catalyst_type, news_score, score_breakdown, raw_payload | sql.query |
| server/services/newsletterService.js:139 | read | newsletter_subscribers | email | sql.query |
| server/services/newsletterService.js:163 | write | newsletter_send_history | subject, recipients_count, provider_id, status, open_rate, click_rate, sent_at, created_at | sql.query |
| server/services/presetService.js:85 | read | user_presets | (none) | sql.query |
| server/services/presetService.js:93 | read | user_presets | (none) | sql.query |
| server/services/presetService.js:93 | read | users | (none) | sql.query |
| server/services/presetService.js:104 | read | user_presets | (none) | sql.query |
| server/services/presetService.js:120 | write | user_presets | is_default | sql.query |
| server/services/presetService.js:126 | write | user_presets | user_id, name, min_price, max_price, min_market_cap, max_market_cap, exchanges, sectors, include_etfs, include_spacs, include_warrants, is_default | sql.query |
| server/services/presetService.js:186 | write | user_presets | is_default | sql.query |
| server/services/presetService.js:193 | write | user_presets | ${fields.join(', ')} | sql.query |
| server/services/presetService.js:205 | write | users | active_preset_id | sql.query |
| server/services/presetService.js:209 | write | user_presets | (none) | sql.query |
| server/services/presetService.js:217 | write | users | active_preset_id | sql.query |
| server/services/presetService.js:229 | read | user_watchlists | symbol | sql.query |
| server/services/presetService.js:239 | write | user_watchlists | user_id, symbol | sql.query |
| server/services/presetService.js:248 | write | user_watchlists | (none) | sql.query |
| server/services/presetService.js:260 | read | users | id, username, email, is_admin, trading_timezone, active_preset_id, created_at | sql.query |
| server/services/presetService.js:299 | write | users | ${fields.join(', ')}, updated_at | sql.query |
| server/services/queryEngine.js:85 | read | trade_catalysts | ON  symbol, catalyst_type, headline, sentiment, score, published_at | sql.query |
| server/services/queryEngine.js:85 | read | market_metrics | ON  symbol, catalyst_type, headline, sentiment, score, published_at | sql.query |
| server/services/queryEngine.js:85 | read | trade_setups | ON  symbol, catalyst_type, headline, sentiment, score, published_at | sql.query |
| server/services/queryEngine.js:85 | read | latest_catalyst | ON  symbol, catalyst_type, headline, sentiment, score, published_at | sql.query |
| server/services/signalService.js:11 | read | strategy_signals | symbol, strategy, ''), 'Momentum Continuation'), class, score, 0) >= 75 THEN 'B' ELSE 'C' END), 0), probability, confidence, change_percent, gap_percent, relative_volume, volume, rvol, sector, headline, 'No catalyst'), catalyst_type, 'news'), updated_at, created_at, now | sql.query |
| server/services/signalService.js:11 | read | trade_catalysts | symbol, strategy, ''), 'Momentum Continuation'), class, score, 0) >= 75 THEN 'B' ELSE 'C' END), 0), probability, confidence, change_percent, gap_percent, relative_volume, volume, rvol, sector, headline, 'No catalyst'), catalyst_type, 'news'), updated_at, created_at, now | sql.query |
| server/services/signalService.js:11 | read | intel_news | symbol, strategy, ''), 'Momentum Continuation'), class, score, 0) >= 75 THEN 'B' ELSE 'C' END), 0), probability, confidence, change_percent, gap_percent, relative_volume, volume, rvol, sector, headline, 'No catalyst'), catalyst_type, 'news'), updated_at, created_at, now | sql.query |
| server/services/signalService.js:11 | read | market_metrics | symbol, strategy, ''), 'Momentum Continuation'), class, score, 0) >= 75 THEN 'B' ELSE 'C' END), 0), probability, confidence, change_percent, gap_percent, relative_volume, volume, rvol, sector, headline, 'No catalyst'), catalyst_type, 'news'), updated_at, created_at, now | sql.query |
| server/services/signalService.js:11 | read | market_quotes | symbol, strategy, ''), 'Momentum Continuation'), class, score, 0) >= 75 THEN 'B' ELSE 'C' END), 0), probability, confidence, change_percent, gap_percent, relative_volume, volume, rvol, sector, headline, 'No catalyst'), catalyst_type, 'news'), updated_at, created_at, now | sql.query |
| server/services/signalService.js:11 | read | LATERAL | symbol, strategy, ''), 'Momentum Continuation'), class, score, 0) >= 75 THEN 'B' ELSE 'C' END), 0), probability, confidence, change_percent, gap_percent, relative_volume, volume, rvol, sector, headline, 'No catalyst'), catalyst_type, 'news'), updated_at, created_at, now | sql.query |
| server/services/trades/dailyReviewCron.js:15 | read | trades | user_id, dataset_scope, COUNT::int, SUM | sql.query |
| server/services/trades/dailyReviewCron.js:15 | read | daily_reviews | user_id, dataset_scope, COUNT::int, SUM | sql.query |
| server/services/trades/dailyReviewCron.js:37 | write | daily_reviews | user_id, dataset_scope, review_date, total_pnl, total_trades, win_rate | sql.query |
| server/services/trades/demoSeeder.js:170 | write | daily_reviews | (none) | sql.query |
| server/services/trades/demoSeeder.js:171 | write | trades | (none) | sql.query |
| server/services/trades/demoSeeder.js:172 | write | broker_executions | (none) | sql.query |
| server/services/trades/tradeModel.js:7 | write | broker_executions | user_id, dataset_scope, broker, symbol, side, qty, price, commission, exec_time, raw_json | sql.query |
| server/services/trades/tradeModel.js:20 | write | trades | user_id, dataset_scope, symbol, side, entry_price, exit_price, qty, pnl_dollar, pnl_percent, commission_total, opened_at, closed_at, duration_seconds, status | sql.query |
| server/services/trades/tradeModel.js:48 | write | trades | ${fields.join(', ')} | sql.query |
| server/services/trades/tradeModel.js:56 | write | trades | (none) | sql.query |
| server/services/trades/tradeModel.js:92 | read | trades | setup_type, conviction, notes, review_status | sql.query |
| server/services/trades/tradeModel.js:92 | read | trade_metadata | setup_type, conviction, notes, review_status | sql.query |
| server/services/trades/tradeModel.js:105 | read | trades | setup_type, conviction, notes, screenshot_url, tags_json, review_status | sql.query |
| server/services/trades/tradeModel.js:105 | read | trade_metadata | setup_type, conviction, notes, screenshot_url, tags_json, review_status | sql.query |
| server/services/trades/tradeModel.js:131 | read | trades | COUNT::int, SUM(pnl_dollar, 0)::numeric, MAX(pnl_dollar, MIN(pnl_dollar, SUM(commission_total | sql.query |
| server/services/trades/tradeModel.js:161 | write | trade_metadata | trade_id, setup_type, conviction, notes, screenshot_url, tags_json, review_status | sql.query |
| server/services/trades/tradeModel.js:161 | write | SET | trade_id, setup_type, conviction, notes, screenshot_url, tags_json, review_status | sql.query |
| server/services/trades/tradeModel.js:179 | read | trade_metadata | (none) | sql.query |
| server/services/trades/tradeModel.js:186 | read | trade_tags | (none) | sql.query |
| server/services/trades/tradeModel.js:191 | write | trade_tags | user_id, tag_name, colour_hex | sql.query |
| server/services/trades/tradeModel.js:199 | write | trade_tags | (none) | sql.query |
| server/services/trades/tradeModel.js:207 | write | daily_reviews | user_id, dataset_scope, review_date, total_pnl, total_trades, win_rate, summary_text, lessons_text, plan_tomorrow, mood, rating | sql.query |
| server/services/trades/tradeModel.js:207 | write | SET | user_id, dataset_scope, review_date, total_pnl, total_trades, win_rate, summary_text, lessons_text, plan_tomorrow, mood, rating | sql.query |
| server/services/trades/tradeModel.js:227 | read | daily_reviews | (none) | sql.query |
| server/services/trades/tradeModel.js:250 | read | daily_reviews | (none) | sql.query |
| server/services/trades/tradeModel.js:260 | read | daily_reviews | review_date, total_pnl, total_trades, summary_text, mood, rating, total_trades > 0 THEN 'partial' ELSE 'empty' END | sql.query |
| server/strategy/run_strategy.js:9 | read | trade_setups | setup, COUNT::int | sql.query |
| server/strategy/strategy_engine.js:75 | read | market_metrics | symbol, price, vwap, gap_percent, relative_volume, atr, float_rotation | sql.query |
| server/strategy/strategy_engine.js:96 | write | jsonb_to_recordset | symbol, setup, grade, score, gap_percent, relative_volume, atr, float_rotation, NOW(), detected_at | sql.query |
| server/strategy/strategy_engine.js:96 | write | trade_setups | symbol, setup, grade, score, gap_percent, relative_volume, atr, float_rotation, NOW(), detected_at | sql.query |
| server/strategy/strategy_engine.js:96 | write | SET | symbol, setup, grade, score, gap_percent, relative_volume, atr, float_rotation, NOW(), detected_at | sql.query |
| server/system/dataHealthEngine.js:16 | read | (dynamic-sql) | COUNT::int | sql.query |
| server/system/engineDiagnostics.js:132 | read | system_events | COUNT::int | sql.query |
| server/system/featureBootstrap.js:69 | write | (dynamic-sql) | (none) | sql.query |
| server/system/featureBootstrap.js:81 | write | (dynamic-sql) | (none) | sql.query |
| server/system/featureBootstrap.js:96 | write | (dynamic-sql) | (none) | sql.query |
| server/system/featureBootstrap.js:131 | write | feature_registry | feature_key, category, display_name, updated_at | sql.query |
| server/system/featureBootstrap.js:131 | write | SET | feature_key, category, display_name, updated_at | sql.query |
| server/system/featureBootstrap.js:148 | read | (dynamic-sql) | role, feature_key, enabled | sql.query |
| server/system/featureBootstrap.js:161 | write | users | id, is_admin, 0) = 1 THEN 'admin' ELSE 'free' END, NOW(), user_id, role, created_at, updated_at | sql.query |
| server/system/featureBootstrap.js:161 | write | user_roles | id, is_admin, 0) = 1 THEN 'admin' ELSE 'free' END, NOW(), user_id, role, created_at, updated_at | sql.query |
| server/system/schemaValidator.js:18 | read | information_schema.columns | table_name, column_name | sql.query |
| server/system/schemaValidator.js:35 | read | information_schema.tables | table_name | sql.query |
| server/system/schemaValidator.js:49 | read | (dynamic-sql) | (none) | sql.query |
| server/system/schemaValidator.js:57 | read | (dynamic-sql) | COUNT::int | sql.query |
| server/system/signalRouter.js:78 | write | dynamic_watchlist | symbol, strategy, score, confidence, catalyst_type, sector, float_rotation, liquidity_surge, hierarchy_rank, narrative, score_breakdown, updated_at | sql.query |
| server/system/signalRouter.js:78 | write | SET | symbol, strategy, score, confidence, catalyst_type, sector, float_rotation, liquidity_surge, hierarchy_rank, narrative, score_breakdown, updated_at | sql.query |
| server/system/signalRouter.js:124 | read | morning_briefings | created_at | sql.query |
| server/system/signalRouter.js:137 | write | signal_alerts | symbol, strategy, score, confidence, alert_type, message, acknowledged, created_at | sql.query |
| server/system/signalRouter.js:161 | read | market_quotes | price | sql.query |
| server/system/signalRouter.js:168 | write | strategy_trades | $1, $2, $3, NOW(), NOW() WHERE NOT EXISTS ( SELECT 1, symbol, strategy, entry_price, entry_time, created_at | sql.query |
| server/system/signalRouter.js:218 | write | dynamic_watchlist | symbol, strategy, score, confidence, catalyst_type, sector, float_rotation, liquidity_surge, hierarchy_rank, narrative, score_breakdown, updated_at | sql.query |
| server/system/signalRouter.js:218 | write | SET | symbol, strategy, score, confidence, catalyst_type, sector, float_rotation, liquidity_surge, hierarchy_rank, narrative, score_breakdown, updated_at | sql.query |

## 2. Columns referenced

| table_name | columns_referenced |
| --- | --- |
| (dynamic-sql) | ${selectColumns}, ')}, COUNT::bigint, COUNT::int, count::int, enabled, feature_key, join(', role |
| active | symbol |
| activity_log | COUNT, action, details, ip_address, user_agent, user_id |
| agg | ''), 'Momentum Continuation'), 0) < 0 THEN 1 ELSE 0 END)::int, 0) >= 0 THEN 1 ELSE 0 END)::int, COALESCE(NULLIF(strategy, COUNT::int, SUM(CASE WHEN COALESCE(change_percent, accuracy_rate, losses, strategy, total_signals, updated_at, wins |
| alert_history | alert_id, message, symbol, triggered_at |
| all_candidates | 'setup'::text, 0)::numeric, COALESCE(score, UPPER |
| article_rows | NULL::text, headline, published_at, source, symbol |
| audit_log | action, actor, created_at, id, target |
| base | ''), 'Unknown'), 0), COALESCE(change_percent, COALESCE(relative_volume, COALESCE(volume, NULLIF(TRIM(sector, change_percent, sector, symbol, volume |
| broker_executions | broker, commission, dataset_scope, exec_time, price, qty, raw_json, side, symbol, user_id |
| catalyst_candidates | 'setup'::text, 0)::numeric, COALESCE(score, UPPER |
| catalyst_rows | NULL::text, headline, published_at, source, symbol |
| catalyst_scores | 0)), MAX(COALESCE(impact_score, symbol |
| chart_trends | breakouts, channel, computed_at, resistance, support, symbol, trend, updated_at |
| daily_ohlc | 0), 0) > 0 THEN  * 100 ELSE NULL END, avg_volume_30d, avg_volume_30d ELSE NULL END, change_percent, change_percent END, close, date::text, gap_percent, head:, high, high_price, last_update, low, low_price, market_cap, open, previous_close, price, price ELSE NULL END, price), relative_volume, row_count, symbol, table_name, volume, { |
| daily_reviews | COUNT::int, SUM, dataset_scope, lessons_text, mood, plan_tomorrow, rating, review_date, summary_text, total_pnl, total_trades, total_trades > 0 THEN 'partial' ELSE 'empty' END, user_id, win_rate |
| daily_signal_snapshot | $1::date, 0), NOW(), catalyst, confidence, created_at, entry_price, price, score, sector, snapshot_date, strategy, symbol |
| data_integrity_events | created_at, event_type, id, issue, payload, severity, source, symbol |
| discovered_symbols | COUNT::int, MAX, NOW(), detected_at, score, source, symbol |
| dynamic_watchlist | catalyst_type, confidence, float_rotation, hierarchy_rank, liquidity_surge, narrative, score, score_breakdown, sector, strategy, symbol, updated_at |
| early_accumulation_signals | $1, $10, $11, $12, $2, $3, $4, $5, $6, $7, $8, $9, NOW() WHERE NOT EXISTS ( SELECT 1, accumulation_score, avg_volume_30d, detected_at, float_rotation, float_shares, id, liquidity_surge, max_move_percent, pressure_level, price, relative_volume, sector, symbol, volume, volume_delta |
| early_signal_outcomes | accumulation_score, avg_volume_30d, detected_at, entry_price, float_rotation, id, liquidity_surge, max_move_percent, pressure_level, price, price_1d, price_1h, price_30d, price_4h, price_5d, relative_volume, sector, signal_id, symbol, updated_at, volume |
| earnings_candidates | 'setup'::text, 0)::numeric, COALESCE(score, UPPER |
| earnings_events | 'setup'::text, 0 ), 0), 0)) / 100, 0)::numeric, 1)) * 100 ELSE NULL END, ABS, CASE WHEN earnings_date::date = CURRENT_DATE THEN 'Today' WHEN earnings_date::date = CURRENT_DATE + INTERVAL '1 day' THEN 'Tomorrow' ELSE 'After Hours' END, COALESCE(score, COUNT, UPPER, atr, atr_percent, change_percent, change_percent)), company, earnings_date, earnings_date::text, eps_actual, eps_estimate, eps_surprise_pct, float, gap_percent, industry, last_update, market_cap, now, price, price)) * 100 ELSE NULL END, report_date, report_date::text, report_time, rev_actual, rev_estimate, revenue_estimate, row_count, sector, symbol, table_name, time, updated_at |
| earnings_market_reaction | day2_followthrough_pct |
| earnings_scores | (none) |
| email_rows | NULL::text, headline, published_at, source, symbol |
| engine_errors | engine, message, stack, timestamp |
| expected_moves | atr_percent, earnings_date, expected_move, price, symbol, updated_at |
| feature_access_audit | action, changed_at, changed_by, feature_key, new_enabled, new_role, old_enabled, old_role, reason, user_id |
| feature_registry | category, display_name, feature_key, updated_at |
| flow_signals | detected_at, float_rotation, flow_score, id, liquidity_surge, pressure_level, relative_volume, symbol |
| i.timestamp | symbol |
| information_schema.columns | column_name, table_name |
| information_schema.tables | table_name |
| ingestion_state | id, last_symbol_index, last_updated, phase, status |
| institutional_flow | breakout_score, detected_at, relative_volume, score, symbol, volume |
| intel_news | ''), 'Momentum Continuation'), 'No catalyst available'), 'No catalyst'), 'news'), 0), 0) >= 75 THEN 'B' ELSE 'C' END), COUNT::int, MAX, catalyst_type, change_percent, class, confidence, created_at, detected_symbols, expected_move, gap_percent, headline, id, narrative, narrative_confidence, narrative_type, now, probability, published_at, raw_html, raw_text, received_at, regime, relative_volume, rvol, score, score_breakdown, sector, sender, sentiment, source, strategy, subject, symbol, time_horizon, updated_at, url, volume |
| intelligence_emails | 'No catalyst available'), 300), LEFT(raw_text, NULL::numeric, NULL::text, class, detected_symbols, gap_percent, headline, id, narrative, narrative_confidence, narrative_type, processed, published_at, raw_html, raw_text, received_at, regime, relative_volume, score, score_breakdown, sector, sender, sentiment, source, source_tag, strategy, subject, symbol, time_horizon, url |
| intraday_1m | COUNT::int, EXTRACT(EPOCH, close, head:, last_update, row_count, symbol, table_name, timestamp, volume, { |
| jsonb_to_recordset | NOW(), atr, catalyst_type, company_name, created_at, detected_at, exchange, float_rotation, gap_percent, grade, headline, industry, is_active, last_updated, latency, market_cap, price, provider, published_at, relative_volume, rsi, score, sector, sentiment, setup, source, status, symbol, vwap |
| LATERAL | ''), 'Momentum Continuation'), 'No catalyst available'), 'No catalyst'), 'Unknown'), 'news'), 'unknown'), 0), 0) > 0 THEN  * 100 ELSE NULL END, 0) >= 75 THEN 'B' ELSE 'C' END), avg_volume_30d, avg_volume_30d ELSE NULL END, catalyst_type, change_percent, change_percent END, class, confidence, created_at, detected_symbols, gap_percent, headline, hierarchy_rank, high, high_price, id, low_price, market_cap, narrative, narrative_confidence, narrative_type, now, open, previous_close, price, price ELSE NULL END, price), probability, published_at, raw_html, raw_text, received_at, regime, relative_volume, rvol, score, score_breakdown, sector, sender, sentiment, signal_class, source, strategy, strategy), subject, symbol, time_horizon, updated_at, url, volume |
| latest_catalyst | ON  symbol, catalyst_type, headline, published_at, score, sentiment |
| market_metrics | ''), 'Momentum Continuation'), 'No catalyst'), 'Unknown'), 'Unusual volume or gap detected', 'market', 'market_metrics_engine', 'news'), 'unknown'), (to_jsonb(m, 0 ), 0), 0) * 3)), 0) > 0 THEN  ELSE 0 END, 0) >= 2 THEN 'building' ELSE 'watch' END, 0) >= 4 THEN 'aggressive' WHEN COALESCE(relative_volume, 0) >= 4 THEN 1 WHEN COALESCE(change_percent, 0) >= 75 THEN 'B' ELSE 'C' END), 0) DESC NULLS LAST ), 0)), 0)) / 100, 0))::numeric, 1, 1)) * 100 ELSE NULL END, 3 END, ::numeric, ABS, AVG, AVG((to_jsonb(m, CASE WHEN COALESCE(change_percent, CASE WHEN COALESCE(relative_volume, COALESCE(change_percent, COALESCE(float_rotation, COALESCE(float_shares, COALESCE(liquidity_surge, COALESCE(price, COALESCE(relative_volume, COALESCE(short_float, COALESCE(volume, COUNT, COUNT::int, MAX, MAX(COALESCE(impact_score, NOW(), NULL::numeric, NULLIF(TRIM(sector, ON  symbol, atr, atr_percent, avg_volume_30d, catalyst_type, change_percent, change_percent), change_percent)), class, close, company_name, confidence, created_at, earnings_date, entry_price, entry_time, event_type, float_rotation, float_shares, gap_percent, grade, headline, high, id, industry, last_updated, low, market_cap, narrative, now, open, previous_close, price, price), price)) * 100 ELSE NULL END, probability, published_at, relative_volume, rsi, rvol, score, sector, sentiment, setup, source, strategy, symbol, updated_at, volume, volume), vwap |
| market_narratives | created_at, id, narrative, regime |
| market_quotes | ''), 'Momentum Continuation'), 'No catalyst available'), 'No catalyst'), 'Unknown'), 'news'), 'unknown'), (to_jsonb(m, 0 ), 0), 0) > 0 THEN  * 100 ELSE NULL END, 0) > 0 THEN  ELSE 0 END, 0) >= 75 THEN 'B' ELSE 'C' END), 0) DESC NULLS LAST ), 0)), 0)) / 100, 1)) * 100 ELSE NULL END, ::numeric, ABS, AVG((to_jsonb(m, COUNT::int, MAX, MAX(COALESCE(impact_score, NOW(), NULL::numeric, UPPER, atr, atr_percent, avg_volume_30d, avg_volume_30d ELSE NULL END, catalyst_type, change_percent, change_percent END, change_percent), change_percent)), class, confidence, created_at, detected_at, earnings_date, entry_price, entry_time, exit_price, exit_time, exit_time IS NOT NULL THEN EXTRACT(EPOCH, float_shares, gap_percent, headline, hierarchy_rank, high, high_price, id, low, low_price, market_cap, max_move, narrative, now, price, price ELSE NULL END, price), price)) * 100 ELSE NULL END, probability, published_at, relative_volume, result_percent, rvol, score, score_breakdown, sector, sentiment, signal_class, source, strategy, strategy), subject, symbol, updated_at, url, volume, volume) |
| metric_rows | (to_jsonb(m, 0)), ::numeric, change_percent, price, price), sector, symbol |
| morning_briefings | created_at, email_status, market, narrative, news, signals, stocks_in_play, to_jsonb |
| news_articles | 0), 1), COUNT, COUNT::int, MAX, NULL::text, ai_analysis, catalyst_type, headline, id, last_update, news_score, published_at, published_at), raw_payload, row_count, score_breakdown, sector, sentiment, source, summary, summary), symbol, symbols, table_name, url |
| news_catalysts | 'Unknown'), 'unknown'), 0), 0)), MAX(COALESCE(impact_score, catalyst_type, confidence, headline, hierarchy_rank, impact_score, narrative, price, published_at, relative_volume, score, score_breakdown, sector, sentiment, signal_class, source, strategy, strategy), symbol, updated_at |
| news_events | EXTRACT(EPOCH, head:, headline, source, symbol, url, { |
| newsletter_send_history | click_rate, created_at, open_rate, provider_id, recipients_count, sent_at, status, subject |
| newsletter_subscribers | COUNT::int, created_at, email, is_active |
| ohlc_latest | high, low, symbol |
| opportunities | COUNT::int |
| opportunities_v2 | change_percent, gap_percent, relative_volume, score, strategy, symbol, updated_at, volume |
| opportunity_stream | ''), 'Catalyst detected'), 'Unusual volume or gap detected', 'catalyst', 'catalyst_engine', 'market', 'market_metrics_engine', 0), 0))::numeric, created_at, event_type, gap_percent, headline, relative_volume, score, source, symbol |
| order_flow_signals | $1, $2, $3, $4, $5, $6, $7, NOW() WHERE NOT EXISTS ( SELECT 1, detected_at, float_rotation, id, liquidity_surge, pressure_level, pressure_score, price, relative_volume, symbol |
| provider_health | NOW(), created_at, latency, provider, status |
| published_at | EXTRACT(EPOCH, headline, source, url |
| ranked | ''), 'Unknown'), (to_jsonb(m, 0), 0) DESC NULLS LAST ), COALESCE(change_percent, COALESCE(relative_volume, COALESCE(volume, NULLIF(TRIM(sector, ROW_NUMBER, change_percent, created_at, event_type, gap_percent, headline, market_cap, score, sector, source, symbol, volume |
| schema_migrations | version |
| sector_agg | 'Unknown'), 0)), AVG((to_jsonb(m, change_percent, gap_percent, market_cap, price_change, relative_volume, sector, volume |
| sector_base | 0)), MAX(COALESCE(impact_score, symbol |
| sector_heatmap | avg_change, leaders, sector, stocks, total_volume, updated_at |
| sector_momentum | avg_gap, avg_rvol, momentum_score, sector, top_symbol, updated_at |
| sector_rank | 0)), MAX(COALESCE(impact_score, symbol |
| SET | ''), 'Momentum Continuation'), 0) < 0 THEN 1 ELSE 0 END)::int, 0) >= 0 THEN 1 ELSE 0 END)::int, COALESCE(NULLIF(strategy, COUNT::int, NOW(), SUM(CASE WHEN COALESCE(change_percent, accuracy_rate, atr, atr_percent, avg_change, avg_gap, avg_move, avg_rvol, avg_volume_30d, breakouts, catalyst_score, catalyst_type, category, change_percent, channel, class, company, company_name, component, computed_at, confidence, confirmation_score, conviction, created_at, data, dataset_scope, detected_at, display_name, earnings_date, email, enabled, enabled_strategies, engine, entry_price, eps_estimate, exchange, expected_move, feature_key, float_rotation, float_shares, gap_percent, grade, headline, hierarchy_rank, id, impact_score, industry, is_active, key, last_updated, leaders, lessons_text, liquidity_surge, losses, market_cap, max_move_percent, metric_value, min_gap, min_rvol, momentum_score, mood, narrative, news_score, notes, payload, plan_tomorrow, preferred_sectors, price, price_1d, price_1h, price_30d, price_4h, price_5d, probability, published_at, rating, rationale, raw_payload, reason, relative_volume, resistance, revenue_estimate, review_date, review_status, role, rsi, rvol, score, score_breakdown, score_contribution, screenshot_url, sector, sector_score, sentiment, setup, setup_type, signal_class, signal_explanation, signal_id, signals_analyzed, source, stocks, strategy, success_rate, summary, summary_text, support, symbol, symbols, tags_json, time, top_symbol, total_pnl, total_signals, total_trades, total_volume, trade_id, trend, updated_at, updated_by, url, user_id, value, volume, vwap, weight, win_rate, wins |
| settings | key, updated_at, value |
| setup_candidates | 'setup'::text, 0)::numeric, COALESCE(score, UPPER |
| signal_alerts | acknowledged, alert_type, confidence, created_at, message, score, strategy, symbol |
| signal_catalysts | catalyst_source, catalyst_type, headline, id, published_at, signal_id, source, strategy, strength, symbol |
| signal_component_outcomes | catalyst_score, confirmation_score, created_at, float_rotation, gap_percent, id, liquidity_surge, move_percent, outcome_updated_at, rvol, score, sector_score, snapshot_date, snapshot_day, success, symbol |
| signal_engine_metrics | engine, metric_value, payload, score_contribution, symbol, updated_at |
| signal_hierarchy | 'Unknown'), 'unknown'), 0), catalyst_type, confidence, hierarchy_rank, price, score, sector, signal_class, strategy, strategy), symbol, updated_at |
| signal_narratives | catalyst_type, created_at, headline, id, mcp_context, news_score, published_at, signal_id, source, strategy, symbol |
| signal_performance | $1::date, AVG, COUNT, NOW(), class, created_at, current_price, entry_price, evaluated_at, max_drawdown, max_upside, outcome, probability, return_percent, score, signal_id, snapshot_date, strategy, symbol, updated_at |
| signal_weight_calibration | avg_move, component, signals_analyzed, success_rate, updated_at, weight |
| spark | symbol |
| sparkline_cache | COUNT::int, MAX, data, symbol, updated_at |
| squeeze_signals | detected_at, float_shares, id, price_change, relative_volume, score, short_float, symbol |
| stocks_in_play | catalyst, detected_at, gap_percent, id, rvol, score, symbol |
| strategy_accuracy | ''), 'Momentum Continuation'), 0) < 0 THEN 1 ELSE 0 END)::int, 0) >= 0 THEN 1 ELSE 0 END)::int, COALESCE(NULLIF(strategy, COUNT::int, SUM(CASE WHEN COALESCE(change_percent, accuracy_rate, losses, strategy, total_signals, updated_at, wins |
| strategy_signals | ''), 'Momentum Continuation'), 'No catalyst available'), 'No catalyst'), 'Unknown'), 'news'), 0), 0) * 100, 0) < 0 THEN 1 ELSE 0 END)::int, 0) > 0 AND exit_price IS NOT NULL THEN ::numeric, 0) >= 0 THEN 1 ELSE 0 END)::int, 0) >= 75 THEN 'B' ELSE 'C' END), 1 ), AVG::numeric, COALESCE(NULLIF(strategy, COUNT::int, ROUND( AVG( CASE WHEN COALESCE(entry_price, ROUND( MIN( CASE WHEN COALESCE(entry_price, ROUND( SUM(CASE WHEN COALESCE(result, ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY updated_at DESC NULLS LAST, SUM(CASE WHEN COALESCE(change_percent, SUM(CASE WHEN COALESCE(result, accuracy_rate, avg_volume_30d, catalyst, catalyst_count, catalyst_type, change_percent, class, confidence, created_at, ctid, ctid DESC), exit_price > entry_price, false) THEN 1 ELSE 0 END)::decimal / NULLIF, false) THEN 1 ELSE 0 END)::int, gap_percent, headline, id, losses, market_cap, now, price, probability, relative_volume, rvol, score, sector, status, strategy, subject, symbol, total_signals, updated_at, volume, wins |
| strategy_trades | $1, $2, $3, 'Unknown'), 'unknown'), 0 )::numeric, 0), 2), 4 ), 4), COUNT::int, NOW(), NOW() WHERE NOT EXISTS ( SELECT 1, ROUND(  AVG(CASE WHEN result_percent > 0 THEN result_percent END, ROUND::numeric, atr_percent, catalyst_type, change_percent, confidence, created_at, entry_price, entry_time, exit_price, exit_time, exit_time IS NOT NULL THEN EXTRACT(EPOCH, id, max_move, price, result_percent, sector, strategy, symbol |
| symbol_queue | COUNT::int, MIN, created_at, reason, symbol |
| symbols | (to_jsonb(m, 0)), ::numeric, change_percent, price, price), sector, symbol |
| system_alerts | acknowledged, created_at, id, message, severity, source, type |
| system_events | COUNT::int, created_at, event_type, id, payload, source, symbol |
| ticker_universe | 0)), COUNT::int, MAX, NOW(), atr, company_name, exchange, float_rotation, gap_percent, grade, industry, is_active, last_updated, market_cap, price, relative_volume, score, sector, setup, symbol |
| tier_feature_defaults | enabled, feature_key |
| timestamp | EXTRACT(EPOCH |
| top_symbol | 0)), MAX(COALESCE(impact_score, symbol |
| top5 | 'Unknown'), (to_jsonb(m, 0), 0) DESC NULLS LAST ), change_percent, gap_percent, market_cap, sector, symbol |
| tradable_universe | 0), 0) * 3)), 1, avg_volume_30d, change_percent, gap_percent, market_cap, previous_close, price, price), relative_volume, sector, strategy, symbol, updated_at, volume |
| trade_catalysts | ''), 'Catalyst detected'), 'Momentum Continuation'), 'No catalyst'), 'catalyst', 'catalyst_engine', 'news'), 'setup'::text, 0), 0) >= 75 THEN 'B' ELSE 'C' END), 0)::numeric, COALESCE(score, COUNT::int, MAX, NOW(), NULL::text, ON  symbol, UPPER, catalyst_type, change_percent, class, confidence, created_at, event_type, gap_percent, headline, now, probability, published_at, relative_volume, rvol, score, sector, sentiment, source, strategy, symbol, updated_at, volume |
| trade_metadata | conviction, notes, review_status, screenshot_url, setup_type, tags_json, trade_id |
| trade_setups | ''), 'Momentum Continuation'), 'Setup detected'), 'setup'::text, (to_jsonb(ts, 0), 0)), 0)::numeric, ::numeric, ::timestamptz, COALESCE(score, COUNT::int, MAX, NOW, NOW(), NULLIF(TRIM(setup, NULLIF(to_jsonb(ts, NULLIF->>'setup', NULLIF->>'strategy', ON  symbol, UPPER, atr, catalyst_type, change_percent, company_name, detected_at, float_rotation, gap_percent, grade, headline, industry, price, published_at, relative_volume, score, sector, sentiment, setup, source, symbol |
| trade_signals | 'Unknown'), 'unknown'), 0), NOW(), atr_percent, catalyst_score, catalyst_type, confidence, confirmation_score, created_at, entry_price, entry_time, exit_price, exit_time, exit_time IS NOT NULL THEN EXTRACT(EPOCH, float_rotation, gap_percent, hierarchy_rank, id, include_in_briefing, liquidity_surge, max_move, narrative, price, rationale, relative_volume, result_percent, rvol, score, score_breakdown, sector, sector_score, signal_class, signal_explanation, strategy, strategy), symbol, updated_at |
| trade_tags | colour_hex, tag_name, user_id |
| trades | ${fields.join(', ')}, 0)::numeric, COUNT::int, MAX(pnl_dollar, MIN(pnl_dollar, SUM, SUM(commission_total, SUM(pnl_dollar, closed_at, commission_total, conviction, dataset_scope, duration_seconds, entry_price, exit_price, notes, opened_at, pnl_dollar, pnl_percent, qty, review_status, screenshot_url, setup_type, side, status, symbol, tags_json, trade_id, user_id |
| usage_events | COUNT, path, ts, user |
| user_alerts | alert_id, alert_name, created_at, enabled, frequency, last_triggered, message, message_template, query_tree, symbol, triggered_at, user_id |
| user_feature_access | enabled, feature_key, reason, updated_at, updated_by, user_id |
| user_preferences | enabled_strategies, min_gap, min_rvol, preferred_sectors, updated_at, user_id |
| user_presets | ${fields.join(', ')}, exchanges, include_etfs, include_spacs, include_warrants, is_default, max_market_cap, max_price, min_market_cap, min_price, name, sectors, user_id |
| user_roles | 0) = 1 THEN 'admin' ELSE 'free' END, NOW(), created_at, id, is_admin, role, updated_at, updated_by, user_id |
| user_signal_feedback | 'Unknown'), AVG::numeric, COUNT::int, created_at, rating, signal_id, strategy, user_id |
| user_watchlists | change_percent, class, gap_percent, probability, relative_volume, score, sector, strategy, symbol, updated_at, user_id, volume |
| users | ${fields.join(', ''), ')}, 0) = 1 THEN 'admin' ELSE 'free' END, 0) = 1 THEN 'admin' ELSE 'free' END), CASE WHEN COALESCE(is_admin, COUNT, NOW(), NULLIF(TRIM(plan, active_preset_id, broker_access_token, broker_connected_at, broker_refresh_token, broker_status, broker_type, created_at, email, id, is_active, is_admin, last_login, login_count, password, plan, pplx_api_key, pplx_model, role, saxo_access_token, saxo_connected_at, saxo_refresh_token, saxo_token_expires, trading_timezone, updated_at, user_id, username |

## 3. Mismatches with schema

Schema tables loaded from snapshot: 105

| mismatch_type | table_name | column_name | reference | operation_type |
| --- | --- | --- | --- | --- |
| missing_column | opportunities | COUNT::int | scripts/generate-data-recovery-report.js:11 | read |
| missing_column | opportunities | COUNT::int | scripts/generate-engine-health-report.js:11 | read |
| missing_table | information_schema.tables | - | scripts/generate-system-health-report.js:29 | read |
| missing_column | market_quotes | COUNT::int | scripts/run-acceptance-smoke.js:115 | read |
| missing_table | SET | - | scripts/smoke-personalization.js:41 | write |
| missing_column | daily_ohlc | { | scripts/systemAudit.ts:131 | read |
| missing_column | daily_ohlc | head: | scripts/systemAudit.ts:131 | read |
| missing_column | intraday_1m | { | scripts/systemAudit.ts:235 | read |
| missing_column | intraday_1m | head: | scripts/systemAudit.ts:235 | read |
| missing_column | news_events | { | scripts/systemAudit.ts:245 | read |
| missing_column | news_events | head: | scripts/systemAudit.ts:245 | read |
| missing_column | news_events | { | scripts/systemAudit.ts:304 | read |
| missing_column | news_events | head: | scripts/systemAudit.ts:304 | read |
| missing_table | information_schema.columns | - | server/alerts/alert_engine.js:44 | read |
| missing_table | information_schema.tables | - | server/alerts/alert_scheduler.js:18 | read |
| missing_table | timestamp | - | server/cache/sparklineCacheEngine.js:33 | read |
| missing_column | intraday_1m | EXTRACT(EPOCH | server/cache/sparklineCacheEngine.js:33 | read |
| missing_table | jsonb_to_recordset | - | server/catalyst/catalyst_engine.js:140 | write |
| missing_column | trade_catalysts | NOW() | server/catalyst/catalyst_engine.js:140 | write |
| missing_table | SET | - | server/catalyst/catalyst_engine.js:140 | write |
| missing_column | trade_catalysts | COUNT::int | server/catalyst/run_catalyst.js:9 | read |
| missing_column | usage_events | COUNT | server/db/index.js:42 | read |
| missing_column | usage_events | COUNT | server/db/index.js:45 | read |
| missing_column | usage_events | COUNT | server/db/index.js:51 | read |
| missing_column | usage_events | COUNT | server/db/sqlite_legacy.js:44 | read |
| missing_column | usage_events | COUNT | server/db/sqlite_legacy.js:47 | read |
| missing_column | usage_events | COUNT | server/db/sqlite_legacy.js:53 | read |
| missing_column | trade_setups | UPPER | server/discovery/discovery_engine.js:11 | read |
| missing_column | trade_setups | 'setup'::text | server/discovery/discovery_engine.js:11 | read |
| missing_column | trade_setups | COALESCE(score | server/discovery/discovery_engine.js:11 | read |
| missing_column | trade_setups | 0)::numeric | server/discovery/discovery_engine.js:11 | read |
| missing_column | trade_catalysts | UPPER | server/discovery/discovery_engine.js:11 | read |
| missing_column | trade_catalysts | 'setup'::text | server/discovery/discovery_engine.js:11 | read |
| missing_column | trade_catalysts | COALESCE(score | server/discovery/discovery_engine.js:11 | read |
| missing_column | trade_catalysts | 0)::numeric | server/discovery/discovery_engine.js:11 | read |
| missing_column | earnings_events | UPPER | server/discovery/discovery_engine.js:11 | read |
| missing_column | earnings_events | 'setup'::text | server/discovery/discovery_engine.js:11 | read |
| missing_column | earnings_events | COALESCE(score | server/discovery/discovery_engine.js:11 | read |
| missing_column | earnings_events | 0)::numeric | server/discovery/discovery_engine.js:11 | read |
| missing_table | setup_candidates | - | server/discovery/discovery_engine.js:11 | read |
| missing_table | catalyst_candidates | - | server/discovery/discovery_engine.js:11 | read |
| missing_table | earnings_candidates | - | server/discovery/discovery_engine.js:11 | read |
| missing_table | all_candidates | - | server/discovery/discovery_engine.js:11 | read |
| missing_column | trade_setups | UPPER | server/discovery/discovery_engine.js:20 | read |
| missing_column | trade_setups | 'setup'::text | server/discovery/discovery_engine.js:20 | read |
| missing_column | trade_setups | COALESCE(score | server/discovery/discovery_engine.js:20 | read |
| missing_column | trade_setups | 0)::numeric | server/discovery/discovery_engine.js:20 | read |
| missing_column | trade_catalysts | UPPER | server/discovery/discovery_engine.js:20 | read |
| missing_column | trade_catalysts | 'setup'::text | server/discovery/discovery_engine.js:20 | read |
| missing_column | trade_catalysts | COALESCE(score | server/discovery/discovery_engine.js:20 | read |
| missing_column | trade_catalysts | 0)::numeric | server/discovery/discovery_engine.js:20 | read |
| missing_column | earnings_events | UPPER | server/discovery/discovery_engine.js:20 | read |
| missing_column | earnings_events | 'setup'::text | server/discovery/discovery_engine.js:20 | read |
| missing_column | earnings_events | COALESCE(score | server/discovery/discovery_engine.js:20 | read |
| missing_column | earnings_events | 0)::numeric | server/discovery/discovery_engine.js:20 | read |
| missing_table | setup_candidates | - | server/discovery/discovery_engine.js:20 | read |
| missing_table | catalyst_candidates | - | server/discovery/discovery_engine.js:20 | read |
| missing_table | earnings_candidates | - | server/discovery/discovery_engine.js:20 | read |
| missing_table | all_candidates | - | server/discovery/discovery_engine.js:20 | read |
| missing_table | jsonb_to_recordset | - | server/discovery/discovery_engine.js:73 | write |
| missing_column | discovered_symbols | NOW() | server/discovery/discovery_engine.js:73 | write |
| missing_table | SET | - | server/discovery/discovery_engine.js:73 | write |
| missing_column | discovered_symbols | COUNT::int | server/discovery/run_discovery.js:9 | read |
| missing_column | market_quotes | UPPER | server/engines/catalystEngine.js:109 | read |
| missing_table | SET | - | server/engines/catalystEngine.js:167 | write |
| missing_column | intraday_1m | COUNT::int | server/engines/duplicateTickEngine.js:10 | read |
| missing_column | market_quotes | COUNT::int | server/engines/duplicateTickEngine.js:20 | read |
| missing_column | market_metrics | 0) | server/engines/earlyAccumulationEngine.js:92 | read |
| missing_column | market_metrics | market_cap | server/engines/earlyAccumulationEngine.js:92 | read |
| missing_column | market_metrics | 0) > 0 THEN  ELSE 0 END | server/engines/earlyAccumulationEngine.js:92 | read |
| missing_column | market_metrics | 0 ) | server/engines/earlyAccumulationEngine.js:92 | read |
| missing_column | market_metrics | sector | server/engines/earlyAccumulationEngine.js:92 | read |
| missing_column | market_metrics | 'Unknown') | server/engines/earlyAccumulationEngine.js:92 | read |
| missing_column | market_quotes | 0) | server/engines/earlyAccumulationEngine.js:92 | read |
| missing_column | market_quotes | avg_volume_30d | server/engines/earlyAccumulationEngine.js:92 | read |
| missing_column | market_quotes | float_shares | server/engines/earlyAccumulationEngine.js:92 | read |
| missing_column | market_quotes | 0) > 0 THEN  ELSE 0 END | server/engines/earlyAccumulationEngine.js:92 | read |
| missing_column | market_quotes | 0 ) | server/engines/earlyAccumulationEngine.js:92 | read |
| missing_column | market_quotes | 'Unknown') | server/engines/earlyAccumulationEngine.js:92 | read |
| missing_column | early_accumulation_signals | $1 | server/engines/earlyAccumulationEngine.js:132 | write |
| missing_column | early_accumulation_signals | $2 | server/engines/earlyAccumulationEngine.js:132 | write |
| missing_column | early_accumulation_signals | $3 | server/engines/earlyAccumulationEngine.js:132 | write |
| missing_column | early_accumulation_signals | $4 | server/engines/earlyAccumulationEngine.js:132 | write |
| missing_column | early_accumulation_signals | $5 | server/engines/earlyAccumulationEngine.js:132 | write |
| missing_column | early_accumulation_signals | $6 | server/engines/earlyAccumulationEngine.js:132 | write |
| missing_column | early_accumulation_signals | $7 | server/engines/earlyAccumulationEngine.js:132 | write |
| missing_column | early_accumulation_signals | $8 | server/engines/earlyAccumulationEngine.js:132 | write |
| missing_column | early_accumulation_signals | $9 | server/engines/earlyAccumulationEngine.js:132 | write |
| missing_column | early_accumulation_signals | $10 | server/engines/earlyAccumulationEngine.js:132 | write |
| missing_column | early_accumulation_signals | $11 | server/engines/earlyAccumulationEngine.js:132 | write |
| missing_column | early_accumulation_signals | $12 | server/engines/earlyAccumulationEngine.js:132 | write |
| missing_column | early_accumulation_signals | NOW() WHERE NOT EXISTS ( SELECT 1 | server/engines/earlyAccumulationEngine.js:132 | write |
| missing_column | market_quotes | id | server/engines/earlySignalOutcomeEngine.js:55 | read |
| missing_column | market_quotes | detected_at | server/engines/earlySignalOutcomeEngine.js:55 | read |
| missing_table | SET | - | server/engines/earlySignalOutcomeEngine.js:95 | write |
| missing_table | SET | - | server/engines/earningsEngine.js:81 | write |
| missing_column | earnings_events | price | server/engines/expectedMoveEngine.js:23 | read |
| missing_column | earnings_events | 0) | server/engines/expectedMoveEngine.js:23 | read |
| missing_column | earnings_events | atr_percent | server/engines/expectedMoveEngine.js:23 | read |
| missing_column | earnings_events | price)) * 100 ELSE NULL END | server/engines/expectedMoveEngine.js:23 | read |
| missing_column | earnings_events | ABS | server/engines/expectedMoveEngine.js:23 | read |
| missing_column | earnings_events | change_percent | server/engines/expectedMoveEngine.js:23 | read |
| missing_column | earnings_events | change_percent)) | server/engines/expectedMoveEngine.js:23 | read |
| missing_column | earnings_events | 0 ) | server/engines/expectedMoveEngine.js:23 | read |
| missing_column | market_metrics | earnings_date | server/engines/expectedMoveEngine.js:23 | read |
| missing_column | market_metrics | 0) | server/engines/expectedMoveEngine.js:23 | read |
| missing_column | market_metrics | price)) * 100 ELSE NULL END | server/engines/expectedMoveEngine.js:23 | read |
| missing_column | market_metrics | ABS | server/engines/expectedMoveEngine.js:23 | read |
| missing_column | market_metrics | change_percent)) | server/engines/expectedMoveEngine.js:23 | read |
| missing_column | market_metrics | 0 ) | server/engines/expectedMoveEngine.js:23 | read |
| missing_column | market_quotes | earnings_date | server/engines/expectedMoveEngine.js:23 | read |
| missing_column | market_quotes | 0) | server/engines/expectedMoveEngine.js:23 | read |
| missing_column | market_quotes | atr_percent | server/engines/expectedMoveEngine.js:23 | read |
| missing_column | market_quotes | price)) * 100 ELSE NULL END | server/engines/expectedMoveEngine.js:23 | read |
| missing_column | market_quotes | ABS | server/engines/expectedMoveEngine.js:23 | read |
| missing_column | market_quotes | change_percent)) | server/engines/expectedMoveEngine.js:23 | read |
| missing_column | market_quotes | 0 ) | server/engines/expectedMoveEngine.js:23 | read |
| missing_table | SET | - | server/engines/expectedMoveEngine.js:54 | write |
| missing_column | market_metrics | COALESCE(relative_volume | server/engines/flowDetectionEngine.js:53 | read |
| missing_column | market_metrics | 0) | server/engines/flowDetectionEngine.js:53 | read |
| missing_column | market_metrics | COALESCE(float_rotation | server/engines/flowDetectionEngine.js:53 | read |
| missing_column | market_metrics | COALESCE(liquidity_surge | server/engines/flowDetectionEngine.js:53 | read |
| missing_column | market_metrics | CASE WHEN COALESCE(relative_volume | server/engines/flowDetectionEngine.js:53 | read |
| missing_column | market_metrics | 0) >= 4 THEN 'aggressive' WHEN COALESCE(relative_volume | server/engines/flowDetectionEngine.js:53 | read |
| missing_column | market_metrics | 0) >= 2 THEN 'building' ELSE 'watch' END | server/engines/flowDetectionEngine.js:53 | read |
| missing_table | SET | - | server/engines/fmpMarketIngestion.js:254 | write |
| missing_column | market_metrics | COALESCE(relative_volume | server/engines/institutionalFlowEngine.js:28 | read |
| missing_column | market_metrics | 0) | server/engines/institutionalFlowEngine.js:28 | read |
| missing_column | market_metrics | COALESCE(volume | server/engines/institutionalFlowEngine.js:28 | read |
| missing_column | market_metrics | COALESCE(change_percent | server/engines/institutionalFlowEngine.js:28 | read |
| missing_column | market_metrics | CASE WHEN COALESCE(change_percent | server/engines/institutionalFlowEngine.js:28 | read |
| missing_column | market_metrics | 0) >= 4 THEN 1 WHEN COALESCE(change_percent | server/engines/institutionalFlowEngine.js:28 | read |
| missing_column | market_metrics | 3 END | server/engines/institutionalFlowEngine.js:28 | read |
| missing_column | news_articles | ai_analysis | server/engines/intelAnalysisEngine.js:104 | write |
| missing_table | SET | - | server/engines/intelNewsEngine.js:49 | write |
| missing_table | SET | - | server/engines/liquiditySurgeEngine.js:85 | write |
| missing_column | market_metrics | close | server/engines/mcpContextEngine.js:14 | read |
| missing_column | market_metrics | sector | server/engines/mcpContextEngine.js:21 | read |
| missing_column | market_metrics | AVG | server/engines/mcpContextEngine.js:21 | read |
| missing_column | market_metrics | COUNT | server/engines/mcpContextEngine.js:21 | read |
| missing_column | market_quotes | avg_volume_30d | server/engines/metricsEngine.js:29 | read |
| missing_column | market_quotes | change_percent END | server/engines/metricsEngine.js:29 | read |
| missing_column | market_quotes | avg_volume_30d ELSE NULL END | server/engines/metricsEngine.js:29 | read |
| missing_column | market_quotes | price ELSE NULL END | server/engines/metricsEngine.js:29 | read |
| missing_column | market_quotes | high_price | server/engines/metricsEngine.js:29 | read |
| missing_column | market_quotes | low_price | server/engines/metricsEngine.js:29 | read |
| missing_column | market_quotes | 0) > 0 THEN  * 100 ELSE NULL END | server/engines/metricsEngine.js:29 | read |
| missing_column | daily_ohlc | price | server/engines/metricsEngine.js:29 | read |
| missing_column | daily_ohlc | market_cap | server/engines/metricsEngine.js:29 | read |
| missing_column | daily_ohlc | avg_volume_30d | server/engines/metricsEngine.js:29 | read |
| missing_column | daily_ohlc | change_percent END | server/engines/metricsEngine.js:29 | read |
| missing_column | daily_ohlc | avg_volume_30d ELSE NULL END | server/engines/metricsEngine.js:29 | read |
| missing_column | daily_ohlc | price ELSE NULL END | server/engines/metricsEngine.js:29 | read |
| missing_column | daily_ohlc | high_price | server/engines/metricsEngine.js:29 | read |
| missing_column | daily_ohlc | low_price | server/engines/metricsEngine.js:29 | read |
| missing_column | daily_ohlc | 0) > 0 THEN  * 100 ELSE NULL END | server/engines/metricsEngine.js:29 | read |
| missing_table | LATERAL | - | server/engines/metricsEngine.js:29 | read |
| missing_table | SET | - | server/engines/metricsEngine.js:123 | write |
| missing_column | trade_signals | 'unknown') | server/engines/morningBriefEngine.js:45 | read |
| missing_column | trade_signals | relative_volume | server/engines/morningBriefEngine.js:45 | read |
| missing_column | trade_signals | 0) | server/engines/morningBriefEngine.js:45 | read |
| missing_column | news_catalysts | strategy | server/engines/morningBriefEngine.js:45 | read |
| missing_column | news_catalysts | score | server/engines/morningBriefEngine.js:45 | read |
| missing_column | news_catalysts | confidence | server/engines/morningBriefEngine.js:45 | read |
| missing_column | news_catalysts | narrative | server/engines/morningBriefEngine.js:45 | read |
| missing_column | news_catalysts | 'unknown') | server/engines/morningBriefEngine.js:45 | read |
| missing_column | news_catalysts | relative_volume | server/engines/morningBriefEngine.js:45 | read |
| missing_column | news_catalysts | 0) | server/engines/morningBriefEngine.js:45 | read |
| missing_column | market_metrics | strategy | server/engines/morningBriefEngine.js:45 | read |
| missing_column | market_metrics | score | server/engines/morningBriefEngine.js:45 | read |
| missing_column | market_metrics | confidence | server/engines/morningBriefEngine.js:45 | read |
| missing_column | market_metrics | narrative | server/engines/morningBriefEngine.js:45 | read |
| missing_column | market_metrics | catalyst_type | server/engines/morningBriefEngine.js:45 | read |
| missing_column | market_metrics | 'unknown') | server/engines/morningBriefEngine.js:45 | read |
| missing_column | market_metrics | 0) | server/engines/morningBriefEngine.js:45 | read |
| missing_table | LATERAL | - | server/engines/morningBriefEngine.js:45 | read |
| missing_table | sector_agg | - | server/engines/morningBriefEngine.js:135 | read |
| missing_column | earnings_events | earnings_date::text | server/engines/morningBriefEngine.js:152 | read |
| missing_column | daily_signal_snapshot | $1::date | server/engines/newsletterEngine.js:163 | write |
| missing_column | daily_signal_snapshot | NOW() | server/engines/newsletterEngine.js:163 | write |
| missing_column | signal_hierarchy | strategy) | server/engines/newsletterEngine.js:206 | read |
| missing_column | signal_hierarchy | catalyst_type | server/engines/newsletterEngine.js:206 | read |
| missing_column | signal_hierarchy | 'unknown') | server/engines/newsletterEngine.js:206 | read |
| missing_column | signal_hierarchy | sector | server/engines/newsletterEngine.js:206 | read |
| missing_column | signal_hierarchy | 'Unknown') | server/engines/newsletterEngine.js:206 | read |
| missing_column | signal_hierarchy | price | server/engines/newsletterEngine.js:206 | read |
| missing_column | signal_hierarchy | 0) | server/engines/newsletterEngine.js:206 | read |
| missing_column | news_catalysts | score | server/engines/newsletterEngine.js:206 | read |
| missing_column | news_catalysts | confidence | server/engines/newsletterEngine.js:206 | read |
| missing_column | news_catalysts | strategy | server/engines/newsletterEngine.js:206 | read |
| missing_column | news_catalysts | strategy) | server/engines/newsletterEngine.js:206 | read |
| missing_column | news_catalysts | 'unknown') | server/engines/newsletterEngine.js:206 | read |
| missing_column | news_catalysts | sector | server/engines/newsletterEngine.js:206 | read |
| missing_column | news_catalysts | 'Unknown') | server/engines/newsletterEngine.js:206 | read |
| missing_column | news_catalysts | price | server/engines/newsletterEngine.js:206 | read |
| missing_column | news_catalysts | 0) | server/engines/newsletterEngine.js:206 | read |
| missing_column | news_catalysts | signal_class | server/engines/newsletterEngine.js:206 | read |
| missing_column | news_catalysts | hierarchy_rank | server/engines/newsletterEngine.js:206 | read |
| missing_column | trade_signals | strategy) | server/engines/newsletterEngine.js:206 | read |
| missing_column | trade_signals | 'unknown') | server/engines/newsletterEngine.js:206 | read |
| missing_column | trade_signals | 'Unknown') | server/engines/newsletterEngine.js:206 | read |
| missing_column | trade_signals | price | server/engines/newsletterEngine.js:206 | read |
| missing_column | trade_signals | 0) | server/engines/newsletterEngine.js:206 | read |
| missing_table | LATERAL | - | server/engines/newsletterEngine.js:206 | read |
| missing_column | market_quotes | score | server/engines/newsletterEngine.js:206 | read |
| missing_column | market_quotes | confidence | server/engines/newsletterEngine.js:206 | read |
| missing_column | market_quotes | strategy | server/engines/newsletterEngine.js:206 | read |
| missing_column | market_quotes | strategy) | server/engines/newsletterEngine.js:206 | read |
| missing_column | market_quotes | catalyst_type | server/engines/newsletterEngine.js:206 | read |
| missing_column | market_quotes | 'unknown') | server/engines/newsletterEngine.js:206 | read |
| missing_column | market_quotes | 'Unknown') | server/engines/newsletterEngine.js:206 | read |
| missing_column | market_quotes | 0) | server/engines/newsletterEngine.js:206 | read |
| missing_column | market_quotes | signal_class | server/engines/newsletterEngine.js:206 | read |
| missing_column | market_quotes | hierarchy_rank | server/engines/newsletterEngine.js:206 | read |
| missing_column | newsletter_subscribers | COUNT::int | server/engines/newsletterEngine.js:256 | read |
| missing_column | tradable_universe | 0) | server/engines/opportunityEngine.js:36 | read |
| missing_column | tradable_universe | 0) * 3)) | server/engines/opportunityEngine.js:36 | read |
| missing_column | market_metrics | 0) | server/engines/opportunityEngine.js:36 | read |
| missing_column | market_metrics | 0) * 3)) | server/engines/opportunityEngine.js:36 | read |
| missing_table | SET | - | server/engines/opportunityEngine.js:55 | write |
| missing_column | market_metrics | 0) | server/engines/opportunityRanker.js:33 | read |
| missing_column | market_metrics | score | server/engines/opportunityRanker.js:33 | read |
| missing_column | trade_setups | 0) | server/engines/opportunityRanker.js:33 | read |
| missing_column | trade_setups | change_percent | server/engines/opportunityRanker.js:33 | read |
| missing_column | trade_catalysts | gap_percent | server/engines/opportunityRanker.js:33 | read |
| missing_column | trade_catalysts | 0) | server/engines/opportunityRanker.js:33 | read |
| missing_column | trade_catalysts | relative_volume | server/engines/opportunityRanker.js:33 | read |
| missing_column | trade_catalysts | change_percent | server/engines/opportunityRanker.js:33 | read |
| missing_table | LATERAL | - | server/engines/opportunityRanker.js:33 | read |
| missing_column | market_metrics | 0) | server/engines/orderFlowImbalanceEngine.js:45 | read |
| missing_column | market_metrics | market_cap | server/engines/orderFlowImbalanceEngine.js:45 | read |
| missing_column | market_metrics | 0) > 0 THEN  ELSE 0 END | server/engines/orderFlowImbalanceEngine.js:45 | read |
| missing_column | market_metrics | 0 ) | server/engines/orderFlowImbalanceEngine.js:45 | read |
| missing_column | market_quotes | 0) | server/engines/orderFlowImbalanceEngine.js:45 | read |
| missing_column | market_quotes | avg_volume_30d | server/engines/orderFlowImbalanceEngine.js:45 | read |
| missing_column | market_quotes | float_shares | server/engines/orderFlowImbalanceEngine.js:45 | read |
| missing_column | market_quotes | 0) > 0 THEN  ELSE 0 END | server/engines/orderFlowImbalanceEngine.js:45 | read |
| missing_column | market_quotes | 0 ) | server/engines/orderFlowImbalanceEngine.js:45 | read |
| missing_column | order_flow_signals | $1 | server/engines/orderFlowImbalanceEngine.js:109 | write |
| missing_column | order_flow_signals | $2 | server/engines/orderFlowImbalanceEngine.js:109 | write |
| missing_column | order_flow_signals | $3 | server/engines/orderFlowImbalanceEngine.js:109 | write |
| missing_column | order_flow_signals | $4 | server/engines/orderFlowImbalanceEngine.js:109 | write |
| missing_column | order_flow_signals | $5 | server/engines/orderFlowImbalanceEngine.js:109 | write |
| missing_column | order_flow_signals | $6 | server/engines/orderFlowImbalanceEngine.js:109 | write |
| missing_column | order_flow_signals | $7 | server/engines/orderFlowImbalanceEngine.js:109 | write |
| missing_column | order_flow_signals | NOW() WHERE NOT EXISTS ( SELECT 1 | server/engines/orderFlowImbalanceEngine.js:109 | write |
| missing_table | jsonb_to_recordset | - | server/engines/providerHealthEngine.js:94 | write |
| missing_column | provider_health | NOW() | server/engines/providerHealthEngine.js:94 | write |
| missing_column | market_metrics | sector | server/engines/sectorEngine.js:23 | read |
| missing_column | market_metrics | 'Unknown') | server/engines/sectorEngine.js:23 | read |

## 4. Legacy tables used in code

| legacy_table | reference | operation_type | call_type |
| --- | --- | --- | --- |
| opportunities | scripts/generate-data-recovery-report.js:11 | read | sql.query |
| opportunities | scripts/generate-engine-health-report.js:11 | read | sql.query |

## 5. Duplicate table responsibilities

| logical_domain | candidate_tables | tables_seen_in_code | duplicate_in_use |
| --- | --- | --- | --- |
| news | market_news, news_articles | news_articles | NO |
| alerts | alerts, signal_alerts | signal_alerts | NO |
| opportunities | opportunities, strategy_signals, opportunity_stream | opportunities, strategy_signals, opportunity_stream | YES |

## Notes

- This report is generated from static code analysis and SQL-string heuristics.
- Dynamic SQL construction can under-report columns/tables if names are interpolated at runtime.
- `database_schema_snapshot.csv` was reconstructed from live Supabase metadata because the expected file path was not present in the repository.
