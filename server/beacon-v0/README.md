# Beacon v0 Skeleton

Phase 40 starts a greenfield Beacon v0 implementation under `server/beacon-v0/` only. It does not modify the existing Beacon worker, API routes, frontend, or persistence tables.

## Current vertical slice

Signal: `earnings_upcoming_within_3d`

Verified schema source:

- `canonical_earnings` does not exist in production.
- `earnings_events` exists and includes `symbol`, `report_date`, `earnings_date`, `company`, `time`, `report_time`, `exchange`, `price`, `avg_volume`, `market_cap`, `source`, and `updated_at`.
- `earnings_events` had upcoming rows in the next 3 and 7 days at Phase 40 pre-check time.

## Layer map

- `data/` reads existing production tables through the shared DB layer.
- `signals/` converts raw rows into named signal observations.
- `alignment/` groups fired signals by symbol without making trade recommendations.
- `qualification/` applies basic data-quality and universe gates.
- `categorization/` assigns descriptive pattern categories.
- `orchestrator/` runs the slice end-to-end and returns an in-memory result.
- `persistence/` is intentionally empty in Phase 40.

## Run smoke test

From the repository root:

`node server/beacon-v0/__tests__/earnings_signal.test.js`

The test is read-only and requires `server/.env` or `DATABASE_URL`/`SUPABASE_DB_URL` to point at remote Postgres.