const { queryWithTimeout } = require('../../db/pg');
const { getLatestOpportunitiesPayload, getLatestScreenerPayload, getSnapshotStatus } = require('./snapshotService');
const { ensureValidationSchemaReady, getValidationRollup } = require('./validationService');
const { getCoverageOverview, getPriorityPreview, runCoverageRepair } = require('./coverageEngine');

function toPercent(numerator, denominator) {
  if (!denominator) {
    return 0;
  }

  return Number(((Number(numerator || 0) / Number(denominator || 1)) * 100).toFixed(2));
}

async function tableExists(tableName) {
  const result = await queryWithTimeout(
    `SELECT to_regclass($1) AS name`,
    [`public.${tableName}`],
    {
      timeoutMs: 3000,
      label: `admin.table_exists.${tableName}`,
      maxRetries: 0,
    }
  );

  return Boolean(result.rows?.[0]?.name);
}

async function safeMetric(sql, params, fallback, label) {
  try {
    const result = await queryWithTimeout(sql, params, {
      timeoutMs: 4000,
      label,
      maxRetries: 0,
    });
    return result.rows?.[0] || fallback;
  } catch (_error) {
    return fallback;
  }
}

async function getSystemOverview() {
  const [snapshotStatus, screenerPayload, opportunitiesPayload] = await Promise.all([
    getSnapshotStatus(),
    getLatestScreenerPayload(),
    getLatestOpportunitiesPayload(),
  ]);

  return {
    backend: {
      uptime_seconds: Math.round(process.uptime()),
      node_env: process.env.NODE_ENV || 'development',
    },
    snapshot: {
      has_snapshot: snapshotStatus.has_snapshot,
      last_snapshot_age_seconds: snapshotStatus.last_snapshot_age,
      snapshot_count: snapshotStatus.snapshot_count,
      engine_status: snapshotStatus.has_snapshot && Number(snapshotStatus.last_snapshot_age) <= 180 ? 'running' : 'degraded',
    },
    coverage: {
      screener_rows: Array.isArray(screenerPayload?.data) ? screenerPayload.data.length : 0,
      opportunities_rows: Array.isArray(opportunitiesPayload?.data) ? opportunitiesPayload.data.length : 0,
    },
  };
}

async function getDataOverview() {
  const [quotes, news, earnings, companyProfiles] = await Promise.all([
    safeMetric(
      `SELECT
         COUNT(*) FILTER (WHERE updated_at >= NOW() - INTERVAL '5 minutes')::int AS fresh,
         COUNT(*)::int AS total
       FROM market_quotes`,
      [],
      { fresh: 0, total: 0 },
      'admin.data.market_quotes'
    ),
    safeMetric(
      `SELECT
         COUNT(*) FILTER (WHERE published_at >= NOW() - INTERVAL '24 hours')::int AS fresh,
         COUNT(*)::int AS total
       FROM news_articles`,
      [],
      { fresh: 0, total: 0 },
      'admin.data.news_articles'
    ),
    safeMetric(
      `SELECT
         COUNT(*) FILTER (WHERE report_date >= CURRENT_DATE - INTERVAL '7 days')::int AS covered,
         COUNT(*)::int AS total
       FROM earnings_events`,
      [],
      { covered: 0, total: 0 },
      'admin.data.earnings_events'
    ),
    safeMetric(
      `SELECT
         COUNT(*) FILTER (
           WHERE NULLIF(TRIM(country), '') IS NOT NULL
             AND NULLIF(TRIM(exchange), '') IS NOT NULL
             AND NULLIF(TRIM(sector), '') IS NOT NULL
             AND NULLIF(TRIM(industry), '') IS NOT NULL
         )::int AS complete,
         COUNT(*)::int AS total
       FROM company_profiles`,
      [],
      { complete: 0, total: 0 },
      'admin.data.company_profiles'
    ),
  ]);

  return {
    freshness: {
      market_quotes_pct: toPercent(quotes.fresh, quotes.total),
      news_pct: toPercent(news.fresh, news.total),
      earnings_pct: toPercent(earnings.covered, earnings.total),
    },
    completeness: {
      company_profiles_pct: toPercent(companyProfiles.complete, companyProfiles.total),
      company_profiles_complete: Number(companyProfiles.complete || 0),
      company_profiles_total: Number(companyProfiles.total || 0),
    },
  };
}

