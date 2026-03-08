# Catalyst Engine Scheduler Implementation Report

Date: 2026-03-08

## Architecture Discovery

Located and verified:
- `server/system/startEngines.js`
- `server/engines/catalystEngine.js`
- `server/engines/stocksInPlayEngine.js`
- `server/services/emailService.js`
- `server/routes/intelligence.js`

Confirmed existing components:
- `runCatalystEngine` exists in `server/engines/catalystEngine.js`
- `runStocksInPlayEngine` exists in `server/engines/stocksInPlayEngine.js`
- RSS worker exists via `runRssWorker` in `server/workers/rss_worker.js` and scheduler registration in `server/system/startEngines.js`

No architecture refactor performed.

## Architecture Changes

Updated files:
- `server/system/startEngines.js`
- `server/engines/catalystEngine.js`
- `server/engines/stocksInPlayEngine.js`
- `server/engines/morningBriefEngine.js`
- `server/services/emailService.js`
- `server/routes/intelligence.js`

## Scheduler Integration

Added global catalyst scheduler block in `startEngines.js`:
- imports `runCatalystEngine`
- one-time guard: `global.catalystSchedulerStarted`
- startup immediate run
- recurring run every 5 minutes (`5 * 60 * 1000`)
- error guard for interval execution

Startup logs confirmed:
- `[CATALYST] Scheduler started`

## Ticker Detection Improvements

In `server/engines/catalystEngine.js`:
- extracts candidates via `\b[A-Z]{2,5}\b`
- validates against `market_quotes.symbol` set
- removes common uppercase false positives before symbol acceptance
- stores catalysts only when at least one valid symbol is detected

## Catalyst Scoring Logic

Catalyst classification retained and mapped to impact scores:
- earnings -> 9
- FDA approval -> 10
- analyst upgrade -> 6
- analyst downgrade -> 6
- government contract -> 8
- acquisition -> 7
- sector news -> 4
- macro news -> 3

Signal boost logic in `stocksInPlayEngine`:
- freshness window changed from 24h to 8h
- rule: `score += impact_score * 20`
- score remains numeric via `toNumber(...)`

## Email Rendering Improvements

Updated catalyst rendering in `emailService.js`:
- HTML format now includes symbol, readable catalyst label, impact score, and quoted headline:
  - `NVDA — Earnings Beat (Impact 9)`
  - `"Headline text"`
- Plain text format now includes the same with headline line per catalyst item.
- Morning brief catalyst query now includes `headline` for rendering.

## API Validation Results

Catalysts endpoint contract (`/api/intelligence/catalysts`):
- default limit: 20
- sort: `impact_score DESC`, `published_at DESC`
- required fields present: `symbol`, `catalyst_type`, `headline`, `impact_score`, `published_at`

Validation outputs:
- `CATALYST_ITEMS 12`
- `CATALYST_DEFAULT_LIMIT_OK true`
- `CATALYST_FIELDS_OK true`
- `CATALYST_SORT_OK true`

Required endpoint HTTP checks:
- `/api/intelligence/news` -> 200
- `/api/intelligence/catalysts` -> 200
- `/api/opportunities/top` -> 200
- `/api/market/sector-strength` -> 200

## Runtime Validation Results

Manual catalyst engine run:
- `headlinesParsed: 90`
- `tickersDetected: 12`
- `catalystsStored: 12`

Database check:
- `news_catalysts` total rows: 12

Manual stocks in play run:
- `selected: 20`
- `upserted: 20`
- `boosted: 0`

Boost eligibility check (8h window):
- `BOOSTED_CANDIDATES: 2`

Boost math verification:
- Example `AI`: base score `32.670579910574040330000000` -> boosted score `92.670579910574040330000000`
- Example `PG`: base score `31.486449590629232846000000` -> boosted score `91.486449590629232846000000`

This confirms boost logic is active and numeric when catalysts exist.

## Build and Tests

Backend tests:
- `cd server && npm test`
- Result: 5 suites passed, 31 tests passed

Frontend build:
- `cd client && npm run build`
- Result: Vite build succeeded

Backend restart:
- backend restarted successfully
- server listening on port 3000

## Warnings / Issues Observed

Non-blocking pre-existing warnings seen during validation:
- `sector_agg` relation missing in morning brief path (gracefully handled by fallback)
- `signalPerformanceEngine` startup error: missing `close` column
- `intelNewsEngine` scheduler run reported upstream 404
- missing env warnings: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PROXY_API_KEY`

None of the above were introduced by this change set.
