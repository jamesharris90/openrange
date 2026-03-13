# OPENRANGE SIGNAL CALIBRATION ENGINE REPORT

## Schema Validation
- Snapshot: `reports/calibration_schema_snapshot.json`
- Required objects verified:
  - `opportunity_stream`
  - `opportunity_intelligence`
  - `radar_top_trades`
  - `signal_calibration_log`
- Result: OK

## Signals Tracked
- `signal_calibration_log` rows tracked: 12
- Source view: `radar_top_trades`
- Engine status: active

## Strategies Measured
- `VWAP Reclaim`
- Current live source data does not include `ORB` or `Momentum Continuation` trade plans in `radar_top_trades`.

## Current Win Rates
- `VWAP Reclaim`: 100.00%
- Average move: 26.02%
- Average drawdown: -4.55%

## Diagnostics
- `CALIBRATION_SIGNAL_COUNT`: 12
- `CALIBRATION_WIN_RATE`: 100.00
- `CALIBRATION_LAST_UPDATE`: 2026-03-12T22:46:58.495Z

## Engine Status
- `runSignalCalibrationEngine()`: implemented
- `runCalibrationPriceUpdater()`: implemented
- `/api/calibration/performance`: implemented
- `CalibrationDashboard`: implemented
- Build status: SUCCESS

## Validation Outcome
- Endpoint is live and returning real measured data.
- Validation is only partially complete against the requested expected output because upstream live signals currently produce only `VWAP Reclaim` strategies.
- No synthetic ORB or Momentum Continuation results were generated.