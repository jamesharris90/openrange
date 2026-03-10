# Intelligence Expansion Report

Date: 2026-03-08

## Architecture Discovery

Inspected and integrated with existing structure:

- `server/engines`
- `server/routes`
- `server/services`
- `server/system/startEngines.js`
- `client/src/pages`
- `client/src/components`

Confirmed existing engines:

- `server/engines/catalystEngine.js`
- `server/engines/stocksInPlayEngine.js`
- `server/engines/morningBriefEngine.js`

Confirmed DB tables exist:

- `trade_signals`
- `strategy_trades`
- `news_catalysts`
- `market_metrics`
- `market_quotes`

## Strategy Evaluation Engine Logic

Created: `server/engines/strategyEvaluationEngine.js`

Responsibilities implemented:

1. Reads latest signals from `trade_signals`
2. Records simulated trade entries using `market_quotes.price`
3. Evaluates open trades when due (`4 hours` after entry or market close)
4. Persists outcomes to `strategy_trades`

Metrics computed and persisted:

- `exit_price`
- `max_move`
- `result_percent` = `((exit_price - entry_price) / entry_price) * 100`

Performance query support added in engine:

- win rate
- average move
- max move
- risk reward
- total trades

## Narrative Detection Method

Created: `server/engines/narrativeEngine.js`

Input sources:

- `news_catalysts`
- `news_articles`
- `market_metrics`

Narrative generation:

- Uses MCP/OpenAI helper `generateMarketNarratives(...)`
- Fallback heuristic included when MCP is unavailable
- Returns structured narrative objects with:
  - `sector`
  - `narrative`
  - `confidence`
  - `affected_symbols`

Persistence:

- Stored in `market_narratives` as JSON text in `narrative`
- `regime` derived from narrative content and stored

## MCP Signal Explanation Integration

Updated files:

- `server/services/mcpClient.js`
- `server/engines/stocksInPlayEngine.js`
- `server/routes/opportunities.js`

Changes:

- Added MCP helper `generateSignalExplanations(...)`
- Added fallback explanation/rationale generation
- Added `signal_explanation` and `rationale` persistence in `trade_signals`
- Exposed explanation fields in `/api/opportunities/top`

## UI Exposure

### Intel Inbox Commentary

Updated: `client/src/pages/IntelInbox.jsx`

- Added Narrative Commentary section
- Pulls from `/api/narratives/latest`
- Displays sector, narrative, confidence, affected symbols, and regime

### Sector Heatmap Explanations

Updated:

- `client/src/pages/SectorHeatmap.jsx`
- `client/src/components/market/SectorMarketHeatmap.jsx`

- Fetches narratives via `/api/narratives/latest`
- Maps narratives by sector
- Adds tile tooltip text using SVG `<title>` on heatmap tiles

### Signal Explanations In Opportunity UI

Updated: `client/src/components/opportunities/OpportunityStream.jsx`

- Displays `signal_explanation` / `rationale` beneath catalyst summary

### Strategy Evaluation Admin Page

Created: `client/src/pages/StrategyEvaluationPage.jsx`

Features:

- Summary cards: win rate, avg move, total trades
- Strategy performance bars
- Success-rate timeline list
- Deep-dive trades table:
  - symbol
  - strategy
  - entry price
  - exit price
  - result
  - max move

Routing/navigation updates:

- `client/src/App.jsx` route `/strategy-evaluation`
- `client/src/components/layout/Sidebar.tsx` nav item

## New API Endpoints

Created route file: `server/routes/strategyIntelligence.js`

Endpoints:

- `GET /api/strategy/performance`
- `GET /api/strategy/trades`
- `GET /api/narratives/latest`

Mounted in: `server/index.js` via `app.use('/api', strategyIntelligenceRoutes)`

## Scheduler Integration

Updated: `server/system/startEngines.js`

Added:

- `runStrategyEvaluationEngine` every 15 minutes
- `runNarrativeEngine` every 30 minutes

Both include:

- one-time global guard
- immediate startup run
- guarded interval execution with error logging

## Validation Results

Manual engine runs:

- Strategy evaluation engine: `inserted: 20`, `evaluated: 20`
- Narrative engine: `narrativesGenerated: 5`, `regime: Neutral`
- StocksInPlay engine: `selected: 20`, `upserted: 20`, `boosted: 0`

Population checks:

- `strategy_trades`: `20`
- `market_narratives`: `136`
- explained signals (`trade_signals.signal_explanation != ''`): `20`

API checks (HTTP):

- `/api/strategy/performance` -> `200`
- `/api/narratives/latest` -> `200`
- `/api/opportunities/top` -> `200`
- `/api/strategy/trades` available and wired via route

Payload checks:

- `/api/opportunities/top` includes `signal_explanation` and `rationale`
- `/api/narratives/latest` returned `5` narrative items
- `/api/strategy/performance` returned `2` strategy rows

## Build Results

Frontend build:

- Command: `cd client && npm run build`
- Result: Vite build succeeded

## Warnings / Notes

Observed pre-existing runtime warnings/errors during startup not introduced by this change:

- missing optional env warnings (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PROXY_API_KEY`)
- existing `signalPerformanceEngine` issue (`column "close" does not exist`)
- existing `intelNewsEngine` scheduler upstream `404`

Core expansion functionality validated and operational.
