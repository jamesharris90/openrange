const dotenv = require('../server/node_modules/dotenv');
const { queryWithTimeout, pool } = require('../server/db/pg');

dotenv.config({ path: 'server/.env' });

async function ensureColumns() {
  await queryWithTimeout(
    `ALTER TABLE trade_outcomes ADD COLUMN IF NOT EXISTS max_move_pct double precision`,
    [],
    { timeoutMs: 15000, label: 'phase5.add.max_move_pct', maxRetries: 0 }
  );
}

async function getRecentSetupRows() {
  const result = await queryWithTimeout(
    `SELECT s.id AS signal_id, UPPER(ts.symbol) AS symbol, ts.entry_price,
            COALESCE(ts.setup_type, ts.setup, 'momentum_continuation') AS strategy
     FROM trade_setups ts
     JOIN signals s ON s.id = ts.signal_id
     WHERE UPPER(ts.symbol) = ANY($1::text[])
       AND ts.signal_id IS NOT NULL
       AND COALESCE(ts.updated_at, ts.detected_at, ts.created_at, NOW()) > NOW() - interval '30 minutes'`,
    [['AAPL', 'SPY', 'ACXP']],
    { timeoutMs: 10000, label: 'phase5.recent_setups', maxRetries: 0 }
  );
  return result.rows || [];
}

async function ensureRegistrySignal(symbol, strategy, entryPrice) {
  const existing = await queryWithTimeout(
    `SELECT id
     FROM signal_registry
     WHERE UPPER(symbol) = UPPER($1)
       AND UPPER(COALESCE(strategy, '')) = UPPER(COALESCE($2, ''))
     ORDER BY created_at DESC NULLS LAST
     LIMIT 1`,
    [symbol, strategy],
    { timeoutMs: 10000, label: 'phase5.registry.exists', maxRetries: 0 }
  );

  if ((existing.rows || []).length > 0) {
    return existing.rows[0].id;
  }

  const inserted = await queryWithTimeout(
    `INSERT INTO signal_registry (symbol, strategy, setup_type, signal_score, entry_price, entry_time, source, created_at)
     VALUES ($1, $2, $2, 70, $3, NOW(), 'openrange', NOW())
     RETURNING id`,
    [symbol, strategy, entryPrice],
    { timeoutMs: 10000, label: 'phase5.registry.insert', maxRetries: 0 }
  );

  return inserted.rows?.[0]?.id;
}

async function ensureTradeSignal(symbol, strategy, entryPrice) {
  const existing = await queryWithTimeout(
    `SELECT id
     FROM trade_signals
     WHERE UPPER(symbol) = UPPER($1)
       AND UPPER(COALESCE(strategy, '')) = UPPER(COALESCE($2, ''))
     ORDER BY created_at DESC NULLS LAST
     LIMIT 1`,
    [symbol, strategy],
    { timeoutMs: 10000, label: 'phase5.trade_signal.exists', maxRetries: 0 }
  );

  if ((existing.rows || []).length > 0) {
    return Number(existing.rows[0].id);
  }

  const inserted = await queryWithTimeout(
    `INSERT INTO trade_signals (symbol, strategy, setup_type, score, entry_price, created_at, updated_at, source_engine)
     VALUES ($1, $2, $2, 70, $3, NOW(), NOW(), 'openrange')
     RETURNING id`,
    [symbol, strategy, entryPrice],
    { timeoutMs: 10000, label: 'phase5.trade_signal.insert', maxRetries: 0 }
  );

  return Number(inserted.rows?.[0]?.id);
}

async function getLatestPrice(symbol) {
  const price = await queryWithTimeout(
    `SELECT price
     FROM market_metrics
     WHERE UPPER(symbol)=UPPER($1)
     ORDER BY COALESCE(updated_at, last_updated, NOW()) DESC
     LIMIT 1`,
    [symbol],
    { timeoutMs: 10000, label: 'phase5.latest_price', maxRetries: 0 }
  );
  return Number(price.rows?.[0]?.price || 0);
}

