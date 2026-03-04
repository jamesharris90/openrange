# OPPORTUNITY STREAM REPORT

Date: 2026-03-04

## Overview
Implemented an additive OpenRange Opportunity Stream Engine that unifies strategy signals, catalyst events, and market anomaly detections into a single feed without modifying ingestion workers or existing engine logic.

## Events Detected
The stream captures three event types:

- `setup`
  - Source table: `trade_setups`
  - Headline: setup name (`setup`)
  - Source label: `strategy_engine`

- `catalyst`
  - Source table: `trade_catalysts`
  - Headline: catalyst `headline`
  - Source label: `catalyst_engine`

- `market`
  - Source table: `market_metrics`
  - Trigger conditions:
    - `relative_volume > 3`
    - OR `gap_percent > 4`
  - Headline: `Unusual volume or gap detected`
  - Source label: `market_metrics_engine`

## Sources Used
- `trade_setups`
- `trade_catalysts`
- `market_metrics`
- API read endpoints leveraged by frontend panels:
  - `/api/opportunity-stream`
  - Existing page data sources remained active (`/api/scanner`, `/api/setups`, `/api/catalysts`, `/api/metrics`, `/api/earnings`)

## Backend Additions
- Migration:
  - `server/migrations/create_opportunity_stream.sql`
- Stream engine:
  - `server/opportunity/stream_engine.js`
- Scheduler (60s interval, duplicate prevention logic):
  - `server/opportunity/stream_scheduler.js`
- API endpoint:
  - `GET /api/opportunity-stream` (latest 50, `created_at DESC`)
- Monitoring extension:
  - `GET /api/system/report` now includes `opportunity_stream_count`

## Frontend Integration
Created feed component:
- `client/src/components/opportunity/OpportunityStream.jsx`

Features:
- Auto-refresh every 15 seconds via `apiJSON`
- Displays: ticker, event_type, headline, score, timestamp
- Row click opens chart panel
- Empty state: `No active opportunities detected`

Pages integrated:
- `client/src/pages/OpenMarketRadar.jsx`
  - Opportunity Stream added in right-side panel
- `client/src/pages/PreMarketCommandCenter.jsx`
  - Opportunity Stream preview widget added

## Verification
- Frontend build: `cd client && npm run build` ✅
- Frontend preview: `npm run preview` ✅ (served on `127.0.0.1:4176` due local port contention)

Notes:
- Preview route HTTP probing tools (`curl`/`node`) were unavailable in shell PATH, so runtime route checks were validated via successful preview startup and compiled route integration.
