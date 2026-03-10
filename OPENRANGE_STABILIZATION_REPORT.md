# OPENRANGE_STABILIZATION_REPORT

Date: 2026-03-09
Scope: Stabilization + scoring hardening pass (schema compatibility, scoring filter, scheduler overlap guard, startup validation).

## Executive Result

Requested stabilization pass was implemented and validated on a clean backend restart.

Primary outcomes:
- Added startup schema guard to auto-heal additive schema drift.
- Wired schema guard into backend bootstrap before engines start.
- Hardened `signal_performance` writes for numeric safety and mixed legacy/new schema compatibility.
- Added liquidity quality gating to scoring and persisted quality diagnostics in `score_breakdown.liquidity_quality`.
- Added explicit overlap protection for additional scheduled engines.
- Confirmed required signal/intelligence/opportunity endpoints return HTTP 200 after restart.

## Changes Implemented

1. Schema guard module
- Added: `server/system/schemaGuard.js`
- Behavior:
  - Creates `trade_signals`, `signal_performance`, `daily_signal_snapshot` if missing.
  - Applies additive `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` guards.
  - Adds non-destructive indexes for key lookup paths.
  - Logs completion stats (`attempted/applied/failed`).

2. Startup integration
- Updated: `server/index.js`
- Added startup call:
  - `await runSchemaGuard();`
- Ordering:
  - Runs after `runMigrations()` and before engine scheduler startup.

3. Signal performance write hardening
- Updated: `server/engines/signalPerformanceEngine.js`
- Added compatibility columns for legacy and snapshot paths:
  - `signal_id`, `strategy`, `class`, `score`, `probability`, `current_price`, `return_percent`, `max_upside`, `max_drawdown`, `outcome`, `evaluated_at`.
- Numeric safety fixes:
  - Sanitized symbol/number handling.
  - Guarded divide-by-zero and invalid entry prices.
  - Rounded persisted numerics to deterministic precision.
- Snapshot pipeline:
  - Skips invalid symbols.
  - Returns clean zero-update result when no valid symbols found.

4. Liquidity quality filter in scoring
- Updated: `server/engines/signalScoringEngine.js`
- Added `evaluateLiquidityQuality(row)` with checks:
  - minimum price
  - minimum relative volume
  - minimum intraday dollar volume
  - minimum average dollar volume
  - valid float-share floor when present
- New behavior:
  - `scoreSignal(...)` returns `null` if liquidity quality fails.
  - `score_breakdown` now includes `liquidity_quality` diagnostics payload.

5. Stocks in play compatibility with null-scored rows
- Updated: `server/engines/stocksInPlayEngine.js`
- Handles `scoreSignal(...) === null` safely.
- Filters non-qualified candidates before upsert/routing.
- Logs and exits cleanly when no rows pass liquidity quality.

6. Additional overlap guards
- Updated: `server/system/startEngines.js`
- Added in-flight overlap protection for:
  - `runStrategyEvaluationEngine`
  - `runNarrativeEngine`

## Runtime Validation

1. Backend tests
- Command: `cd server && npm test -- --runInBand`
- Result: PASS
- Summary: 5 suites passed, 31 tests passed.

2. Clean restart validation
- Existing process on `:3000` terminated.
- Restarted backend via `npm start` in `server/`.
- Startup log highlights:
  - `Database migrations complete`
  - `Running schema guard...`
  - `[SCHEMA_GUARD] complete { attempted: 36, applied: 36, failed: 0 }`
  - engine schedulers registered successfully

3. Required endpoint smoke checks
- `GET /api/signals/watchlist` -> 200
- `GET /api/signals/alerts` -> 200
- `GET /api/signals/hierarchy` -> 200
- `GET /api/intelligence/order-flow` -> 200
- `GET /api/intelligence/sector-momentum` -> 200
- `GET /api/opportunities/top` -> 200

4. Post-change data shape checks
- Scripted DB check confirmed:
  - `trade_signals.total = 26`
  - `trade_signals.score_breakdown` rows with `liquidity_quality` present = 8
  - `signal_performance.total = 0` (no snapshot rows yet in current cycle)
  - `daily_signal_snapshot.total (today) = 0`

## Notes

- Pre-existing non-blocking warnings remain (for example optional env warnings and external upstream 404s in unrelated engine paths).
- This pass focused on additive safety and startup/runtime resilience; no destructive schema/data operations were used.
