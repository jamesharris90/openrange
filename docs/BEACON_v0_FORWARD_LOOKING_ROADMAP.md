# Beacon v0 Forward-Looking Signal Roadmap

## Context

Current Beacon v0 (as of Phase 47) surfaces 5 leaderboards:
- top_rvol_today (volume already happened)
- top_gap_today (gap already happened at open)
- top_news_last_12h (news already broke)
- earnings_upcoming_within_3d (forward-looking — earnings ahead)
- earnings_reaction_last_3d (post-earnings reaction)

Product gap identified: Beacon mostly reports stocks that have already moved or had something happen. The more valuable product is also surfacing stocks that are about to move — pre-event positioning, coiled springs, building pressure.

This roadmap captures planned forward-looking signal categories.

## Categories

### 1. Pattern compression (Coiled Spring)

What: stocks where price is consolidating in a tight range with declining volume, signalling potential imminent breakout.

Status: Phase 48 (scaffold) → Phase 49 (wire in).

Data: existing intraday_1m + daily_ohlc. No new ingestion needed.

Implementation: leaderboard signal scoring symbols by:
- 5d ATR vs 20d ATR (compression)
- 5d average volume vs 20d average volume (volume drying up)
- Combined into single score

Top 100 ranked by combined compression score. Joins existing alignment engine. Strongest value when aligned with another signal (news building, earnings approaching, RVOL ticking up).

### 2. Event calendar proximity

What: stocks where a known scheduled event is approaching that historically moves the price.

Status: Deferred (requires new ingestion).

Sub-types:
- FDA approval / PDUFA dates
- Ex-dividend dates
- Lockup expiration dates
- Index rebalancing dates
- Investor day / capital markets day announcements
- Earnings (already covered for FMP)

Data: needs new FMP endpoints (or alternative sources) for FDA calendar, corporate actions calendar, index events. Requires ingestion pipeline + new tables + nightly refresh worker.

Estimated effort: 2-3 phases per sub-type. Probably implement FDA + ex-dividend first as highest-value.

### 3. Building pressure / pre-breakout

What: stocks where multiple subtle indicators suggest a move is being built toward without having broken yet.

Status: Deferred (mix of existing data + new ingestion).

Sub-types:
- Volume increasing day-over-day without major price move (accumulation)
- News count rising without price reaction yet (interest building)
- Unusual options activity (puts/calls volume spike)
- Dark pool activity unusually high

Data:
- Volume building: existing data ✓
- News count rising: existing data ✓
- Options activity: NOT ingested
- Dark pool: NOT ingested

Implementation: Volume building + news building can ship with existing data. Options/dark pool defer until ingestion built.

### 4. Macro / sector context

What: stocks positioned for moves based on broader market context — sector rotation, macro events, volatility regime.

Status: Deferred (requires new ingestion).

Sub-types:
- Sector ETF momentum / rotation (XLK, XLE, XLF, XLV, etc.)
- VIX regime context
- Macro calendar (FOMC, CPI, jobs reports, etc.)
- Stock outperforming/lagging its sector

Data: sector ETF symbols not currently tracked in daily_ohlc. VIX not ingested. Economic calendar not ingested.

Implementation: requires adding sector ETF symbols to daily_ohlc ingestion list (relatively small change), VIX ingestion (separate worker), macro calendar (new endpoint research).

## Phase sequencing recommendation

Implement in roughly this order:

1. **Phase 48-49**: Coiled Spring (existing data, immediate value)
2. **Phase 50**: Volume building + news building leaderboards (existing data)
3. **Phase 51-52**: Add sector ETFs to daily_ohlc ingestion + sector momentum signal
4. **Phase 53-54**: VIX ingestion + VIX context signal
5. **Phase 55-56**: FDA calendar ingestion + signal
6. **Phase 57-58**: Ex-dividend / corporate actions
7. **Phase 59+**: Macro calendar, options activity, dark pool

This roadmap is intentionally aspirational. Each phase is gated on shipping value before moving to the next.

## Open questions

- Should "forward-looking" picks be visually distinguished from "already moved" picks in the UI? (Different tab, different colour, different section?)
- How does alignment scoring change when forward-looking signals are weighted alongside backward-looking ones? Same weight, or higher?
- Does adding more signals risk diluting alignment quality? (More leaderboards = more chances for spurious overlap.) Need to validate with real data after each addition.
