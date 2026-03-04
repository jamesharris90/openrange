const fs = require('fs').promises;
const path = require('path');
const { pool } = require('../db/pg');
const logger = require('../logger');
const { getScoringRules } = require('../config/intelligenceConfig');

const BATCH_SIZE = 500;
const RECENT_WINDOW_HOURS = 24;

const POSITIVE_KEYWORDS = ['beat', 'upgrade', 'approval', 'partnership'];
const NEGATIVE_KEYWORDS = ['downgrade', 'lawsuit', 'recall'];

async function ensureCatalystTable() {
  const sqlPath = path.join(__dirname, '..', 'migrations', 'create_trade_catalysts.sql');
  const sql = await fs.readFile(sqlPath, 'utf8');
  await pool.query(sql);
}

function tokenizeHeadline(text) {
  if (!text) return [];
  const matches = String(text).toUpperCase().match(/\b[A-Z]{1,5}\b/g);
  return matches || [];
}

function normalizeSymbols(symbolsValue, headline, summary) {
  const symbols = [];

  if (Array.isArray(symbolsValue)) {
    symbols.push(...symbolsValue);
  }

  symbols.push(...tokenizeHeadline(headline));
  symbols.push(...tokenizeHeadline(summary));

  return [...new Set(
    symbols
      .map((value) => String(value || '').toUpperCase().trim())
      .filter(Boolean)
  )];
}

function classifySentiment(text) {
  const lower = String(text || '').toLowerCase();

  const positiveHits = POSITIVE_KEYWORDS.filter((word) => lower.includes(word)).length;
  const negativeHits = NEGATIVE_KEYWORDS.filter((word) => lower.includes(word)).length;

  if (positiveHits > negativeHits) return 'positive';
  if (negativeHits > positiveHits) return 'negative';
  return 'neutral';
}

function classifyCatalyst(text, catalystScores) {
  const lower = String(text || '').toLowerCase();

  const fdaScore = Number(catalystScores.fda || 6);
  const earningsScore = Number(catalystScores.earnings || 5);
  const analystScore = Number(catalystScores.analyst_upgrade || 4);
  const generalScore = Number(catalystScores.general_news || 2);

  if (/(fda|approval|approved|clearance)/i.test(lower)) {
    return { catalyst_type: 'FDA / approvals', score: fdaScore };
  }

  if (/(earnings|eps|revenue|guidance|beat|miss)/i.test(lower)) {
    return { catalyst_type: 'earnings', score: earningsScore };
  }

  if (/(analyst|upgrade|downgrade)/i.test(lower)) {
    return { catalyst_type: 'analyst upgrade', score: analystScore };
  }

  return { catalyst_type: 'general news', score: generalScore };
}

async function getUniverseSet() {
  const { rows } = await pool.query(
    `SELECT symbol
     FROM ticker_universe
     WHERE is_active = TRUE`
  );

  return new Set(rows.map((row) => String(row.symbol || '').toUpperCase()));
}

async function getRecentNewsRows() {
  const { rows } = await pool.query(
    `SELECT headline,
            source,
            published_at,
            summary,
            symbols
     FROM news_articles
     WHERE published_at >= NOW() - ($1::text || ' hours')::interval
     ORDER BY published_at DESC
     LIMIT 2000`,
    [String(RECENT_WINDOW_HOURS)]
  );

  return rows;
}

function buildCatalysts(newsRows, universeSet, catalystScores) {
  const catalystRows = [];

  for (const row of newsRows) {
    const headline = row.headline || '';
    const summary = row.summary || '';
    const combined = `${headline} ${summary}`.trim();

    const symbols = normalizeSymbols(row.symbols, headline, summary)
      .filter((symbol) => universeSet.has(symbol));

    if (!symbols.length || !headline || !row.published_at) continue;

    const sentiment = classifySentiment(combined);
    const { catalyst_type, score } = classifyCatalyst(combined, catalystScores);

    for (const symbol of symbols) {
      catalystRows.push({
        symbol,
        catalyst_type,
        headline,
        source: row.source || 'news',
        sentiment,
        published_at: row.published_at,
        score,
      });
    }
  }

  return catalystRows;
}

async function upsertCatalysts(rows) {
  if (!rows.length) return 0;

  const payload = JSON.stringify(rows);

  await pool.query(
    `INSERT INTO trade_catalysts (
       symbol,
       catalyst_type,
       headline,
       source,
       sentiment,
       published_at,
       score,
       created_at
     )
     SELECT symbol,
            catalyst_type,
            headline,
            source,
            sentiment,
            published_at,
            score,
            NOW()
     FROM jsonb_to_recordset($1::jsonb) AS x(
       symbol text,
       catalyst_type text,
       headline text,
       source text,
       sentiment text,
       published_at timestamp,
       score numeric
     )
     ON CONFLICT (symbol, headline, published_at, catalyst_type) DO UPDATE
     SET source = EXCLUDED.source,
         sentiment = EXCLUDED.sentiment,
         score = EXCLUDED.score,
         created_at = NOW()`,
    [payload]
  );

  return rows.length;
}

async function runCatalystEngine() {
  const startedAt = Date.now();

  try {
    await ensureCatalystTable();

    const [newsRows, universeSet] = await Promise.all([
      getRecentNewsRows(),
      getUniverseSet(),
    ]);

    const catalystScores = getScoringRules()?.catalyst_scores || {};

    const catalystRows = buildCatalysts(newsRows, universeSet, catalystScores);

    let inserted = 0;
    for (let index = 0; index < catalystRows.length; index += BATCH_SIZE) {
      const batch = catalystRows.slice(index, index + BATCH_SIZE);
      inserted += await upsertCatalysts(batch);
    }

    const result = {
      news_processed: newsRows.length,
      catalysts_detected: catalystRows.length,
      catalysts_upserted: inserted,
      runtimeMs: Date.now() - startedAt,
    };

    logger.info('catalyst engine complete', {
      scope: 'catalyst',
      ...result,
    });

    return result;
  } catch (err) {
    logger.error('catalyst engine failed', {
      scope: 'catalyst',
      error: err.message,
    });

    return {
      news_processed: 0,
      catalysts_detected: 0,
      catalysts_upserted: 0,
      runtimeMs: Date.now() - startedAt,
      error: err.message,
    };
  }
}

module.exports = {
  runCatalystEngine,
  ensureCatalystTable,
};
