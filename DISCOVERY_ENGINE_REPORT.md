# OpenRange Discovery Engine Report

Date: 2026-03-04

## Scope Completed

- Added additive Discovery Engine to surface event-driven symbols only.
- Discovery sources: `trade_setups`, `trade_catalysts`, `earnings_events`.
- Added `discovered_symbols` storage with UPSERT deduplication.
- Added 1-minute scheduler for continuous discovery refresh.
- Updated scanner APIs to read discovery-driven symbols instead of universe-driven symbol selection.
- Extended system health with `discovered_symbol_count`.

## Files Added

- `server/migrations/create_discovered_symbols.sql`
- `server/discovery/discovery_engine.js`
- `server/discovery/discovery_scheduler.js`
- `server/discovery/run_discovery.js`
- `server/monitoring/discoveryHealth.js`
- `DISCOVERY_ENGINE_REPORT.md`

## Files Updated

- `server/index.js`
- `server/monitoring/systemHealth.js`

## Discovery Logic

Symbols are discovered from:

1. `trade_setups` (last 24 hours)
2. `trade_catalysts` (last 48 hours)
3. `earnings_events` (report date in a near-term active window)

Rules:

- Dedupe by `symbol`
- Aggregate `source` as distinct source labels (`setup`, `catalyst`, `earnings`)
- Keep highest score per symbol
- UPSERT updates `source`, `score`, and `detected_at`

## API Behavior

- `/api/scanner` now joins from `discovered_symbols -> market_metrics` (optionally enriched with universe metadata).
- `/api/premarket` now joins from `discovered_symbols -> market_metrics`.
- This removes default/popular symbol surfacing in scanner outputs.

## User Search Exception

- User search behavior was not restricted or modified.
- Any symbol from `ticker_universe` remains searchable via existing search mechanisms.

## Verification

### Migration

- `discovered_symbols` migration applied successfully.

### Manual Discovery Run

Command:

`cd server && node discovery/run_discovery.js`

Observed:

- `symbols_detected`: 463
- `symbols_upserted`: 463
- `runtimeMs`: 6093

Source distribution:

- `catalyst`: 244
- `setup`: 208
- `catalyst+setup`: 11

### Scanner Query Preview

Discovery-gated scanner/premarket SQL previews returned rows sourced from `discovered_symbols` with discovery score/source fields present.

## Monitoring

- `systemHealth` now includes `discovered_symbol_count`.
- Discovery health helper fails safely with degraded status when the discovery table is unavailable.
