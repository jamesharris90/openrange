const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: 'server/.env' });
const { queryWithTimeout, pool } = require('../server/db/pg');

async function run() {
  const base = process.env.API_BASE || 'http://127.0.0.1:3001';
  const headers = { Accept: 'application/json' };
  if (process.env.PROXY_API_KEY) headers['x-api-key'] = process.env.PROXY_API_KEY;

  const lifecycle = await queryWithTimeout(
    `SELECT COUNT(DISTINCT s.symbol)::int AS n
     FROM signals s
     JOIN trade_setups ts ON s.id = ts.signal_id
     JOIN signal_outcomes so ON s.id = so.signal_id`,
    [],
    { timeoutMs: 15000, label: 'intelligence.precheck.lifecycle', maxRetries: 0 }
  );

  const signalsRecent = await queryWithTimeout(
    `SELECT COUNT(*)::int AS n
     FROM signals
     WHERE created_at > NOW() - interval '15 minutes'`,
    [],
    { timeoutMs: 10000, label: 'intelligence.precheck.signals_recent', maxRetries: 0 }
  );

  const decisionRes = await fetch(`${base}/api/intelligence/top-opportunities`, { headers });
  const decisionPayload = await decisionRes.json().catch(() => ({}));
  const decisionCount = Number.isFinite(Number(decisionPayload?.non_null_scores))
    ? Number(decisionPayload.non_null_scores)
    : (Array.isArray(decisionPayload?.items)
      ? decisionPayload.items.filter((r) => Number.isFinite(Number(r?.decision_score))).length
      : 0);

  const out = {
    ts: new Date().toISOString(),
    lifecycle_overlap: Number(lifecycle.rows?.[0]?.n || 0),
    decision_coverage: decisionCount,
    signals_recent_15m: Number(signalsRecent.rows?.[0]?.n || 0),
    endpoint_status: decisionRes.status,
    pass: Number(lifecycle.rows?.[0]?.n || 0) > 50 && decisionCount > 10,
  };

  fs.mkdirSync(path.join(process.cwd(), 'logs'), { recursive: true });
  fs.writeFileSync(path.join(process.cwd(), 'logs', 'intelligence_precheck.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));

  if (!out.pass) {
    throw new Error('PHASE_0_GATE_FAILED');
  }
}

run()
  .catch((error) => {
    console.error('[PHASE_0_FAILED]', error.message);
    process.exit(1);
  })
  .finally(async () => {
    try { await pool.end(); } catch {}
  });
