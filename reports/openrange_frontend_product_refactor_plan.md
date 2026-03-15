# OpenRange Frontend Product Refactor Plan

Date: 2026-03-14
Scope: Frontend structure and product architecture refactor only.
Constraint: No backend engine logic changes, no database schema changes, no API endpoint breaks.

## 1) New Navigation Architecture

New top-level sidebar groups:

1. MARKET
2. DISCOVERY
3. BEACON
4. TRADING
5. LEARNING
6. SYSTEM

Proposed navigation map:

MARKET
- Radar
- Sector Rotation
- Market Overview
- News
- Market Regime
- Market Hours

DISCOVERY
- Scanner
- Full Screener
- Advanced Screener
- Expected Move
- Earnings Calendar

BEACON
- Intelligence Feed
- Opportunity Stream
- Signal Engine
- Trade Narratives

TRADING
- Charts
- Trade Setup
- Cockpit
- Watchlists
- Alerts

LEARNING
- Strategy Evaluation
- Calibration
- Strategy Edge
- Missed Opportunities
- Learning Dashboard

SYSTEM
- Admin
- Diagnostics
- Intelligence Monitor
- Feature Flags
- Users
- Audit Logs
- Profile

Routing strategy:
- Keep all existing URLs operational.
- Introduce pillar-prefixed canonical URLs.
- Add route aliases from existing URLs to canonical URLs.
- Migrate sidebar links first, then page-level internal links.

