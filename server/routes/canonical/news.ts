// @ts-nocheck
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const fmpService = require('../../services/fmpService');

const router = express.Router();
const NEWS_CACHE_TTL_MS = 60 * 1000;
let canonicalNewsCache = { data: null, ts: 0 };
let lastFmpStatusCode = null;

function loadMapFmpNewsToCanonical() {
  const adapterPath = path.join(__dirname, '../../providers/adapters/fmpAdapter.ts');
  const source = fs.readFileSync(adapterPath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: adapterPath,
  }).outputText;

  const moduleLike = { exports: {} };
  const exportsLike = moduleLike.exports;
  const fn = new Function('require', 'module', 'exports', '__dirname', '__filename', transpiled);
  fn(require, moduleLike, exportsLike, path.dirname(adapterPath), adapterPath);

  if (typeof moduleLike.exports.mapFmpNewsToCanonical !== 'function') {
    throw new Error('mapFmpNewsToCanonical not found in canonical adapter');
  }

  return moduleLike.exports.mapFmpNewsToCanonical;
}

const mapFmpNewsToCanonical = loadMapFmpNewsToCanonical();

async function fetchFmpNews() {
  if (typeof fmpService.fetchFmpNews === 'function') {
    const data = await fmpService.fetchFmpNews();
    lastFmpStatusCode = 200;
    if (Array.isArray(data)) {
      canonicalNewsCache = { data, ts: Date.now() };
    }
    return data;
  }

  const now = Date.now();
  if (canonicalNewsCache.data && now - canonicalNewsCache.ts < NEWS_CACHE_TTL_MS) {
    return canonicalNewsCache.data;
  }

  const apiKey = process.env.FMP_API_KEY || '';
  if (!apiKey) {
    throw new Error('FMP_API_KEY is not configured');
  }

  const url = `https://financialmodelingprep.com/stable/news/general-latest?apikey=${apiKey}`;
  let response;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = await axios.get(url, { timeout: 15000, validateStatus: () => true });
    lastFmpStatusCode = response.status;
    if (response.status !== 429) break;
    await new Promise((resolve) => setTimeout(resolve, 300 * (2 ** attempt)));
  }

  if (response.status < 200 || response.status >= 300) {
    if (canonicalNewsCache.data) {
      return canonicalNewsCache.data;
    }
    throw new Error(`FMP news request failed with status ${response.status}`);
  }

  const data = Array.isArray(response.data) ? response.data : [];
  canonicalNewsCache = { data, ts: Date.now() };
  return data;
}

router.get('/', async (_req, res) => {
  try {
    const rawNews = await fetchFmpNews();
    const providerRows = Array.isArray(rawNews) ? rawNews : [];

    console.info('[canonical/news] provider response', {
      statusCode: lastFmpStatusCode,
      length: providerRows.length,
    });

    const canonicalNews = providerRows.map((item, idx) => {
      const mapped = mapFmpNewsToCanonical(item || {});

      const undefinedFields = [];
      if (mapped.id === undefined) undefinedFields.push('id');
      if (mapped.headline === undefined) undefinedFields.push('headline');
      if (mapped.source === undefined) undefinedFields.push('source');
      if (mapped.publishedAt === undefined) undefinedFields.push('publishedAt');
      if (mapped.tickers === undefined) undefinedFields.push('tickers');

      if (undefinedFields.length > 0) {
        console.warn('[canonical/news] undefined mapped fields', {
          index: idx,
          fields: undefinedFields,
        });
      }

      return mapped;
    });

    res.json(canonicalNews);
  } catch (error) {
    console.error('[canonical/news] failed', {
      statusCode: lastFmpStatusCode,
      message: error?.message,
    });

    if (canonicalNewsCache.data && Array.isArray(canonicalNewsCache.data)) {
      return res.json([]);
    }

    return res.status(500).json({
      error: 'CANONICAL_NEWS_ERROR',
      message: error?.message || 'Unknown error',
    });
  }
});

module.exports = router;
