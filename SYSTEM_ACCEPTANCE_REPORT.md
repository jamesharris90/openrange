# OpenRange System Acceptance Report

Date: 2026-03-06  
Scope: Full smoke + acceptance verification for Manual Screener, Earnings Calendar, Expected Move, Intel News Feed, Sector Heatmap, Index Ticker Cards, Rolling Tickers, Chart Trend Detection, Signal Explanation, Strategy Engine, Metrics Engine, Universe Builder.

Artifacts:
- `SYSTEM_ACCEPTANCE_RAW.json` (machine-readable full run)
- `scripts/run-acceptance-smoke.js` (repeatable smoke harness)

## Executive Summary

Overall result: **Partial Pass**.

- Core market data flow is healthy (quotes/metrics/universe aligned; signals populated).
- Most newly added trader endpoints are reachable and performant.
- Three critical acceptance failures remain:
  1. `/api/expected-move` returns `500` (`column m.atr_percent does not exist`)
  2. `/api/earnings/today` returns `500` timeout (`api.earnings.today` 200ms timeout budget exceeded)
  3. `/api/signals/AAPL` returns `404` (`No signal found for AAPL`) so symbol-level explanation is not guaranteed.

## Step 1 — Backend Health Check

Endpoint: `/api/system/health`  
Status: `200` in `136.55ms`  
System status: `ok`

Captured health values:
- Database: `available=true`, `detail=null`
- Engine scheduler: `started=true`, timers active for ingestion/metrics/universe/sector/opportunity/strategy/trend/earnings/expectedMove/intelNews
- Latest market quotes timestamp: `2026-03-06T01:00:16.350Z`

Observed scheduler errors in health payload:
- `lastExpectedMoveError`: `column m.atr_percent does not exist`
- `lastEarningsError`: `Query timeout after 5000ms (engines.earningsEngine.ensure_columns)`
- `lastIntelNewsError`: `Request failed with status code 404`

## Step 2 — Market Data Integrity

DB counts:
- `market_quotes`: `5397`
- `market_metrics`: `5397`
- `tradable_universe`: `5397`
- `strategy_signals`: `16`

Verification:
- metrics ≈ quotes: ✅
- universe ≈ metrics: ✅
- signals > 0: ✅

## Step 3 — Core Market APIs

All tested with authenticated smoke session.

- `/api/market/quotes?limit=5` → `200`, `30.25ms`, non-empty ✅
- `/api/market/movers` → `200`, `36.19ms`, non-empty ✅
- `/api/market/sectors` → `200`, `44.11ms`, non-empty ✅
- `/api/market/indices` → `200`, `27.57ms`, non-empty ✅
- `/api/market/tickers` → `200`, `23.52ms`, non-empty ✅

Response-time requirement `<500ms`: ✅ for all listed endpoints.

## Step 4 — Screener System

- `/api/screener/full` → `200`, `53.95ms`
- `/api/screener/full?gap_min=5` → `200`, `31.13ms`
- `/api/screener/full?rvol_min=2` → `200`, `37.88ms`

Filter behavior:
- Base rows: `200`
- `gap_min=5`: `10`
- `rvol_min=2`: `89`

Verification:
- dataset populated ✅
- row counts change with filters ✅

## Step 5 — Strategy Engine

- `/api/signals` → `200`, `121.59ms`, includes fields `strategy`, `score`, `class`, `gap_percent`, `relative_volume` ✅
- `/api/signals/AAPL` → `404`, body: `{ "success": false, "error": "No signal found for AAPL" }` ⚠️

Assessment:
- Strategy feed works.
- Symbol-specific explanation contract is not guaranteed for arbitrary symbols (AAPL failed in current dataset).

## Step 6 — Earnings System

- `/api/earnings/today` → `500`, `242.8ms`, `Query timeout after 200ms (api.earnings.today)` ❌
- `/api/earnings/week` → `200`, `285.55ms`, returns `{ "earnings": [] }` ⚠️

Assessment:
- Weekly endpoint is reachable.
- Today endpoint fails due aggressive timeout + schema/index work in request path.
- No rows currently returned, so field-level content verification is inconclusive.

## Step 7 — Expected Move

- `/api/expected-move` → `500`, `22.93ms`
- Error: `column m.atr_percent does not exist` ❌

Assessment:
- Endpoint contract currently broken by schema/query mismatch.

