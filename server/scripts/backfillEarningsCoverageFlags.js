require('dotenv').config();

const fs = require('fs');
const path = require('path');

const { queryWithTimeout } = require('../db/pg');
const { calculateCoverageScore, ensureCoverageTable } = require('../v2/services/coverageEngine');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const PRECHECK_LOG = path.join(LOG_DIR, 'precheck_validation.json');
const REPORT_LOG = path.join(LOG_DIR, 'build_validation_report.json');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

async function writePrecheck() {
  const result = await queryWithTimeout(
    `SELECT
       (SELECT COUNT(*)::int FROM ticker_universe WHERE COALESCE(is_active, true) = true) AS active_universe,
       (SELECT COUNT(*)::int FROM data_coverage) AS data_coverage_rows,
       (SELECT COUNT(*)::int FROM earnings_history) AS earnings_history_rows,
       (SELECT COUNT(*)::int FROM earnings_events) AS earnings_events_rows`,
    [],
    {
      timeoutMs: 60000,
      label: 'earnings_split.precheck_counts',
      maxRetries: 0,
      poolType: 'read',
    }
  );

  const columns = await queryWithTimeout(
    `SELECT table_name, column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name IN ('data_coverage', 'earnings_history', 'earnings_events', 'ticker_universe')
       AND column_name IN ('symbol', 'has_earnings', 'has_earnings_history', 'has_upcoming_earnings', 'report_date', 'is_active')
     ORDER BY table_name, column_name`,
    [],
    {
      timeoutMs: 30000,
      label: 'earnings_split.precheck_columns',
      maxRetries: 0,
      poolType: 'read',
    }
  );

  const precheck = {
    timestamp: new Date().toISOString(),
    tables_checked: ['ticker_universe', 'data_coverage', 'earnings_history', 'earnings_events'],
    counts: result.rows?.[0] || {},
    columns: columns.rows || [],
  };

  fs.writeFileSync(PRECHECK_LOG, `${JSON.stringify(precheck, null, 2)}\n`, 'utf8');
  return precheck;
}

