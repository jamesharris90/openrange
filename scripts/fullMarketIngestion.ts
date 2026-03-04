// @ts-nocheck

const fs = require('fs/promises');
const path = require('path');
const { Client } = require('pg');
const dotenv = require('dotenv');

console.log(JSON.stringify({
  event: 'INGESTION_START',
  timestamp: new Date().toISOString(),
  pid: process.pid,
}));

process.on('uncaughtException', (err) => {
  console.error(JSON.stringify({
    event: 'UNCAUGHT_EXCEPTION',
    message: err?.message,
    stack: err?.stack,
    timestamp: new Date().toISOString(),
  }));
  process.exitCode = 1;
});

process.on('unhandledRejection', (reason) => {
  console.error(JSON.stringify({
    event: 'UNHANDLED_REJECTION',
    reason,
    timestamp: new Date().toISOString(),
  }));
  process.exitCode = 1;
});

dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', 'server', '.env') });

const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
const FMP_API_KEY = process.env.FMP_API_KEY;

const BATCH_SIZE = {
  daily: 50,
  intraday: 20,
  earnings: 100,
  news: 200,
};

const PHASES = ['universe', 'daily', 'intraday', 'earnings', 'news', 'complete'];
const PHASE_TO_NEXT = {
  universe: 'daily',
  daily: 'intraday',
  intraday: 'earnings',
  earnings: 'news',
  news: 'complete',
  complete: 'complete',
};

const FMP_STABLE_BASE_URL = 'https://financialmodelingprep.com/stable';
const RATE_LIMIT_MS = 120;
const YEARS_BACK = 2;
const INTRADAY_DAYS = 20;
const NEWS_DAYS = 20;
const UPSERT_CHUNK_SIZE = 500;
const RETRY_ATTEMPTS = 3;

const heartbeatState = {
  phase: 'universe',
  last_symbol_index: 0,
};

setInterval(() => {
  console.log(JSON.stringify({
    event: 'HEARTBEAT',
    phase: heartbeatState.phase,
    last_symbol_index: heartbeatState.last_symbol_index,
    timestamp: new Date().toISOString(),
  }));
}, 60000);

class FatalIngestionError extends Error {
  constructor(message, context = {}) {
    super(message);
    this.name = 'FatalIngestionError';
    this.context = context;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function normalizePhase(phase) {
  const value = String(phase || '').toLowerCase();
  return PHASES.includes(value) ? value : 'universe';
}

function toNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function sanitizeVolume(value) {
  if (value === null || value === undefined) return 0;

  let num = Number(value);

  if (!Number.isFinite(num)) return 0;
  if (num < 0) return 0;

  const MAX_BIGINT = 9223372036854775807;

  if (num > MAX_BIGINT) return MAX_BIGINT;

  return Math.floor(num);
}

function sanitizeNumber(value) {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return num;
}

function toIsoDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

function toIsoTimestamp(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString();
}

function yearsAgo(years) {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return d;
}

function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function quoteIdent(identifier) {
  return `"${String(identifier || '').replace(/"/g, '""')}"`;
}

function parseConflictColumns(onConflict) {
  return String(onConflict || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function dedupeRowsByConflict(rows, onConflict) {
  if (!Array.isArray(rows) || rows.length <= 1) return rows || [];
  const conflictColumns = parseConflictColumns(onConflict);
  if (!conflictColumns.length) return rows;

  const map = new Map();
  for (const row of rows) {
    const key = conflictColumns.map((column) => String(row?.[column] ?? '')).join('||');
    map.set(key, row);
  }
  return Array.from(map.values());
}

function logJson(payload) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), ...payload }));
}

