const dotenv = require('../server/node_modules/dotenv');
const { queryWithTimeout, pool } = require('../server/db/pg');

dotenv.config({ path: 'server/.env' });

function num(v, fallback = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeSymbol(v) {
  return String(v || '').trim().toUpperCase();
}

async function fetchTopScreenerSymbols(base, headers, limit = 50) {
  const res = await fetch(`${base}/api/screener`, { headers });
  if (!res.ok) throw new Error(`screener_status_${res.status}`);
  const body = await res.json().catch(() => ({}));
  const rows = Array.isArray(body?.rows) ? body.rows : [];
  return rows.map((r) => normalizeSymbol(r?.symbol)).filter(Boolean).slice(0, limit);
}

async function fetchHighRvolSymbols(limit = 50) {
  const r = await queryWithTimeout(
    `SELECT symbol
     FROM market_metrics
     WHERE symbol IS NOT NULL
       AND COALESCE(relative_volume, 0) > 0
     ORDER BY COALESCE(relative_volume, 0) DESC
     LIMIT $1`,
    [limit],
    { timeoutMs: 12000, label: 'density.high_rvol', maxRetries: 0 }
  );
  return (r.rows || []).map((x) => normalizeSymbol(x.symbol)).filter(Boolean);
}

async function fetchGapMoverSymbols(limit = 50) {
  const r = await queryWithTimeout(
    `SELECT symbol
     FROM market_metrics
     WHERE symbol IS NOT NULL
       AND gap_percent IS NOT NULL
     ORDER BY ABS(gap_percent) DESC
     LIMIT $1`,
    [limit],
    { timeoutMs: 12000, label: 'density.gap_movers', maxRetries: 0 }
  );
  return (r.rows || []).map((x) => normalizeSymbol(x.symbol)).filter(Boolean);
}

async function ensureSignalForSymbol(symbol) {
  const existing = await queryWithTimeout(
    `SELECT id
     FROM signals
     WHERE UPPER(symbol)=UPPER($1)
     LIMIT 1`,
    [symbol],
    { timeoutMs: 8000, label: 'density.signal.exists', maxRetries: 0 }
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
      { timeoutMs: 8000, label: 'density.signal.touch', maxRetries: 0 }
    );
    return { signalId: existing.rows[0].id, inserted: false, touched: true };
  }

  const inserted = await queryWithTimeout(
    `INSERT INTO signals (symbol, signal_type, score, confidence, catalyst_ids, created_at)
     VALUES ($1, 'momentum_continuation', 0.7, 0.7, '{}'::uuid[], NOW())
     RETURNING id`,
    [symbol],
    { timeoutMs: 8000, label: 'density.signal.insert', maxRetries: 0 }
  );

  return { signalId: inserted.rows?.[0]?.id, inserted: true, touched: false };
}

async function ensureSetup(signalId, symbol, entryPrice, relativeVolume) {
  const exists = await queryWithTimeout(
    `SELECT 1 FROM trade_setups WHERE signal_id = $1 OR UPPER(symbol)=UPPER($2) LIMIT 1`,
    [signalId, symbol],
    { timeoutMs: 8000, label: 'density.setup.exists', maxRetries: 0 }
  );

  if ((exists.rows || []).length > 0) {
    await queryWithTimeout(
      `UPDATE trade_setups
       SET symbol = $2,
           entry_price = COALESCE(entry_price, $3),
           relative_volume = COALESCE(relative_volume, $4),
           updated_at = NOW()
       WHERE signal_id = $1
          OR UPPER(symbol)=UPPER($2)`,
      [signalId, symbol, entryPrice, relativeVolume],
      { timeoutMs: 8000, label: 'density.setup.touch', maxRetries: 0 }
    );
    return false;
  }

  await queryWithTimeout(
    `INSERT INTO trade_setups
      (symbol, signal_id, setup_type, setup, score, entry_price, relative_volume, detected_at, updated_at, created_at)
     VALUES ($1,$2,'momentum_continuation','momentum_continuation',70,$3,$4,NOW(),NOW(),NOW())
     ON CONFLICT ON CONSTRAINT trade_setups_pkey
     DO UPDATE SET
       signal_id = EXCLUDED.signal_id,
       entry_price = COALESCE(trade_setups.entry_price, EXCLUDED.entry_price),
       relative_volume = COALESCE(trade_setups.relative_volume, EXCLUDED.relative_volume),
       updated_at = NOW(),
       symbol = EXCLUDED.symbol`,
    [symbol, signalId, entryPrice, relativeVolume],
    { timeoutMs: 8000, label: 'density.setup.insert', maxRetries: 0 }
  );
  return true;
}

