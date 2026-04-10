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

async function createDecisionView(options = {}) {
  const {
    useNewSessionWeights = false,
    applyBoost = false,
    applyNormalization = false,
    applyShaping = false,
    applyTopGuarantee = false,
  } = options;

  const sessionWeightExpr = useNewSessionWeights
    ? `CASE
         WHEN ls.session_phase = 'premarket_early' THEN 0.9
         WHEN ls.session_phase = 'premarket_peak' THEN 1.0
         WHEN ls.session_phase = 'market_open' THEN 1.2
         WHEN ls.session_phase = 'intraday' THEN 1.0
         ELSE 1.0
       END`
    : `COALESCE(ls.session_weight, 1.0)`;

  const boostExpr = applyBoost
    ? `CASE
         WHEN boost_condition_count >= 3 THEN 20
         WHEN boost_condition_count = 2 THEN 15
         WHEN boost_condition_count = 1 THEN 10
         ELSE 0
       END`
    : `0`;

  const finalFromNormalizedExpr = applyShaping
    ? `CASE
         WHEN normalized_score < 1 THEN 0
         ELSE 20 + (POWER(normalized_score / 100.0, 0.55) * 80)
       END`
    : `normalized_score`;

  const viewSql = `
    CREATE OR REPLACE VIEW decision_view AS
    WITH latest_signal AS (
      SELECT DISTINCT ON (UPPER(symbol))
        UPPER(symbol) AS symbol,
        COALESCE(signal_type, 'unknown') AS strategy,
        COALESCE(session_phase, 'intraday') AS session_phase,
        COALESCE(session_weight, 1.0)::numeric AS session_weight,
        COALESCE(tqi_score, 50)::numeric AS tqi_score,
        COALESCE(created_at, NOW()) AS created_at
      FROM signals
      WHERE symbol IS NOT NULL
      ORDER BY UPPER(symbol), COALESCE(created_at, NOW()) DESC
    ),
    strategy_perf AS (
      SELECT
        LOWER(strategy) AS strategy,
        COALESCE(trades, 0)::int AS strategy_trades,
        COALESCE(win_rate, 0)::numeric AS strategy_win_rate
      FROM strategy_performance
    ),
    symbol_perf AS (
      SELECT
        symbol,
        COALESCE(trades, 0)::int AS symbol_trades,
        COALESCE(win_rate, 0)::numeric AS symbol_win_rate
      FROM symbol_performance
    ),
    latest_mm AS (
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
    news_score AS (
      SELECT
        symbol,
        MAX(score)::numeric AS news_score
      FROM (
        SELECT
          UPPER(COALESCE(symbol, sym)) AS symbol,
          CASE
            WHEN COALESCE(published_at, created_at) >= NOW() - interval '2 hours' THEN 2
            WHEN COALESCE(published_at, created_at) >= NOW() - interval '6 hours' THEN 1
            ELSE 0
          END::numeric AS score
        FROM news_articles na
        LEFT JOIN LATERAL unnest(COALESCE(na.symbols, ARRAY[]::text[])) AS sym ON true
      ) scored
      WHERE symbol IS NOT NULL
      GROUP BY symbol
    ),
    earnings_score AS (
      SELECT
        UPPER(symbol) AS symbol,
        MAX(CASE
          WHEN report_date::date BETWEEN CURRENT_DATE AND CURRENT_DATE + 1 THEN 2
          WHEN report_date::date BETWEEN CURRENT_DATE + 2 AND CURRENT_DATE + 3 THEN 1
          ELSE 0
        END)::numeric AS earnings_signal
      FROM earnings_events
      WHERE symbol IS NOT NULL
      GROUP BY UPPER(symbol)
    ),
    components AS (
      SELECT
        ls.symbol,
        ls.strategy,
        ls.session_phase,
        ls.created_at,
        ls.tqi_score,
        ${sessionWeightExpr}::numeric AS session_weight,
        COALESCE(sp.strategy_trades, 0)::int AS strategy_trades,
        COALESCE(sp.strategy_win_rate, 0)::numeric AS strategy_win_rate,
        COALESCE(sym.symbol_trades, 0)::int AS symbol_trades,
        COALESCE(sym.symbol_win_rate, 0)::numeric AS symbol_win_rate,
        COALESCE(mm.relative_volume, 0)::numeric AS relative_volume,
        COALESCE(sip.gap_percent, 0)::numeric AS gap_percent,
        COALESCE(ns.news_score, 0)::numeric AS news_score,
        COALESCE(es.earnings_signal, 0)::numeric AS earnings_signal,
        CASE
          WHEN COALESCE(sp.strategy_trades, 0) < 20 THEN COALESCE(sp.strategy_win_rate, 0) * 10
          ELSE COALESCE(sp.strategy_win_rate, 0) * 25
        END::numeric AS strategy_component,
        CASE
          WHEN COALESCE(sym.symbol_trades, 0) < 20 THEN COALESCE(sym.symbol_win_rate, 0) * 5
          ELSE COALESCE(sym.symbol_win_rate, 0) * 15
        END::numeric AS symbol_component,
        (
          CASE WHEN COALESCE(mm.relative_volume, 0) > 1.5 THEN 1 ELSE 0 END
          + CASE WHEN COALESCE(sip.gap_percent, 0) > 2 THEN 1 ELSE 0 END
          + CASE WHEN COALESCE(es.earnings_signal, 0) >= 1 THEN 1 ELSE 0 END
          + CASE WHEN COALESCE(ns.news_score, 0) >= 1 THEN 1 ELSE 0 END
        )::int AS boost_condition_count
      FROM latest_signal ls
      LEFT JOIN strategy_perf sp ON sp.strategy = LOWER(ls.strategy)
      LEFT JOIN symbol_perf sym ON sym.symbol = ls.symbol
      LEFT JOIN latest_mm mm ON mm.symbol = ls.symbol
      LEFT JOIN latest_sip sip ON sip.symbol = ls.symbol
      LEFT JOIN news_score ns ON ns.symbol = ls.symbol
      LEFT JOIN earnings_score es ON es.symbol = ls.symbol
    ),
    raw_score AS (
      SELECT
        c.*,
        ${boostExpr}::numeric AS boost_score,
        (
          (COALESCE(c.tqi_score, 0) * 0.4)
          + COALESCE(c.strategy_component, 0)
          + COALESCE(c.symbol_component, 0)
          + (COALESCE(c.session_weight, 1.0) * 10)
          + ${boostExpr}
        )::numeric AS decision_score
      FROM components c
    ),
    normalized AS (
      SELECT
        r.*,
        COALESCE(MIN(r.decision_score) OVER (), 0)::numeric AS min_score,
        COALESCE(MAX(r.decision_score) OVER (), 0)::numeric AS max_score,
        CASE
          WHEN ${applyNormalization ? 'TRUE' : 'FALSE'} = FALSE THEN COALESCE(r.decision_score, 0)
          WHEN COALESCE(MAX(r.decision_score) OVER (), 0) = COALESCE(MIN(r.decision_score) OVER (), 0) THEN 50
          ELSE ((r.decision_score - MIN(r.decision_score) OVER ()) / NULLIF((MAX(r.decision_score) OVER () - MIN(r.decision_score) OVER ()), 0)) * 100
        END::numeric AS normalized_score
      FROM raw_score r
    ),
    shaped AS (
      SELECT
        n.*,
        (${finalFromNormalizedExpr})::numeric AS shaped_score
      FROM normalized n
    ),
    ranked AS (
      SELECT
        s.*,
        ROW_NUMBER() OVER (ORDER BY s.shaped_score DESC NULLS LAST, s.decision_score DESC NULLS LAST, s.symbol ASC) AS rank_pos
      FROM shaped s
    ),
    top5 AS (
      SELECT COALESCE(MAX(shaped_score), 0)::numeric AS top5_max
      FROM ranked
      WHERE rank_pos <= 5
    ),
    guaranteed AS (
      SELECT
        r.*,
        CASE
          WHEN ${applyTopGuarantee ? 'TRUE' : 'FALSE'} = TRUE
               AND r.rank_pos <= 5
               AND COALESCE(t.top5_max, 0) > 0
               AND COALESCE(t.top5_max, 0) < 60
            THEN LEAST(100, r.shaped_score * (60.0 / t.top5_max))
          ELSE r.shaped_score
        END::numeric AS final_score
      FROM ranked r
      CROSS JOIN top5 t
    )
    SELECT
      symbol,
      strategy,
      session_phase,
      session_weight,
      tqi_score,
      strategy_trades,
      strategy_win_rate,
      symbol_trades,
      symbol_win_rate,
      relative_volume,
      gap_percent,
      news_score,
      earnings_signal,
      strategy_component,
      symbol_component,
      boost_score,
      decision_score,
      min_score,
      max_score,
      normalized_score,
      final_score,
      rank_pos,
      created_at
    FROM guaranteed
  `;

  await queryWithTimeout(viewSql, [], {
    timeoutMs: 120000,
    label: 'score.create.decision_view',
    maxRetries: 0,
  });
}

