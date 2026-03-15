# OpenRange Full Architecture Audit Report

Date: 2026-03-14
Scope: Full repository architecture review (frontend pages/routes/nav, backend endpoints, engines, schedulers, tables, admin controls, feature flags, data flow, structure diagnosis)

## 1) Executive Summary

OpenRange is a multi-layer platform with a strong capability footprint but high architectural surface area. Core strengths are:
- Broad endpoint and engine coverage for pre-market/open-market/post-market workflows.
- Clear role/feature control primitives on both frontend and backend.
- Rich admin observability stack and ongoing migration toward modular route files.

Primary architecture risks:
- Dual architecture pattern: large monolithic server/index.js endpoint block plus many modular server/routes modules.
- Legacy page overlap in client/src/pages causing duplicate or orphaned UI implementations.
- Multiple independent scheduler systems (cron and interval loops) increase coordination and drift risk.
- Data model breadth is high; naming and ownership boundaries are not yet fully normalized.

Overall assessment:
- Product capability: high.
- Operational complexity: high.
- Maintainability: medium risk unless consolidation is prioritized.

## 2) Full Page Inventory

Total page files discovered: 59 under client/src/pages.

### 2.1 Routed public/auth pages
- LandingPage.jsx -> routes: /, /landing
- LoginPage.jsx -> /login
- RegisterPage.jsx -> /register
- ForgotPasswordPage.jsx -> /forgot-password
- ResetPasswordPage.jsx -> /reset-password

### 2.2 Routed protected non-admin pages
- DashboardPage.jsx -> /dashboard
- OpenRangeRadar.jsx -> /radar
- MobileDashboard.jsx -> /mobile-dashboard
- PreMarketCommandCenter.jsx -> /pre-market-command
- OpenMarketRadar.jsx -> /open-market-radar
- PostMarketReview.jsx -> /post-market-review
- MarketOverviewPage.jsx -> /market-overview
- MarketHoursPage.jsx -> /market-hours
- InstitutionalScreener.jsx -> /screener
- ScreenerFull.jsx -> /screener-full (feature: full_screener)
- ScreenerV3FMP.jsx -> /screener-v3-fmp
- AdvancedScreenerPage.jsx -> /advanced-screener
- NewsScannerV2.jsx -> /news-scanner, /news-feed, /news-v2
- ResearchPage.jsx -> /research
- AlertsPage.jsx -> /alerts (feature: alerts)
- Charts.jsx -> /charts
- TradeSetup.jsx -> /setup/:symbol
- LiveCockpit.tsx -> /live
- CockpitPage.jsx -> /cockpit (feature: trading_cockpit)
- IntelligenceEngine.jsx -> /intelligence, /intelligence-engine
- IntelInbox.jsx -> /intelligence-inbox
- IntelligenceFrameworkPage.jsx -> /intelligence-framework
- ExpectedMove.jsx -> /expected-move
- SectorHeatmap.jsx -> /sector-heatmap
- StrategyEvaluationPage.jsx -> /strategy-evaluation
- ProfilePage.jsx -> /profile
- AccessDenied.jsx -> /access-denied

### 2.3 Routed admin pages
- SignalIntelligenceAdmin.jsx -> /signal-intelligence-admin (RequireAdmin)
- AdminControlPanel.jsx -> /admin-control, /admin/features, /admin/users, /admin/roles, /admin/audit (RequireAdmin + admin_panel)
- AdminDiagnostics.jsx -> /admin/diagnostics (RequireAdmin + admin_panel)
- Admin/AdminHome.jsx -> /admin, /admin/home (RequireAdmin + admin_panel)
- Admin/SystemDiagnostics.jsx -> /admin/system-diagnostics, /admin/system (RequireAdmin + admin_panel)
- IntelligenceMonitorPage.jsx -> /admin/intelligence-monitor (RequireAdmin + admin_panel)
- Admin/SystemMonitorPage.jsx -> /admin/system-monitor (RequireAdmin + admin_panel)
- Admin/LearningDashboard.jsx -> /admin/learning-dashboard, /admin/learning (RequireAdmin + admin_panel)
- Admin/StrategyEdgeDashboard.jsx -> /admin/strategy-edge (RequireAdmin + admin_panel)
- Admin/CalibrationDashboard.jsx -> /admin/calibration (RequireAdmin + admin_panel)
- Admin/MissedOpportunitiesPage.jsx -> /admin/missed-opportunities, /admin/validation (RequireAdmin + admin_panel)
- Admin/SignalIntelligenceAdmin.jsx -> consumed via compatibility page export

