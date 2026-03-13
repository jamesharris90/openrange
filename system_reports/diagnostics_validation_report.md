# Diagnostics Validation Report

Date: 2026-03-12

## Changes Applied

1. Updated `server/system/platformHealthExtended.js`
- Replaced opportunities query to use `opportunity_stream` with 24h filter.
- Added `report.opportunities_24h` mapping.

2. Updated contract keys
- `server/contracts/dataContract.js`: added `OPPORTUNITY_STREAM: 'opportunity_stream'`
- `server/contracts/dataContract.cjs`: added `OPPORTUNITY_STREAM: 'opportunity_stream'`

3. Updated diagnostics endpoint
- `server/index.js` `/api/system/engine-diagnostics`
- Added explicit line output: `OPPORTUNITIES_24H: <value>`
- Added `engines.opportunities_24h` in response payload.
- Scheduler status now reports OK for active/idle states.

## Validation Commands

- Start server:
  - `npm --prefix /Users/jamesharris/Server/server run dev`
- Validate endpoint:
  - `curl -sS http://localhost:3000/api/system/engine-diagnostics`

## Observed Output

- `SCHEDULER: OK`
- `PIPELINE: OK`
- `PROVIDERS: OK`
- `OPPORTUNITIES_24H: 0`

## Status vs Expected

- SCHEDULER: expected `OK`, observed `OK` -> PASS
- PIPELINE: expected `OK`, observed `OK` -> PASS
- PROVIDERS: expected `OK`, observed `OK` -> PASS
- OPPORTUNITIES_24H: expected `> 0`, observed `0` -> FAIL

## Blocker

The environment currently has no accessible recent opportunities data for this check path:
- `opportunity_stream` has 0 rows.
- Opportunity population and/or Supabase access is currently failing in local script checks (fetch errors / upstream connectivity issues), so the value cannot be raised above 0 from live data in this run.
