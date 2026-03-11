const { queryWithTimeout } = require('../db/pg');
const logger = require('../logger');

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

async function ensureInstitutionalFlowTable() {
  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS institutional_flow (
      id BIGSERIAL PRIMARY KEY,
      symbol TEXT NOT NULL,
      relative_volume NUMERIC,
      volume NUMERIC,
      breakout_score NUMERIC,
      score NUMERIC,
      detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    [],
    { timeoutMs: 5000, label: 'engines.institutional_flow.ensure_table', maxRetries: 0 }
  );
}

async function runInstitutionalFlowEngine() {
  await ensureInstitutionalFlowTable();

  const { rows } = await queryWithTimeout(
    `SELECT symbol,
            COALESCE(relative_volume, 0) AS relative_volume,
            COALESCE(volume, 0) AS volume,
            COALESCE(change_percent, 0) AS change_percent,
            CASE
              WHEN COALESCE(change_percent, 0) >= 4 THEN 1
              WHEN COALESCE(change_percent, 0) >= 2 THEN 0.7
              ELSE 0.3
            END AS breakout_score
     FROM market_metrics
     WHERE COALESCE(relative_volume, 0) > 5
       AND COALESCE(volume, 0) > 0
     ORDER BY COALESCE(relative_volume, 0) DESC, COALESCE(volume, 0) DESC
     LIMIT 150`,
    [],
    { timeoutMs: 3000, label: 'engines.institutional_flow.select', maxRetries: 0 }
  );

  const inserts = rows.map((row) => {
    const rvolScore = Math.min(1, toNum(row.relative_volume) / 10);
    const volumeScore = Math.min(1, toNum(row.volume) / 10_000_000);
    const breakoutScore = toNum(row.breakout_score);
    const score = Number((0.5 * rvolScore + 0.3 * volumeScore + 0.2 * breakoutScore).toFixed(4));

    return queryWithTimeout(
      `INSERT INTO institutional_flow (symbol, relative_volume, volume, breakout_score, score, detected_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [row.symbol, row.relative_volume, row.volume, breakoutScore, score],
      { timeoutMs: 2000, label: 'engines.institutional_flow.insert', maxRetries: 0 }
    );
  });

  await Promise.all(inserts);
  const result = { processed: rows.length, generated_at: new Date().toISOString() };
  logger.info('[INSTITUTIONAL_FLOW_ENGINE] run complete', result);
  return result;
}

module.exports = {
  runInstitutionalFlowEngine,
};
