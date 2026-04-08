function toNumber(value, fallback = null) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toDateKey(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const parsed = Date.parse(String(value));
  if (Number.isNaN(parsed)) return String(value).slice(0, 10);
  return new Date(parsed).toISOString().slice(0, 10);
}

function toTimestamp(value) {
  if (!value) return null;
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : parsed;
}

function average(values) {
  const filtered = values.map((value) => toNumber(value)).filter((value) => value !== null);
  if (!filtered.length) return null;
  return filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
}

function sum(values) {
  return values.reduce((total, value) => total + toNumber(value, 0), 0);
}

function max(values) {
  const filtered = values.map((value) => toNumber(value)).filter((value) => value !== null);
  return filtered.length ? Math.max(...filtered) : null;
}

function min(values) {
  const filtered = values.map((value) => toNumber(value)).filter((value) => value !== null);
  return filtered.length ? Math.min(...filtered) : null;
}

function standardDeviation(values) {
  const filtered = values.map((value) => toNumber(value)).filter((value) => value !== null);
  if (filtered.length < 2) return null;
  const mean = average(filtered);
  const variance = filtered.reduce((total, value) => total + ((value - mean) ** 2), 0) / filtered.length;
  return Math.sqrt(variance);
}

function chunk(values, size) {
  const batchSize = Math.max(1, Number(size) || 1);
  const result = [];
  for (let index = 0; index < values.length; index += batchSize) {
    result.push(values.slice(index, index + batchSize));
  }
  return result;
}

function sortBars(bars, field = 'date') {
  return [...(Array.isArray(bars) ? bars : [])].sort((left, right) => {
    const leftValue = toTimestamp(left[field] || left.timestamp || left.date) || 0;
    const rightValue = toTimestamp(right[field] || right.timestamp || right.date) || 0;
    return leftValue - rightValue;
  });
}

function groupBarsByDate(bars) {
  const groups = new Map();
  for (const bar of sortBars(bars, 'timestamp')) {
    const key = toDateKey(bar.timestamp || bar.date);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(bar);
  }
  return groups;
}

function aggregateBarsByMinutes(bars, minutes) {
  const size = Math.max(1, Number(minutes) || 1);
  const sorted = sortBars(bars, 'timestamp');
  const aggregated = [];
  for (let index = 0; index < sorted.length; index += size) {
    const chunkBars = sorted.slice(index, index + size);
    if (!chunkBars.length) continue;
    aggregated.push({
      timestamp: chunkBars[chunkBars.length - 1].timestamp,
      open: toNumber(chunkBars[0].open, 0),
      high: max(chunkBars.map((bar) => bar.high)),
      low: min(chunkBars.map((bar) => bar.low)),
      close: toNumber(chunkBars[chunkBars.length - 1].close, 0),
      volume: sum(chunkBars.map((bar) => bar.volume)),
      session: chunkBars[chunkBars.length - 1].session || chunkBars[0].session || null,
      sourceBars: chunkBars,
    });
  }
  return aggregated;
}

function getDailyBarIndexByDate(bars, dateKey) {
  const target = toDateKey(dateKey);
  return sortBars(bars, 'date').findIndex((bar) => toDateKey(bar.date) === target);
}

function getPreviousDailyBar(dailyBars, dateKey) {
  const bars = sortBars(dailyBars, 'date');
  const target = toDateKey(dateKey);
  let previous = null;
  for (const bar of bars) {
    const barDate = toDateKey(bar.date);
    if (!barDate || barDate >= target) break;
    previous = bar;
  }
  return previous;
}

function getNextDailyBar(dailyBars, dateKey) {
  const target = toDateKey(dateKey);
  return sortBars(dailyBars, 'date').find((bar) => {
    const barDate = toDateKey(bar.date);
    return barDate && barDate > target;
  }) || null;
}

function filterEventsInWindow(events, anchorDate, lookbackDays, forwardDays = 0, fieldName = 'published_at') {
  const anchor = toTimestamp(anchorDate);
  if (anchor === null) return [];
  const lowerBound = anchor - (lookbackDays * 24 * 60 * 60 * 1000);
  const upperBound = anchor + (forwardDays * 24 * 60 * 60 * 1000);
  return (Array.isArray(events) ? events : []).filter((event) => {
    const timestamp = toTimestamp(event[fieldName] || event.report_date || event.date);
    if (timestamp === null) return false;
    return timestamp >= lowerBound && timestamp <= upperBound;
  });
}

