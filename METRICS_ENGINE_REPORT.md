# OpenRange Market Metrics Engine Report

Date: 2026-03-04

## Execution Summary

Manual run command:

- `cd server && node metrics/run_metrics.js`

Run result:

- symbols processed: **5507**
- batches: **12** (500 symbols per batch, final batch 7)
- metrics rows upserted: **5121**
- runtime: **39720 ms**
- failed batches: **0**
- errors: **0**

## Metrics Calculated

Calculated and stored per symbol in `market_metrics`:

- `price`
- `gap_percent`
- `relative_volume`
- `atr` (14)
- `rsi` (14)
- `vwap`
- `float_rotation`
- `last_updated`

## Data Sources Used

All calculations are Supabase/Postgres DB-first:

- `daily_ohlc` → gap %, RVOL, ATR, RSI
- `intraday_1m` → VWAP + latest intraday price
- `company_profiles.float` → float rotation

No metrics calculation uses direct frontend FMP calls.

## API Integration

Updated APIs now read from `market_metrics`:

- `/api/metrics`
- `/api/scanner`
- `/api/premarket`
- `/api/expected-move` (uses `ATR * 1.5`)

## Scheduler

`server/metrics/metrics_scheduler.js` is registered in server startup and runs every minute.

## Verification Snapshots

Post-run DB checks:

- `market_metrics_count`: **5121**
- scanner query sample returned rows with high `relative_volume`
- premarket query sample returned rows with `gap_percent > 3` and `relative_volume > 2`
- expected move sample returned values computed as `atr * 1.5`

## Errors Encountered and Resolved

1. Initial run failed with:
   - `column i.price does not exist`
2. Root cause:
   - `intraday_1m` schema uses `close` column, not `price`
3. Fix applied:
   - Updated metrics SQL to use `intraday_1m.close`
   - Added latest intraday price extraction via `DISTINCT ON (symbol)` ordered by latest timestamp
4. Re-run status:
   - Successful (0 errors)
