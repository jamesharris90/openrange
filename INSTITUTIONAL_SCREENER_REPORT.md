# Institutional Screener Implementation Report

## Summary
Implemented a new institutional-grade screener interface in the React client and wired it into application routing/navigation with no backend changes.

## Delivered Scope

### 1) New institutional screener page
- Added `client/src/pages/InstitutionalScreener.jsx`.
- Includes:
  - Terminal-style top control bar with ticker/company search.
  - Preset scanner selector.
  - Save/load filter workflows (localStorage).
  - Export CSV for the current result view.
  - Refresh action.
  - Column visibility and reorder controls.

### 2) Filter system
- Left sidebar supports two modes:
  - Adaptive Builder (`AND` / `OR` / `NOT`) with operator/value controls and chips.
  - Structured Filters with category tabs (Descriptive, Fundamental, Technical, Volume, Catalyst, Earnings, All).
- Apply/Clear controls supported in both modes.
- Adaptive fields include requested institutional dimensions (price/volume/float/RVOL/ATR/VWAP/RSI/catalyst/strategy/expected move/earnings, etc.).

### 3) Data integration
- Frontend-only aggregation from existing endpoints using `apiJSON`:
  - `/api/scanner`
  - `/api/setups`
  - `/api/catalysts`
  - `/api/metrics`
  - `/api/expected-move`
  - `/api/earnings`
  - `/api/filters`
  - `/api/system/report`
  - `/api/market-narrative`
- Merges records by symbol into a normalized row model.
- Graceful fallback when specific feeds are unavailable.

### 4) Results table
- Sortable institutional columns.
- Row hover + selected-row behavior.
- Sticky table header and keyboard row navigation.
- Column resizing support.
- In-table column visibility menu.
- Row-level quick-action hover overlay (watchlist/chart/intelligence/catalysts).
- Row sparklines beside ticker symbols.
- Cell heatmap styling for `Change %`, `Gap %`, `Relative Volume`, `Strategy Score`, and `Catalyst Score`.
- Optional heatmap mode toggle for stronger magnitude visualization.
- Virtualization path enabled for large sets (`>100` rows).
- Pagination footer with page-size options: `25`, `50`, `100`, `250`, `All`.
- Displays “Showing x–y of z”.

### 5) Intelligence panel
- Right-side context panel for selected ticker:
  - Mini TradingView chart.
  - Strategy setup and score.
  - Catalyst type and score.
  - Expected move.
  - Earnings date.

### 6) Routing and navigation
- Added route `/screener` in `client/src/App.jsx`.
- Updated Sidebar Scanner link to `/screener` in `client/src/components/layout/Sidebar.tsx`.
- Added legacy redirects:
  - `/screeners` → `/screener`
  - `/screener-v2` → `/screener`
  - `/screener-v3` → `/screener`

## Query Tree Architecture
- Added `client/src/utils/queryTree.js` to standardize filter logic into a reusable boolean query tree.
- Adaptive builder rows now compile into a normalized tree structure with nested `AND` / `OR` / `NOT` semantics.
- Structured filters also compile to the same tree format for cross-mode consistency.
- Row filtering executes against the query tree via a shared evaluator, reducing mode-specific branching.

## Alert Engine Preparation
- Saved filters now persist future-facing metadata:
  - `filter_name`
  - `query_tree`
  - `timestamp`
- Added a 300ms debounce guard around query-driven API refresh to prevent excessive request bursts.
- This prepares screener filters for direct reuse by future alert-rule execution without changing backend workers.

## Screener Completion Phase
- Added canonical filter registry: `client/src/config/filter_registry.json`.
- Registry now contains required filter metadata for:
  - `price`, `market_cap`, `float`, `volume`, `relative_volume`, `gap_percent`, `change_percent`, `atr_percent`, `expected_move`, `vwap_distance`, `rsi`, `sma20_distance`, `sma50_distance`, `sma200_distance`, `short_float`, `strategy_score`, `setup_type`, `catalyst_score`, `news_sentiment`, `earnings_date`.
- Each filter entry includes: `field`, `label`, `type`, `operators`, `database_column`.
- Added preset scanner library: `client/src/config/preset_scanners.json` with query-tree presets:
  - Top Gainers, Top Losers, Gap Up, Gap Down, High RVOL, Low Float Momentum, Pre-Market Movers, Post-Earnings Movers, High Expected Move, Catalyst + Technical, VWAP Reclaim, Momentum Continuation, Mean Reversion.
- Default screener behavior now auto-applies `High RVOL` on load.
- Adaptive Builder and Structured Filters now both source definitions from the same registry.
- Query trees now support backend translation (`AND`, `OR`, `NOT`) via `mapQueryTreeToBackend(...)` with field-to-database mapping from registry.
- API refresh is debounced at 300ms and now aborts prior in-flight requests when new filter changes apply.
- Layout constraints maintained: 320px filter sidebar, 320px intelligence panel, responsive center table with virtualization preserved.

## Final UX Enhancements
- Added reusable metric context bars via `client/src/components/ui/MetricBar.jsx`.
- Upgraded table cells for `Gap %`, `Change %`, `Relative Volume`, `Strategy Score`, and `Catalyst Score` to include horizontal bar indicators for faster visual scanning.
- Added `Sector Strength` column with combined sector name + mini strength bar display.
- Added screener summary strip via `client/src/components/screener/ScreenerStats.jsx` showing:
  - Results Found
  - Average RVOL
  - Average Gap
  - Average Strategy Score
- Added dev-only QA visibility panel via `client/src/components/debug/QueryDebugPanel.jsx` (collapsible, bottom-right):
  - Active `query_tree`
  - Backend query mapping output
- Added row change detection highlight for new tickers entering result set.
- Maintained institutional alignment rules:
  - Numeric columns right-aligned
  - Ticker and sector context left-aligned
- Performance guardrails verified in current implementation:
  - Virtualization active for large result sets
  - Filter debounce at 300ms
  - `AbortController` cancellation for pending API requests

## New/Updated Files

### New
- `client/src/pages/InstitutionalScreener.jsx`
- `client/src/components/screener/PresetSelector.jsx`
- `client/src/components/screener/ColumnSelector.jsx`
- `client/src/components/screener/FilterBuilder.jsx`
- `client/src/components/screener/StructuredFilters.jsx`
- `client/src/components/screener/FilterSidebar.jsx`
- `client/src/components/screener/ScreenerTable.jsx`
- `client/src/components/charts/SparklineMini.jsx`
- `client/src/utils/queryTree.js`
- `client/src/config/filter_registry.json`
- `client/src/config/preset_scanners.json`
- `client/src/components/ui/MetricBar.jsx`
- `client/src/components/screener/ScreenerStats.jsx`
- `client/src/components/debug/QueryDebugPanel.jsx`

### Updated
- `client/src/App.jsx`
- `client/src/components/layout/Sidebar.tsx`

## Verification
- Build command run:
  - `cd client && npm run build`
- Result: **PASS** (production build successful).

## Constraints Compliance
- No backend engine or DB modifications made.
- Uses shared API wrapper (`apiJSON`) for all data requests.
