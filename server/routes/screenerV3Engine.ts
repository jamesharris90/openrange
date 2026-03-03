// @ts-nocheck
const express = require('express');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const router = express.Router();

function loadTsNamedExport(filePath, exportName) {
  const source = fs.readFileSync(filePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: filePath,
  }).outputText;

  const moduleLike = { exports: {} };
  const exportsLike = moduleLike.exports;
  const fn = new Function('require', 'module', 'exports', '__dirname', '__filename', transpiled);
  fn(require, moduleLike, exportsLike, path.dirname(filePath), filePath);

  const loaded = moduleLike.exports?.[exportName];
  if (typeof loaded !== 'function') {
    throw new Error(`${exportName} not found in ${filePath}`);
  }

  return loaded;
}

const runTechnicalScreener = loadTsNamedExport(
  path.join(__dirname, '../services/screenerV3/technicalScreener.ts'),
  'runTechnicalScreener'
);

const runNewsScreener = loadTsNamedExport(
  path.join(__dirname, '../services/screenerV3/newsScreener.ts'),
  'runNewsScreener'
);

function toNumberOrUndefined(value) {
  if (value == null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function parsePositiveIntOrDefault(value, fallback) {
  if (value == null || value === '') return fallback;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function parseNonNegativeIntOrDefault(value, fallback) {
  if (value == null || value === '') return fallback;
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

function parseExchangeList(value, key = 'exchange') {
  const raw = String(value || '').trim();
  if (!raw) return undefined;

  const allowed = new Set(['NASDAQ', 'NYSE', 'AMEX']);
  const parsed = raw
    .split(',')
    .map((v) => v.trim().toUpperCase())
    .filter((v) => allowed.has(v));

  return parsed.length ? parsed : undefined;
}

function normalizeSearchTerm(value) {
  const raw = String(value || '').trim().toUpperCase();
  return raw || undefined;
}

function parseBucketList(value) {
  const raw = String(value || '').trim();
  if (!raw) return ['common'];

  const allowed = new Set(['common', 'etf', 'adr', 'preferred']);
  const parsed = raw
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .filter((v) => allowed.has(v));

  return parsed.length ? Array.from(new Set(parsed)) : ['common'];
}

router.get('/technical', async (req, res) => {
  try {
    const limit = parsePositiveIntOrDefault(req.query.limit, 100);
    const offset = parseNonNegativeIntOrDefault(req.query.offset, 0);
    const symbol = normalizeSearchTerm(req.query.symbol);
    const buckets = parseBucketList(req.query.bucket);

    const filters = {
      priceMin: toNumberOrUndefined(req.query.priceMin),
      priceMax: toNumberOrUndefined(req.query.priceMax),
      marketCapMin: toNumberOrUndefined(req.query.marketCapMin),
      marketCapMax: toNumberOrUndefined(req.query.marketCapMax),
      rvolMin: toNumberOrUndefined(req.query.rvolMin),
      rvolMax: toNumberOrUndefined(req.query.rvolMax),
      volumeMin: toNumberOrUndefined(req.query.volumeMin),
      gapMin: toNumberOrUndefined(req.query.gapMin),
      gapMax: toNumberOrUndefined(req.query.gapMax),
      exchange: parseExchangeList(req.query.exchange),
    };

    const results = await runTechnicalScreener({
      ...filters,
      symbolSearch: symbol,
      buckets,
    });
    const searched = symbol
      ? results.filter((row) => String(row?.symbol || '').toUpperCase().includes(symbol))
      : results;
    const total = searched.length;
    const paginated = searched.slice(offset, offset + limit);
    const data = paginated;

    console.log({
      totalBeforePagination: searched.length,
      limit,
      offset,
      returned: paginated.length,
    });

    return res.json({
      total,
      limit,
      offset,
      count: data.length,
      data,
    });
  } catch (error) {
    return res.status(500).json({
      error: 'SCREENER_V3_TECHNICAL_ERROR',
      message: error?.message || 'Unknown error',
    });
  }
});

router.get('/news', async (req, res) => {
  try {
    const limit = parsePositiveIntOrDefault(req.query.limit, 100);
    const offset = parseNonNegativeIntOrDefault(req.query.offset, 0);

    const filters = {
      hoursBack: toNumberOrUndefined(req.query.hoursBack),
      exchanges: parseExchangeList(req.query.exchanges),
      minMarketCap: toNumberOrUndefined(req.query.minMarketCap),
      minRvol: toNumberOrUndefined(req.query.minRvol),
    };

    const results = await runNewsScreener(filters);
    const total = results.length;
    const paginated = results.slice(offset, offset + limit);

    console.log({
      totalBeforePagination: results.length,
      limit,
      offset,
      returned: paginated.length,
    });

    return res.json({
      total,
      limit,
      offset,
      count: paginated.length,
      data: paginated,
    });
  } catch (error) {
    return res.status(500).json({
      error: 'SCREENER_V3_NEWS_ERROR',
      message: error?.message || 'Unknown error',
    });
  }
});

module.exports = router;
