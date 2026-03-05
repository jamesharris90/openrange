# Frontend API Routing Repair Report

Date: 2026-03-05
Scope: Full frontend API routing repair and verification (`client/` only)

## 1) API Client Verification

Verified and updated `client/src/config/api.js`:
- Uses `VITE_API_BASE_URL` via `API_BASE`.
- All requests resolve as `${API_BASE}${path}`.
- Parses responses as text first, then JSON.
- Detects HTML misrouting (`<!DOCTYPE html`) and throws `Invalid JSON response`.
- Logs diagnostic message: `Frontend API misrouting detected` when HTML is returned.
- Exposes `apiJSON(path, options)` wrapper.

## 2) Wrapper Enforcement Audit

Search performed across `client/src` for direct raw `/api` fetch calls.

Pattern checked:
- `fetch("/api...` and `fetch('/api...` (strict regex)

Result:
- No direct raw `fetch('/api...')` calls found.
- API traffic is routed through:
  - `apiJSON` (shared API client)
  - `authFetch` (also resolves through `VITE_API_BASE_URL` in `client/src/utils/api.js`)

## 3) Critical Components Verification

Verified these files use `apiJSON("/api/...")` and not raw fetch:
- `client/src/pages/DashboardPage.jsx`
- `client/src/pages/PreMarketCommandCenter.jsx`
- `client/src/pages/OpenMarketRadar.jsx`
- `client/src/components/opportunity/OpportunityStream.jsx`
- `client/src/components/narrative/MarketNarrative.jsx`

## 4) Production Environment Configuration

Verified `client/.env.production` contains:

```dotenv
VITE_API_BASE_URL=https://openrange-backend-production.up.railway.app
```

## 5) Runtime API Diagnostics

Added new file:
- `client/src/utils/apiDiagnostics.js`

Integrated into `apiFetch`:
- Logs `API request: <path>` in development mode only.

## 6) Dashboard Health Indicator

Updated `client/src/pages/DashboardPage.jsx`:
- Calls `apiJSON('/api/system/report')` on mount.
- Displays warning banner when `status === 'degraded'`.
- Includes available `missing_tables` and `detail` text when provided.

## 7) Build & Routing Verification

Build:
- `npm run build` (from `client/`) completed successfully.

Preview:
- `vite preview` running at `http://127.0.0.1:4176/` (port auto-shift due conflicts).

Bundle verification:
- Production backend URL confirmed inside built assets (`dist/assets/api-*.js`).

Endpoint JSON verification against production backend:
- `/api/scanner` → 200, JSON=true, HTML=false
- `/api/setups` → 200, JSON=true, HTML=false
- `/api/catalysts` → 200, JSON=true, HTML=false
- `/api/opportunity-stream` → 200, JSON=true, HTML=false
- `/api/market-narrative` → 200, JSON=true, HTML=false

## 8) Files Updated

- `client/src/config/api.js`
- `client/src/utils/apiDiagnostics.js` (new)
- `client/src/pages/DashboardPage.jsx`

No backend engine or database files were modified as part of this frontend routing repair task.
