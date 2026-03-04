const fs = require('fs').promises;
const path = require('path');
const { pool } = require('../db/pg');
const logger = require('../logger');

const BATCH_SIZE = 500;

async function ensureStrategyTable() {
  const sqlPath = path.join(__dirname, '..', 'migrations', 'create_trade_setups.sql');
  const sql = await fs.readFile(sqlPath, 'utf8');
  await pool.query(sql);
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function classifySetup(metric) {
  const gapPercent = toNumber(metric.gap_percent);
  const relativeVolume = toNumber(metric.relative_volume);
  const floatRotation = toNumber(metric.float_rotation);
  const price = toNumber(metric.price);
  const vwap = toNumber(metric.vwap);

  let setup = null;

  if (gapPercent > 3 && relativeVolume > 2 && floatRotation > 0.05) {
    setup = 'Gap & Go';
  } else if (relativeVolume > 3 && gapPercent > 2) {
    setup = 'Momentum Continuation';
  } else if (relativeVolume > 1.5 && price > vwap) {
    setup = 'VWAP Reclaim';
  }

  if (!setup) return null;

  const score = (relativeVolume * 2) + gapPercent + (floatRotation * 10);

  let grade = 'C';
  if (score > 15) grade = 'A';
  else if (score > 10) grade = 'B';
  else if (score > 6) grade = 'C';
  else return null;

  return {
    symbol: String(metric.symbol || '').toUpperCase(),
    setup,
    grade,
    score,
    gap_percent: gapPercent,
    relative_volume: relativeVolume,
    atr: metric.atr != null ? Number(metric.atr) : null,
    float_rotation: metric.float_rotation != null ? Number(metric.float_rotation) : null,
  };
}

async function getMetricSymbols() {
  const { rows } = await pool.query(
    `SELECT symbol,
            price,
            vwap,
            gap_percent,
            relative_volume,
            atr,
            float_rotation
     FROM market_metrics
     WHERE symbol IS NOT NULL
     ORDER BY symbol ASC`
  );

  return rows;
}

async function upsertSetups(rows) {
  if (!rows.length) return 0;

  const payload = JSON.stringify(rows);

  await pool.query(
    `INSERT INTO trade_setups (
       symbol,
       setup,
       grade,
       score,
       gap_percent,
       relative_volume,
       atr,
       float_rotation,
       detected_at
     )
     SELECT symbol,
            setup,
            grade,
            score,
            gap_percent,
            relative_volume,
            atr,
            float_rotation,
            NOW()
     FROM jsonb_to_recordset($1::jsonb) AS x(
       symbol text,
       setup text,
       grade text,
       score numeric,
       gap_percent numeric,
       relative_volume numeric,
       atr numeric,
       float_rotation numeric
     )
     ON CONFLICT (symbol) DO UPDATE
     SET setup = EXCLUDED.setup,
         grade = EXCLUDED.grade,
         score = EXCLUDED.score,
         gap_percent = EXCLUDED.gap_percent,
         relative_volume = EXCLUDED.relative_volume,
         atr = EXCLUDED.atr,
         float_rotation = EXCLUDED.float_rotation,
         detected_at = NOW()`,
    [payload]
  );

  return rows.length;
}

async function runStrategyEngine() {
  const startedAt = Date.now();
  await ensureStrategyTable();

  const metrics = await getMetricSymbols();
  let processedSymbols = 0;
  let setupsDetected = 0;

  for (let index = 0; index < metrics.length; index += BATCH_SIZE) {
    const batch = metrics.slice(index, index + BATCH_SIZE);
    const setups = batch.map(classifySetup).filter(Boolean);

    processedSymbols += batch.length;

    if (setups.length) {
      const inserted = await upsertSetups(setups);
      setupsDetected += inserted;
    }
  }

  const runtimeMs = Date.now() - startedAt;

  const result = {
    symbols_processed: processedSymbols,
    setups_detected: setupsDetected,
    runtimeMs,
  };

  logger.info('strategy engine complete', {
    scope: 'strategy',
    ...result,
  });

  return result;
}

module.exports = {
  runStrategyEngine,
  ensureStrategyTable,
};
