# OpenRange Platform — Entity Relationships

This document describes how every table and view in the platform connects to every other.
Cross-reference with `schema.sql` for column-level detail.

---

## Users & Auth

```
users
  ├── user_preferences        (user_id → users.id)
  ├── user_watchlists         (user_id → users.id)
  ├── user_presets            (user_id → users.id)
  │     └── users.active_preset_id → user_presets.id
  ├── user_signal_feedback    (user_id → users.id)
  ├── user_alerts             (user_id text, no FK — supports unauthenticated alerts)
  ├── broker_executions       (user_id → users.id)
  ├── trades                  (user_id → users.id)
  │     └── trade_metadata    (trade_id → trades.trade_id, CASCADE DELETE)
  ├── trade_tags              (user_id → users.id)
  └── daily_reviews           (user_id → users.id)
```

---

## Market Data & Price Feed

```
ticker_universe        ← ingestion source of record for symbol catalogue
  └── market_metrics   ← derived metrics calculated per symbol from daily/intraday data
  └── market_quotes    ← live quote snapshot per symbol

daily_ohlc             ← 2-year daily OHLCV (keyed on symbol, date)
intraday_1m            ← rolling 30-day 1-minute bars (keyed on symbol, timestamp)
ingestion_state        ← singleton checkpoint row for fullMarketIngestion

market_metrics
  └── (read by) signal engines, calibrationPriceUpdater, queryEngine, radar views
  └── (read by) opportunity_intelligence engine for gap/rvol enrichment

market_quotes
  └── (read by) screener endpoints, sector heatmap
```

---

## News & Intelligence

```
news_events            ← raw articles (rolling 30-day retention)
news_articles          ← scored/enriched articles (News Scanner page)
intelligence_emails    ← raw email ingest
intel_news             ← internal intelligence news items (intelNarrativeEngine)

trade_catalysts        ← per-symbol catalyst events
  └── (read by) trade_setups enrichment, queryEngine, AI Quant prompt builder

signal_catalysts       ← catalysts linked to a specific signal
  └── signal_id → strategy_signals.id (soft reference)

signal_narratives      ← AI-generated narrative per signal
  └── signal_id → strategy_signals.id (soft reference)
```

---

## Signals & Strategy

```
strategy_signals       ← primary scored signal per symbol from strategy engine
  └── signal_performance    ← snapshot of signal state at evaluation time
  └── signal_outcomes       ← closed-out result after outcome measurement
  └── signal_catalysts      ← catalysts associated with this signal
  └── signal_narratives     ← AI narrative for this signal
  └── signal_hierarchy      ← ranked hierarchy classification for this signal

early_accumulation_signals
  └── early_signal_outcomes (signal_id → early_accumulation_signals.id, soft)

order_flow_signals     ← institutional flow imbalance detections
stocks_in_play         ← real-time stocks-in-play list (updated every 5 min)
signal_weight_calibration ← per-component weight tuning store
signal_learning        ← aggregated learning outcomes per strategy/sector
```

---

## Opportunity & Radar Pipeline

```
opportunity_stream          ← raw scored events from all opportunity sources
  └── aggregated into → opportunity_intelligence (one row per symbol per day)

opportunity_intelligence    ← enriched intelligence per symbol
  └── VIEW: radar_top_trades        — top 24h scores (used by calibration engine)
  └── VIEW: radar_stocks_in_play    — high rvol/gap symbols
  └── VIEW: radar_momentum          — momentum leaders
  └── VIEW: radar_news              — news-driven setups
  └── VIEW: radar_a_setups          — A+ graded setups
  └── VIEW: radar_market_summary    — market-wide metric snapshot

API endpoints consuming these views:
  /api/radar/today        → all radar sections via radarEngine.fetchRadarData()
  /api/radar/top-trades   → radar_top_trades (top 10 by score)
```

---

## Calibration & Outcome Loop

This is the closed-loop performance measurement pipeline.

```
radar_top_trades (VIEW on opportunity_intelligence)
        │
        ▼  every 15 min (signalCalibrationEngine)
signal_calibration_log
        │
        ├── every 30 min (calibrationPriceUpdater)
        │     reads: market_metrics (live_price)
        │     reads: daily_ohlc (daily high/low/close)
        │     writes: high/low/close columns, max_move_percent, min_move_percent, success
        │
        ├── every 15 min (signalOutcomeEngine → evaluate_signal_outcomes() SQL function)
        │     writes: signal_outcomes (closed signals after 1 day)
        │
        └── VIEW: strategy_performance_summary
              columns: strategy, total_signals, avg_move, avg_drawdown, win_rate_percent
              used by: /api/calibration/performance, CalibrationDashboard
```

