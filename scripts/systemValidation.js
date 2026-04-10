const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '../server/.env') });

const { queryWithTimeout, pool } = require('../server/db/pg');

async function fetchDecisionCoverage() {
  const base = process.env.API_BASE || 'http://127.0.0.1:3001';
  const headers = { Accept: 'application/json' };
  if (process.env.PROXY_API_KEY) {
    headers['x-api-key'] = process.env.PROXY_API_KEY;
  }

  const response = await fetch(`${base}/api/intelligence/top-opportunities`, { headers });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`decision endpoint failed with status ${response.status}`);
  }

  const decisionCount = Number(payload?.non_null_scores);
  if (Number.isFinite(decisionCount)) {
    return decisionCount;
  }

  const items = Array.isArray(payload?.items) ? payload.items : [];
  return items.filter((row) => Number.isFinite(Number(row?.decision_score))).length;
}

async function runSystemValidation() {
  const result = {
    lifecycle_overlap: 0,
    decision_count: 0,
    signals_recent: 0,
    stocks_in_play_count: 0,
    status: 'FAIL',
  };

  try {
    const lifecycle = await queryWithTimeout(
      `SELECT COUNT(DISTINCT s.symbol)::int AS n
       FROM signals s
       JOIN trade_setups ts ON s.id = ts.signal_id
       JOIN signal_outcomes so ON s.id = so.signal_id`,
      [],
      { timeoutMs: 15000, label: 'system_validation.lifecycle', maxRetries: 0 }
    );
    result.lifecycle_overlap = Number(lifecycle.rows?.[0]?.n || 0);

    result.decision_count = await fetchDecisionCoverage();

    const recentSignals = await queryWithTimeout(
      `SELECT COUNT(*)::int AS n
       FROM signals
       WHERE created_at > NOW() - interval '15 minutes'`,
      [],
      { timeoutMs: 10000, label: 'system_validation.signals_recent', maxRetries: 0 }
    );
    result.signals_recent = Number(recentSignals.rows?.[0]?.n || 0);

    const stocksInPlay = await queryWithTimeout(
      `SELECT COUNT(*)::int AS n FROM stocks_in_play`,
      [],
      { timeoutMs: 10000, label: 'system_validation.stocks_in_play', maxRetries: 0 }
    );
    result.stocks_in_play_count = Number(stocksInPlay.rows?.[0]?.n || 0);

    const fail = (
      result.lifecycle_overlap === 0
      || result.decision_count < 5
      || result.stocks_in_play_count === 0
    );

    result.status = fail ? 'FAIL' : 'PASS';
    return result;
  } catch (error) {
    console.error('[SYSTEM_VALIDATION] failure', error.message);
    result.status = 'FAIL';
    result.error = error.message;
    return result;
  }
}

async function main() {
  const output = await runSystemValidation();
  console.log(JSON.stringify(output, null, 2));
  process.exit(output.status === 'PASS' ? 0 : 1);
}

if (require.main === module) {
  main().finally(async () => {
    await pool.end().catch(() => {});
  });
}

module.exports = { runSystemValidation };
