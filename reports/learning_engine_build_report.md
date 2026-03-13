# Learning Engine Build Report

Date: 2026-03-13
Status: Completed with backend test failure documented

## Tables Used
Existing required tables:
- `signal_registry`
- `signal_outcomes`
- `daily_ohlc`
- `strategy_weights`
- `signal_validation_daily`
- `signal_validation_weekly`
- `missed_opportunities`

New integrated tables:
- `signal_features`
- `expected_move_tracking`
- `market_regime_daily`
- `signal_capture_analysis`
- `strategy_learning_metrics`

## Engines Created/Updated
Created:
- `server/engines/signalFeatureEngine.js`
- `server/engines/marketRegimeEngine.js`
- `server/engines/signalCaptureEngine.js`
- `server/engines/strategyLearningEngine.js`

Updated:
- `server/engines/expectedMoveEngine.js` (now writes to `expected_move_tracking`)
- `server/system/startEngines.js` (new schedules and in-flight guards)

## Routes Created
- `server/routes/adminLearningRoutes.js`

Endpoints:
- `/api/admin/learning/strategies`
- `/api/admin/learning/capture-rate`
- `/api/admin/learning/expected-move`
- `/api/admin/learning/regime`

Mounted in:
- `server/index.js`

## Admin Pages Created
- `client/src/pages/Admin/LearningDashboard.jsx`
- `client/src/pages/Admin/StrategyEdgeDashboard.jsx`

Updated:
- `client/src/pages/Admin/SystemDiagnostics.jsx` (minimal fallback page)
- `client/src/App.jsx` routes/imports for:
  - `./pages/Admin/SystemDiagnostics` (exact casing)
  - `/admin/learning-dashboard`
  - `/admin/strategy-edge`

## Railway and Deployment Fixes Applied
- Added `client/railway.toml`:
  - `[phases.setup]`
  - `nixPkgs = ["nodejs_20"]`
- Root `railway.toml` already configured with Node 20 setup from prior repair.

## Secrets / Dockerfile Check
- Searched workspace for Dockerfile(s): none found.
- Therefore no Docker ARG/ENV secret lines were present to remove in this repository snapshot.
- Runtime secret access remains via `process.env`.

## Supabase Client Service
Created:
- `server/system/supabaseClient.js`

Details:
- Uses `@supabase/supabase-js` v2
- Validates env variables
- Exports reusable `supabaseClient`

## Build Results
Command:
- `cd client && npm install && npm run build`

Result:
- PASS

## Test Results
Command:
- `cd server && npm test`

Result:
- FAIL (1 failing test)
- See `reports/backend_test_failures.md`

## Remaining Risks
- Backend usage aggregation test currently fails due numeric string typing (`"2"` vs `2`).
- Existing root deployment/runtime and prior phase schedulers remain active; monitor job overlap and daily workload.
- Signal feature extraction uses defensive JSON-based field reads from `market_metrics`; nulls are expected where provider data is sparse.
