# OPENRANGE Platform Integration Audit

Date: 2026-03-05
Scope: Diagnostic-only integration audit (no feature, engine, worker, or functional code changes)

## 1) Executive Summary

- Core scanner/setups/catalysts/metrics integrations are wired and actively returning data from runtime APIs.
- Opportunity Stream and Market Narrative are integrated in UI and backend routes but currently non-functional due backend data-layer issues.
- System health is degraded and intermittently unstable (`/api/system/health` fallback mode + repeated DB timeout/missing relation errors).
- Primary root causes found:
  1. Missing database relations referenced by report/engine routes (`market_narratives`, intermittently `opportunity_stream`).
  2. Unstable DB connectivity/latency causing timeout failures (`timeout exceeded when trying to connect`).

## 2) Runtime Endpoint Verification (Status / Size / Timing / Sample)

Source: direct `curl` checks against `http://localhost:3000`

| Endpoint | HTTP | Bytes | Time (s) | Sample / Observation |
|---|---:|---:|---:|---|
| `/api/scanner` | 200 | 16684 | 0.026 | Returns populated scanner rows (symbols like `ONMD`) |
| `/api/setups` | 200 | 19855 | 0.027 | Returns populated setup rows (`Momentum Continuation`, etc.) |
| `/api/catalysts` | 200 | 31124 | 0.027 | Returns populated catalyst feed |
| `/api/opportunity-stream` | 200 | 2 | 0.021 | Returns `[]` (empty feed) |
| `/api/market-narrative` | 200 | 4 | 0.023 | Returns `null` |
| `/api/metrics` | 200 | 24085 | 0.041 | Returns populated metrics rows |
| `/api/filters` | 200 | 152 | 0.001 | Returns filter registry |
| `/api/scoring-rules` | 200 | 294 | 0.001 | Returns scoring rules |
| `/api/system/report` | 500 | 75 | 0.156 | `{"status":"error","detail":"relation \"market_narratives\" does not exist"}` |

Additional repeated `/api/system/report` probes returned mixed failures:
- `{"status":"error","detail":"timeout exceeded when trying to connect"}`
- `{"status":"error","detail":"relation \"opportunity_stream\" does not exist"}`

## 3) Health Endpoints

| Endpoint | Result |
|---|---|
| `/api/system/health` | degraded fallback: `health timeout fallback` |
| `/api/metrics/health` | timeout (curl 28 after 6s) |
| `/api/ingestion/health` | timeout (curl 28 after 6s) |
| `/api/universe/health` | timeout (curl 28 after 6s) |
| `/api/queue/health` | ok (`queue_size: 0`) |

Interpretation: overall system can serve some data endpoints but has DB/service instability under broader health/report checks.

## 4) Backend Route Audit (Integration Presence)

Verified in `server/index.js`:
- `/api/filters`
- `/api/scoring-rules`
- `/api/system/report`
- `/api/setups`
- `/api/catalysts`
- `/api/scanner`
- `/api/metrics`
- `/api/opportunity-stream`
- `/api/market-narrative`

Key behavior pattern:
- Scanner/setups/catalysts/metrics routes return `[]` on DB errors (catch blocks suppress hard failures).
- Narrative route returns `null` on DB error.
- Opportunity route returns `[]` on DB error.
- System report route returns explicit `500` + DB error detail.

## 5) Frontend Page → API Mapping

### Route wiring
- `client/src/App.jsx` maps:
  - `/pre-market-command` → `PreMarketCommandCenter`
  - `/open-market-radar` → `OpenMarketRadar`

### Pre-Market Command Center (`client/src/pages/PreMarketCommandCenter.jsx`)
- Calls:
  - `/api/metrics`
  - `/api/catalysts`
  - `/api/scanner`
  - `/api/setups`
  - `/api/earnings`
- Embedded components:
  - `MarketNarrative` → `/api/market-narrative`
  - `OpportunityStream` (compact) → `/api/opportunity-stream`

### Open Market Radar (`client/src/pages/OpenMarketRadar.jsx`)
- Calls:
  - `/api/scanner`
  - `/api/setups`
  - `/api/catalysts`
  - `/api/metrics`
- Embedded components:
  - `MarketNarrative` → `/api/market-narrative`
  - `OpportunityStream` → `/api/opportunity-stream`

### Opportunity Stream component (`client/src/components/opportunity/OpportunityStream.jsx`)
- Polling every 15s from `/api/opportunity-stream`.
- UI supports filtering by event type, source category, and min score.
- Empty state shown when filtered list is empty: `No active opportunities detected`.

