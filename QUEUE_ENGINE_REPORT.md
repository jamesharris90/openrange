# OpenRange Symbol Queue Engine Report

Date: 2026-03-04

## Goal

Reduce metrics engine runtime by recalculating only symbols that changed.

## What Was Added

- Queue table migration: `server/migrations/create_symbol_queue.sql`
- Queue helper: `server/metrics/queue_symbol.js`
- Queue-aware metrics engine: `server/metrics/calc_market_metrics.js`
- Scheduler split mode (queue + full): `server/metrics/metrics_scheduler.js`
- Queue health monitor: `server/monitoring/queueHealth.js`
- System health extension for queue stats: `server/monitoring/systemHealth.js`
- API route: `/api/queue/health`
- Verification script: `server/metrics/test_queue.js`

## Runtime Comparison

- Previous full runtime (from metrics baseline): **39720 ms**
- New queue runtime (verification run): **1427 ms**

## Symbols Processed

- Previous baseline run: **5507 symbols** (full)
- Queue verification run: **1 symbol** (`MRP`)

## Queue Verification Result

`node server/metrics/test_queue.js` output confirmed:

- symbol queued: `MRP`
- queue mode processed: `1`
- metrics rows written: `1`
- queue cleared after processing: `1`
- queue size after run: `0`

## Scheduler Behavior

- Every minute: queue processing (`mode=queue`)
- Every 15 minutes: full refresh (`mode=full`)

## Health/Monitoring

- `/api/queue/health` returns:
  - `queue_size`
  - `oldest_item`
- `/api/system/health` now includes:
  - `queue`
  - `queue_size`

## Notes

- Existing ingestion workers were not modified.
- Intraday updates are captured additively by queue seeding from recent `intraday_1m` changes in queue mode.
- Universe new symbols are queued from `fmp_universe_ingest` after successful upsert.
- Full refresh remains available for backward compatibility and safety.
