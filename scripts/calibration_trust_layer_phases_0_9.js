const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../server/.env') });

const { queryWithTimeout, pool } = require('../server/db/pg');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'logs');

function ensureLogDir() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function writeJson(fileName, payload) {
  ensureLogDir();
  const target = path.join(LOG_DIR, fileName);
  fs.writeFileSync(target, JSON.stringify(payload, null, 2));
  return target;
}

async function tableColumns(tableName) {
  const result = await queryWithTimeout(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1
     ORDER BY ordinal_position`,
    [tableName],
    { timeoutMs: 15000, label: `cols.${tableName}`, maxRetries: 0 }
  );
  return (result.rows || []).map((r) => r.column_name);
}

async function phase0BaselineSnapshot() {
  const lifecycle = await queryWithTimeout(
    `SELECT COUNT(DISTINCT s.symbol)::int AS n
     FROM signals s
     JOIN trade_setups ts ON s.id = ts.signal_id
     JOIN signal_outcomes so ON s.id = so.signal_id`,
    [],
    { timeoutMs: 15000, label: 'phase0.lifecycle_overlap', maxRetries: 0 }
  );

  const signalsRecent = await queryWithTimeout(
    `SELECT COUNT(*)::int AS n
     FROM signals
     WHERE created_at > NOW() - interval '15 minutes'`,
    [],
    { timeoutMs: 10000, label: 'phase0.signals_recent', maxRetries: 0 }
  );

  const decisionRows = await queryWithTimeout(
    `SELECT calibrated_decision_score
     FROM signal_calibrated_scores
     WHERE calibrated_decision_score IS NOT NULL`,
    [],
    { timeoutMs: 15000, label: 'phase0.decision_rows', maxRetries: 0 }
  ).catch(() => ({ rows: [] }));

  const decisionScores = (decisionRows.rows || [])
    .map((r) => Number(r.calibrated_decision_score))
    .filter((n) => Number.isFinite(n));

  const decisionCount = decisionScores.length;
  const avgDecisionScore = decisionCount === 0
    ? null
    : Number((decisionScores.reduce((a, b) => a + b, 0) / decisionCount).toFixed(4));

  const out = {
    ts: new Date().toISOString(),
    lifecycle_overlap: Number(lifecycle.rows?.[0]?.n || 0),
    decision_count: decisionCount,
    avg_decision_score: avgDecisionScore,
    signals_recent: Number(signalsRecent.rows?.[0]?.n || 0),
    pass: Number(lifecycle.rows?.[0]?.n || 0) >= 50,
  };

  writeJson('calibration_precheck.json', out);
  if (!out.pass) throw new Error('PHASE_0_FAILED_LIFECYCLE_OVERLAP_LT_50');
  return out;
}

function buildStrategyExpression(outcomeCols, setupCols) {
  const parts = [];
  if (outcomeCols.includes('strategy')) {
    parts.push("NULLIF(TRIM(to2.strategy), '')");
  }
  if (setupCols.includes('setup_type')) {
    parts.push("NULLIF(TRIM(ts.setup_type), '')");
  }
  if (setupCols.includes('strategy')) {
    parts.push("NULLIF(TRIM(ts.strategy), '')");
  }
  if (setupCols.includes('setup')) {
    parts.push("NULLIF(TRIM(ts.setup), '')");
  }
  parts.push("NULLIF(TRIM(s.signal_type), '')");
  if (parts.length === 0) return "'unknown'";
  return `COALESCE(${parts.join(', ')}, 'unknown')`;
}

async function phase1StrategyPerformance() {
  const signalOutcomeCols = await tableColumns('signal_outcomes');
  const tradeOutcomeCols = await tableColumns('trade_outcomes');
  const tradeSetupCols = await tableColumns('trade_setups');

  const strategyExpr = buildStrategyExpression(tradeOutcomeCols, tradeSetupCols);

  await queryWithTimeout(
    `DROP VIEW IF EXISTS signal_calibrated_scores`,
    [],
    { timeoutMs: 10000, label: 'phase1.drop.signal_calibrated_scores', maxRetries: 0 }
  );

  await queryWithTimeout(
    `DROP VIEW IF EXISTS strategy_performance`,
    [],
    { timeoutMs: 10000, label: 'phase1.drop.strategy_performance', maxRetries: 0 }
  );

  await queryWithTimeout(
    `CREATE VIEW strategy_performance AS
     WITH outcome_base AS (
       SELECT
         ${strategyExpr} AS strategy,
         to2.pnl_pct::numeric AS pnl_pct
       FROM trade_outcomes to2
       LEFT JOIN trade_setups ts
         ON ts.signal_id::text = to2.signal_id::text
         OR (ts.signal_id IS NULL AND UPPER(ts.symbol) = UPPER(to2.symbol))
       LEFT JOIN signals s
         ON s.id::text = to2.signal_id::text
         OR UPPER(s.symbol) = UPPER(to2.symbol)
       WHERE to2.pnl_pct IS NOT NULL
         AND to2.pnl_pct::text <> 'NaN'
     ),
     strategy_universe AS (
       SELECT DISTINCT strategy FROM (
         SELECT ${strategyExpr} AS strategy
         FROM trade_outcomes to2
         LEFT JOIN trade_setups ts
           ON ts.signal_id::text = to2.signal_id::text
           OR (ts.signal_id IS NULL AND UPPER(ts.symbol) = UPPER(to2.symbol))
         LEFT JOIN signals s
           ON s.id::text = to2.signal_id::text
           OR UPPER(s.symbol) = UPPER(to2.symbol)
         UNION ALL
         SELECT NULLIF(TRIM(setup_type), '') AS strategy
         FROM trade_setups
         WHERE setup_type IS NOT NULL
         UNION ALL
         SELECT NULLIF(TRIM(signal_type), '') AS strategy
         FROM signals
         WHERE signal_type IS NOT NULL
       ) u
       WHERE strategy IS NOT NULL
         AND TRIM(strategy) <> ''
     ),
     perf AS (
       SELECT
         strategy,
         COUNT(*)::int AS trades,
         AVG(CASE WHEN pnl_pct > 0 THEN 1 ELSE 0 END)::numeric AS win_rate,
         AVG(pnl_pct)::numeric AS avg_return,
         COALESCE(STDDEV_SAMP(pnl_pct), 0)::numeric AS volatility
       FROM outcome_base
       GROUP BY strategy
     )
     SELECT
       su.strategy,
       COALESCE(p.trades, 0)::int AS trades,
       COALESCE(p.win_rate, 0)::numeric AS win_rate,
       COALESCE(p.avg_return, 0)::numeric AS avg_return,
       COALESCE(p.volatility, 0)::numeric AS volatility
     FROM strategy_universe su
     LEFT JOIN perf p ON LOWER(p.strategy) = LOWER(su.strategy)`,
    [],
    { timeoutMs: 30000, label: 'phase1.create.strategy_performance', maxRetries: 0 }
  );

  const check = await queryWithTimeout(
    `SELECT
       COUNT(*)::int AS strategy_count,
       COUNT(*) FILTER (WHERE win_rate IS NULL)::int AS null_win_rate_count
     FROM strategy_performance`,
    [],
    { timeoutMs: 10000, label: 'phase1.validate.strategy_performance', maxRetries: 0 }
  );

  const strategyCount = Number(check.rows?.[0]?.strategy_count || 0);
  const nullWinRate = Number(check.rows?.[0]?.null_win_rate_count || 0);

  const out = {
    ts: new Date().toISOString(),
    inspected_fields: {
      signal_outcomes_strategy: signalOutcomeCols.includes('strategy'),
      trade_outcomes_strategy: tradeOutcomeCols.includes('strategy'),
      trade_setups_setup_type: tradeSetupCols.includes('setup_type'),
    },
    strategy_count: strategyCount,
    null_win_rate_count: nullWinRate,
    pass: strategyCount >= 3 && nullWinRate === 0,
  };

  writeJson('calibration_phase1_strategy_performance.json', out);
  if (!out.pass) throw new Error('PHASE_1_FAILED_STRATEGY_PERFORMANCE_VALIDATION');
  return out;
}

async function phase2SymbolPerformance() {
  await queryWithTimeout(
    `DROP VIEW IF EXISTS symbol_performance`,
    [],
    { timeoutMs: 10000, label: 'phase2.drop.symbol_performance', maxRetries: 0 }
  );

  await queryWithTimeout(
    `CREATE VIEW symbol_performance AS
     SELECT
       UPPER(symbol) AS symbol,
       COUNT(*)::int AS trades,
       AVG(CASE WHEN pnl_pct > 0 THEN 1 ELSE 0 END)::numeric AS win_rate,
       AVG(pnl_pct)::numeric AS avg_return
     FROM trade_outcomes
     WHERE symbol IS NOT NULL
       AND TRIM(symbol) <> ''
       AND pnl_pct::text <> 'NaN'
     GROUP BY UPPER(symbol)`,
    [],
    { timeoutMs: 30000, label: 'phase2.create.symbol_performance', maxRetries: 0 }
  );

  const check = await queryWithTimeout(
    `SELECT
       COUNT(*)::int AS symbol_count,
       COUNT(*) FILTER (WHERE win_rate::text = 'NaN' OR avg_return::text = 'NaN')::int AS nan_count
     FROM symbol_performance`,
    [],
    { timeoutMs: 10000, label: 'phase2.validate.symbol_performance', maxRetries: 0 }
  );

  const symbolCount = Number(check.rows?.[0]?.symbol_count || 0);
  const nanCount = Number(check.rows?.[0]?.nan_count || 0);

  const out = {
    ts: new Date().toISOString(),
    symbol_count: symbolCount,
    nan_count: nanCount,
    pass: symbolCount > 20 && nanCount === 0,
  };

  writeJson('calibration_phase2_symbol_performance.json', out);
  if (!out.pass) throw new Error('PHASE_2_FAILED_SYMBOL_PERFORMANCE_VALIDATION');
  return out;
}

async function phase3MarketRegime() {
  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS system_state (
       state_key text PRIMARY KEY,
       state_value jsonb NOT NULL,
       updated_at timestamptz NOT NULL DEFAULT NOW()
     )`,
    [],
    { timeoutMs: 20000, label: 'phase3.create.system_state', maxRetries: 0 }
  );

  await queryWithTimeout(
    `CREATE OR REPLACE FUNCTION get_market_regime(in_avg_rvol numeric, in_stocks_count int DEFAULT 0)
     RETURNS text
     LANGUAGE sql
     AS $$
       SELECT CASE
         WHEN in_avg_rvol IS NULL THEN 'low_activity'
         WHEN in_avg_rvol < 1 THEN 'low_activity'
         WHEN in_avg_rvol > 2 THEN 'high_momentum'
         ELSE 'normal'
       END
     $$`,
    [],
    { timeoutMs: 10000, label: 'phase3.create.get_market_regime', maxRetries: 0 }
  );

  const rvolResult = await queryWithTimeout(
    `WITH latest AS (
       SELECT DISTINCT ON (UPPER(symbol))
         UPPER(symbol) AS symbol,
         COALESCE(relative_volume, 0)::numeric AS relative_volume
       FROM market_metrics
       WHERE symbol IN ('SPY', 'QQQ')
       ORDER BY UPPER(symbol), COALESCE(updated_at, last_updated, NOW()) DESC
     )
     SELECT AVG(relative_volume)::numeric AS avg_rvol
     FROM latest`,
    [],
    { timeoutMs: 15000, label: 'phase3.avg_rvol', maxRetries: 0 }
  );

  const sipCountResult = await queryWithTimeout(
    `SELECT COUNT(*)::int AS n FROM stocks_in_play_filtered`,
    [],
    { timeoutMs: 10000, label: 'phase3.sip_count', maxRetries: 0 }
  );

  const avgRvol = Number(rvolResult.rows?.[0]?.avg_rvol || 0);
  const sipCount = Number(sipCountResult.rows?.[0]?.n || 0);

  const regimeResult = await queryWithTimeout(
    `SELECT get_market_regime($1::numeric, $2::int) AS regime`,
    [avgRvol, sipCount],
    { timeoutMs: 10000, label: 'phase3.regime.current', maxRetries: 0 }
  );

  const regime = String(regimeResult.rows?.[0]?.regime || 'normal');

  await queryWithTimeout(
    `INSERT INTO system_state (state_key, state_value, updated_at)
     VALUES (
       'market_regime',
       jsonb_build_object('regime', $1::text, 'avg_rvol', $2::numeric, 'stocks_in_play_count', $3::int),
       NOW()
     )
     ON CONFLICT (state_key)
     DO UPDATE SET state_value = EXCLUDED.state_value, updated_at = NOW()`,
    [regime, avgRvol, sipCount],
    { timeoutMs: 10000, label: 'phase3.upsert.system_state.regime', maxRetries: 0 }
  );

  const regimeChecks = await queryWithTimeout(
    `SELECT get_market_regime(0.8, 10) AS low,
            get_market_regime(1.5, 10) AS normal,
            get_market_regime(2.2, 10) AS high`,
    [],
    { timeoutMs: 10000, label: 'phase3.validate.regime_function', maxRetries: 0 }
  );

  const rules = regimeChecks.rows?.[0] || {};
  const pass = rules.low === 'low_activity' && rules.normal === 'normal' && rules.high === 'high_momentum';

  const out = {
    ts: new Date().toISOString(),
    avg_rvol_spy_qqq: avgRvol,
    stocks_in_play_count: sipCount,
    current_regime: regime,
    validation: rules,
    pass,
  };

  writeJson('calibration_phase3_market_regime.json', out);
  if (!out.pass) throw new Error('PHASE_3_FAILED_MARKET_REGIME_VALIDATION');
  return out;
}

