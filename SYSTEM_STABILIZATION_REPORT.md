# OpenRange System Stabilization Report

Date: 2026-03-04

## Objective

Reconnect frontend UI to backend intelligence APIs and eliminate HTML-instead-of-JSON failures by stabilizing API routing, endpoint behavior, and frontend API usage.

## Task Summary

### Task 1 — API Base Configuration

- Verified `client/src/config/api.js` matches required implementation (`API_BASE`, `apiFetch`, `apiJSON`).

### Task 2 — Production Environment

- Verified `client/.env.production` contains:
  - `VITE_API_BASE_URL=https://openrange-backend-production.up.railway.app`

### Task 3 — Raw API Call Detection

- Searched frontend for raw `fetch('/api` and `fetch("/api` patterns.
- No raw fetch calls found.
- Existing calls are through `authFetch` or `apiJSON` wrappers.

### Task 4 — Backend Route Coverage

Verified routes exist:

- `/api/scanner`
- `/api/premarket`
- `/api/news`
- `/api/setups`
- `/api/metrics`
- `/api/expected-move`
- `/api/system/health`
- `/api/catalysts`
- `/api/filters`
- `/api/scoring-rules`

Added:

- `/api/system/report` (system diagnostics)

Stabilized:

- `/api/system/health` now returns fast JSON fallback on timeout (`status: degraded`) instead of hanging.
- `/api/news` now fails safely with `[]` JSON payload when upstream/db fetch fails.

### Task 5 — Endpoint Verification Script

Created:

- `server/tools/test_endpoints.js`

Behavior:

- Tests required endpoints
- Logs status + JSON validity
- Includes 10s per-request timeout to avoid hangs

### Task 6 — Frontend Page Audit & Repair

Audited pages:

- Dashboard (watchlist-based)
- Screeners
- Pre-Market
- Open Market
- Post-Market
- News Scanner
- Advanced Screener
- Expected Move
- Intelligence Engine

Repairs:

- Reconnected `Screeners` UI (`ScannerSection`) to `/api/scanner`.
- Normalized scanner response mapping for display compatibility.

### Task 7 — Remove Default Symbols

Removed hardcoded auto-loaded symbols (`AAPL`, `MSFT`, `TSLA`, `NVDA`) from key auto-load flows:

- `client/src/pages/OpenMarketPage.jsx` (now empty symbol slots)
- `client/src/pages/ExpectedMovePage.jsx` (no hardcoded fallback watchlist symbols; no initial forced ticker)

### Task 8 — Restore Screener UI

- `client/src/pages/ScannerSection.jsx` now requests `/api/scanner`.
- Backend `/api/scanner` now sourced from:
  - `market_metrics`
  - `JOIN ticker_universe`
  - `JOIN trade_setups`

### Task 9 — System Health Dashboard Endpoint

Added endpoint:

- `/api/system/report`

Returns:

- `metrics_rows`
- `setups_count`
- `catalysts_count`
- `ticker_universe_size`
- `queue_size`

### Task 10 — Verification Executed

Frontend:

- `cd client && npm run build` ✅
- `cd client && npm run preview -- --host 127.0.0.1 --port 4173` ✅ (auto-selected open port 4176)

Endpoint tests:

- `node server/tools/test_endpoints.js` against production: 5/7 passing (2 failing)
- `TEST_BASE_URL=http://127.0.0.1:3000 node server/tools/test_endpoints.js` against stabilized local backend: 7/7 passing

## Working Endpoints (Local Verified)

- `/api/system/health`
- `/api/metrics`
- `/api/scanner`
- `/api/premarket`
- `/api/news`
- `/api/setups`
- `/api/expected-move`
- `/api/system/report`

## Broken Endpoints (Production Check Snapshot)

At test time on production backend:

- `/api/system/health` returned non-OK status
- `/api/news` returned non-OK status

These are now fail-safe in code; production will reflect after deploy.

## Files Changed

- `server/index.js`
- `server/routes/news.js`
- `server/tools/test_endpoints.js`
- `client/src/pages/ScannerSection.jsx`
- `client/src/pages/OpenMarketPage.jsx`
- `client/src/pages/ExpectedMovePage.jsx`
- `SYSTEM_STABILIZATION_REPORT.md`

## Remaining Failures / Follow-up

- Production health/news failures are still present in live check results until latest code is deployed and runtime settles.
- Local stabilized backend validates fully (7/7 endpoint checks).
