# Database Stabilization Report

Date: 2026-03-05
Scope: Backend database stabilization only (no frontend changes)

## 1) Required Tables Verification

Required tables:
- daily_ohlc
- intraday_1m
- market_metrics
- trade_setups
- trade_catalysts
- opportunity_stream
- market_narratives
- ticker_universe

Verification query used:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema='public';
```

Result:
- `missing_before`: []
- `missing_after`: []
- `required_verified`: true

## 2) Migration Actions

Safe migrations verified/present:
- `server/migrations/create_market_narratives.sql` (`CREATE TABLE IF NOT EXISTS`)
- `server/migrations/create_opportunity_stream.sql` (`CREATE TABLE IF NOT EXISTS`)

Additional stabilization migration added and applied:
- `server/migrations/add_market_metrics_change_percent.sql`
  - `ALTER TABLE market_metrics ADD COLUMN IF NOT EXISTS change_percent NUMERIC;`
  - backfill from `gap_percent` where `change_percent IS NULL`

Reason:
- `narrative_engine` depends on `market_metrics.change_percent`; missing column was causing runtime failure.

## 3) Connection Pool Status

`server/db/pg.js` is configured to use a shared pool with:
- `max: 10`
- `idleTimeoutMillis: 30000`
- `connectionTimeoutMillis: 5000`

No per-request pool creation was introduced.

## 4) Query Timeout Protection

Added `queryWithTimeout(...)` helper in `server/db/pg.js` using `Promise.race` with default 5000ms timeout.

`/api/system/report` now uses timeout-protected queries and no longer throws HTTP 500 for missing-table style failures.

## 5) `/api/system/report` Behavior

Updated behavior:
- Returns JSON with `status: "degraded"` and `missing_tables`/`query_errors` instead of 500 on schema/query failure.
- Returns `status: "ok"` when all checks pass.

Observed local sample response during validation:
- Valid JSON returned.
- Status was `degraded` due `system.report.table_scan` timeout in one run (connection pressure), not schema absence.

## 6) Endpoint Test Execution

Executed:

```bash
TEST_BASE_URL=http://127.0.0.1:3000 node server/tools/test_endpoints.js
```

Required endpoint outcomes:
- `/api/opportunity-stream` → valid JSON (200)
- `/api/market-narrative` → valid JSON (200)
- `/api/system/report` → valid JSON (200, degraded payload supported)

Note:
- `/api/metrics` and `/api/scanner` timed out in that run; this indicates intermittent DB/connectivity pressure remains under broader load.

## 7) Engine Re-run and Row Presence

Requested direct commands executed:
- `node server/opportunity/stream_engine.js`
- `node server/narrative/narrative_engine.js`

Then engine cycles were explicitly invoked to perform work:
- `runOpportunityStreamCycle()`
- `generateAndStoreMarketNarrative()`

Post-run row verification:
- `opportunity_stream_count`: 3475
- `market_narratives_count`: 1

Result:
- Both target tables are populated.

## 8) Final Stabilization Outcome

- Required table set exists in `public` schema.
- Critical missing-column issue for narrative generation fixed via DB migration.
- Shared pool and timeout protections are active.
- `/api/system/report` is resilient (degraded JSON response path).
- Opportunity and narrative data are now present in DB.

## 9) Remaining Risk

- Intermittent connection/query timeout behavior is still observed under some endpoint checks.
- Next operational step: investigate DB connectivity pressure (pool saturation/upstream DB latency) to improve consistency for heavier endpoints.
