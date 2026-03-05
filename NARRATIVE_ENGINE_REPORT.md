# NARRATIVE ENGINE REPORT

Date: 2026-03-04

## Narrative Logic
The Market Narrative Engine is additive and reads current intelligence data to generate a concise market summary.

Regime logic:
- Bullish: SPY price above VWAP and SPY relative volume elevated (RVOL proxy for increasing participation).
- Bearish: SPY price below VWAP and VIX change positive (rising volatility pressure).
- Neutral: when neither bullish nor bearish criteria are met.

Narrative sections produced:
- Market Regime
- Drivers
- Top Opportunities

Scheduler behavior:
- Runs every 5 minutes.
- Inserts a new narrative snapshot into `market_narratives`.

## Data Sources
Backend tables used:
- `market_metrics`
- `trade_setups`
- `trade_catalysts`
- sector grouping via `ticker_universe` join

APIs added/extended:
- `GET /api/market-narrative` (latest narrative JSON)
- `GET /api/system/report` now includes `narrative_count`
- `GET /api/opportunity-stream` now includes explicit `timestamp`

## Opportunity Stream Filter Enhancements
Enhanced `OpportunityStream.jsx` with client-side filters over existing API responses:
- Event Type: setup / catalyst / market
- Source: strategy / news / metrics
- Minimum score slider

Additional UX improvements:
- Event icons per type
  - setup → chart icon
  - catalyst → news icon
  - market → lightning icon
- Existing empty state preserved: `No active opportunities detected`

## Pages Updated
- `client/src/pages/PreMarketCommandCenter.jsx`
  - Added top-level `MarketNarrative` panel
  - Existing Opportunity Stream preview retained
- `client/src/pages/OpenMarketRadar.jsx`
  - Added top-level `MarketNarrative` panel
  - Existing Opportunity Stream side panel upgraded with filters/icons

## Backend Files Added
- `server/migrations/create_market_narratives.sql`
- `server/narrative/narrative_engine.js`
- `server/narrative/narrative_scheduler.js`

## Frontend Files Added
- `client/src/components/narrative/MarketNarrative.jsx`

## Verification
- Client build: `cd client && npm run build` ✅
- Client preview: `npm run preview` ✅ (served on `127.0.0.1:4176` due local port contention)
- Narrative API: `GET /api/market-narrative` returned JSON (`200`, `null`) ✅
- Updated page routes served (`200`):
  - `/open-market-radar`
  - `/pre-market-command`