async function distributionStats() {
  const result = await queryWithTimeout(
    `SELECT
       MIN(decision_score)::numeric AS min_decision_score,
       MAX(decision_score)::numeric AS max_decision_score,
       AVG(decision_score)::numeric AS avg_decision_score,
       COALESCE(STDDEV_SAMP(decision_score), 0)::numeric AS stddev_decision_score,
       MIN(final_score)::numeric AS min_final_score,
       MAX(final_score)::numeric AS max_final_score,
       AVG(final_score)::numeric AS avg_final_score,
       COALESCE(STDDEV_SAMP(final_score), 0)::numeric AS stddev_final_score
     FROM decision_view`,
    [],
    { timeoutMs: 15000, label: 'score.distribution', maxRetries: 0 }
  );
  return result.rows?.[0] || {};
}

async function phase0Baseline() {
  await createDecisionView();

  const stats = await distributionStats();
  const out = {
    ts: new Date().toISOString(),
    min_decision_score: Number(stats.min_decision_score || 0),
    max_decision_score: Number(stats.max_decision_score || 0),
    avg_decision_score: Number(stats.avg_decision_score || 0),
    stddev_decision_score: Number(stats.stddev_decision_score || 0),
    suppressed: Number(stats.max_decision_score || 0) < 30,
    pass: true,
  };

  writeJson('score_distribution_pre.json', out);
  return out;
}

