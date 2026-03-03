// @ts-nocheck
const express = require('express');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const { fetchStockList, fetchQuotesBatch } = require('../../services/fmpService');

const router = express.Router();

const ALLOWED_EXCHANGES = new Set(['NASDAQ', 'NYSE', 'AMEX', 'CBOE']);
const MAX_PAGE_SIZE = 100;

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

const mapFmpQuoteToCanonical = loadTsNamedExport(
  path.join(__dirname, '../../providers/adapters/fmpAdapter.ts'),
  'mapFmpQuoteToCanonical'
);
const scoreQuote = loadTsNamedExport(
  path.join(__dirname, '../../engine/scoringEngine.ts'),
  'scoreQuote'
);
const validateCanonicalQuote = loadTsNamedExport(
  path.join(__dirname, '../../utils/dataIntegrityCheck.ts'),
  'validateCanonicalQuote'
);

function normalizeExchange(item) {
  return String(item?.exchangeShortName || item?.exchange || '').trim().toUpperCase();
}

function isExcludedInstrument(item) {
  const type = String(item?.type || '').toLowerCase();
  const name = String(item?.name || item?.companyName || '').toLowerCase();
  const symbol = String(item?.symbol || '').toUpperCase();

  if (type.includes('etf') || type.includes('fund') || type.includes('warrant') || type.includes('right')) {
    return true;
  }

  if (
    name.includes(' etf') ||
    name.includes('exchange traded fund') ||
    name.includes(' fund') ||
    name.includes('trust') ||
    name.includes('warrant') ||
    name.includes('rights')
  ) {
    return true;
  }

  if (
    symbol.endsWith('W') ||
    symbol.endsWith('WRT') ||
    symbol.endsWith('R') ||
    symbol.endsWith('U') ||
    symbol.includes('-W') ||
    symbol.includes('.W') ||
    symbol.includes('-R') ||
    symbol.includes('.R') ||
    symbol.includes('-U') ||
    symbol.includes('.U')
  ) {
    return true;
  }

  return false;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function compareValues(a, b, order) {
  const an = Number(a);
  const bn = Number(b);
  const safeA = Number.isFinite(an) ? an : Number.NEGATIVE_INFINITY;
  const safeB = Number.isFinite(bn) ? bn : Number.NEGATIVE_INFINITY;
  return order === 'asc' ? safeA - safeB : safeB - safeA;
}

function getUniverseSortValue(row, sortField) {
  if (sortField === 'marketCap') return row?.marketCap;
  if (sortField === 'volume') return row?.volume;
  return row?.price;
}

router.get('/', async (req, res) => {
  try {
    const page = parsePositiveInt(req.query.page, 1);
    const requestedPageSize = parsePositiveInt(req.query.pageSize, 50);
    const pageSize = Math.min(requestedPageSize, MAX_PAGE_SIZE);
    const sort = String(req.query.sort || 'price');
    const order = String(req.query.order || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
    const includeScore = String(req.query.includeScore ?? 'true').toLowerCase() !== 'false';

    if (!process.env.FMP_API_KEY) {
      return res.status(500).json({ error: 'FMP_API_KEY missing' });
    }

    const rawRows = await fetchStockList();

    const filteredRows = rawRows.filter((item) => {
      const symbol = String(item?.symbol || '').trim().toUpperCase();
      const exchange = normalizeExchange(item);
      const price = Number(item?.price);

      if (!symbol) return false;
      if (!ALLOWED_EXCHANGES.has(exchange)) return false;
      if (!Number.isFinite(price) || price <= 0) return false;
      if (isExcludedInstrument(item)) return false;
      return true;
    });

    const universeOrderedRows = (sort === 'price' || sort === 'volume' || sort === 'marketCap')
      ? [...filteredRows].sort((a, b) => compareValues(getUniverseSortValue(a, sort), getUniverseSortValue(b, sort), order))
      : filteredRows;

    const symbols = Array.from(
      new Set(universeOrderedRows.map((item) => String(item.symbol || '').trim().toUpperCase()).filter(Boolean))
    );

    const fullUniverseCount = symbols.length;
    const offset = (page - 1) * pageSize;
    const pagedSymbols = symbols.slice(offset, offset + pageSize);

    if (!pagedSymbols.length) {
      return res.json({
        total: fullUniverseCount,
        page,
        pageSize,
        data: [],
      });
    }

    const rawQuotes = await fetchQuotesBatch(pagedSymbols);

    const canonicalQuotes = rawQuotes.map((quote) => {
      const mapped = mapFmpQuoteToCanonical(quote);
      validateCanonicalQuote(mapped);

      if (!includeScore) return mapped;

      return {
        ...mapped,
        score: scoreQuote({ quote: mapped }),
      };
    });

    const sortedQuotes = [...canonicalQuotes].sort((a, b) => {
      if (sort === 'rvol') return compareValues(a?.rvol, b?.rvol, order);
      if (sort === 'compositeScore') return compareValues(a?.score?.compositeScore, b?.score?.compositeScore, order);
      if (sort === 'volume') return compareValues(a?.volume, b?.volume, order);
      if (sort === 'marketCap') return compareValues(a?.marketCap, b?.marketCap, order);
      return compareValues(a?.price, b?.price, order);
    });

    return res.json({
      total: fullUniverseCount,
      page,
      pageSize,
      data: sortedQuotes,
    });
  } catch (error) {
    return res.status(500).json({
      error: 'CANONICAL_UNIVERSE_ERROR',
      message: error?.message || 'Unknown error',
    });
  }
});

module.exports = router;
