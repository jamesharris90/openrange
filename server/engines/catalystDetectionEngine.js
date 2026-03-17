const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');
const { promoteCatalystSymbol } = require('../services/trackedUniverseService');

const CATALYST_KEYWORDS = [
  { type: 'earnings', patterns: ['earnings', 'eps', 'quarter results', 'revenue beat', 'revenue miss'] },
  { type: 'guidance', patterns: ['guidance', 'outlook', 'raises forecast', 'cuts forecast'] },
  { type: 'analyst_upgrade', patterns: ['upgrade', 'raised to buy', 'overweight', 'price target raised'] },
  { type: 'analyst_downgrade', patterns: ['downgrade', 'cut to hold', 'underperform', 'price target cut'] },
  { type: 'product_launch', patterns: ['launch', 'unveils', 'introduces', 'releases new'] },
  { type: 'merger', patterns: ['merger', 'merge with'] },
  { type: 'acquisition', patterns: ['acquire', 'acquisition', 'buyout', 'takeover'] },
  { type: 'partnership', patterns: ['partnership', 'partners with', 'collaboration'] },
  { type: 'fda_approval', patterns: ['fda', 'approval', 'clearance', 'breakthrough therapy'] },
  { type: 'regulatory', patterns: ['regulatory', 'sec', 'investigation', 'probe', 'compliance'] },
  { type: 'macro', patterns: ['fed', 'fomc', 'inflation', 'cpi', 'ppi', 'rates', 'yield', 'gdp'] },
];

function classifyCatalystType(headline = '') {
  const text = String(headline || '').toLowerCase();
  for (const rule of CATALYST_KEYWORDS) {
    if (rule.patterns.some((pattern) => text.includes(pattern))) {
      return rule.type;
    }
  }
  return 'macro';
}

function sentimentToScore(sentiment = '') {
  const value = String(sentiment || '').toLowerCase();
  if (value === 'positive' || value === 'bullish') return 1;
  if (value === 'negative' || value === 'bearish') return -1;
  return 0;
}

async function fetchNewArticles(limit = 500, options = {}) {
  const onlyMissing = Boolean(options.onlyMissing);
  const { rows } = await queryWithTimeout(
    `WITH candidate AS (
       SELECT
         na.id,
         ABS(MOD((('x' || SUBSTRING(md5(na.id::text), 1, 16))::bit(64)::bigint), 9223372036854775807))::bigint AS news_id,
         na.symbol,
         na.headline,
         COALESCE(na.provider, na.source, 'unknown') AS provider,
         na.published_at,
         COALESCE(na.sentiment, 'neutral') AS sentiment
       FROM news_articles na
       WHERE na.symbol IS NOT NULL
         AND LENGTH(TRIM(COALESCE(na.symbol, ''))) > 0
         AND na.headline IS NOT NULL
         AND na.published_at IS NOT NULL
     )
     SELECT
       c.id,
       c.news_id,
       UPPER(c.symbol) AS symbol,
       c.headline,
       c.provider,
       c.published_at,
       c.sentiment,
       COALESCE(p.provider_count, 1)::int AS provider_count,
       GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - c.published_at)) / 60))::int AS freshness_minutes
     FROM candidate c
     LEFT JOIN LATERAL (
       SELECT COUNT(DISTINCT COALESCE(na2.provider, na2.source, 'unknown')) AS provider_count
       FROM news_articles na2
       WHERE COALESCE(na2.symbol, '') = COALESCE(c.symbol, '')
         AND LOWER(COALESCE(na2.headline, '')) = LOWER(COALESCE(c.headline, ''))
         AND na2.published_at BETWEEN (c.published_at - INTERVAL '60 minutes') AND (c.published_at + INTERVAL '60 minutes')
     ) p ON TRUE
     ${onlyMissing ? `WHERE NOT EXISTS (
       SELECT 1 FROM catalyst_events ce WHERE ce.news_id = c.news_id
     )` : ''}
     ORDER BY c.published_at DESC
     LIMIT $1`,
    [limit],
    { timeoutMs: 12000, label: 'catalyst_detection.fetch_new_articles', maxRetries: 1 }
  );

  return rows;
}