async function runIntradayRetention(pool) {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  try {
    const result = await pool.query(
      `
      DELETE FROM intraday_1m
      WHERE "timestamp" < $1
      `,
      [cutoff],
    );

    logJson({
      event: 'INTRADAY_RETENTION_CLEANUP',
      cutoff,
      rows_deleted: result.rowCount || 0,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logJson({
      event: 'INTRADAY_RETENTION_ERROR',
      error: error?.message,
      timestamp: new Date().toISOString(),
    });
  }
}

async function fetchJsonWithRetry(url, attempt = 1) {
  try {
    const response = await fetch(url, { method: 'GET' });

    if (response.status === 429 || response.status >= 500) {
      if (attempt < RETRY_ATTEMPTS) {
        const backoff = Math.min(500 * 2 ** (attempt - 1), 6000);
        await sleep(backoff);
        return fetchJsonWithRetry(url, attempt + 1);
      }
      throw new Error(`HTTP_${response.status}`);
    }

    if (response.status === 404) return [];

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(text || `HTTP_${response.status}`);
    }

    const payload = await response.json();
    return payload;
  } catch (error) {
    if (attempt < RETRY_ATTEMPTS) {
      const backoff = Math.min(500 * 2 ** (attempt - 1), 6000);
      await sleep(backoff);
      return fetchJsonWithRetry(url, attempt + 1);
    }
    throw error;
  }
}

async function createPool() {
  const pool = new Client({
    connectionString: SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });
  await pool.connect();
  return pool;
}

async function loadIngestionState(pool) {
  const result = await pool.query(
    `SELECT id, phase, last_symbol_index, status FROM public.ingestion_state WHERE id = 1 LIMIT 1`,
  );

  const row = result.rows?.[0];
  if (!row) {
    const inserted = await pool.query(`
      INSERT INTO public.ingestion_state (id, phase, last_symbol_index, status, last_updated)
      VALUES (1, 'universe', 0, 'running', now())
      RETURNING id, phase, last_symbol_index, status
    `);
    return {
      id: 1,
      phase: normalizePhase(inserted.rows[0].phase),
      last_symbol_index: Math.max(0, Number(inserted.rows[0].last_symbol_index || 0)),
      status: String(inserted.rows[0].status || 'running').toLowerCase(),
    };
  }

  return {
    id: 1,
    phase: normalizePhase(row.phase),
    last_symbol_index: Math.max(0, Number(row.last_symbol_index || 0)),
    status: String(row.status || 'idle').toLowerCase(),
  };
}

async function checkpointBatch(pool, globalIndex, currentPhase) {
  await pool.query(
    `
    UPDATE ingestion_state
    SET last_symbol_index = $1,
        phase = $2,
        status = 'running',
        last_updated = now()
    WHERE id = 1
  `,
    [globalIndex, currentPhase],
  );
}

async function transitionPhase(pool, nextPhase) {
  await pool.query(
    `
    UPDATE ingestion_state
    SET phase = $1,
        last_symbol_index = 0,
        status = 'running',
        last_updated = now()
    WHERE id = 1
  `,
    [nextPhase],
  );

  console.log(JSON.stringify({
    event: 'PHASE_TRANSITION',
    new_phase: nextPhase,
    timestamp: new Date().toISOString(),
  }));
}

async function markError(pool) {
  await pool.query(`
    UPDATE ingestion_state
    SET status = 'error',
        last_updated = now()
    WHERE id = 1
  `);
}

async function markComplete(pool) {
  await pool.query(`
    UPDATE ingestion_state
    SET phase = 'complete',
        status = 'complete',
        last_symbol_index = 0,
        last_updated = now()
    WHERE id = 1
  `);
}

async function ensureUniverseFile(symbols) {
  const dir = path.join(__dirname, '..', 'server', 'dataWarehouse');
  const filePath = path.join(dir, 'universe.json');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(symbols, null, 2), 'utf8');
}

async function loadUniverseFromFile() {
  const filePath = path.join(__dirname, '..', 'server', 'dataWarehouse', 'universe.json');
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const symbols = parsed.map((v) => String(v || '').trim().toUpperCase()).filter(Boolean);
    return Array.from(new Set(symbols)).sort();
  } catch (_error) {
    return null;
  }
}

async function buildUniverse() {
  const exchanges = ['NASDAQ', 'NYSE'];
  const allRows = [];

  for (const exchange of exchanges) {
    const url = `${FMP_STABLE_BASE_URL}/company-screener?exchange=${encodeURIComponent(exchange)}&isActivelyTrading=true&isEtf=false&isFund=false&limit=10000&apikey=${encodeURIComponent(FMP_API_KEY)}`;
    const payload = await fetchJsonWithRetry(url);
    const rows = Array.isArray(payload) ? payload : [];
    allRows.push(...rows);
    await sleep(RATE_LIMIT_MS);
  }

  const symbols = allRows
    .filter((row) => {
      const exchange = String(row?.exchangeShortName || row?.exchange || '').toUpperCase();
      const type = String(row?.type || row?.assetType || row?.securityType || 'stock').toLowerCase();
      const price = Number(row?.price);
      const isStock = type.includes('stock') || type === '';
      return (exchange === 'NASDAQ' || exchange === 'NYSE') && isStock && Number.isFinite(price) && price > 1;
    })
    .map((row) => String(row?.symbol || '').trim().toUpperCase())
    .filter(Boolean);

  const deduped = Array.from(new Set(symbols)).sort();
  await ensureUniverseFile(deduped);
  return deduped;
}

