# OpenRange Calibration Engine

## Purpose

The Calibration Engine closes the feedback loop between the Radar Engine's
trade ideas and measured real-world outcomes.  Every signal is logged,
price-enriched across three time windows, and evaluated to produce a
continuously updated win-rate that feeds back into strategy scoring.

---

## Architecture

```
Radar Engine (every 5 min)
  │  writes → radar_market_summary
  │
  ▼
Signal Calibration Engine (every 15 min)
  │  reads radar_top_trades view
  │  writes → signal_calibration_log (entry_price, strategy, setup_grade)
  │
  ▼
Calibration Price Updater (every 30 min)
  │  fills high/low/close for 1h, 4h, 1d windows
  │  derives max_move_percent, min_move_percent
  │
  ▼
Signal Outcome Engine (every 15 min)
  │  calls evaluate_signal_outcomes() SQL function
  │  sets signal_calibration_log.success = TRUE | FALSE
  │
  ▼
Calibration API (/api/calibration/*)
  │  serves live view data to frontend
  │
  ▼
Calibration Dashboard (CalibrationDashboard.jsx)
     renders win rate, strategy breakdown, grade distribution
```

---

## Source Files

| File | Role |
|------|------|
| `server/engines/signalCalibrationEngine.js` | Stage 1: log new signals from radar |
| `server/engines/calibrationPriceUpdater.js` | Stage 2: backfill price windows |
| `server/engines/signalOutcomeEngine.js` | Stage 3: evaluate outcomes via SQL function |
| `server/routes/calibration.js` | API – `/performance` endpoint |
| `server/routes/calibrationRoutes.js` | API – extended endpoints (4 routes) |
| `server/system/startEngines.js` | Cron wiring for all three engines |
| `server/system/platformHealthExtended.js` | Health metrics (CALIBRATION_*, SIGNAL_*) |
| `server/routes/systemWatchdog.js` | Watchdog with calibration alert checks |
| `client/src/components/calibration/CalibrationDashboard.jsx` | Frontend widget |
| `server/types/database.ts` | TypeScript type definitions |
| `database/schema_snapshot.sql` | Tables, views, indexes, functions (calibration) |
| `database/calibration_pipeline.md` | Pipeline stage map and table ownership |

---

## API Endpoints

All endpoints require a valid JWT (`Authorization: Bearer <token>`) or `x-api-key`.

### `GET /api/calibration/performance`
Returns `strategy_performance_summary` rows.

**Response shape:**
```json
{
  "ok": true,
  "items": [
    {
      "strategy": "VWAP Reclaim",
      "total_signals": 42,
      "wins": 30,
      "losses": 12,
      "win_rate_pct": "71.43",
      "avg_move_pct": "2.10",
      "avg_drawdown_pct": "-0.80",
      "last_signal_at": "2025-07-01T14:30:00Z"
    }
  ]
}
```

### `GET /api/calibration/strategy-performance`
Same as `/performance` with explicit `ORDER BY win_rate_pct DESC`.

### `GET /api/calibration/top-signals`
Returns the current top 20 scored signals from `radar_top_trades`.

**Response shape:**
```json
{
  "ok": true,
  "items": [
    {
      "symbol": "NVDA",
      "score": 92.5,
      "trade_plan": "VWAP Reclaim",
      "entry_zone_low": 450.00,
      "entry_zone_high": 452.50,
      "target_1": 460.00,
      "stop_loss": 447.00,
      "generated_at": "2025-07-01T14:00:00Z"
    }
  ]
}
```

### `GET /api/calibration/health`
Returns aggregate health metrics from `signal_calibration_log`.

**Response shape:**
```json
{
  "ok": true,
  "health": {
    "total_logged": 250,
    "evaluated": 180,
    "pending_evaluation": 70,
    "total_wins": 125,
    "overall_win_rate_pct": "69.44",
    "last_signal_at": "2025-07-01T14:30:00Z",
    "strategy_count": 3,
    "symbol_count": 88
  }
}
```

### `GET /api/calibration/grade-distribution`
Returns win-rate breakdown by `setup_grade` (A / B / C).

**Response shape:**
```json
{
  "ok": true,
  "items": [
    { "setup_grade": "A", "total": 80, "wins": 62, "win_rate_pct": "77.50" },
    { "setup_grade": "B", "total": 120, "wins": 75, "win_rate_pct": "62.50" },
    { "setup_grade": "C", "total": 50, "wins": 20, "win_rate_pct": "40.00" }
  ]
}
```

---

## Database Schema

See [`database/schema_snapshot.sql`](../database/schema_snapshot.sql) for the
full DDL including tables, views, indexes, and the `evaluate_signal_outcomes()`
function.

Key tables:

| Table | Written by | Outcome |
|-------|-----------|---------|
| `signal_calibration_log` | signalCalibrationEngine | main calibration store |
| `signal_registry` | reserved | future classifier |
| `signal_outcomes` | evaluate_signal_outcomes() | one-to-one outcome record |

---

## Outcome Logic

`evaluate_signal_outcomes()` runs `UPDATE signal_calibration_log` and marks
`success = TRUE` when the 1-day close exceeded the entry price by at least
**0.5%** (`close_1d > entry_price * 1.005`).

Rows remain `success = NULL` until `close_1d` is populated by the price updater.

---

## Watchdog Alert Conditions

`GET /api/system/watchdog` now includes a `calibration` block.  Two alert codes
can appear in `calibration.alerts`:

| Code | Meaning | Threshold |
|------|---------|-----------|
| `NO_SIGNALS_2H` | No new signal logged in 2 hours | `seconds_since_last_signal > 7200` |
| `OUTCOMES_NOT_UPDATING` | Signals accumulating but no outcomes being set | `evaluated == 0 && pending > 10` |

---

## Platform Health Metrics

`platformHealthExtended()` exports these calibration keys:

| Key | Description |
|-----|-------------|
| `CALIBRATION_SIGNAL_COUNT` | Total rows in `signal_calibration_log` |
| `CALIBRATION_WIN_RATE` | Win rate % over last 500 evaluated signals |
| `CALIBRATION_LAST_UPDATE` | Timestamp of most recent log entry |
| `SIGNAL_REGISTRY_COUNT` | Total rows in `signal_registry` |
| `SIGNAL_OUTCOMES_COUNT` | Total rows in `signal_outcomes` |
| `STRATEGY_COUNT` | Number of distinct strategies in `signal_calibration_log` |

---

## Extending the Engine

### Adding a new strategy

1. Add a mapping branch in `normalizeStrategy()` in `signalCalibrationEngine.js`.
2. Add the strategy label to `SignalCalibrationLogRow.strategy` in `server/types/database.ts`.
3. If the outcome threshold should differ per strategy, extend `evaluate_signal_outcomes()` in the migration.

### Adding a new time window (e.g., 8-hour)

1. Add `high_8h`, `low_8h`, `close_8h` columns via a migration in `server/users/migrations/`.
2. Add the backfill query in `calibrationPriceUpdater.js`.
3. Update `schema_snapshot.sql` and this doc.

---

## Running Locally

```bash
cd server && npm start
```

Engines start automatically via `startEngines.js`.  
To see calibration logs, filter by prefix:

```bash
grep "\[CALIBRATION ENGINE\]\|\[SIGNAL ENGINE\]\|\[PRICE UPDATER\]" server/logs/app.log
```
