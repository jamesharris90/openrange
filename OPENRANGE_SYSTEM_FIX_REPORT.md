# OPENRANGE SYSTEM FIX REPORT

Date: 2026-03-09
Scope: Full stabilization and completion pass across routing, data completeness, scoring transparency, scheduler coverage, new intelligence engines, frontend/admin UX, and system validation.

## Executive Outcome

Stabilization pass is implemented end-to-end, with architecture and data flow corrections deployed across backend, scheduler, and frontend. Core endpoints and engines are healthy. Score transparency and explanation persistence are in place. Two new intelligence engines were added and integrated.

One acceptance item remains partially unmet:
- `stocksInPlayEngine` runtime target `< 5s` is **not yet achieved**. Latest validated runtime is ~`17.9s`.

## Implemented Fixes (Mapped To Requested Steps)

1. Route shadowing fix (`/api/signals/:symbol`)
- Changed symbol route to `/api/signal/:symbol` to avoid intercepting `/api/signals/watchlist` and `/api/signals/alerts`.
- Updated frontend callers in:
  - `client/src/pages/TradeSetup.jsx`
  - `client/src/components/charts/SetupIntelligencePanel.jsx`
- Result: watchlist and alerts endpoints return correct payloads (200).

2. Scalar score transparency persistence
- Added persistence path for scalar score components in scoring pipeline.
- Persisted/ensured explicit fields where available and maintained `score_breakdown` JSON for component-level explainability.
- Added explanation persistence into `trade_signals.signal_explanation`.

3. `float_shares` / `atr_percent` data completeness
- Added one-time backfill script:
  - `server/scripts/backfillMarketMetrics.js`
- Added ongoing fallback logic in metrics pipeline:
  - `server/engines/metricsEngine.js`
- Result: missing values materially reduced (see Validation Metrics).

4. Index migration
- Added migration SQL:
  - `server/migrations/addSignalIndexes.sql`
- Applied migration to improve query performance for signal/intelligence reads.

5. Stocks-in-play optimization + runtime logging
- Refactored candidate selection and preloaded context joins in:
  - `server/engines/stocksInPlayEngine.js`
- Added runtime logging and reduced repeated overhead.
- Result: runtime improved significantly from prior baseline but remains above `<5s` target.

6. Scheduler completion
- Added missing stocks-in-play schedule in:
  - `server/system/startEngines.js`
- Added in-flight guards to reduce overlap risk.

7. New order-flow intelligence engine
- Added:
  - `server/engines/orderFlowImbalanceEngine.js`
- Added persistence/table handling and run integration.
- Added API endpoint exposure via intelligence routes.

8. New sector momentum engine
- Added:
  - `server/engines/sectorMomentumEngine.js`
- Added persistence and API exposure.

9. Scoring integration of new intelligence features
- Integrated order-flow and sector-momentum contributions in:
  - `server/engines/signalScoringEngine.js`
- Added corresponding breakdown entries in `score_breakdown`.

10. MCP explanation integration
- Added explanation generation method:
  - `server/services/mcpClient.js`
- Persisted result into `trade_signals.signal_explanation` with fallback handling.

11. Signal Intelligence Admin page
- Added new page:
  - `client/src/pages/SignalIntelligenceAdmin.jsx`
- Added app route:
  - `client/src/App.jsx` (`/signal-intelligence-admin`)

12. Strategy Evaluation upgrades
- Enhanced:
  - `client/src/pages/StrategyEvaluationPage.jsx`
- Added 30-day metrics, strategy/sector/catalyst/confidence filters, and timing/outcome analysis views.

13. Final validation and diagnostics
- Re-ran endpoint checks, engine execution, DB completeness checks, and syntax diagnostics on changed files.

## Validation Metrics

### Endpoint Verification (all expected 200)
- `/api/signals/watchlist` -> 200
- `/api/signals/alerts` -> 200
- `/api/signal/AAPL` -> 200
- `/api/intelligence/catalysts` -> 200
- `/api/intelligence/early-accumulation` -> 200
- `/api/intelligence/order-flow` -> 200
- `/api/intelligence/sector-momentum` -> 200

### Engine Runtime Snapshot (latest)
- `stocksInPlayEngine`: `17934 ms` (selected 7, upserted 7)
- `catalystEngine`: `545 ms`
- `earlyAccumulationEngine`: `549 ms`
- `orderFlowImbalanceEngine`: `101 ms`
- `sectorMomentumEngine`: `355 ms`

### Data Completeness Snapshot
- `market_metrics.total`: `5754`
- `market_metrics.missing_float_shares`: `2199` (61.79% populated)
- `market_metrics.missing_atr_percent`: `636` (88.95% populated)

### Signal/Intelligence Table Counts
- `trade_signals`: `24`
- `dynamic_watchlist`: `2`
- `signal_alerts`: `0`
- `early_accumulation_signals`: `19`
- `order_flow_signals`: `0`
- `sector_momentum`: `12`

### Score/Explanation Persistence Checks
- `trade_signals.confirmation_score` nulls: `0`
- `trade_signals.catalyst_score` nulls: `0`
- `trade_signals.sector_score` nulls: `0`
- `trade_signals.signal_explanation` nulls: `0`
- `trade_signals.score_breakdown` nulls: `0`

## Residual Gap

1. Runtime target not fully met
- Required: `stocksInPlayEngine < 5s`
- Current: ~`17.9s`
- Status: Improved substantially, still above threshold.

## Recommended Next Actions (Focused)

1. Remove remaining per-candidate synchronous bottlenecks in stocks-in-play path
- Batch dependent reads by symbol set and avoid serial enrichment calls.

2. Cache or precompute expensive score subcomponents
- Persist transient enrichments used repeatedly in a run to avoid recomputation.

3. Add targeted indexes on highest-cost join/filter columns discovered in the latest query plan
- Use `EXPLAIN (ANALYZE, BUFFERS)` on the exact stocks-in-play selection query.

4. Add hard runtime budget with graceful degradation
- Keep deterministic top-N output while skipping non-critical enrichment when runtime budget is exceeded.

## Delivery Summary

The requested stabilization/completion pass has been implemented across backend + frontend with validated endpoint health, improved data completeness, and expanded intelligence/scoring capabilities. The only outstanding acceptance criterion is the strict stocks-in-play runtime threshold.