async function upsertRows(pool, table, rows, onConflict) {
  const dedupedRows = dedupeRowsByConflict(rows, onConflict);
  if (!dedupedRows.length) return;

  const chunks = chunkArray(dedupedRows, UPSERT_CHUNK_SIZE);
  const conflictColumns = parseConflictColumns(onConflict);

  for (const chunk of chunks) {
    if (!chunk.length) continue;

    const columns = Object.keys(chunk[0]);
    if (!columns.length) continue;

    const values = [];
    const placeholders = chunk.map((row, rowIndex) => {
      const rowPlaceholders = columns.map((column, colIndex) => {
        values.push(row[column]);
        return `$${rowIndex * columns.length + colIndex + 1}`;
      });
      return `(${rowPlaceholders.join(', ')})`;
    });

    const updateColumns = columns.filter((column) => !conflictColumns.includes(column));
    const updateClause = updateColumns.length
      ? `DO UPDATE SET ${updateColumns.map((column) => `${quoteIdent(column)} = EXCLUDED.${quoteIdent(column)}`).join(', ')}`
      : 'DO NOTHING';

    const sql = `
      INSERT INTO ${quoteIdent(table)} (${columns.map(quoteIdent).join(', ')})
      VALUES ${placeholders.join(', ')}
      ON CONFLICT (${conflictColumns.map(quoteIdent).join(', ')})
      ${updateClause}
    `;

    await pool.query(sql, values);
  }
}

async function countRowsBySymbols(pool, table, symbols) {
  if (!symbols.length) return 0;
  const result = await pool.query(
    `SELECT count(*)::int AS c FROM ${quoteIdent(table)} WHERE symbol = ANY($1::text[])`,
    [Array.from(new Set(symbols))],
  );
  return Number(result.rows?.[0]?.c || 0);
}

async function fetchDailyRows(symbol) {
  const cutoff = yearsAgo(YEARS_BACK).toISOString().slice(0, 10);
  const from = yearsAgo(YEARS_BACK + 1).toISOString().slice(0, 10);
  const to = new Date().toISOString().slice(0, 10);

  let rows = [];

  const primaryUrl = `${FMP_STABLE_BASE_URL}/historical-chart/1day?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(FMP_API_KEY)}`;
  const primaryPayload = await fetchJsonWithRetry(primaryUrl);
  rows = Array.isArray(primaryPayload) ? primaryPayload : [];

  if (!rows.length) {
    const fallbackUrl = `${FMP_STABLE_BASE_URL}/historical-price-eod/full?symbol=${encodeURIComponent(symbol)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&apikey=${encodeURIComponent(FMP_API_KEY)}`;
    const fallbackPayload = await fetchJsonWithRetry(fallbackUrl);
    rows = Array.isArray(fallbackPayload)
      ? fallbackPayload
      : (Array.isArray(fallbackPayload?.historical) ? fallbackPayload.historical : []);
  }

  return rows
    .map((row) => {
      const date = toIsoDate(row?.date);
      if (!date || date < cutoff) return null;
      return {
        symbol,
        date,
        open: sanitizeNumber(row?.open),
        high: sanitizeNumber(row?.high),
        low: sanitizeNumber(row?.low),
        close: sanitizeNumber(row?.close),
        volume: sanitizeVolume(row?.volume),
      };
    })
    .filter(Boolean);
}

function selectLatestTradingDays(rows, maxDays) {
  const sorted = [...rows].sort((a, b) => {
    const ta = Date.parse(String(a?.date || a?.datetime || 0));
    const tb = Date.parse(String(b?.date || b?.datetime || 0));
    return tb - ta;
  });

  const keepDays = new Set();
  const output = [];

  for (const row of sorted) {
    const date = toIsoDate(row?.date || row?.datetime);
    if (!date) continue;
    if (!keepDays.has(date) && keepDays.size >= maxDays) continue;
    keepDays.add(date);
    output.push(row);
  }

  return output;
}

