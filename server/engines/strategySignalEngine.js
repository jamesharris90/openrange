const logger = require('../logger');
const db = require('../db');

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function scoreSignal(changePercent, relativeVolume, gapPercent) {
  return (changePercent * 2) + (relativeVolume * 5) + (gapPercent * 3);
}

function classifyScore(score) {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  return null;
}

function determineStrategy(row) {
  const price = toNumber(row.price);
  const previousClose = toNumber(row.previous_close);
  const changePercent = toNumber(row.change_percent);
  const gapPercent = toNumber(row.gap_percent);
  const relativeVolume = toNumber(row.relative_volume);

  if (changePercent > 6 && relativeVolume > 2) return 'Day 2 Continuation';
  if (relativeVolume > 3 && gapPercent > 4) return 'Short Squeeze';
  if (relativeVolume > 2 && changePercent > 3) return 'ORB Breakout';
  if (gapPercent > 5 && relativeVolume > 2 && previousClose > 0 && price > previousClose) return 'Gap & Go';
  if (changePercent > 2 && relativeVolume > 1.5) return 'VWAP Reclaim';

  return null;
}

async function hasRecentDuplicate(symbol, strategy) {
  const duplicateCheckSql = `
    SELECT 1
    FROM strategy_signals
    WHERE symbol = $1
      AND strategy = $2
      AND updated_at >= NOW() - INTERVAL '10 minutes'
    LIMIT 1
  `;

  const result = await db.query(duplicateCheckSql, [symbol, strategy]);
  return result.rows.length > 0;
}

async function runStrategySignalEngine() {
  const startedAt = Date.now();
  console.log('[SIGNAL ENGINE] scanning market metrics...');

  const selectSql = `
    SELECT
      tu.symbol,
      COALESCE(tu.price, m.price) AS price,
      COALESCE(tu.change_percent, m.change_percent, 0) AS change_percent,
      COALESCE(m.gap_percent, 0) AS gap_percent,
      COALESCE(tu.relative_volume, m.relative_volume, 0) AS relative_volume,
      COALESCE(tu.volume, m.volume, 0) AS volume,
      pc.previous_close
    FROM tradable_universe tu
    LEFT JOIN market_metrics m ON m.symbol = tu.symbol
    LEFT JOIN LATERAL (
      SELECT d.close AS previous_close
      FROM daily_ohlc d
      WHERE d.symbol = tu.symbol
        AND d.date < CURRENT_DATE
      ORDER BY d.date DESC
      LIMIT 1
    ) pc ON TRUE
  `;

  const insertSql = `
    INSERT INTO strategy_signals (
      symbol,
      strategy,
      class,
      score,
      probability,
      change_percent,
      gap_percent,
      relative_volume,
      volume,
      updated_at
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()
    )
  `;

  const { rows } = await db.query(selectSql, []);
  console.log(`[SIGNAL ENGINE] ${rows.length} symbols loaded`);

  let inserted = 0;
  let skippedDuplicate = 0;

  for (const row of rows) {
    const strategy = determineStrategy(row);
    if (!strategy) continue;

    const changePercent = toNumber(row.change_percent);
    const gapPercent = toNumber(row.gap_percent);
    const relativeVolume = toNumber(row.relative_volume);
    const volume = toNumber(row.volume);
    const score = scoreSignal(changePercent, relativeVolume, gapPercent);
    const className = classifyScore(score);

    if (!className) continue;

    const duplicate = await hasRecentDuplicate(row.symbol, strategy);
    if (duplicate) {
      skippedDuplicate += 1;
      continue;
    }

    const probability = score / 100;

    try {
      await db.query(insertSql, [
        row.symbol,
        strategy,
        className,
        score,
        probability,
        changePercent,
        gapPercent,
        relativeVolume,
        volume,
      ]);
      console.log(`[SIGNAL CREATED] ${row.symbol} ${strategy} score ${score}`);
      inserted += 1;
    } catch (error) {
      logger.warn('Strategy signal insert skipped', {
        symbol: row.symbol,
        strategy,
        error: error.message,
      });
    }
  }

  const runtimeMs = Date.now() - startedAt;
  logger.info('Strategy signal engine complete', {
    universeSymbols: rows.length,
    inserted,
    skippedDuplicate,
    runtimeMs,
  });
  console.log('[SIGNAL ENGINE] completed run');

  return {
    universeSymbols: rows.length,
    inserted,
    skippedDuplicate,
    runtimeMs,
  };
}

module.exports = {
  runStrategySignalEngine,
};
