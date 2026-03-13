# Schema Validation Report

Date: 2026-03-13
Phase: 1
Status: PASS_WITH_DRIFT

## Validation Rules Applied
Required tables:
- `signal_registry`
- `signal_outcomes`
- `daily_ohlc`
- `strategy_weights`
- `signal_validation_daily`
- `signal_validation_weekly`
- `missed_opportunities`

Stop conditions:
- Missing table
- Missing required column in live table

Allowed differences:
- UUID instead of BIGSERIAL
- TIMESTAMPTZ instead of TIMESTAMP
- Nullable `strategy`
- Existing `source` column

## Result
All required tables exist in Supabase live schema.
No stop-condition column gaps were detected for Phase-F target operations.

## Non-Blocking Drift Notes
- `database/schema_snapshot.sql` is incomplete for Phase-F scope and does not define several required live tables (`daily_ohlc`, `strategy_weights`, `signal_validation_daily`, `signal_validation_weekly`, `missed_opportunities`).
- `signal_registry` and `signal_outcomes` in live schema are UUID-based and differ from snapshot historical BIGSERIAL forms.
- Live `signal_outcomes` uses `return_percent` model rather than snapshot `pnl_pct`.

## Execution Decision
Continue pipeline using live schema contract and defensive SQL compatible with current production tables.