### Market Narrative component (`client/src/components/narrative/MarketNarrative.jsx`)
- Loads `/api/market-narrative` once on mount.
- Shows empty state when payload absent: `No market narrative available.`

## 6) Rendering-State Analysis (Why UI Sections Look Empty)

Observed behavior is consistent with implementation:
- If backend returns `[]` / `null`, command-center cards render empty-state messages rather than errors.
- Opportunity and narrative sections are therefore “quietly empty” under DB failures or missing-table conditions.
- Because server routes catch DB errors and normalize to `[]` / `null`, frontend cannot distinguish “genuinely no data” vs “data source failure” without explicit error metadata.

## 7) Empty Data Source Root Cause Analysis

Primary evidence points to backend data-layer issues, not missing frontend wiring:
1. `/api/system/report` repeatedly fails with missing relations (`market_narratives`, intermittently `opportunity_stream`).
2. `/api/system/report` also intermittently fails with DB connection timeout.
3. `/api/opportunity-stream` and `/api/market-narrative` return syntactically successful but empty payloads (`[]` / `null`), matching catch/fallback behavior in server routes.

Conclusion:
- Command-center empty Opportunity/Narrative sections are caused upstream by missing/unstable DB backing resources.

## 8) Theme Consistency Audit

- App-level theme toggle wiring exists via Zustand + `ThemeProvider` (`html.dark` + `data-theme`).
- Most command-center surfaces use CSS variables / shared primitives.
- Notable inconsistency: `client/src/components/shared/TradingViewChart.jsx` hard-sets TradingView widget theme to `dark`, independent of app theme. This can produce mixed-theme visuals.

## 9) Hardcoded Ticker Audit

Within audited command-center flow:
- `PreMarketCommandCenter` computes regime specifically from symbols `SPY`, `QQQ`, and `VIX`/`^VIX` in client logic.

Outside command-center pages (broader client):
- Additional hardcoded index/watchlist symbols exist (e.g., `SPY`, `QQQ`, etc. in `Charts.jsx` and `MarketOverviewPage.jsx`).

## 10) Opportunity/Narrative Validation

Integration validity:
- Both features are fully wired end-to-end in route handlers and UI components.

Runtime state:
- Opportunity stream endpoint currently returns empty list.
- Market narrative endpoint currently returns null.
- System report confirms related table/relation failures and DB instability.

## 11) Performance Snapshot

Fast endpoints under current runtime:
- `/api/filters`, `/api/scoring-rules` ~1ms
- `/api/scanner`, `/api/setups`, `/api/catalysts` ~26–27ms
- `/api/metrics` ~41ms

Unstable/heavy paths:
- `/api/system/report` failing (relation/timeout issues)
- Multiple health endpoints timing out at 6s

## 12) Audit Constraints / Limitations Encountered

- Direct standalone DB diagnostic scripts experienced connection termination/timeout issues.
- Full-table counts on large historical tables were not reliably obtainable in this runtime state.
- Evidence was therefore taken from:
  - API runtime behavior
  - repeated health/report probes
  - static code integration mapping

## 13) High-Confidence Findings

1. Frontend and route-level integrations are present and correctly wired.
2. Empty command-center intelligence sections are caused by backend data-layer failures (missing relations + connection instability), not missing UI integration.
3. Error masking (`[]`/`null` fallbacks) makes outages appear as “no opportunities/no narrative,” reducing observability in frontend.
4. Theme mismatch risk exists in TradingView widget due forced dark mode.

## 14) Recommended Next Diagnostic Actions (No Feature Changes)

1. Validate DB schema migration state for `opportunity_stream` and `market_narratives` in active runtime DB.
2. Stabilize DB connectivity/timeout profile before re-running full table-count/timestamp diagnostics.
3. Re-run `/api/system/report` and health endpoints after schema/connectivity remediation.
4. Re-run this audit checklist to confirm Opportunity Stream and Market Narrative become data-populated.

---

## Appendix A: Files Audited (Primary)

- `server/index.js`
- `client/src/App.jsx`
- `client/src/pages/PreMarketCommandCenter.jsx`
- `client/src/pages/OpenMarketRadar.jsx`
- `client/src/components/opportunity/OpportunityStream.jsx`
- `client/src/components/narrative/MarketNarrative.jsx`
- `client/src/components/layout/ThemeProvider.tsx`
- `client/src/store/useAppStore.ts`
- `client/src/components/shared/TradingViewChart.jsx`
- `client/src/config/api.js`
