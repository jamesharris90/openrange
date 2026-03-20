const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });
const serverEnv = path.resolve(process.cwd(), 'server/.env');
if (!process.env.FMP_API_KEY && fs.existsSync(serverEnv)) {
  require('dotenv').config({ path: serverEnv });
}

const API_KEY = process.env.FMP_API_KEY;

if (!API_KEY) {
  console.error('[STRICT] FMP_API_KEY missing.');
  process.exit(1);
}

const ENDPOINTS = [
  {
    key: 'earnings-calendar',
    url: 'https://financialmodelingprep.com/stable/earnings-calendar',
    validationType: 'symbol-based',
    symbolCandidates: ['symbol', 'ticker', 'stockSymbol'],
    timestampCandidates: ['date', 'updatedFromDate', 'fillingDate', 'acceptedDate'],
  },
  {
    key: 'news-stock-latest',
    url: 'https://financialmodelingprep.com/stable/news/stock-latest?page=0&limit=50',
    validationType: 'symbol-based',
    symbolCandidates: ['symbol', 'ticker', 'stockSymbol'],
    timestampCandidates: ['publishedDate', 'date', 'createdAt'],
  },
  {
    key: 'news-general-latest',
    url: 'https://financialmodelingprep.com/stable/news/general-latest?page=0&limit=50',
    validationType: 'macro-based',
    symbolCandidates: ['symbol', 'ticker', 'stockSymbol'],
    timestampCandidates: ['publishedDate', 'date', 'createdAt'],
    macroCandidates: {
      publishedDate: ['publishedDate', 'date', 'createdAt'],
      title: ['title', 'headline'],
      publisherOrSite: ['publisher', 'site'],
    },
  },
  {
    key: 'ipos-calendar',
    url: 'https://financialmodelingprep.com/stable/ipos-calendar',
    validationType: 'symbol-based',
    symbolCandidates: ['symbol', 'ticker', 'stockSymbol'],
    timestampCandidates: ['date', 'ipoDate', 'filingDate', 'acceptedDate'],
  },
  {
    key: 'splits-calendar',
    url: 'https://financialmodelingprep.com/stable/splits-calendar',
    validationType: 'symbol-based',
    symbolCandidates: ['symbol', 'ticker', 'stockSymbol'],
    timestampCandidates: ['date', 'exDate', 'declarationDate', 'paymentDate', 'recordDate'],
  },
];

function extractWithCandidates(row, candidates) {
  for (const key of candidates) {
    const value = row?.[key];
    if (value != null && value !== '') {
      return { key, value };
    }
  }
  return null;
}

function asArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

function getSampleRows(rows, count = 3) {
  return rows.slice(0, count).map((row) => ({
    symbol: row?.symbol ?? row?.ticker ?? row?.stockSymbol ?? null,
    publishedDate: row?.publishedDate ?? row?.date ?? row?.createdAt ?? null,
    title: row?.title ?? row?.headline ?? null,
    publisher: row?.publisher ?? null,
    site: row?.site ?? null,
    url: row?.url ?? null,
  }));
}

async function main() {
  const logDir = path.resolve(process.cwd(), 'logs/fmp');
  fs.mkdirSync(logDir, { recursive: true });

  const summary = {
    generatedAt: new Date().toISOString(),
    strictMode: true,
    ok: true,
    endpoints: [],
  };

  for (const endpoint of ENDPOINTS) {
    const url = `${endpoint.url}${endpoint.url.includes('?') ? '&' : '?'}apikey=${encodeURIComponent(API_KEY)}`;
    const response = await fetch(url);
    const text = await response.text();

    let payload;
    try {
      payload = JSON.parse(text);
    } catch (_error) {
      payload = { parseError: true, rawText: text };
    }

    const rawPath = path.join(logDir, `${endpoint.key}.raw.json`);
    fs.writeFileSync(rawPath, JSON.stringify(payload, null, 2), 'utf8');

    const rows = asArray(payload);
    const symbols = new Set();
    const publishers = new Set();
    let timestampCount = 0;
    let publishedDateCount = 0;
    let titleCount = 0;
    let publisherOrSiteCount = 0;

    for (const row of rows) {
      const symbolHit = extractWithCandidates(row, endpoint.symbolCandidates);
      if (symbolHit?.value) {
        symbols.add(String(symbolHit.value).toUpperCase());
      }
      const timestampHit = extractWithCandidates(row, endpoint.timestampCandidates);
      if (timestampHit?.value) {
        timestampCount += 1;
      }

      if (endpoint.validationType === 'macro-based') {
        const publishedDateHit = extractWithCandidates(row, endpoint.macroCandidates.publishedDate);
        if (publishedDateHit?.value) publishedDateCount += 1;

        const titleHit = extractWithCandidates(row, endpoint.macroCandidates.title);
        if (titleHit?.value) titleCount += 1;

        const publisherOrSiteHit = extractWithCandidates(row, endpoint.macroCandidates.publisherOrSite);
        if (publisherOrSiteHit?.value) {
          publisherOrSiteCount += 1;
          publishers.add(String(publisherOrSiteHit.value).trim().toLowerCase());
        }
      }
    }

    const endpointReport = {
      key: endpoint.key,
      validation_type: endpoint.validationType,
      httpStatus: response.status,
      rowCount: rows.length,
      uniqueSymbols: symbols.size,
      timestampCount,
      rawPath,
    };

    if (endpoint.validationType === 'symbol-based') {
      endpointReport.checks = {
        nonEmptyArray: rows.length > 0,
        uniqueSymbolsGte11: symbols.size > 10,
        timestampsExist: timestampCount > 0,
      };
      endpointReport.passed = response.ok
        && endpointReport.checks.nonEmptyArray
        && endpointReport.checks.uniqueSymbolsGte11
        && endpointReport.checks.timestampsExist;
    } else {
      endpointReport.uniquePublishers = publishers.size;
      endpointReport.fieldCoverage = {
        publishedDateCount,
        titleCount,
        publisherOrSiteCount,
      };
      endpointReport.checks = {
        nonEmptyArray: rows.length > 0,
        publishedDateExists: publishedDateCount > 0,
        titleExists: titleCount > 0,
        publisherOrSiteExists: publisherOrSiteCount > 0,
        uniquePublishersGte5: publishers.size >= 5,
      };
      endpointReport.passed = response.ok
        && endpointReport.checks.nonEmptyArray
        && endpointReport.checks.publishedDateExists
        && endpointReport.checks.titleExists
        && endpointReport.checks.publisherOrSiteExists
        && endpointReport.checks.uniquePublishersGte5;
    }

    if (!endpointReport.passed) {
      summary.ok = false;
      endpointReport.failingConditions = Object.entries(endpointReport.checks)
        .filter((entry) => entry[1] === false)
        .map((entry) => entry[0]);
      endpointReport.sampleRows = getSampleRows(rows, 3);
    }

    summary.endpoints.push(endpointReport);
  }

  const summaryPath = path.join(logDir, 'validation-summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');

  console.log(JSON.stringify(summary, null, 2));
  console.log(`[STRICT] Wrote ${summaryPath}`);

  if (!summary.ok) {
    console.error('[STRICT] One or more endpoint validations failed.');
    process.exit(2);
  }
}

main().catch((error) => {
  console.error('[STRICT] Fatal validation error:', error?.message || error);
  process.exit(1);
});
