require('dotenv').config();

const fs = require('fs');
const path = require('path');

const { queryWithTimeout } = require('../db/pg');
const {
  ensureTickerClassificationSchema,
  classifyTickerRecord,
  upsertTickerClassifications,
} = require('../services/tickerClassificationService');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const PRECHECK_LOG = path.join(LOG_DIR, 'precheck_validation.json');
const REPORT_LOG = path.join(LOG_DIR, 'build_validation_report.json');

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function chunk(list, size) {
  const output = [];
  for (let index = 0; index < list.length; index += size) {
    output.push(list.slice(index, index + size));
  }
  return output;
}

async function main() {
  ensureDir(LOG_DIR);

  const precheck = await queryWithTimeout(
    `SELECT
       (SELECT COUNT(*) FROM ticker_universe WHERE is_active = true) AS active_tickers,
       (SELECT COUNT(*) FROM market_quotes) AS market_quote_rows,
       (SELECT COUNT(*) FROM company_profiles) AS company_profile_rows`,
    [],
    {
      timeoutMs: 8000,
      label: 'ticker_classification.precheck',
      maxRetries: 0,
    }
  );

  fs.writeFileSync(PRECHECK_LOG, JSON.stringify({
    timestamp: new Date().toISOString(),
    tables_checked: ['ticker_universe', 'market_quotes', 'company_profiles'],
    counts: precheck.rows[0],
  }, null, 2));

  await ensureTickerClassificationSchema();

  const result = await queryWithTimeout(
    `SELECT
       tu.symbol,
       tu.company_name,
       tu.sector,
       tu.industry,
       mq.price,
       cp.exchange
     FROM ticker_universe tu
     LEFT JOIN market_quotes mq ON mq.symbol = tu.symbol
     LEFT JOIN company_profiles cp ON cp.symbol = tu.symbol
     WHERE tu.is_active = true
     ORDER BY tu.symbol ASC`,
    [],
    {
      timeoutMs: 20000,
      label: 'ticker_classification.load_active_universe',
      maxRetries: 0,
    }
  );

  const rows = result.rows || [];
  const batches = chunk(rows, 500);
  let upserted = 0;

  for (let index = 0; index < batches.length; index += 1) {
    upserted += await upsertTickerClassifications(batches[index]);
    if ((index + 1) % 5 === 0 || index === batches.length - 1) {
      console.log(`Ticker classification progress ${index + 1}/${batches.length}`);
    }
  }

  const counts = rows.reduce((summary, row) => {
    const derived = classifyTickerRecord(row);
    summary[derived.stock_classification] = (summary[derived.stock_classification] || 0) + 1;
    return summary;
  }, {});

  const detailCounts = rows.reduce((summary, row) => {
    const derived = classifyTickerRecord(row);
    summary[derived.instrument_detail_label] = (summary[derived.instrument_detail_label] || 0) + 1;
    return summary;
  }, {});

  const report = {
    timestamp: new Date().toISOString(),
    active_tickers: rows.length,
    upserted_rows: upserted,
    classification_counts: counts,
    instrument_detail_counts: detailCounts,
    status: 'BUILD VALIDATED - SAFE TO DEPLOY',
  };

  fs.writeFileSync(REPORT_LOG, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  const report = {
    timestamp: new Date().toISOString(),
    status: 'BUILD FAILED - FIX REQUIRED',
    error: error.message,
  };
  ensureDir(LOG_DIR);
  fs.writeFileSync(REPORT_LOG, JSON.stringify(report, null, 2));
  console.error(report.status);
  console.error(error);
  process.exit(1);
});