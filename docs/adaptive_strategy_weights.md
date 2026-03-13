# Adaptive Strategy Weights (Phase E)

## Purpose
OpenRange Phase E adds adaptive strategy weighting so historically stronger strategies receive higher influence in current signal scoring.

## Data Source
Weights are computed from `signal_outcomes` and stored in `strategy_weights`.

## Weight Update Rule
Function: `update_strategy_weights()`

For each strategy:
- If sample size `< 20` signals: weight = `1.0` (neutral)
- Otherwise weight is bounded to `[0.5, 1.8]`
- Inputs used:
  - `avg(return_percent)`
  - win-rate (`returns > 0` / total)
  - sample confidence (`min(1.0, signals/100)`)

## Scoring Integration
During `opportunityIntelligenceEngine` processing:
- Strategy key is derived from `opportunity.strategy` or `trade_plan` prefix
- Weight is loaded from `strategy_weights`
- `weighted_score = clamp(base_score * weight, 0, 200)`
- Confidence is recomputed from weighted score

Fallback behavior:
- Missing/stale weight row => `weight = 1.0`

## Scheduler
`startEngines.js`
- Runs `updateStrategyWeights()` once on startup
- Runs every 30 minutes via cron: `*/30 * * * *`

## Monitoring
### Platform Health metrics
- `STRATEGY_WEIGHT_COUNT`
- `STRATEGY_WEIGHT_LAST_UPDATED`
- `STRATEGY_WEIGHT_MAX`
- `STRATEGY_WEIGHT_MIN`

### Watchdog alerts
- `WEIGHTS_NEVER_UPDATED`
- `WEIGHTS_STALE_6H`

## API
Route: `GET /api/calibration/strategy-weights`
- Source: `adaptive_strategy_rank`
- Returns current weight table ordered by strongest weight

## Manual Reset (safe)
To neutralize all strategy weights:

```sql
UPDATE strategy_weights
SET weight = 1.0,
    last_updated = NOW();
```

To force recalculation:

```sql
SELECT update_strategy_weights();
```