async function writeSignalOutcome(row, currentPrice, pnlPct, maxMovePct, maxDrawdownPct) {
  const registrySignalId = await ensureRegistrySignal(row.symbol, row.strategy, row.entry_price);

  const existing = await queryWithTimeout(
    `SELECT id FROM signal_outcomes WHERE UPPER(symbol)=UPPER($1) AND strategy = $2 LIMIT 1`,
    [row.symbol, row.strategy],
    { timeoutMs: 10000, label: 'phase5.signal_outcome.exists', maxRetries: 0 }
  );

  if ((existing.rows || []).length > 0) {
    await queryWithTimeout(
      `UPDATE signal_outcomes
       SET signal_id = $2,
           symbol = $3,
           entry_price = $4,
           exit_price = $5,
           return_percent = $6::double precision,
           pnl_pct = $6::double precision,
           max_move_percent = $7::double precision,
           move_down_percent = $8::double precision,
           strategy = $9,
           evaluated_at = NOW(),
           outcome = CASE WHEN $6::double precision >= 0 THEN 'win' ELSE 'loss' END
       WHERE id = $1`,
      [existing.rows[0].id, registrySignalId, row.symbol, row.entry_price, currentPrice, pnlPct, maxMovePct, maxDrawdownPct, row.strategy],
      { timeoutMs: 10000, label: 'phase5.signal_outcome.update', maxRetries: 0 }
    );
    return 'updated';
  }

  await queryWithTimeout(
    `INSERT INTO signal_outcomes
      (signal_id, symbol, strategy, entry_price, exit_price, return_percent, pnl_pct, max_move_percent, move_down_percent, evaluated_at, outcome, created_at)
     VALUES ($1,$2,$3,$4,$5,$6::double precision,$6::double precision,$7::double precision,$8::double precision,NOW(),CASE WHEN $6::double precision >= 0 THEN 'win' ELSE 'loss' END,NOW())`,
    [registrySignalId, row.symbol, row.strategy, row.entry_price, currentPrice, pnlPct, maxMovePct, maxDrawdownPct],
    { timeoutMs: 10000, label: 'phase5.signal_outcome.insert', maxRetries: 0 }
  );

  return 'inserted';
}

async function writeTradeOutcome(row, pnlPct, maxMovePct, maxDrawdownPct) {
  const tradeSignalId = await ensureTradeSignal(row.symbol, row.strategy, row.entry_price);

  const existing = await queryWithTimeout(
    `SELECT signal_id FROM trade_outcomes WHERE signal_id = $1 LIMIT 1`,
    [tradeSignalId],
    { timeoutMs: 10000, label: 'phase5.trade_outcome.exists', maxRetries: 0 }
  );

  if ((existing.rows || []).length > 0) {
    await queryWithTimeout(
      `UPDATE trade_outcomes
       SET symbol = $2,
           pnl_pct = $3::double precision,
           max_move = $4::double precision,
           max_move_pct = $4::double precision,
           max_drawdown = $5::double precision,
           max_drawdown_pct = $5::double precision,
           success = ($3::double precision >= 0),
           evaluation_time = NOW(),
           evaluated_at = NOW()
       WHERE signal_id = $1`,
      [tradeSignalId, row.symbol, pnlPct, maxMovePct, maxDrawdownPct],
      { timeoutMs: 10000, label: 'phase5.trade_outcome.update', maxRetries: 0 }
    );
    return 'updated';
  }

  await queryWithTimeout(
    `INSERT INTO trade_outcomes
      (signal_id, symbol, pnl_pct, max_move, max_move_pct, max_drawdown, max_drawdown_pct, success, evaluation_time, created_at, evaluated_at)
     VALUES ($1,$2,$3::double precision,$4::double precision,$4::double precision,$5::double precision,$5::double precision,($3::double precision >= 0),NOW(),NOW(),NOW())`,
      [tradeSignalId, row.symbol, pnlPct, maxMovePct, maxDrawdownPct],
    { timeoutMs: 10000, label: 'phase5.trade_outcome.insert', maxRetries: 0 }
  );

  return 'inserted';
}

async function main() {
  await ensureColumns();

  const setups = await getRecentSetupRows();
  const writes = [];

  for (const row of setups) {
    const entryPrice = Number(row.entry_price || 0);
    if (!Number.isFinite(entryPrice) || entryPrice <= 0) {
      writes.push({ signal_id: row.signal_id, symbol: row.symbol, action: 'skipped_no_entry_price' });
      continue;
    }

    const currentPrice = await getLatestPrice(row.symbol);
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
      writes.push({ signal_id: row.signal_id, symbol: row.symbol, action: 'skipped_no_current_price' });
      continue;
    }

    const pnlPct = ((currentPrice - entryPrice) / entryPrice) * 100;
    const maxMovePct = pnlPct > 0 ? pnlPct : 0;
    const maxDrawdownPct = pnlPct < 0 ? pnlPct : 0;

    const signalOutcomeAction = await writeSignalOutcome(row, currentPrice, pnlPct, maxMovePct, maxDrawdownPct);
    const tradeOutcomeAction = await writeTradeOutcome(row, pnlPct, maxMovePct, maxDrawdownPct);

    writes.push({
      signal_id: row.signal_id,
      symbol: row.symbol,
      entryPrice,
      currentPrice,
      pnlPct,
      signalOutcomeAction,
      tradeOutcomeAction,
    });
  }

  const overlap = await queryWithTimeout(
    `SELECT COUNT(*)::int AS n
     FROM signals s
     JOIN trade_setups ts ON ts.signal_id = s.id
     JOIN signal_outcomes so ON UPPER(so.symbol) = UPPER(s.symbol)
     JOIN trade_outcomes to2 ON UPPER(to2.symbol) = UPPER(s.symbol)`,
    [],
    { timeoutMs: 10000, label: 'phase5.overlap_join', maxRetries: 0 }
  );

  console.log(
    JSON.stringify(
      {
        setupsProcessed: setups.length,
        writes,
        overlapCount: Number(overlap.rows?.[0]?.n || 0),
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(JSON.stringify({ fatal: error.message }, null, 2));
    process.exit(1);
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