async function phase1RemoveOverPenalisation() {
  await createDecisionView({ useNewSessionWeights: false, applyBoost: false, applyNormalization: false, applyShaping: false, applyTopGuarantee: false });

  const check = await queryWithTimeout(
    `SELECT
       COUNT(*) FILTER (WHERE decision_score IS NULL OR strategy_component IS NULL OR symbol_component IS NULL)::int AS null_count,
       COUNT(*) FILTER (WHERE decision_score < 0)::int AS negative_count,
       COUNT(*)::int AS total_count,
       AVG(decision_score)::numeric AS avg_decision_score
     FROM decision_view`,
    [],
    { timeoutMs: 15000, label: 'score.phase1.validate', maxRetries: 0 }
  );

  const row = check.rows?.[0] || {};
  const out = {
    ts: new Date().toISOString(),
    total_count: Number(row.total_count || 0),
    null_count: Number(row.null_count || 0),
    negative_count: Number(row.negative_count || 0),
    avg_decision_score: Number(row.avg_decision_score || 0),
    pass: Number(row.total_count || 0) > 0 && Number(row.null_count || 0) === 0 && Number(row.negative_count || 0) === 0,
  };

  writeJson('score_phase1_remove_overpenalisation.json', out);
  if (!out.pass) throw new Error('PHASE_1_FAILED_OVERPENALISATION_VALIDATION');
  return out;
}

async function phase2FixSessionWeighting(phase1Avg) {
  await createDecisionView({ useNewSessionWeights: true, applyBoost: false, applyNormalization: false, applyShaping: false, applyTopGuarantee: false });

  const check = await queryWithTimeout(
    `SELECT
       AVG(decision_score)::numeric AS avg_decision_score,
       MIN(decision_score)::numeric AS min_decision_score,
       MAX(decision_score)::numeric AS max_decision_score
     FROM decision_view`,
    [],
    { timeoutMs: 15000, label: 'score.phase2.validate', maxRetries: 0 }
  );

  const row = check.rows?.[0] || {};
  const avgAfter = Number(row.avg_decision_score || 0);
  const out = {
    ts: new Date().toISOString(),
    avg_before: Number(phase1Avg || 0),
    avg_after: avgAfter,
    min_after: Number(row.min_decision_score || 0),
    max_after: Number(row.max_decision_score || 0),
    pass: avgAfter >= Number(phase1Avg || 0),
  };

  writeJson('score_phase2_session_weighting.json', out);
  if (!out.pass) throw new Error('PHASE_2_FAILED_DISTRIBUTION_DID_NOT_SHIFT_UP');
  return out;
}

