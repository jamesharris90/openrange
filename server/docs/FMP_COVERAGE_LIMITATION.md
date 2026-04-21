# FMP Coverage Limitation — Mid-Cap Daily Freshness

Documented: 2026-04-21

## Issue

FMP `/stable/` tier returns stale daily OHLC and quote data for a subset
of US mid-cap equities. The stale data accumulates silently — symbol
appears to have current prices but timestamps reveal last update was
days to weeks prior.

## Affected symbols (examples)

- HOLX (Hologic, S&P 500) — 14 days stale (last update 2026-04-07)
- EXAS (Exact Sciences) — 29 days stale (last update 2026-03-23)
- CFLT (Confluent) — 35 days stale (last update 2026-03-17)
- RNAM (Avidity Biosciences) — 49 days stale (last update 2026-03-03)

Total active symbols affected: ~150-172 (varies by day).

## Detection

A symbol's quote is stale if:
- `timestamp` decodes to more than 1 trading day ago, AND
- `dayLow === dayHigh === open === previousClose === price` (no new trades)

Cumulative `volume` will appear absurdly high because no bar rotation
has occurred.

## Endpoints tested (all return same stale data for affected symbols)

- /stable/quote
- /stable/quote-short
- /stable/historical-price-eod/full
- /stable/historical-price-eod/light
- /stable/historical-chart/{1min|5min|15min|30min|1hour|4hour}
- /stable/aftermarket-quote
- /stable/aftermarket-trade

Controls (AAPL, NVDA) return fresh data from all endpoints. Issue is
symbol-specific, not endpoint-specific.

## Status

Open. Awaiting FMP support response.

## Mitigation options under consideration

1. Secondary provider (Polygon, Alpha Vantage, Yahoo) for affected symbols
2. Deactivate affected symbols from active universe
3. Wait for FMP to resolve
