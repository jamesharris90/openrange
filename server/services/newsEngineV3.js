const axios = require('axios');
const crypto = require('crypto');
const pool = require('../pg');

const FMP_BASE_URL = 'https://financialmodelingprep.com/stable/news/stock-latest';
const FMP_QUOTE_URL = 'https://financialmodelingprep.com/stable/quote';
const FMP_PROFILE_URL = 'https://financialmodelingprep.com/stable/profile';
const MAX_CONCURRENCY = 10;
const SYMBOL_METADATA_TTL_MS = 5 * 60 * 1000;

const SOURCE_WEIGHTS = {
  benzinga: 8,
  marketwatch: 7,
  'seeking alpha': 7,
  reuters: 9,
  bloomberg: 9,
  'business wire': 6,
  zacks: 5,
};

const KEYWORD_CLUSTERS = [
  {
    bucket: 'high',
    score: 10,
    terms: [
      'beats expectations',
      'beats earnings expectations',
      'raises guidance',
      'fda approval',
      'merger agreement',
      'acquisition',
      'bankruptcy',
      'wins contract',
    ],
  },
  {
    bucket: 'medium',
    score: 6,
    terms: [
      'upgrade',
      'price target raised',
      'outperform',
      'insider buying',
      'expansion',
      'product launch',
    ],
  },
  {
    bucket: 'low',
    score: 3,
    terms: [
      'analysis',
      'opinion',
      'preview',
      'could',
      'might',
      'rumor',
      'rumour',
    ],
  },
];

const CATALYST_PATTERNS = {
  earnings: [/beat\w* expectations/i],
  guidance: [/raises guidance/i],
  merger: [/merger agreement|acquisition/i],
  fda: [/fda approval/i],
  contract: [/wins contract/i],
  offering: [/offering|secondary offering|public offering|dilution/i],
  analyst: [/upgrade|price target raised|outperform|insider buying/i],
};

const symbolMetadataCache = new Map();

function normalizeSymbols(symbols) {
  return Array.from(
    new Set(
      (Array.isArray(symbols) ? symbols : [])
        .map((value) => String(value || '').trim().toUpperCase())
        .filter(Boolean)
    )
  );
}

function hashId(url, symbol, headline, publishedAt) {
  const seed = String(url || `${symbol}|${headline || ''}|${publishedAt || ''}`);
  return crypto.createHash('sha256').update(seed).digest('hex');
}

