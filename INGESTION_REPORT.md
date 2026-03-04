# Ingestion Upgrade Report

Date: 2026-03-04

## Scope Completed

Implemented a modular FMP ingestion pipeline under `server/ingestion` and integrated it with backend runtime and API reads.

### Added ingestion infrastructure

- `server/ingestion/_helpers.js`
- `server/ingestion/fmp_intraday_ingest.js`
- `server/ingestion/fmp_news_ingest.js`
- `server/ingestion/fmp_prices_ingest.js`
- `server/ingestion/fmp_earnings_ingest.js`
- `server/ingestion/fmp_profiles_ingest.js`
- `server/ingestion/run_all_ingest.js`
- `server/ingestion/scheduler.js`

### Added supporting services/utilities

- `server/services/fmpClient.js` (retry + request spacing)
- `server/services/supabaseClient.js`
- `server/utils/batchInsert.js` (chunked upsert + retry)
- `server/utils/logger.js` (ingestion logging wrapper)

### Backend integration changes

- `server/index.js`
  - Starts ingestion scheduler on boot (`startIngestionScheduler`) unless `ENABLE_INGESTION_SCHEDULER=false`.
  - `/api/scanner` now reads from `intraday_1m` (DB-first).
  - `/api/premarket` now reads from `intraday_1m` (DB-first).
- `server/routes/earnings.js`
  - `/api/earnings` now reads from `earnings_events` (DB-first).
  - `/api/earnings/calendar` now uses DB data only (no live FMP fallback).
- `server/routes/news.js`
  - `/api/news` now reads from `news_articles` (DB-first).

---

## Execution: Run-All Ingestion

Command run:

- `cd server && node ingestion/run_all_ingest.js`

### Result Summary (sequential, continue-on-failure)

- intraday: ok=true, inserted=0, failures=5
- news: ok=true, inserted=0, failures=5
- prices: ok=true, inserted=0, failures=5
- earnings: ok=true, inserted=0, failures=5
- profiles: ok=true, inserted=0, failures=5

All FMP worker requests failed with HTTP `403` during this run, but orchestration correctly continued through all jobs.

---

## Database Verification

Command run:

- `cd server && node -e "require('dotenv').config(); ..."`

Observed counts:

- `daily_ohlc`: 2350356
- `intraday_1m`: 4435486
- `news_articles`: 406
- `earnings_events`: 20803
- `company_profiles`: ERROR `42P01` relation does not exist

Interpretation:

- Target data tables are present and queryable except `company_profiles`.
- Existing data already exists in several target tables.
- This ingestion run did not insert additional rows because upstream FMP requests were denied (`403`).

---

## Required Follow-ups

1. Verify/repair FMP credentials and plan access:
   - Ensure valid `FMP_API_KEY` in `server/.env`.
   - Confirm subscribed endpoints permit:
     - `/historical-chart/1min/{symbol}`
     - `/stock_news`
     - `/historical-price-full/{symbol}`
     - `/earning_calendar`
     - `/profile/{symbol}`

2. Create missing table:
   - Add migration for `company_profiles` (or align worker target table to existing schema).

3. Re-run ingestion after credentials/schema fix:
   - `cd server && node ingestion/run_all_ingest.js`

---

## Notes

- Architecture now enforces DB-first market data APIs for scanner/premarket/news/earnings paths.
- Frontend no longer needs direct FMP access for these paths.
- Scheduler integration is additive and non-breaking to existing startup flow.
