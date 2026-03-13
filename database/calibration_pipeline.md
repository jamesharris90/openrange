# OpenRange Calibration Pipeline

## Overview

The calibration pipeline closes the loop between signal detection and measured
outcome.  Every trade idea produced by the Radar Engine is logged, tracked
through up to three price windows, and evaluated to produce a win-rate metric
that feeds back into strategy scoring.

---

## Stage Map

```
┌─────────────────────────────────────────────────────────────────────┐
│  RADAR ENGINE  (radarEngine.js — every 5 min)                       │
│  Aggregates market_metrics + daily_ohlc → radar_market_summary      │
└───────────────────────────────────┬─────────────────────────────────┘
                                    │ scored rows
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  SIGNAL CALIBRATION ENGINE  (signalCalibrationEngine.js — 15 min)   │
│  Reads radar_top_trades view → inserts into signal_calibration_log  │
│  Normalises trade_plan → strategy label                             │
└───────────────────────────────────┬─────────────────────────────────┘
                                    │ new log rows
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  CALIBRATION PRICE UPDATER  (calibrationPriceUpdater.js — 30 min)   │
│  Fills high/low/close for 1h, 4h, 1d windows                       │
│  Derives max_move_percent, min_move_percent                         │
└───────────────────────────────────┬─────────────────────────────────┘
                                    │ price-enriched rows
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  SIGNAL OUTCOME ENGINE  (signalOutcomeEngine.js — 15 min)           │
│  Calls evaluate_signal_outcomes() SQL function                      │
│  Sets signal_calibration_log.success = TRUE / FALSE                 │
└───────────────────────────────────┬─────────────────────────────────┘
                                    │ evaluated rows
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  CALIBRATION VIEWS  (Postgres materialised/live views)              │
│  strategy_performance_summary  — win rate by strategy               │
│  signal_grade_distribution     — win rate by setup grade            │
│  calibration_health            — aggregate health metrics           │
│  radar_top_trades              — current top-scored signals          │
└───────────────────────────────────┬─────────────────────────────────┘
                                    │ JSON responses
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  CALIBRATION API  (server/routes/calibration.js +                   │
│                    server/routes/calibrationRoutes.js)              │
│  GET /api/calibration/performance                                   │
│  GET /api/calibration/strategy-performance                          │
│  GET /api/calibration/top-signals                                   │
│  GET /api/calibration/health                                        │
│  GET /api/calibration/grade-distribution                            │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Table Ownership

| Table / View                   | Written by                       | Read by                              |
|-------------------------------|----------------------------------|--------------------------------------|
| `radar_market_summary`        | radarEngine.js                   | signalCalibrationEngine.js, frontend |
| `signal_calibration_log`      | signalCalibrationEngine.js       | calibrationPriceUpdater.js, outcomeEngine, API |
| `signal_registry`             | (reserved for future classifier) | signalOutcomeEngine.js               |
| `signal_outcomes`             | evaluate_signal_outcomes()       | API, platformHealth                  |
| `strategy_performance_summary`| Postgres view (live)             | GET /api/calibration/performance     |
| `signal_grade_distribution`   | Postgres view (live)             | GET /api/calibration/grade-distribution |
| `calibration_health`          | Postgres view (live)             | GET /api/calibration/health          |
| `radar_top_trades`            | Postgres view (live)             | GET /api/calibration/top-signals     |

---

## Scheduler Cadences

| Engine                    | Cron Interval | In-flight Guard                      |
|--------------------------|---------------|--------------------------------------|
| radarEngine               | every 5 min   | `global.radarEngineStarted`          |
| signalCalibrationEngine   | every 15 min  | `signalCalibrationInFlight`          |
| calibrationPriceUpdater   | every 30 min  | `calibrationPriceUpdateInFlight`     |
| signalOutcomeEngine       | every 15 min  | `signalOutcomeEngineInFlight`        |

---

## Outcome Logic

`evaluate_signal_outcomes()` marks `success = TRUE` when:
```sql
close_1d > entry_price * 1.005   -- at least 0.5% above entry by end of day
```

Rows remain `NULL` until `close_1d` is populated by the price updater.

---

## Adding a New Strategy

1. Add a mapping branch in `normalizeStrategy()` inside `signalCalibrationEngine.js`.
2. Update `strategy_performance_summary` view if aggregation logic needs to change.
3. Add the new strategy label to `SignalCalibrationLogRow.strategy` in `server/types/database.ts`.
4. Document the strategy's outcome threshold in this file.