async function getPerformanceOverview() {
  const hasDailyValidation = await tableExists('signal_validation_daily');
  if (!hasDailyValidation) {
    return {
      signal_performance: null,
      note: 'signal_validation_daily unavailable',
    };
  }

  const latest = await safeMetric(
    `SELECT
       date,
       COALESCE(learning_score, 0) AS learning_score,
       COALESCE(ranking_accuracy, 0) AS ranking_accuracy,
       COALESCE(avg_signal_return, 0) AS avg_signal_return,
       COALESCE(avg_top_rank_return, 0) AS avg_top_rank_return
     FROM signal_validation_daily
     ORDER BY date DESC
     LIMIT 1`,
    [],
    {},
    'admin.performance.latest_signal_validation'
  );

  return {
    signal_performance: latest,
    readiness_score: Number(((Number(latest.learning_score || 0) + Number(latest.ranking_accuracy || 0)) / 2).toFixed(2)),
  };
}

async function getValidationOverview() {
  await ensureValidationSchemaReady();
  const rollup = await getValidationRollup();
  const total = rollup.reduce((sum, row) => sum + Number(row.total || 0), 0);
  const matched = rollup.reduce((sum, row) => sum + Number(row.matched || 0), 0);

  return {
    accuracy_pct: toPercent(matched, total),
    total_checks: total,
    matched_checks: matched,
    providers: rollup,
  };
}

async function getSystemCompletionReport() {
  const [systemOverview, dataOverview, performanceOverview, validationOverview] = await Promise.all([
    getSystemOverview(),
    getDataOverview(),
    getPerformanceOverview(),
    getValidationOverview(),
  ]);

  const dataCompleteness = Number((((dataOverview.completeness.company_profiles_pct || 0) + (dataOverview.freshness.earnings_pct || 0)) / 2).toFixed(2));
  const missingFields = Number((100 - (dataOverview.completeness.company_profiles_pct || 0)).toFixed(2));
  const adminCoverage = 100;
  const readyForProduction = dataCompleteness >= 85 && validationOverview.accuracy_pct >= 75 && systemOverview.snapshot.engine_status === 'running';

  return {
    data_completeness_pct: dataCompleteness,
    missing_fields_pct: missingFields,
    validation_accuracy_pct: validationOverview.accuracy_pct,
    admin_coverage_pct: adminCoverage,
    ready_for_production: readyForProduction,
  };
}

async function getCoverageAdminOverview(options = {}) {
  const refresh = Boolean(options.refresh);
  const performRepair = Boolean(options.performRepair);
  const payload = await getCoverageOverview({
    refresh,
    performRepair,
  });

  return {
    coverage_pct: payload.average_coverage_pct,
    full_coverage_pct: payload.full_coverage_pct,
    partial_coverage_pct: payload.partial_coverage_pct,
    low_coverage_pct: payload.low_coverage_pct,
    missing_counts: payload.missing_counts,
    worst_symbols: payload.worst_symbols,
    repair_queue: payload.repair_queue,
    total_symbols: payload.total_symbols,
    generated_at: payload.generated_at,
  };
}

async function triggerCoverageRepair(options = {}) {
  const strategy = String(options.strategy || 'priority').trim().toLowerCase() || 'priority';
  const limit = Math.max(1, Number(options.limit) || 100);
  const payload = await runCoverageRepair({
    strategy,
    limit,
    writeReport: true,
  });

  return {
    coverage_pct: payload.average_coverage_pct,
    full_coverage_pct: payload.full_coverage_pct,
    partial_coverage_pct: payload.partial_coverage_pct,
    low_coverage_pct: payload.low_coverage_pct,
    missing_counts: payload.missing_counts,
    repair_summary: payload.repair_summary,
    repair_queue: payload.repair_queue,
    generated_at: payload.generated_at,
  };
}

async function getCoveragePriorityPreview(options = {}) {
  const limit = Math.max(1, Number(options.limit) || 50);
  const rows = await getPriorityPreview({ limit });

  return {
    limit,
    count: rows.length,
    rows,
    generated_at: new Date().toISOString(),
  };
}

module.exports = {
  getCoveragePriorityPreview,
  getCoverageAdminOverview,
  getDataOverview,
  getPerformanceOverview,
  getSystemCompletionReport,
  getSystemOverview,
  getValidationOverview,
  triggerCoverageRepair,
};