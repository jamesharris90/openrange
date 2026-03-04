# ENGINE UI INTEGRATION REPORT

Date: 2026-03-04

## Summary
The frontend was upgraded to an engine-driven integration pattern using backend intelligence endpoints and `apiJSON` consumption for the requested pages.

## Pages Updated
- Dashboard (`/dashboard`)
- Open Market (`/open-market`)
- AI Quant (`/intelligence`)
- Scanner cards (`/screeners` scanner modules)
- Expected Move (`/expected-move`)
- News Scanner (`/news-scanner`)

## Endpoints Used
- `/api/setups`
- `/api/catalysts`
- `/api/metrics`
- `/api/scanner`
- `/api/expected-move?symbol=`
- `/api/scoring-rules`
- `/api/filters`
- `/api/system/report` (backend already available for operational checks)

## Components Modified
- `client/src/pages/DashboardPage.jsx` (new)
- `client/src/App.jsx`
- `client/src/pages/OpenMarketPage.jsx`
- `client/src/components/ai-quant/AIQuantPage.jsx`
- `client/src/pages/ExpectedMovePage.jsx`
- `client/src/pages/ScannerSection.jsx`
- `client/src/components/screener/FilterSection.tsx`
- `client/src/hooks/useFilterRegistry.js`
- `client/src/pages/NewsScannerV2.jsx`

## Static Ticker Cleanup
Removed hardcoded references to `AAPL`, `MSFT`, `TSLA`, `NVDA` from defaults/placeholders in active frontend files unless user-provided at runtime.

## Verification
- `cd client && npm run build` ✅
- `npm run preview -- --host 127.0.0.1 --port 4173` ✅ (served on fallback port `4176` due local port collisions)

## Notes
- Dashboard now renders a Top Opportunities table (top 10 from setups + metrics enrichment), catalyst sidebar feed, and market context panel (SPY/QQQ/VIX + regime).
- Open Market is scanner-driven and sortable by score/relative volume/gap.
- AI Quant now uses setups table data and scoring-rules detail panel.
- Expected Move now runs symbol-query flow against `/api/expected-move?symbol=` and shows scoring breakdown.
- Scanner registry behavior is now sourced from `/api/filters` with hardcoded fallback registry removal.