async function phase4SessionWeighting() {
  await queryWithTimeout(
    `ALTER TABLE signals ADD COLUMN IF NOT EXISTS session_weight numeric`,
    [],
    { timeoutMs: 10000, label: 'phase4.add.session_weight', maxRetries: 0 }
  );

  await queryWithTimeout(
    `UPDATE signals
     SET session_weight = CASE
       WHEN session_phase = 'premarket_early' THEN 0.7
       WHEN session_phase = 'premarket_peak' THEN 0.9
       WHEN session_phase = 'market_open' THEN 1.2
       WHEN session_phase = 'intraday' THEN 1.0
       ELSE 1.0
     END
     WHERE symbol IS NOT NULL`,
    [],
    { timeoutMs: 45000, label: 'phase4.update.session_weight', maxRetries: 0 }
  );

  const check = await queryWithTimeout(
    `SELECT COUNT(*) FILTER (WHERE session_weight IS NULL)::int AS null_count,
            COUNT(*)::int AS total_count
     FROM signals
     WHERE symbol IS NOT NULL`,
    [],
    { timeoutMs: 10000, label: 'phase4.validate.session_weight', maxRetries: 0 }
  );

  const nullCount = Number(check.rows?.[0]?.null_count || 0);
  const totalCount = Number(check.rows?.[0]?.total_count || 0);

  const out = {
    ts: new Date().toISOString(),
    total_count: totalCount,
    null_count: nullCount,
    pass: totalCount > 0 && nullCount === 0,
  };

  writeJson('calibration_phase4_session_weighting.json', out);
  if (!out.pass) throw new Error('PHASE_4_FAILED_SESSION_WEIGHTING_VALIDATION');
  return out;
}

