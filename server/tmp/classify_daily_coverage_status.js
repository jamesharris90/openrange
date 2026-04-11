const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
if (!process.env.DATABASE_URL && !process.env.SUPABASE_DB_URL) {
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
}

const { queryWithTimeout } = require('../db/pg');
const { loadUniverseSymbols } = require('../ingestion/fmp_prices_ingest');
const {
  ensureCoverageStatusTable,
  upsertCoverageStatuses,
  getCoverageStatusCounts,
} = require('../services/dataCoverageStatusService');
const {
  ensureCoverageCampaignProgressTable,
  startCoverageCampaignProgress,
  updateCoverageCampaignProgress,
} = require('../services/coverageCampaignProgressService');
const { fmpFetch } = require('../services/fmpClient');
const { normalizeSymbol, mapToProviderSymbol } = require('../utils/symbolMap');

const TARGET_DATE = '2026-04-10';
const SAMPLE_SIZE = 50;
const CLASSIFY_CONCURRENCY = Math.max(1, Number(process.env.COVERAGE_CLASSIFY_CONCURRENCY) || 1);

async function runWithConcurrency(items, worker, concurrency) {
  const output = new Array(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        return;
      }

      output[index] = await worker(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker());
  await Promise.all(workers);
  return output;
}

async function loadClassificationRows() {
  const sql = `SELECT 
    tu.symbol,
    CASE 
      WHEN d.symbol IS NOT NULL THEN 'HAS_DATA'
      ELSE 'NO_DATA'
    END AS data_status
  FROM ticker_universe tu
  LEFT JOIN (
    SELECT DISTINCT symbol 
    FROM daily_ohlc 
    WHERE date = $1
  ) d ON tu.symbol = d.symbol
  WHERE tu.is_active = true`;

  const result = await queryWithTimeout(sql, [TARGET_DATE], {
    label: 'coverage_status.classification_rows',
    timeoutMs: 30000,
    maxRetries: 0,
  });

  return result.rows || [];
}

async function loadCounts() {
  const sql = `SELECT data_status, COUNT(*)::int AS count
    FROM (
      SELECT 
        tu.symbol,
        CASE 
          WHEN d.symbol IS NOT NULL THEN 'HAS_DATA'
          ELSE 'NO_DATA'
        END AS data_status
      FROM ticker_universe tu
      LEFT JOIN (
        SELECT DISTINCT symbol 
        FROM daily_ohlc 
        WHERE date = $1
      ) d ON tu.symbol = d.symbol
      WHERE tu.is_active = true
    ) grouped_query
    GROUP BY data_status
    ORDER BY data_status`;

  const result = await queryWithTimeout(sql, [TARGET_DATE], {
    label: 'coverage_status.group_counts',
    timeoutMs: 30000,
    maxRetries: 0,
  });

  return result.rows || [];
}

async function loadSampleMissingSymbols() {
  const sql = `SELECT symbol
    FROM ticker_universe
    WHERE is_active = true
      AND symbol NOT IN (
        SELECT symbol FROM daily_ohlc WHERE date = $1
      )
    LIMIT ${SAMPLE_SIZE}`;
  const result = await queryWithTimeout(sql, [TARGET_DATE], {
    label: 'coverage_status.sample_missing',
    timeoutMs: 30000,
    maxRetries: 0,
  });

  return (result.rows || []).map((row) => row.symbol);
}

async function classifyMissingSymbol(symbol) {
  try {
    const providerSymbol = mapToProviderSymbol(normalizeSymbol(symbol));
    const fullPayload = await fmpFetch(
      `/historical-price-eod/full?symbol=${encodeURIComponent(providerSymbol)}&from=${TARGET_DATE}&to=2026-04-11`
    );
    if (Array.isArray(fullPayload) && fullPayload.length > 0) {
      return { symbol, status: 'MISSING', source: 'HAS_FMP_DATA' };
    }

    return { symbol, status: 'UNSUPPORTED', source: 'NO_FMP_DATA' };
  } catch (error) {
    return { symbol, status: 'MISSING', source: `FMP_ERROR:${error.message}` };
  }
}

async function main() {
  await ensureCoverageStatusTable();
  await ensureCoverageCampaignProgressTable();

  const activeUniverse = await loadUniverseSymbols();
  const classificationRows = await loadClassificationRows();
  const counts = await loadCounts();
  const sampleMissing = await loadSampleMissingSymbols();

  const hasDataSymbols = classificationRows
    .filter((row) => row.data_status === 'HAS_DATA')
    .map((row) => row.symbol);
  const noDataSymbols = classificationRows
    .filter((row) => row.data_status === 'NO_DATA')
    .map((row) => row.symbol);

  console.log('[CLASSIFICATION_QUERY_ROWS]', classificationRows.length);
  console.log('[CLASSIFICATION_COUNTS]', JSON.stringify(counts));
  console.log('[CLASSIFICATION_SAMPLE]', JSON.stringify(sampleMissing));

  let processed = hasDataSymbols.length;
  let unsupported = 0;
  const progressRecord = await startCoverageCampaignProgress({
    totalSymbols: activeUniverse.length,
    processedSymbols: processed,
    hasData: hasDataSymbols.length,
    unsupported,
  });

  const missingClassifications = await runWithConcurrency(
    noDataSymbols,
    async (symbol, index) => {
      const result = await classifyMissingSymbol(symbol);
      processed += 1;
      if (result.status === 'UNSUPPORTED') {
        unsupported += 1;
      }
      await updateCoverageCampaignProgress(progressRecord?.id, {
        processedSymbols: processed,
        hasData: hasDataSymbols.length,
        unsupported,
      });
      if ((index + 1) % 100 === 0 || (index + 1) === noDataSymbols.length) {
        console.log(`[CLASSIFY_PROGRESS] ${index + 1}/${noDataSymbols.length}`);
      }
      return result;
    },
    CLASSIFY_CONCURRENCY,
  );

  await upsertCoverageStatuses([
    ...hasDataSymbols.map((symbol) => ({ symbol, status: 'HAS_DATA' })),
    ...missingClassifications.map((row) => ({ symbol: row.symbol, status: row.status })),
  ]);

  const statusCounts = await getCoverageStatusCounts();
  await updateCoverageCampaignProgress(progressRecord?.id, {
    processedSymbols: activeUniverse.length,
    hasData: statusCounts.HAS_DATA,
    unsupported: statusCounts.UNSUPPORTED,
  });
  const summary = {
    targetDate: TARGET_DATE,
    totalSymbols: activeUniverse.length,
    hasData: statusCounts.HAS_DATA,
    missing: statusCounts.MISSING,
    unsupported: statusCounts.UNSUPPORTED,
    sampleMissing,
    sampleAvailability: missingClassifications.slice(0, SAMPLE_SIZE),
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});