async function ensureOutcomeColumns() {
  await queryWithTimeout(`ALTER TABLE signal_outcomes ADD COLUMN IF NOT EXISTS pnl_5m double precision`, [], { timeoutMs: 12000, label: 'density.cols.so.pnl5m', maxRetries: 0 });
  await queryWithTimeout(`ALTER TABLE signal_outcomes ADD COLUMN IF NOT EXISTS pnl_15m double precision`, [], { timeoutMs: 12000, label: 'density.cols.so.pnl15m', maxRetries: 0 });
  await queryWithTimeout(`ALTER TABLE signal_outcomes ADD COLUMN IF NOT EXISTS pnl_1h double precision`, [], { timeoutMs: 12000, label: 'density.cols.so.pnl1h', maxRetries: 0 });
  await queryWithTimeout(`ALTER TABLE trade_outcomes ADD COLUMN IF NOT EXISTS pnl_5m double precision`, [], { timeoutMs: 12000, label: 'density.cols.to.pnl5m', maxRetries: 0 });
  await queryWithTimeout(`ALTER TABLE trade_outcomes ADD COLUMN IF NOT EXISTS pnl_15m double precision`, [], { timeoutMs: 12000, label: 'density.cols.to.pnl15m', maxRetries: 0 });
  await queryWithTimeout(`ALTER TABLE trade_outcomes ADD COLUMN IF NOT EXISTS pnl_1h double precision`, [], { timeoutMs: 12000, label: 'density.cols.to.pnl1h', maxRetries: 0 });
  await queryWithTimeout(`ALTER TABLE trade_outcomes ADD COLUMN IF NOT EXISTS max_move_pct double precision`, [], { timeoutMs: 12000, label: 'density.cols.to.max_move_pct', maxRetries: 0 });
}

async function ensureRegistrySignal(symbol, strategy, entryPrice) {
  const existing = await queryWithTimeout(
    `SELECT id FROM signal_registry
     WHERE UPPER(symbol)=UPPER($1)
       AND UPPER(COALESCE(strategy,''))=UPPER(COALESCE($2,''))
     ORDER BY created_at DESC NULLS LAST
     LIMIT 1`,
    [symbol, strategy],
    { timeoutMs: 8000, label: 'density.registry.exists', maxRetries: 0 }
  );
  if ((existing.rows || []).length > 0) return existing.rows[0].id;

  const inserted = await queryWithTimeout(
    `INSERT INTO signal_registry (symbol, strategy, setup_type, signal_score, entry_price, entry_time, source, created_at)
     VALUES ($1,$2,$2,70,$3,NOW(),'openrange',NOW())
     RETURNING id`,
    [symbol, strategy, entryPrice],
    { timeoutMs: 8000, label: 'density.registry.insert', maxRetries: 0 }
  );
  return inserted.rows?.[0]?.id;
}

async function ensureTradeSignal(symbol, strategy, entryPrice, rvol) {
  const existing = await queryWithTimeout(
    `SELECT id FROM trade_signals
     WHERE UPPER(symbol)=UPPER($1)
     ORDER BY created_at DESC NULLS LAST
     LIMIT 1`,
    [symbol],
    { timeoutMs: 8000, label: 'density.trade_signal.exists', maxRetries: 0 }
  );
  if ((existing.rows || []).length > 0) return Number(existing.rows[0].id);

  const inserted = await queryWithTimeout(
    `INSERT INTO trade_signals (symbol, strategy, setup_type, score, rvol, entry_price, created_at, updated_at, source_engine)
     VALUES ($1,$2,$2,70,$3,$4,NOW(),NOW(),'openrange')
     ON CONFLICT (symbol)
     DO UPDATE SET
       strategy = EXCLUDED.strategy,
       setup_type = EXCLUDED.setup_type,
       rvol = EXCLUDED.rvol,
       entry_price = EXCLUDED.entry_price,
       updated_at = NOW()
     RETURNING id`,
    [symbol, strategy, rvol, entryPrice],
    { timeoutMs: 8000, label: 'density.trade_signal.insert', maxRetries: 0 }
  );
  return Number(inserted.rows?.[0]?.id);
}

