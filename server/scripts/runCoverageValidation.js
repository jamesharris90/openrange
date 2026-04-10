#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
if (!process.env.DATABASE_URL) {
  require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });
}

const REPORT_PATH = path.resolve(__dirname, '..', '..', 'DATA_COVERAGE_REPORT.json');

const { runCoverageEngine, getCoverageOverview, getCoverageStatusBySymbols } = require('../v2/services/coverageEngine');
const { getCoverageAdminOverview } = require('../v2/services/adminService');

async function main() {
  const performRepair = ['1', 'true', 'yes'].includes(String(process.env.PERFORM_REPAIR || '').trim().toLowerCase());
  const refreshCoverage = ['1', 'true', 'yes'].includes(String(process.env.REFRESH_COVERAGE || '').trim().toLowerCase());
  const writeReport = !['0', 'false', 'no'].includes(String(process.env.WRITE_REPORT || '').trim().toLowerCase());
  const repairLimitPerCategory = Number(process.env.REPAIR_LIMIT || 10);
  const strategy = String(process.env.REPAIR_STRATEGY || 'priority').trim().toLowerCase() || 'priority';
  const shouldRebuild = performRepair || refreshCoverage;

  const report = shouldRebuild
    ? await runCoverageEngine({
        performRepair,
        writeReport,
        repairLimitPerCategory,
        limit: repairLimitPerCategory,
        strategy,
      })
    : await getCoverageOverview({ refresh: false, performRepair: false });

  if (writeReport && !shouldRebuild) {
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  const admin = await getCoverageAdminOverview({ refresh: false, performRepair: false });
  const sample = await getCoverageStatusBySymbols(['AAPL', 'TSLA', 'PLTR']);

  console.log(JSON.stringify({
    performRepair,
    refreshCoverage,
    writeReport,
    repairLimitPerCategory,
    strategy,
    source: shouldRebuild ? 'coverage_engine' : 'data_coverage_cache',
    report: {
      total_symbols: report.total_symbols,
      average_coverage_pct: report.average_coverage_pct,
      full_coverage_pct: report.full_coverage_pct,
      partial_coverage_pct: report.partial_coverage_pct,
      low_coverage_pct: report.low_coverage_pct,
      missing_counts: report.missing_counts,
      repair_queue: report.repair_queue,
      repair_summary: report.repair_summary,
      worst_symbols: (report.worst_symbols || []).slice(0, 5),
    },
    admin: {
      coverage_pct: admin.coverage_pct,
      full_coverage_pct: admin.full_coverage_pct,
      partial_coverage_pct: admin.partial_coverage_pct,
      low_coverage_pct: admin.low_coverage_pct,
      missing_counts: admin.missing_counts,
      worst_symbols: (admin.worst_symbols || []).slice(0, 3),
    },
    sample: Array.from(sample.entries()).map(([symbol, row]) => ({
      symbol,
      coverage_score: row.coverage_score,
      has_news: row.has_news,
      has_earnings: row.has_earnings,
      has_technicals: row.has_technicals,
      news_count: row.news_count,
      earnings_count: row.earnings_count,
      last_news_at: row.last_news_at,
      last_earnings_at: row.last_earnings_at,
    })),
  }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });