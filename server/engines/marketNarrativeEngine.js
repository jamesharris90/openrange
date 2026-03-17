const { queryWithTimeout } = require('../db/pg');
const logger = require('../logger');

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function formatMoverList(topMovers = []) {
  const names = (topMovers || []).slice(0, 2).map((row) => String(row.symbol || '').toUpperCase()).filter(Boolean);
  if (names.length === 0) return 'leadership is broadly distributed';
  if (names.length === 1) return `${names[0]} is pacing early momentum`;
  return `${names[0]} and ${names[1]} are pacing early momentum`;
}

function generateMarketNarrative({ spy, qqq, vix, sectorMovers = [], topMovers = [] } = {}) {
  const spyNum = Number(spy);
  const qqqNum = Number(qqq);
  const vixNum = Number(vix);

  const leadSector = (sectorMovers || [])[0]?.sector || 'defensive groups';
  const riskTone = Number.isFinite(vixNum)
    ? (vixNum >= 25 ? 'volatility remains elevated' : 'volatility is contained')
    : 'volatility is mixed';
  const indexTone = Number.isFinite(spyNum) && Number.isFinite(qqqNum)
    ? (spyNum >= 0 && qqqNum >= 0 ? 'risk appetite is stabilising' : 'price action is selective')
    : 'index direction is mixed';

  return `Markets are ${indexTone}, with ${leadSector} leading while ${riskTone}; ${formatMoverList(topMovers)}.`;
}

function deriveNarrative({ spy, qqq, vix, topSector, topMovers, sentiment }) {
  const sector = topSector?.sector || 'Mixed sectors';
  const movers = topMovers.slice(0, 2).map((row) => row.symbol).filter(Boolean).join(' and ');
  const sentimentWord = sentiment > 0 ? 'positive' : sentiment < 0 ? 'cautious' : 'neutral';

  const lead = `${sector} leading market strength`;
  const breadth = `SPY ${spy >= 0 ? 'up' : 'down'} ${spy.toFixed(2)}% and QQQ ${qqq >= 0 ? 'up' : 'down'} ${qqq.toFixed(2)}%`;
  const risk = `while VIX ${vix >= 0 ? 'rose' : 'eased'} ${Math.abs(vix).toFixed(2)}%`;
  const moversText = movers ? `as ${movers} gain momentum` : 'with rotation visible across leaders';

  return `${lead}, ${breadth} ${risk}. ${moversText}. News sentiment is ${sentimentWord}.`;
}

async function safeQuery(sql, params, options) {
  try {
    const result = await queryWithTimeout(sql, params, options);
    return result?.rows || [];
  } catch (error) {
    logger.error('[ENGINE ERROR] market_narrative query failed', { label: options?.label, error: error.message });
    return [];
  }
}

async function ensureMarketNarrativesTable() {
  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS market_narratives (
      id BIGSERIAL PRIMARY KEY,
      narrative TEXT NOT NULL,
      regime TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    [],
    { timeoutMs: 5000, label: 'engines.market_narrative.ensure_table', maxRetries: 0 }
  );
}

async function runMarketNarrativeEngine() {
  try {
    await ensureMarketNarrativesTable();

    const [indexRows, sectorRows, moverRows, sentimentRows] = await Promise.all([
      safeQuery(
      `SELECT symbol, change_percent
       FROM market_metrics
       WHERE symbol IN ('SPY', 'QQQ', 'VIX')`,
      [],
      { timeoutMs: 2200, label: 'engines.market_narrative.indices', maxRetries: 0 }
    ),
      safeQuery(
            `SELECT COALESCE(NULLIF(TRIM(q.sector), ''), 'Unknown') AS sector,
              AVG(COALESCE(m.change_percent, 0)) AS avg_change
             FROM market_metrics m
             LEFT JOIN market_quotes q ON q.symbol = m.symbol
             GROUP BY COALESCE(NULLIF(TRIM(q.sector), ''), 'Unknown')
       ORDER BY avg_change DESC NULLS LAST
       LIMIT 1`,
      [],
      { timeoutMs: 2200, label: 'engines.market_narrative.sector', maxRetries: 0 }
    ),
      safeQuery(
      `SELECT symbol, change_percent, relative_volume
       FROM market_metrics
       ORDER BY COALESCE(change_percent, 0) DESC NULLS LAST, COALESCE(relative_volume, 0) DESC NULLS LAST
       LIMIT 8`,
      [],
      { timeoutMs: 2200, label: 'engines.market_narrative.movers', maxRetries: 0 }
    ),
      safeQuery(
      `SELECT AVG(CASE
                    WHEN LOWER(COALESCE(sentiment, '')) LIKE '%positive%' THEN 1
                    WHEN LOWER(COALESCE(sentiment, '')) LIKE '%negative%' THEN -1
                    ELSE 0
                  END)::numeric AS sentiment_score
       FROM trade_catalysts
       WHERE published_at >= NOW() - INTERVAL '24 hours'`,
      [],
      { timeoutMs: 2200, label: 'engines.market_narrative.sentiment', maxRetries: 0 }
    ),
  ]);

    const indexMap = new Map((indexRows || []).map((row) => [String(row.symbol || '').toUpperCase(), row]));
    const spy = toNum(indexMap.get('SPY')?.change_percent);
    const qqq = toNum(indexMap.get('QQQ')?.change_percent);
    const vix = toNum(indexMap.get('VIX')?.change_percent);
    const topSector = (sectorRows || [])[0] || null;
    const topMovers = Array.isArray(moverRows) ? moverRows : [];
    const sentiment = toNum((sentimentRows || [])[0]?.sentiment_score);

    const narrative = deriveNarrative({ spy, qqq, vix, topSector, topMovers, sentiment });
    const regime = spy > 0 && qqq > 0 && vix <= 0 ? 'Risk-On' : (spy < 0 && qqq < 0 ? 'Risk-Off' : 'Neutral');

    await queryWithTimeout(
    `INSERT INTO market_narratives (narrative, regime, created_at)
     VALUES ($1, $2, NOW())`,
    [narrative, regime],
    { timeoutMs: 2200, label: 'engines.market_narrative.insert', maxRetries: 0 }
  );

    const payload = {
      ok: true,
      narrative,
      regime,
      top_sector: topSector?.sector || 'Unknown',
      generated_at: new Date().toISOString(),
    };

    logger.info('[MARKET_NARRATIVE_ENGINE] run complete', payload);
    return payload;
  } catch (error) {
    logger.error('[ENGINE ERROR] market_narrative run failed', { error: error.message });
    return {
      ok: false,
      narrative: '',
      regime: 'Neutral',
      top_sector: 'Unknown',
      generated_at: new Date().toISOString(),
      error: error.message,
    };
  }
}

async function getLatestMarketNarrative() {
  try {
    await ensureMarketNarrativesTable();
    const { rows } = await queryWithTimeout(
      `SELECT narrative, regime, created_at
       FROM market_narratives
       ORDER BY created_at DESC
       LIMIT 1`,
      [],
      { timeoutMs: 1500, label: 'engines.market_narrative.latest', maxRetries: 0 }
    );

    return rows?.[0] || null;
  } catch (error) {
    logger.error('[ENGINE ERROR] market_narrative latest failed', { error: error.message });
    return null;
  }
}

module.exports = {
  runMarketNarrativeEngine,
  getLatestMarketNarrative,
  generateMarketNarrative,
};