async function fetchIntradayRows(symbol) {
  const url = `${FMP_STABLE_BASE_URL}/historical-chart/1min?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(FMP_API_KEY)}`;
  const payload = await fetchJsonWithRetry(url);
  const rows = Array.isArray(payload) ? payload : [];
  const latestRows = selectLatestTradingDays(rows, INTRADAY_DAYS);

  return latestRows
    .map((row) => {
      const timestamp = toIsoTimestamp(row?.date || row?.datetime);
      if (!timestamp) return null;
      return {
        symbol,
        timestamp,
        open: sanitizeNumber(row?.open),
        high: sanitizeNumber(row?.high),
        low: sanitizeNumber(row?.low),
        close: sanitizeNumber(row?.close),
        volume: sanitizeVolume(row?.volume),
      };
    })
    .filter(Boolean);
}

async function fetchEarningsRows(symbol) {
  const cutoff = yearsAgo(YEARS_BACK).toISOString().slice(0, 10);
  const url = `${FMP_STABLE_BASE_URL}/earnings-calendar?symbol=${encodeURIComponent(symbol)}&limit=80&apikey=${encodeURIComponent(FMP_API_KEY)}`;
  const payload = await fetchJsonWithRetry(url);
  const rows = Array.isArray(payload) ? payload : [];

  return rows
    .map((row) => {
      const reportDate = toIsoDate(row?.date || row?.reportDate || row?.fiscalDateEnding);
      if (!reportDate || reportDate < cutoff) return null;
      return {
        symbol,
        report_date: reportDate,
        report_time: row?.time ? String(row.time) : null,
        eps_estimate: toNumberOrNull(row?.epsEstimated ?? row?.epsEstimate ?? row?.estimatedEps),
        eps_actual: toNumberOrNull(row?.eps ?? row?.epsActual ?? row?.actualEps),
        rev_estimate: toNumberOrNull(row?.revenueEstimated ?? row?.revenueEstimate ?? row?.estimatedRevenue),
        rev_actual: toNumberOrNull(row?.revenue ?? row?.revenueActual ?? row?.actualRevenue),
      };
    })
    .filter(Boolean);
}

async function fetchNewsRows(symbol) {
  const cutoff = daysAgo(NEWS_DAYS).toISOString();
  const url = `${FMP_STABLE_BASE_URL}/news/stock-latest?symbols=${encodeURIComponent(symbol)}&limit=100&apikey=${encodeURIComponent(FMP_API_KEY)}`;
  const payload = await fetchJsonWithRetry(url);
  const rows = Array.isArray(payload) ? payload : [];

  return rows
    .map((row) => {
      const publishedAt = toIsoTimestamp(row?.publishedDate || row?.published_at || row?.date);
      if (!publishedAt || publishedAt < cutoff) return null;
      return {
        symbol,
        published_at: publishedAt,
        headline: String(row?.title || row?.headline || '').trim(),
        source: String(row?.site || row?.source || '').trim() || null,
        url: String(row?.url || '').trim() || null,
      };
    })
    .filter((row) => row && row.headline);
}

async function processBatch({
  pool,
  currentPhase,
  table,
  onConflict,
  fetchRowsForSymbol,
  batchSymbols,
  batchOffset,
  state,
  universe,
}) {
  let attempt = 0;

  while (attempt < RETRY_ATTEMPTS) {
    attempt += 1;

    try {
      const beforeCount = await countRowsBySymbols(pool, table, batchSymbols);
      let apiPayloadCount = 0;

      for (const symbol of batchSymbols) {
        const rows = await fetchRowsForSymbol(symbol);
        if (Array.isArray(rows) && rows.length) {
          apiPayloadCount += rows.length;
          await upsertRows(pool, table, rows, onConflict);
        }
        await sleep(RATE_LIMIT_MS);
      }

      if (apiPayloadCount <= 0) {
        throw new FatalIngestionError('API_EMPTY_PAYLOAD', {
          phase: currentPhase,
          symbols: batchSymbols,
        });
      }

      const afterCount = await countRowsBySymbols(pool, table, batchSymbols);
      if (afterCount <= 0) {
        throw new FatalIngestionError('DB_VALIDATION_EMPTY', {
          phase: currentPhase,
          symbols: batchSymbols,
          beforeCount,
          afterCount,
        });
      }

      const delta = Math.max(0, afterCount - beforeCount);
      const globalIndex = state.last_symbol_index + batchOffset + batchSymbols.length;

      if (currentPhase === 'intraday' && delta === 0) {
        console.log(JSON.stringify({
          event: 'INTRADAY_NO_DATA',
          batch_offset: batchOffset,
          timestamp: new Date().toISOString(),
        }));
        return globalIndex;
      }

      await checkpointBatch(pool, globalIndex, currentPhase);

      console.log(JSON.stringify({
        phase: currentPhase,
        batch_index: batchOffset,
        batch_size: batchSymbols.length,
        total_symbols: universe.length,
        global_index: globalIndex,
        timestamp: new Date().toISOString(),
      }));

      return globalIndex;
    } catch (error) {
      if (error instanceof FatalIngestionError) {
        throw error;
      }
      if (attempt >= RETRY_ATTEMPTS) {
        throw new FatalIngestionError('BATCH_RETRY_EXHAUSTED', {
          phase: currentPhase,
          symbols: batchSymbols,
          message: error?.message || String(error),
        });
      }
      await sleep(500 * attempt);
    }
  }

  throw new FatalIngestionError('UNREACHABLE_BATCH_FAILURE', { phase: currentPhase });
}

async function runPhase({
  pool,
  state,
  universe,
  currentPhase,
  table,
  onConflict,
  batchSize,
  fetchRowsForSymbol,
}) {
  const phaseStartIndex = state.last_symbol_index;
  const symbolsToProcess = universe.slice(state.last_symbol_index);
  let completedBatches = 0;

  for (let i = 0; i < symbolsToProcess.length; i += batchSize) {
    const batchSymbols = symbolsToProcess.slice(i, i + batchSize);

    const globalIndex = await processBatch({
      pool,
      currentPhase,
      table,
      onConflict,
      fetchRowsForSymbol,
      batchSymbols,
      batchOffset: i,
      state,
      universe,
    });

    state.last_symbol_index = globalIndex;
    state.phase = currentPhase;
    state.status = 'running';
    heartbeatState.phase = state.phase;
    heartbeatState.last_symbol_index = state.last_symbol_index;

    const symbolIndex = phaseStartIndex + i + batchSymbols.length;
    const totalSymbols = universe.length;
    const percent = ((symbolIndex / totalSymbols) * 100).toFixed(2);

    console.log(JSON.stringify({
      event: 'PROGRESS',
      phase: currentPhase,
      processed: symbolIndex,
      total: totalSymbols,
      percent_complete: percent,
      timestamp: new Date().toISOString(),
    }));

    completedBatches += 1;

    await new Promise((res) => setTimeout(res, 400));
    if (completedBatches % 10 === 0) {
      await new Promise((res) => setTimeout(res, 2000));
    }
  }
}

async function runUniversePhase(pool) {
  let universe = await loadUniverseFromFile();
  if (!universe || !universe.length) {
    universe = await buildUniverse();
  }
  if (!universe || !universe.length) {
    throw new FatalIngestionError('UNIVERSE_EMPTY');
  }

  await transitionPhase(pool, 'daily');
  return universe;
}

async function getUniverse() {
  let universe = await loadUniverseFromFile();
  if (!universe || !universe.length) {
    universe = await buildUniverse();
  }
  if (!universe || !universe.length) {
    throw new FatalIngestionError('UNIVERSE_EMPTY');
  }
  return universe;
}

