const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');
const { generateMarketNarratives } = require('../services/mcpClient');

async function ensureMarketNarrativesTable() {
  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS market_narratives (
      id SERIAL PRIMARY KEY,
      narrative TEXT NOT NULL,
      regime TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    [],
    { timeoutMs: 7000, label: 'engines.narrative.ensure_table', maxRetries: 0 }
  );
}

async function getNarrativeInputs() {
  const [catalysts, news, metrics] = await Promise.all([
    queryWithTimeout(
      `SELECT symbol, catalyst_type, headline, impact_score, published_at
       FROM news_catalysts
       WHERE published_at >= NOW() - interval '36 hours'
       ORDER BY impact_score DESC NULLS LAST, published_at DESC NULLS LAST
       LIMIT 60`,
      [],
      { timeoutMs: 9000, label: 'engines.narrative.inputs.catalysts', maxRetries: 0 }
    ),
    queryWithTimeout(
      `SELECT headline, source, published_at
       FROM news_articles
       WHERE published_at >= NOW() - interval '36 hours'
       ORDER BY published_at DESC NULLS LAST
       LIMIT 120`,
      [],
      { timeoutMs: 9000, label: 'engines.narrative.inputs.news', maxRetries: 0 }
    ),
    queryWithTimeout(
      `SELECT symbol, change_percent, relative_volume, volume
       FROM market_metrics
       WHERE symbol IN ('SPY','QQQ','IWM','XLE','XLK','XLF','XLV','SMH','SOXX','NVDA','AMD')
       ORDER BY symbol ASC`,
      [],
      { timeoutMs: 7000, label: 'engines.narrative.inputs.metrics', maxRetries: 0 }
    ),
  ]);

  return {
    catalysts: catalysts.rows,
    news: news.rows,
    metrics: metrics.rows,
  };
}

function deriveRegime(narratives) {
  const joined = JSON.stringify(narratives || []).toLowerCase();
  if (joined.includes('risk-off') || joined.includes('defensive')) return 'Risk-Off';
  if (joined.includes('risk-on') || joined.includes('momentum')) return 'Risk-On';
  return 'Neutral';
}

async function runNarrativeEngine() {
  await ensureMarketNarrativesTable();

  const input = await getNarrativeInputs();
  const narratives = await generateMarketNarratives(input);
  const regime = deriveRegime(narratives);

  await queryWithTimeout(
    `INSERT INTO market_narratives (narrative, regime, created_at)
     VALUES ($1, $2, NOW())`,
    [JSON.stringify(narratives), regime],
    { timeoutMs: 7000, label: 'engines.narrative.insert', maxRetries: 0 }
  );

  const result = {
    narrativesGenerated: Array.isArray(narratives) ? narratives.length : 0,
    regime,
  };

  logger.info('[NARRATIVE_ENGINE] run complete', result);
  return result;
}

module.exports = {
  runNarrativeEngine,
};
