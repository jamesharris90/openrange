/* eslint-disable no-console */
// @ts-nocheck

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";


const POSITIVE_KEYWORDS = [
  "beat",
  "beats",
  "surge",
  "growth",
  "record",
  "profit",
  "upgrade",
  "outperform",
  "guidance raised",
  "launch",
  "approval",
  "partnership",
];

const NEGATIVE_KEYWORDS = [
  "miss",
  "misses",
  "drop",
  "decline",
  "loss",
  "downgrade",
  "underperform",
  "guidance cut",
  "lawsuit",
  "probe",
  "delay",
  "recall",
];

const CREDIBILITY_BY_SITE: Record<string, number> = {
  reuters: 1.0,
  bloomberg: 1.0,
  wsj: 0.95,
  cnbc: 0.9,
  yahoo: 0.8,
  marketwatch: 0.8,
  benzinga: 0.75,
};

const QUALITY_MODE = {
  clusterWindowHours: 6,
  maxClusterWindowHours: 12,
  minKeywordOverlap: 0.2,
  minMultiCatalystCount: 2,
  minMultiCatalystAvgStrength: 60,
  singleCatalystStrengthGate: 85,
  minClusterScore: 60,
  minSignalClusterScore: 65,
  minSignalSentimentAbs: 0.4,
  minSignalConfidence: 0.65,
  minOpportunityConfidence: 0.75,
  minOpportunityMovePct: 2.5,
  minOpportunityClusterScore: 70,
  maxOpportunitiesGlobal: 6,
} as const;

const SESSION_MULTIPLIERS: Record<string, number> = {
  premarket_early: 0.85,
  premarket_active: 0.95,
  market_open: 1.1,
  mid_day: 1.0,
  power_hour: 1.05,
  after_hours: 0.9,
};

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONTEXT_IMPACT_LOG_PATH = path.resolve(__dirname, "../logs/context-impact.json");

