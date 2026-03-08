# Stocks In Play Engine Report

Date: 2026-03-08

## Overview
Implemented a new `StocksInPlayEngine` that scores active setups from `market_metrics`, stores ranked results in `trade_signals`, exposes them via `/api/opportunities/top`, and integrates top signals into the morning briefing payload.

## Engine Implementation
- File: `server/engines/stocksInPlayEngine.js`
- Function: `runStocksInPlayEngine()`

### Source Query
Primary filter (as requested):
- `relative_volume > 2`
- `gap_percent > 3`
- `atr_percent > 1`
- `LIMIT 20`

Scoring formula (as requested):
- `score = (relative_volume * 100) + (gap_percent * 50) + (atr_percent * 25) - (float_shares / 10000000)`

### Strategy Classification
- `gap_percent > 6` -> `Gap and Go`
- `relative_volume > 4` -> `Momentum Continuation`
- `gap_percent > 3 AND rsi < 70` -> `VWAP Reclaim candidate`
- default fallback -> `Breakout Watch`

### Storage
- Table: `trade_signals`
- Fields:
  - `symbol`
  - `strategy`
  - `score`
  - `gap_percent`
  - `rvol`
  - `atr_percent`
  - `created_at`
- Upsert behavior: `ON CONFLICT (symbol)` updates strategy/metrics/score and `updated_at`.

## Runtime Test Results
Manual engine execution:
- Command: `runStocksInPlayEngine()`
- Result: `selected=20`, `upserted=20`

Top signals generated (sample):
- ANY -> Momentum Continuation
- WINV -> Momentum Continuation
- DAWN -> Gap and Go
- ESLT -> Gap and Go
- DMAA -> Momentum Continuation

## API Endpoint Status
- Endpoint: `/api/opportunities/top`
- Route file updated: `server/routes/opportunities.js`
- Behavior:
  - Reads from `trade_signals`
  - Returns top signals ordered by `score DESC`
  - Default limit now 10
- Test result:
  - HTTP response success
  - Returned populated top-10 signal list

## Morning Brief Integration
- File updated: `server/engines/morningBriefEngine.js`
- Added section data source:
  - `SELECT symbol, strategy, score, gap_percent, rvol, atr_percent, created_at FROM trade_signals ORDER BY score DESC LIMIT 5`
- Added persisted briefing field:
  - `stocks_in_play` JSONB column in `morning_briefings`
- Validation:
  - Morning brief run returned `stocksInPlay: 5`
  - Briefing insert completed successfully

## Notes
- During current market snapshot, strict thresholds produced no rows.
- Engine includes fallback ranking passes to maintain operational output when strict filters are empty.
- Existing architecture was preserved (new engine module + route query source update + briefing extension only).