async function insertCatalystEvent(eventRow, options = {}) {
  const insertOnly = Boolean(options.insertOnly);

  const insertSql = insertOnly
    ? `INSERT INTO catalyst_events (
         news_id,
         symbol,
         headline,
         catalyst_type,
         provider_count,
         freshness_minutes,
         sentiment_score,
         published_at,
         created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (news_id) WHERE news_id IS NOT NULL DO NOTHING`
    : `INSERT INTO catalyst_events (
         news_id,
         symbol,
         headline,
         catalyst_type,
         provider_count,
         freshness_minutes,
         sentiment_score,
         published_at,
         created_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (news_id) WHERE news_id IS NOT NULL DO UPDATE SET
         symbol = EXCLUDED.symbol,
         headline = EXCLUDED.headline,
         catalyst_type = EXCLUDED.catalyst_type,
         provider_count = EXCLUDED.provider_count,
         freshness_minutes = EXCLUDED.freshness_minutes,
         sentiment_score = EXCLUDED.sentiment_score,
         published_at = COALESCE(catalyst_events.published_at, EXCLUDED.published_at)`;

  const result = await queryWithTimeout(
    insertSql,
    [
      eventRow.news_id,
      eventRow.symbol,
      eventRow.headline,
      eventRow.catalyst_type,
      eventRow.provider_count,
      eventRow.freshness_minutes,
      eventRow.sentiment_score,
      eventRow.published_at,
    ],
    { timeoutMs: 8000, label: 'catalyst_detection.insert_event', maxRetries: 0 }
  );

  return Number(result.rowCount || 0);
}

async function promoteSignalIntoUniverse(symbol) {
  const normalized = String(symbol || '').trim().toUpperCase();
  if (!normalized) return 0;

  const result = await queryWithTimeout(
    `INSERT INTO tracked_universe
       (symbol, source, priority, added_at, active)
     VALUES ($1, 'signal_promotion', 10, NOW(), true)
     ON CONFLICT(symbol) DO UPDATE
     SET
       active = true,
       priority = GREATEST(tracked_universe.priority, 10)`,
    [normalized],
    { timeoutMs: 7000, label: 'catalyst_detection.promote_signal_universe', maxRetries: 0 }
  );

  return Number(result?.rowCount || 0);
}

async function runCatalystDetectionEngine(options = {}) {
  try {
    const limit = Number(options.limit) > 0 ? Number(options.limit) : 500;
    const onlyMissing = Boolean(options.onlyMissing);
    const rows = await fetchNewArticles(limit, { onlyMissing });
    let inserted = 0;
    let updated = 0;
    let skippedDuplicates = 0;

    for (const row of rows) {
      if (Number(row.provider_count || 0) <= 0) {
        logger.warn('[CATALYST_DETECTION] missing provider data', {
          news_id: row.news_id,
          symbol: row.symbol,
          headline: row.headline,
        });
      }

      const payload = {
        news_id: row.news_id,
        symbol: row.symbol,
        headline: row.headline,
        catalyst_type: classifyCatalystType(row.headline),
        provider_count: row.provider_count,
        freshness_minutes: row.freshness_minutes,
        sentiment_score: sentimentToScore(row.sentiment),
        published_at: row.published_at,
      };
      const rowCount = await insertCatalystEvent(payload, { insertOnly: onlyMissing });
      if (rowCount > 0) {
        await promoteCatalystSymbol(payload.symbol).catch((error) => {
          logger.warn('[CATALYST_DETECTION] tracked universe promotion failed', {
            symbol: payload.symbol,
            error: error.message,
          });
        });
        if (onlyMissing) inserted += rowCount;
        else updated += rowCount;
      } else {
        skippedDuplicates += 1;
      }
    }

    const result = {
      scanned: rows.length,
      inserted,
      updated,
      skippedDuplicates,
      mode: onlyMissing ? 'insert_missing_only' : 'upsert',
    };
    logger.info('[CATALYST_DETECTION] completed', result);
    return result;
  } catch (error) {
    logger.error('[CATALYST_DETECTION] failed', { error: error.message });
    throw error;
  }
}

module.exports = {
  runCatalystDetectionEngine,
  classifyCatalystType,
  promoteSignalIntoUniverse,
};
