const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { parse } = require('csv-parse/sync');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function resolveCsvPath() {
  const argPath = process.argv[2];
  const envPath = process.env.FINVIZ_CSV_PATH;

  const candidates = [
    argPath,
    envPath,
    path.join(process.cwd(), 'finviz (14).csv'),
    path.join(__dirname, '..', '..', 'finviz (14).csv'),
    '/Users/jamesharris/Downloads/finviz (14).csv',
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch (_error) {
      continue;
    }
  }

  return null;
}

function extractTickers(csvText) {
  const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  if (!Array.isArray(records) || records.length === 0) return [];

  const tickers = records
    .map((row) => String(row?.Ticker || '').trim().toUpperCase())
    .filter(Boolean);

  return Array.from(new Set(tickers));
}

async function fetchUniverse(port) {
  const url = `http://localhost:${port}/api/canonical/universe-v2`;
  const headers = {};
  const response = await axios.get(url, {
    timeout: 300000,
    headers,
    validateStatus: () => true,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Universe route returned HTTP ${response.status}: ${JSON.stringify(response.data)}`);
  }

  const body = response.data || {};
  if (!Array.isArray(body.data)) {
    throw new Error('Universe response missing data array');
  }

  return body.data;
}

async function main() {
  const csvPath = resolveCsvPath();
  if (!csvPath) {
    console.error('CSV parsing error: could not locate finviz (14).csv in project root or provided path.');
    process.exitCode = 1;
    return;
  }

  let csvText;
  try {
    csvText = fs.readFileSync(csvPath, 'utf8');
  } catch (error) {
    console.error('CSV parsing error:', error.message);
    process.exitCode = 1;
    return;
  }

  let csvTickers;
  try {
    csvTickers = extractTickers(csvText);
  } catch (error) {
    console.error('CSV parsing error:', error.message);
    process.exitCode = 1;
    return;
  }

  const port = process.env.PORT || 3000;

  let universeRows;
  try {
    universeRows = await fetchUniverse(port);
  } catch (error) {
    console.error('Route not reachable or invalid response:', error.message);
    process.exitCode = 1;
    return;
  }

  if (!universeRows.length) {
    console.error('Empty universe response: universe-v2 returned zero rows.');
    process.exitCode = 1;
    return;
  }

  const universeSet = new Set(
    universeRows
      .map((row) => String(row?.symbol || '').trim().toUpperCase())
      .filter(Boolean)
  );

  const missing = csvTickers.filter((ticker) => !universeSet.has(ticker)).sort();
  const matched = csvTickers.length - missing.length;
  const coverage = csvTickers.length > 0 ? (matched / csvTickers.length) * 100 : 0;

  console.log('=== Universe Coverage Report ===');
  console.log('CSV Tickers Count:', csvTickers.length);
  console.log('Universe Count:', universeSet.size);
  console.log('Matched:', matched);
  console.log('Missing:', missing.length);
  console.log('Coverage %:', `${coverage.toFixed(2)}%`);

  if (missing.length > 0) {
    console.log('\nMissing tickers:');
    missing.forEach((ticker) => console.log(ticker));
  }
}

main().catch((error) => {
  console.error('Unexpected error:', error.message || error);
  process.exitCode = 1;
});
