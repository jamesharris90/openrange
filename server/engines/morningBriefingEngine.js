const db = require('../db');

async function generateMorningBriefing() {
  console.log('[BRIEFING] generating morning briefing');

  const signals = await db.query(`
    SELECT symbol, strategy, class, score
    FROM strategy_signals
    WHERE updated_at >= NOW() - interval '12 hours'
    ORDER BY score DESC
    LIMIT 10
  `);

  const market = await db.query(`
    SELECT symbol, price, change_percent
    FROM market_metrics
    WHERE symbol IN ('SPY','QQQ','IWM','VIX')
  `);

  const news = await db.query(`
    SELECT title, sentiment
    FROM news_articles
    ORDER BY published_at DESC
    LIMIT 10
  `);

  const briefing = {
    signals: signals.rows,
    market: market.rows,
    news: news.rows
  };

  await db.query(`
    INSERT INTO morning_briefings
    (signals, market, news)
    VALUES ($1,$2,$3)
  `, [
    briefing.signals,
    briefing.market,
    briefing.news
  ]);

  return briefing;
}

module.exports = { generateMorningBriefing };
