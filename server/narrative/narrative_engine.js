const { pool } = require('../db/pg');
const logger = require('../logger');

function pickMarketRegime(spyRow, vixRow) {
  const spyPrice = Number(spyRow?.price);
  const spyVwap = Number(spyRow?.vwap);
  const spyRvol = Number(spyRow?.relative_volume);
  const vixChange = Number(vixRow?.change_percent ?? vixRow?.gap_percent ?? 0);

  const spyAboveVwap = Number.isFinite(spyPrice) && Number.isFinite(spyVwap) && spyPrice > spyVwap;
  const spyBelowVwap = Number.isFinite(spyPrice) && Number.isFinite(spyVwap) && spyPrice < spyVwap;
  const rvolIncreasing = Number.isFinite(spyRvol) && spyRvol >= 1.2;
  const vixRising = Number.isFinite(vixChange) && vixChange > 0;

  if (spyAboveVwap && rvolIncreasing) return 'Bullish';
  if (spyBelowVwap && vixRising) return 'Bearish';
  return 'Neutral';
}

function buildNarrative({ regime, drivers, opportunities }) {
  const topList = opportunities.length
    ? opportunities.map((item) => `${item.symbol} ${item.setup}`).join('\n')
    : 'No setup opportunities detected';

  const driverList = drivers.length
    ? drivers.join('\n')
    : 'No dominant drivers detected';

  return [
    `Market Regime: ${regime}`,
    '',
    'Drivers:',
    driverList,
    '',
    'Top Opportunities:',
    topList,
  ].join('\n');
}

async function generateMarketNarrativeSnapshot() {
  const [spyMetrics, vixMetrics, sectorStrength, topSetups, latestCatalysts] = await Promise.all([
    pool.query(`SELECT symbol, price, vwap, relative_volume FROM market_metrics WHERE symbol = 'SPY' LIMIT 1`),
    pool.query(`SELECT symbol, change_percent, gap_percent FROM market_metrics WHERE symbol IN ('VIX', '^VIX') ORDER BY symbol = 'VIX' DESC LIMIT 1`),
    pool.query(`
      SELECT u.sector,
             COUNT(*)::int AS symbol_count,
             AVG(COALESCE(m.relative_volume, 0)) AS avg_rvol,
             AVG(COALESCE(s.score, 0)) AS avg_setup_score
      FROM market_metrics m
      JOIN ticker_universe u ON u.symbol = m.symbol
      LEFT JOIN trade_setups s ON s.symbol = m.symbol
      WHERE u.sector IS NOT NULL
      GROUP BY u.sector
      ORDER BY avg_setup_score DESC NULLS LAST, avg_rvol DESC NULLS LAST
      LIMIT 3
    `),
    pool.query(`
      SELECT symbol,
             COALESCE(NULLIF(TRIM(setup), ''), 'Setup detected') AS setup,
             score
      FROM trade_setups
      ORDER BY score DESC NULLS LAST
      LIMIT 5
    `),
    pool.query(`
      SELECT symbol, headline
      FROM trade_catalysts
      ORDER BY published_at DESC NULLS LAST
      LIMIT 3
    `),
  ]);

  const spy = spyMetrics.rows[0] || null;
  const vix = vixMetrics.rows[0] || null;
  const regime = pickMarketRegime(spy, vix);

  const drivers = [];
  if (spy && Number.isFinite(Number(spy.price)) && Number.isFinite(Number(spy.vwap))) {
    if (Number(spy.price) > Number(spy.vwap)) drivers.push('SPY trading above VWAP');
    else drivers.push('SPY trading below VWAP');
  }

  const leadingSector = sectorStrength.rows[0];
  if (leadingSector?.sector) {
    drivers.push(`${leadingSector.sector} sector leading by setup strength`);
  }

  const highRvolRow = sectorStrength.rows.find((row) => Number(row?.avg_rvol) >= 2);
  if (highRvolRow?.sector) {
    drivers.push(`High RVOL concentration in ${highRvolRow.sector} names`);
  }

  const catalyst = latestCatalysts.rows[0];
  if (catalyst?.symbol && catalyst?.headline) {
    drivers.push(`Fresh catalyst: ${catalyst.symbol} — ${catalyst.headline}`);
  }

  const opportunities = topSetups.rows.map((row) => ({
    symbol: row.symbol,
    setup: row.setup,
    score: row.score,
  }));

  const narrative = buildNarrative({ regime, drivers, opportunities });
  return { regime, narrative, drivers, opportunities };
}

async function generateAndStoreMarketNarrative() {
  const snapshot = await generateMarketNarrativeSnapshot();

  const result = await pool.query(
    `INSERT INTO market_narratives (narrative, regime)
     VALUES ($1, $2)
     RETURNING id, narrative, regime, created_at`,
    [snapshot.narrative, snapshot.regime],
  );

  logger.info('Market narrative generated', {
    regime: snapshot.regime,
    narrativeId: result.rows[0]?.id,
  });

  return result.rows[0];
}

module.exports = {
  generateMarketNarrativeSnapshot,
  generateAndStoreMarketNarrative,
};
