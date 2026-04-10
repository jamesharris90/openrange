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
  const filePath = path.join(LOG_DIR, fileName);
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
  return filePath;
}

function avg(list, key) {
  if (!list.length) return 0;
  return Number((list.reduce((s, x) => s + Number(x[key] || 0), 0) / list.length).toFixed(4));
}

async function fetchTop15FromDecisionView() {
  const cols = await queryWithTimeout(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema='public' AND table_name='decision_view'`,
    [],
    {
      timeoutMs: 10000,
      label: 'sip.top15.columns',
      maxRetries: 0,
    }
  );

  const hasSipScore = new Set((cols.rows || []).map((r) => r.column_name)).has('sip_score');

  const sql = `
    WITH latest_mm AS (
      SELECT DISTINCT ON (UPPER(symbol))
        UPPER(symbol) AS symbol,
        COALESCE(change_percent, 0)::numeric AS change_percent
      FROM market_metrics
      WHERE symbol IS NOT NULL
      ORDER BY UPPER(symbol), COALESCE(updated_at, last_updated, NOW()) DESC
    )
    SELECT
      dv.symbol,
      dv.final_score,
      dv.decision_score,
      COALESCE(dv.relative_volume, 0)::numeric AS relative_volume,
      COALESCE(dv.gap_percent, 0)::numeric AS gap_percent,
      COALESCE(dv.news_score, 0)::numeric AS news_score,
      COALESCE(dv.earnings_signal, 0)::numeric AS earnings_signal,
      dv.session_phase,
      COALESCE(mm.change_percent, 0)::numeric AS change_percent,
      ${hasSipScore ? 'COALESCE(dv.sip_score, 0)::numeric' : '0::numeric'} AS sip_score
    FROM decision_view dv
    LEFT JOIN latest_mm mm ON mm.symbol = dv.symbol
    ORDER BY dv.final_score DESC NULLS LAST
    LIMIT 15
  `;

  const { rows } = await queryWithTimeout(sql, [], {
    timeoutMs: 30000,
    label: 'sip.top15.current',
    maxRetries: 0,
  });

  return (rows || []).map((r) => ({
    symbol: r.symbol,
    final_score: Number(r.final_score),
    decision_score: Number(r.decision_score),
    relative_volume: Number(r.relative_volume),
    gap_percent: Number(r.gap_percent),
    news_score: Number(r.news_score),
    earnings_flag: Number(r.earnings_signal) > 0,
    session_phase: r.session_phase,
    change_percent: Number(r.change_percent),
    sip_score: Number(r.sip_score),
  }));
}

function classifyRows(rows) {
  const withClassification = rows.map((r) => {
    const checks = {
      relative_volume_gt_1_5: Number(r.relative_volume) > 1.5,
      gap_percent_gt_2: Number(r.gap_percent) > 2,
      has_catalyst: Number(r.news_score) > 0 || Boolean(r.earnings_flag),
    };

    const real_signal_score = Object.values(checks).filter(Boolean).length;
    let classification = 'FALSE POSITIVE';
    if (real_signal_score >= 1) classification = 'VALID STOCK IN PLAY';

    return {
      ...r,
      checks,
      real_signal_score,
      classification,
    };
  });

  const total = withClassification.length;
  const valid = withClassification.filter((r) => r.classification === 'VALID STOCK IN PLAY');
  const invalid = withClassification.filter((r) => r.classification !== 'VALID STOCK IN PLAY');
  const falsePos = withClassification.filter((r) => r.classification === 'FALSE POSITIVE');

  const highRvOrGap = withClassification.filter(
    (r) => Number(r.relative_volume) > 2 || Number(r.gap_percent) > 4
  ).length;

  const passiveNoMove = withClassification.filter(
    (r) => Math.abs(Number(r.change_percent || 0)) < 1 && Number(r.relative_volume || 0) < 1.3 && Number(r.gap_percent || 0) < 2
  ).length;

  const summary = {
    total_symbols: total,
    valid_count: valid.length,
    false_positive_count: falsePos.length,
    valid_percent: total ? Number(((valid.length / total) * 100).toFixed(2)) : 0,
    false_positive_percent: total ? Number(((falsePos.length / total) * 100).toFixed(2)) : 0,
    avg_final_score_valid: avg(valid, 'final_score'),
    avg_final_score_invalid: avg(invalid, 'final_score'),
    high_rvol_or_gap_count: highRvOrGap,
    passive_no_move_count: passiveNoMove,
  };

  return { rows: withClassification, summary };
}

async function ensureCoreViewAndApplySipDominance() {
  const existsCore = await queryWithTimeout(
    `SELECT EXISTS (
       SELECT 1 FROM pg_views
       WHERE schemaname = 'public' AND viewname = 'decision_view_core'
     ) AS ok`,
    [],
    { timeoutMs: 10000, label: 'sip.core.exists', maxRetries: 0 }
  );

  const coreExists = Boolean(existsCore.rows?.[0]?.ok);

  if (!coreExists) {
    await queryWithTimeout(
      `ALTER VIEW decision_view RENAME TO decision_view_core`,
      [],
      { timeoutMs: 15000, label: 'sip.rename.decision_view_core', maxRetries: 0 }
    );
  }

  const cols = await queryWithTimeout(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema='public' AND table_name='decision_view_core'
     ORDER BY ordinal_position`,
    [],
    { timeoutMs: 10000, label: 'sip.core.columns', maxRetries: 0 }
  );

  const coreColumns = (cols.rows || []).map((r) => r.column_name);
  if (!coreColumns.includes('final_score')) {
    throw new Error('SIP_PHASE_FAILED_DECISION_VIEW_CORE_MISSING_FINAL_SCORE');
  }

  const hasSipScore = coreColumns.includes('sip_score');
  const hasNewFinalScore = coreColumns.includes('new_final_score');

  const selectList = coreColumns.map((c) => {
    if (c === 'final_score') {
      return `CASE
        WHEN b.max_score = b.min_score THEN 50
        ELSE ((f.new_final_score - b.min_score) / NULLIF((b.max_score - b.min_score), 0)) * 100
      END::numeric AS final_score`;
    }
    if (c === 'sip_score') {
      return 'f.sip_score::numeric AS sip_score';
    }
    if (c === 'new_final_score') {
      return 'f.new_final_score::numeric AS new_final_score';
    }
    return `f.${c}`;
  });

  if (!hasSipScore) selectList.push('f.sip_score::numeric AS sip_score');
  if (!hasNewFinalScore) selectList.push('f.new_final_score::numeric AS new_final_score');

  const viewSql = `
    CREATE OR REPLACE VIEW decision_view AS
    WITH earnings_2d AS (
      SELECT
        UPPER(symbol) AS symbol,
        BOOL_OR(report_date::date BETWEEN CURRENT_DATE AND CURRENT_DATE + 2) AS within_2d
      FROM earnings_events
      WHERE symbol IS NOT NULL
      GROUP BY UPPER(symbol)
    ),
    p1 AS (
      SELECT
        c.*,
        (
          CASE
            WHEN COALESCE(c.relative_volume, 0) >= 3 THEN 30
            WHEN COALESCE(c.relative_volume, 0) >= 2 THEN 20
            WHEN COALESCE(c.relative_volume, 0) >= 1.5 THEN 10
            ELSE 0
          END
          + CASE
            WHEN COALESCE(c.gap_percent, 0) >= 10 THEN 30
            WHEN COALESCE(c.gap_percent, 0) >= 5 THEN 20
            WHEN COALESCE(c.gap_percent, 0) >= 3 THEN 10
            ELSE 0
          END
          + CASE
            WHEN COALESCE(c.news_score, 0) >= 2 THEN 15
            WHEN COALESCE(c.news_score, 0) >= 1 THEN 8
            ELSE 0
          END
          + CASE
            WHEN COALESCE(e.within_2d, false) THEN 15
            ELSE 0
          END
        )::numeric AS sip_score
      FROM decision_view_core c
      LEFT JOIN earnings_2d e ON e.symbol = c.symbol
    ),
    p2 AS (
      SELECT
        p1.*,
        ((COALESCE(p1.final_score, 0) * 0.6) + (COALESCE(p1.sip_score, 0) * 0.8))::numeric AS integrated_score
      FROM p1
    ),
    p3 AS (
      SELECT
        p2.*,
        CASE
          WHEN COALESCE(p2.relative_volume, 0) < 1.3
           AND COALESCE(p2.gap_percent, 0) < 2
           AND COALESCE(p2.news_score, 0) = 0
            THEN (p2.integrated_score * 0.3)
          ELSE p2.integrated_score
        END::numeric AS new_final_score
      FROM p2
    ),
    bounds AS (
      SELECT
        COALESCE(MIN(new_final_score), 0)::numeric AS min_score,
        COALESCE(MAX(new_final_score), 0)::numeric AS max_score
      FROM p3
    )
    SELECT
      ${selectList.join(',\n      ')}
    FROM p3 f
    CROSS JOIN bounds b
  `;

  await queryWithTimeout(viewSql, [], {
    timeoutMs: 120000,
    label: 'sip.apply.new_view',
    maxRetries: 0,
  });
}