## Step 8 — Intelligence Feed

- `/api/intelligence/news` → `200`, `58.67ms`, `{ success:true, items:[] }`
- `/api/intelligence/news?hours=6` → `200`, `28.5ms`, `{ success:true, items:[] }`

Assessment:
- Endpoint works and is fast.
- Dataset empty in this run, so symbol/headline/source/timestamp sample validation is inconclusive.
- Scheduler health indicates upstream intel engine fetch issue (`404`) needing correction.

## Step 9 — Sector Heatmap

- `/api/market/sectors` → `200`, `56.58ms`, includes `sector`, `avg_change`, `leaders` ✅
- `/api/sector/Technology` → `200`, `43.29ms`, populated stocks list ✅

## Step 10 — Chart Trend Detection

- `/api/chart/trend/AAPL` → `200`, `106.93ms`
- Payload contains `trend`, `support`, `resistance`, `channel` ✅

## Step 11 — Performance Check (<700ms)

Tracked endpoints:
- quotes: `30.25ms`
- signals: `121.59ms`
- screener: `53.95ms`
- news: `58.67ms`

Flagged >700ms: **none** ✅

## Step 12 — Frontend Route Validation

Verified route declarations in `client/src/App.jsx`:
- `/screener` ✅
- `/earnings-calendar` ✅
- `/expected-move` ✅
- `/intelligence-inbox` ✅
- `/sector-heatmap` ✅
- `/charts` ✅

Verified HTTP load through Vite preview (`127.0.0.1:5173`): all routes returned `200` with app shell HTML (`<div id="root">`) ✅.

Infinite loading check:
- No static “loading” marker in preview shell HTML.
- Full runtime UX hang detection requires browser-interactive test (not proven by curl alone).

## Step 13 — Error Handling

- `/api/invalid/test` → `404`
- JSON payload: `{ "success": false, "error": "API route not found", "path": "/api/invalid/test" }` ✅

## Step 14 — Scheduler Status

Confirmed active in `engine_scheduler`:
- `metricsEngine` ✅ (`metricsTimerActive=true`)
- `universeBuilder` ✅ (`universeTimerActive=true`)
- `strategyEngine` ✅ (`strategyTimerActive=true`)
- `sectorEngine` ✅ (`sectorTimerActive=true`)
- `intelNewsEngine` ✅ (`intelNewsTimerActive=true`, but last run error)
- `trendDetectionEngine` ✅ (`trendTimerActive=true`)

## Failures & Root-Cause Diagnostics

1. **Expected Move endpoint failure**
   - Endpoint: `/api/expected-move`
   - Error: `column m.atr_percent does not exist`
   - Root cause: SQL references non-existent `market_metrics.atr_percent`.
   - Proposed fix: update query to use existing ATR field(s) (e.g., `m.atr`) or compute percent from ATR+price defensively.

2. **Earnings today timeout**
   - Endpoint: `/api/earnings/today`
   - Error: `Query timeout after 200ms (api.earnings.today)`
   - Root cause: too-low timeout and schema work in request path under current DB latency.
   - Proposed fix:
     - Increase endpoint timeout budget (e.g., ≥1000ms).
     - Move `CREATE/ALTER` out of request path into migration/startup checks.
     - Add index on `earnings_events(earnings_date)` if absent.

3. **Symbol signal explanation not guaranteed**
   - Endpoint: `/api/signals/AAPL`
   - Error: `No signal found for AAPL` (404)
   - Root cause: endpoint depends on precomputed rows existing for requested symbol.
   - Proposed fix: either
     - return `200` with structured empty explanation payload, or
     - compute on-demand fallback from latest metrics/universe data.

4. **Intel ingestion scheduler error**
   - Health shows: `lastIntelNewsError = Request failed with status code 404`
   - Root cause likely upstream source URL/endpoint mismatch or token path mismatch.
   - Proposed fix: validate upstream URL, auth params, and add retry/backoff + structured fallback logging.

## Acceptance Decision

**Not fully accepted yet** due unresolved critical backend defects on Expected Move and Earnings Today endpoints.

Recommended next gate:
1. Fix expected move schema/query mismatch.
2. Fix earnings today timeout and move schema enforcement out of hot path.
3. Re-run this exact smoke harness and require all Step 1–14 checks to pass.
