const express = require('express');
const {
  getCachedNewsFeedPayload,
  getCachedSymbolNewsPayload,
} = require('../services/experienceSnapshotService');

const router = express.Router();

const DIRECT_CATALYST_TYPES = new Set([
  'earnings',
  'earnings_beat',
  'earnings_miss',
  'merger',
  'acquisition',
  'spinoff',
  'fda_approval',
  'fda_rejection',
  'pdufa',
  'guidance_raised',
  'guidance_lowered',
  'analyst_upgrade',
  'analyst_downgrade',
  'price_target_change',
  'product_launch',
  'partnership',
  'sec_filing_8k',
]);

const SECTOR_KEYWORDS = /\b(sector|industry|peer|peers|competitor|competitors|semiconductor|chipmakers?|banks?|energy|biotech|pharma|retail|software)\b/i;
const MACRO_KEYWORDS = /\b(fed|federal reserve|rate|rates|inflation|cpi|ppi|gdp|unemployment|treasury|treasuries|recession|market-wide|markets|tariff|tariffs)\b/i;

function normalizeSymbol(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeSymbols(article) {
  const symbols = Array.isArray(article?.symbols)
    ? article.symbols.map(normalizeSymbol).filter(Boolean)
    : [];
  const symbol = normalizeSymbol(article?.symbol);
  return symbol && !symbols.includes(symbol) ? [symbol, ...symbols] : symbols;
}

function classifyArticle(article, requestedSymbol) {
  const catalystType = String(article?.catalyst_type || '').trim().toLowerCase();
  const symbols = normalizeSymbols(article);
  const symbol = normalizeSymbol(requestedSymbol);
  const text = [article?.title, article?.headline, article?.summary]
    .filter(Boolean)
    .join(' ')
    .trim();

  if (catalystType && DIRECT_CATALYST_TYPES.has(catalystType)) {
    return 'DIRECT_CATALYST';
  }

  if (symbol && symbols.includes(symbol)) {
    return 'SYMBOL_NEWS';
  }

  if (text && MACRO_KEYWORDS.test(text)) {
    return 'MACRO';
  }

  if (text && SECTOR_KEYWORDS.test(text)) {
    return 'SECTOR';
  }

  return 'SYMBOL_NEWS';
}

function classifyPayload(payload, requestedSymbol) {
  const classify = (article) => {
    const contextScope = classifyArticle(article, requestedSymbol);
    return {
      ...article,
      context_scope: contextScope,
      contextScope,
    };
  };

  if (Array.isArray(payload)) {
    return payload.map(classify);
  }

  const data = Array.isArray(payload?.data) ? payload.data.map(classify) : payload?.data;
  const articles = Array.isArray(payload?.articles) ? payload.articles.map(classify) : data;

  return {
    ...payload,
    data,
    articles,
  };
}

router.get('/', async (req, res) => {
  try {
    const directSymbol = String(req.query.symbol || req.query.symbols || '').trim();
    if (directSymbol) {
      const payload = await getCachedSymbolNewsPayload(directSymbol, req.query.limit);
      return res.json(classifyPayload(payload, directSymbol));
    }
    const payload = await getCachedNewsFeedPayload(req.query || {});
    return res.json(classifyPayload(payload, ''));
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
      data: [],
    });
  }
});

module.exports = router;