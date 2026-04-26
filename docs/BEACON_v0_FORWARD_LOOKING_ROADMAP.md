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

## 5. Learning module / signal weight adaptation

What: Beacon currently treats all signals as equally weighted. The learning module would track Beacon picks against measured outcomes (next-day move, 3-day move, 5-day move) and adjust signal weights based on observed performance.

Status: Deferred. Depends on having multiple weeks of historical Beacon picks to build statistical significance.

Sub-types:
- Outcome attribution: link each pick to subsequent price move
- Pattern performance: which pattern names produce the best continuation?
- Signal combination edge: do certain alignments outperform others?
- Score adaptation: feedback loop adjusting score boost based on history
- Cross-pattern context: e.g., "earnings_reaction + news flag" historically produces 4.2% next-day move on average vs 1.1% for earnings_reaction alone — therefore boost picks with that combination

Data needed:
- New table: beacon_v0_outcomes (run_id, symbol, t+1 close, t+3 close, t+5 close, attribution metadata)
- Outcome ingestion worker that runs daily after market close
- Statistical significance testing infrastructure
- Score adaptation logic in alignment engine

Implementation effort: Multi-week. Foundational. Requires backtest-style infrastructure embedded in production.

Risks:
- Overfitting to recent patterns
- Sample size insufficiency for rare combinations
- Lookahead bias if not carefully implemented

## 6. News catalyst classification

What: Beacon currently treats news as binary (symbol has news in last 12h, yes/no). Real news catalysts have very different implications:
- Stock-specific news: company-only relevance (Phase 3 trial result, M&A)
- Sector news: cascades to multiple stocks (FDA approval class, OPEC decision)
- Macro news: market-wide implications (Fed decision, war, executive orders)

Without classification, Beacon misses sector-wide moves driven by single events.

Status: Deferred. Requires NLP/LLM classification layer.

Sub-types:
- Stock-specific catalyst (drug trial, earnings preannouncement, M&A target)
- Sector catalyst (FDA class action, regulatory change, supply shock)
- Macro/geopolitical catalyst (war, executive order, central bank action)
- Theme catalyst (psychedelics legislation, AI executive order, mineral rights)

Data needed:
- News headline text classifier (LLM-based or fine-tuned BERT)
- Sector/theme taxonomy with stock mappings
- Cascade detection logic ("if classified as 'energy supply shock' → boost all XLE constituents")
- Real-world examples to validate against (e.g., Apr 18 psychedelics EO)

Implementation effort: Multi-week. Likely 2-3 phases:
- Phase A: Headline classifier + tagging
- Phase B: Sector/theme mapping + cascade detection
- Phase C: Integration into Beacon signal system

Real-world tests:
- Trump April 18 psychedelics EO → did Beacon catch related stocks?
- Iran/energy events → did Beacon surface energy/defense names ahead of the move?

## 7. Congressional / political trade signals

What: Senate and House members are required to disclose stock trades within 45 days. FMP provides this data via senate-trading and house-trading endpoints. Politicians' STOCK trades have historically shown alpha; "Pelosi bought $X" stories drive retail flow.

Status: Planned for Phase C series (later session).

Sub-types:
- Senate trades (via FMP /senate-trading endpoint)
- House trades (via FMP /house-trading endpoint)
- Recent trades signal (members trading specific symbol in last 30 days)
- Cluster detection (multiple members buying same symbol = stronger signal)
- Sector pattern detection (defense stocks bought by armed services committee members ahead of contracts)

Data needed:
- New tables: congressional_trades (member, party, chamber, symbol, trade_type, amount_range, transaction_date, disclosure_date)
- Ingestion worker (daily, FMP endpoints)
- Signal logic: top_congressional_trades_recent

Implementation effort: 3-5 phases:
- C1: Ingestion (FMP endpoints + table + worker)
- C2: Signal logic (top_congressional_trades_recent)
- C3: Independent frontend page (similar to News, Earnings tabs)
- C4 (optional): Cluster detection across members
- C5 (optional): Pre-event timing analysis

Independent frontend: Beacon utilizes the data as a signal, but congressional trades also deserve their own page in the navigation showing recent disclosures, member-level views, sector breakdowns. Similar to how News and Earnings are both ingested for Beacon AND have their own frontend pages.

## 8. Forward-looking vs backward-looking UI distinction

What: Currently 5 of 6 Beacon signals are backward-looking (RVOL, gap, news, earnings_reaction all describe events that already happened). Only Coiled Spring is forward-looking. As more forward-looking signals are added, the UI needs to distinguish them.

Status: Phase B4 (next phase).

Sub-types:
- Signal-level metadata flag: forward_looking: true | false
- UI badge or color treatment differentiating forward-looking signal cards within a pick
- Pick-level summary: "X of Y signals forward-looking"
- Ranking weight: should forward-looking alignment count more than backward-looking? (Open question)

Note: "Already moved + still moving" is a real pattern (momentum continuation, especially with fresh news). Backward-looking signals are not inherently less valuable — they just describe a different trade thesis. UI should communicate the difference, not stigmatize either type.

Data needed:
- Add `forward_looking` boolean to each signal module's exports
- Aggregate at pick level (count forward-looking signals in alignment)
- Frontend rendering changes

## 9. LLM narrative layer for pick reasoning

What: Beacon currently composes deterministic reasoning from signal metadata. A future LLM narrative layer would turn the raw signal stack into a concise trader-readable thesis: what happened, what is still ahead, why the alignment matters, and what would invalidate the setup.

Status: Deferred. Should only start after Beacon has stable forward/backward signal metadata, outcome tracking, and enough examples to evaluate narrative quality.

Design goals:
- Preserve deterministic facts as the source of truth; the LLM should explain, not invent.
- Separate forward-looking setup language from already-moved momentum language.
- Include confidence caveats and invalidation notes without making trade recommendations.
- Keep the narrative short enough for card UI and expandable into a deeper detail view.

Dependencies:
- Stable pick-level signal evidence payloads
- Forward/backward counts exposed in the API
- Catalyst classification tags for news-driven picks
- Outcome attribution to evaluate whether narratives are helpful or misleading

Implementation sequencing:
- Phase D1: Prompt contract and JSON schema for narrative generation
- Phase D2: Offline narrative generation for historical picks only
- Phase D3: Human review and quality scoring against real examples
- Phase D4: Optional production generation with caching and strict fallbacks

Open risks:
- Hallucinated catalysts or causal claims
- Overconfident language that implies certainty
- Latency and cost if narratives are generated synchronously
- Drift between deterministic Beacon fields and generated prose

## Open questions

- Should "forward-looking" picks be visually distinguished from "already moved" picks in the UI? (Different tab, different colour, different section?)
- How does alignment scoring change when forward-looking signals are weighted alongside backward-looking ones? Same weight, or higher?
- Does adding more signals risk diluting alignment quality? (More leaderboards = more chances for spurious overlap.) Need to validate with real data after each addition.
