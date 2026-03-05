const { pool } = require('../db/pg');
const logger = require('../logger');
const { sendInPlatformAlert, sendEmailAlert } = require('./notification_service');

const FIELD_SQL_MAP = {
  price: 'q.price',
  market_cap: 'q.market_cap',
  float: 'q.float',
  volume: 'q.volume',
  relative_volume: 'q.relative_volume',
  gap_percent: 'q.gap_percent',
  change_percent: 'q.change_percent',
  atr_percent: 'q.atr_percent',
  expected_move: 'q.expected_move',
  vwap_distance: 'q.vwap_distance',
  rsi: 'q.rsi',
  sma20_distance: 'q.sma20_distance',
  sma50_distance: 'q.sma50_distance',
  sma200_distance: 'q.sma200_distance',
  short_float: 'q.short_float',
  strategy_score: 'q.strategy_score',
  setup_type: 'q.setup_type',
  catalyst_score: 'q.catalyst_score',
  news_sentiment: 'q.news_sentiment',
  earnings_date: 'q.earnings_date',
};

const schemaCache = {
  loadedAt: 0,
  columnsByTable: new Map(),
};

function templateMessage(template, symbol, alertName) {
  if (!template) return `[${alertName}] new match: ${symbol}`;
  return String(template)
    .replaceAll('{symbol}', symbol)
    .replaceAll('{alert_name}', alertName);
}

async function refreshSchemaCache() {
  const now = Date.now();
  if (now - schemaCache.loadedAt < 60_000) return;

  const { rows } = await pool.query(
    `SELECT table_name, column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name IN ('market_metrics', 'trade_setups', 'ticker_universe', 'trade_catalysts', 'earnings_events')`
  );

  const next = new Map();
  rows.forEach((row) => {
    const key = row.table_name;
    const set = next.get(key) || new Set();
    set.add(row.column_name);
    next.set(key, set);
  });

  schemaCache.columnsByTable = next;
  schemaCache.loadedAt = now;
}

function hasColumn(tableName, columnName) {
  const set = schemaCache.columnsByTable.get(tableName);
  return !!set && set.has(columnName);
}

function columnExpr(tableAlias, tableName, columnName, fallback = 'NULL::numeric') {
  return hasColumn(tableName, columnName) ? `${tableAlias}.${columnName}` : fallback;
}

function buildCondition(node, params) {
  if (!node) return 'TRUE';

  if (node.field) {
    const fieldSql = FIELD_SQL_MAP[node.field];
    if (!fieldSql) return 'TRUE';

    const operator = String(node.operator || 'equals').toLowerCase();

    if (operator === 'between') {
      const min = Array.isArray(node.value) ? node.value[0] : null;
      const max = Array.isArray(node.value) ? node.value[1] : null;
      params.push(min, max);
      const start = params.length - 1;
      return `${fieldSql} BETWEEN $${start} AND $${start + 1}`;
    }

    if (operator === 'contains') {
      params.push(`%${String(node.value ?? '')}%`);
      return `${fieldSql}::text ILIKE $${params.length}`;
    }

    if (operator === 'equals') {
      params.push(node.value);
      return `${fieldSql} = $${params.length}`;
    }

    if (['>', '>=', '<', '<='].includes(operator)) {
      params.push(node.value);
      return `${fieldSql} ${operator} $${params.length}`;
    }

    return 'TRUE';
  }

  const op = String(node.operator || 'AND').toUpperCase();
  const children = Array.isArray(node.conditions) ? node.conditions : [];

  if (!children.length) return 'TRUE';

  if (op === 'NOT') {
    return `(NOT (${children.map((item) => buildCondition(item, params)).join(' AND ')}))`;
  }

  const glue = op === 'OR' ? ' OR ' : ' AND ';
  return `(${children.map((item) => buildCondition(item, params)).join(glue)})`;
}

async function loadActiveAlerts() {
  const { rows } = await pool.query(
    `SELECT alert_id, user_id, alert_name, query_tree, message_template, frequency, enabled, created_at, last_triggered
     FROM user_alerts
     WHERE enabled = TRUE`
  );
  return rows;
}

