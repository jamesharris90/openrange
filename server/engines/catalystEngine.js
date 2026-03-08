const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');

const TICKER_REGEX = /\b[A-Z]{2,5}\b/g;
const FALSE_POSITIVE_TOKENS = new Set([
  'A', 'AN', 'AND', 'ARE', 'AS', 'AT', 'BY', 'FOR', 'FROM', 'IN', 'INTO', 'IS', 'IT',
  'NEW', 'NOT', 'NOW', 'OF', 'ON', 'OR', 'OUT', 'THE', 'TO', 'US', 'USA', 'WAS', 'WITH',
]);

const CATALYST_RULES = [
  {
    type: 'FDA approval',
    keywords: ['fda approval', 'fda approves', 'approved by the fda', 'clearance', 'breakthrough therapy'],
  },
  {
    type: 'earnings',
    keywords: ['earnings', 'eps', 'guidance', 'revenue beat', 'quarter results', 'q1', 'q2', 'q3', 'q4'],
  },
  {
    type: 'analyst upgrade',
    keywords: ['upgrade', 'raised to buy', 'overweight', 'price target raised', 'outperform'],
  },
  {
    type: 'analyst downgrade',
    keywords: ['downgrade', 'cut to hold', 'underperform', 'sell rating', 'price target cut'],
  },
  {
    type: 'government contract',
    keywords: ['government contract', 'defense contract', 'department of', 'pentagon', 'nasa', 'dod award'],
  },
  {
    type: 'acquisition',
    keywords: ['acquire', 'acquisition', 'merger', 'buyout', 'takeover'],
  },
  {
    type: 'sector news',
    keywords: ['sector', 'industry-wide', 'peer group', 'semiconductor sector', 'energy sector'],
  },
  {
    type: 'macro news',
    keywords: ['fed', 'fomc', 'rates', 'inflation', 'cpi', 'ppi', 'jobs report', 'treasury yield', 'gdp'],
  },
];

const IMPACT_SCORES = {
  'earnings': 9,
  'FDA approval': 10,
  'analyst upgrade': 6,
  'analyst downgrade': 6,
  'government contract': 8,
  'acquisition': 7,
  'sector news': 4,
  'macro news': 3,
};

const BULLISH_KEYWORDS = ['beat', 'raises', 'approval', 'contract win', 'surge', 'upgrade', 'record revenue', 'buyback'];
const BEARISH_KEYWORDS = ['miss', 'cuts', 'downgrade', 'investigation', 'delay', 'lawsuit', 'warning', 'recall'];

function toText(value) {
  return String(value || '').trim();
}

function classifyCatalyst(headline = '') {
  const text = toText(headline).toLowerCase();
  for (const rule of CATALYST_RULES) {
    if (rule.keywords.some((keyword) => text.includes(keyword))) {
      return rule.type;
    }
  }
  return 'macro news';
}

function detectSentiment(headline = '') {
  const text = toText(headline).toLowerCase();
  if (BULLISH_KEYWORDS.some((keyword) => text.includes(keyword))) return 'bullish';
  if (BEARISH_KEYWORDS.some((keyword) => text.includes(keyword))) return 'bearish';
  return 'neutral';
}

function extractTickers(headline, validSymbolsSet) {
  const matches = toText(headline).match(TICKER_REGEX) || [];
  const unique = new Set(matches.map((token) => token.toUpperCase()));
  return Array.from(unique).filter(
    (symbol) => !FALSE_POSITIVE_TOKENS.has(symbol) && validSymbolsSet.has(symbol)
  );
}

async function ensureNewsCatalystsTable() {
  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS news_catalysts (
      id BIGSERIAL PRIMARY KEY,
      symbol TEXT NOT NULL,
      catalyst_type TEXT NOT NULL,
      headline TEXT NOT NULL,
      source TEXT,
      sentiment TEXT NOT NULL,
      impact_score INTEGER NOT NULL,
      published_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(symbol, catalyst_type, headline, published_at)
    )`,
    [],
    { timeoutMs: 7000, label: 'engines.catalyst.ensure_table', maxRetries: 0 }
  );
}

async function getValidSymbolsSet() {
  const { rows } = await queryWithTimeout(
    `SELECT DISTINCT UPPER(symbol) AS symbol
     FROM market_quotes
     WHERE symbol ~ '^[A-Z]{2,5}$'`,
    [],
    { timeoutMs: 7000, label: 'engines.catalyst.market_quotes_symbols', maxRetries: 0 }
  );
  return new Set(rows.map((row) => row.symbol).filter(Boolean));
}

async function getCandidateHeadlines() {
  const { rows } = await queryWithTimeout(
    `SELECT id, headline, source, published_at
     FROM news_articles
     WHERE published_at >= NOW() - interval '72 hours'
       AND headline IS NOT NULL
       AND LENGTH(TRIM(headline)) > 0
     ORDER BY published_at DESC`,
    [],
    { timeoutMs: 10000, label: 'engines.catalyst.news_articles_recent', maxRetries: 0 }
  );
  return rows;
}

function buildCatalystRows(newsRows, validSymbolsSet) {
  let tickersDetected = 0;
  const catalystRows = [];

  for (const row of newsRows) {
    const symbols = extractTickers(row.headline, validSymbolsSet);
    if (!symbols.length) continue;

    tickersDetected += symbols.length;
    const catalystType = classifyCatalyst(row.headline);
    const sentiment = detectSentiment(row.headline);
    const impactScore = IMPACT_SCORES[catalystType] || 3;

    for (const symbol of symbols) {
      catalystRows.push({
        symbol,
        catalyst_type: catalystType,
        headline: toText(row.headline),
        source: toText(row.source) || null,
        sentiment,
        impact_score: impactScore,
        published_at: row.published_at,
      });
    }
  }

  return { catalystRows, tickersDetected };
}

async function upsertCatalysts(catalystRows) {
  if (!catalystRows.length) return 0;
  let upserted = 0;

  for (const row of catalystRows) {
    const result = await queryWithTimeout(
      `INSERT INTO news_catalysts (
         symbol,
         catalyst_type,
         headline,
         source,
         sentiment,
         impact_score,
         published_at,
         updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (symbol, catalyst_type, headline, published_at)
       DO UPDATE SET
         source = EXCLUDED.source,
         sentiment = EXCLUDED.sentiment,
         impact_score = EXCLUDED.impact_score,
         updated_at = NOW()`,
      [
        row.symbol,
        row.catalyst_type,
        row.headline,
        row.source,
        row.sentiment,
        row.impact_score,
        row.published_at,
      ],
      { timeoutMs: 7000, label: 'engines.catalyst.upsert', maxRetries: 0 }
    );
    upserted += result.rowCount || 0;
  }

  return upserted;
}

async function runCatalystEngine() {
  await ensureNewsCatalystsTable();

  const [validSymbolsSet, newsRows] = await Promise.all([
    getValidSymbolsSet(),
    getCandidateHeadlines(),
  ]);

  const { catalystRows, tickersDetected } = buildCatalystRows(newsRows, validSymbolsSet);
  const upserted = await upsertCatalysts(catalystRows);

  const result = {
    headlinesParsed: newsRows.length,
    tickersDetected,
    catalystsStored: upserted,
  };

  logger.info('[CATALYST_ENGINE] run complete', result);
  return result;
}

module.exports = {
  runCatalystEngine,
  classifyCatalyst,
  detectSentiment,
};
