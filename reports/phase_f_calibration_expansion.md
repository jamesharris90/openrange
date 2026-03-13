# Phase F Calibration Expansion Report

Date: 2026-03-13
Status: Completed with validation

## Files Created
- `server/engines/missedOpportunityEngine.js`
- `server/engines/missedOpportunityReplay.js`
- `server/engines/validationEngine.js`
- `server/routes/adminValidationRoutes.js`
- `client/src/pages/admin/CalibrationDashboard.jsx`
- `client/src/pages/admin/MissedOpportunitiesPage.jsx`
- `reports/schema_validation_report.md`

## Files Modified
- `railway.toml`
- `server/system/startEngines.js`
- `server/system/platformHealthExtended.js`
- `server/index.js`
- `client/src/App.jsx`

## Database Schema Used (Live Supabase)
Validated tables:
- `signal_registry`
- `signal_outcomes`
- `daily_ohlc`
- `strategy_weights`
- `signal_validation_daily`
- `signal_validation_weekly`
- `missed_opportunities`

Schema validation outcome:
- PASS with non-blocking drift documented in `reports/schema_validation_report.md`.
- Allowed differences honored (UUID keys, timestamp variations, nullable strategy, existing source column).

## Engines Added
- Missed Opportunity Detection Engine
  - `runMissedOpportunityEngine()`
  - Detects moves where `((high-close)/close)*100 > 6` and inserts non-signalled rows into `missed_opportunities`.
- Missed Opportunity Replay Engine
  - `runMissedOpportunityReplay()`
  - Replays unreplayed misses into `signal_registry` as `MISSED_REPLAY`.
- Validation Engine
  - `runValidationTests()` (daily metrics + learning score)
  - `runWeeklyValidationAggregation()` (7-day aggregate + improvement vs previous week)

## API Endpoints Created
- `GET /api/admin/validation/daily`
- `GET /api/admin/validation/weekly`
- `GET /api/admin/validation/missed`
- `GET /api/admin/validation/learning-score`
- `GET /api/admin/validation/missed-candles` (drilldown helper)

## Scheduler Jobs Created
Registered in `server/system/startEngines.js`:
- `00:00` -> `runValidationTests()`
- `00:10` -> `runMissedOpportunityEngine()`
- `00:20` -> `runMissedOpportunityReplay()`
- Weekly aggregation integrated into validation run on Mondays.

## Admin Dashboard Work
- Added route/pages in frontend:
  - `/admin/calibration`
  - `/admin/missed-opportunities`
- Dashboard includes:
  - Weekly Learning Score chart
  - Missed Opportunities weekly chart
  - Top-ranked vs average return chart
  - Signal generation trend chart
  - Strategy weights table
- Drilldown page includes:
  - Missed opportunities table (symbol/date/move/reason/replayed)
  - Candle context chart with highlighted missed-move date

## Platform Health Extensions
Extended `platformHealthExtended.js` with:
- `MISSED_OPPORTUNITY_COUNT`
- `LEARNING_SCORE`
- `VALIDATION_LAST_RUN`
- `MISSED_REPLAY_ENGINE_STATUS`

## Runtime Compatibility and Build Fixes
- Railway runtime setup fixed via `railway.toml`:
  - `[phases.setup]`
  - `nixPkgs = ["nodejs_20"]`
- App routing updated to include new admin calibration pages.

## Validation Results
Build:
- `npm run build` -> PASS

Backend tests:
- `cd server && npm test -- --runInBand` -> PASS (5 suites, 31 tests)

API checks:
- Admin validation endpoints return `ok: true` with temporary signed admin JWT.
- Learning score baseline observed:
  - Daily: `1.0000`
  - Weekly: `1.0000`

Engine run smoke checks:
- Validation daily run: success
- Validation weekly aggregation: success
- Missed opportunity detection: success
- Missed replay: success (batch-limited replay)

## Errors Encountered
- Admin API key auth not configured (`PROXY_API_KEY` and `ADMIN_API_KEY` empty), so JWT-based admin validation was used for endpoint verification.
- One shell invocation failed due unquoted `?` in URL during curl; rerun with quoted URL succeeded.

## Notes
- Missed opportunity detection inserted a large historical batch in this run; replay engine currently processes capped batches (`LIMIT 1000`) per run by design to avoid long lock windows.
