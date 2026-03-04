# OpenRange Catalyst Intelligence Engine Report

Date: 2026-03-04

## Scope Completed

- Added additive catalyst pipeline from `news_articles` to `trade_catalysts`.
- Preserved existing ingestion workers, metrics engine, and strategy logic.
- Added catalyst enrichment to `/api/setups` via `LEFT JOIN` latest catalyst per symbol.
- Added `/api/catalysts` endpoint.
- Added catalyst scheduler (`*/2 * * * *`).
- Extended system health with `catalyst_count`.

## Files Added

- `server/migrations/create_trade_catalysts.sql`
- `server/catalyst/catalyst_engine.js`
- `server/catalyst/catalyst_scheduler.js`
- `server/catalyst/run_catalyst.js`
- `server/monitoring/catalystHealth.js`

## Files Updated

- `server/index.js`
- `server/monitoring/systemHealth.js`

## Catalyst Rules Implemented

### Sentiment

- Positive keywords: `beat`, `upgrade`, `approval`, `partnership`
- Negative keywords: `downgrade`, `lawsuit`, `recall`
- Sentiment result: `positive`, `negative`, or `neutral`

### Catalyst Scoring

- earnings = 5
- FDA / approvals = 6
- analyst upgrade = 4
- general news = 2

## Data Flow

1. Read recent `news_articles` (last 24h, latest 2000 rows).
2. Extract symbols from `news_articles.symbols` plus headline/summary uppercase token parsing.
3. Match symbols to active `ticker_universe` only.
4. Classify sentiment and catalyst type.
5. UPSERT into `trade_catalysts` on `(symbol, headline, published_at, catalyst_type)`.

## Verification

### Migration

- `trade_catalysts` table migration applied successfully.

### Manual Engine Run

Command:

`cd server && node catalyst/run_catalyst.js`

Observed output:

- `news_processed`: 158
- `catalysts_detected`: 948
- `catalysts_upserted`: 948
- `runtimeMs`: 11858

Distribution:

- `general news`: 671
- `earnings`: 199
- `analyst upgrade`: 68
- `FDA / approvals`: 10

## Fail-Safe Behavior

- Engine returns structured zeroed result with `error` if processing fails.
- Scheduler cycle wraps engine in try/catch and logs failure without crashing service.
