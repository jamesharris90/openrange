const { pool } = require('../../db/pg');

// ── Executions ──

async function insertExecution(data) {
  const { userId, datasetScope, broker, symbol, side, qty, price, commission, execTime, rawJson } = data;
  const result = await pool.query(
    `INSERT INTO broker_executions (user_id, dataset_scope, broker, symbol, side, qty, price, commission, exec_time, raw_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING exec_id`,
    [userId, datasetScope || 'user', broker, symbol, side, qty, price, commission || 0, execTime, rawJson || null]
  );
  return result.rows[0];
}

// ── Trades ──

async function insertTrade(data) {
  const { userId, datasetScope, symbol, side, entryPrice, exitPrice, qty, pnlDollar, pnlPercent, commissionTotal, openedAt, closedAt, durationSeconds, status } = data;
  const result = await pool.query(
    `INSERT INTO trades (user_id, dataset_scope, symbol, side, entry_price, exit_price, qty, pnl_dollar, pnl_percent, commission_total, opened_at, closed_at, duration_seconds, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING trade_id`,
    [userId, datasetScope || 'user', symbol, side, entryPrice, exitPrice || null, qty, pnlDollar || null, pnlPercent || null, commissionTotal || 0, openedAt, closedAt || null, durationSeconds || null, status || 'open']
  );
  return result.rows[0];
}

async function updateTrade(tradeId, userId, data) {
  const fields = [];
  const values = [];
  let idx = 1;

  const allowed = ['symbol', 'side', 'entry_price', 'exit_price', 'qty', 'pnl_dollar', 'pnl_percent', 'commission_total', 'opened_at', 'closed_at', 'duration_seconds', 'status'];
  const camelToSnake = { entryPrice: 'entry_price', exitPrice: 'exit_price', pnlDollar: 'pnl_dollar', pnlPercent: 'pnl_percent', commissionTotal: 'commission_total', openedAt: 'opened_at', closedAt: 'closed_at', durationSeconds: 'duration_seconds' };

  for (const [key, val] of Object.entries(data)) {
    const col = camelToSnake[key] || key;
    if (!allowed.includes(col)) continue;
    fields.push(`${col} = $${idx}`);
    values.push(val);
    idx++;
  }

  if (fields.length === 0) return null;

  values.push(tradeId, userId);
  const result = await pool.query(
    `UPDATE trades SET ${fields.join(', ')} WHERE trade_id = $${idx} AND user_id = $${idx + 1} RETURNING *`,
    values
  );
  return result.rows[0] || null;
}

async function deleteTrade(tradeId, userId) {
  const result = await pool.query(
    'DELETE FROM trades WHERE trade_id = $1 AND user_id = $2 RETURNING trade_id',
    [tradeId, userId]
  );
  return result.rowCount > 0;
}

