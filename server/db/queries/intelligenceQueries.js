const {
  OPPORTUNITIES_TABLE,
  SIGNALS_TABLE,
} = require('../../../lib/data/authority');

function clamp(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}

function buildIntelligenceNewsQuery(options = {}) {
  const symbol = String(options.symbol || '').trim().toUpperCase();
  const params = [];
  const where = [`created_at > NOW() - INTERVAL '24 hours'`];

  if (symbol) {
    params.push(symbol);
    where.push(`UPPER(COALESCE(symbol, '')) = $${params.length}`);
  }

  return {
    text: `SELECT *
           FROM news_articles
           WHERE ${where.join(' AND ')}
           ORDER BY created_at DESC NULLS LAST
           LIMIT 50`,
    params,
    options: { label: 'api.intelligence.news', timeoutMs: 2200, maxRetries: 1, retryDelayMs: 120 },
  };
}

function buildOpportunitiesPrimaryQuery(limit) {
  const normalizedLimit = clamp(limit, 1, 200, 50);
  return {
    text: `SELECT *
           FROM ${OPPORTUNITIES_TABLE}
           WHERE COALESCE(detected_at, updated_at) > NOW() - INTERVAL '7 days'
           ORDER BY COALESCE(detected_at, updated_at) DESC NULLS LAST
           LIMIT $1`,
    params: [normalizedLimit],
    options: { label: 'api.intelligence.opportunities.primary', timeoutMs: 2200, maxRetries: 1, retryDelayMs: 120 },
  };
}

function buildOpportunitiesFallbackQuery() {
  return {
    text: `SELECT *
           FROM ${OPPORTUNITIES_TABLE}
           ORDER BY COALESCE(detected_at, updated_at) DESC NULLS LAST
           LIMIT 20`,
    params: [],
    options: { label: 'api.intelligence.opportunities.fallback', timeoutMs: 2200, maxRetries: 1, retryDelayMs: 120 },
  };
}

function buildHeatmapPrimaryQuery() {
  return {
    text: `SELECT *
           FROM market_metrics
           WHERE COALESCE(updated_at, last_updated) > NOW() - INTERVAL '24 hours'
           ORDER BY COALESCE(relative_volume, 0) DESC NULLS LAST,
                    ABS(COALESCE(gap_percent, 0)) DESC NULLS LAST,
                    COALESCE(updated_at, last_updated) DESC NULLS LAST
           LIMIT 100`,
    params: [],
    options: { label: 'api.intelligence.heatmap.primary', timeoutMs: 2200, maxRetries: 1, retryDelayMs: 120 },
  };
}

function buildHeatmapFallbackQuery() {
  return {
    text: `SELECT *
           FROM market_metrics
           ORDER BY COALESCE(updated_at, last_updated) DESC NULLS LAST
           LIMIT 50`,
    params: [],
    options: { label: 'api.intelligence.heatmap.fallback', timeoutMs: 2200, maxRetries: 1, retryDelayMs: 120 },
  };
}

function buildSignalsPrimaryQuery() {
  return {
    text: `SELECT *
           FROM ${SIGNALS_TABLE}
           WHERE updated_at > NOW() - INTERVAL '7 days'
           ORDER BY updated_at DESC NULLS LAST
           LIMIT 50`,
    params: [],
    options: { label: 'api.intelligence.signals.primary', timeoutMs: 2200, maxRetries: 1, retryDelayMs: 120 },
  };
}

function buildSignalsFallbackQuery() {
  return {
    text: `SELECT *
           FROM ${SIGNALS_TABLE}
           ORDER BY updated_at DESC NULLS LAST
           LIMIT 20`,
    params: [],
    options: { label: 'api.intelligence.signals.fallback', timeoutMs: 2200, maxRetries: 1, retryDelayMs: 120 },
  };
}

module.exports = {
  buildIntelligenceNewsQuery,
  buildOpportunitiesPrimaryQuery,
  buildOpportunitiesFallbackQuery,
  buildHeatmapPrimaryQuery,
  buildHeatmapFallbackQuery,
  buildSignalsPrimaryQuery,
  buildSignalsFallbackQuery,
};