---

## Trade Journal

```
broker_executions  ← raw broker fills
  └── (aggregated manually into) trades

trades
  └── trade_metadata   (1:1, CASCADE)
  └── trade_tags       (many per user, resolved via user_id + tag_name)

daily_reviews      ← end-of-day journal entries
```

---

## Screening & Universe

```
ticker_universe    ← canonical symbol catalogue
  └── (read by) screener, universe builder engine, market_metrics engine

discovered_symbols ← symbols surfaced during scanning
  └── (fed into) symbol_queue → ingestion pipeline

symbol_queue       ← pending ingestion queue

earnings_events
  └── earnings_market_reaction  (symbol, report_date)
  └── options_cache             (symbol, expiration — options data per earnings cycle)
```

---

## System & Admin

```
schema_migrations  ← applied migration version log
ingestion_state    ← singleton checkpoint for fullMarketIngestion
```

---

## Data Flow Summary

```
External Providers (FMP, Finnhub, RSS)
        │
        ▼
intraday_1m / daily_ohlc / news_events / news_articles
        │
        ▼
market_metrics (calc_market_metrics)
        │
        ├── strategy_signals (strategySignalEngine)
        │         │
        │         └── signal_outcomes ← evaluate_signal_outcomes() (every 15 min)
        │
        ├── opportunity_stream (opportunityRanker)
        │         │
        │         └── opportunity_intelligence (opportunityIntelligenceEngine)
        │                   │
        │                   ├── radar_top_trades (VIEW)
        │                   │         │
        │                   │         └── signal_calibration_log (signalCalibrationEngine, 15 min)
        │                   │                   │
        │                   │                   └── strategy_performance_summary (VIEW)
        │                   │
        │                   └── radar_* views → /api/radar/today
        │
        └── trade_catalysts (catalystEngine)
                  │
                  └── signal_narratives (signalNarrativeEngine)
```

---

## View-to-API Map

| View | API Endpoint | Frontend Consumer |
|------|-------------|-------------------|
| `radar_top_trades` | `GET /api/radar/top-trades` | `OpenRangeRadar` (Top Trades Today) |
| `radar_stocks_in_play` | `GET /api/radar/today` | `RadarSection` |
| `radar_momentum` | `GET /api/radar/today` | `RadarSection` |
| `radar_news` | `GET /api/radar/today` | `RadarSection` |
| `radar_a_setups` | `GET /api/radar/today` | `RadarSection` |
| `radar_market_summary` | `GET /api/radar/today` | `RadarDiagnostics` |
| `strategy_performance_summary` | `GET /api/calibration/performance` | `CalibrationDashboard` |
| `platform_watchdog_status` | `GET /api/system/watchdog` | `SystemWatchdog` |

---

## Table Ownership by Engine

| Engine | Writes To | Reads From |
|--------|-----------|------------|
| `fmpMarketIngestion` | `market_quotes`, `market_metrics` | `ticker_universe` |
| `calc_market_metrics` | `market_metrics` | `daily_ohlc`, `intraday_1m` |
| `strategySignalEngine` | `strategy_signals` | `market_metrics`, `ticker_universe` |
| `opportunityRanker` | `opportunity_stream` | `strategy_signals`, `market_metrics` |
| `opportunityIntelligenceEngine` | `opportunity_intelligence` | `opportunity_stream`, `market_metrics` |
| `signalCalibrationEngine` | `signal_calibration_log` | `radar_top_trades` (view) |
| `calibrationPriceUpdater` | `signal_calibration_log` (UPDATE) | `market_metrics`, `daily_ohlc` |
| `signalOutcomeEngine` | `signal_outcomes` (via SQL fn) | `signal_calibration_log` |
| `catalystEngine` | `trade_catalysts` | `news_articles`, `news_events` |
| `signalNarrativeEngine` | `signal_narratives` | `strategy_signals`, `trade_catalysts` |
| `earlyAccumulationEngine` | `early_accumulation_signals` | `market_metrics`, `intraday_1m` |
| `earlySignalOutcomeEngine` | `early_signal_outcomes` | `early_accumulation_signals`, `market_metrics` |
| `stocksInPlayEngine` | `stocks_in_play` | `market_metrics`, `opportunity_intelligence` |
| `orderFlowImbalanceEngine` | `order_flow_signals` | `intraday_1m`, `market_metrics` |
| `sectorMomentumEngine` | `sector_momentum` | `market_metrics`, `ticker_universe` |
| `signalLearningEngine` | `signal_learning` | `signal_performance`, `signal_outcomes` |
