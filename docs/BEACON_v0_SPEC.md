# Beacon v0 Specification

**Version:** 0.1 (draft)
**Author:** James Harris + Claude (Anthropic)
**Date:** 2026-04-24
**Status:** Product spec — not yet implemented

-----

## 1. Product Vision

### 1.1 One-Sentence Definition

**Beacon is a signal-alignment scanner that finds stocks where the preconditions for significant price movement are aligned, explains its reasoning, and lets the trader make the call.**

### 1.2 What Beacon IS

- A daily pattern scanner across a configurable universe of US equities
- A transparent reasoning engine — every pick shows the signals that fired and why
- A pre-market research tool that produces a ranked watchlist before the trading day
- A system that earns trust through rigorous qualification, not accuracy claims
- A tool that respects the trader’s final judgment

### 1.3 What Beacon IS NOT

- NOT a trading bot — it never executes trades
- NOT a recommendation engine — it does not say “BUY” or “AVOID”
- NOT a predictive system — it does not claim stocks will move X% or hit target prices
- NOT a replacement for trader judgment — the user always decides
- NOT a financial advisor — no legal advice is given, only pattern observation

### 1.4 Target User

- Primary: OpenRange Terminal paying customers at £49/£99 tiers
- Initial user: James (dogfooding), validating before wider release
- Secondary (v1+): Traders who want systematic pre-market scanning with transparent reasoning

### 1.5 Core Principles

1. **Trader always has the last word.** Beacon surfaces, explains, and qualifies. The user decides to act or not.
1. **Transparency over accuracy claims.** Beacon never claims to predict the future. It shows its work.
1. **Rigor in qualification.** Every pick must pass quality gates before surfacing.
1. **Flexible count.** Some days have many setups, some have none. Beacon reflects reality, not daily quotas.
1. **Explain, don’t advise.** Output describes patterns and conditions, not actions.
1. **Let the data decide direction.** Beacon flags both long and short setups based on signal alignment, not user preference.

-----

## Scoring Discipline: One Trusted Score, Not Many

### The principle

- Until Beacon v0's unified scorer ships, no surface displays a score or verdict.
- A platform that says "here's the data" is more trustworthy than one that fakes intelligence with broken scoring.
- All surfaces share one scoring engine when scoring returns.

### Surface-by-surface state during the rebuild

**Research page:**

- Removed: Decision card (AVOID/score/confidence/R:R/trade plan).
- Kept: ticker, price, sector, industry, exchange, classification, company description, news flow, charts, earnings calendar.
- Added: optional "Why this matters" reasoning derived from real signals (catalyst presence, earnings proximity, news density) — descriptive, not prescriptive.

**Screener page:**

- Removed: score column, score-based filtering.
- Kept: all data filters (price, volume, market cap, sector, exchange, etc.).
- Added: note that score-based filtering returns with Beacon v0.

**Beacon page:**

- During rebuild: page hidden from navigation OR replaced with the v0 build page.
- No "coming soon" placeholder — site is not public, no audience to manage.
- Returns at v0 ship with unified scorer.

### Migration phases

1. Phase 36 (today): Update BEACON_v0_SPEC.md with this discipline section [done by this commit].
2. Phase 37: Remove Decision card from Research page; preserve all data panels.
3. Phase 38: Remove score column and score filters from Screener.
4. Phase 39: Hide Beacon route from main navigation; keep route accessible via direct URL for development.
5. Phase 40+: Begin Beacon v0 unified scorer implementation per existing spec sections.
6. Phase v0 ship: Restore scoring across Beacon, Research (as supporting context), and Screener (as filter).

### Why this matters commercially

- Target users (£49/£99 paying customers) will judge OpenRange on signal quality.
- A wrong AVOID verdict costs more trust than an absent verdict.
- Honest empty states beat misleading filled ones.
- Building the unified scorer once is faster than maintaining three divergent scoring paths.

### What this is NOT

- Not a launch delay — site was never going to launch with broken scoring.
- Not a feature removal — it's removing facade, keeping foundation.
- Not a permanent state — Beacon v0 ship restores all three surfaces with trusted scoring.

