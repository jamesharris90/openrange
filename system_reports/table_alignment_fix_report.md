# Table Alignment Fix Report

## Timestamp
2026-03-12

## Scope
Enforce canonical table references through `DATA_CONTRACT` usage and validate diagnostics table coverage.

## Replacements Applied

1. `scripts/repairAdminUser.js`
- Replaced `.from('users')` with `.from(DATA_CONTRACT.USERS.ACCOUNTS)` in update path.
- Replaced `.from('users')` with `.from(DATA_CONTRACT.USERS.ACCOUNTS)` in verification path.
- Added contract import: `const { DATA_CONTRACT } = require('../server/contracts/dataContract.cjs');`

2. `scripts/systemAudit.ts`
- Added contract import: `const { DATA_CONTRACT } = require('../server/contracts/dataContract.cjs');`
- Replaced static table list with contract-derived list:
  - `DATA_CONTRACT.MARKET_DATA.DAILY`
  - `DATA_CONTRACT.MARKET_DATA.INTRADAY`
  - `DATA_CONTRACT.MARKET_DATA.EARNINGS`
  - `DATA_CONTRACT.NEWS.EVENTS`
- Replaced all Supabase calls previously using raw literals:
  - `daily_ohlc`
  - `intraday_1m`
  - `earnings_events`
  - `news_events`

## Contract Extensions Added

1. `server/contracts/dataContract.js`
- Added `DATA_CONTRACT.MARKET_DATA.EARNINGS = "earnings_events"`
- Added `DATA_CONTRACT.SYSTEM.PROVIDER_HEALTH = "provider_health"`
- Added `DATA_CONTRACT.USERS.ACCOUNTS = "users"`

2. `server/contracts/dataContract.cjs` (new)
- Added CommonJS mirror for script usage to keep runtime compatibility in Node CJS scripts.

## Diagnostics Table Verification

1. `server/system/platformHealthExtended.js`
- Confirms and queries:
  - `DATA_CONTRACT.ENGINES.STATUS` (`engine_status`)
  - `DATA_CONTRACT.ENGINES.RUNTIME` (`engine_runtime`)
  - `DATA_CONTRACT.SYSTEM.SCHEDULER` (`scheduler_status`)
  - `DATA_CONTRACT.SYSTEM.PROVIDER_HEALTH` (`provider_health`)
- Confirms opportunities metric source:
  - `DATA_CONTRACT.OPPORTUNITIES` (`opportunities_v2`) with `count: "exact"`

## Validation Results

1. `node scripts/scan-schema-drift.js`
- Result: success (`Schema drift report generated`)
- Output file: `system_reports/schema_drift_report.json`
- Current drift entries: `[]`

2. `node scripts/generate-platform-report.js`
- Result: success (`Platform stability report generated`)
- Output file: `system_reports/platform_stability_report.json`
- Current checks: `schema_drift`, `engine_status`, `scheduler_status`, `provider_health`

## Endpoint Probe

- Attempted: `GET /api/system/engine-diagnostics`
- Local result: connection failed (`curl` exit code 7, HTTP `000`), indicating no local server process listening on `localhost:3000` at probe time.
