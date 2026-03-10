# SIGNAL_PIPELINE_REPORT

## Scope
Implemented and validated the Signal Intelligence Pipeline with extend-only changes:

- Router: `server/system/signalRouter.js`
- New scoring engines:
  - `server/engines/liquiditySurgeEngine.js`
  - `server/engines/floatRotationEngine.js`
  - `server/engines/signalConfirmationEngine.js`
  - `server/engines/signalScoringEngine.js`
- Pipeline wiring:
  - `server/engines/stocksInPlayEngine.js`
- Signal APIs:
  - `server/routes/signals.js`
  - mounted in `server/index.js`
- MCP narrative extension:
  - `server/services/mcpClient.js`
- Morning brief + email integration:
  - `server/engines/morningBriefEngine.js`
  - `server/services/emailService.js`
- Frontend score breakdown modal:
  - `client/src/components/opportunities/OpportunityStream.jsx`

## Runtime Validation

### 1) Engine Run
Executed `runStocksInPlayEngine()` end-to-end after compatibility fixes.

Observed result:

- `selected: 20`
- `upserted: 20`
- `boosted: 0`

### 2) Database Population Checks
Validated via SQL:

- `trade_signals_count = 20`
- `dynamic_watchlist_count = 2`
- `signal_alerts_count = 0`
- `score_breakdown_count = 20`
- `narrative_count = 20`

Notes:

- `signal_alerts_count` can remain `0` when no signal meets alert conditions after briefing-gate logic.
- Top signals include scores up to `90`, with persisted confidence and narrative text.

### 3) Static Diagnostics
No syntax/type diagnostics found in modified core files:

- `server/system/signalRouter.js`
- `server/routes/signals.js`
- `server/engines/stocksInPlayEngine.js`
- `server/engines/signalScoringEngine.js`
- `client/src/components/opportunities/OpportunityStream.jsx`

## Compatibility Fixes Applied
Pre-existing table schemas differed from new pipeline expectations. Added additive compatibility guards (no destructive migration):

- `signal_engine_metrics`: missing columns/index expected by liquidity metrics upsert
- `dynamic_watchlist`: missing `strategy`, `score_breakdown`, `updated_at`, and related fields
- `signal_alerts`: ensured required routing fields (`strategy`, `score`, `confidence`, `message`)

All fixes use `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` patterns.

## API Surface Added

- `GET /api/signals/watchlist`
- `GET /api/signals/alerts`
- `GET /api/signals/:symbol/score`

These endpoints are implemented and mounted under `/api`.

## Frontend Verification
Opportunity stream now includes a `Full Score Breakdown` action per signal card that opens a modal with:

- component-level scoring breakdown (gap/rvol/rotation/liquidity/catalyst/sector/confirmation/total)
- confidence and catalyst metadata
- MCP narrative explanation

## Environment Caveat
Live HTTP endpoint probing in this local environment was limited by unrelated runtime constraints:

- existing process bound to port `3000` (`EADDRINUSE`)
- missing optional env keys in one startup context

Pipeline and persistence validation were completed through direct engine execution and SQL verification.
