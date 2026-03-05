# Engine Architecture

## Pipeline Overview

1. **FMP Market Ingestion**
   - Source: Financial Modeling Prep (FMP)
   - Responsibility: ingest quote universe into `market_quotes`
   - Schedule: every 60 seconds

2. **Metrics Engine**
   - Responsibility: derive `gap_percent`, `relative_volume`, `avg_volume_30d`
   - Inputs: `market_quotes`, `daily_ohlc`
   - Output: `market_metrics`
   - Schedule: every 120 seconds

3. **Sector Engine**
   - Planned responsibility: sector-level breadth/rotation analytics

4. **Strategy Engine**
   - Planned responsibility: strategy scoring and setup qualification

5. **Opportunity Engine**
   - Planned responsibility: actionable opportunity stream generation

6. **Catalyst Engine**
   - Planned responsibility: detect and rank catalyst events

7. **Intel News Engine**
   - Planned responsibility: normalize and score intelligence/news feed

8. **Earnings Engine**
   - Planned responsibility: earnings event ingestion and impact scoring

## Scheduler Model

- Engine scheduler runs in-process and is isolated with per-engine try/catch.
- Engine failures are logged and do not crash API server.
- Initial bootstrap triggers one immediate ingestion + metrics run.

## Future Platform Features

- Sector Heatmap
- Charts Page v2
- Trading Cockpit
- Broker Integrations
- DOM order book feed
- Hotkey execution system
- Trade journal
- Backtesting engine

## Broker Integration Planning (Future)

Supported brokers:
- IBKR
- Saxo
- Trading212
- Coinbase

DOM order book should only initialize when broker session authentication is active.