function clamp(value: number, min = -1, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function ensureDirectoryForFile(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeContextImpactLog(payload: any): void {
  try {
    ensureDirectoryForFile(CONTEXT_IMPACT_LOG_PATH);
    fs.writeFileSync(CONTEXT_IMPACT_LOG_PATH, JSON.stringify(payload, null, 2), "utf8");
  } catch (error) {
    console.warn("[CONTEXT_IMPACT_LOG] write failed", error?.message || error);
  }
}

function toUkMinutes(date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  return hour * 60 + minute;
}

function classifyMarketSession(date = new Date()): string {
  const ukMinutes = toUkMinutes(date);
  if (ukMinutes < 12 * 60) return "premarket_early";
  if (ukMinutes < 14 * 60 + 30) return "premarket_active";
  if (ukMinutes < 16 * 60) return "market_open";
  if (ukMinutes < 19 * 60) return "mid_day";
  if (ukMinutes < 21 * 60) return "power_hour";
  return "after_hours";
}

function getSessionMultiplier(session: string): number {
  return Number(SESSION_MULTIPLIERS[String(session || "").trim()] || 1);
}

function getVolumeMultiplier(rvolRaw: number): number {
  const rvol = Number(rvolRaw || 0);
  if (!Number.isFinite(rvol)) return 1;
  if (rvol >= 2.0) return 1.15;
  if (rvol >= 1.5) return 1.1;
  if (rvol >= 1.2) return 1.05;
  if (rvol < 1.0) return 0.9;
  return 1.0;
}

function toConfidencePercent(valueRaw: number): number {
  const value = Number(valueRaw || 0);
  if (!Number.isFinite(value)) return 0;
  if (value <= 1) return Number((value * 100).toFixed(2));
  return Number(value.toFixed(2));
}

function toDate(value: any): Date | null {
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  return d;
}

function recencyScore(eventTime: Date | null, now = new Date()): number {
  if (!eventTime) return 0.3;
  const ageHours = Math.max(0, (now.getTime() - eventTime.getTime()) / 36e5);
  if (ageHours <= 6) return 1.0;
  if (ageHours <= 24) return 0.85;
  if (ageHours <= 72) return 0.65;
  if (ageHours <= 168) return 0.5;
  return 0.35;
}

function classifyCatalystType(headlineRaw: string): string {
  const headline = headlineRaw.toLowerCase();
  if (headline.includes("earnings") || headline.includes("eps") || headline.includes("guidance")) return "earnings";
  if (headline.includes("upgrade") || headline.includes("downgrade")) return "analyst";
  if (headline.includes("acquisition") || headline.includes("merger")) return "corporate";
  if (headline.includes("launch") || headline.includes("product")) return "product";
  return "news";
}

function classifyIntelCatalystType(headlineRaw: string): string {
  const headline = String(headlineRaw || "").toLowerCase();
  if (headline.includes("earnings") || headline.includes("eps") || headline.includes("guidance")) return "earnings";
  if (headline.includes("upgrade") || headline.includes("downgrade") || headline.includes("price target")) return "analyst";
  if (headline.includes("approval") || headline.includes("fda")) return "regulatory";
  if (headline.includes("contract") || headline.includes("deal") || headline.includes("partnership")) return "corporate";
  if (headline.includes("macro") || headline.includes("fed") || headline.includes("inflation") || headline.includes("rates")) return "macro";
  return "intel_news";
}

function keywordSentiment(textRaw: string): number {
  const text = textRaw.toLowerCase();
  const posHits = POSITIVE_KEYWORDS.filter((k) => text.includes(k)).length;
  const negHits = NEGATIVE_KEYWORDS.filter((k) => text.includes(k)).length;

  if (posHits === 0 && negHits === 0) return 0;
  if (posHits > 0 && negHits === 0) return clamp(0.5 + (posHits - 1) * 0.1, -1, 1);
  if (negHits > 0 && posHits === 0) return clamp(-(0.5 + (negHits - 1) * 0.1), -1, 1);

  const raw = (posHits - negHits) * 0.2;
  return clamp(raw, -1, 1);
}

function credibilityScore(siteRaw: string | null | undefined): number {
  if (!siteRaw) return 0.6;
  const normalized = String(siteRaw).toLowerCase();
  for (const [key, score] of Object.entries(CREDIBILITY_BY_SITE)) {
    if (normalized.includes(key)) return score;
  }
  return 0.65;
}

function computeStrengthScore(eventTime: Date | null, sentiment: number, siteRaw: string | null | undefined): number {
  const recency = recencyScore(eventTime);
  const sentimentMagnitude = Math.abs(sentiment);
  const credibility = credibilityScore(siteRaw);
  const score = recency * 0.5 + sentimentMagnitude * 0.3 + credibility * 0.2;
  return Number(clamp(score, 0, 1).toFixed(6));
}

function normalizeStrengthToPct(value: any): number {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  if (n <= 1) return clamp(n * 100, 0, 100);
  return clamp(n, 0, 100);
}

function headlineTokens(headlineRaw: string): Set<string> {
  const stop = new Set([
    "the", "and", "for", "with", "from", "into", "that", "this", "after", "before",
    "stock", "shares", "company", "inc", "corp", "ltd", "announces", "announced",
  ]);
  return new Set(
    String(headlineRaw || "")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 3 && !stop.has(t))
  );
}

function keywordOverlapRatio(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  const union = new Set([...a, ...b]).size;
  if (!union) return 0;
  return intersection / union;
}

export async function ensureCatalystLayerSchema(client: any): Promise<void> {
  await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

  await client.query(`
    CREATE TABLE IF NOT EXISTS catalyst_clusters (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      symbol TEXT NOT NULL,
      cluster_score DOUBLE PRECISION NOT NULL,
      catalyst_count INTEGER NOT NULL,
      time_window_hours INTEGER NOT NULL,
      dominant_type TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS signals (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      symbol TEXT NOT NULL,
      signal_type TEXT NOT NULL,
      score DOUBLE PRECISION NOT NULL,
      confidence DOUBLE PRECISION NOT NULL,
      catalyst_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS macro_narratives (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      theme TEXT NOT NULL,
      summary TEXT NOT NULL,
      affected_sectors TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      affected_symbols TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      confidence DOUBLE PRECISION NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await client.query(`
    ALTER TABLE catalyst_events
    ADD COLUMN IF NOT EXISTS event_uuid UUID DEFAULT gen_random_uuid(),
    ADD COLUMN IF NOT EXISTS source_table TEXT,
    ADD COLUMN IF NOT EXISTS source_id TEXT,
    ADD COLUMN IF NOT EXISTS event_time TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS strength_score DOUBLE PRECISION
  `);

  await client.query(`
    ALTER TABLE opportunities
    ADD COLUMN IF NOT EXISTS strategy TEXT,
    ADD COLUMN IF NOT EXISTS entry NUMERIC,
    ADD COLUMN IF NOT EXISTS stop_loss NUMERIC,
    ADD COLUMN IF NOT EXISTS take_profit NUMERIC,
    ADD COLUMN IF NOT EXISTS expected_move_percent NUMERIC,
    ADD COLUMN IF NOT EXISTS confidence DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS confidence_contextual DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS market_session TEXT,
    ADD COLUMN IF NOT EXISTS session_multiplier DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS rvol DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS volume_multiplier DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS signal_ids UUID[] DEFAULT ARRAY[]::UUID[],
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()
  `);

  await client.query(`
    ALTER TABLE signals
    ADD COLUMN IF NOT EXISTS market_session TEXT,
    ADD COLUMN IF NOT EXISTS session_multiplier DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS rvol DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS volume_multiplier DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS confidence_contextual DOUBLE PRECISION
  `);

  await client.query(`CREATE INDEX IF NOT EXISTS idx_catalyst_events_symbol ON catalyst_events(symbol)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_catalyst_events_event_time ON catalyst_events(event_time DESC)`);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_catalyst_events_trace
    ON catalyst_events (source_table, source_id, symbol)
    WHERE source_table IS NOT NULL AND source_id IS NOT NULL AND symbol IS NOT NULL
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_catalyst_clusters_symbol ON catalyst_clusters(symbol)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_signals_symbol ON signals(symbol)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_opportunities_symbol ON opportunities(symbol)`);
  await client.query(`CREATE INDEX IF NOT EXISTS idx_macro_narratives_theme ON macro_narratives(theme)`);
}

export async function buildNewsCatalysts(client: any): Promise<number> {
  const news = await client.query(`
    SELECT id, symbol, COALESCE(title, headline) AS headline, COALESCE(published_date, published_at, created_at) AS event_time,
           site, source, COALESCE(body_text, summary, '') AS body_text
    FROM news_articles
    WHERE symbol IS NOT NULL
      AND symbol <> ''
      AND COALESCE(published_date, published_at, created_at) >= NOW() - INTERVAL '7 days'
  `);

  if (!news.rows.length) return 0;

  const insertSql = `
    INSERT INTO catalyst_events (
      symbol, catalyst_type, headline, source_table, source_id,
      event_time, strength_score, sentiment_score, created_at, published_at
    ) VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7,$8,NOW(),$6::timestamp)
  `;

  let inserted = 0;
  const seen = new Set<string>();
  for (const row of news.rows) {
    const headline = String(row.headline || "").trim();
    if (!headline) continue;

    const symbol = String(row.symbol || "").trim().toUpperCase();
    if (!symbol) continue;

    const eventTime = toDate(row.event_time) || new Date();
    const textForSentiment = `${headline} ${String(row.body_text || "")}`;
    const sentiment = keywordSentiment(textForSentiment);
    const strength = computeStrengthScore(eventTime, sentiment, row.site || row.source);
    const catalystType = classifyCatalystType(headline);
    const dedupeKey = `news_articles|${String(row.id)}|${symbol}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    await client.query(insertSql, [
      symbol,
      catalystType,
      headline,
      "news_articles",
      String(row.id),
      eventTime.toISOString(),
      strength,
      sentiment,
    ]);

    inserted++;
  }

  return inserted;
}

export async function buildIntelCatalysts(client: any): Promise<number> {
  const intelRows = await client.query(`
    SELECT id, symbol, headline, source, url, published_at, sentiment, narrative
    FROM intel_news
    WHERE COALESCE(published_at, NOW()) >= NOW() - INTERVAL '7 days'
      AND headline IS NOT NULL
      AND LENGTH(TRIM(headline)) > 0
  `).catch(() => ({ rows: [] }));

  if (!intelRows.rows.length) return 0;

  const validSymbols = await client.query(`
    SELECT DISTINCT UPPER(symbol) AS symbol
    FROM market_quotes
    WHERE symbol IS NOT NULL
      AND symbol <> ''
      AND symbol ~ '^[A-Z]{1,5}$'
  `).catch(() => ({ rows: [] }));
  const validSet = new Set((validSymbols.rows || []).map((r: any) => String(r.symbol || "").toUpperCase()).filter(Boolean));

  const tokenRegex = /\b[A-Z]{1,5}\b/g;
  let inserted = 0;
  const seen = new Set<string>();

  for (const row of intelRows.rows || []) {
    const headline = String(row.headline || "").trim();
    if (!headline) continue;

    const explicit = String(row.symbol || "").trim().toUpperCase();
    const symbolCandidates = new Set<string>();
    if (explicit && validSet.has(explicit)) symbolCandidates.add(explicit);

    const tokenMatches = headline.toUpperCase().match(tokenRegex) || [];
    for (const token of tokenMatches) {
      if (validSet.has(token)) symbolCandidates.add(token);
    }

    if (!symbolCandidates.size) continue;

    const rawSentiment = String(row.sentiment || "").toLowerCase();
    const sentiment = rawSentiment === "bullish"
      ? 0.7
      : rawSentiment === "bearish"
        ? -0.7
        : keywordSentiment(`${headline} ${String(row.narrative || "")}`);
    const eventTime = toDate(row.published_at) || new Date();
    const sourceCredibility = String(row.source || "newsletter");
    const catalystType = classifyIntelCatalystType(headline);
    const strength = Number(clamp(computeStrengthScore(eventTime, sentiment, sourceCredibility) + 0.12, 0, 1).toFixed(6));

    for (const symbol of symbolCandidates) {
      const trace = `intel_news|${String(row.id)}|${symbol}`;
      if (seen.has(trace)) continue;
      seen.add(trace);

      await client.query(
        `INSERT INTO catalyst_events (
          symbol, catalyst_type, headline, source_table, source_id,
          event_time, strength_score, sentiment_score, created_at, published_at
        ) VALUES ($1,$2,$3,'intel_news',$4,$5::timestamptz,$6,$7,NOW(),$5::timestamp)`,
        [
          symbol,
          catalystType,
          headline,
          String(row.id),
          eventTime.toISOString(),
          strength,
          sentiment,
        ]
      );
      inserted += 1;
    }
  }

  return inserted;
}

export async function buildEarningsCatalysts(client: any): Promise<number> {
  const earnings = await client.query(`
    SELECT id, symbol, event_date, eps_actual, eps_estimate
    FROM earnings_calendar
    WHERE symbol IS NOT NULL
      AND symbol <> ''
      AND eps_actual IS NOT NULL
      AND eps_estimate IS NOT NULL
      AND eps_estimate <> 0
      AND event_date >= CURRENT_DATE - INTERVAL '21 days'
  `);

  const insertSql = `
    INSERT INTO catalyst_events (
      symbol, catalyst_type, headline, source_table, source_id,
      event_time, strength_score, sentiment_score, created_at, published_at
    ) VALUES ($1,'earnings',$2,'earnings_calendar',$3,$4::timestamptz,$5,$6,NOW(),$4::timestamp)
  `;

  let inserted = 0;
  const seen = new Set<string>();
  for (const row of earnings.rows) {
    const surprisePct = ((Number(row.eps_actual) - Number(row.eps_estimate)) / Math.abs(Number(row.eps_estimate))) * 100;
    if (surprisePct <= 10 && surprisePct >= -10) continue;

    const sentiment = clamp(surprisePct / 25, -1, 1);
    const eventTime = toDate(row.event_date) || new Date();
    const strength = Number(clamp(0.55 + Math.min(0.4, Math.abs(surprisePct) / 100), 0, 1).toFixed(6));
    const headline = `Earnings surprise ${surprisePct.toFixed(2)}% (EPS ${row.eps_actual} vs ${row.eps_estimate})`;
    const dedupeKey = `earnings_calendar|${String(row.id)}|${String(row.symbol).toUpperCase()}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    await client.query(insertSql, [
      String(row.symbol).toUpperCase(),
      headline,
      String(row.id),
      eventTime.toISOString(),
      strength,
      sentiment,
    ]);

    inserted++;
  }

  return inserted;
}

export async function buildIpoAndSplitCatalysts(client: any): Promise<{ ipo: number; split: number }> {
  const ipos = await client.query(`
    SELECT id, symbol, company, event_date
    FROM ipo_calendar
    WHERE symbol IS NOT NULL
      AND symbol <> ''
      AND event_date >= CURRENT_DATE
      AND event_date <= CURRENT_DATE + INTERVAL '7 days'
  `);

  const splits = await client.query(`
    SELECT id, symbol, event_date, numerator, denominator
    FROM stock_splits
    WHERE symbol IS NOT NULL
      AND symbol <> ''
      AND event_date >= CURRENT_DATE
      AND event_date <= CURRENT_DATE + INTERVAL '7 days'
  `);

  let ipoInserted = 0;
  const ipoSeen = new Set<string>();
  for (const row of ipos.rows) {
    const symbol = String(row.symbol).toUpperCase();
    const dedupeKey = `ipo_calendar|${String(row.id)}|${symbol}`;
    if (ipoSeen.has(dedupeKey)) continue;
    ipoSeen.add(dedupeKey);
    await client.query(
      `INSERT INTO catalyst_events (
        symbol, catalyst_type, headline, source_table, source_id,
        event_time, strength_score, sentiment_score, created_at, published_at
      ) VALUES ($1,'ipo',$2,'ipo_calendar',$3,$4::timestamptz,0.58,0,NOW(),$4::timestamp)`,
      [
        symbol,
        `Upcoming IPO${row.company ? `: ${row.company}` : ''}`,
        String(row.id),
        new Date(row.event_date).toISOString(),
      ]
    );
    ipoInserted++;
  }

  let splitInserted = 0;
  const splitSeen = new Set<string>();
  for (const row of splits.rows) {
    const symbol = String(row.symbol).toUpperCase();
    const dedupeKey = `stock_splits|${String(row.id)}|${symbol}`;
    if (splitSeen.has(dedupeKey)) continue;
    splitSeen.add(dedupeKey);
    await client.query(
      `INSERT INTO catalyst_events (
        symbol, catalyst_type, headline, source_table, source_id,
        event_time, strength_score, sentiment_score, created_at, published_at
      ) VALUES ($1,'split',$2,'stock_splits',$3,$4::timestamptz,0.52,0,NOW(),$4::timestamp)`,
      [
        symbol,
        `Upcoming split ${row.numerator}:${row.denominator}`,
        String(row.id),
        new Date(row.event_date).toISOString(),
      ]
    );
    splitInserted++;
  }

  return { ipo: ipoInserted, split: splitInserted };
}

export async function buildMacroNarratives(client: any): Promise<number> {
  const themes = [
    {
      theme: "interest rates",
      keywords: ["rate hike", "fed", "interest rate", "yield"],
      sectors: ["Financials", "Real Estate"],
      symbols: ["SPY", "QQQ", "XLF", "IYR"],
    },
    {
      theme: "inflation",
      keywords: ["inflation", "cpi", "ppi", "price pressure"],
      sectors: ["Consumer Staples", "Consumer Discretionary"],
      symbols: ["SPY", "XLP", "XLY", "WMT"],
    },
    {
      theme: "tech sector",
      keywords: ["semiconductor", "ai", "cloud", "software", "chip"],
      sectors: ["Technology"],
      symbols: ["QQQ", "XLK", "NVDA", "MSFT", "AAPL"],
    },
    {
      theme: "oil / energy",
      keywords: ["oil", "crude", "opec", "energy"],
      sectors: ["Energy"],
      symbols: ["XLE", "CVX", "XOM", "SPY"],
    },
  ];

  const rows = await client.query(`
    SELECT COALESCE(title, headline, '') AS headline, COALESCE(body_text, summary, '') AS body_text
    FROM news_articles
    WHERE COALESCE(published_date, published_at, created_at) >= NOW() - INTERVAL '7 days'
  `);

  await client.query(`DELETE FROM macro_narratives`);

  let inserted = 0;
  for (const theme of themes) {
    const matches = rows.rows.filter((r) => {
      const text = `${String(r.headline || '').toLowerCase()} ${String(r.body_text || '').toLowerCase()}`;
      return theme.keywords.some((k) => text.includes(k));
    });

    if (!matches.length) continue;

    const sentimentValues = matches.map((r) => keywordSentiment(`${r.headline} ${r.body_text}`));
    const avgSentiment = sentimentValues.reduce((a, b) => a + b, 0) / sentimentValues.length;
    const confidence = Number(clamp(0.45 + Math.min(0.35, matches.length * 0.02) + Math.abs(avgSentiment) * 0.2, 0, 1).toFixed(6));

    const summary = `${theme.theme} is active in ${matches.length} recent articles. Sentiment is ${avgSentiment > 0.1 ? 'positive' : avgSentiment < -0.1 ? 'negative' : 'mixed'}, with impact focused on ${theme.sectors.join(', ')}.`;

    await client.query(
      `INSERT INTO macro_narratives (theme, summary, affected_sectors, affected_symbols, confidence, created_at)
       VALUES ($1,$2,$3::text[],$4::text[],$5,NOW())`,
      [theme.theme, summary, theme.sectors, theme.symbols, confidence]
    );

    inserted++;
  }

  return inserted;
}

export async function buildClustersAndSignals(client: any): Promise<{ clusters: number; signals: number; filterImpact: any }> {
  const catalysts = await client.query(`
    SELECT event_uuid, symbol, catalyst_type, headline, COALESCE(event_time, published_at, created_at) AS event_time,
           COALESCE(strength_score, 0.4) AS strength_score,
           COALESCE(sentiment_score, 0) AS sentiment_score
    FROM catalyst_events
    WHERE source_table IN ('news_articles', 'earnings_calendar', 'ipo_calendar', 'stock_splits')
      AND symbol IS NOT NULL
      AND symbol <> ''
      AND COALESCE(event_time, published_at, created_at) >= NOW() - INTERVAL '7 days'
  `);

  await client.query(`DELETE FROM catalyst_clusters`);
  await client.query(`DELETE FROM signals`);

  const bySymbol = new Map<string, any[]>();
  for (const c of catalysts.rows) {
    const symbol = String(c.symbol || "").trim().toUpperCase();
    if (!symbol) continue;
    const arr = bySymbol.get(symbol) || [];
    arr.push({
      ...c,
      symbol,
      event_time: toDate(c.event_time) || new Date(),
      strength_score_pct: normalizeStrengthToPct(c.strength_score),
      tokens: headlineTokens(c.headline || ""),
    });
    bySymbol.set(symbol, arr);
  }

  const provisionalClusters: any[] = [];
  for (const [symbol, items] of bySymbol.entries()) {
    const sorted = items.slice().sort((a, b) => a.event_time.getTime() - b.event_time.getTime());

    for (const item of sorted) {
      let matchedCluster: any = null;
      for (const cluster of provisionalClusters) {
        if (cluster.symbol !== symbol) continue;
        const ageHours = Math.abs((item.event_time.getTime() - cluster.anchorTime.getTime()) / 36e5);
        if (ageHours > QUALITY_MODE.maxClusterWindowHours) continue;
        if (ageHours > QUALITY_MODE.clusterWindowHours) continue;

        const overlap = keywordOverlapRatio(item.tokens, cluster.tokenUnion);
        if (overlap >= QUALITY_MODE.minKeywordOverlap) {
          matchedCluster = cluster;
          break;
        }
      }

      if (!matchedCluster) {
        provisionalClusters.push({
          symbol,
          anchorTime: item.event_time,
          items: [item],
          tokenUnion: new Set(item.tokens),
        });
      } else {
        matchedCluster.items.push(item);
        for (const t of item.tokens) matchedCluster.tokenUnion.add(t);
      }
    }
  }

  let clusterCount = 0;
  const clusterSummaries: Array<any> = [];
  const clusterRejections = {
    by_size_and_strength: 0,
    by_min_cluster_score: 0,
  };

  for (const cluster of provisionalClusters) {
    const symbol = cluster.symbol;
    const items = cluster.items;
    const catalystCount = items.length;
    const avgStrengthPct = items.reduce((a, b) => a + Number(b.strength_score_pct || 0), 0) / catalystCount;
    const avgSentiment = items.reduce((a, b) => a + Number(b.sentiment_score || 0), 0) / catalystCount;
    const typeCounts = new Map<string, number>();
    for (const it of items) {
      typeCounts.set(it.catalyst_type || "news", (typeCounts.get(it.catalyst_type || "news") || 0) + 1);
    }
    const dominantType = Array.from(typeCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || "news";

    const strongestStrength = Math.max(...items.map((i) => Number(i.strength_score_pct || 0)));
    const passesMinMembers = catalystCount >= QUALITY_MODE.minMultiCatalystCount
      && avgStrengthPct >= QUALITY_MODE.minMultiCatalystAvgStrength;
    const passesSingleHighStrength = catalystCount === 1 && strongestStrength >= QUALITY_MODE.singleCatalystStrengthGate;
    if (!passesMinMembers && !passesSingleHighStrength) {
      clusterRejections.by_size_and_strength += 1;
      continue;
    }

    const clusterScore = Number((avgStrengthPct * 0.8 + catalystCount * 4).toFixed(6));

    if (clusterScore < QUALITY_MODE.minClusterScore) {
      clusterRejections.by_min_cluster_score += 1;
      continue;
    }

    await client.query(
      `INSERT INTO catalyst_clusters (symbol, cluster_score, catalyst_count, time_window_hours, dominant_type, created_at)
       VALUES ($1,$2,$3,$4,$5,NOW())`,
      [symbol, clusterScore, catalystCount, QUALITY_MODE.clusterWindowHours, dominantType]
    );

    clusterSummaries.push({
      symbol,
      clusterScore,
      avgSentiment,
      catalystCount,
      dominantType,
      catalystIds: items.map((x) => x.event_uuid).filter(Boolean),
    });
    clusterCount++;
  }

  let signalCount = 0;
  const signalRejections = {
    by_cluster_score: 0,
    by_sentiment_abs: 0,
    by_signal_type: 0,
    by_confidence: 0,
    by_symbol_dedupe: 0,
    by_market_macro_opposes_direction: 0,
    by_market_no_macro_support: 0,
    by_market_sector_neutral: 0,
    by_market_sector_weak_bullish: 0,
    by_market_sector_strong_bearish: 0,
  };

  const signalCandidates: any[] = [];

  const macroRows = await client.query(`
    SELECT theme, summary, confidence, affected_sectors
    FROM macro_narratives
  `);

  const sectorPerfRows = await client.query(`
    SELECT COALESCE(sector, 'Unknown') AS sector, AVG(COALESCE(change_percent, 0)) AS avg_change_percent
    FROM market_quotes
    GROUP BY 1
  `);

  const symbolSectorRows = await client.query(`
    SELECT symbol, COALESCE(sector, 'Unknown') AS sector
    FROM market_quotes
    WHERE symbol IS NOT NULL AND symbol <> ''
  `);

  const parseNarrativeDirection = (summaryRaw: string): number => {
    const s = String(summaryRaw || "").toLowerCase();
    if (s.includes("positive")) return 1;
    if (s.includes("negative")) return -1;
    return 0;
  };

  let macroBiasScore = 0;
  const sectorMacroBias = new Map<string, number>();
  for (const row of macroRows.rows || []) {
    const direction = parseNarrativeDirection(row.summary);
    const confidence = Number(row.confidence || 0);
    const weighted = direction * confidence;
    macroBiasScore += weighted;

    const sectors = Array.isArray(row.affected_sectors) ? row.affected_sectors : [];
    for (const secRaw of sectors) {
      const sec = String(secRaw || "Unknown");
      sectorMacroBias.set(sec, Number(sectorMacroBias.get(sec) || 0) + weighted);
    }
  }

  const sectorPerf = new Map<string, number>();
  for (const row of sectorPerfRows.rows || []) {
    sectorPerf.set(String(row.sector || "Unknown"), Number(row.avg_change_percent || 0));
  }

  const symbolSector = new Map<string, string>();
  for (const row of symbolSectorRows.rows || []) {
    symbolSector.set(String(row.symbol || "").toUpperCase(), String(row.sector || "Unknown"));
  }

  const strategyPerformanceRows = await client.query(
    `SELECT signal_type, win_rate, sample_size
     FROM strategy_performance`
  ).catch(() => ({ rows: [] }));

  const strategyWinRate = new Map<string, number>();
  for (const row of strategyPerformanceRows.rows || []) {
    const sampleSize = Number(row.sample_size || 0);
    if (sampleSize < 10) {
      continue;
    }
    strategyWinRate.set(String(row.signal_type || "").toLowerCase(), Number(row.win_rate || 0.5));
  }

  const now = new Date();
  const marketSession = classifyMarketSession(now);
  const sessionMultiplier = getSessionMultiplier(marketSession);
  const currentUkMinute = toUkMinutes(now);
  const contextBySymbol = new Map<string, { currentVolume: number; avgVolume5d: number; rvol: number }>();

  const contextSymbols = Array.from(new Set(clusterSummaries.map((cluster) => String(cluster.symbol || "").toUpperCase()).filter(Boolean)));
  if (contextSymbols.length > 0) {
    const volumeSnapshots = await client.query(
      `WITH base AS (
         SELECT
           UPPER(i.symbol) AS symbol,
           (i.timestamp AT TIME ZONE 'Europe/London')::date AS uk_day,
           (EXTRACT(HOUR FROM (i.timestamp AT TIME ZONE 'Europe/London'))::int * 60)
             + EXTRACT(MINUTE FROM (i.timestamp AT TIME ZONE 'Europe/London'))::int AS uk_minute,
           COALESCE(i.volume, 0)::double precision AS volume
         FROM intraday_1m i
         WHERE UPPER(i.symbol) = ANY($1::text[])
           AND i.timestamp >= NOW() - INTERVAL '14 days'
       ),
       daily_cumulative AS (
         SELECT
           symbol,
           uk_day,
           SUM(volume) FILTER (WHERE uk_minute <= $2::int) AS cumulative_volume
         FROM base
         GROUP BY symbol, uk_day
       ),
       ranked_history AS (
         SELECT
           symbol,
           uk_day,
           COALESCE(cumulative_volume, 0) AS cumulative_volume,
           ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY uk_day DESC) AS day_rank
         FROM daily_cumulative
         WHERE uk_day < (NOW() AT TIME ZONE 'Europe/London')::date
       ),
       hist AS (
         SELECT
           symbol,
           AVG(cumulative_volume) AS avg_volume_5d
         FROM ranked_history
         WHERE day_rank <= 5
         GROUP BY symbol
       ),
       todays AS (
         SELECT
           symbol,
           COALESCE(cumulative_volume, 0) AS current_volume
         FROM daily_cumulative
         WHERE uk_day = (NOW() AT TIME ZONE 'Europe/London')::date
       ),
       quote_fallback AS (
         SELECT UPPER(symbol) AS symbol, COALESCE(volume, 0)::double precision AS quote_volume
         FROM market_quotes
         WHERE UPPER(symbol) = ANY($1::text[])
       )
       SELECT
         s.symbol,
         COALESCE(t.current_volume, q.quote_volume, 0) AS current_volume,
         COALESCE(h.avg_volume_5d, 0) AS avg_volume_5d
       FROM (SELECT UNNEST($1::text[]) AS symbol) s
       LEFT JOIN todays t ON t.symbol = s.symbol
       LEFT JOIN hist h ON h.symbol = s.symbol
       LEFT JOIN quote_fallback q ON q.symbol = s.symbol`,
      [contextSymbols, currentUkMinute]
    ).catch(() => ({ rows: [] }));

    for (const row of volumeSnapshots.rows || []) {
      const symbol = String(row.symbol || "").toUpperCase();
      if (!symbol) continue;
      const currentVolume = Number(row.current_volume || 0);
      const avgVolume5d = Number(row.avg_volume_5d || 0);
      const rvol = avgVolume5d > 0 ? currentVolume / avgVolume5d : 1;
      contextBySymbol.set(symbol, {
        currentVolume,
        avgVolume5d,
        rvol: Number(clamp(rvol, 0, 25).toFixed(6)),
      });
    }
  }

  for (const cluster of clusterSummaries) {
    const catalystIds = cluster.catalystIds;
    if (!catalystIds.length) continue;

    if (Number(cluster.clusterScore || 0) < QUALITY_MODE.minSignalClusterScore) {
      signalRejections.by_cluster_score += 1;
      continue;
    }

    const sentimentAbs = Math.abs(Number(cluster.avgSentiment || 0));
    if (sentimentAbs < QUALITY_MODE.minSignalSentimentAbs) {
      signalRejections.by_sentiment_abs += 1;
      continue;
    }

    const isBullish = Number(cluster.avgSentiment || 0) >= 0;
    const direction = isBullish ? 1 : -1;

    const hasStrongOpposingMacro = macroBiasScore !== 0 && (direction * macroBiasScore) < 0;
    if (hasStrongOpposingMacro) {
      signalRejections.by_market_macro_opposes_direction += 1;
      continue;
    }

    const sector = symbolSector.get(String(cluster.symbol || "").toUpperCase()) || "Unknown";
    const sectorStrength = Number(sectorPerf.get(sector) || 0);
    const sectorMacroStrength = Number(sectorMacroBias.get(sector) || 0);
    const hasSectorMacroContext = sectorMacroBias.has(sector);

    if (Math.abs(sectorStrength) < 0.1) {
      signalRejections.by_market_sector_neutral += 1;
      continue;
    }

    if (hasSectorMacroContext) {
      if (isBullish && sectorMacroStrength <= 0) {
        signalRejections.by_market_no_macro_support += 1;
        continue;
      }

      if (!isBullish && sectorMacroStrength >= 0) {
        signalRejections.by_market_no_macro_support += 1;
        continue;
      }
    }

    if (isBullish && (sectorStrength < 0 || sectorMacroStrength < 0)) {
      signalRejections.by_market_sector_weak_bullish += 1;
      continue;
    }

    if (!isBullish && (sectorStrength > 0 || sectorMacroStrength > 0)) {
      signalRejections.by_market_sector_strong_bearish += 1;
      continue;
    }

    let signalType: string | null = null;
    if (cluster.dominantType === "earnings") {
      signalType = "earnings breakout";
    } else if (["news", "product", "analyst", "corporate", "ipo", "split"].includes(String(cluster.dominantType || ""))) {
      signalType = "news momentum";
    } else {
      signalType = "macro alignment";
    }

    if (!["earnings breakout", "news momentum", "macro alignment"].includes(signalType)) {
      signalRejections.by_signal_type += 1;
      continue;
    }

    const score = Number(clamp(Number(cluster.clusterScore || 0) / 100, 0, 1).toFixed(6));
    const baseConfidence = Number((((Number(cluster.clusterScore || 0) / 100) * 0.7) + (sentimentAbs * 0.3)).toFixed(6));
    const observedWinRate = Number(strategyWinRate.get(String(signalType).toLowerCase()) || 0.5);
    const confidenceAdjusted = Number(clamp(baseConfidence * (observedWinRate / 0.5), 0, 1).toFixed(6));
    if (confidenceAdjusted < QUALITY_MODE.minSignalConfidence) {
      signalRejections.by_confidence += 1;
      continue;
    }

    const symbol = String(cluster.symbol || "").toUpperCase();
    const symbolContext = contextBySymbol.get(symbol);
    const rvol = Number(symbolContext?.rvol || 1);
    const volumeMultiplier = getVolumeMultiplier(rvol);
    const confidenceContextual = Number(clamp(confidenceAdjusted * sessionMultiplier * volumeMultiplier, 0, 0.99).toFixed(6));

    signalCandidates.push({
      symbol,
      signalType,
      score,
      confidence: confidenceAdjusted,
      confidenceContextual,
      marketSession,
      sessionMultiplier,
      rvol,
      volumeMultiplier,
      catalystIds,
    });
  }

  signalCandidates.sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0));

  const bestSignalBySymbol = new Map<string, any>();
  for (const candidate of signalCandidates) {
    const symbol = String(candidate.symbol || "").trim().toUpperCase();
    if (!symbol) continue;
    if (bestSignalBySymbol.has(symbol)) {
      signalRejections.by_symbol_dedupe += 1;
      continue;
    }
    bestSignalBySymbol.set(symbol, candidate);
  }

  const selectedSignals = Array.from(bestSignalBySymbol.values()).sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0));
  for (const signal of selectedSignals) {
    await client.query(
      `INSERT INTO signals (
         symbol, signal_type, score, confidence, confidence_contextual,
         market_session, session_multiplier, rvol, volume_multiplier,
         catalyst_ids, created_at
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::uuid[],NOW())`,
      [
        signal.symbol,
        signal.signalType,
        signal.score,
        signal.confidence,
        signal.confidenceContextual,
        signal.marketSession,
        signal.sessionMultiplier,
        signal.rvol,
        signal.volumeMultiplier,
        signal.catalystIds,
      ]
    );
    signalCount++;
  }

  writeContextImpactLog({
    generated_at: new Date().toISOString(),
    market_session: marketSession,
    layer: "signal_context",
    items: selectedSignals.map((signal) => ({
      symbol: signal.symbol,
      base_confidence: Number(signal.confidence || 0),
      confidence_contextual: Number(signal.confidenceContextual || 0),
      confidence_percent: toConfidencePercent(signal.confidence),
      confidence_context_percent: toConfidencePercent(signal.confidenceContextual),
      session: signal.marketSession,
      session_multiplier: Number(signal.sessionMultiplier || 1),
      rvol: Number(signal.rvol || 1),
      volume_multiplier: Number(signal.volumeMultiplier || 1),
    })),
  });

  return {
    clusters: clusterCount,
    signals: signalCount,
    filterImpact: {
      clusters: {
        before: provisionalClusters.length,
        after: clusterCount,
        rejections: clusterRejections,
      },
      signals: {
        before: signalCandidates.length,
        after: signalCount,
        rejections: signalRejections,
      },
    },
  };
}