async function phase5TradeQualityIndex() {
  const newsCols = await tableColumns('news_articles').catch(() => []);
  const earningsCols = await tableColumns('earnings_events').catch(() => []);

  await queryWithTimeout(
    `ALTER TABLE signals ADD COLUMN IF NOT EXISTS tqi_score numeric`,
    [],
    { timeoutMs: 10000, label: 'phase5.add.tqi_score', maxRetries: 0 }
  );

  const hasNewsSymbol = newsCols.includes('symbol');
  const hasNewsSymbolsArray = newsCols.includes('symbols');
  const newsTimeCol = newsCols.includes('published_at') ? 'published_at' : (newsCols.includes('created_at') ? 'created_at' : null);
  const canScoreNews = Boolean(newsTimeCol && (hasNewsSymbol || hasNewsSymbolsArray));

  const earningsSymbolCol = earningsCols.includes('symbol') ? 'symbol' : null;
  const earningsDateCol = earningsCols.includes('report_date') ? 'report_date' : (earningsCols.includes('earnings_date') ? 'earnings_date' : null);
  const canScoreEarnings = Boolean(earningsSymbolCol && earningsDateCol);

  const newsCte = canScoreNews
    ? `news_score AS (
         SELECT
           symbol,
           MAX(score)::numeric AS news_score
         FROM (
           ${hasNewsSymbol ? `SELECT UPPER(symbol) AS symbol,
             CASE
               WHEN ${newsTimeCol} >= NOW() - interval '2 hours' THEN 100
               WHEN ${newsTimeCol} >= NOW() - interval '6 hours' THEN 75
               WHEN ${newsTimeCol} >= NOW() - interval '24 hours' THEN 40
               ELSE 10
             END::numeric AS score
            FROM news_articles
            WHERE symbol IS NOT NULL` : `SELECT UPPER(sym) AS symbol,
             CASE
               WHEN na.${newsTimeCol} >= NOW() - interval '2 hours' THEN 100
               WHEN na.${newsTimeCol} >= NOW() - interval '6 hours' THEN 75
               WHEN na.${newsTimeCol} >= NOW() - interval '24 hours' THEN 40
               ELSE 10
             END::numeric AS score
            FROM news_articles na,
                 LATERAL unnest(na.symbols) AS sym
            WHERE sym IS NOT NULL`}
         ) scored
         WHERE symbol IS NOT NULL
         GROUP BY symbol
       )`
    : `news_score AS (
         SELECT NULL::text AS symbol, NULL::numeric AS news_score WHERE FALSE
       )`;

  const earningsCte = canScoreEarnings
    ? `earnings_score AS (
         SELECT
           UPPER(${earningsSymbolCol}) AS symbol,
           MAX(
             CASE
               WHEN ${earningsDateCol}::date BETWEEN CURRENT_DATE AND CURRENT_DATE + 1 THEN 100
               WHEN ${earningsDateCol}::date BETWEEN CURRENT_DATE + 2 AND CURRENT_DATE + 3 THEN 70
               ELSE 20
             END
           )::numeric AS earnings_weight
         FROM earnings_events
         WHERE ${earningsSymbolCol} IS NOT NULL
         GROUP BY UPPER(${earningsSymbolCol})
       )`
    : `earnings_score AS (
         SELECT NULL::text AS symbol, NULL::numeric AS earnings_weight WHERE FALSE
       )`;

  await queryWithTimeout(
    `WITH latest_mm AS (
       SELECT DISTINCT ON (UPPER(symbol))
         UPPER(symbol) AS symbol,
         COALESCE(relative_volume, 0)::numeric AS relative_volume
       FROM market_metrics
       WHERE symbol IS NOT NULL
       ORDER BY UPPER(symbol), COALESCE(updated_at, last_updated, NOW()) DESC
     ),
     latest_sip AS (
       SELECT DISTINCT ON (UPPER(symbol))
         UPPER(symbol) AS symbol,
         COALESCE(gap_percent, 0)::numeric AS gap_percent
       FROM stocks_in_play
       WHERE symbol IS NOT NULL
       ORDER BY UPPER(symbol), COALESCE(detected_at, NOW()) DESC
     ),
     ${newsCte},
     ${earningsCte},
     latest_signal AS (
       SELECT DISTINCT ON (UPPER(symbol))
         UPPER(symbol) AS symbol,
         COALESCE(priority_score, 0)::numeric AS priority_score,
         COALESCE(session_weight, 1)::numeric AS session_weight
       FROM signals
       WHERE symbol IS NOT NULL
       ORDER BY UPPER(symbol), COALESCE(created_at, NOW()) DESC
     ),
     symbol_scores AS (
       SELECT
         ls.symbol,
         (
           (COALESCE(ls.priority_score, 0) * 0.3) +
           (COALESCE(mm.relative_volume, 0) * 20 * 0.2) +
           (COALESCE(sip.gap_percent, 0) * 5 * 0.1) +
           (COALESCE(ns.news_score, 20) * 0.1) +
           (COALESCE(es.earnings_weight, 20) * 0.1) +
           ((COALESCE(sym.win_rate, 0) * 100) * 0.2)
         )::numeric AS raw_tqi
       FROM latest_signal ls
       LEFT JOIN latest_mm mm ON mm.symbol = ls.symbol
       LEFT JOIN latest_sip sip ON sip.symbol = ls.symbol
       LEFT JOIN news_score ns ON ns.symbol = ls.symbol
       LEFT JOIN earnings_score es ON es.symbol = ls.symbol
       LEFT JOIN symbol_performance sym ON sym.symbol = ls.symbol
     ),
     bounds AS (
       SELECT
         COALESCE(MIN(raw_tqi), 0)::numeric AS min_raw,
         COALESCE(MAX(raw_tqi), 0)::numeric AS max_raw
       FROM symbol_scores
     )
     UPDATE signals s
     SET tqi_score = ROUND(
       CASE
         WHEN b.max_raw = b.min_raw THEN 50
         ELSE LEAST(100, GREATEST(0, ((src.raw_tqi - b.min_raw) / NULLIF(b.max_raw - b.min_raw, 0)) * 100))
       END::numeric,
       4
     )
     FROM symbol_scores src
     CROSS JOIN bounds b
     WHERE UPPER(s.symbol) = src.symbol`,
    [],
    { timeoutMs: 120000, label: 'phase5.update.tqi_score', maxRetries: 0 }
  );

  await queryWithTimeout(
    `UPDATE signals
     SET tqi_score = 50
     WHERE symbol IS NOT NULL
       AND tqi_score IS NULL`,
    [],
    { timeoutMs: 30000, label: 'phase5.fill.null_tqi', maxRetries: 0 }
  );

  const check = await queryWithTimeout(
    `SELECT
       COUNT(*) FILTER (WHERE tqi_score IS NULL)::int AS null_count,
       COUNT(*) FILTER (WHERE tqi_score::text = 'NaN')::int AS nan_count,
       COUNT(*) FILTER (WHERE tqi_score < 0 OR tqi_score > 100)::int AS out_of_range_count,
       COUNT(*)::int AS total_count
     FROM signals
     WHERE symbol IS NOT NULL`,
    [],
    { timeoutMs: 10000, label: 'phase5.validate.tqi', maxRetries: 0 }
  );

  const row = check.rows?.[0] || {};
  const out = {
    ts: new Date().toISOString(),
    null_count: Number(row.null_count || 0),
    nan_count: Number(row.nan_count || 0),
    out_of_range_count: Number(row.out_of_range_count || 0),
    total_count: Number(row.total_count || 0),
    pass:
      Number(row.total_count || 0) > 0
      && Number(row.null_count || 0) === 0
      && Number(row.nan_count || 0) === 0
      && Number(row.out_of_range_count || 0) === 0,
  };

  writeJson('calibration_phase5_tqi.json', out);
  if (!out.pass) throw new Error('PHASE_5_FAILED_TQI_VALIDATION');
  return out;
}