async function rebuildEarningsCoverageFlags() {
  const result = await queryWithTimeout(
    `WITH symbol_universe AS (
       SELECT DISTINCT UPPER(symbol) AS symbol
       FROM ticker_universe
       WHERE NULLIF(symbol, '') IS NOT NULL
         AND COALESCE(is_active, true) = true
       UNION
       SELECT DISTINCT UPPER(symbol) AS symbol
       FROM data_coverage
       WHERE NULLIF(symbol, '') IS NOT NULL
       UNION
       SELECT DISTINCT UPPER(symbol) AS symbol
       FROM earnings_history
       WHERE NULLIF(symbol, '') IS NOT NULL
       UNION
       SELECT DISTINCT UPPER(symbol) AS symbol
       FROM earnings_events
       WHERE NULLIF(symbol, '') IS NOT NULL
         AND report_date >= CURRENT_DATE
     ),
     history_rollup AS (
       SELECT UPPER(symbol) AS symbol,
              COUNT(*)::int AS earnings_count,
              MAX(report_date)::timestamptz AS last_earnings_at
       FROM earnings_history
       WHERE NULLIF(symbol, '') IS NOT NULL
       GROUP BY UPPER(symbol)
     ),
     upcoming_rollup AS (
       SELECT UPPER(symbol) AS symbol,
              COUNT(*)::int AS upcoming_earnings_count
       FROM earnings_events
       WHERE NULLIF(symbol, '') IS NOT NULL
         AND report_date >= CURRENT_DATE
       GROUP BY UPPER(symbol)
     ),
     prepared AS (
       SELECT su.symbol,
              COALESCE(dc.has_news, false) AS has_news,
              COALESCE(dc.has_technicals, false) AS has_technicals,
              COALESCE(dc.news_count, 0)::int AS news_count,
              dc.last_news_at,
              COALESCE(hr.earnings_count, 0)::int AS earnings_count,
              hr.last_earnings_at,
              COALESCE(hr.earnings_count, 0) > 0 AS has_earnings_history,
              COALESCE(ur.upcoming_earnings_count, 0) > 0 AS has_upcoming_earnings
       FROM symbol_universe su
       LEFT JOIN data_coverage dc ON dc.symbol = su.symbol
       LEFT JOIN history_rollup hr ON hr.symbol = su.symbol
       LEFT JOIN upcoming_rollup ur ON ur.symbol = su.symbol
     )
     INSERT INTO data_coverage (
       symbol,
       has_news,
       has_earnings,
       has_earnings_history,
       has_upcoming_earnings,
       has_technicals,
       news_count,
       earnings_count,
       last_news_at,
       last_earnings_at,
       coverage_score,
       last_checked
     )
     SELECT
       symbol,
       has_news,
       has_earnings_history OR has_upcoming_earnings AS has_earnings,
       has_earnings_history,
       has_upcoming_earnings,
       has_technicals,
       news_count,
       earnings_count,
       last_news_at,
       last_earnings_at,
       $1::int AS coverage_score,
       NOW()
     FROM prepared
     ON CONFLICT (symbol) DO UPDATE
     SET has_earnings = EXCLUDED.has_earnings,
         has_earnings_history = EXCLUDED.has_earnings_history,
         has_upcoming_earnings = EXCLUDED.has_upcoming_earnings,
         earnings_count = EXCLUDED.earnings_count,
         last_earnings_at = EXCLUDED.last_earnings_at,
         coverage_score = EXCLUDED.coverage_score,
         last_checked = NOW()
     RETURNING symbol,
               has_news,
               has_earnings,
               has_earnings_history,
               has_upcoming_earnings,
               has_technicals,
               news_count,
               earnings_count,
               last_news_at,
               last_earnings_at,
               coverage_score`,
    [calculateCoverageScore({ has_news: false, has_earnings: false, has_technicals: false })],
    {
      timeoutMs: 45000,
      label: 'earnings_split.backfill',
      maxRetries: 0,
      poolType: 'write',
    }
  );

  const rows = (result.rows || []).map((row) => ({
    ...row,
    coverage_score: calculateCoverageScore(row),
  }));

  if (rows.length > 0) {
    await queryWithTimeout(
      `WITH payload AS (
         SELECT *
         FROM jsonb_to_recordset($1::jsonb) AS x(
           symbol text,
           has_news boolean,
           has_earnings boolean,
           has_earnings_history boolean,
           has_upcoming_earnings boolean,
           has_technicals boolean,
           news_count integer,
           earnings_count integer,
           last_news_at timestamptz,
           last_earnings_at timestamptz,
           coverage_score integer
         )
       )
       UPDATE data_coverage dc
       SET coverage_score = payload.coverage_score,
           last_checked = NOW()
       FROM payload
       WHERE dc.symbol = payload.symbol`,
      [JSON.stringify(rows)],
      {
        timeoutMs: 30000,
        label: 'earnings_split.backfill_score_fixup',
        maxRetries: 0,
        poolType: 'write',
      }
    );
  }

  return rows.length;
}