### 2.4 Redirect aliases and compatibility routes
- /scanner and /screeners -> /screener
- /watchlists -> /watchlist
- /pre-market -> /pre-market-command
- /open-market -> /open-market-radar
- /post-market -> /post-market-review
- /market -> /market-overview
- /screener-v2 and /screener-v3 -> /screener
- /news -> /news-feed

### 2.5 Page files currently not wired in App routes (legacy/orphan candidates)
- ScreenersPage.jsx
- NewsScannerPage.jsx
- ScreenerV2.jsx
- ScreenerV3.jsx
- NewsScannerV3.jsx
- ScannerSection.jsx
- OpenMarketPage.jsx
- PreMarketPage.jsx
- PostMarketPage.jsx
- TickerHeatmap.jsx
- ExpectedMovePage.jsx
- PreMarketCommand.jsx
- AdminPage.jsx
- IntelligencePage.tsx
- ExpectedMovePage.jsx

## 3) Navigation Map

### 3.1 Primary navigation (Sidebar.tsx)
Command Centers:
- /pre-market-command
- /open-market-radar
- /post-market-review

Discovery:
- /screener
- /screener-full (feature: full_screener)
- /sector-heatmap

Intelligence:
- /intelligence-inbox
- /intelligence-engine
- /news-feed

Trading Tools:
- /charts
- /cockpit (feature: trading_cockpit)
- /expected-move
- /earnings-calendar
- /strategy-evaluation

System:
- /dashboard
- /radar
- /mobile-dashboard
- /alerts (feature: alerts)
- /research
- /admin/features (feature: admin_panel)
- /profile

### 3.2 Admin navigation (AdminSidebar.jsx)
System:
- /admin/system-diagnostics
- /admin/intelligence-monitor
- /admin/system-monitor

Control:
- /admin/users
- /admin-control?tab=roles
- /admin/features
- /admin-control?tab=audit

Signals:
- /signal-intelligence-admin
- /signal-intelligence-admin?section=order-flow
- /signal-intelligence-admin?section=opportunity

Learning:
- /admin/learning-dashboard
- /admin/strategy-edge
- /admin/learning

Validation:
- /admin/calibration
- /admin/missed-opportunities
- /admin/validation

## 4) API Endpoint Map

Backend endpoint footprint is split between:
- Monolithic definitions in server/index.js.
- Modular route files under server/routes.

### 4.1 High-traffic monolithic endpoint domains (server/index.js)
System/health/diagnostics:
- /api/health
- /api/system/health
- /api/system/data-freshness
- /api/system/activity
- /api/system/diagnostics
- /api/system/report
- /api/system/provider-health
- /api/system/events
- /api/system/alerts
- /api/system/engine-diagnostics

Market/intelligence/scanner:
- /api/moves
- /api/news
- /api/market/quotes
- /api/market/movers
- /api/market/sectors
- /api/market/indices
- /api/scanner
- /api/premarket
- /api/premarket/summary
- /api/radar/summary
- /api/opportunity-stream
- /api/opportunities
- /api/intelligence/summary
- /api/intelligence/trade-probability

AI and narrative:
- /api/ai-quant/status
- /api/ai-quant/market-context
- /api/ai-quant/sector-performance
- /api/ai-quant/build-plan
- /api/ai-quant/query
- /api/intelligence/narrative
- /api/market-narrative

Auth/user and secured feeds:
- /api/users/* (mounted)
- /api/auth/login
- /api/auth/verify
- /api/watchlist/signals
- /api/signals/feedback
- /api/user/performance

External/provider proxies:
- /api/finviz/news
- /api/finviz/screener
- /api/finviz/quote
- /api/fmp/screener
- /api/fmp/full-universe
- /api/fmp/quotes

### 4.2 Modular route domains (server/routes)
- Admin: admin.js, adminFeatureAccess.js, adminValidationRoutes.js, adminLearningRoutes.js
- Trades: trades.js, dailyReviews.js
- Alerts/opportunities/signals/intel details: alerts.js, opportunities.js, signals.js, intelDetails.js
- News and canonical ingestion: news.js, newsV3.js, newsV4.ts, canonical/*.ts
- Market/quotes/chart: marketData.js, quotes.js, quotesBatch.js, chartV2.ts
- Radar/performance/briefing: radarRoutes.js, radarTrades.js, performanceRoutes.js, briefingRoutes.js
- Profile/auth-adjacent: profile.js
- Options/earnings: options.js, optionsRoutes.js, earnings.js, earningsRoutes.js

### 4.3 Endpoint-to-table mapping (primary table families)
This map reflects dominant table usage patterns found in backend SQL.

Market and scanner endpoints:
- Primary tables: market_metrics, market_quotes, intraday_1m, ticker_universe, tradable_universe

News/intelligence endpoints:
- Primary tables: news_articles, intel_news, news_catalysts, intelligence_emails, market_narratives

Signal/strategy endpoints:
- Primary tables: strategy_signals, trade_signals, signal_registry, signal_outcomes, signal_component_outcomes, signal_features, signal_hierarchy, signal_calibration_log, strategy_trades, strategy_weights, strategy_learning_metrics, strategy_performance_dashboard

Opportunity endpoints:
- Primary tables: opportunity_stream, opportunity_intelligence, flow_signals, early_accumulation_signals, order_flow_signals, beacon_rankings

Validation/calibration/admin analytics endpoints:
- Primary tables: signal_validation_daily, signal_validation_weekly, missed_opportunities, expected_move_tracking, daily_signal_snapshot

User/admin/feature control endpoints:
- Primary tables: users, user_roles, user_feature_access, feature_access_audit, usage_events, settings, user_watchlists, user_alerts, user_presets, user_signal_feedback

Trading journal endpoints:
- Primary tables: trades, trade_metadata, trade_tags, daily_reviews

System observability endpoints:
- Primary tables: system_events, system_alerts, data_integrity_events, sparkline_cache

## 5) Engine Architecture

Total engine files discovered under server/engines: 74.

### 5.1 Core engine clusters
- Signal generation/scoring: signalScoringEngine, signalFeatureEngine, signalHierarchyEngine, signalCaptureEngine, signalConfirmationEngine.
- Strategy and learning: strategyEngine, strategySignalEngine, strategyEvaluationEngine, strategyLearningEngine, adaptiveStrategyEngine.
- Opportunity and ranking: opportunityEngine, opportunityRanker, opportunityIntelligenceEngine.
- Narrative stack: narrativeEngine, signalNarrativeEngine, tradeNarrativeEngine, marketNarrativeEngine, intelNarrativeEngine, mcpNarrativeEngine.
- Market context and sector: marketContextEngine, sectorRotationEngine, sectorMomentumEngine, marketRegimeEngine.
- Validation/calibration: signalCalibrationEngine, calibrationPriceUpdater, validationEngine, missedOpportunityEngine, missedOpportunityReplay.
- Health/integrity: dataHealthEngine, dataIntegrityEngine, providerHealthEngine, candleIntegrityEngine, engineDiagnostics.

### 5.2 Orchestration and startup
- Main startup/orchestration: server/system/startEngines.js.
- Additional scheduler stacks: server/engines/scheduler.js, server/system/engineScheduler.js, server/scheduler/phaseScheduler.js.
- Intelligence-specific pipelines: intelligencePipeline.js and route-level intelligence ingestion.

## 6) Database Table Map

Top referenced tables in backend SQL (frequency-weighted):
- market_metrics, market_quotes
- users
- strategy_signals
- news_articles
- trade_catalysts, trade_setups
- earnings_events, daily_ohlc, intraday_1m
- intel_news
- signal_registry
- trades, trade_signals
- opportunity_stream
- usage_events
- missed_opportunities
- user_alerts, user_watchlists, user_feature_access
- system_events, system_alerts, data_integrity_events
- sparkline_cache

Logical data domains:
- Market data: market_metrics, market_quotes, intraday_1m, daily_ohlc, ticker_universe.
- Intelligence/news: news_articles, intel_news, news_events, intelligence_emails.
- Signals/strategy: strategy_signals, signal_registry, signal_outcomes, strategy_* tables.
- Opportunities/flow: opportunity_stream, flow_signals, early_accumulation_signals, order_flow_signals.
- Admin/user/access: users, user_roles, user_feature_access, feature_access_audit.
- Reliability/ops: system_events, system_alerts, data_integrity_events, cache tables.

## 7) Admin System Overview

### 7.1 Frontend admin layers
- Admin shell components: AdminShell, AdminSidebar, AdminHeader, KPICard, AdminTable, StatusBadge.
- Admin pages cover diagnostics, system activity, learning, strategy edge, calibration, missed opportunities, and feature governance.
- Route protection uses nested RequireAdmin + FeatureGateRoute(admin_panel).

### 7.2 Backend admin layers
- Role gating middleware: requireAdminAccess validates JWT-admin role or admin/proxy API key.
- Admin route groups:
  - /api/admin/stats, /usage, /users, /diagnostics, /intelligence, /providers, /audit, /system
  - /api/admin/features/* and /api/features/me
  - /api/admin/validation/* and /api/admin/learning/*

### 7.3 Observability depth
- Admin UIs combine engine telemetry, provider health, freshness metrics, and validation analytics.
- Some admin pages include endpoint fallback logic to survive partial backend outages.

## 8) Feature Flag System

Source registry (server/config/features.js) includes:
- dashboard
- scanner_page
- intel_inbox
- sector_heatmap
- premarket_command
- open_market_radar
- post_market_review
- full_screener
- alerts
- expected_move
- earnings_calendar
- trading_cockpit
- signal_intelligence_admin
- strategy_evaluation
- admin_panel
- newsletter_admin

Client behavior:
- FeatureAccessContext loads /api/features/me, defaults all flags to false until loaded.
- FeatureGateRoute allows render on feature true or admin role override.
- Sidebar hides nav entries when associated feature flags are off.

## 9) Data Pipeline Flow

### 9.1 Ingestion
- External providers (Finviz/FMP/Finnhub/canonical feeds) -> route/service ingestion -> normalized market/news tables.

### 9.2 Engine processing
- Scheduler triggers engines for signals, ranking, narrative, calibration, and integrity checks.
- Engines write outputs into signal/opportunity/narrative/validation tables.

### 9.3 API serving
- Frontend pages consume /api endpoints.
- Admin pages read diagnostic, provider, and validation streams.
- Auth middleware gates protected routes after public/intel-key segments.

### 9.4 Feedback loops
- Signal performance, outcome tracking, and missed-opportunity replay feed strategy learning and calibration updates.
- Feature access and usage/audit events close the loop for governance.

## 10) Product Category Analysis

Primary product modules:
- Command Centers: pre-market, open-market, post-market workflows.
- Discovery: scanner, full screener, sector heatmap, advanced screener.
- Intelligence: inbox, narrative, catalysts, order flow, squeezes, opportunities.
- Execution support: charts, cockpit, expected move, setup pages.
- Governance/Admin: diagnostics, feature control, validation, learning dashboards.

Category cohesion:
- Strong user-facing taxonomy.
- Internal implementation still mixed across legacy and modernized page/route paths.

## 11) Structural Weaknesses

1. Monolith-plus-modules backend overlap
- server/index.js still contains a very large endpoint surface while many routes are modularized.
- Risk: duplicate behavior, inconsistent auth/error handling, higher regression risk.

2. Legacy frontend page overlap
- Multiple page variants exist for scanner/news/premarket workflows; some are no longer routed.
- Risk: code drift, accidental imports, inconsistent UX patterns.

3. Multi-scheduler concurrency complexity
- Several scheduler systems (cron + intervals) run in parallel domains.
- Risk: duplicate runs, timing races, harder observability.

4. Endpoint naming and compatibility sprawl
- Significant alias/redirect and compatibility paths are preserved.
- Risk: increased maintenance burden and unclear canonical API contracts.

5. Data ownership boundaries are broad
- Many engines touch adjacent domains without strict bounded contexts.
- Risk: migration friction, hard-to-isolate failures.

## 12) Recommended Product Architecture

### 12.1 Backend target architecture
- Move to route-first modular architecture only:
  - Keep server/index.js as composition/bootstrap layer.
  - Migrate remaining direct endpoints into route modules by domain.
- Add domain service boundaries:
  - market-service, intelligence-service, signal-service, admin-service, auth-service.
- Standardize endpoint contracts and deprecate aliases with explicit migration plan.

### 12.2 Frontend target architecture
- Keep App route map canonical and remove unrouted legacy pages after deprecation window.
- Split by feature domains:
  - pages/command-centers
  - pages/discovery
  - pages/intelligence
  - pages/admin
- Ensure one implementation per user workflow path.

### 12.3 Scheduler and engine governance
- Unify scheduling under one orchestrator abstraction (single registry).
- Define per-engine ownership, cadence, and lock policy.
- Expose centralized run history and failure metrics for all jobs.

### 12.4 Data model governance
- Define bounded contexts and table ownership by domain.
- Introduce schema docs for core tables and write paths.
- Add migration and deprecation policy for legacy tables/columns.

### 12.5 Delivery sequence
1. Route consolidation in backend.
2. Legacy page deprecation in frontend.
3. Scheduler unification.
4. Contract and schema hardening.
5. Monitoring/alerting standardization.

---

## Appendix A: Key files inspected
- client/src/App.jsx
- client/src/components/layout/Sidebar.tsx
- client/src/components/admin/AdminSidebar.jsx
- client/src/context/FeatureAccessContext.jsx
- client/src/components/auth/FeatureGateRoute.jsx
- server/index.js
- server/config/features.js
- server/middleware/requireAdminAccess.js
- server/system/startEngines.js
- server/engines/scheduler.js
- server/routes/* (admin, validation, learning, strategy, signals, market, news, profile, trades, canonical)

## Appendix B: Notes on confidence
- Route and page inventory confidence: high.
- Engine and scheduler inventory confidence: high.
- Endpoint-to-table mapping confidence: medium-high (domain-level primary mapping, based on SQL usage patterns across repository).
