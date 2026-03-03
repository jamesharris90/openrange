// @ts-nocheck
const express = require('express');
const { Readable } = require('stream');
const { applyFilters } = require('../data-engine/filterEngine');
const { getStocksByBuckets } = require('../services/directoryServiceV1.ts');
const { getEnrichedUniverse } = require('../services/marketDataEngineV1.ts');

const router = express.Router();

const CANONICAL_EXPORT_FIELDS = [
  'symbol',
  'name',
  'price',
  'change',
  'changesPercentage',
  'changePercent',
  'volume',
  'avgVolume',
  'marketCap',

  'rvol',
  'dollarVolume',
  'gapPercent',
  'atrPercent',
  'atr',
  'rsi14',
  'sma20',
  'sma50',
  'sma200',

  'exchange',
  'sector',
  'industry',
  'country',

  'pe',
  'forwardPE',
  'pegRatio',
  'priceToSales',
  'priceToBook',

  'epsGrowthThisYear',
  'epsGrowthNextYear',
  'epsGrowthTTM',
  'salesGrowthQoq',
  'salesGrowthTTM',

  'roa',
  'roe',
  'roic',
  'grossMargin',
  'operatingMargin',
  'netProfitMargin',

  'insiderOwnership',
  'institutionalOwnership',
  'shortFloat',
  'analystRating',

  'high52Week',
  'low52Week',
  'highAllTime',
  'lowAllTime',
];

const DEFAULT_VISIBLE_FIELDS = [
  'symbol',
  'price',
  'changePercent',
  'structure',
  'structureGrade',
  'rvol',
  'gapPercent',
  'atrPercent',
  'volume',
  'marketCap',
];

function escapeCsvCell(value) {
  if (value == null) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  const escaped = text.replace(/"/g, '""');
  return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
}

function toNumberOrUndefined(value) {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function parseCsvList(value) {
  const raw = String(value || '').trim();
  if (!raw) return [];
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeBucketInput(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return ['common'];

  const values = parseCsvList(raw);
  if (values.includes('all')) {
    return ['common', 'etf', 'adr', 'preferred', 'other'];
  }

  const allowed = new Set(['common', 'etf', 'adr', 'preferred', 'other']);
  const parsed = values.filter((bucket) => allowed.has(bucket));
  return parsed.length ? Array.from(new Set(parsed)) : ['common'];
}

function parseFiltersFromRequest(query) {
  let fromPayload = {};
  if (query.filters) {
    try {
      fromPayload = JSON.parse(String(query.filters));
    } catch {
      fromPayload = {};
    }
  }

  const merged = {
    ...fromPayload,
    ...query,
  };

  const exchangeList = parseCsvList(merged.exchange || merged.exchanges)
    .map((item) => String(item).toUpperCase())
    .filter((item) => ['NASDAQ', 'NYSE', 'AMEX'].includes(item));

  return {
    minPrice: toNumberOrUndefined(merged.minPrice ?? merged.priceMin),
    maxPrice: toNumberOrUndefined(merged.maxPrice ?? merged.priceMax),
    minMarketCap: toNumberOrUndefined(merged.minMarketCap ?? merged.marketCapMin),
    maxMarketCap: toNumberOrUndefined(merged.maxMarketCap ?? merged.marketCapMax),
    minVolume: toNumberOrUndefined(merged.minVolume ?? merged.volumeMin),
    minChangePercent: toNumberOrUndefined(merged.minChangePercent),
    maxChangePercent: toNumberOrUndefined(merged.maxChangePercent),
    minRelativeVolume: toNumberOrUndefined(merged.minRelativeVolume ?? merged.rvolMin),
    maxRelativeVolume: toNumberOrUndefined(merged.maxRelativeVolume ?? merged.rvolMax),
    minGapPercent: toNumberOrUndefined(merged.minGapPercent ?? merged.gapMin),
    maxGapPercent: toNumberOrUndefined(merged.maxGapPercent ?? merged.gapMax),
    minRsi14: toNumberOrUndefined(merged.minRsi14),
    maxRsi14: toNumberOrUndefined(merged.maxRsi14),
    minDollarVolume: toNumberOrUndefined(merged.minDollarVolume),
    maxDollarVolume: toNumberOrUndefined(merged.maxDollarVolume),
    minAtrPercent: toNumberOrUndefined(merged.minAtrPercent),
    maxAtrPercent: toNumberOrUndefined(merged.maxAtrPercent),
    exchanges: exchangeList,
  };
}

function parseVisibleFields(query) {
  const visibleOnly = String(query.visibleOnly || '').toLowerCase() === 'true';
  if (!visibleOnly) return null;

  const custom = parseCsvList(query.visibleFields || query.columns);
  if (custom.length) return Array.from(new Set(custom));
  return DEFAULT_VISIBLE_FIELDS;
}

function buildFieldOrder(rows, forcedVisibleFields) {
  if (forcedVisibleFields) return forcedVisibleFields;

  const keySet = new Set();
  rows.forEach((row) => {
    Object.keys(row || {}).forEach((key) => keySet.add(key));
  });

  const remaining = Array.from(keySet)
    .filter((key) => !CANONICAL_EXPORT_FIELDS.includes(key))
    .sort((a, b) => a.localeCompare(b));

  const ordered = [
    ...CANONICAL_EXPORT_FIELDS,
    ...remaining,
  ];

  return ordered;
}

router.get('/export', async (req, res) => {
  try {
    const format = String(req.query.format || 'csv').toLowerCase();
    if (format !== 'csv') {
      return res.status(400).json({ error: 'Only csv format is supported' });
    }

    const enrichedUniverse = await getEnrichedUniverse();
    if (!Array.isArray(enrichedUniverse) || enrichedUniverse.length === 0) {
      return res.status(503).json({ error: 'Enriched universe unavailable' });
    }

    const selectedBuckets = normalizeBucketInput(req.query.bucket);
    const bucketStocks = await getStocksByBuckets(selectedBuckets);
    const allowedSymbols = new Set(bucketStocks.map((row) => String(row?.symbol || '').toUpperCase()));

    const bucketScoped = enrichedUniverse.filter((row) => allowedSymbols.has(String(row?.symbol || '').toUpperCase()));

    const screenerFilters = parseFiltersFromRequest(req.query || {});
    const filtered = applyFilters(bucketScoped, screenerFilters);

    const symbolSearch = String(req.query.symbol || '').trim().toUpperCase();
    const searched = symbolSearch
      ? filtered.filter((row) => String(row?.symbol || '').toUpperCase().includes(symbolSearch))
      : filtered;

    if (searched.length > 10000) {
      console.log('WARNING: Large export triggered');
    }

    const visibleFields = parseVisibleFields(req.query || {});
    const fieldOrder = buildFieldOrder(searched, visibleFields);

    console.log('Export Requested');
    console.log('Bucket:', selectedBuckets.join(','));
    console.log('Row Count:', searched.length);
    console.log('Fields Exported:', fieldOrder.length);

    const filename = `openrange_export_${Date.now()}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    async function* generateCsv() {
      yield `${fieldOrder.join(',')}\n`;
      for (const row of searched) {
        const line = fieldOrder.map((field) => escapeCsvCell(row?.[field])).join(',');
        yield `${line}\n`;
      }
    }

    const stream = Readable.from(generateCsv());
    stream.pipe(res);
  } catch (error) {
    return res.status(500).json({
      error: 'EXPORT_V1_ERROR',
      message: error?.message || 'Unknown error',
    });
  }
});

module.exports = router;
