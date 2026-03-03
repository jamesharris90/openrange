const express = require('express');
const pool = require('../pg');
const { applyReinforcementScores, fetchSymbolMetadata, refreshNewsForSymbols } = require('../services/newsEngineV3');

const router = express.Router();
const VALID_CATALYSTS = new Set(['earnings', 'guidance', 'merger', 'fda', 'contract', 'offering', 'analyst', 'general']);

function parseNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseFreshnessToTimestamp(value, nowTs = Date.now()) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;

  const match = raw.match(/^(\d+)([mh])$/);
  if (!match) return null;

  const qty = Number(match[1]);
  const unit = match[2];
  if (!Number.isFinite(qty) || qty <= 0) return null;

  const deltaMs = unit === 'm' ? qty * 60 * 1000 : qty * 60 * 60 * 1000;
  return new Date(nowTs - deltaMs).toISOString();
}

function parseSymbols(value) {
  return Array.from(
    new Set(
      String(value || '')
        .split(',')
        .map((part) => part.trim().toUpperCase())
        .filter(Boolean)
    )
  );
}

function mapRowToCanonical(row) {
  const breakdown = row.score_breakdown || {};
  const catalystTags = Array.isArray(breakdown.catalyst_tags) ? breakdown.catalyst_tags : [];
  return {
    id: row.id,
    symbol: Array.isArray(row.symbols) && row.symbols.length ? row.symbols[0] : null,
    headline: row.headline,
    source: row.source,
    publishedAt: row.published_at,
    image: row.raw_payload?.image || null,
    url: row.url,
    raw_payload: row.raw_payload,
    news_score: row.news_score,
    score_breakdown: {
      recency_score: breakdown.recency_score ?? 0,
      source_score: breakdown.source_score ?? 0,
      keyword_score: breakdown.keyword_score ?? 0,
      symbol_relevance_score: breakdown.symbol_relevance_score ?? 0,
      analyst_boost_score: breakdown.analyst_boost_score ?? 0,
      reinforcement_score: breakdown.reinforcement_score ?? 0,
      keyword_high_impact_score: breakdown.keyword_high_impact_score ?? 0,
      keyword_medium_impact_score: breakdown.keyword_medium_impact_score ?? 0,
      keyword_low_impact_score: breakdown.keyword_low_impact_score ?? 0,
    },
    catalyst_tags: catalystTags,
  };
}

