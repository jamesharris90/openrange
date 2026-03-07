const db = require('../db');

async function validateSchema() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS strategy_signals (
        id SERIAL PRIMARY KEY,
        symbol TEXT,
        strategy TEXT,
        class TEXT,
        score NUMERIC,
        change_percent NUMERIC,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS news_articles (
        id SERIAL PRIMARY KEY,
        symbol TEXT,
        symbols TEXT[],
        headline TEXT,
        source TEXT,
        catalyst_type TEXT,
        news_score INT,
        published_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS signal_narratives (
        id SERIAL PRIMARY KEY,
        signal_id INT,
        symbol TEXT,
        strategy TEXT,
        headline TEXT,
        source TEXT,
        catalyst_type TEXT,
        news_score INT,
        published_at TIMESTAMP,
        mcp_context JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS signal_performance (
        id SERIAL PRIMARY KEY,
        signal_id INT,
        symbol TEXT,
        strategy TEXT,
        class TEXT,
        entry_price NUMERIC,
        max_upside NUMERIC,
        max_drawdown NUMERIC,
        outcome TEXT,
        evaluated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await db.query('ALTER TABLE signal_narratives ADD COLUMN IF NOT EXISTS mcp_context JSONB');

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_signal_narratives_symbol
      ON signal_narratives(symbol)
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_signal_narratives_signal
      ON signal_narratives(signal_id)
    `);

    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_news_symbols
      ON news_articles USING GIN(symbols)
    `);

    return true;
  } catch (e) {
    console.error('[SCHEMA VALIDATOR ERROR]', e.message);
    return false;
  }
}

module.exports = { validateSchema };