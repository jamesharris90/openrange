# OPENRANGE SYSTEM REPAIR REPORT

Date: 2026-03-09
Scope: Full system repair + data integrity pass (safe, non-destructive updates only).

## Executive Summary

Repair pass completed across backend, scheduler, schema guards, and frontend runtime stability.

Primary outcomes:
- Dynamic import crash hardening added (`safeLazy`) and app-level global error boundary added.
- Endpoint 500 on `/api/strategy/trades` fixed.
- Schema drift protection expanded with additive `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` guards.
- Engine crash hardening added with top-level `try/catch` wrappers on key run paths.
- Market indices endpoint logic repaired to support SPY/QQQ/IWM/VIX/DXY/10Y normalized payload shape with layered fallbacks.
- Dashboard index cards now show `--` for missing data instead of misleading `0`.

## Routes Repaired / Verified

Backend route discovery and validation covered `server/index.js`, `server/routes`, and mounted module routes.

Expected endpoints verified in code and tested live:
- `GET /api/opportunities/top`
- `GET /api/signals/watchlist`
- `GET /api/signals/alerts`
- `GET /api/signals/hierarchy`
- `GET /api/intelligence/order-flow`
- `GET /api/intelligence/sector-momentum`
- `GET /api/intelligence/early-accumulation`
- `GET /api/intelligence/news`
- `GET /api/strategy/performance`
- `GET /api/strategy/trades`
- `GET /api/market/indices`

No missing mounts were found for the required routes.

## Schema Updates

Expanded startup schema guard in `server/system/schemaGuard.js` with additive protections for:
- `trade_signals`
- `dynamic_watchlist`
- `signal_hierarchy`
- `signal_component_outcomes`
- `signal_weight_calibration`
- `market_metrics`

Guard strategy:
- `CREATE TABLE IF NOT EXISTS`
- `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
- `CREATE INDEX IF NOT EXISTS`

No destructive operations were added.

## Engine Stability Improvements

Added top-level safety wrappers to prevent scheduler-loop crashes and preserve degraded return payloads:
- `server/engines/stocksInPlayEngine.js`
- `server/engines/orderFlowImbalanceEngine.js`
- `server/engines/sectorMomentumEngine.js`
- `server/engines/signalHierarchyEngine.js`
- `server/engines/signalPerformanceEngine.js`
- `server/engines/signalLearningEngine.js`
- `server/engines/signalOutcomeWriter.js`
- `server/system/signalRouter.js` (batch routing guard)

Also repaired a runtime DB integrity issue in strategy engine:
- `server/engines/strategyEngine.js`
- Added safe dedupe/null cleanup before unique index enforcement.
- Added uniqueness index guard for `ON CONFLICT (symbol)` path.

## Frontend Crash Guards

### Dynamic import failure fix
- Added `client/src/utils/safeLazy.js`.
- Replaced route lazy imports in `client/src/App.jsx` from `lazy(() => import(...))` to `safeLazy(() => import(...))`.

### Global error boundary
- Added `client/src/components/ErrorBoundary.jsx` with explicit reload action.
- Wrapped app root in `client/src/main.jsx`.

### Undefined/empty market data handling
- Updated `client/src/components/market/MarketIndexCard.jsx`:
  - Null-safe rendering for price/change.
  - Displays placeholders instead of coercing to zero.

## Endpoint Fixes

Fixed concrete 500 root cause:
- `server/routes/strategyIntelligence.js`
- `/api/strategy/trades` ambiguous `id` selection repaired (`t.id`).

## Market Index Feed Repairs

Repaired mounted index provider in:
- `server/modules/marketData/marketDataRoutes.js`

Changes:
- Added normalized target model for SPY/QQQ/IWM/VIX/DXY/10Y.
- Added FMP stable quote pull symbols for extended set (`DX-Y.NYB`, `^TNX`).
- Added DB fallback layers from `market_metrics` and `market_quotes`.
- Added normalized response keys:
  - `spy`, `qqq`, `iwm`, `vix`, `dxy`, `tenYear`
  - plus `indices` array with `price`, `change`, `changePercent`, `percent` aliases.

## Live Retest (Port 3010)

Latest retest results:
- `/api/opportunities/top` -> 200
- `/api/signals/watchlist` -> 200
- `/api/signals/alerts` -> 200
- `/api/signals/hierarchy` -> 200
- `/api/intelligence/order-flow` -> 200
- `/api/intelligence/sector-momentum` -> 200
- `/api/intelligence/early-accumulation` -> 200
- `/api/intelligence/news` -> 200
- `/api/strategy/performance` -> 200
- `/api/strategy/trades` -> 200
- `/api/market/indices` -> 200

Observed latency range in this run was approximately 0.03s to 1.38s depending on endpoint and DB load.

## Remaining External/Environment Risks (Not Repaired Here)

These are upstream configuration/dependency issues and were not changed by this pass:
- Missing env keys in this runtime: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `PROXY_API_KEY`.
- MCP SDK module resolution warning for `@modelcontextprotocol/sdk` path.
- Upstream intel news engine receives 404 from external source.
- Some scheduler tasks still report DB timeouts under load.

## Changed Files (This Pass)

Backend:
- `server/modules/marketData/marketDataRoutes.js`
- `server/system/schemaGuard.js`
- `server/engines/stocksInPlayEngine.js`
- `server/engines/orderFlowImbalanceEngine.js`
- `server/engines/sectorMomentumEngine.js`
- `server/engines/signalHierarchyEngine.js`
- `server/engines/signalPerformanceEngine.js`
- `server/engines/signalLearningEngine.js`
- `server/engines/signalOutcomeWriter.js`
- `server/system/signalRouter.js`
- `server/engines/strategyEngine.js`
- `server/routes/strategyIntelligence.js`

Frontend:
- `client/src/utils/safeLazy.js`
- `client/src/components/ErrorBoundary.jsx`
- `client/src/App.jsx`
- `client/src/main.jsx`
- `client/src/components/market/MarketIndexCard.jsx`
