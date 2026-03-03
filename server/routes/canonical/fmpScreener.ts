// @ts-nocheck
const express = require('express');
const axios = require('axios');
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

function loadMapFmpQuoteToCanonical() {
  const adapterPath = path.join(__dirname, '../../providers/adapters/fmpAdapter.ts');
  return loadTsNamedExport(adapterPath, 'mapFmpQuoteToCanonical');
}

const mapFmpQuoteToCanonical = loadMapFmpQuoteToCanonical();
const scoreQuote = loadTsNamedExport(
  path.join(__dirname, '../../engine/scoringEngine.ts'),
  'scoreQuote'
);
const validateCanonicalQuote = loadTsNamedExport(
  path.join(__dirname, '../../utils/dataIntegrityCheck.ts'),
  'validateCanonicalQuote'
);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchFmp(url) {
  const response = await axios.get(url, { timeout: 15000, validateStatus: () => true });
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`FMP request failed with status ${response.status}`);
  }
  return Array.isArray(response.data) ? response.data : [];
}

async function fetchFmpSafe(url, fallback = []) {
  try {
    return await fetchFmp(url);
  } catch (error) {
    console.warn('[canonical/fmp-screener] upstream warning', {
      url,
      message: error?.message,
    });
    return fallback;
  }
}

async function fetchQuotesSequentially(symbols) {
  const results = [];

  for (const symbol of (Array.isArray(symbols) ? symbols : []).slice(0, 15)) {
    try {
      const response = await axios.get('https://financialmodelingprep.com/stable/quote', {
        timeout: 15000,
        validateStatus: () => true,
        params: {
          symbol,
          apikey: process.env.FMP_API_KEY,
        },
      });

      if (response.status >= 200 && response.status < 300 && response.data?.length > 0) {
        results.push(response.data[0]);
      }

      await sleep(250);
    } catch (_error) {
      console.warn(`Quote fetch failed for ${symbol}`);
      await sleep(250);
    }
  }

  return results;
}

router.get('/', async (_req, res) => {
  try {
    const includeScore = String(_req?.query?.includeScore ?? 'true').toLowerCase() !== 'false';

    const apiKey = process.env.FMP_API_KEY || '';
    if (!apiKey) {
      return res.status(500).json({ error: 'FMP_API_KEY missing' });
    }

    const newsUrl = `https://financialmodelingprep.com/stable/news/stock-latest?apikey=${apiKey}`;
    let rawNews = await fetchFmpSafe(newsUrl, []);
    if (!rawNews.length) {
      const newsFallbackUrl = `https://financialmodelingprep.com/stable/news/general-latest?apikey=${apiKey}`;
      rawNews = await fetchFmpSafe(newsFallbackUrl, []);
    }

    const symbols = Array.from(
      new Set(
        rawNews
          .map((item) => String(item?.symbol || '').trim().toUpperCase())
          .filter(Boolean)
      )
    ).slice(0, 15);

    if (!symbols.length) {
      return res.json({
        news: rawNews.map((item) => ({
          id: `fmp:${item?.symbol || 'unknown'}:${item?.publishedDate || Date.now()}`,
          headline: String(item?.title || ''),
          source: String(item?.site || 'FMP'),
          publishedAt: item?.publishedDate ? new Date(item.publishedDate).toISOString() : new Date().toISOString(),
          tickers: item?.symbol ? [String(item.symbol).toUpperCase()] : [],
        })),
        symbols: [],
        quotes: [],
      });
    }

    const rawQuotes = await fetchQuotesSequentially(symbols);

    console.log('Symbols requested:', symbols.length);
    console.log('Raw quote count:', rawQuotes.length);
    console.log('Sample raw quote:', rawQuotes[0]);

    const canonicalNews = rawNews.map((item) => ({
      id: `fmp:${item?.symbol || 'unknown'}:${item?.publishedDate || Date.now()}`,
      headline: String(item?.title || ''),
      source: String(item?.site || 'FMP'),
      publishedAt: item?.publishedDate ? new Date(item.publishedDate).toISOString() : new Date().toISOString(),
      tickers: item?.symbol ? [String(item.symbol).toUpperCase()] : [],
    }));

    const canonicalQuotes = rawQuotes.map(mapFmpQuoteToCanonical);

    canonicalQuotes.forEach((quote) => {
      validateCanonicalQuote(quote);
    });

    const enrichedQuotes = includeScore
      ? canonicalQuotes.map((quote) => {
          const relatedNews = canonicalNews.filter(
            (item) => Array.isArray(item?.tickers) && item.tickers.includes(quote.symbol)
          );
          return {
            ...quote,
            score: scoreQuote({
              quote,
              news: relatedNews,
            }),
          };
        })
      : canonicalQuotes;

    return res.json({
      news: canonicalNews,
      symbols,
      quotes: enrichedQuotes,
    });
  } catch (error) {
    return res.status(500).json({
      error: 'CANONICAL_FMP_SCREENER_ERROR',
      message: error?.message || 'Unknown error',
    });
  }
});

module.exports = router;