async function fetchPriceAtOrLatest(symbol, sinceMinutes) {
  const r = await queryWithTimeout(
    `SELECT close
     FROM intraday_1m
     WHERE UPPER(symbol)=UPPER($1)
       AND timestamp >= NOW() - ($2::int * interval '1 minute')
     ORDER BY timestamp ASC
     LIMIT 1`,
    [symbol, sinceMinutes],
    { timeoutMs: 8000, label: 'density.price.at_or_latest', maxRetries: 0 }
  );
  return num(r.rows?.[0]?.close, null);
}

async function fetchLatestPrice(symbol) {
  const r = await queryWithTimeout(
    `SELECT price
     FROM market_metrics
     WHERE UPPER(symbol)=UPPER($1)
     ORDER BY COALESCE(updated_at,last_updated,NOW()) DESC
     LIMIT 1`,
    [symbol],
    { timeoutMs: 8000, label: 'density.price.latest', maxRetries: 0 }
  );
  return num(r.rows?.[0]?.price, null);
}

function bucketRvol(rvol) {
  if (!Number.isFinite(rvol)) return 'unknown';
  if (rvol < 1.5) return 'low';
  if (rvol < 3) return 'medium';
  return 'high';
}

function marketConditionFromChange(changePercent) {
  const c = num(changePercent, 0);
  if (c > 0.5) return 'bullish';
  if (c < -0.5) return 'bearish';
  return 'range';
}