async function main() {
  let pool = null;
  let state = { phase: 'universe', last_symbol_index: 0, status: 'running' };

  try {
    if (!SUPABASE_DB_URL) throw new FatalIngestionError('MISSING_DATABASE_URL');
    if (!FMP_API_KEY) throw new FatalIngestionError('MISSING_FMP_API_KEY');

    pool = await createPool();
    state = await loadIngestionState(pool);
    heartbeatState.phase = state.phase;
    heartbeatState.last_symbol_index = state.last_symbol_index;

    console.log(JSON.stringify({
      event: 'RESUME_STATE',
      phase: state.phase,
      last_symbol_index: state.last_symbol_index,
      status: state.status,
      timestamp: new Date().toISOString(),
    }));

    if (state.status === 'complete' || state.phase === 'complete') {
      state.status = 'complete';
      state.phase = 'complete';
      heartbeatState.phase = state.phase;
      heartbeatState.last_symbol_index = state.last_symbol_index;
    }

    if (!['running', 'error', 'idle'].includes(state.status)) {
      state.status = 'running';
    }

    let universe = null;

    if (state.phase === 'universe') {
      universe = await runUniversePhase(pool);
      console.log(JSON.stringify({
        event: 'PHASE_COMPLETE',
        phase: 'universe',
        total_symbols: universe.length,
        timestamp: new Date().toISOString(),
      }));
      state.phase = 'daily';
      state.last_symbol_index = 0;
      state.status = 'running';
      heartbeatState.phase = state.phase;
      heartbeatState.last_symbol_index = state.last_symbol_index;
    }

    universe = universe || await getUniverse();

    while (state.phase !== 'complete') {
      if (state.phase === 'daily') {
        await runPhase({
          pool,
          state,
          universe,
          currentPhase: 'daily',
          table: 'daily_ohlc',
          onConflict: 'symbol,date',
          batchSize: BATCH_SIZE.daily,
          fetchRowsForSymbol: fetchDailyRows,
        });
        console.log(JSON.stringify({
          event: 'PHASE_COMPLETE',
          phase: 'daily',
          total_symbols: universe.length,
          timestamp: new Date().toISOString(),
        }));
        const nextPhase = PHASE_TO_NEXT.daily;
        await transitionPhase(pool, nextPhase);
        state.phase = nextPhase;
        state.last_symbol_index = 0;
        heartbeatState.phase = state.phase;
        heartbeatState.last_symbol_index = state.last_symbol_index;
        continue;
      }

      if (state.phase === 'intraday') {
        await runPhase({
          pool,
          state,
          universe,
          currentPhase: 'intraday',
          table: 'intraday_1m',
          onConflict: 'symbol,timestamp',
          batchSize: BATCH_SIZE.intraday,
          fetchRowsForSymbol: fetchIntradayRows,
        });
        console.log(JSON.stringify({
          event: 'PHASE_COMPLETE',
          phase: 'intraday',
          total_symbols: universe.length,
          timestamp: new Date().toISOString(),
        }));
        await runIntradayRetention(pool);
        const nextPhase = PHASE_TO_NEXT.intraday;
        await transitionPhase(pool, nextPhase);
        state.phase = nextPhase;
        state.last_symbol_index = 0;
        heartbeatState.phase = state.phase;
        heartbeatState.last_symbol_index = state.last_symbol_index;
        continue;
      }

      if (state.phase === 'earnings') {
        await runPhase({
          pool,
          state,
          universe,
          currentPhase: 'earnings',
          table: 'earnings_events',
          onConflict: 'symbol,report_date',
          batchSize: BATCH_SIZE.earnings,
          fetchRowsForSymbol: fetchEarningsRows,
        });
        console.log(JSON.stringify({
          event: 'PHASE_COMPLETE',
          phase: 'earnings',
          total_symbols: universe.length,
          timestamp: new Date().toISOString(),
        }));
        const nextPhase = PHASE_TO_NEXT.earnings;
        await transitionPhase(pool, nextPhase);
        state.phase = nextPhase;
        state.last_symbol_index = 0;
        heartbeatState.phase = state.phase;
        heartbeatState.last_symbol_index = state.last_symbol_index;
        continue;
      }

      if (state.phase === 'news') {
        await runPhase({
          pool,
          state,
          universe,
          currentPhase: 'news',
          table: 'news_events',
          onConflict: 'symbol,published_at,headline',
          batchSize: BATCH_SIZE.news,
          fetchRowsForSymbol: fetchNewsRows,
        });

        console.log(JSON.stringify({
          event: 'PHASE_COMPLETE',
          phase: 'news',
          total_symbols: universe.length,
          timestamp: new Date().toISOString(),
        }));

        await markComplete(pool);
        state.phase = 'complete';
        state.status = 'complete';
        state.last_symbol_index = 0;
        heartbeatState.phase = state.phase;
        heartbeatState.last_symbol_index = state.last_symbol_index;

        console.log(JSON.stringify({
          event: 'INGESTION_COMPLETE',
          timestamp: new Date().toISOString(),
        }));
        break;
      }

      throw new FatalIngestionError('INVALID_PHASE', { phase: state.phase });
    }

    if (state.status === 'complete') {
      console.log(JSON.stringify({
        event: 'PROCESS_EXIT',
        phase: state.phase,
        timestamp: new Date().toISOString(),
      }));

      if (pool) {
        await pool.end();
      }

      process.exit(0);
    }

    throw new FatalIngestionError('INCOMPLETE_EXIT_STATE', {
      phase: state.phase,
      status: state.status,
    });
  } catch (error) {
    console.error(JSON.stringify({
      event: 'FATAL_ERROR',
      phase: state.phase,
      message: error?.message,
      stack: error?.stack,
      timestamp: new Date().toISOString(),
    }));

    if (pool) {
      await pool.end();
    }

    process.exit(1);
  }
}

main();