async function runReconciliation() {
  const result = await queryWithTimeout(
    `WITH active_universe AS (
       SELECT DISTINCT UPPER(symbol) AS symbol
       FROM ticker_universe
       WHERE NULLIF(symbol, '') IS NOT NULL
         AND COALESCE(is_active, true) = true
     ),
     history_symbols AS (
       SELECT DISTINCT UPPER(symbol) AS symbol
       FROM earnings_history
       WHERE NULLIF(symbol, '') IS NOT NULL
     ),
     upcoming_symbols AS (
       SELECT DISTINCT UPPER(symbol) AS symbol
       FROM earnings_events
       WHERE NULLIF(symbol, '') IS NOT NULL
         AND report_date >= CURRENT_DATE
     ),
     joined AS (
       SELECT au.symbol,
              (hs.symbol IS NOT NULL) AS history_exists,
              (us.symbol IS NOT NULL) AS upcoming_exists,
              COALESCE(dc.has_earnings_history, false) AS coverage_history,
              COALESCE(dc.has_upcoming_earnings, false) AS coverage_upcoming,
              COALESCE(dc.has_earnings, false) AS coverage_legacy
       FROM active_universe au
       LEFT JOIN history_symbols hs ON hs.symbol = au.symbol
       LEFT JOIN upcoming_symbols us ON us.symbol = au.symbol
       LEFT JOIN data_coverage dc ON dc.symbol = au.symbol
     )
     SELECT
       COUNT(*)::int AS active_universe,
       COUNT(*) FILTER (WHERE history_exists)::int AS earnings_history_coverage_count,
       COUNT(*) FILTER (WHERE upcoming_exists)::int AS upcoming_earnings_coverage_count,
       COUNT(*) FILTER (WHERE history_exists OR upcoming_exists)::int AS earnings_union_coverage_count,
       COUNT(*) FILTER (WHERE coverage_history)::int AS data_coverage_has_earnings_history_count,
       COUNT(*) FILTER (WHERE coverage_upcoming)::int AS data_coverage_has_upcoming_earnings_count,
       COUNT(*) FILTER (WHERE coverage_legacy)::int AS data_coverage_has_earnings_count,
       COUNT(*) FILTER (WHERE coverage_history AND NOT history_exists)::int AS coverage_history_true_no_history,
       COUNT(*) FILTER (WHERE history_exists AND NOT coverage_history)::int AS history_exists_coverage_history_false,
       COUNT(*) FILTER (WHERE coverage_upcoming AND NOT upcoming_exists)::int AS coverage_upcoming_true_no_event,
       COUNT(*) FILTER (WHERE upcoming_exists AND NOT coverage_upcoming)::int AS upcoming_exists_coverage_upcoming_false,
       COUNT(*) FILTER (WHERE coverage_legacy <> (history_exists OR upcoming_exists))::int AS legacy_union_mismatch_count,
       COUNT(*) FILTER (WHERE coverage_legacy <> (coverage_history OR coverage_upcoming))::int AS legacy_split_mismatch_count
     FROM joined`,
    [],
    {
      timeoutMs: 30000,
      label: 'earnings_split.reconciliation',
      maxRetries: 0,
      poolType: 'read',
    }
  );

  return result.rows?.[0] || {};
}

async function main() {
  ensureDir(LOG_DIR);

  try {
    await ensureCoverageTable();
    const precheck = await writePrecheck();
    const updatedRows = await rebuildEarningsCoverageFlags();
    const reconciliation = await runReconciliation();

    const pass = Number(reconciliation.coverage_history_true_no_history || 0) === 0
      && Number(reconciliation.history_exists_coverage_history_false || 0) === 0
      && Number(reconciliation.coverage_upcoming_true_no_event || 0) === 0
      && Number(reconciliation.upcoming_exists_coverage_upcoming_false || 0) === 0
      && Number(reconciliation.legacy_union_mismatch_count || 0) === 0
      && Number(reconciliation.legacy_split_mismatch_count || 0) === 0
      && Number(reconciliation.earnings_history_coverage_count || 0) === Number(reconciliation.data_coverage_has_earnings_history_count || 0)
      && Number(reconciliation.upcoming_earnings_coverage_count || 0) === Number(reconciliation.data_coverage_has_upcoming_earnings_count || 0)
      && Number(reconciliation.earnings_union_coverage_count || 0) === Number(reconciliation.data_coverage_has_earnings_count || 0);

    const report = {
      timestamp: new Date().toISOString(),
      precheck,
      updated_rows: updatedRows,
      reconciliation,
      status: pass ? 'BUILD VALIDATED - SAFE TO DEPLOY' : 'BUILD FAILED - FIX REQUIRED',
    };

    fs.writeFileSync(REPORT_LOG, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify(report, null, 2));

    if (!pass) {
      process.exitCode = 1;
    }
  } catch (error) {
    const report = {
      timestamp: new Date().toISOString(),
      status: 'BUILD FAILED - FIX REQUIRED',
      error: error.message,
    };
    ensureDir(LOG_DIR);
    fs.writeFileSync(REPORT_LOG, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.error(report.status);
    console.error(error);
    process.exit(1);
  }
}

main();