async function phase3BoostHighConviction() {
  const beforeTop = await queryWithTimeout(
    `SELECT AVG(decision_score)::numeric AS top5_avg
     FROM (
       SELECT decision_score
       FROM decision_view
       ORDER BY decision_score DESC NULLS LAST
       LIMIT 5
     ) t`,
    [],
    { timeoutMs: 10000, label: 'score.phase3.before_top', maxRetries: 0 }
  );

  await createDecisionView({ useNewSessionWeights: true, applyBoost: true, applyNormalization: false, applyShaping: false, applyTopGuarantee: false });

  const after = await queryWithTimeout(
    `WITH top5 AS (
       SELECT decision_score
       FROM decision_view
       ORDER BY decision_score DESC NULLS LAST
       LIMIT 5
     ),
     top20 AS (
       SELECT boost_score
       FROM decision_view
       ORDER BY decision_score DESC NULLS LAST
       LIMIT 20
     )
     SELECT
       (SELECT AVG(decision_score)::numeric FROM top5) AS top5_avg_after,
       (SELECT COUNT(*) FILTER (WHERE boost_score > 0)::int FROM top20) AS boosted_rows,
       (SELECT MAX(boost_score)::numeric FROM top20) AS max_boost`,
    [],
    { timeoutMs: 10000, label: 'score.phase3.after_top', maxRetries: 0 }
  );

  const beforeTopAvg = Number(beforeTop.rows?.[0]?.top5_avg || 0);
  const afterRow = after.rows?.[0] || {};
  const out = {
    ts: new Date().toISOString(),
    top5_avg_before: beforeTopAvg,
    top5_avg_after: Number(afterRow.top5_avg_after || 0),
    boosted_rows_in_top20: Number(afterRow.boosted_rows || 0),
    max_boost: Number(afterRow.max_boost || 0),
    pass: Number(afterRow.top5_avg_after || 0) > beforeTopAvg,
  };

  writeJson('score_phase3_boost.json', out);
  if (!out.pass) throw new Error('PHASE_3_FAILED_TOP_SYMBOLS_DID_NOT_MOVE_UP');
  return out;
}

async function phase4Normalization() {
  await createDecisionView({ useNewSessionWeights: true, applyBoost: true, applyNormalization: true, applyShaping: false, applyTopGuarantee: false });

  const check = await queryWithTimeout(
    `SELECT
       COUNT(*) FILTER (WHERE final_score < 0 OR final_score > 100)::int AS out_of_range,
       COUNT(*) FILTER (WHERE final_score::text = 'NaN')::int AS nan_count,
       COUNT(*) FILTER (WHERE final_score IS NULL)::int AS null_count,
       COUNT(*)::int AS total_count
     FROM decision_view`,
    [],
    { timeoutMs: 10000, label: 'score.phase4.validate', maxRetries: 0 }
  );

  const row = check.rows?.[0] || {};
  const out = {
    ts: new Date().toISOString(),
    out_of_range: Number(row.out_of_range || 0),
    nan_count: Number(row.nan_count || 0),
    null_count: Number(row.null_count || 0),
    total_count: Number(row.total_count || 0),
    pass:
      Number(row.total_count || 0) > 0
      && Number(row.out_of_range || 0) === 0
      && Number(row.nan_count || 0) === 0
      && Number(row.null_count || 0) === 0,
  };

  writeJson('score_phase4_normalization.json', out);
  if (!out.pass) throw new Error('PHASE_4_FAILED_NORMALIZATION_VALIDATION');
  return out;
}

async function phase5DistributionShaping() {
  await createDecisionView({ useNewSessionWeights: true, applyBoost: true, applyNormalization: true, applyShaping: true, applyTopGuarantee: false });

  const check = await queryWithTimeout(
    `WITH ranked AS (
       SELECT final_score,
              ROW_NUMBER() OVER (ORDER BY final_score DESC NULLS LAST) AS rn
       FROM decision_view
     )
     SELECT
       AVG(CASE WHEN rn <= 5 THEN final_score END)::numeric AS top5_avg,
       AVG(CASE WHEN rn BETWEEN 6 AND 15 THEN final_score END)::numeric AS mid10_avg,
       COUNT(*) FILTER (WHERE final_score = 0)::int AS zero_bucket,
       COUNT(*)::int AS total_count
     FROM ranked`,
    [],
    { timeoutMs: 10000, label: 'score.phase5.validate', maxRetries: 0 }
  );

  const row = check.rows?.[0] || {};
  const top5Avg = Number(row.top5_avg || 0);
  const mid10Avg = Number(row.mid10_avg || 0);
  const out = {
    ts: new Date().toISOString(),
    top5_avg: top5Avg,
    mid10_avg: mid10Avg,
    separation: Number((top5Avg - mid10Avg).toFixed(4)),
    zero_bucket: Number(row.zero_bucket || 0),
    total_count: Number(row.total_count || 0),
    pass: top5Avg > mid10Avg,
  };

  writeJson('score_phase5_shaping.json', out);
  if (!out.pass) throw new Error('PHASE_5_FAILED_DISTRIBUTION_SHAPING');
  return out;
}