export async function buildOpportunities(client: any): Promise<{ count: number; filterImpact: any }> {
  const rows = await client.query(`
    SELECT
      s.id,
      s.symbol,
      s.signal_type,
      s.score,
      s.confidence,
      s.confidence_contextual,
      s.market_session,
      s.session_multiplier,
      s.rvol,
      s.volume_multiplier,
      s.catalyst_ids,
      q.price,
      COALESCE(cs.avg_sentiment, 0) AS avg_sentiment
    FROM signals s
    LEFT JOIN market_quotes q ON q.symbol = s.symbol
    LEFT JOIN LATERAL (
      SELECT AVG(COALESCE(ce.sentiment_score, 0)) AS avg_sentiment
      FROM catalyst_events ce
      WHERE ce.event_uuid = ANY(s.catalyst_ids)
    ) cs ON TRUE
    WHERE q.price IS NOT NULL
  `);

  let inserted = 0;
  const candidates: any[] = [];
  const opportunityRejections = {
    by_confidence: 0,
    by_expected_move_percent: 0,
    by_cluster_score: 0,
    by_symbol_dedupe: 0,
    by_global_top_n: 0,
  };

  for (const row of rows.rows) {
    const entry = Number(row.price);
    if (!(entry > 0)) continue;

    const avgSentiment = Number(row.avg_sentiment || 0);
    const bullish = avgSentiment >= 0;
    const bearish = avgSentiment < 0;

    if (!bullish && !bearish) continue;

    const riskPct = 0.03;
    const stopLoss = bullish ? entry * (1 - riskPct) : entry * (1 + riskPct);
    const takeProfit = bullish ? entry * (1 + riskPct * 2) : entry * (1 - riskPct * 2);
    const expectedMovePercent = Math.abs(((takeProfit - entry) / entry) * 100);
    const strategy = bullish ? "momentum_long" : "momentum_short";

    const confidence = Number(row.confidence || 0);
    const confidenceContextual = Number(row.confidence_contextual || confidence);
    const clusterScore = Number(row.score || 0) * 100;

    if (confidenceContextual < QUALITY_MODE.minOpportunityConfidence) {
      opportunityRejections.by_confidence += 1;
      continue;
    }

    if (expectedMovePercent < QUALITY_MODE.minOpportunityMovePct) {
      opportunityRejections.by_expected_move_percent += 1;
      continue;
    }

    if (clusterScore < QUALITY_MODE.minOpportunityClusterScore) {
      opportunityRejections.by_cluster_score += 1;
      continue;
    }

    const convictionScore = Number((
      confidenceContextual * 0.5
      + (clusterScore / 100) * 0.3
      + (expectedMovePercent / 10) * 0.2
    ).toFixed(6));

    candidates.push({
      ...row,
      entry,
      stopLoss,
      takeProfit,
      expectedMovePercent,
      strategy,
      clusterScore,
      confidence,
      confidenceContextual,
      marketSession: row.market_session || null,
      sessionMultiplier: Number(row.session_multiplier || 1),
      rvol: Number(row.rvol || 1),
      volumeMultiplier: Number(row.volume_multiplier || 1),
      convictionScore,
    });
  }

  candidates.sort((a, b) => Number(b.convictionScore || 0) - Number(a.convictionScore || 0));

  const bestBySymbol = new Map<string, any>();
  for (const candidate of candidates) {
    const symbol = String(candidate.symbol || "").trim().toUpperCase();
    if (!symbol) continue;
    if (bestBySymbol.has(symbol)) {
      opportunityRejections.by_symbol_dedupe += 1;
      continue;
    }
    bestBySymbol.set(symbol, candidate);
  }

  const deduped = Array.from(bestBySymbol.values()).sort((a, b) => Number(b.convictionScore || 0) - Number(a.convictionScore || 0));
  const selected = deduped.slice(0, QUALITY_MODE.maxOpportunitiesGlobal);
  if (deduped.length > selected.length) {
    opportunityRejections.by_global_top_n += deduped.length - selected.length;
  }

  for (const row of selected) {
    await client.query(
      `INSERT INTO opportunities (
        symbol, score, strategy, entry, stop_loss, take_profit,
        expected_move_percent, confidence, confidence_contextual,
        market_session, session_multiplier, rvol, volume_multiplier,
        signal_ids, updated_at, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::uuid[],NOW(),NOW())`,
      [
        row.symbol,
        row.score,
        row.strategy,
        row.entry,
        row.stopLoss,
        row.takeProfit,
        row.expectedMovePercent,
        row.confidence,
        row.confidenceContextual,
        row.marketSession,
        row.sessionMultiplier,
        row.rvol,
        row.volumeMultiplier,
        [row.id],
      ]
    );

    inserted++;
  }

  writeContextImpactLog({
    generated_at: new Date().toISOString(),
    layer: "opportunity_context",
    items: selected.map((row) => ({
      symbol: String(row.symbol || "").toUpperCase(),
      base_confidence: Number(row.confidence || 0),
      confidence_contextual: Number(row.confidenceContextual || row.confidence || 0),
      confidence_percent: toConfidencePercent(row.confidence),
      confidence_context_percent: toConfidencePercent(row.confidenceContextual || row.confidence),
      session: row.marketSession || null,
      session_multiplier: Number(row.sessionMultiplier || 1),
      rvol: Number(row.rvol || 1),
      volume_multiplier: Number(row.volumeMultiplier || 1),
    })),
  });

  return {
    count: inserted,
    filterImpact: {
      opportunities: {
        before: rows.rows.length,
        after: inserted,
        rejections: opportunityRejections,
      },
    },
  };
}
