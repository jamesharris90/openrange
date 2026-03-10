# EARLY_ACCUMULATION_ENGINE_REPORT

Date: 2026-03-09

## Scope Implemented

Experimental Early Accumulation / Order Flow Imbalance pipeline was added in an isolated path and does not touch main signal routing or main alert dispatch.

### New Engines

- `server/engines/earlyAccumulationEngine.js`
- `server/engines/earlySignalOutcomeEngine.js`

### Scheduler Integration

Updated `server/system/startEngines.js`:

- Early accumulation scan every 3 minutes: `*/3 * * * *`
- Outcome tracker every 30 minutes: `*/30 * * * *`

### API Integration

Updated `server/routes/intelligence.js`:

- `GET /api/intelligence/early-accumulation`

Returns latest 20 signals by `accumulation_score DESC`, joined with `early_signal_outcomes.max_move_percent`.

### Admin UI Integration

Updated `client/src/pages/StrategyEvaluationPage.jsx`:

Added **Experimental Signals** section showing:

- symbol
- pressure_level
- score (`accumulation_score`)
- liquidity_surge
- float_rotation
- max_move_percent

## Detection Logic

Metrics:

- `liquidity_surge = volume / avg_volume_30d`
- `float_rotation = volume / float_shares`
- `volume_delta = relative_volume * change_percent`

Pressure conditions:

- `relative_volume > 1.5`
- `liquidity_surge > 3`
- `float_rotation threshold semantics applied as percent-of-float > 0.3 while storing ratio`
- `ABS(change_percent) < 2`

Score:

- `accumulation_score = (liquidity_surge * 40) + (float_rotation * 30) + (relative_volume * 20)`

Pressure level:

- `score > 120 => extreme`
- `score > 80 => strong`
- `score > 50 => moderate`

Duplicate prevention:

- no new signal for same symbol within previous 2 hours.

Internal-only alert logging:

- `[EARLY_ACCUMULATION_ALERT] ...`
- no writes to main `signal_alerts` and no main alert trigger path used.

## Outcome Tracking Logic

Every 30 minutes, for each early signal (within 30 days), tracker updates:

- `price_1h`
- `price_4h`
- `price_1d`
- `price_5d`
- `price_30d`
- `max_move_percent`

Stored in `early_signal_outcomes` using upsert on `signal_id`.

## Validation Results

### Manual Engine Runs

- `runEarlyAccumulationEngine()`:
  - `scanned: 5753`
  - `detected: 19`
  - `inserted: 19`
  - `internalAlerts: 19`

- `runEarlySignalOutcomeEngine()`:
  - `tracked: 19`

### Internal Alert Log Evidence

Observed logs with `[EARLY_ACCUMULATION_ALERT]` for symbols including:

- `USEA`
- `VABK`
- `PFIS`
- `HYFT`
- `DMAA`

### Database Success Criteria

- `early_accumulation_signals` populated
- `early_signal_outcomes` populated

Aggregate metrics:

- `signals_detected: 19`
- `signals_tracked: 19`
- `average_move: 0.0000`
- `success_rate: 0.00`

Note: initial outcome values are expected to be near zero immediately after detection because checkpoint horizons have not elapsed yet.

### API Validation

Validated on updated server instance:

- `GET /api/intelligence/early-accumulation` -> `200`
- Response returned populated `items` list with score-ordered early accumulation signals.

## Isolation / Safety Confirmation

- Experimental pipeline writes only to:
  - `early_accumulation_signals`
  - `early_signal_outcomes`
- No integration into main signal router (`signalRouter`) or main alert endpoint/table flow.
- Strategy page fetch for experimental data is non-blocking to avoid impact on core strategy evaluation views.