async function executeQueryTree(queryTree) {
  await refreshSchemaCache();

  const params = [];
  const whereSql = buildCondition(queryTree, params);

  const hasEarnings = schemaCache.columnsByTable.has('earnings_events');
  const earningsJoin = hasEarnings
    ? `LEFT JOIN LATERAL (
         SELECT ee.date AS earnings_date
         FROM earnings_events ee
         WHERE ee.symbol = m.symbol
         ORDER BY ee.date ASC
         LIMIT 1
       ) e ON TRUE`
    : '';

  const sql = `
    WITH latest_catalyst AS (
      SELECT DISTINCT ON (symbol)
             symbol,
             catalyst_type,
             sentiment,
             score
      FROM trade_catalysts
      ORDER BY symbol, published_at DESC NULLS LAST
    )
    SELECT q.symbol
    FROM (
      SELECT
        m.symbol,
        ${columnExpr('m', 'market_metrics', 'price')} AS price,
        ${columnExpr('u', 'ticker_universe', 'market_cap')} AS market_cap,
        ${columnExpr('m', 'market_metrics', 'float_shares')} AS float,
        ${columnExpr('m', 'market_metrics', 'volume')} AS volume,
        ${columnExpr('m', 'market_metrics', 'relative_volume')} AS relative_volume,
        ${columnExpr('m', 'market_metrics', 'gap_percent')} AS gap_percent,
        ${columnExpr('m', 'market_metrics', 'change_percent')} AS change_percent,
        CASE
          WHEN ${columnExpr('m', 'market_metrics', 'price', 'NULL::numeric')} > 0
            AND ${columnExpr('m', 'market_metrics', 'atr', 'NULL::numeric')} IS NOT NULL
          THEN (${columnExpr('m', 'market_metrics', 'atr', '0')} / NULLIF(${columnExpr('m', 'market_metrics', 'price', '0')}, 0)) * 100
          ELSE NULL
        END AS atr_percent,
        NULL::numeric AS expected_move,
        CASE
          WHEN ${columnExpr('m', 'market_metrics', 'vwap', 'NULL::numeric')} > 0
            AND ${columnExpr('m', 'market_metrics', 'price', 'NULL::numeric')} IS NOT NULL
          THEN ((${columnExpr('m', 'market_metrics', 'price', '0')} - ${columnExpr('m', 'market_metrics', 'vwap', '0')}) / NULLIF(${columnExpr('m', 'market_metrics', 'vwap', '0')}, 0)) * 100
          ELSE NULL
        END AS vwap_distance,
        ${columnExpr('m', 'market_metrics', 'rsi')} AS rsi,
        ${columnExpr('m', 'market_metrics', 'sma20_distance')} AS sma20_distance,
        ${columnExpr('m', 'market_metrics', 'sma50_distance')} AS sma50_distance,
        ${columnExpr('m', 'market_metrics', 'sma200_distance')} AS sma200_distance,
        ${columnExpr('m', 'market_metrics', 'short_percent_float')} AS short_float,
        ${columnExpr('s', 'trade_setups', 'score')} AS strategy_score,
        ${columnExpr('s', 'trade_setups', 'setup', 'NULL::text')} AS setup_type,
        lc.score AS catalyst_score,
        lc.sentiment AS news_sentiment,
        ${hasEarnings ? 'e.earnings_date' : 'NULL::timestamp'} AS earnings_date
      FROM market_metrics m
      LEFT JOIN ticker_universe u ON u.symbol = m.symbol
      LEFT JOIN trade_setups s ON s.symbol = m.symbol
      LEFT JOIN latest_catalyst lc ON lc.symbol = m.symbol
      ${earningsJoin}
    ) q
    WHERE ${whereSql}
    ORDER BY q.relative_volume DESC NULLS LAST, q.symbol ASC
    LIMIT 500
  `;

  const { rows } = await pool.query(sql, params);
  return rows.map((row) => row.symbol).filter(Boolean);
}

async function findUntriggeredSymbols(alertId, symbols, cooldownSeconds) {
  if (!symbols.length) return [];

  const { rows } = await pool.query(
    `SELECT symbol
     FROM alert_history
     WHERE alert_id = $1
       AND symbol = ANY($2)
       AND triggered_at >= NOW() - ($3 * INTERVAL '1 second')`,
    [alertId, symbols, Math.max(1, Number(cooldownSeconds) || 60)]
  );

  const alreadyTriggered = new Set(rows.map((row) => row.symbol));
  return symbols.filter((symbol) => !alreadyTriggered.has(symbol));
}

async function triggerAlertForSymbols(alert, symbols) {
  const messages = [];

  for (const symbol of symbols) {
    const message = templateMessage(alert.message_template, symbol, alert.alert_name);

    await sendInPlatformAlert({
      alertId: alert.alert_id,
      symbol,
      message,
    });

    await sendEmailAlert({
      to: null,
      subject: `OpenRange Alert: ${alert.alert_name}`,
      text: message,
    });

    messages.push({ symbol, message });
  }

  if (messages.length > 0) {
    await pool.query(
      `UPDATE user_alerts
       SET last_triggered = NOW()
       WHERE alert_id = $1`,
      [alert.alert_id]
    );
  }

  return messages;
}

async function processAlert(alert) {
  const frequencySeconds = Math.max(1, Number(alert.frequency) || 60);

  if (alert.last_triggered) {
    const elapsed = Date.now() - new Date(alert.last_triggered).getTime();
    if (elapsed < frequencySeconds * 1000) {
      return { alertId: alert.alert_id, skipped: true, reason: 'frequency_window' };
    }
  }

  const symbols = await executeQueryTree(alert.query_tree);
  const newSymbols = await findUntriggeredSymbols(alert.alert_id, symbols, frequencySeconds);
  const triggered = await triggerAlertForSymbols(alert, newSymbols);

  return {
    alertId: alert.alert_id,
    alertName: alert.alert_name,
    evaluated: symbols.length,
    triggered: triggered.length,
    symbols: triggered.map((item) => item.symbol),
  };
}

async function runAlertCycle() {
  const alerts = await loadActiveAlerts();
  const results = [];

  for (const alert of alerts) {
    try {
      const result = await processAlert(alert);
      results.push(result);
    } catch (error) {
      logger.error('Alert processing failed', {
        alertId: alert.alert_id,
        alertName: alert.alert_name,
        error: error.message,
      });
      results.push({ alertId: alert.alert_id, error: error.message });
    }
  }

  return {
    checkedAt: new Date().toISOString(),
    activeAlerts: alerts.length,
    results,
  };
}

module.exports = {
  FIELD_SQL_MAP,
  loadActiveAlerts,
  executeQueryTree,
  runAlertCycle,
};
