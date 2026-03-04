# OpenRange Strategy Engine Report

Date: 2026-03-04

## Execution Summary

Manual run command:

- `cd server && node strategy/run_strategy.js`

Run result:

- symbols processed: **5121**
- setups detected: **219**
- runtime: **754 ms**

## Setup Distribution

- VWAP Reclaim: **191**
- Momentum Continuation: **28**
- Gap & Go: **0**

## Engine Rules Implemented

- Gap & Go:
  - `gap_percent > 3`
  - `relative_volume > 2`
  - `float_rotation > 0.05`
- VWAP Reclaim:
  - `relative_volume > 1.5`
  - `price > vwap`
- Momentum Continuation:
  - `relative_volume > 3`
  - `gap_percent > 2`

Score formula:

- `score = (relative_volume * 2) + gap_percent + (float_rotation * 10)`

Grade rules:

- `A` if score > 15
- `B` if score > 10
- `C` if score > 6

## API Verification

Verified JSON responses from:

- `/api/setups`
- `/api/setups/types`

## Monitoring Integration

System health now includes:

- `setups`
- `setup_count`

Endpoint verified:

- `/api/system/health`
