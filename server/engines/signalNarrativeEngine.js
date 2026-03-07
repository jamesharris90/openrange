const db = require('../db');

async function insertCatalyst(db, signal, article) {
  try {
    const existing = await db.query(
      `SELECT id
       FROM signal_catalysts
       WHERE signal_id = $1
         AND headline = $2
       LIMIT 1`,
      [signal.id, article.headline]
    );

    if (existing.rows.length > 0) return false;

    await db.query(
      `INSERT INTO signal_catalysts (
          signal_id,
          symbol,
          strategy,
          catalyst_type,
          catalyst_source,
          headline,
          source,
          strength,
          published_at
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        signal.id,
        signal.symbol,
        signal.strategy,
        article.catalyst_type || 'news',
        article.source,
        article.headline,
        article.source,
        article.news_score || 0,
        article.published_at,
      ]
    );

    return true;
  } catch (err) {
    console.warn('[CATALYST INSERT FAILED]', err.message);
    return false;
  }
}

async function runSignalNarrativeEngine() {
  try {
    const signalsResult = await db.query(
      `SELECT id, symbol, strategy, class, score, updated_at
       FROM strategy_signals
       WHERE updated_at > NOW() - INTERVAL '24 hours'`
    );

    const signals = Array.isArray(signalsResult?.rows) ? signalsResult.rows : [];
    let attached = 0;
  let catalystTotal = 0;

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

      const news = await db.query(
        `SELECT headline, news_score, catalyst_type, source, published_at
         FROM news_articles
         WHERE $1 = ANY(symbols)
           AND published_at > NOW() - INTERVAL '24 hours'
         ORDER BY news_score DESC
         LIMIT 5`,
        [signal.symbol]
      );

      const articles = Array.isArray(news?.rows) ? news.rows : [];
      if (articles.length === 0) {
        continue;
      }

      const topArticle = articles[0];

      await db.query(
        `INSERT INTO signal_narratives
         (signal_id, symbol, strategy, headline, source, catalyst_type, news_score, published_at, mcp_context, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NOW())`,
        [
          signal.id,
          signal.symbol,
          signal.strategy,
          topArticle.headline,
          topArticle.source,
          topArticle.catalyst_type,
          topArticle.news_score,
          topArticle.published_at,
          JSON.stringify({}),
        ]
      );

      for (const article of articles) {
        const inserted = await insertCatalyst(db, signal, article);
        if (inserted) {
          catalystTotal += 1;
        }
      }

      const catalystCount = articles.length;
      await db.query(
        `UPDATE strategy_signals
         SET catalyst_count = $1
         WHERE id = $2`,
        [catalystCount, signal.id]
      );

      console.log(`[CATALYST] attached catalysts for signal ${signal.symbol}`);

      attached += 1;
    }

    console.log('[NARRATIVE] signals processed:', signals.length);
    console.log('[NARRATIVE] narratives attached:', attached);
    console.log('[CATALYST] total catalysts inserted:', catalystTotal);

    return {
      signalsProcessed: signals.length,
      narrativesAttached: attached,
    };
  } catch (err) {
    console.error('[ENGINE ERROR]', err.message);
    return {
      signalsProcessed: 0,
      narrativesAttached: 0,
      error: err?.message || 'unknown error',
    };
  }
}

module.exports = { runSignalNarrativeEngine };