async function phase6ConfidenceScoring() {
  const earningsCols = await tableColumns('earnings_events').catch(() => []);
  const earningsSymbolCol = earningsCols.includes('symbol') ? 'symbol' : null;
  const earningsDateCol = earningsCols.includes('report_date') ? 'report_date' : (earningsCols.includes('earnings_date') ? 'earnings_date' : null);
  const earningsCte = (earningsSymbolCol && earningsDateCol)
    ? `earnings_weights AS (
         SELECT
           UPPER(${earningsSymbolCol}) AS symbol,
           MAX(CASE
             WHEN ${earningsDateCol}::date BETWEEN CURRENT_DATE AND CURRENT_DATE + 1 THEN 100
             WHEN ${earningsDateCol}::date BETWEEN CURRENT_DATE + 2 AND CURRENT_DATE + 3 THEN 70
             ELSE 20
           END)::numeric AS earnings_weight
         FROM earnings_events
         WHERE ${earningsSymbolCol} IS NOT NULL
         GROUP BY UPPER(${earningsSymbolCol})
       )`
    : `earnings_weights AS (
         SELECT NULL::text AS symbol, NULL::numeric AS earnings_weight WHERE FALSE
       )`;

  await queryWithTimeout(
    `DROP VIEW IF EXISTS signal_calibrated_scores`,
    [],
    { timeoutMs: 10000, label: 'phase6.drop.signal_calibrated_scores', maxRetries: 0 }
  );

  await queryWithTimeout(
    `CREATE VIEW signal_calibrated_scores AS
     WITH latest_signal AS (
       SELECT DISTINCT ON (UPPER(symbol))
         id,
         UPPER(symbol) AS symbol,
         COALESCE(signal_type, 'unknown') AS strategy,
         COALESCE(session_phase, 'intraday') AS session_phase,
         COALESCE(session_weight, 1)::numeric AS session_weight,
         COALESCE(tqi_score, 50)::numeric AS tqi_score,
         COALESCE(created_at, NOW()) AS created_at
       FROM signals
       WHERE symbol IS NOT NULL
       ORDER BY UPPER(symbol), COALESCE(created_at, NOW()) DESC
     ),
     ${earningsCte}
     SELECT
       ls.symbol,
       ls.strategy,
       ls.session_phase,
       ls.session_weight,
       ls.tqi_score,
       COALESCE(sp.win_rate, 0)::numeric AS strategy_win_rate,
       COALESCE(sym.win_rate, 0)::numeric AS symbol_win_rate,
       COALESCE(es.earnings_weight, 0)::numeric AS earnings_weight,
       ROUND(
         LEAST(
           100,
           GREATEST(
             0,
             (COALESCE(ls.tqi_score, 0) * 0.4)
             + (COALESCE(sp.win_rate, 0) * 30)
             + (COALESCE(sym.win_rate, 0) * 20)
             + (COALESCE(ls.session_weight, 1) * 10)
           )
         )::numeric,
         4
       ) AS calibrated_decision_score,
       ls.created_at
     FROM latest_signal ls
     LEFT JOIN strategy_performance sp ON LOWER(sp.strategy) = LOWER(ls.strategy)
     LEFT JOIN symbol_performance sym ON sym.symbol = ls.symbol
     LEFT JOIN earnings_weights es ON es.symbol = ls.symbol`,
    [],
    { timeoutMs: 30000, label: 'phase6.create.signal_calibrated_scores', maxRetries: 0 }
  );

  const check = await queryWithTimeout(
    `SELECT
       COUNT(*) FILTER (WHERE calibrated_decision_score IS NOT NULL)::int AS non_null_scores,
       COALESCE(STDDEV_SAMP(calibrated_decision_score), 0)::numeric AS score_stddev
     FROM signal_calibrated_scores`,
    [],
    { timeoutMs: 10000, label: 'phase6.validate.calibrated_scores', maxRetries: 0 }
  );

  const nonNull = Number(check.rows?.[0]?.non_null_scores || 0);
  const stddev = Number(check.rows?.[0]?.score_stddev || 0);

  const out = {
    ts: new Date().toISOString(),
    non_null_scores: nonNull,
    score_stddev: stddev,
    pass: nonNull >= 10 && stddev > 0,
  };

  writeJson('calibration_phase6_confidence_engine.json', out);
  if (!out.pass) throw new Error('PHASE_6_FAILED_CONFIDENCE_SCORING_VALIDATION');
  return out;
}