function hashToUuid(value) {
  const hex = crypto.createHash('md5').update(String(value || '')).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function computeRecencyScore(publishedAt, nowTs = Date.now()) {
  const ts = new Date(publishedAt).getTime();
  if (!Number.isFinite(ts)) return 1;
  const diffMinutes = (nowTs - ts) / 60000;
  if (diffMinutes < 30) return 10;
  if (diffMinutes < 120) return 8;
  if (diffMinutes < 360) return 6;
  if (diffMinutes < 1440) return 4;
  return 1;
}

function computeSourceScore(source) {
  const normalized = String(source || '').trim().toLowerCase();
  if (!normalized) return 4;
  const matchedKey = Object.keys(SOURCE_WEIGHTS).find((key) => normalized.includes(key));
  return matchedKey ? SOURCE_WEIGHTS[matchedKey] : 4;
}

function computeKeywordScore(headline, text) {
  const blob = `${String(headline || '')} ${String(text || '')}`.toLowerCase();
  let score = 0;
  const matchedTerms = [];
  const breakdown = {
    keyword_high_impact_score: 0,
    keyword_medium_impact_score: 0,
    keyword_low_impact_score: 0,
  };

  for (const cluster of KEYWORD_CLUSTERS) {
    for (const term of cluster.terms) {
      if (blob.includes(term)) {
        score += cluster.score;
        matchedTerms.push(term);
        if (cluster.bucket === 'high') breakdown.keyword_high_impact_score += cluster.score;
        if (cluster.bucket === 'medium') breakdown.keyword_medium_impact_score += cluster.score;
        if (cluster.bucket === 'low') breakdown.keyword_low_impact_score += cluster.score;
      }
    }
  }

  return {
    score,
    matchedTerms: Array.from(new Set(matchedTerms)),
    breakdown,
  };
}

function detectCatalystTags(headline, text) {
  const blob = `${String(headline || '')} ${String(text || '')}`;
  const tags = Object.entries(CATALYST_PATTERNS)
    .filter(([, patterns]) => patterns.some((pattern) => pattern.test(blob)))
    .map(([tag]) => tag);

  if (tags.length === 0) return ['general'];
  return Array.from(new Set(tags));
}

function computeAnalystBoost(headline) {
  const value = String(headline || '').toLowerCase();
  const hasUpgradeOrRaise = value.includes('upgrade') || value.includes('raises');
  const hasBuyOrOutperform = value.includes('buy') || value.includes('outperform');
  return hasUpgradeOrRaise && hasBuyOrOutperform ? 6 : 0;
}

function computeSymbolRelevanceScore(symbol, headline, text, payloadSymbol) {
  const normalizedSymbol = String(symbol || '').toUpperCase();
  const payloadSymbolNormalized = String(payloadSymbol || '').toUpperCase();
  const blob = `${String(headline || '')} ${String(text || '')}`.toUpperCase();

  if (!normalizedSymbol) return 0;
  if (payloadSymbolNormalized === normalizedSymbol) return 10;
  if (blob.includes(normalizedSymbol)) return 10;
  return 0;
}

function scoreNewsItem({ symbol, headline, text, source, publishedAt, payloadSymbol, nowTs = Date.now() }) {
  const recencyScore = computeRecencyScore(publishedAt, nowTs);
  const sourceScore = computeSourceScore(source);
  const keyword = computeKeywordScore(headline, text);
  const symbolRelevanceScore = computeSymbolRelevanceScore(symbol, headline, text, payloadSymbol);
  const analystBoostScore = computeAnalystBoost(headline);
  const totalScore = Math.max(0, recencyScore + sourceScore + keyword.score + symbolRelevanceScore + analystBoostScore);

  const catalystTags = detectCatalystTags(headline, text);

  return {
    newsScore: totalScore,
    scoreBreakdown: {
      recency_score: recencyScore,
      source_score: sourceScore,
      keyword_score: keyword.score,
      symbol_relevance_score: symbolRelevanceScore,
      analyst_boost_score: analystBoostScore,
      reinforcement_score: 0,
      ...keyword.breakdown,
    },
    catalystTags,
    keywordTerms: keyword.matchedTerms,
  };
}

function applyReinforcementScores(rows, nowTs = Date.now()) {
  const cutoff = nowTs - (2 * 60 * 60 * 1000);
  const symbolCounts = new Map();

  for (const row of rows) {
    const symbol = String(row?.symbol || '').toUpperCase();
    const ts = new Date(row?.publishedAt).getTime();
    if (!symbol || !Number.isFinite(ts) || ts < cutoff) continue;
    symbolCounts.set(symbol, (symbolCounts.get(symbol) || 0) + 1);
  }

  return rows.map((row) => {
    const symbol = String(row?.symbol || '').toUpperCase();
    const reinforcement = (symbolCounts.get(symbol) || 0) >= 2 ? 4 : 0;
    const existingBreakdown = row?.score_breakdown || {};
    const baseScore = Number(row?.news_score || 0);

    return {
      ...row,
      news_score: baseScore + reinforcement,
      score_breakdown: {
        ...existingBreakdown,
        reinforcement_score: reinforcement,
      },
    };
  });
}

function mergeSymbolMetadata(quoteRows = [], profileRows = []) {
  const merged = new Map();

  for (const quote of quoteRows) {
    const symbol = String(quote?.symbol || '').toUpperCase();
    if (!symbol) continue;
    merged.set(symbol, {
      symbol,
      price: Number.isFinite(Number(quote?.price)) ? Number(quote.price) : null,
      marketCap: Number.isFinite(Number(quote?.marketCap)) ? Number(quote.marketCap) : null,
      sector: null,
    });
  }

  for (const profile of profileRows) {
    const symbol = String(profile?.symbol || '').toUpperCase();
    if (!symbol) continue;
    const current = merged.get(symbol) || { symbol, price: null, marketCap: null, sector: null };
    current.sector = String(profile?.sector || '').trim() || null;
    if (!Number.isFinite(Number(current.marketCap)) && Number.isFinite(Number(profile?.marketCap))) {
      current.marketCap = Number(profile.marketCap);
    }
    merged.set(symbol, current);
  }

  return merged;
}

async function fetchSymbolMetadata(symbols) {
  const normalized = normalizeSymbols(symbols);
  if (normalized.length === 0) return new Map();

  const now = Date.now();
  const result = new Map();
  const missing = [];

  for (const symbol of normalized) {
    const cached = symbolMetadataCache.get(symbol);
    if (cached && now - cached.ts < SYMBOL_METADATA_TTL_MS) {
      result.set(symbol, cached.data);
    } else {
      missing.push(symbol);
    }
  }

  if (missing.length > 0) {
    const apiKey = process.env.FMP_API_KEY || process.env.FMP_KEY || '';
    if (apiKey) {
      const [quotesResponse, profilesResponse] = await Promise.all([
        axios.get(FMP_QUOTE_URL, {
          params: { symbol: missing.join(','), apikey: apiKey },
          timeout: 15000,
        }),
        axios.get(FMP_PROFILE_URL, {
          params: { symbol: missing.join(','), apikey: apiKey },
          timeout: 15000,
        }),
      ]);

      const quoteRows = Array.isArray(quotesResponse.data) ? quotesResponse.data : [];
      const profileRows = Array.isArray(profilesResponse.data) ? profilesResponse.data : [];
      const merged = mergeSymbolMetadata(quoteRows, profileRows);

      for (const symbol of missing) {
        const data = merged.get(symbol) || { symbol, price: null, marketCap: null, sector: null };
        symbolMetadataCache.set(symbol, { ts: now, data });
        result.set(symbol, data);
      }
    } else {
      for (const symbol of missing) {
        const data = { symbol, price: null, marketCap: null, sector: null };
        symbolMetadataCache.set(symbol, { ts: now, data });
        result.set(symbol, data);
      }
    }
  }

  return result;
}

function normalizeNewsItem(rawItem, requestedSymbol) {
  const symbol = String(rawItem?.symbol || requestedSymbol || '').toUpperCase();
  const headline = String(rawItem?.title || rawItem?.headline || '').trim();
  const source = String(rawItem?.site || rawItem?.source || '').trim();
  const publishedAt = rawItem?.publishedDate || rawItem?.publishedAt || null;
  const image = rawItem?.image || null;
  const url = rawItem?.url || rawItem?.link || null;
  const text = rawItem?.text || rawItem?.content || '';

  const scored = scoreNewsItem({
    symbol,
    headline,
    text,
    source,
    publishedAt,
    payloadSymbol: rawItem?.symbol,
  });

  const canonical = {
    id: hashToUuid(hashId(url, symbol, headline, publishedAt)),
    symbol,
    headline,
    source,
    publishedAt,
    image,
    url,
    raw_payload: rawItem,
    news_score: scored.newsScore,
    score_breakdown: scored.scoreBreakdown,
    catalyst_tags: scored.catalystTags,
  };

  return canonical;
}

async function fetchForSymbolsChunk(symbolsChunk, limit = 10) {
  const apiKey = process.env.FMP_API_KEY || process.env.FMP_KEY || '';
  const scopedSet = new Set(symbolsChunk.map((value) => String(value || '').toUpperCase()));
  const requestLimit = Math.max(limit * symbolsChunk.length * 20, 100);
  const response = await axios.get(FMP_BASE_URL, {
    params: {
      symbols: symbolsChunk.join(','),
      limit: requestLimit,
      apikey: apiKey,
    },
    timeout: 15000,
  });
  const rows = Array.isArray(response.data) ? response.data : [];
  const scoped = rows.filter((item) => scopedSet.has(String(item?.symbol || '').toUpperCase()));

  const bySymbol = new Map();
  for (const item of scoped) {
    const symbol = String(item?.symbol || '').toUpperCase();
    if (!bySymbol.has(symbol)) bySymbol.set(symbol, []);
    const list = bySymbol.get(symbol);
    if (list.length < limit) list.push(item);
  }

  const limited = [];
  bySymbol.forEach((items) => limited.push(...items));
  return limited.map((item) => normalizeNewsItem(item, item?.symbol));
}

async function fetchFmpNewsForSymbols(symbols, limitPerSymbol = 10) {
  const normalizedSymbols = normalizeSymbols(symbols);
  const all = [];

  for (let index = 0; index < normalizedSymbols.length; index += MAX_CONCURRENCY) {
    const chunk = normalizedSymbols.slice(index, index + MAX_CONCURRENCY);
    const rows = await fetchForSymbolsChunk(chunk, limitPerSymbol);
    all.push(...rows);
  }

  return all;
}

async function cleanupOldNews() {
  await pool.query("DELETE FROM news_articles WHERE created_at < NOW() - INTERVAL '30 days'");
}

async function insertCanonicalNewsRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { attempted: 0, inserted: 0 };
  }

  await cleanupOldNews();

  let inserted = 0;

  for (const row of rows) {
    const result = await pool.query(
      `INSERT INTO news_articles (
        id,
        headline,
        symbols,
        source,
        url,
        published_at,
        summary,
        catalyst_type,
        news_score,
        score_breakdown,
        raw_payload
      ) VALUES (
        $1, $2, $3::text[], $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb
      )
      ON CONFLICT (id) DO NOTHING`,
      [
        row.id,
        row.headline,
        [row.symbol],
        row.source,
        row.url,
        row.publishedAt,
        String(row.raw_payload?.text || row.raw_payload?.content || '').slice(0, 2000),
        row.catalyst_tags?.[0] || null,
        row.news_score,
        JSON.stringify({ ...(row.score_breakdown || {}), catalyst_tags: row.catalyst_tags || [] }),
        JSON.stringify(row.raw_payload || {}),
      ]
    );

    inserted += result.rowCount || 0;
  }

  return {
    attempted: rows.length,
    inserted,
  };
}

async function refreshNewsForSymbols(symbols, limitPerSymbol = 10) {
  const canonicalRows = await fetchFmpNewsForSymbols(symbols, limitPerSymbol);
  const write = await insertCanonicalNewsRows(canonicalRows);
  return {
    symbols: normalizeSymbols(symbols),
    fetched: canonicalRows.length,
    inserted: write.inserted,
    attempted: write.attempted,
  };
}

module.exports = {
  applyReinforcementScores,
  fetchSymbolMetadata,
  fetchFmpNewsForSymbols,
  refreshNewsForSymbols,
  scoreNewsItem,
};
