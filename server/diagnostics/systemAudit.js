const fs = require('fs/promises');
const path = require('path');
const { testEndpoint } = require('./endpointTester');
const { validateData } = require('./dataValidator');
const { testPages } = require('./pageTester');
const { generateTextReport, writeJsonReport } = require('./diagnosticReport');
const { queryWithTimeout } = require('../db/pg');

const endpoints = [
  '/api/radar',
  '/api/scanner',
  '/api/opportunities',
  '/api/signals',
  '/api/news',
  '/api/catalysts',
  '/api/market-breadth',
  '/api/sector-rotation',
  '/api/intelligence-feed',
  '/api/trade-setups',
  '/api/chart-data',
  '/api/ticker-tape',
];

function summarizeValidation(validations) {
  const summary = {
    symbolsMissingCatalyst: 0,
    rowsMissingSymbol: 0,
    rowsMissingTimestamp: 0,
    expectedMoveZeroRows: 0,
    emptyDatasets: 0,
    notArrayResponses: 0,
  };

  validations.forEach((entry) => {
    summary.symbolsMissingCatalyst += entry.issueCounts.missingCatalyst;
    summary.rowsMissingSymbol += entry.issueCounts.missingSymbol;
    summary.rowsMissingTimestamp += entry.issueCounts.missingTimestamp;
    summary.expectedMoveZeroRows += entry.issueCounts.expectedMoveAlwaysZero;
    summary.emptyDatasets += entry.issueCounts.emptyDataset;
    summary.notArrayResponses += entry.issueCounts.notArray;
  });

  return summary;
}

function validateChartData(endpointResults) {
  const chartResult = endpointResults.find((item) => item.endpoint === '/api/chart-data');
  const rows = Array.isArray(chartResult?.parsedData)
    ? chartResult.parsedData
    : Array.isArray(chartResult?.primaryArray)
      ? chartResult.primaryArray
      : [];

  let missingOhlcRows = 0;
  let missingTimestamps = 0;
  rows.forEach((row) => {
    const hasOHLC = row && row.open != null && row.high != null && row.low != null && row.close != null;
    if (!hasOHLC) missingOhlcRows += 1;
    if (!row?.timestamp && !row?.time && !row?.date) missingTimestamps += 1;
  });

  const status = rows.length === 0
    ? 'Chart engine not feeding data'
    : missingOhlcRows > 0 || missingTimestamps > 0
      ? 'PARTIAL'
      : 'OK';

  return {
    status,
    candles: rows.length,
    missingOhlcRows,
    missingTimestamps,
  };
}

async function validateSparklineUsage() {
  const root = path.resolve(__dirname, '../../client/src');
  const stack = [root];
  const matchedFiles = [];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!/\.(js|jsx|ts|tsx)$/.test(entry.name)) continue;
      const source = await fs.readFile(fullPath, 'utf8');
      if (/tradingview/i.test(source) && /sparkline/i.test(source)) {
        matchedFiles.push(path.relative(path.resolve(__dirname, '../..'), fullPath));
      }
    }
  }

  return {
    status: matchedFiles.length > 0 ? 'WARNING' : 'OK',
    message: matchedFiles.length > 0
      ? 'Sparklines using TradingView embed'
      : 'Sparklines are not using TradingView embed',
    files: matchedFiles,
  };
}

async function getCatalystVerification() {
  try {
    const columnResult = await queryWithTimeout(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'trade_catalysts'`,
      [],
      { label: 'audit.catalysts.columns', timeoutMs: 6000, maxRetries: 0 }
    );

    const columns = new Set((columnResult.rows || []).map((row) => row.column_name));
    if (columns.size === 0) {
      return {
        status: 'WARNING',
        message: 'trade_catalysts table missing',
        totalRows: 0,
        missingCatalystContext: 0,
      };
    }

    const catalystColumn = columns.has('catalyst')
      ? 'catalyst'
      : columns.has('catalyst_type')
        ? 'catalyst_type'
        : columns.has('headline')
          ? 'headline'
          : null;

    const timestampColumn = columns.has('timestamp')
      ? 'timestamp'
      : columns.has('published_at')
        ? 'published_at'
        : columns.has('created_at')
          ? 'created_at'
          : null;

    const symbolColumn = columns.has('symbol') ? 'symbol' : null;

    if (!symbolColumn || !catalystColumn) {
      return {
        status: 'WARNING',
        message: 'trade_catalysts missing required columns for catalyst verification',
        totalRows: 0,
        missingCatalystContext: 0,
      };
    }

    const selectSql = `SELECT "${symbolColumn}" AS symbol, "${catalystColumn}" AS catalyst${timestampColumn ? `, "${timestampColumn}" AS timestamp` : ''}
      FROM trade_catalysts
      LIMIT 2000`;

    const result = await queryWithTimeout(selectSql, [], {
      label: 'audit.catalysts.rows',
      timeoutMs: 6000,
      maxRetries: 0,
    });

    const rows = Array.isArray(result.rows) ? result.rows : [];
    const missingCatalystContext = rows.filter((row) => row.symbol && !row.catalyst).length;

    return {
      status: missingCatalystContext > 0 ? 'WARNING' : 'OK',
      message: missingCatalystContext > 0 ? 'Missing catalyst context' : 'Catalyst context present',
      totalRows: rows.length,
      missingCatalystContext,
    };
  } catch (error) {
    return {
      status: 'WARNING',
      message: `Catalyst verification failed: ${error.message}`,
      totalRows: 0,
      missingCatalystContext: 0,
    };
  }
}

async function runSystemAudit(options = {}) {
  const baseUrl = options.baseUrl || process.env.AUDIT_BASE_URL || 'http://localhost:3000';
  const endpointResults = await Promise.all(endpoints.map((endpoint) => testEndpoint(baseUrl, endpoint)));

  const validations = endpointResults.map((result) => ({
    endpoint: result.endpoint,
    ...validateData(result.primaryArray),
  }));

  const pages = testPages(endpointResults);
  const chartValidation = validateChartData(endpointResults);
  const sparklineValidation = await validateSparklineUsage();
  const catalystVerification = await getCatalystVerification();

  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    endpoints: endpointResults.map((result) => ({
      endpoint: result.endpoint,
      status: result.status,
      ok: result.ok,
      responseTimeMs: result.responseTimeMs,
      responseType: result.responseType,
      arrayLength: result.arrayLength,
      error: result.error || null,
    })),
    pages,
    dataQuality: summarizeValidation(validations),
    endpointValidation: validations,
    chartValidation,
    sparklineValidation,
    catalystVerification,
  };

  const textReport = generateTextReport(report);
  const reportPath = path.resolve(__dirname, 'system_audit.json');
  await writeJsonReport(reportPath, report);

  const rootDiagnosticsDir = path.resolve(__dirname, '../..', 'diagnostics');
  await fs.mkdir(rootDiagnosticsDir, { recursive: true });
  const mirroredPath = path.join(rootDiagnosticsDir, 'system_audit.json');
  await writeJsonReport(mirroredPath, report);

  return {
    report,
    textReport,
    reportPath,
    mirroredPath,
  };
}

module.exports = {
  endpoints,
  runSystemAudit,
};
