const db = require('../db');

async function runSignalNarrativeEngine() {
  try {
    const signalsResult = await db.query(
      `SELECT id, symbol, strategy, class, score, updated_at
       FROM strategy_signals
       WHERE updated_at > NOW() - INTERVAL '24 hours'`
    );

    const signals = Array.isArray(signalsResult?.rows) ? signalsResult.rows : [];
    let attached = 0;

    for (const signal of signals) {
      const duplicate = await db.query(
        `SELECT id
         FROM signal_narratives
         WHERE signal_id = $1
         LIMIT 1`,
        [signal.id]
      );

      if (duplicate.rows.length > 0) {
        continue;
      }

      const newsResult = await db.query(
        `SELECT headline, news_score, catalyst_type, source, published_at
         FROM news_articles
         WHERE symbol = $1
           AND published_at BETWEEN ($2 - INTERVAL '3 hours') AND ($2 + INTERVAL '3 hours')
         ORDER BY news_score DESC
         LIMIT 5`,
        [signal.symbol, signal.updated_at]
      );

      const articles = Array.isArray(newsResult?.rows) ? newsResult.rows : [];
      if (articles.length === 0) {
        continue;
      }

      const topArticle = articles[0];

      await db.query(
        `INSERT INTO signal_narratives
         (signal_id, symbol, strategy, headline, source, catalyst_type, news_score, published_at, linked_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
        [
          signal.id,
          signal.symbol,
          signal.strategy,
          topArticle.headline,
          topArticle.source,
          topArticle.catalyst_type,
          topArticle.news_score,
          topArticle.published_at,
        ]
      );

      attached += 1;
    }

    console.log(`[NARRATIVE] signals processed: ${signals.length}`);
    console.log(`[NARRATIVE] narratives attached: ${attached}`);

    return {
      signalsProcessed: signals.length,
      narrativesAttached: attached,
    };
  } catch (err) {
    console.error('[NARRATIVE ENGINE ERROR]', err);
    return {
      signalsProcessed: 0,
      narrativesAttached: 0,
      error: err?.message || 'unknown error',
    };
  }
}

module.exports = { runSignalNarrativeEngine };