-----

## 2. System Architecture

### 2.1 Layer Model

```
┌─────────────────────────────────────────────────────────────┐
│ OUTPUT LAYER                                                │
│ - Top Conviction view (deep analysis, 0-3 picks)            │
│ - Watchlist view (scannable list, 0-15 picks)               │
│ - Pre-market delivery via web dashboard                     │
└─────────────────────────────────────────────────────────────┘
                            ▲
┌─────────────────────────────────────────────────────────────┐
│ CATEGORIZATION LAYER                                        │
│ - Assigns a recognizable pattern name to each pick          │
│ - "Earnings Reaction", "News Momentum", "Coiled Spring",    │
│   "Unusual Volume", "Gap Continuation", etc.                │
└─────────────────────────────────────────────────────────────┘
                            ▲
┌─────────────────────────────────────────────────────────────┐
│ QUALIFICATION LAYER                                         │
│ - Scores signal quality (not just presence)                 │
│ - Resolves contradictions between signals                   │
│ - Applies quality gates (data completeness, liquidity)      │
│ - Produces confidence qualification per pick                │
└─────────────────────────────────────────────────────────────┘
                            ▲
┌─────────────────────────────────────────────────────────────┐
│ ALIGNMENT LAYER                                             │
│ - Evaluates when multiple signals align on same symbol      │
│ - Computes alignment score across signal categories         │
│ - Determines direction (long/short bias) from signals       │
└─────────────────────────────────────────────────────────────┘
                            ▲
┌─────────────────────────────────────────────────────────────┐
│ SIGNAL DETECTION LAYER                                      │
│ - ~30 individual signals across 5 categories                │
│ - Each signal computed independently for each symbol        │
│ - See separate Signal Catalog document for details          │
└─────────────────────────────────────────────────────────────┘
                            ▲
┌─────────────────────────────────────────────────────────────┐
│ DATA LAYER (existing)                                       │
│ - market_quotes, market_metrics                             │
│ - daily_candles, intraday_candles                           │
│ - news_articles (multi-feed)                                │
│ - earnings_events, earnings_history (canonical)             │
│ - ticker_classifications, company_profiles                  │
│ - data_coverage                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Execution Schedule (v0)

- **Nightly batch run:** 21:30 UTC (22:30 UK) — existing `beacon-nightly-worker` cron
- **Output availability:** Before 07:00 UK next morning for trader review
- **Refresh cadence:** Once per trading day
- **Intraday updates:** NOT in v0 (deferred to v2)

### 2.3 Universe Scope (v0)

**Fixed for v0, user-configurable in future versions.**

Initial universe based on James’s trading style:

- US equities (NYSE, NASDAQ, AMEX)
- Price range: $2 - $50
- Minimum daily volume: 500,000 shares (configurable)
- Minimum market cap: $50M (excludes micro-caps)
- Common stock only (no ADRs, ETFs, SPACs in v0)

Exclusions:

- OTC securities
- Leveraged/inverse ETFs
- Symbols flagged as suspended or halted

**Rationale:** A tight universe produces higher-quality scanning. Expansion happens when per-user preferences are added.

### 2.4 Direction Handling

Beacon flags both LONG and SHORT setups based on signal alignment:

- If bullish signals dominate → direction: long
- If bearish signals dominate → direction: short
- If signals contradict or are mixed → disqualified from output

The signal catalog defines which signals are direction-agnostic and which have a directional bias.

-----

## 3. Output Specification

### 3.1 Top Conviction View

**Purpose:** Deep analysis for the 0-3 highest-confidence picks of the day.

**Per-pick output:**

|Field                         |Description                                          |
|------------------------------|-----------------------------------------------------|
|Symbol                        |Ticker                                               |
|Company Name                  |Full company name                                    |
|Current Price                 |Last close                                           |
|Direction                     |long / short                                         |
|Pattern Category              |e.g. “Earnings Reaction — Day After Beat”            |
|Alignment Score               |0-100 composite signal alignment                     |
|Confidence Qualification      |High / Medium / Low with reasoning                   |
|Setup Narrative               |3-5 sentence plain English story of what’s happening |
|Signals That Fired            |List of specific signals contributing to this pick   |
|Signals Checked But Not Firing|Transparency — what didn’t support the setup         |
|Contradicting Signals         |Any tensions in the signal picture                   |
|Key Price Levels              |Support, resistance, prior range, 52-week context    |
|Related Context               |Sector performance, market regime at time of scan    |
|What To Watch For             |Confirmation conditions the trader should monitor    |
|Disqualifying Conditions      |What would invalidate this setup                     |
|Historical Context (v1+)      |“Similar setups resolved X way Y% in last 30-60 days”|
|Legal Disclaimer              |Not investment advice, pattern observation only      |

### 3.2 Watchlist View

**Purpose:** Scannable list of additional candidates (0-15 picks).

**Per-pick output (compact):**

|Field           |Description                  |
|----------------|-----------------------------|
|Symbol          |Ticker                       |
|Pattern Category|Short pattern name           |
|Direction       |long / short                 |
|Alignment Score |0-100                        |
|Top 3 Signals   |Brief signal list            |
|Link to Detail  |Drills down to full pick view|

### 3.3 Output Presentation Rules

1. **Every pick must have reasoning.** No pick surfaces without explanation.
1. **No verdicts.** Never use “BUY”, “AVOID”, “WATCH” as outputs. Use pattern names and alignment context.
1. **Data completeness required.** If critical data is missing, pick is disqualified (never produced) rather than shown with degraded info.
1. **Disclaimers visible on every output.** “Pattern observation, not investment advice.”
1. **Timestamps everywhere.** User sees when scan ran, when each signal was last updated.

### 3.4 Delivery Channels (v0)

- Web dashboard at openrangetrading.co.uk (Beacon page)
- NO email in v0
- NO Telegram in v0
- NO push notifications in v0

(v1+ may add email digest; v2+ may add Telegram and real-time alerts)

-----

## 4. Data Inputs

### 4.1 Existing Data Beacon Can Read

- `market_quotes` — price, volume, relative volume, session awareness
- `market_metrics` — VWAP, RSI, ATR, moving averages
- `daily_candles` — OHLCV history for trend, range, breakout analysis
- `intraday_candles` — intraday OHLCV for recent session behavior
- `news_articles` — multi-source news with provider, catalyst classification, published_at
- `earnings_events` — scheduled and recent earnings with canonical fields
- `earnings_history` — historical earnings outcomes for context
- `ticker_classifications` — instrument type, liquidity class
- `company_profiles` — sector, industry, market cap, exchange
- `data_coverage` — freshness and completeness indicators

### 4.2 Data Gaps (Need Attention)

- **Pre-market price data:** Needed for earnings gap detection. May require FMP pre-market endpoint integration.
- **Analyst estimate trends:** Needed for “priced in” detection. FMP provides estimate history.
- **Sector ETF performance:** Needed for sector momentum context. Could derive from tracked sector ETF prices.
- **Market regime:** SPY/QQQ context. Already trackable from existing candle data.
- **Options implied move (v1+):** Needed for earnings setup sophistication. Not available in current FMP tier.

### 4.3 Data Quality Requirements

Each signal requires specific data freshness:

- Price/volume: < 1 trading day old
- News: < 24 hours for “recent news” signals, < 7 days for context
- Earnings: Must include canonical fields (event_state, earnings_outcome, has_actuals, surprise_pct)
- Technical indicators: Computed from candles no older than previous close

If data doesn’t meet freshness requirement, the signal is marked UNKNOWN, not false. Unknown signals can disqualify picks at the qualification layer.

-----

## 5. Qualification Model

### 5.1 Confidence Qualification

Not a single number. A structured assessment:

**High Confidence:**

- 4+ signals firing across at least 3 categories
- No contradicting signals firing
- All data inputs fresh and complete
- Historical pattern match (when v1 historical layer is active)

**Medium Confidence:**

- 2-3 signals firing across 2+ categories
- No strongly contradicting signals
- Core data inputs fresh, some secondary data may be stale
- OR: Strong signals with 1 minor contradiction

**Low Confidence:**

- Single strong signal with supporting context
- OR: Multiple signals firing but with data freshness concerns
- OR: Pattern present but with contradictions

**Disqualified (not shown):**

- Core data missing or stale
- Contradicting signals with no resolution
- Liquidity below minimum threshold
- Failed quality gates

### 5.2 Alignment Score (0-100)

Computed from:

- Number of signals firing (weighted by signal quality)
- Signal diversity across categories (price, fundamental, news, market, liquidity)
- Absence of contradictions
- Data completeness
- Pattern match strength

Alignment score is displayed for transparency. It does NOT determine pick eligibility alone — qualification does.

### 5.3 Quality Gates

A pick must pass ALL of the following to be shown:

1. **Liquidity gate:** Average daily volume > 500k shares
1. **Data freshness gate:** Critical inputs within required freshness windows
1. **Contradiction gate:** No major contradicting signals firing
1. **Pattern match gate:** Signal combination matches at least one defined pattern
1. **Universe gate:** Symbol passes user’s universe filters (price range, sector, etc.)
1. **Tradability gate:** Symbol is actively tradeable (not halted, not delisted)

-----

## 6. Pattern Library (v0 scope)

v0 recognizes 4 named patterns. Each pattern has its own required signal combination.

### 6.1 Earnings Reaction

**Ingredients required:**

- Recent earnings event (event_state = REPORTED, within last 2 trading days)
- Meaningful surprise (|eps_surprise_pct| > 5% OR |revenue_surprise_pct| > 3%)
- Price action aligned with surprise direction (gap up on beat, gap down on miss)
- Volume confirmation (relative volume > 1.5)
- Not contradicted by “priced-in” signals (pre-event run-up analysis)

**Direction:** Long for positive surprises with price confirmation; short for negative surprises with price confirmation.

### 6.2 News Momentum / Catalyst-Driven Move

**Ingredients required:**

- Recent news (within 24 hours) from quality sources
- News density (multiple items, not single report)
- Volume expansion
- Price reaction consistent with news direction
- Not fading (sustained move, not 5-minute spike)

**Direction:** Determined by news sentiment and price action alignment.

### 6.3 Unusual Volume with News

**Ingredients required:**

- Relative volume > 2.0 (stricter than general news momentum)
- Recent news present (within 72 hours)
- Price movement supporting the volume
- Not a known scheduled event (earnings already handled separately)

**Direction:** Determined by price direction during the volume expansion.

### 6.4 Coiled Spring / Consolidation Pre-Catalyst

**Ingredients required:**

- Tight consolidation (low ATR% of price over recent period)
- Declining volume during consolidation (supply being absorbed)
- Price near a key level (range high, prior breakout level)
- Upcoming catalyst (earnings within 3 trading days, OR recent news density)
- Market context supportive

**Direction:** Typically long (coiled springs for shorts exist but are less common).

### 6.5 Pattern Library Extension (Future)

Additional patterns can be added without changing architecture:

- Gap and Go continuation
- Sector momentum follow-through
- Breakout from long-term base
- Earnings drift (days 2-5 post-event)
- ORB with catalyst (deferred to v2 due to real-time requirement)

-----

## 7. Implementation Architecture

### 7.1 Components

**Existing (reuse):**

- `beacon-nightly-worker` service on Railway (cron scheduled)
- `beacon_nightly_runs` tracking table
- `beacon_rankings` output table (currently empty, populated by v0)
- `beacon_pick_outcomes` tracking table (populated over time for v1)

**New (build for v0):**

1. **Signal Computation Engine** (`server/beacon/signals/`)
- One module per signal category
- Each signal has standard interface: `compute(symbol, data) → { value, confidence, direction }`
- See Signal Catalog document for full list
1. **Alignment Processor** (`server/beacon/alignment.js`)
- Takes all computed signals for a symbol
- Applies alignment rules
- Produces alignment score and direction bias
1. **Qualification Engine** (`server/beacon/qualification.js`)
- Applies quality gates
- Computes confidence qualification
- Rejects picks that fail gates
1. **Pattern Matcher** (`server/beacon/patterns.js`)
- Takes qualified alignments
- Matches against pattern library
- Assigns pattern name and narrative template
1. **Output Builder** (`server/beacon/output.js`)
- Produces Top Conviction + Watchlist views
- Writes to `beacon_rankings` table
- Formats reasoning narrative
1. **API Endpoints** (`server/v2/routes/beacon.js`)
- GET /api/v2/beacon/today → today’s picks
- GET /api/v2/beacon/pick/:id → detail view
- GET /api/v2/beacon/history → past picks (for tracking)
1. **Frontend** (`trading-os/src/app/beacon/`)
- Top Conviction landing view
- Watchlist view
- Detail drill-down
- Historical log view

### 7.2 Orchestration Flow

```
[nightly cron 21:30 UTC]
    │
    ▼
