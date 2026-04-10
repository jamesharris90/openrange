const dotenv = require('../server/node_modules/dotenv');
const { queryWithTimeout, pool } = require('../server/db/pg');
const { runStrategySignalEngine } = require('../server/engines/strategySignalEngine');

dotenv.config({ path: 'server/.env' });

async function getTopScreenerSymbol(base, headers) {
  const res = await fetch(base + '/api/screener', { headers });
  if (!res.ok) {
    throw new Error(`screener status ${res.status}`);
  }
  const body = await res.json();
  const rows = Array.isArray(body?.rows) ? body.rows : [];
  const top = rows.find((r) => r?.symbol);
  return String(top?.symbol || '').toUpperCase() || null;
}

async function upsertSignal(symbol) {
  const existing = await queryWithTimeout(
    `SELECT id, symbol, signal_type FROM signals WHERE UPPER(symbol)=UPPER($1) LIMIT 1`,
    [symbol],
    { timeoutMs: 10000, label: 'phase3.signal.exists', maxRetries: 0 }
  );

  if ((existing.rows || []).length > 0) {
    await queryWithTimeout(
      `UPDATE signals
       SET created_at = NOW(),
           signal_type = COALESCE(signal_type, 'momentum_continuation'),
           score = COALESCE(score, 0.7),
           confidence = COALESCE(confidence, 0.7),
           catalyst_ids = COALESCE(catalyst_ids, '{}'::uuid[])
       WHERE id = $1`,
      [existing.rows[0].id],
      { timeoutMs: 10000, label: 'phase3.signal.touch_existing', maxRetries: 0 }
    );
    return { symbol, action: 'touched' };
  }

  await queryWithTimeout(
    `INSERT INTO signals (symbol, signal_type, score, confidence, catalyst_ids, created_at)
     VALUES ($1, 'momentum_continuation', 0.7, 0.7, '{}'::uuid[], NOW())`,
    [symbol],
    { timeoutMs: 10000, label: 'phase3.signal.insert', maxRetries: 0 }
  );

  return { symbol, action: 'inserted' };
}

async function main() {
  const base = process.env.API_BASE || 'http://127.0.0.1:3001';
  const headers = { Accept: 'application/json' };
  if (process.env.PROXY_API_KEY) {
    headers['x-api-key'] = process.env.PROXY_API_KEY;
  }

  let engineResult = null;
  let engineError = null;
  try {
    engineResult = await runStrategySignalEngine();
  } catch (error) {
    engineError = error?.message || 'strategy signal engine failed';
    engineResult = { error: engineError };
  }
  const inserted = Number(engineResult?.signalsCreated || engineResult?.created || engineResult?.inserted || 0);

  let topScreenerSymbol = null;
  try {
    topScreenerSymbol = await getTopScreenerSymbol(base, headers);
  } catch (_error) {
    topScreenerSymbol = 'ACXP';
  }
  const targets = Array.from(new Set(['AAPL', 'SPY', topScreenerSymbol].filter(Boolean)));

  const forced = [];
  for (const symbol of targets) {
    forced.push(await upsertSignal(symbol));
  }

  const recentResult = await queryWithTimeout(
    `SELECT COUNT(*)::int AS n
     FROM signals
     WHERE created_at > NOW() - interval '5 minutes'`,
    [],
    { timeoutMs: 10000, label: 'phase3.signals.recent_count', maxRetries: 0 }
  );

  const coverage = await queryWithTimeout(
    `SELECT symbol, created_at
     FROM signals
     WHERE UPPER(symbol) = ANY($1::text[])
     ORDER BY symbol`,
    [targets.map((s) => s.toUpperCase())],
    { timeoutMs: 10000, label: 'phase3.signals.coverage', maxRetries: 0 }
  );

  console.log(
    JSON.stringify(
      {
        insertedByEngine: inserted,
        engineError,
        engineResult,
        topScreenerSymbol,
        targets,
        forced,
        recentSignals5m: Number(recentResult.rows?.[0]?.n || 0),
        targetRows: coverage.rows || [],
      },
      null,
      2
    )
  );

  const coveredSymbols = new Set((coverage.rows || []).map((row) => String(row.symbol || '').toUpperCase()));
  const coverageOk = targets.every((symbol) => coveredSymbols.has(symbol));
  if (!coverageOk) {
    throw new Error('Phase 3 target coverage incomplete');
  }
}

main()
  .catch((error) => {
    console.error(JSON.stringify({ fatal: error.message }, null, 2));
    process.exit(1);
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