async function upsertStrategySegments() {
  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS strategy_outcome_segments (
       strategy text NOT NULL,
       market_condition text NOT NULL,
       rvol_bucket text NOT NULL,
       sample_count int NOT NULL,
       win_rate double precision,
       avg_pnl_pct double precision,
       avg_drawdown_pct double precision,
       updated_at timestamptz NOT NULL DEFAULT NOW(),
       PRIMARY KEY (strategy, market_condition, rvol_bucket)
     )`,
    [],
    { timeoutMs: 12000, label: 'density.segments.table', maxRetries: 0 }
  );

  await queryWithTimeout(
    `WITH base AS (
       SELECT
         COALESCE(NULLIF(ts.setup_type,''), NULLIF(ts.setup,''), 'momentum_continuation') AS strategy,
         CASE
           WHEN COALESCE(mm.change_percent, 0) > 0.5 THEN 'bullish'
           WHEN COALESCE(mm.change_percent, 0) < -0.5 THEN 'bearish'
           ELSE 'range'
         END AS market_condition,
         CASE
           WHEN COALESCE(ts.relative_volume, mm.relative_volume, 0) < 1.5 THEN 'low'
           WHEN COALESCE(ts.relative_volume, mm.relative_volume, 0) < 3 THEN 'medium'
           ELSE 'high'
         END AS rvol_bucket,
         COALESCE(to2.pnl_pct, to2.result_pct, 0) AS pnl_pct,
         COALESCE(to2.max_drawdown_pct, to2.max_drawdown, 0) AS drawdown_pct,
         CASE WHEN COALESCE(to2.pnl_pct, to2.result_pct, 0) > 0 OR to2.outcome='win' THEN 1 ELSE 0 END AS win_flag
       FROM trade_setups ts
       JOIN trade_outcomes to2 ON UPPER(to2.symbol)=UPPER(ts.symbol)
       LEFT JOIN market_metrics mm ON UPPER(mm.symbol)=UPPER(ts.symbol)
     ), agg AS (
       SELECT
         strategy,
         market_condition,
         rvol_bucket,
         COUNT(*)::int AS sample_count,
         ROUND(AVG(win_flag)::numeric * 100, 2)::double precision AS win_rate,
         ROUND(AVG(pnl_pct)::numeric, 4)::double precision AS avg_pnl_pct,
         ROUND(AVG(drawdown_pct)::numeric, 4)::double precision AS avg_drawdown_pct
       FROM base
       GROUP BY strategy, market_condition, rvol_bucket
     )
     INSERT INTO strategy_outcome_segments
       (strategy, market_condition, rvol_bucket, sample_count, win_rate, avg_pnl_pct, avg_drawdown_pct, updated_at)
     SELECT strategy, market_condition, rvol_bucket, sample_count, win_rate, avg_pnl_pct, avg_drawdown_pct, NOW()
     FROM agg
     ON CONFLICT (strategy, market_condition, rvol_bucket)
     DO UPDATE SET
       sample_count = EXCLUDED.sample_count,
       win_rate = EXCLUDED.win_rate,
       avg_pnl_pct = EXCLUDED.avg_pnl_pct,
       avg_drawdown_pct = EXCLUDED.avg_drawdown_pct,
       updated_at = NOW()`,
    [],
    { timeoutMs: 20000, label: 'density.segments.upsert', maxRetries: 0 }
  );
}

async function main() {
  const base = process.env.API_BASE || 'http://127.0.0.1:3001';
  const headers = { Accept: 'application/json' };
  if (process.env.PROXY_API_KEY) headers['x-api-key'] = process.env.PROXY_API_KEY;

  await ensureOutcomeColumns();

  const [topScreener, highRvol, gapMovers] = await Promise.all([
    fetchTopScreenerSymbols(base, headers, 50),
    fetchHighRvolSymbols(50),
    fetchGapMoverSymbols(50),
  ]);

  const targets = Array.from(new Set([...topScreener, ...highRvol, ...gapMovers])).slice(0, 120);

  let signalsCreated = 0;
  let signalsTouched = 0;
  let setupsCreated = 0;
  let outcomesUpdated = 0;

  const perSymbol = [];

  for (const symbol of targets) {
    const metric = await queryWithTimeout(
      `SELECT price, relative_volume, change_percent
       FROM market_metrics
       WHERE UPPER(symbol)=UPPER($1)
       ORDER BY COALESCE(updated_at,last_updated,NOW()) DESC
       LIMIT 1`,
      [symbol],
      { timeoutMs: 8000, label: 'density.metric.one', maxRetries: 0 }
    );

    const entryPrice = num(metric.rows?.[0]?.price, null);
    const relativeVolume = num(metric.rows?.[0]?.relative_volume, null);
    const changePercent = num(metric.rows?.[0]?.change_percent, 0);

    if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
      continue;
    }

    const signal = await ensureSignalForSymbol(symbol);
    if (signal.inserted) signalsCreated += 1;
    if (signal.touched) signalsTouched += 1;

    const setupInserted = await ensureSetup(signal.signalId, symbol, entryPrice, relativeVolume);
    if (setupInserted) setupsCreated += 1;

    const p5 = await fetchPriceAtOrLatest(symbol, 5);
    const p15 = await fetchPriceAtOrLatest(symbol, 15);
    const p60 = await fetchPriceAtOrLatest(symbol, 60);
    const latest = (await fetchLatestPrice(symbol)) ?? entryPrice;

    const pnl5 = Number.isFinite(p5) ? ((p5 - entryPrice) / entryPrice) * 100 : null;
    const pnl15 = Number.isFinite(p15) ? ((p15 - entryPrice) / entryPrice) * 100 : null;
    const pnl1h = Number.isFinite(p60) ? ((p60 - entryPrice) / entryPrice) * 100 : null;
    const pnlNow = ((latest - entryPrice) / entryPrice) * 100;
    const maxMovePct = Math.max(...[pnl5, pnl15, pnl1h, pnlNow].filter((x) => Number.isFinite(x)), 0);
    const maxDrawdownPct = Math.min(...[pnl5, pnl15, pnl1h, pnlNow].filter((x) => Number.isFinite(x)), 0);

    const strategy = 'momentum_continuation';
    const registrySignalId = await ensureRegistrySignal(symbol, strategy, entryPrice);
    const tradeSignalId = await ensureTradeSignal(symbol, strategy, entryPrice, relativeVolume);

    await queryWithTimeout(
      `INSERT INTO signal_outcomes
        (signal_id, symbol, strategy, entry_price, exit_price, return_percent, pnl_pct, pnl_5m, pnl_15m, pnl_1h, max_move_percent, move_down_percent, evaluated_at, outcome, created_at)
       VALUES ($1,$2,$3,$4,$5,$6::double precision,$6::double precision,$7::double precision,$8::double precision,$9::double precision,$10::double precision,$11::double precision,NOW(),CASE WHEN $6::double precision > 0 THEN 'win' WHEN $6::double precision < 0 THEN 'loss' ELSE 'breakeven' END,NOW())
       ON CONFLICT (signal_id)
       DO UPDATE SET
         symbol = EXCLUDED.symbol,
         strategy = EXCLUDED.strategy,
         exit_price = EXCLUDED.exit_price,
         return_percent = EXCLUDED.return_percent,
         pnl_pct = EXCLUDED.pnl_pct,
         pnl_5m = EXCLUDED.pnl_5m,
         pnl_15m = EXCLUDED.pnl_15m,
         pnl_1h = EXCLUDED.pnl_1h,
         max_move_percent = EXCLUDED.max_move_percent,
         move_down_percent = EXCLUDED.move_down_percent,
         evaluated_at = NOW(),
         outcome = EXCLUDED.outcome`,
      [registrySignalId, symbol, strategy, entryPrice, latest, pnlNow, pnl5, pnl15, pnl1h, maxMovePct, maxDrawdownPct],
      { timeoutMs: 8000, label: 'density.so.upsert', maxRetries: 0 }
    );

    await queryWithTimeout(
      `INSERT INTO trade_outcomes
        (signal_id, symbol, strategy, entry_price, exit_price, pnl_pct, pnl_5m, pnl_15m, pnl_1h, max_move, max_move_pct, max_drawdown, max_drawdown_pct, success, evaluation_time, evaluated_at, created_at, outcome)
       VALUES ($1,$2,$3,$4,$5,$6::double precision,$7::double precision,$8::double precision,$9::double precision,$10::double precision,$10::double precision,$11::double precision,$11::double precision,($6::double precision > 0),NOW(),NOW(),NOW(),CASE WHEN $6::double precision > 0 THEN 'win' WHEN $6::double precision < 0 THEN 'loss' ELSE 'breakeven' END)
       ON CONFLICT (signal_id)
       DO UPDATE SET
         symbol = EXCLUDED.symbol,
         strategy = EXCLUDED.strategy,
         entry_price = EXCLUDED.entry_price,
         exit_price = EXCLUDED.exit_price,
         pnl_pct = EXCLUDED.pnl_pct,
         pnl_5m = EXCLUDED.pnl_5m,
         pnl_15m = EXCLUDED.pnl_15m,
         pnl_1h = EXCLUDED.pnl_1h,
         max_move = EXCLUDED.max_move,
         max_move_pct = EXCLUDED.max_move_pct,
         max_drawdown = EXCLUDED.max_drawdown,
         max_drawdown_pct = EXCLUDED.max_drawdown_pct,
         success = EXCLUDED.success,
         outcome = EXCLUDED.outcome,
         evaluation_time = NOW(),
         evaluated_at = NOW()`,
      [tradeSignalId, symbol, strategy, entryPrice, latest, pnlNow, pnl5, pnl15, pnl1h, maxMovePct, maxDrawdownPct],
      { timeoutMs: 8000, label: 'density.to.upsert', maxRetries: 0 }
    );

    outcomesUpdated += 1;
    perSymbol.push({
      symbol,
      signal_id: signal.signalId,
      market_condition: marketConditionFromChange(changePercent),
      rvol_bucket: bucketRvol(relativeVolume),
      pnl_pct: pnlNow,
      pnl_5m: pnl5,
      pnl_15m: pnl15,
      pnl_1h: pnl1h,
    });
  }

  await upsertStrategySegments();

  const overlap = await queryWithTimeout(
    `SELECT COUNT(*)::int AS n
     FROM signals s
     JOIN trade_setups ts ON ts.signal_id = s.id
     JOIN signal_outcomes so ON UPPER(so.symbol)=UPPER(s.symbol)
     JOIN trade_outcomes to2 ON UPPER(to2.symbol)=UPPER(s.symbol)`,
    [],
    { timeoutMs: 10000, label: 'density.overlap', maxRetries: 0 }
  );

  console.log(JSON.stringify({
    targetUniverse: targets.length,
    signals_created: signalsCreated,
    signals_touched: signalsTouched,
    setups_created: setupsCreated,
    outcomes_updated: outcomesUpdated,
    overlap_count: Number(overlap.rows?.[0]?.n || 0),
    sample: perSymbol.slice(0, 10),
  }, null, 2));

  if (signalsCreated <= 20) {
    throw new Error(`signals_created threshold not met: ${signalsCreated}`);
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
