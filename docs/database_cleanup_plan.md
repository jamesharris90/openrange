# Database Cleanup Plan

Generated: 2026-03-12

## Scope

This plan deprecates legacy table access in code without dropping tables or deleting data.

Legacy tables targeted:
- `market_news`
- `alerts`
- `opportunities`

Canonical replacements:
- `market_news` -> `news_articles`
- `alerts` -> `signal_alerts`
- `opportunities` -> `opportunity_stream` (stream) and `strategy_signals` (signal state)

## Current State

- Repository audit is documented in `docs/database_alignment_report.md`.
- Canonical access contract is defined in `server/config/dataContract.js`.
- Repository layer now wraps canonical access in `server/repositories/`.
- Schema drift checks are available at `/api/system/schema-health`.

## Migration Path (No Destructive Changes)

1. Freeze legacy writes in application code.
- Keep tables intact, but stop writing new records to legacy tables from API paths.
- Route all new writes/reads through the repository layer and `DATA_CONTRACT`.

2. Route reads to canonical tables.
- News reads use `news_articles` via `newsRepository`.
- Alerts reads use `signal_alerts` via `alertsRepository`.
- Opportunity reads use `opportunity_stream` via `opportunityRepository`.

3. Keep compatibility views at API boundary where needed.
- Preserve existing response shapes by mapping canonical rows in route handlers.
- Avoid frontend breaking changes while data access is standardized.

4. Monitor drift continuously.
- Use `/api/system/schema-health` in admin diagnostics.
- Investigate any `[SCHEMA DRIFT DETECTED]` warnings immediately.

5. Observe read traffic before deprecation.
- Track references to `market_news`, `alerts`, and `opportunities` in logs/telemetry.
- If a legacy table still receives traffic, patch that caller to repository access.

6. Final deprecation checkpoint (future release).
- Confirm zero app-layer reads/writes to legacy tables over an agreed burn-in period.
- After burn-in, move legacy tables to archive or replace with compatibility views.
- Any DROP/DDL remains out of scope for this stabilization change set.

## Frontend Transition

1. Keep UI endpoints unchanged where possible.
- UI should continue calling existing API routes.
- Backend now sources canonical tables via repositories.

2. For direct table assumptions in UI payloads:
- Normalize payload fields in routes (for example, `published_at` -> `publishedAt`) rather than changing frontend contracts abruptly.

3. Validate with diagnostics.
- Use `/admin/system-diagnostics` -> `DATABASE HEALTH` for row counts and drift visibility.

## Safety Constraints Applied

- No data deletion.
- No table drops.
- No migration rewrites.
- Additive architecture only: contract layer, repository layer, schema validator, diagnostics endpoint.