async function validateNoCollapse() {
  const stats = await queryWithTimeout(
    `SELECT
       COUNT(*)::int AS n,
       COALESCE(MIN(final_score), 0)::numeric AS min_final,
       COALESCE(MAX(final_score), 0)::numeric AS max_final,
       COALESCE(AVG(final_score), 0)::numeric AS avg_final,
       COUNT(*) FILTER (WHERE final_score > 60)::int AS above_60
     FROM decision_view`,
    [],
    { timeoutMs: 15000, label: 'sip.validate.collapse', maxRetries: 0 }
  );

  const r = stats.rows?.[0] || {};
  const out = {
    n: Number(r.n || 0),
    min_final: Number(r.min_final || 0),
    max_final: Number(r.max_final || 0),
    avg_final: Number(r.avg_final || 0),
    above_60: Number(r.above_60 || 0),
  };

  const collapsed = out.n === 0 || out.max_final <= out.min_final || out.avg_final < 5;
  if (collapsed) {
    throw new Error('SIP_PHASE_FAILED_DISTRIBUTION_COLLAPSE');
  }

  return out;
}

async function main() {
  const phaseReport = {
    started_at: new Date().toISOString(),
    phases: [],
  };

  const preTop15 = await fetchTop15FromDecisionView();
  const preClassified = classifyRows(preTop15);

  writeJson('sip_precheck.json', {
    ts: new Date().toISOString(),
    top15: preTop15.map((r) => ({
      symbol: r.symbol,
      final_score: r.final_score,
      relative_volume: r.relative_volume,
      gap_percent: r.gap_percent,
      news_score: r.news_score,
    })),
    summary: preClassified.summary,
  });

  phaseReport.phases.push({
    phase: 'PHASE_0',
    baseline_summary: preClassified.summary,
  });

  await ensureCoreViewAndApplySipDominance();
  const stability = await validateNoCollapse();

  phaseReport.phases.push({
    phase: 'PHASE_1_to_4',
    distribution_guard: stability,
  });

  const postTop15 = await fetchTop15FromDecisionView();
  const postClassified = classifyRows(postTop15);

  const passByValid = postClassified.summary.valid_percent >= 60;
  const passByHighMomentumCount = postClassified.summary.high_rvol_or_gap_count >= 5;
  const failByPassiveDominance = postClassified.summary.passive_no_move_count >= 6;

  const enginePass = passByValid && passByHighMomentumCount && !failByPassiveDominance;

  const postReport = {
    ts: new Date().toISOString(),
    top15_table: postTop15,
    classification_per_symbol: postClassified.rows,
    summary_metrics: postClassified.summary,
    pass_conditions: {
      valid_gte_60_percent: passByValid,
      high_rvol_or_gap_gte_5: passByHighMomentumCount,
      no_passive_megacap_dominance: !failByPassiveDominance,
    },
    stocks_in_play_engine: enginePass ? 'PASS' : 'FAIL',
  };

  writeJson('sip_postcheck.json', postReport);

  phaseReport.completed_at = new Date().toISOString();
  phaseReport.result = postReport.stocks_in_play_engine;
  writeJson('sip_phase_report.json', phaseReport);

  console.log(`STOCKS IN PLAY ENGINE: ${postReport.stocks_in_play_engine}`);
  console.log(JSON.stringify({
    verdict: postReport.stocks_in_play_engine,
    summary_metrics: postClassified.summary,
    outputs: {
      precheck: 'logs/sip_precheck.json',
      postcheck: 'logs/sip_postcheck.json',
    },
  }, null, 2));

  if (postReport.stocks_in_play_engine !== 'PASS') {
    process.exit(1);
  }
}

main()
  .catch((error) => {
    writeJson('sip_postcheck.json', {
      ts: new Date().toISOString(),
      error: error.message,
      stocks_in_play_engine: 'FAIL',
    });
    console.error('[SIP_PRIORITY_FAILED]', error.message);
    process.exit(1);
  })
  .finally(async () => {
    try {
      await pool.end();
    } catch {}
  });
