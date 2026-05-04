const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const { ingestFilings } = require('../ingestion/fmp_sec_filings_ingest');

function formatDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseMonthsArg(argv) {
  const index = argv.findIndex((arg) => arg === '--months');
  if (index === -1) {
    return 6;
  }
  const value = Number(argv[index + 1]);
  return Number.isFinite(value) && value > 0 ? value : 6;
}

function buildBackfillWindows(months) {
  const today = new Date();
  const endDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const startDate = new Date(endDate);
  startDate.setUTCMonth(startDate.getUTCMonth() - months);

  const windows = [];
  let cursor = new Date(startDate);

  while (cursor <= endDate) {
    const chunkEnd = new Date(cursor);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + 79);
    if (chunkEnd > endDate) {
      chunkEnd.setTime(endDate.getTime());
    }

    windows.push({
      fromDate: formatDate(cursor),
      toDate: formatDate(chunkEnd),
    });

    if (chunkEnd.getTime() >= endDate.getTime()) {
      break;
    }

    cursor = new Date(chunkEnd);
    cursor.setUTCDate(cursor.getUTCDate() - 9);
  }

  return windows;
}

async function main() {
  const startedAt = Date.now();
  const months = parseMonthsArg(process.argv.slice(2));
  const windows = buildBackfillWindows(months);
  const totals = {
    jobName: 'backfill_sec_filings',
    months,
    windows: windows.length,
    totalSeen: 0,
    totalUpserted: 0,
    totalSkipped: 0,
    totalErrored: 0,
    pagesFetched: 0,
    durationMs: 0,
  };

  for (const window of windows) {
    const result = await ingestFilings({
      fromDate: window.fromDate,
      toDate: window.toDate,
    });

    totals.totalSeen += result.totalSeen;
    totals.totalUpserted += result.totalUpserted;
    totals.totalSkipped += result.totalSkipped;
    totals.totalErrored += result.totalErrored;
    totals.pagesFetched += result.pagesFetched;
  }

  totals.durationMs = Date.now() - startedAt;
  console.log(JSON.stringify(totals, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
