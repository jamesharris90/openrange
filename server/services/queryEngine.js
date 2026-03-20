const { pool } = require('../db/pg');
const { executeQueryTree, FIELD_SQL_MAP } = require('../alerts/alert_engine');
const { getFilterRegistry } = require('../config/intelligenceConfig');

function toConditionNode(node) {
  if (!node || typeof node !== 'object') return null;

  if (node.field) {
    return {
      field: String(node.field),
      operator: String(node.operator || 'equals'),
      value: node.value,
    };
  }

  if (Array.isArray(node.AND)) {
    return { operator: 'AND', conditions: node.AND.map(toConditionNode).filter(Boolean) };
  }

  if (Array.isArray(node.OR)) {
    return { operator: 'OR', conditions: node.OR.map(toConditionNode).filter(Boolean) };
  }

  if (Array.isArray(node.NOT)) {
    return { operator: 'NOT', conditions: node.NOT.map(toConditionNode).filter(Boolean) };
  }

  if (node.NOT && typeof node.NOT === 'object') {
    const child = toConditionNode(node.NOT);
    return { operator: 'NOT', conditions: child ? [child] : [] };
  }

  if (node.operator || Array.isArray(node.conditions)) {
    const op = String(node.operator || 'AND').toUpperCase();
    return {
      operator: op,
      conditions: (Array.isArray(node.conditions) ? node.conditions : []).map(toConditionNode).filter(Boolean),
    };
  }

  return null;
}

function collectFields(node, out = new Set()) {
  if (!node) return out;
  if (node.field) {
    out.add(String(node.field));
    return out;
  }
  (node.conditions || []).forEach((child) => collectFields(child, out));
  return out;
}

function getAllowedFields() {
  const registry = getFilterRegistry();
  const configured = Array.isArray(registry?.filters)
    ? registry.filters.map((item) => (typeof item === 'string' ? item : item?.field)).filter(Boolean)
    : [];

  const mapped = Object.keys(FIELD_SQL_MAP);
  return new Set([...configured, ...mapped]);
}

function normalizeQueryTree(queryTree) {
  const normalized = toConditionNode(queryTree) || { operator: 'AND', conditions: [] };
  const allowedFields = getAllowedFields();
  const fields = [...collectFields(normalized)];
  const invalidField = fields.find((field) => !allowedFields.has(field));

  if (invalidField) {
    const error = new Error(`Unsupported filter field: ${invalidField}`);
    error.code = 'INVALID_QUERY_TREE_FIELD';
    throw error;
  }

  return normalized;
}

async function hydrateRows(symbols, limit = 250) {
  if (!Array.isArray(symbols) || symbols.length === 0) return [];

  const safeLimit = Math.max(1, Math.min(Number(limit) || 250, 500));
  const uniqueSymbols = [...new Set(symbols.map((s) => String(s || '').toUpperCase()).filter(Boolean))];

  const { rows } = await pool.query(
    `WITH latest_catalyst AS (
      SELECT DISTINCT ON (symbol)
             symbol,
             catalyst_type,
             headline,
             sentiment,
             score,
             published_at
      FROM trade_catalysts
      ORDER BY symbol, published_at DESC NULLS LAST
    )
    SELECT
      m.symbol,
      m.price,
      m.change_percent,
      m.gap_percent,
      m.relative_volume,
      m.volume,
      NULL::text AS sector,
      COALESCE(
        NULLIF(to_jsonb(ts)->>'setup', ''),
        NULLIF(to_jsonb(ts)->>'setup_type', ''),
        'Momentum Continuation'
      ) AS strategy,
      COALESCE(
        NULLIF(to_jsonb(ts)->>'class', ''),
        CASE
          WHEN COALESCE((to_jsonb(ts)->>'score')::numeric, 0) >= 90 THEN 'A'
          WHEN COALESCE((to_jsonb(ts)->>'score')::numeric, 0) >= 75 THEN 'B'
          ELSE 'C'
        END
      ) AS class,
      COALESCE((to_jsonb(ts)->>'score')::numeric, 0) AS score,
      COALESCE((to_jsonb(ts)->>'probability')::numeric, (to_jsonb(ts)->>'confidence')::numeric, 0) AS probability,
      COALESCE(lc.headline, 'No catalyst') AS catalyst,
      COALESCE(lc.catalyst_type, 'news') AS catalyst_type,
      COALESCE(lc.sentiment, 'neutral') AS news_sentiment,
      COALESCE(
        NULLIF(to_jsonb(ts)->>'updated_at', '')::timestamptz,
        NULLIF(to_jsonb(ts)->>'created_at', '')::timestamptz,
        m.updated_at,
        NOW()
      ) AS updated_at
    FROM market_metrics m
    LEFT JOIN trade_setups ts ON ts.symbol = m.symbol
    LEFT JOIN latest_catalyst lc ON lc.symbol = m.symbol
    WHERE m.symbol = ANY($1::text[])
    ORDER BY COALESCE((to_jsonb(ts)->>'score')::numeric, 0) DESC NULLS LAST, m.relative_volume DESC NULLS LAST
    LIMIT $2`,
    [uniqueSymbols, safeLimit]
  );

  return rows;
}

async function runQueryTree(queryTree, options = {}) {
  const normalizedTree = normalizeQueryTree(queryTree);
  const symbols = await executeQueryTree(normalizedTree);
  const rows = await hydrateRows(symbols, options.limit);

  return {
    query_tree: normalizedTree,
    symbols,
    rows,
  };
}

module.exports = {
  normalizeQueryTree,
  runQueryTree,
};
