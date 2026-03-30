'use strict';

/**
 * catalystAggregationEngine.js
 * Step 3 — Multi-day catalyst aggregation per symbol.
 *
 * Schema facts (verified 2026-03-30):
 *   news_articles.symbols  = ARRAY — use $1 = ANY(symbols)
 *   news_articles.symbol   = nullable text (secondary)
 *   news_articles.published_at = timestamp without time zone
 *   news_articles.catalyst_type = 'rss' | 'stock_news' | null
 *   news_articles.headline = primary text field
 *   news_articles.catalyst_cluster = optional grouping
 */

const { queryWithTimeout } = require('../db/pg');

// Catalyst type groupings derived from actual data
const CATALYST_GROUP_MAP = {
  earnings:  ['earnings', 'eps', 'revenue', 'quarterly'],
  offering:  ['offering', 'dilution', 'shares', 'secondary', 'registered', 'atm'],
  analyst:   ['upgrade', 'downgrade', 'initiate', 'price target', 'analyst', 'rating', 'buy', 'sell'],
  macro:     ['fed', 'cpi', 'inflation', 'rate', 'gdp', 'macro', 'economic', 'tariff', 'policy'],
};

function classifyHeadline(headline) {
  if (!headline) return 'other';
  const h = headline.toLowerCase();
  for (const [group, keywords] of Object.entries(CATALYST_GROUP_MAP)) {
    if (keywords.some(kw => h.includes(kw))) return group;
  }
  return 'other';
}

function buildNarrativeSummary(groupedCatalysts, primaryCatalyst) {
  const parts = [];

  if (primaryCatalyst) {
    const pc = primaryCatalyst;
    const ageH = Math.round((Date.now() - new Date(pc.published_at).getTime()) / 3_600_000);
    parts.push(`Primary catalyst (${pc.group}): "${pc.headline.slice(0, 120)}" — ${ageH}h ago.`);
  }

  const supportingCount = Object.values(groupedCatalysts)
    .flat()
    .length - (primaryCatalyst ? 1 : 0);

  if (supportingCount > 0) {
    const groups = Object.entries(groupedCatalysts)
      .filter(([, items]) => items.length > 0)
      .map(([group, items]) => `${items.length} ${group}`)
      .join(', ');
    parts.push(`Supporting: ${groups}.`);
  }

  if (parts.length === 0) {
    return 'No recent catalyst — move likely technical or stale.';
  }

  return parts.join(' ');
}

/**
 * Aggregate all news for a symbol over last 3 days, grouped by catalyst type.
 *
 * @param {string} symbol
 * @returns {Promise<{
 *   symbol: string,
 *   primary_catalyst: object|null,
 *   supporting_catalysts: object[],
 *   groups: object,
 *   narrative_summary: string,
 *   total_articles: number,
 *   status: string
 * }>}
 */
async function aggregateCatalysts(symbol) {
  if (!symbol || typeof symbol !== 'string') {
    return { symbol, status: 'INVALID_INPUT', primary_catalyst: null, supporting_catalysts: [], groups: {}, narrative_summary: 'Invalid symbol', total_articles: 0 };
  }

  const upperSymbol = symbol.toUpperCase().trim();

  let articles;
  try {
    const res = await queryWithTimeout(
      `SELECT id, headline, published_at, catalyst_type, catalyst_cluster,
              priority_score, sentiment, summary, source
       FROM news_articles
       WHERE published_at >= NOW() - INTERVAL '3 days'
         AND (
           $1 = ANY(symbols)
           OR symbol = $1
           OR $1 = ANY(detected_symbols)
         )
       ORDER BY published_at DESC`,
      [upperSymbol],
      { label: 'catalystAgg.fetch', timeoutMs: 10000 }
    );
    articles = res.rows;
  } catch (err) {
    console.error(`[CATALYST AGG ERROR] symbol=${upperSymbol} reason=${err.message}`);
    return {
      symbol: upperSymbol,
      status: 'DB_ERROR',
      primary_catalyst: null,
      supporting_catalysts: [],
      groups: {},
      narrative_summary: `Database error: ${err.message}`,
      total_articles: 0,
    };
  }

  if (articles.length === 0) {
    return {
      symbol: upperSymbol,
      status: 'NO_DATA',
      primary_catalyst: null,
      supporting_catalysts: [],
      groups: { earnings: [], offering: [], analyst: [], macro: [], other: [] },
      narrative_summary: 'No recent catalyst — move likely technical or stale.',
      total_articles: 0,
    };
  }

  // Group by catalyst type using headline classification
  const groups = { earnings: [], offering: [], analyst: [], macro: [], other: [] };
  for (const article of articles) {
    // Prefer existing catalyst_cluster if present, else classify by headline
    const group = article.catalyst_cluster || classifyHeadline(article.headline);
    const target = groups[group] || groups.other;

    target.push({
      id: article.id,
      headline: article.headline,
      published_at: article.published_at,
      catalyst_type: article.catalyst_type,
      sentiment: article.sentiment,
      priority_score: Number(article.priority_score) || 0,
      group,
    });
  }

  // Pick primary catalyst: highest priority_score, then most recent
  const allArticles = Object.values(groups).flat();
  const primary = allArticles.reduce((best, cur) => {
    if (!best) return cur;
    if (cur.priority_score > best.priority_score) return cur;
    if (cur.priority_score === best.priority_score &&
        new Date(cur.published_at) > new Date(best.published_at)) return cur;
    return best;
  }, null);

  const supporting = allArticles.filter(a => a !== primary);

  return {
    symbol: upperSymbol,
    status: 'OK',
    primary_catalyst: primary,
    supporting_catalysts: supporting,
    groups,
    narrative_summary: buildNarrativeSummary(groups, primary),
    total_articles: articles.length,
  };
}

module.exports = { aggregateCatalysts };