router.get('/api/news/v3', async (req, res) => {
  try {
    const symbols = parseSymbols(req.query.symbols);
    const minScore = parseNumber(req.query.minScore);
    const maxScore = parseNumber(req.query.maxScore);
    const freshnessTs = parseFreshnessToTimestamp(req.query.freshness);
    const catalyst = String(req.query.catalyst || '').trim().toLowerCase();
    const priceMin = parseNumber(req.query.priceMin);
    const priceMax = parseNumber(req.query.priceMax);
    const sector = String(req.query.sector || '').trim().toLowerCase();
    const marketCapMin = parseNumber(req.query.marketCapMin);
    const marketCapMax = parseNumber(req.query.marketCapMax);
    const sort = String(req.query.sort || 'recency').toLowerCase() === 'score' ? 'score' : 'recency';
    const rawLimit = Number.parseInt(req.query.limit, 10);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : 50;

    if (catalyst && !VALID_CATALYSTS.has(catalyst)) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid catalyst. Use one of: earnings, guidance, merger, fda, contract, offering, analyst, general',
      });
    }

    // Build separate WHERE clauses for news_articles (scored) and news_events (raw 1.3M rows)
    const articlesWhere = [];
    const eventsWhere = [];
    const values = [];
    let idx = 1;

    if (symbols.length > 0) {
      articlesWhere.push(`symbols && $${idx}::text[]`);
      eventsWhere.push(`symbol = ANY($${idx}::text[])`);
      values.push(symbols);
      idx += 1;
    }

    if (minScore != null) {
      articlesWhere.push(`news_score >= $${idx}`);
      values.push(minScore);
      idx += 1;
    }

    if (maxScore != null) {
      articlesWhere.push(`news_score <= $${idx}`);
      values.push(maxScore);
      idx += 1;
    }

    if (freshnessTs) {
      articlesWhere.push(`published_at >= $${idx}`);
      eventsWhere.push(`published_at >= $${idx}`);
      values.push(freshnessTs);
      idx += 1;
    }

    if (catalyst) {
      articlesWhere.push(`(
        catalyst_type = $${idx}
        OR score_breakdown->'catalyst_tags' @> $${idx + 1}::jsonb
      )`);
      values.push(catalyst);
      values.push(JSON.stringify([catalyst]));
      idx += 2;
    }

    const articlesWhereSql = articlesWhere.length ? `WHERE ${articlesWhere.join(' AND ')}` : '';
    const eventsWhereSql = eventsWhere.length ? `WHERE ${eventsWhere.join(' AND ')}` : '';
    const orderSql = sort === 'score'
      ? 'ORDER BY news_score DESC, published_at DESC'
      : 'ORDER BY published_at DESC, news_score DESC';

    const rowLimit = Math.max(limit * 20, 1000);
    values.push(rowLimit);

    // Include news_events (1.3M rows) unless score/catalyst filters are active (they have no score data)
    const includeEvents = !catalyst && minScore == null && maxScore == null;

    let sql;
    if (includeEvents) {
      sql = `
        SELECT id, symbols, headline, source, published_at, url, raw_payload, news_score, score_breakdown
        FROM (
          SELECT id::text, symbols, headline, source, published_at, url, raw_payload, news_score, score_breakdown
          FROM news_articles ${articlesWhereSql}
          UNION ALL
          SELECT
            md5(COALESCE(url, symbol || ':' || COALESCE(headline,'') || ':' || COALESCE(published_at::text,''))) AS id,
            ARRAY[symbol] AS symbols,
            headline, source, published_at, url,
            '{}'::jsonb AS raw_payload,
            0::numeric AS news_score,
            '{}'::jsonb AS score_breakdown
          FROM news_events ${eventsWhereSql}
        ) combined
        ${orderSql}
        LIMIT $${idx}`;
    } else {
      sql = `
        SELECT id::text, symbols, headline, source, published_at, url, raw_payload, news_score, score_breakdown
        FROM news_articles
        ${articlesWhereSql}
        ${orderSql}
        LIMIT $${idx}`;
    }

    const result = await pool.query(sql, values);

    const baseRows = (result.rows || []).map(mapRowToCanonical);
    const reinforcedRows = applyReinforcementScores(baseRows);

    // Deduplicate by URL — news_events and news_articles may contain the same article
    const seenKeys = new Set();
    const deduped = reinforcedRows.filter((row) => {
      const key = row.url || `${row.symbol}:${row.headline}`;
      if (seenKeys.has(key)) return false;
      seenKeys.add(key);
      return true;
    });

    const symbolsInRows = Array.from(new Set(deduped.map((row) => row.symbol).filter(Boolean)));
    const metadataBySymbol = await fetchSymbolMetadata(symbolsInRows);

    const filtered = deduped.filter((row) => {
      const meta = metadataBySymbol.get(String(row.symbol || '').toUpperCase()) || {};
      const price = Number.isFinite(Number(meta.price)) ? Number(meta.price) : null;
      const marketCap = Number.isFinite(Number(meta.marketCap)) ? Number(meta.marketCap) : null;
      const rowSector = String(meta.sector || '').trim().toLowerCase();

      if (priceMin != null && (price == null || price < priceMin)) return false;
      if (priceMax != null && (price == null || price > priceMax)) return false;
      if (marketCapMin != null && (marketCap == null || marketCap < marketCapMin)) return false;
      if (marketCapMax != null && (marketCap == null || marketCap > marketCapMax)) return false;
      if (sector && rowSector !== sector) return false;

      return true;
    });

    const sorted = filtered.sort((left, right) => {
      if (sort === 'score') {
        const byScore = Number(right.news_score || 0) - Number(left.news_score || 0);
        if (byScore !== 0) return byScore;
      }

      const rightTs = new Date(right.publishedAt || 0).getTime();
      const leftTs = new Date(left.publishedAt || 0).getTime();
      return rightTs - leftTs;
    });

    const data = sorted.slice(0, limit).map((row) => {
      const meta = metadataBySymbol.get(String(row.symbol || '').toUpperCase()) || {};
      return {
        ...row,
        price: Number.isFinite(Number(meta.price)) ? Number(meta.price) : null,
        marketCap: Number.isFinite(Number(meta.marketCap)) ? Number(meta.marketCap) : null,
        sector: String(meta.sector || '').trim() || null,
      };
    });

    res.json(data);
  } catch (err) {
    console.error('news v3 read error:', err);
    res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
});

router.post('/api/news/v3/refresh', async (req, res) => {
  try {
    const symbols = parseSymbols(req.query.symbols);
    if (symbols.length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'symbols query param is required',
      });
    }

    const result = await refreshNewsForSymbols(symbols, 10);

    res.json({
      ok: true,
      ...result,
    });
  } catch (err) {
    console.error('news v3 refresh error:', err);
    res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
});

module.exports = router;