function isWithinDays(eventDate, anchorDate, days) {
  const eventTs = toTimestamp(eventDate);
  const anchorTs = toTimestamp(anchorDate);
  if (eventTs === null || anchorTs === null) return false;
  return Math.abs(eventTs - anchorTs) <= (days * 24 * 60 * 60 * 1000);
}

function buildFundamentals(meta = {}, dailyBars = []) {
  const bars = sortBars(dailyBars, 'date');
  const recentBars = bars.slice(-20);
  return {
    symbol: meta.symbol || null,
    sector: meta.sector || null,
    industry: meta.industry || null,
    marketCap: toNumber(meta.market_cap),
    avgDailyVolume20: average(recentBars.map((bar) => bar.volume)),
    lastClose: toNumber(bars[bars.length - 1]?.close),
  };
}

function resolveScanRange(scanRange) {
  if (!scanRange) return null;
  return {
    startDate: toDateKey(scanRange.startDate || scanRange.date || scanRange.start),
    endDate: toDateKey(scanRange.endDate || scanRange.date || scanRange.end),
  };
}

function isDateInScanRange(dateKey, scanRange) {
  const normalized = resolveScanRange(scanRange);
  if (!normalized) return true;
  if (normalized.startDate && dateKey < normalized.startDate) return false;
  if (normalized.endDate && dateKey > normalized.endDate) return false;
  return true;
}

function getNextTradingDateFromBars(bars, currentDate) {
  const sortedDates = Array.from(new Set(sortBars(bars, 'date').map((bar) => toDateKey(bar.date)).filter(Boolean)));
  const target = toDateKey(currentDate);
  return sortedDates.find((dateKey) => dateKey > target) || null;
}

function buildJsonbUpsertSql(table, schema, conflictColumns, updateColumns) {
  const columns = Object.keys(schema);
  const updates = updateColumns && updateColumns.length
    ? updateColumns
    : columns.filter((column) => !conflictColumns.includes(column));
  const assignments = updates.map((column) => `${column} = EXCLUDED.${column}`).join(', ');

  return `
    INSERT INTO ${table} (${columns.join(', ')})
    SELECT ${columns.join(', ')}
    FROM jsonb_to_recordset($1::jsonb) AS rows(${columns.map((column) => `${column} ${schema[column]}`).join(', ')})
    ON CONFLICT (${conflictColumns.join(', ')})
    DO UPDATE SET ${assignments}
  `;
}

async function upsertRows(table, rows, schema, conflictColumns, updateColumns, label) {
  const { queryWithTimeout } = require('../db/pg');
  if (!Array.isArray(rows) || rows.length === 0) {
    return { inserted: 0 };
  }

  const sql = buildJsonbUpsertSql(table, schema, conflictColumns, updateColumns);
  const batchSize = Math.max(1, Number(process.env.BACKTESTER_UPSERT_BATCH_SIZE || 50) || 50);
  const timeoutMs = Math.max(30000, Number(process.env.BACKTESTER_UPSERT_TIMEOUT_MS || 120000) || 120000);
  for (const group of chunk(rows, batchSize)) {
    await queryWithTimeout(sql, [JSON.stringify(group)], {
      timeoutMs,
      label,
      maxRetries: 0,
      slowQueryMs: 1500,
    });
  }

  return { inserted: rows.length };
}

module.exports = {
  aggregateBarsByMinutes,
  average,
  buildFundamentals,
  chunk,
  filterEventsInWindow,
  getDailyBarIndexByDate,
  getNextDailyBar,
  getNextTradingDateFromBars,
  getPreviousDailyBar,
  groupBarsByDate,
  isDateInScanRange,
  isWithinDays,
  max,
  min,
  resolveScanRange,
  sortBars,
  standardDeviation,
  sum,
  toDateKey,
  toNumber,
  toTimestamp,
  upsertRows,
};