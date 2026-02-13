# Pre-Market Screener & Watchlist Generator

CLI tool that ingests pre-market scanner output, enforces hard gates (catalyst + liquidity), classifies tickers (A/B/C), maps permitted strategies, ranks into tiers, and produces both a **JSON** and **Markdown** report mirroring the *Daily Scanner Analysis — Pre-Market Watchlist* template.

## Non-Negotiable Rules

Every ticker in output **must** have:

1. A clear catalyst (type + detail) — no catalyst = no trade.
2. A classification (A / B / C) — no classification = no trade.
3. A strategy mapping — no strategy = no trade.
4. A written plan with stop conditions — no plan = no trade.

If any field cannot be filled, the ticker is downgraded or excluded.

## Quick Start

```bash
cd premarket-screener
npm install
npm run start        # uses sample JSON + YAML config → sample-output/
npm run start:csv    # same but from CSV input
```

Custom run:

```bash
npx ts-node cli.ts \
  --input path/to/tickers.csv \
  --config config/default-config.yaml \
  --output output
```

## Inputs

### Ticker file (JSON or CSV)

Fields (all optional except `ticker`; more data = better scoring):

| Field | Description |
|-------|-------------|
| `ticker` | Symbol (required) |
| `last` | Previous close price |
| `pmPrice` | Current pre-market price |
| `pmChangePct` | PM gap % vs previous close |
| `pmVolume` | Pre-market volume |
| `avgVolume` | Average daily volume |
| `float` | Shares float |
| `sector` | Sector / industry |
| `pmHigh` | PM session high (optional; provider can fill) |
| `pmLow` | PM session low (optional; provider can fill) |

### Data providers (pluggable)

Three provider interfaces abstract external data:

- **`MarketDataProvider`** — returns OHLC, 52-week range, PM H/L, HTF levels.
- **`NewsProvider`** — returns catalyst type + detail.
- **`EarningsProvider`** — returns earnings-specific catalyst info.

**Mock providers** are included so the tool runs offline.  To add a real provider, implement the interface and wire it in `src/cli.ts`.

Example — adding a custom news provider:

```typescript
// providers/MyNewsProvider.ts
import { NewsProvider } from './NewsProvider';
import { CatalystInfo, TickerInput } from '../models/types';

export class MyNewsProvider implements NewsProvider {
  async getCatalyst(ticker: TickerInput): Promise<CatalystInfo | null> {
    // Call your API here
    const data = await fetch(`https://api.example.com/news/${ticker.ticker}`);
    // Map to CatalystInfo
    return { type: 'earnings', detail: data.headline, earningsTiming: data.timing };
  }
}
```

Then in `src/cli.ts`, replace `new MockNewsProvider()` with `new MyNewsProvider()`.

## Config

See [`config/default-config.yaml`](config/default-config.yaml).  JSON config is also supported.

### Thresholds (hard gate)

| Key | Default | Description |
|-----|---------|-------------|
| `minPrice` | 1 | Minimum tradeable price ($) |
| `maxPrice` | 500 | Maximum tradeable price ($) |
| `minAvgVolume` | 500,000 | Minimum average daily volume |
| `minPmVolume` | 100,000 | Minimum pre-market volume |
| `minGapPct` | 3 | Minimum absolute gap % |
| `maxFloat` | *(optional)* | Maximum float filter |

### Stop conditions

| Key | Default | Description |
|-----|---------|-------------|
| `dailyLossLimit` | 500 | $ loss before forced stop |
| `maxLosingTrades` | 3 | Consecutive losers before stop |
| `emotionalCheckTime` | "17:00" | UK time — pause and assess |
| `hardCloseUk` | "20:45" | UK time — all positions closed |

## Classification Logic

### Class A — Momentum Continuation

**Criteria:** Major catalyst (`earnings`, `fda`, `product`, `merger`, `contract`, `upgrade`) + relative volume >= 1.5x + gap >= 5% + holding PM highs (price >= 97% of PM high).

**Permitted strategies:** Strategy 1 (ORB), Strategy 4 (Momentum Extension).

### Class B — Fresh News / Day-1 Volatility

**Criteria:** Valid catalyst (major types + `guidance`, `sector`) + relative volume >= 1.0x + absolute gap >= 3% + not a selloff/offering pattern.

**Permitted strategies:** Strategy 1 (ORB), Strategy 2 (Support Bounce), Strategy 3 (VWAP Reclaim).

### Class C — Reversal Watchlist (OBSERVE ONLY)

**Criteria:** Everything else — insufficient volume, weak catalyst, offering/dilution selloff, or ambiguous structure.

**Permitted strategies:** Strategy 3 (VWAP Reclaim), Strategy 5 (Post-Flush Reclaim) — **only after confirmation**.

**Ambiguity rule:** When classification is unclear, downgrade (A->B, B->C) or exclude.

## Relative Volume Calculation

```
relVolume = pmVolume / (avgVolume * SESSION_FRACTION)
```

`SESSION_FRACTION` defaults to **0.20** — a PM volume equal to 20% of the full-day average yields relVol = 1.0.  This accounts for the fact that PM typically represents a small fraction of total daily volume.

## Ranking

| Tier | Rule |
|------|------|
| **Tier 1** (max 4) | Strongest catalysts + best liquidity + cleanest class + highest conviction |
| **Tier 2** | Valid but displaced by higher-scoring names; includes *whySecondary* reason |
| **Tier 3** | Failed gate, Class C (observe only), or no clean strategy mapping |

## Output Structure

Both `report.json` and `report.md` contain:

1. **SESSION INFO** — date, day, market open time, sources, counts, macro notes.
2. **TICKER ANALYSIS** — per-ticker block with price, catalyst, key levels, classification, strategy, risk assessment.
3. **PRIORITY RANKING** — Tier 1/2/3 tables.
4. **SESSION ACTION PLAN** — Opening/Mid/Late session with dynamic candidate lists.
5. **STOP CONDITIONS** — from config.

## File Map

```
premarket-screener/
├── cli.ts                     # Entry point (delegates to src/cli.ts)
├── config/
│   ├── default-config.json    # JSON config
│   └── default-config.yaml    # YAML config (default)
├── models/
│   └── types.ts               # All TypeScript interfaces
├── providers/
│   ├── MarketDataProvider.ts   # Interface
│   ├── NewsProvider.ts         # Interface
│   ├── EarningsProvider.ts     # Interface
│   └── MockProviders.ts       # Mock implementations
├── scoring/
│   ├── gating.ts              # Hard gate filter
│   ├── classification.ts      # A/B/C classifier + strategy mapper
│   └── tiering.ts             # Tier ranking + scoring
├── src/
│   ├── cli.ts                 # CLI argument parsing + I/O
│   ├── engine.ts              # Main pipeline orchestrator
│   └── report.ts              # Markdown report builder
├── sample-data/
│   ├── sample-input.json      # 10 sample tickers (JSON)
│   └── sample-input.csv       # Same data (CSV)
├── sample-output/
│   ├── report.md              # Generated sample report
│   └── report.json            # Generated sample data
└── tests/
    ├── gating.test.ts         # 15 gate filter tests
    ├── classification.test.ts # 15 classification tests
    └── tiering.test.ts        # 8 tiering tests
```

## Tests

```bash
npm test
```

Covers:
- **Gating:** every rejection path (catalyst, price, volume, gap, float) + acceptance paths.
- **Classification:** A/B/C assignment, strategy mapping, conviction, invalidation, edge cases.
- **Tiering:** Tier 1 cap, C->Tier 3 rule, ranking order, whySecondary population.

## Determinism

Same inputs always produce the same outputs.  No randomness, no external API calls (with mock providers), no time-dependent scoring (date in SESSION INFO uses runtime date but doesn't affect classification).
