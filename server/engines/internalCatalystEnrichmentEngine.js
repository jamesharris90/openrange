const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');

async function runInternalCatalystEnrichmentEngine() {
  const startedAt = Date.now();

  const { rows } = await queryWithTimeout(
    `SELECT id, symbol
     FROM opportunity_stream
     WHERE source = 'real'
       AND event_type = 'internal_scanner'
     ORDER BY score DESC
     LIMIT 50`,
    [],
    { timeoutMs: 10000, label: 'engines.internalCatalystEnrichment.select_stream', maxRetries: 0 }
  );

  if (!rows.length) {
    throw new Error('internal catalyst enrichment found no internal scanner rows');
  }

  let earningsTagged = 0;
  let newsTagged = 0;
  for (const row of rows) {
    const news = await queryWithTimeout(
      `SELECT COALESCE(headline, title, summary) AS headline
       FROM news_articles
       WHERE UPPER(symbol) = UPPER($1)
       ORDER BY COALESCE(published_at, created_at) DESC
       LIMIT 1`,
      [row.symbol],
      { timeoutMs: 5000, label: 'engines.internalCatalystEnrichment.latest_news', maxRetries: 0 }
    );

    const earnings = await queryWithTimeout(
      `SELECT 1
       FROM earnings_events
       WHERE UPPER(symbol) = UPPER($1)
         AND report_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
       LIMIT 1`,
      [row.symbol],
      { timeoutMs: 5000, label: 'engines.internalCatalystEnrichment.earnings_flag', maxRetries: 0 }
    );

    const headline = news.rows?.[0]?.headline || null;
    const earningsFlag = (earnings.rowCount || 0) > 0;
    let catalystType = 'price_volume';
    if (earningsFlag) {
      catalystType = 'earnings';
      earningsTagged += 1;
    } else if (headline) {
      catalystType = 'news';
      newsTagged += 1;
    }

    await queryWithTimeout(
      `UPDATE opportunity_stream
       SET headline = COALESCE($2, headline),
           earnings_flag = $3,
           catalyst_type = $4,
           updated_at = NOW()
       WHERE id = $1`,
      [row.id, headline, earningsFlag, catalystType],
      { timeoutMs: 5000, label: 'engines.internalCatalystEnrichment.update_stream', maxRetries: 0 }
    );
  }

  const ts = new Date().toISOString();
  logger.info('[CATALYST ENRICHMENT]', {
    count: rows.length,
    earningsTagged,
    newsTagged,
    timestamp: ts,
    runtimeMs: Date.now() - startedAt,
  });

  return {
    count: rows.length,
    earningsTagged,
    newsTagged,
    timestamp: ts,
    runtimeMs: Date.now() - startedAt,
  };
}

module.exports = {
  runInternalCatalystEnrichmentEngine,
};
