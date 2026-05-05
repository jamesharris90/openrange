'use strict';

/**
 * News Enrichment Engine
 *
 * Runs every 10 minutes. For every news article ingested in the last 48h
 * that has not yet been enriched (priority_score = 0, source_type IS NULL):
 *
 *   1. Classify source_type   (FMP / RSS / EMAIL / OTHER)
 *   2. Extract detected_symbols from headline via regex → validated against ticker_universe
 *   3. Compute priority_score (base by source + keyword/recency boosts)
 *   4. Detect catalyst_cluster (EARNINGS / FDA / LEGAL / MERGER / ANALYST / OFFERING)
 *   5. Batch-update news_articles
 *
 * This replaces the hardcoded news_score=0 that FMP ingestion writes.
 */

const { queryWithTimeout } = require('../db/pg');
const logger = require('../utils/logger');

// ─── source classification ────────────────────────────────────────────────────

const SOURCE_TYPE_RULES = [
  { match: (row) => row.provider === 'fmp' && row.catalyst_type === 'stock_news', type: 'FMP' },
  { match: (row) => row.catalyst_type === 'rss',                                  type: 'RSS' },
  { match: (row) => row.provider === 'email' || /email/i.test(row.catalyst_type), type: 'EMAIL' },
];

function classifySourceType(row) {
  for (const rule of SOURCE_TYPE_RULES) {
    if (rule.match(row)) return rule.type;
  }
  return 'OTHER';
}

// ─── source base scores ───────────────────────────────────────────────────────

const HIGH_TIER_SOURCES   = new Set(['reuters', 'bloomberg', 'wsj', 'wall street journal', 'ft', 'financial times']);
const MEDIUM_TIER_SOURCES = new Set(['yahoo', 'benzinga', 'marketwatch', 'cnbc', 'seeking alpha', 'barrons', 'thestreet']);

function sourceBaseScore(source) {
  const s = String(source || '').toLowerCase();
  if (HIGH_TIER_SOURCES.has(s))   return 3;
  if (MEDIUM_TIER_SOURCES.has(s)) return 2;
  return 1;
}

// ─── keyword boost ────────────────────────────────────────────────────────────

function buildWordBoundaryRegex(terms) {
  return new RegExp(`\\b(?:${terms.join('|')})\\b`, 'i');
}

const HIGH_KEYWORD_RE = buildWordBoundaryRegex([
  'earnings',
  'eps',
  'revenue',
  'guidance',
  'fda',
  'merger',
  'acquisition',
  'lawsuit',
  'settlement',
  'upgrade',
  'downgrade',
  'beat(?:s|en|ing)?',
  'miss(?:es|ed|ing)?',
  'buyout',
  'takeover',
]);
const MULTI_SYMBOL_THRESHOLD = 2;

// ─── catalyst cluster detection ───────────────────────────────────────────────

const CLUSTER_THEMES = [
  {
    key: 'EARNINGS',
    re: buildWordBoundaryRegex(['earnings', 'eps', 'revenue', 'guidance', 'beat(?:s|en|ing)?', 'miss(?:es|ed|ing)?', 'quarterly']),
  },
  {
    key: 'FDA',
    re: buildWordBoundaryRegex(['fda', 'drug', 'approval', 'trial', 'phase\\s*[123]', 'clinical']),
  },
  {
    key: 'LEGAL',
    re: buildWordBoundaryRegex(['lawsuit', 'litigation', 'sec', 'fraud', 'settlement', 'class\\s+action']),
  },
  {
    key: 'MERGER',
    re: buildWordBoundaryRegex(['merger', 'acquisition', 'buyout', 'takeover', 'deal', 'combine']),
  },
  {
    key: 'ANALYST',
    re: buildWordBoundaryRegex(['upgrade', 'downgrade', 'price target', 'outperform', 'underperform', 'initiat(?:e|es|ed|ing|ion|ions)?']),
  },
  {
    key: 'OFFERING',
    re: buildWordBoundaryRegex(['offering', 'secondary', 'dilution', 'share issuance']),
  },
];

function detectCluster(headline, summary) {
  const text = String(headline || '') + ' ' + String(summary || '');
  for (const theme of CLUSTER_THEMES) {
    if (theme.re.test(text)) return theme.key;
  }
  return null;
}

// ─── symbol extraction ────────────────────────────────────────────────────────

const TICKER_RE = /\b([A-Z]{2,5})\b/g;

// Common English words that match the ticker pattern — filter these out
const STOP_WORDS = new Set([
  'A','AN','AM','AT','BE','BY','DO','GO','HE','IF','IN','IS','IT','ME','MY',
  'NO','OF','ON','OR','SO','TO','UP','US','WE','AS','FOR','AND','THE','ARE',
  'BUT','CAN','CEO','CFO','COO','CTO','IPO','GDP','CPI','NFP','ETF','FDA',
  'SEC','NYSE','NASDAQ','OTC','ADR','AMC','BMO','EST','EDT','PDT','PST',
  'USD','EUR','GBP','JPY','CAD','AUD','GAAP','EBIT','EPS','Q1','Q2','Q3','Q4',
  'AI','ML','PR','IR','HR','IT','US','UK','EU','UN','IMF','WHO','NEW','NOW',
  'MAY','JUNE','JULY','AUG','SEP','OCT','NOV','DEC','JAN','FEB','MAR','APR',
  'YOY','QOQ','MOM','YTD','TTM','PE','PB','PS','DIV',
]);