[Load universe symbols from ticker_universe + filters]
    │
    ▼
[For each symbol: compute all signals in parallel batches]
    │
    ▼
[Run alignment processor on each symbol's signals]
    │
    ▼
[Apply qualification gates]
    │
    ▼
[Pattern match qualified alignments]
    │
    ▼
[Rank by alignment score]
    │
    ▼
[Build Top Conviction (top 0-3) + Watchlist (top 0-15)]
    │
    ▼
[Write to beacon_rankings table]
    │
    ▼
[Also write to beacon_pick_outcomes for future tracking]
    │
    ▼
[Done — frontend queries beacon_rankings for today's picks]
```

### 7.3 Performance Requirements

- Full nightly run completes in < 30 minutes
- Single symbol signal computation: < 500ms
- API response times: < 1s for today’s picks, < 500ms for detail

-----

## 8. Confidence Model Evolution

### 8.1 v0 Confidence (Pre-Historical Data)

Confidence is computed purely from signal quality:

- Number of signals firing
- Strength of each signal
- Diversity across categories
- Absence of contradictions
- Data freshness

No historical outcomes are referenced.

**Output:** Qualitative confidence tier (High/Medium/Low) with specific reasoning.

### 8.2 v1 Confidence (After 30-60 Days of Tracking)

Same v0 computation PLUS:

- Pattern-specific historical outcome tracking
- “Similar setups in last 30/60 days resolved [X]% in direction / [Y]% opposite”
- Confidence adjustment based on historical pattern reliability

**Output:** Same qualitative tier + historical context panel.

### 8.3 Never Shipped (v2+)

Specific price targets, R:R ratios, predicted returns — these remain OUT of scope to preserve Beacon’s positioning as a pattern scanner, not a prediction engine.

-----

## 9. Outcome Tracking (For v1 Preparation)

### 9.1 What Gets Tracked

For every pick produced, track:

- Entry signal state (at time of pick)
- Subsequent price action: 1-day, 3-day, 5-day, 10-day highs/lows vs pick price
- Pattern-specific resolution (did earnings drift happen? did breakout hold?)
- Actual vs predicted direction alignment

### 9.2 Storage

`beacon_pick_outcomes` table (schema already exists):

- pick_id (reference to beacon_rankings)
- symbol
- pick_date
- pattern_name
- direction
- entry_reference_price
- resolved_at
- max_favorable_excursion (MFE)
- max_adverse_excursion (MAE)
- final_outcome_label (won / lost / unresolved / disqualified)
- notes

### 9.3 Tracking Cron

Separate daily job (v0.5 — after v0 picks start producing):

- Runs end of each trading day
- For each unresolved pick from last 10 days: fetch price action
- Computes MFE/MAE against reference price
- Marks resolved when pattern-specific resolution criteria met

This accumulates the dataset that enables v1’s historical context layer.

-----

## 10. Roadmap

### 10.1 v0 (Target: 4-6 weeks)

**Scope:**

- All 30 signals implemented
- 4 core patterns (Earnings Reaction, News Momentum, Unusual Volume, Coiled Spring)
- Nightly batch run producing Top Conviction + Watchlist
- Web dashboard at openrangetrading.co.uk/beacon
- Outcome tracking infrastructure in place

**Out of scope:**

- Email delivery
- Telegram alerts
- Intraday updates
- Real-time signal monitoring
- Historical confidence context (insufficient data)

### 10.2 v0.5 (Immediately After v0)

**Scope:**

- Outcome tracking cron runs daily
- Historical outcomes accumulate in `beacon_pick_outcomes`
- Dashboard shows “running log” of historical picks and outcomes

### 10.3 v1 (Target: v0 + 30-60 days)

**Scope:**

- Historical context layer added to pick output
- “Similar setups resolved [X]% in 30-day window”
- Confidence tiers refined by pattern-specific historical reliability
- Optional: daily email digest (batch, morning UK)

### 10.4 v2 (Target: v1 + 2-3 months)

**Scope:**

- Intraday signal monitoring (ORB with catalyst activation)
- Live alert system
- Telegram bot integration
- Push notifications
- User preference management (channel routing, signal filtering)

### 10.5 Not Planned

- “BUY” / “AVOID” verdicts (philosophical: violates trader-decides principle)
- Specific price target predictions (legal/commercial risk)
- Automated trading integration (out of scope for Beacon’s positioning)

-----

## 11. Success Criteria

### 11.1 v0 Success

Beacon v0 is successful when:

1. James uses it daily to generate his watchlist
1. Beacon’s Top Conviction picks include stocks James would have identified independently (validates pattern matching)
1. Beacon surfaces stocks James would have MISSED without it (validates scanning value)
1. False positive rate is acceptable — picks with high alignment that don’t resolve are understood and rare enough
1. Over 30 days, James trusts Beacon enough to show it to paying customers

### 11.2 v0 Failure

Beacon v0 fails if:

1. Picks are dominated by noise (random signals firing together)
1. Obvious setups (like Intel April 23) are missed by the scanner
1. False positives are so common that the output is not trustworthy
1. Reasoning is opaque or inconsistent — the “explain its work” principle breaks down
1. Performance issues prevent daily usage (runs too slow, output unreliable)

### 11.3 Escalation Criteria

If after 30 days of v0 usage:

- Picks are noisy → add qualification gates, refine pattern library
- Signals don’t align on obvious winners → review signal catalog, add missing signals
- Reasoning is unclear → strengthen narrative templates
- Performance issues → profile and optimize signal computation

-----

## 12. Open Questions / Future Decisions

### 12.1 Unresolved for v0

- Exact alignment score weighting per signal category
- Threshold values for “strong”, “medium”, “weak” signals
- Minimum pattern match score for surfacing
- Top Conviction vs Watchlist cutoffs (what alignment score puts a pick in Top Conviction?)

These will be determined during v0 development with reference data (existing historical cases like Intel, SMCI, etc.).

### 12.2 Pre-v1 Decisions

- Exact format of historical context panel
- How to display sample sizes (30 similar setups isn’t statistically significant)
- Handling of unresolved picks in historical context

### 12.3 Commercial Questions

- Is Beacon v0 a £49 tier feature or £99 exclusive?
- Does the free tier show any Beacon preview (e.g., pattern counts without detail)?
- How is Beacon positioned in marketing vs the research page and screener?

-----

## 13. Related Documents

- **Signal Catalog** (`BEACON_SIGNAL_CATALOG.md`) — detailed specification of all signals
- **Pattern Library** (future) — canonical examples of each pattern with historical cases
- **Roadmap Tracker** (future) — Build progress against this spec

-----

## 14. Change Log

|Date      |Version|Change                                        |
|----------|-------|----------------------------------------------|
|2026-04-24|0.1    |Initial spec based on tonight’s design session|

-----

*This document is the source of truth for Beacon v0. All implementation decisions should reference back to principles stated here. Deviations require explicit spec revision.*