# Data Trust

## Purpose

The data trust layer gives operators and frontend consumers a session-aware view of whether core market data is usable right now. It is intended to answer two questions quickly:

1. Is the platform safe to read from for the current market session?
2. If trust is degraded, which pipeline is responsible?

The current implementation lives behind the production endpoints under `/api/data/trust` and evaluates the active universe against a small set of operational SLAs.

## Current SLA Snapshot

Current production snapshot as of `2026-04-21T13:19:11.437Z`:

| SLA | Status | Measured | Reason |
| --- | --- | --- | --- |
| live_quotes_freshness | PASS | 613 active symbols fresh in 5m | - |
| intraday_priority_10m | unknown | unavailable | query_timeout |
| live_quotes_coverage | PASS | 100% | - |
| intraday_24h_coverage | unknown | unavailable | query_timeout |
| daily_ohlc_yesterday | FAIL | 95.5% | - |
| news_last_24h | PASS | 1676 rows | - |
| earnings_upcoming_estimates | PASS | 100% | - |
| catalysts_active | PASS | 22 in last 1h | - |

Overall health: `DEGRADED`

## Session-Aware Evaluation

The trust summary is intentionally session-aware.

- During `CLOSED`, live quote freshness and intraday freshness are marked `N/A` because the market is not trading.
- During active sessions such as `PREMARKET`, `REGULAR`, and `AFTER_HOURS`, those same SLAs become hard checks.
- The overall health becomes `DEGRADED` if any SLA is `FAIL` or `unknown`.
- A timeout is surfaced as `unknown/query_timeout` instead of being silently treated as healthy.

This avoids false alarms overnight while still making live-session data failures visible.

## Endpoint Reference

- `GET /api/data/trust/summary`
  - Returns overall health, current session, and the full SLA set.
- `GET /api/data/trust/sla`
  - Returns the same SLA payload without extra summary fields.
- `GET /api/data/trust/symbol/:symbol`
  - Returns symbol-level trust details including quote freshness, latest intraday timestamp, latest daily bar, and recent news count.
- `GET /api/system/snapshot-status`
  - Returns screener snapshot availability and age, which is useful when `/api/screener` appears stale.

## Known Issues

- `market_quotes` still contains `434` zombie rows for symbols missing from the active tradable universe.
- Daily OHLC coverage is below target at `95.5%` for the prior session.
- Intraday trust checks are currently degrading to `unknown/query_timeout` under load.
- Universe hygiene still has unresolved non-core instruments from the prior audit: `421` SPAC-like symbols and `11` ETF-like symbols remain active and should be removed from the common stock decision surface.
- Screener freshness depends on the screener snapshot scheduler being enabled. If disabled, `/api/screener` can serve an old snapshot even when the underlying query code is correct.

## How To Add A New SLA

1. Add a new `safeQuery(...)` in `server/routes/data_trust.js` that measures the target dataset directly.
2. Convert the query result into an SLA entry with `sla(status, measured, reason)`.
3. Make the threshold explicit in code so the pass/fail boundary is readable in one place.
4. Include session-aware behavior if the metric should be suppressed during `CLOSED`.
5. Expose the SLA through both `/summary` and `/sla` by adding it to `slas`.
6. Verify the new field in production before relying on it for operator decisions.

## Operational Notes

- `summary` and `sla` responses are cached in-process for `60` seconds.
- `unknown/query_timeout` is an actionable signal, not a cosmetic warning.
- The screener UI is snapshot-backed, so query fixes do not become visible until a new screener snapshot is written.
- When trust is degraded, use the endpoint-level measurement first and only then move deeper into the pipeline.