async function phase6TopGuarantee() {
  await createDecisionView({ useNewSessionWeights: true, applyBoost: true, applyNormalization: true, applyShaping: true, applyTopGuarantee: true });

  const check = await queryWithTimeout(
    `SELECT
       COUNT(*) FILTER (WHERE final_score > 60)::int AS above_60,
       MAX(CASE WHEN rank_pos <= 5 THEN final_score END)::numeric AS top5_max,
       MIN(CASE WHEN rank_pos <= 5 THEN final_score END)::numeric AS top5_min
     FROM decision_view`,
    [],
    { timeoutMs: 10000, label: 'score.phase6.validate', maxRetries: 0 }
  );

  const row = check.rows?.[0] || {};
  const out = {
    ts: new Date().toISOString(),
    above_60: Number(row.above_60 || 0),
    top5_max: Number(row.top5_max || 0),
    top5_min: Number(row.top5_min || 0),
    pass: Number(row.top5_min || 0) > 60 && Number(row.above_60 || 0) >= 3,
  };

  writeJson('score_phase6_top_guarantee.json', out);
  if (!out.pass) throw new Error('PHASE_6_FAILED_TOP_GUARANTEE');
  return out;
}

async function phase8FinalValidation() {
  const dist = await queryWithTimeout(
    `SELECT
       MIN(final_score)::numeric AS min_final_score,
       MAX(final_score)::numeric AS max_final_score,
       AVG(final_score)::numeric AS avg_final_score,
       COALESCE(STDDEV_SAMP(final_score), 0)::numeric AS stddev_final_score,
       COUNT(*) FILTER (WHERE final_score > 60)::int AS above_60,
       COUNT(*) FILTER (WHERE final_score > 40)::int AS above_40,
       COUNT(*)::int AS total
     FROM decision_view`,
    [],
    { timeoutMs: 10000, label: 'score.phase8.final', maxRetries: 0 }
  );

  const row = dist.rows?.[0] || {};
  const out = {
    ts: new Date().toISOString(),
    min_final_score: Number(row.min_final_score || 0),
    max_final_score: Number(row.max_final_score || 0),
    avg_final_score: Number(row.avg_final_score || 0),
    stddev_final_score: Number(row.stddev_final_score || 0),
    above_60: Number(row.above_60 || 0),
    above_40: Number(row.above_40 || 0),
    total: Number(row.total || 0),
    pass:
      Number(row.max_final_score || 0) >= 70
      && Number(row.above_60 || 0) >= 5
      && Number(row.above_40 || 0) >= 10
      && Number(row.avg_final_score || 0) >= 30
      && Number(row.avg_final_score || 0) <= 50,
  };

  writeJson('score_distribution_post.json', out);
  if (!out.pass) throw new Error('PHASE_8_FAILED_FINAL_DISTRIBUTION_TARGETS');
  return out;
}

async function main() {
  const report = { started_at: new Date().toISOString(), phases: [] };

  const p0 = await phase0Baseline();
  report.phases.push({ phase: 'PHASE_0', result: p0 });

  const p1 = await phase1RemoveOverPenalisation();
  report.phases.push({ phase: 'PHASE_1', result: p1 });

  const p2 = await phase2FixSessionWeighting(p1.avg_decision_score);
  report.phases.push({ phase: 'PHASE_2', result: p2 });

  const p3 = await phase3BoostHighConviction();
  report.phases.push({ phase: 'PHASE_3', result: p3 });

  const p4 = await phase4Normalization();
  report.phases.push({ phase: 'PHASE_4', result: p4 });

  const p5 = await phase5DistributionShaping();
  report.phases.push({ phase: 'PHASE_5', result: p5 });

  const p6 = await phase6TopGuarantee();
  report.phases.push({ phase: 'PHASE_6', result: p6 });

  const p8 = await phase8FinalValidation();
  report.phases.push({ phase: 'PHASE_8', result: p8 });

  report.completed_at = new Date().toISOString();
  writeJson('score_calibration_report.json', report);

  console.log(JSON.stringify({ ok: true, final: p8 }, null, 2));
}

main()
  .catch((error) => {
    writeJson('score_calibration_failed.json', {
      ts: new Date().toISOString(),
      error: error.message,
    });
    console.error('[SCORE_CALIBRATION_FAILED]', error.message);
    process.exit(1);
  })
  .finally(async () => {
    try { await pool.end(); } catch {}
  });
