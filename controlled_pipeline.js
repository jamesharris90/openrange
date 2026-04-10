const dotenv = require('./server/node_modules/dotenv');
dotenv.config({ path: 'server/.env' });
const { queryWithTimeout, pool } = require('./server/db/pg');
const { runStrategySignalEngine } = require('./server/engines/strategySignalEngine');

const nowIso = new Date().toISOString();
const asNum = (v, d = null) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

(async () => {
  const summary = {
    signalsGeneratedByEngine: 0,
    signalsSelectedForLoop: 0,
    setupsCreated: 0,
    signalOutcomesWritten: 0,
    tradeOutcomesWritten: 0,
    overlapCount: 0,
    decisionAAPL: null,
  };

  try {
    const engineResult = await runStrategySignalEngine().catch((e) => ({ error: e.message }));
    summary.signalsGeneratedByEngine = Number(engineResult?.signalsCreated || engineResult?.created || 0);

    const [signalColsRes, setupColsRes] = await Promise.all([
      queryWithTimeout(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='signals'",
        [],
        { timeoutMs: 10000, label: 'pipeline.cols.signals', maxRetries: 0 }
      ),
      queryWithTimeout(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='trade_setups'",
        [],
        { timeoutMs: 10000, label: 'pipeline.cols.trade_setups', maxRetries: 0 }
      ),
    ]);

    const signalCols = new Set((signalColsRes.rows || []).map((r) => r.column_name));
    const setupCols = new Set((setupColsRes.rows || []).map((r) => r.column_name));

    const screenerRes = await fetch('http://localhost:3001/api/screener');
    const screenerJson = await screenerRes.json().catch(() => ({}));
    const screenerSymbols = Array.isArray(screenerJson?.rows)
      ? screenerJson.rows.slice(0, 6).map((r) => String(r.symbol || '').toUpperCase()).filter(Boolean)
      : [];

    const desiredSymbols = Array.from(new Set(['AAPL', ...screenerSymbols])).slice(0, 8);

    const mmRes = await queryWithTimeout(
      `SELECT symbol, price
       FROM market_metrics
       WHERE symbol = ANY($1::text[])
       ORDER BY COALESCE(updated_at, last_updated, NOW()) DESC`,
      [desiredSymbols],
      { timeoutMs: 10000, label: 'pipeline.market_metrics.for_symbols', maxRetries: 0 }
    );

    const priceBySymbol = new Map();
    for (const row of mmRes.rows || []) {
      const symbol = String(row.symbol || '').toUpperCase();
      if (!priceBySymbol.has(symbol)) {
        priceBySymbol.set(symbol, asNum(row.price, null));
      }
    }

    const selectedSignals = [];
    for (const symbol of desiredSymbols) {
      const entryPrice = priceBySymbol.get(symbol);
      if (!Number.isFinite(entryPrice) || entryPrice <= 0) continue;

      const existing = await queryWithTimeout(
        `SELECT id, symbol, signal_type, created_at
         FROM signals
         WHERE symbol = $1
         ORDER BY created_at DESC
         LIMIT 1`,
        [symbol],
        { timeoutMs: 8000, label: 'pipeline.select.recent_signal', maxRetries: 0 }
      );

      let signal = existing.rows?.[0] || null;

      if (!signal && signalCols.has('id')) {
        const inserted = await queryWithTimeout(
          `INSERT INTO signals (symbol, signal_type, score, confidence, catalyst_ids, created_at)
           VALUES ($1,$2,$3,$4,$5,NOW())
           RETURNING id, symbol, signal_type, created_at`,
          [symbol, 'momentum_continuation', 0.7, 0.7, []],
          { timeoutMs: 8000, label: 'pipeline.insert.signal', maxRetries: 0 }
        );
        signal = inserted.rows?.[0] || null;
      }

      if (!signal) continue;

      selectedSignals.push({
        signal_id: signal.id,
        symbol: String(signal.symbol || symbol).toUpperCase(),
        strategy: String(signal.signal_type || 'momentum_continuation'),
        timestamp: signal.created_at || nowIso,
        entry_price: entryPrice,
      });
    }

    summary.signalsSelectedForLoop = selectedSignals.length;

    for (const sig of selectedSignals) {
      if (!sig.signal_id || !sig.symbol || !Number.isFinite(sig.entry_price)) continue;

      let exists;
      if (setupCols.has('signal_id')) {
        exists = await queryWithTimeout(
          `SELECT id FROM trade_setups WHERE signal_id::text = $1::text LIMIT 1`,
          [String(sig.signal_id)],
          { timeoutMs: 8000, label: 'pipeline.trade_setups.exists_signal', maxRetries: 0 }
        );
      } else {
        exists = await queryWithTimeout(
          `SELECT id FROM trade_setups WHERE symbol = $1 LIMIT 1`,
          [sig.symbol],
          { timeoutMs: 8000, label: 'pipeline.trade_setups.exists_symbol', maxRetries: 0 }
        );
      }

      if ((exists.rows || []).length > 0) continue;

      const cols = ['symbol'];
      const vals = [sig.symbol];
      if (setupCols.has('setup')) { cols.push('setup'); vals.push(sig.strategy); }
      if (setupCols.has('setup_type')) { cols.push('setup_type'); vals.push(sig.strategy); }
      if (setupCols.has('strategy')) { cols.push('strategy'); vals.push(sig.strategy); }
      if (setupCols.has('signal_id')) { cols.push('signal_id'); vals.push(sig.signal_id); }
      if (setupCols.has('entry_price')) { cols.push('entry_price'); vals.push(sig.entry_price); }
      if (setupCols.has('score')) { cols.push('score'); vals.push(70); }
      if (setupCols.has('detected_at')) { cols.push('detected_at'); vals.push(nowIso); }
      if (setupCols.has('updated_at')) { cols.push('updated_at'); vals.push(nowIso); }
      if (setupCols.has('created_at')) { cols.push('created_at'); vals.push(nowIso); }

      const placeholders = vals.map((_, i) => `$${i + 1}`).join(',');
      await queryWithTimeout(
        `INSERT INTO trade_setups (${cols.join(',')}) VALUES (${placeholders})`,
        vals,
        { timeoutMs: 8000, label: 'pipeline.trade_setups.insert', maxRetries: 0 }
      );

      summary.setupsCreated += 1;
    }

    for (const sig of selectedSignals) {
      const symbol = sig.symbol;
      const signalId = sig.signal_id;
      const entryPrice = asNum(sig.entry_price, null);
      if (!symbol || !signalId || !Number.isFinite(entryPrice) || entryPrice <= 0) continue;

      const pxRes = await queryWithTimeout(
        `SELECT price FROM market_metrics WHERE symbol = $1 ORDER BY COALESCE(updated_at, last_updated, NOW()) DESC LIMIT 1`,
        [symbol],
        { timeoutMs: 8000, label: 'pipeline.market_metrics.price_now', maxRetries: 0 }
      );
      const currentPrice = asNum(pxRes.rows?.[0]?.price, null);
      if (!Number.isFinite(currentPrice) || currentPrice <= 0) continue;

      const pnlPct = ((currentPrice - entryPrice) / entryPrice) * 100;
      const success = pnlPct > 0;
      const maxMovePct = pnlPct > 0 ? pnlPct : 0;
      const maxDrawdownPct = pnlPct < 0 ? pnlPct : 0;

      const soExists = await queryWithTimeout(
        `SELECT id FROM signal_outcomes WHERE signal_id::text = $1::text LIMIT 1`,
        [String(signalId)],
        { timeoutMs: 8000, label: 'pipeline.signal_outcomes.exists', maxRetries: 0 }
      );

      if ((soExists.rows || []).length === 0) {
        await queryWithTimeout(
          `INSERT INTO signal_outcomes
            (signal_id, symbol, entry_price, exit_price, return_percent, pnl_pct, max_move_percent, move_down_percent, evaluated_at, outcome, created_at)
           VALUES ($1,$2,$3,$4,$5,$5,$6,$7,NOW(),$8,NOW())`,
          [signalId, symbol, entryPrice, currentPrice, pnlPct, maxMovePct, maxDrawdownPct, success ? 'win' : 'loss'],
          { timeoutMs: 8000, label: 'pipeline.signal_outcomes.insert', maxRetries: 0 }
        );
        summary.signalOutcomesWritten += 1;
      }

      const toExists = await queryWithTimeout(
        `SELECT signal_id FROM trade_outcomes WHERE signal_id::text = $1::text LIMIT 1`,
        [String(signalId)],
        { timeoutMs: 8000, label: 'pipeline.trade_outcomes.exists', maxRetries: 0 }
      );

      if ((toExists.rows || []).length === 0) {
        await queryWithTimeout(
          `INSERT INTO trade_outcomes
            (signal_id, symbol, pnl_pct, max_move, max_drawdown, max_drawdown_pct, success, evaluation_time, created_at)
           VALUES ($1,$2,$3,$4,$5,$5,$6,NOW(),NOW())`,
          [signalId, symbol, pnlPct, maxMovePct, maxDrawdownPct, success],
          { timeoutMs: 8000, label: 'pipeline.trade_outcomes.insert', maxRetries: 0 }
        );
        summary.tradeOutcomesWritten += 1;
      }
    }

    const overlapRes = await queryWithTimeout(
      `SELECT COUNT(*)::int AS n
       FROM trade_setups ts
       JOIN signal_outcomes so ON ts.signal_id::text = so.signal_id::text`,
      [],
      { timeoutMs: 10000, label: 'pipeline.overlap', maxRetries: 0 }
    );

    summary.overlapCount = Number(overlapRes.rows?.[0]?.n || 0);

    const decisionRes = await fetch('http://localhost:3001/api/intelligence/decision/AAPL');
    const decisionJson = await decisionRes.json().catch(() => ({}));
    summary.decisionAAPL = {
      status: decisionRes.status,
      execution_plan: decisionJson?.decision?.execution_plan ?? null,
      data_quality: decisionJson?.decision?.data_quality ?? null,
      decision_score: decisionJson?.decision?.decision_score ?? null,
    };

    console.log(JSON.stringify(summary, null, 2));
  } catch (err) {
    console.error('PIPELINE_RUN_ERROR', err.message);
    process.exit(1);
  } finally {
    await pool.end().catch(() => {});
  }
})();
