const express = require('express');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');
const { fetchQuotesBatch } = require('../../services/fmpService');

const router = express.Router();

function loadMapFmpQuoteToCanonical() {
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

  if (typeof moduleLike.exports.mapFmpQuoteToCanonical !== 'function') {
    throw new Error('mapFmpQuoteToCanonical not found in canonical adapter');
  }

  return moduleLike.exports.mapFmpQuoteToCanonical;
}

function loadScoreQuote() {
  const enginePath = path.join(__dirname, '../../engine/scoringEngine.ts');
  const source = fs.readFileSync(enginePath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: enginePath,
  }).outputText;

  const moduleLike = { exports: {} };
  const exportsLike = moduleLike.exports;
  const fn = new Function('require', 'module', 'exports', transpiled);
  fn(require, moduleLike, exportsLike);

  return moduleLike.exports.scoreQuote;
}

function loadValidateCanonicalQuote() {
  const utilPath = path.join(__dirname, '../../utils/dataIntegrityCheck.ts');
  const source = fs.readFileSync(utilPath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
    fileName: utilPath,
  }).outputText;

  const moduleLike = { exports: {} };
  const exportsLike = moduleLike.exports;
  const fn = new Function('require', 'module', 'exports', transpiled);
  fn(require, moduleLike, exportsLike);

  return moduleLike.exports.validateCanonicalQuote;
}

const mapFmpQuoteToCanonical = loadMapFmpQuoteToCanonical();
const scoreQuote = loadScoreQuote();
const validateCanonicalQuote = loadValidateCanonicalQuote();

router.get('/', async (req, res) => {
  try {
    const { symbols } = req.query;
    const includeScore = String(req.query.includeScore || '').toLowerCase() === 'true';

    if (!symbols) {
      return res.status(400).json({ error: 'symbols query param required' });
    }

    const symbolList = String(symbols)
      .split(',')
      .map((symbol) => symbol.trim().toUpperCase())
      .filter(Boolean);

    if (!symbolList.length) {
      return res.status(400).json({ error: 'symbols query param required' });
    }

    const rawQuotes = await fetchQuotesBatch(symbolList);
    const canonicalQuotes = rawQuotes.map((quote) => {
      const mapped = mapFmpQuoteToCanonical(quote);
      validateCanonicalQuote(mapped);

      if (!includeScore) return mapped;

      return {
        ...mapped,
        score: scoreQuote({ quote: mapped }),
      };
    });

    return res.json(canonicalQuotes);
  } catch (_err) {
    return res.status(500).json({ error: 'Canonical quote fetch failed' });
  }
});

module.exports = router;