async function getTrades(userId, scope, filters = {}) {
  const conditions = ['t.user_id = $1', 't.dataset_scope = $2'];
  const values = [userId, scope || 'user'];
  let idx = 3;

  if (filters.status) {
    conditions.push(`t.status = $${idx}`);
    values.push(filters.status);
    idx++;
  }
  if (filters.symbol) {
    conditions.push(`t.symbol = $${idx}`);
    values.push(filters.symbol);
    idx++;
  }
  if (filters.from) {
    conditions.push(`t.opened_at >= $${idx}`);
    values.push(filters.from);
    idx++;
  }
  if (filters.to) {
    conditions.push(`t.opened_at <= $${idx}`);
    values.push(filters.to);
    idx++;
  }

  const limit = Math.min(filters.limit || 100, 500);
  const offset = ((filters.page || 1) - 1) * limit;

  const result = await pool.query(
    `SELECT t.*, tm.setup_type, tm.conviction, tm.notes, tm.review_status
     FROM trades t
     LEFT JOIN trade_metadata tm ON tm.trade_id = t.trade_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY t.opened_at DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    [...values, limit, offset]
  );
  return result.rows;
}

async function getTradeById(tradeId, userId) {
  const result = await pool.query(
    `SELECT t.*, tm.setup_type, tm.conviction, tm.notes, tm.screenshot_url, tm.tags_json, tm.review_status
     FROM trades t
     LEFT JOIN trade_metadata tm ON tm.trade_id = t.trade_id
     WHERE t.trade_id = $1 AND t.user_id = $2`,
    [tradeId, userId]
  );
  return result.rows[0] || null;
}

async function getTradeSummary(userId, scope, dateRange = {}) {
  const conditions = ['user_id = $1', 'dataset_scope = $2', "status = 'closed'"];
  const values = [userId, scope || 'user'];
  let idx = 3;

  if (dateRange.from) {
    conditions.push(`closed_at >= $${idx}`);
    values.push(dateRange.from);
    idx++;
  }
  if (dateRange.to) {
    conditions.push(`closed_at <= $${idx}`);
    values.push(dateRange.to);
    idx++;
  }

  const result = await pool.query(
    `SELECT
       COUNT(*)::int AS total_trades,
       COUNT(*) FILTER (WHERE pnl_dollar > 0)::int AS wins,
       COUNT(*) FILTER (WHERE pnl_dollar < 0)::int AS losses,
       COALESCE(SUM(pnl_dollar), 0)::numeric AS total_pnl,
       COALESCE(MAX(pnl_dollar), 0)::numeric AS biggest_winner,
       COALESCE(MIN(pnl_dollar), 0)::numeric AS biggest_loser,
       COALESCE(SUM(commission_total), 0)::numeric AS total_commissions
     FROM trades
     WHERE ${conditions.join(' AND ')}`,
    values
  );
  const row = result.rows[0];
  return {
    totalTrades: row.total_trades,
    wins: row.wins,
    losses: row.losses,
    totalPnl: +row.total_pnl,
    biggestWinner: +row.biggest_winner,
    biggestLoser: +row.biggest_loser,
    totalCommissions: +row.total_commissions,
    winRate: row.total_trades > 0 ? +((row.wins / row.total_trades) * 100).toFixed(2) : 0,
  };
}

// ── Metadata ──

async function upsertMetadata(tradeId, data) {
  const { setupType, conviction, notes, screenshotUrl, tagsJson, reviewStatus } = data;
  const result = await pool.query(
    `INSERT INTO trade_metadata (trade_id, setup_type, conviction, notes, screenshot_url, tags_json, review_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (trade_id) DO UPDATE SET
       setup_type = COALESCE(EXCLUDED.setup_type, trade_metadata.setup_type),
       conviction = COALESCE(EXCLUDED.conviction, trade_metadata.conviction),
       notes = COALESCE(EXCLUDED.notes, trade_metadata.notes),
       screenshot_url = COALESCE(EXCLUDED.screenshot_url, trade_metadata.screenshot_url),
       tags_json = COALESCE(EXCLUDED.tags_json, trade_metadata.tags_json),
       review_status = COALESCE(EXCLUDED.review_status, trade_metadata.review_status),
       updated_at = NOW()
     RETURNING *`,
    [tradeId, setupType || null, conviction || null, notes || null, screenshotUrl || null, tagsJson ? JSON.stringify(tagsJson) : null, reviewStatus || null]
  );
  return result.rows[0];
}

async function getMetadata(tradeId) {
  const result = await pool.query('SELECT * FROM trade_metadata WHERE trade_id = $1', [tradeId]);
  return result.rows[0] || null;
}

// ── Tags ──

async function getUserTags(userId) {
  const result = await pool.query('SELECT * FROM trade_tags WHERE user_id = $1 ORDER BY tag_name', [userId]);
  return result.rows;
}

async function createTag(userId, tagName, colourHex) {
  const result = await pool.query(
    'INSERT INTO trade_tags (user_id, tag_name, colour_hex) VALUES ($1, $2, $3) ON CONFLICT (user_id, tag_name) DO NOTHING RETURNING *',
    [userId, tagName, colourHex || '#6366f1']
  );
  return result.rows[0] || null;
}

async function deleteTag(tagId, userId) {
  const result = await pool.query('DELETE FROM trade_tags WHERE tag_id = $1 AND user_id = $2 RETURNING tag_id', [tagId, userId]);
  return result.rowCount > 0;
}

// ── Daily Reviews ──

async function upsertDailyReview(data) {
  const { userId, datasetScope, reviewDate, totalPnl, totalTrades, winRate, summaryText, lessonsText, planTomorrow, mood, rating } = data;
  const result = await pool.query(
    `INSERT INTO daily_reviews (user_id, dataset_scope, review_date, total_pnl, total_trades, win_rate, summary_text, lessons_text, plan_tomorrow, mood, rating)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (user_id, dataset_scope, review_date) DO UPDATE SET
       total_pnl = COALESCE(EXCLUDED.total_pnl, daily_reviews.total_pnl),
       total_trades = COALESCE(EXCLUDED.total_trades, daily_reviews.total_trades),
       win_rate = COALESCE(EXCLUDED.win_rate, daily_reviews.win_rate),
       summary_text = COALESCE(EXCLUDED.summary_text, daily_reviews.summary_text),
       lessons_text = COALESCE(EXCLUDED.lessons_text, daily_reviews.lessons_text),
       plan_tomorrow = COALESCE(EXCLUDED.plan_tomorrow, daily_reviews.plan_tomorrow),
       mood = COALESCE(EXCLUDED.mood, daily_reviews.mood),
       rating = COALESCE(EXCLUDED.rating, daily_reviews.rating),
       updated_at = NOW()
     RETURNING *`,
    [userId, datasetScope || 'user', reviewDate, totalPnl || null, totalTrades || null, winRate || null, summaryText || null, lessonsText || null, planTomorrow || null, mood || null, rating || null]
  );
  return result.rows[0];
}

async function getDailyReview(userId, scope, date) {
  const result = await pool.query(
    'SELECT * FROM daily_reviews WHERE user_id = $1 AND dataset_scope = $2 AND review_date = $3',
    [userId, scope || 'user', date]
  );
  return result.rows[0] || null;
}

async function getDailyReviews(userId, scope, dateRange = {}) {
  const conditions = ['user_id = $1', 'dataset_scope = $2'];
  const values = [userId, scope || 'user'];
  let idx = 3;

  if (dateRange.from) {
    conditions.push(`review_date >= $${idx}`);
    values.push(dateRange.from);
    idx++;
  }
  if (dateRange.to) {
    conditions.push(`review_date <= $${idx}`);
    values.push(dateRange.to);
    idx++;
  }

  const result = await pool.query(
    `SELECT * FROM daily_reviews WHERE ${conditions.join(' AND ')} ORDER BY review_date DESC`,
    values
  );
  return result.rows;
}

async function getCalendarData(userId, scope, month) {
  // month = 'YYYY-MM'
  const startDate = `${month}-01`;
  const result = await pool.query(
    `SELECT
       dr.review_date,
       dr.total_pnl,
       dr.total_trades,
       dr.summary_text,
       dr.mood,
       dr.rating,
       CASE
         WHEN dr.summary_text IS NOT NULL AND dr.summary_text != '' THEN 'reviewed'
         WHEN dr.total_trades > 0 THEN 'partial'
         ELSE 'empty'
       END AS review_status
     FROM daily_reviews dr
     WHERE dr.user_id = $1 AND dr.dataset_scope = $2
       AND dr.review_date >= $3::date
       AND dr.review_date < ($3::date + INTERVAL '1 month')
     ORDER BY dr.review_date`,
    [userId, scope || 'user', startDate]
  );
  return result.rows;
}

module.exports = {
  insertExecution,
  insertTrade,
  updateTrade,
  deleteTrade,
  getTrades,
  getTradeById,
  getTradeSummary,
  upsertMetadata,
  getMetadata,
  getUserTags,
  createTag,
  deleteTag,
  upsertDailyReview,
  getDailyReview,
  getDailyReviews,
  getCalendarData,
};
