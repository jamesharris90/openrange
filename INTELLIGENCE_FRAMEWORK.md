# OpenRange Intelligence Framework

## Purpose

The Intelligence Framework centralizes scoring and filter definitions so Strategy, Catalyst, Scanner, and Frontend filter UX read from one source of truth.

## Registry Files

- `server/config/scoring_rules.json`
  - Strategy thresholds (`gap_go`, `vwap_reclaim`, `momentum_continuation`)
  - Grade thresholds (`A`, `B`, `C`)
  - Catalyst score map (`earnings`, `fda`, `analyst_upgrade`, `general_news`)

- `server/config/filter_registry.json`
  - Canonical filter list exposed to frontend and used for UI alignment.

## Server Loader

- `server/config/intelligenceConfig.js`
  - Loads registry JSON with safe defaults.
  - Uses in-memory cache for low overhead.
  - Exposes:
    - `getScoringRules()`
    - `getFilterRegistry()`
    - `getConfigLoadStatus()`

## Engine Integration

- Strategy engine (`server/strategy/strategy_engine.js`)
  - Reads thresholds and grading from `getScoringRules()`.
  - Core calculations remain unchanged; only thresholds moved to registry.

- Catalyst engine (`server/catalyst/catalyst_engine.js`)
  - Reads catalyst score values from `getScoringRules().catalyst_scores`.
  - Sentiment logic remains unchanged.

## API Endpoints

- `GET /api/filters`
  - Returns `filter_registry.json` payload.

- `GET /api/scoring-rules`
  - Returns `scoring_rules.json` payload.

## Frontend Alignment

- Advanced Screener
  - `client/src/components/screener/FilterSection.tsx` fetches `/api/filters` and shows registry-enabled filters.

- Screener V3
  - `client/src/pages/ScreenerV3.jsx` uses `useFilterRegistry` (`client/src/hooks/useFilterRegistry.js`) and limits available/active filter definitions to registry-enabled filters.

- Scoring Transparency UI
  - `client/src/pages/IntelligenceFrameworkPage.jsx`
  - Route: `/intelligence-framework`
  - Displays:
    - strategy scoring rules
    - grading
    - catalyst scoring
    - filter registry

## Monitoring

- `server/monitoring/systemHealth.js` now includes:
  - `scoring_config_loaded`
  - `filter_registry_loaded`

## Backward Compatibility / Fail-Safe

- If registry files are unavailable or invalid JSON, defaults are used.
- Existing engines continue running with prior behavior-equivalent defaults.
- Frontend registry loading falls back to built-in canonical filter set.