Canonical URL proposal:
- /market/*
- /discovery/*
- /beacon/*
- /trading/*
- /learning/*
- /system/*

## 2) Page-to-Pillar Mapping

MARKET CONTEXT:
- OpenRangeRadar
- MarketOverviewPage
- SectorHeatmap
- NewsScannerV2 (as News Feed)
- MarketRegime page (new frontend composition using existing endpoints)
- MarketHoursPage

DISCOVERY:
- InstitutionalScreener
- ScreenerFull
- AdvancedScreenerPage
- ExpectedMove
- EarningsCalendar

BEACON INTELLIGENCE ENGINE:
- IntelligenceEngine
- IntelInbox
- Opportunity Stream page (new view using /api/opportunity-stream and /api/opportunities)
- Signal Intelligence page (existing SignalIntelligenceAdmin view split for trader-facing Beacon mode)
- Trade Narratives page (new frontend view using existing narrative endpoints)

TRADING WORKSPACE:
- Charts
- TradeSetup
- LiveCockpit
- Watchlist page
- AlertsPage

STRATEGY LEARNING:
- StrategyEvaluationPage
- CalibrationDashboard
- MissedOpportunitiesPage
- StrategyEdgeDashboard
- LearningDashboard

SYSTEM CONTROL:
- AdminControlPanel
- SystemDiagnostics
- IntelligenceMonitorPage
- Feature Flags panel (inside AdminControlPanel tabs)
- Users panel (inside AdminControlPanel tabs)
- Audit Logs panel (inside AdminControlPanel tabs)

## 3) Shared Filtering System Design

Create unified filter architecture in a single reusable system.

Target folders:
- client/src/components/filters
- client/src/hooks/filters
- client/src/context/filters
- client/src/lib/filters

Core modules:

1. FilterSchema
- Defines supported filters and metadata.
- Field types: range, multi-select, single-select, boolean, tag.

2. FilterStateStore
- Central source of truth for active filters.
- URL query sync for shareable views.
- Optional local preset persistence.

3. FilterQueryBuilder
- Converts UI filter state into API query payload.
- Supports endpoint-specific mappings without changing backend contracts.

4. FilterPresetManager
- Save, load, rename, delete presets.
- Presets scoped by pillar and page.

5. FilterExecutionPolicy
- If estimated rows <= 1000: allow local filtering.
- If estimated rows > 1000: enforce server-side filtering and pagination.

Required filter fields:
- market cap
- relative volume
- price
- sector
- float
- gap %
- short interest
- earnings proximity
- news catalysts
- institutional ownership

Cross-surface support:
- scanner
- news feed
- signals
- opportunities
- sector rotation
- earnings

React Query integration:
- queryKey includes normalized filter hash.
- staleTime tiered by data type.
- keepPreviousData for paging.
- prefetch next page on scroll or paginator hover.

## 4) UI Component System

Create card-first intelligence design system with Tailwind tokens.

Design tokens:
- bg-slate-950
- bg-slate-900
- border-slate-800
- text-slate-100
- text-blue-400
- text-green-400
- text-red-400

New shared components:

1. SignalCard
- symbol
- setup type
- confidence score
- sector context
- catalyst summary
- expected move
- probability

2. OpportunityCard
- ranking
- momentum
- setup classification
- entry context

3. SectorMomentumCard
- sector strength
- rotation trend
- participation breadth

4. MarketBreadthCard
- adv/dec
- index trend
- volatility regime

5. StrategyScoreCard
- win rate
- edge score
- confidence drift
- sample count

6. NewsCatalystCard
- headline
- catalyst type
- sentiment tag
- impact score

Supporting primitives:
- ConfidenceGauge
- ProbabilityMeter
- MomentumBar
- TimelineSignalTrack
- MetricDeltaChip
- EmptyStateCard
- SkeletonState blocks

## 5) Page Redesign Concepts

MARKET CONTEXT UX:
- Replace dense tables with macro dashboard cards.
- Add sector rotation heatmap and breadth strip.
- Promote trend and regime visuals above raw rows.

DISCOVERY UX:
- One universal filter rail for all discovery pages.
- Results in card grid with optional compact list mode.
- Progressive disclosure for deeper fundamentals.

BEACON UX:
- Main experience becomes signal-card feed and timeline.
- Probability and confidence visual hierarchy first.
- Narrative snippets inline with catalyst and context.

TRADING UX:
- Dark terminal workspace.
- Docked panels for watchlist, alerts, and order flow.
- Beacon overlays on chart layers and setup panel.

LEARNING UX:
- Performance graph-first design.
- Strategy scorecards and edge heatmaps.
- Missed opportunity replay visualized as timeline.

SYSTEM UX:
- SaaS admin console with status cards and action trays.
- Standardized diagnostics and audit list patterns.

## 6) Migration Steps From Current Structure

Phase 1: Foundation
1. Add new sidebar information architecture.
2. Introduce pillar route groups while preserving current route aliases.
3. Add shared page shell variants: MarketShell, DiscoveryShell, BeaconShell, TradingShell, LearningShell, SystemShell.

Phase 2: Shared Filter Engine
1. Implement components/filters and hook up discovery pages first.
2. Migrate scanner, full screener, advanced screener to unified filter state.
3. Extend same filter engine to news, opportunities, and signals views.

Phase 3: Card System Rollout
1. Build shared card components and visualization primitives.
2. Replace table-first layouts in Market, Beacon, and Learning pages.
3. Keep optional compact table mode only for advanced users where needed.

Phase 4: Beacon Productization
1. Create Beacon hub pages under /beacon/* using existing APIs.
2. Add Opportunity Stream and Trade Narratives dedicated pages.
3. Normalize signal confidence/probability rendering across all Beacon pages.

Phase 5: Trading Workspace Upgrade
1. Implement terminal-style layout and dock panels.
2. Integrate Beacon overlays into charts and setup workflows.
3. Preserve all existing manual trading actions and data contracts.

Phase 6: System Consolidation
1. Unify AdminControlPanel tabs and admin satellite pages under /system/*.
2. Keep existing /admin* routes as aliases.
3. Standardize diagnostics widgets to one component library.

Phase 7: Hardening
1. Add performance guardrails for paging/filtering/lazy loading.
2. Add regression checks for all old URLs and API contract compatibility.
3. Freeze old page entry points and mark deprecation status.

## 7) Legacy Page Cleanup Plan

Do not delete now. Mark for staged deprecation.

Deprecation status model:
- active
- compatibility
- deprecated-pending-removal

Immediate legacy candidates to mark compatibility/deprecation:
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

Deprecation workflow:
1. Add metadata registry file for page status and replacement target.
2. Add console warning banner in deprecated pages in non-production builds.
3. Remove sidebar links to deprecated pages.
4. Keep route aliases to replacement pages until telemetry confirms no traffic.
5. Remove deprecated files only after two release cycles and route hit threshold is near zero.

## Non-Negotiable Technical Rules

1. Keep backend engines untouched.
2. Keep database schema untouched.
3. Keep existing API endpoints intact.
4. Use frontend composition only.
5. Use React Query caching, pagination, lazy loading, and server filtering for large datasets.

## Final Product Positioning

OpenRange becomes a workflow-driven trading intelligence platform where:
- MARKET sets context.
- DISCOVERY finds candidates.
- BEACON scores and prioritizes opportunities.
- TRADING executes with overlays and tools.
- LEARNING improves edge continuously.
- SYSTEM governs reliability and access.

This preserves existing backend power while delivering structural cohesion and a clear user journey.
