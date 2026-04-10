# Research UI Build Report

Date: 2026-04-04

## Scope

This report covers the last four prompt-driven build phases on the research experience, focused on earnings pattern visualization and the overview chart surface.

## Phase 1: Earnings Pattern Visual System

### What changed

- Added backend earnings-pattern generation in `server/engines/earningsEdgeEngine.js`.
- Exposed the new pattern array through `server/routes/research.js` as `earnings.pattern`.
- Updated frontend research contracts in `trading-os/src/lib/api/research.ts`.
- Created `trading-os/src/components/research/EarningsPatternBar.jsx`.
- Integrated the earnings pattern visual into the live research tabs.

### How it was built

- Historical earnings rows from `earnings_history` were normalized into pattern entries with:
  - `date`
  - `beat`
  - `move`
  - `type`
- Classification rules were implemented directly from real EPS surprise and post-earnings move:
  - Beat + Up = `STRONG_BEAT`
  - Beat + Down = `FADE`
  - Miss + Down = `STRONG_MISS`
  - Miss + Up = `SQUEEZE`
- The frontend consumed only the live `/api/research/:symbol/full` payload so the visual stayed on the production path.
- Validation was run against AAPL, TSLA, and NVDA to confirm the pattern output matched actual earnings history.

## Phase 2: Beat/Miss Layout And Alignment Fix

### What changed

- Reworked `EarningsPatternBar.jsx` from a simple block strip into a chart-like beat/miss visual matching the requested layout direction.
- Added title, summary sentence, quarter labels, grid lines, axis, legend, and marker styling.
- Corrected marker placement so beat/miss points align to the real surprise values on the axis.

### How it was built

- The visual was converted from a decorative row into a plotted chart with a dedicated chart coordinate system.
- Marker positions, axis labels, and grid lines were moved onto the same plot-height math so data values and visuals used one scale.
- The fix removed mixed layout-space versus chart-space positioning, which was the cause of the original misalignment.

## Phase 3: Overview Cleanup And Interactive Chart Modes

### What changed

- Removed the earnings beat/miss visual from the Overview tab while keeping it on the Earnings tab.
- Upgraded `trading-os/src/components/research/ResearchChartPanel.jsx` from a static chart to an interactive chart.
- Added `Sparkline` and `Candle` mode toggles.
- Added hover-driven OHLC inspection using live `/api/v5/chart` data.

### How it was built

- The overview and earnings tabs were separated by responsibility:
  - Overview became the decision and tape surface.
  - Earnings retained the reaction-history visual.
- The chart component was rebuilt around normalized OHLC points from the V5 chart feed.
- Hover state was tied to the active bar so the chart could show time and OHLC values without changing the backend payload.
- Live endpoint checks confirmed the V5 feed returns `time`, `open`, `high`, `low`, `close`, and `volume`, which made true candle rendering possible.

## Phase 4: Overview Chart Refinement, Catalyst, And Company Information

### What changed

- Replaced the top cursor summary on the overview chart with:
  - 52W Low
  - 52W High
  - Average Weekly Move
  - Latest Volume 1D
- Moved the active date and OHLC readout into a bright white header row along the top of the chart card.
- Improved candle readability by aggregating dense intraday series into fewer, wider rendered candles.
- Removed the `Mode` tile and replaced it with more useful live chart stats:
  - Avg Bar Range
  - Bars Rendered
- Removed `Trade Read` from Overview.
- Removed `Earnings Edge` from Overview and kept earnings-specific intelligence on the Earnings page.
- Added a `Catalyst` panel for top symbol-linked headlines.
- Added a `Company Information` panel backed by the live research profile payload.

### How it was built

- `ResearchChartPanel.jsx` now computes secondary stats from daily candles:
  - trailing 52-week high/low
  - average 5-trading-day move over the last 60 trading days
  - latest daily volume
- The chart header was moved out of the plot overlay and into a dedicated top strip for cleaner readability.
- Candle mode was made usable by compressing oversized OHLC series into a bounded number of rendered candles while preserving open, high, low, close, volume, and time across each bucket.
- `CatalystPanel.jsx` was added and wired to `/api/news`, with normalization for the active backend response shape `{ success, count, data }`.
- `CompanyProfileCard.jsx` was added and uses the `profile` block already returned by `/api/research/:symbol/full`, including FMP-backed `description`, `sector`, `industry`, `exchange`, `country`, and `website` when available.
- `OverviewTab.jsx` was simplified so the page is now organized as:
  - left column: chart, company information
  - right column: catalyst headlines

## Validation

- Static validation showed no component errors in:
  - `ResearchChartPanel.jsx`
  - `OverviewTab.jsx`
  - `CompanyProfileCard.jsx`
  - `CatalystPanel.jsx`
- Live backend checks confirmed:
  - `/api/research/VIR/full` returns a populated company profile with description
  - `/api/v5/chart?symbol=VIR&interval=1day` returns valid OHLC candles
  - `/api/news?symbol=VIR&limit=5` returns a wrapped news payload that the new catalyst panel now normalizes correctly

## Current Outcome

- Earnings reaction intelligence is now separated cleanly onto the Earnings page.
- The Overview page is more useful as a trading surface: better chart readability, useful tape stats, company context, and headline catalysts.
- The layout is now ready for a later GPT-5.4 narrative layer without needing another structural rewrite.