function extractTickers(text) {
  const matches = new Set();
  let m;
  TICKER_RE.lastIndex = 0;
  while ((m = TICKER_RE.exec(text)) !== null) {
    const t = m[1];
    if (!STOP_WORDS.has(t)) matches.add(t);
  }
  return Array.from(matches);
}

// ─── main enrichment run ──────────────────────────────────────────────────────

async function runNewsEnrichmentEngine() {
  const t0 = Date.now();

  // Load known ticker universe into a Set (once per run, cheap lookup)
  let knownSymbols;
  try {
    const { rows } = await queryWithTimeout(
      `SELECT symbol FROM ticker_universe`,
      [], { timeoutMs: 15000, label: 'news_enrichment.load_universe', maxRetries: 0 }
    );
    knownSymbols = new Set(rows.map(r => r.symbol));
  } catch (err) {
    logger.warn('[NEWS ENRICHMENT] universe load failed — using empty set', { error: err.message });
    knownSymbols = new Set();
  }

  // Fetch unenriched articles from last 48h
  let articles;
  try {
    const { rows } = await queryWithTimeout(`
      SELECT id, symbol, symbols, headline, summary, source, provider, catalyst_type,
             published_at, created_at
      FROM news_articles
      WHERE published_at > NOW() - INTERVAL '48 hours'
        AND (source_type IS NULL OR priority_score = 0)
      ORDER BY published_at DESC
      LIMIT 1000
    `, [], { timeoutMs: 20000, label: 'news_enrichment.fetch', maxRetries: 0 });
    articles = rows;
  } catch (err) {
    logger.warn('[NEWS ENRICHMENT] fetch failed', { error: err.message });
    return { enriched: 0 };
  }

  if (articles.length === 0) {
    logger.info('[NEWS ENRICHMENT] no unenriched articles');
    return { enriched: 0 };
  }

  // Enrich each article in memory
  const enriched = articles.map(row => {
    // 1. Source type
    const source_type = classifySourceType(row);

    // 2. Detected symbols — headline + summary, validated against ticker_universe
    const text        = String(row.headline || '') + ' ' + String(row.summary || '');
    const candidates  = extractTickers(text);
    const detected    = knownSymbols.size > 0
      ? candidates.filter(t => knownSymbols.has(t))
      : candidates;

    // Merge with existing symbols array (don't lose what was already tagged)
    const existing    = Array.isArray(row.symbols) ? row.symbols : [];
    const allSymbols  = Array.from(new Set([...existing, ...detected]));

    // 3. Priority score
    let score = sourceBaseScore(row.source);
    if (allSymbols.length >= MULTI_SYMBOL_THRESHOLD) score += 2;
    if (HIGH_KEYWORD_RE.test(row.headline))           score += 2;
    const ageMs = Date.now() - new Date(row.published_at).getTime();
    if (ageMs < 6 * 3600 * 1000)                      score += 1;

    // 4. Catalyst cluster
    const catalyst_cluster = detectCluster(row.headline, row.summary);

    return {
      id:               row.id,
      source_type,
      detected_symbols: allSymbols,
      priority_score:   score,
      catalyst_cluster,
    };
  });

  // Batch-update via json_to_recordset — single round-trip
  const sql = `
    UPDATE news_articles na
    SET source_type       = r.source_type,
        detected_symbols  = r.detected_symbols::text[],
        priority_score    = r.priority_score::numeric,
        catalyst_cluster  = r.catalyst_cluster
    FROM json_to_recordset($1::json) AS r(
      id               text,
      source_type      text,
      detected_symbols text,
      priority_score   numeric,
      catalyst_cluster text
    )
    WHERE na.id::text = r.id
  `;

  // Postgres can't pass text[] directly through json_to_recordset — serialise as Postgres literal
  const payload = enriched.map(r => ({
    ...r,
    detected_symbols: r.detected_symbols.length > 0
      ? '{' + r.detected_symbols.map(s => `"${s}"`).join(',') + '}'
      : '{}',
  }));

  try {
    await queryWithTimeout(sql, [JSON.stringify(payload)], {
      timeoutMs: 30000, label: 'news_enrichment.update', maxRetries: 0,
    });
  } catch (err) {
    logger.warn('[NEWS ENRICHMENT] batch update failed', { error: err.message });
    return { enriched: 0 };
  }

  const durationMs = Date.now() - t0;
  console.log(`[NEWS ENRICHMENT] enriched=${enriched.length} duration_ms=${durationMs}`);
  logger.info('[NEWS ENRICHMENT] complete', { enriched: enriched.length, durationMs });

  return { enriched: enriched.length };
}

// ─── exported helpers (used by MCP engine + coverage check) ──────────────────

/**
 * Detect the dominant catalyst cluster from an array of enriched articles.
 * Returns { theme, headline, count } or null if no cluster found.
 */
function detectCatalystCluster(articles) {
  if (!articles || articles.length === 0) return null;

  const buckets = {};
  for (const a of articles) {
    const cluster = a.catalyst_cluster || detectCluster(a.headline, a.summary);
    if (cluster) {
      if (!buckets[cluster]) buckets[cluster] = [];
      buckets[cluster].push(a);
    }
  }

  const sorted = Object.entries(buckets).sort((a, b) => b[1].length - a[1].length);
  if (sorted.length === 0) return null;

  const [theme, clusterArticles] = sorted[0];
  return {
    theme,
    count:   clusterArticles.length,
    topArticle: clusterArticles.reduce(
      (best, a) => (Number(a.priority_score ?? 0) > Number(best.priority_score ?? 0) ? a : best),
      clusterArticles[0]
    ),
  };
}

module.exports = { runNewsEnrichmentEngine, detectCatalystCluster, detectCluster };