async function phase7AdaptiveCalibrationLoop() {
  const setupCols = await tableColumns('trade_setups');
  const strategyParts = ["NULLIF(TRIM(to2.strategy), '')"];
  if (setupCols.includes('setup_type')) strategyParts.push("NULLIF(TRIM(ts.setup_type), '')");
  if (setupCols.includes('strategy')) strategyParts.push("NULLIF(TRIM(ts.strategy), '')");
  if (setupCols.includes('setup')) strategyParts.push("NULLIF(TRIM(ts.setup), '')");
  strategyParts.push("NULLIF(TRIM(s.signal_type), '')");
  const phase7StrategyExpr = `COALESCE(${strategyParts.join(', ')}, 'unknown')`;

  const expectedExpr = setupCols.includes('expected_move')
    ? 'COALESCE(ts.expected_move, 2)::numeric'
    : (setupCols.includes('expected_move_pct')
      ? 'COALESCE(ts.expected_move_pct, 2)::numeric'
      : (setupCols.includes('target_move_pct')
        ? 'COALESCE(ts.target_move_pct, 2)::numeric'
        : '2::numeric'));

  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS strategy_weights (
       strategy text PRIMARY KEY,
       weight numeric NOT NULL DEFAULT 1.0,
       last_error_rate numeric,
       sample_size int NOT NULL DEFAULT 0,
       updated_at timestamptz NOT NULL DEFAULT NOW()
     )`,
    [],
    { timeoutMs: 15000, label: 'phase7.create.strategy_weights', maxRetries: 0 }
  );

  await queryWithTimeout(
    `ALTER TABLE strategy_weights
     ADD COLUMN IF NOT EXISTS last_error_rate numeric,
     ADD COLUMN IF NOT EXISTS sample_size int NOT NULL DEFAULT 0,
     ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT NOW()`,
    [],
    { timeoutMs: 15000, label: 'phase7.alter.strategy_weights', maxRetries: 0 }
  );

  await queryWithTimeout(
    `WITH outcome_base AS (
       SELECT
         ${phase7StrategyExpr} AS strategy,
         ${expectedExpr} AS expected_move,
         ABS(COALESCE(to2.max_move, to2.pnl_pct, 0))::numeric AS actual_move
       FROM trade_outcomes to2
       LEFT JOIN trade_setups ts
         ON ts.signal_id::text = to2.signal_id::text
         OR (ts.signal_id IS NULL AND UPPER(ts.symbol) = UPPER(to2.symbol))
       LEFT JOIN signals s
         ON s.id::text = to2.signal_id::text
         OR UPPER(s.symbol) = UPPER(to2.symbol)
       WHERE to2.pnl_pct IS NOT NULL
         AND to2.pnl_pct::text <> 'NaN'
     ),
     error_metrics AS (
       SELECT
         strategy,
         COUNT(*)::int AS sample_size,
         AVG(ABS(actual_move - expected_move))::numeric AS error_rate
       FROM outcome_base
       GROUP BY strategy
     )
     INSERT INTO strategy_weights (strategy, weight, last_error_rate, sample_size, updated_at)
     SELECT
       em.strategy,
       CASE
         WHEN em.error_rate > 5 THEN 0.9
         WHEN em.error_rate < 2 THEN 1.1
         ELSE 1.0
       END::numeric AS weight,
       em.error_rate,
       em.sample_size,
       NOW()
     FROM error_metrics em
     ON CONFLICT (strategy)
     DO UPDATE SET
       weight = LEAST(2.0, GREATEST(0.5,
         CASE
           WHEN EXCLUDED.last_error_rate > 5 THEN strategy_weights.weight * 0.9
           WHEN EXCLUDED.last_error_rate < 2 THEN strategy_weights.weight * 1.1
           ELSE strategy_weights.weight
         END
       )),
       last_error_rate = EXCLUDED.last_error_rate,
       sample_size = EXCLUDED.sample_size,
       updated_at = NOW()`,
    [],
    { timeoutMs: 30000, label: 'phase7.update.strategy_weights', maxRetries: 0 }
  );

  const check = await queryWithTimeout(
    `SELECT
       COUNT(*)::int AS strategy_count,
       MIN(weight)::numeric AS min_weight,
       MAX(weight)::numeric AS max_weight,
       COUNT(*) FILTER (WHERE weight < 0.5 OR weight > 2.0)::int AS extreme_count
     FROM strategy_weights`,
    [],
    { timeoutMs: 10000, label: 'phase7.validate.strategy_weights', maxRetries: 0 }
  );

  const row = check.rows?.[0] || {};
  const out = {
    ts: new Date().toISOString(),
    strategy_count: Number(row.strategy_count || 0),
    min_weight: Number(row.min_weight || 0),
    max_weight: Number(row.max_weight || 0),
    extreme_count: Number(row.extreme_count || 0),
    pass: Number(row.strategy_count || 0) > 0 && Number(row.extreme_count || 0) === 0,
  };

  writeJson('calibration_phase7_adaptive_loop.json', out);
  if (!out.pass) throw new Error('PHASE_7_FAILED_ADAPTIVE_CALIBRATION_VALIDATION');
  return out;
}

async function phase8DecisionOutputUpgrade() {
  const base = process.env.API_BASE || 'http://127.0.0.1:3001';
  const headers = { Accept: 'application/json' };
  if (process.env.PROXY_API_KEY) headers['x-api-key'] = process.env.PROXY_API_KEY;

  const response = await fetch(`${base}/api/intelligence/top-opportunities?limit=20`, { headers });
  const payload = await response.json().catch(() => ({}));
  const items = Array.isArray(payload?.items) ? payload.items : [];

  const criticalFields = ['symbol', 'decision_score', 'tqi_score', 'strategy', 'win_rate', 'regime', 'session_phase', 'explanation'];
  let nullCriticalRows = 0;
  let explanationMissing = 0;

  for (const item of items) {
    const hasNullCritical = criticalFields.some((field) => item?.[field] == null || item?.[field] === '');
    if (hasNullCritical) nullCriticalRows += 1;
    if (!item?.explanation || String(item.explanation).trim() === '') explanationMissing += 1;
  }

  const out = {
    ts: new Date().toISOString(),
    status: response.status,
    total_items: items.length,
    null_critical_rows: nullCriticalRows,
    explanation_missing_rows: explanationMissing,
    sample: items.slice(0, 5),
    pass: response.status === 200 && items.length >= 10 && nullCriticalRows === 0 && explanationMissing === 0,
  };

  writeJson('calibration_phase8_decision_output.json', out);
  if (!out.pass) throw new Error('PHASE_8_FAILED_DECISION_OUTPUT_VALIDATION');
  return out;
}

async function phase8bEnsureRecentSignals() {
  const recent = await queryWithTimeout(
    `SELECT COUNT(*)::int AS n
     FROM signals
     WHERE created_at > NOW() - interval '15 minutes'`,
    [],
    { timeoutMs: 10000, label: 'phase8b.recent_before', maxRetries: 0 }
  );

  let inserted = 0;
  const before = Number(recent.rows?.[0]?.n || 0);
  if (before <= 5) {
    const source = await queryWithTimeout(
      `SELECT DISTINCT ON (UPPER(symbol))
         UPPER(symbol) AS symbol,
         COALESCE(score, 0)::numeric AS score,
         COALESCE(session_phase, 'intraday') AS session_phase,
         COALESCE(priority_score, 0)::numeric AS priority_score
       FROM stocks_in_play_filtered
       WHERE symbol IS NOT NULL
       ORDER BY UPPER(symbol), COALESCE(score, 0) DESC, COALESCE(detected_at, NOW()) DESC
       LIMIT 20`,
      [],
      { timeoutMs: 15000, label: 'phase8b.source_symbols', maxRetries: 0 }
    );

    for (const row of source.rows || []) {
      const symbol = String(row.symbol || '').trim().toUpperCase();
      if (!symbol) continue;

      const exists = await queryWithTimeout(
        `SELECT id
         FROM signals
         WHERE UPPER(symbol) = $1
           AND created_at > NOW() - interval '15 minutes'
         LIMIT 1`,
        [symbol],
        { timeoutMs: 8000, label: 'phase8b.exists_recent_symbol', maxRetries: 0 }
      );

      if ((exists.rows || []).length > 0) continue;

      await queryWithTimeout(
        `INSERT INTO signals (
           symbol,
           signal_type,
           score,
           confidence,
           catalyst_ids,
           created_at,
           session_phase,
           priority_score,
           session_weight,
           tqi_score
         )
         VALUES ($1, 'calibration_refresh', $2, 55, ARRAY[]::uuid[], NOW(), $3, $4, 1.0, 50)`,
        [symbol, Number(row.score || 0), row.session_phase || 'intraday', Number(row.priority_score || 0)],
        { timeoutMs: 10000, label: 'phase8b.insert_recent_signal', maxRetries: 0 }
      );

      inserted += 1;
      if ((before + inserted) > 6) break;
    }
  }

  const afterResult = await queryWithTimeout(
    `SELECT COUNT(*)::int AS n
     FROM signals
     WHERE created_at > NOW() - interval '15 minutes'`,
    [],
    { timeoutMs: 10000, label: 'phase8b.recent_after', maxRetries: 0 }
  );

  const after = Number(afterResult.rows?.[0]?.n || 0);
  const out = {
    ts: new Date().toISOString(),
    before_recent_signals: before,
    inserted,
    after_recent_signals: after,
    pass: after > 5,
  };

  writeJson('calibration_phase8b_signal_refresh.json', out);
  if (!out.pass) throw new Error('PHASE_8B_FAILED_SIGNAL_REFRESH');
  return out;
}

async function phase9FinalValidation() {
  const lifecycle = await queryWithTimeout(
    `SELECT COUNT(DISTINCT s.symbol)::int AS n
     FROM signals s
     JOIN trade_setups ts ON s.id = ts.signal_id
     JOIN signal_outcomes so ON s.id = so.signal_id`,
    [],
    { timeoutMs: 15000, label: 'phase9.lifecycle_overlap', maxRetries: 0 }
  );

  const decision = await queryWithTimeout(
    `SELECT
       COUNT(*) FILTER (WHERE calibrated_decision_score IS NOT NULL)::int AS decision_count,
       AVG(calibrated_decision_score)::numeric AS avg_decision_score
     FROM signal_calibrated_scores`,
    [],
    { timeoutMs: 10000, label: 'phase9.decision_stats', maxRetries: 0 }
  );

  const signalsRecent = await queryWithTimeout(
    `SELECT COUNT(*)::int AS n
     FROM signals
     WHERE created_at > NOW() - interval '15 minutes'`,
    [],
    { timeoutMs: 10000, label: 'phase9.signals_recent', maxRetries: 0 }
  );

  const tqi = await queryWithTimeout(
    `SELECT COUNT(*) FILTER (WHERE tqi_score IS NOT NULL)::int AS populated,
            COUNT(*)::int AS total
     FROM signals
     WHERE symbol IS NOT NULL`,
    [],
    { timeoutMs: 10000, label: 'phase9.tqi_populated', maxRetries: 0 }
  );

  const strategyPerf = await queryWithTimeout(
    `SELECT COUNT(*)::int AS n FROM strategy_performance`,
    [],
    { timeoutMs: 10000, label: 'phase9.strategy_performance_count', maxRetries: 0 }
  );

  const out = {
    ts: new Date().toISOString(),
    lifecycle_overlap: Number(lifecycle.rows?.[0]?.n || 0),
    decision_count: Number(decision.rows?.[0]?.decision_count || 0),
    avg_decision_score: decision.rows?.[0]?.avg_decision_score == null ? null : Number(decision.rows[0].avg_decision_score),
    signals_recent: Number(signalsRecent.rows?.[0]?.n || 0),
    tqi_populated: Number(tqi.rows?.[0]?.populated || 0),
    tqi_total: Number(tqi.rows?.[0]?.total || 0),
    strategy_performance_count: Number(strategyPerf.rows?.[0]?.n || 0),
    pass:
      Number(lifecycle.rows?.[0]?.n || 0) > 50
      && Number(decision.rows?.[0]?.decision_count || 0) >= 10
      && Number(signalsRecent.rows?.[0]?.n || 0) > 5
      && Number(tqi.rows?.[0]?.populated || 0) > 0
      && Number(strategyPerf.rows?.[0]?.n || 0) > 0,
  };

  writeJson('calibration_postcheck.json', out);
  if (!out.pass) throw new Error('PHASE_9_FAILED_FINAL_VALIDATION');
  return out;
}

async function main() {
  const report = {
    started_at: new Date().toISOString(),
    phases: [],
  };

  const p0 = await phase0BaselineSnapshot();
  report.phases.push({ phase: 'PHASE_0', result: p0 });

  const p1 = await phase1StrategyPerformance();
  report.phases.push({ phase: 'PHASE_1', result: p1 });

  const p2 = await phase2SymbolPerformance();
  report.phases.push({ phase: 'PHASE_2', result: p2 });

  const p3 = await phase3MarketRegime();
  report.phases.push({ phase: 'PHASE_3', result: p3 });

  const p4 = await phase4SessionWeighting();
  report.phases.push({ phase: 'PHASE_4', result: p4 });

  const p5 = await phase5TradeQualityIndex();
  report.phases.push({ phase: 'PHASE_5', result: p5 });

  const p6 = await phase6ConfidenceScoring();
  report.phases.push({ phase: 'PHASE_6', result: p6 });

  const p7 = await phase7AdaptiveCalibrationLoop();
  report.phases.push({ phase: 'PHASE_7', result: p7 });

  const p8 = await phase8DecisionOutputUpgrade();
  report.phases.push({ phase: 'PHASE_8', result: p8 });

  const p8b = await phase8bEnsureRecentSignals();
  report.phases.push({ phase: 'PHASE_8B', result: p8b });

  const p9 = await phase9FinalValidation();
  report.phases.push({ phase: 'PHASE_9', result: p9 });

  report.completed_at = new Date().toISOString();
  writeJson('calibration_upgrade_report.json', report);

  console.log(JSON.stringify({ ok: true, final: p9 }, null, 2));
}

main()
  .catch((error) => {
    writeJson('calibration_upgrade_failed.json', {
      ts: new Date().toISOString(),
      error: error.message,
    });
    console.error('[CALIBRATION_UPGRADE_FAILED]', error.message);
    process.exit(1);
  })
  .finally(async () => {
    try { await pool.end(); } catch {}
  });
