// @ts-nocheck
/**
 * candleUpdateService.ts
 *
 * Incremental FMP → Supabase update service.
 * Called by schedulerService.ts (daily close + news) and phaseScheduler.js (intraday during market hours).
 *
 * Exports:
 *   updateDailyOhlc(symbols, lookbackDays?)   — upsert latest daily bars into daily_ohlc
 *   updateIntraday1m(symbols, lookbackDays?)  — upsert latest 1m bars into intraday_1m + run retention
 *   updateNewsEvents(symbols, limit?)         — upsert latest news into news_events + run retention
 */

const pool = require('../pg'); // server/pg.js exports the Pool instance directly

const FMP_BASE = 'https://financialmodelingprep.com/stable';
const RATE_LIMIT_MS = 120;
const RETRY_ATTEMPTS = 3;
const UPSERT_CHUNK = 500;

// ─────────────────────────────────────────────────────────
// Shared utilities
// ─────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toVol(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  const MAX_BIGINT = 9223372036854775807;
  return Math.min(Math.floor(n), MAX_BIGINT);
}

function toIsoDate(v) {
  const raw = String(v || '').trim();
  if (!raw) return null;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

function toIsoTs(v) {
  const raw = String(v || '').trim();
  if (!raw) return null;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function logUpdate(event, extra = {}) {
  console.log(JSON.stringify({ event, timestamp: new Date().toISOString(), ...extra }));
}

async function fetchWithRetry(url, attempt = 1) {
  try {
    const res = await fetch(url);
    if (res.status === 429 || res.status >= 500) {
      if (attempt < RETRY_ATTEMPTS) {
        await sleep(Math.min(500 * 2 ** (attempt - 1), 6000));
        return fetchWithRetry(url, attempt + 1);
      }
      return [];
    }
    if (res.status === 404) return [];
    if (!res.ok) return [];
    return res.json();
  } catch (_err) {
    if (attempt < RETRY_ATTEMPTS) {
      await sleep(Math.min(500 * 2 ** (attempt - 1), 6000));
      return fetchWithRetry(url, attempt + 1);
    }
    return [];
  }
}

async function upsertRows(table, rows, conflictCols, updateCols) {
  if (!rows.length) return 0;
  const chunks = chunkArray(rows, UPSERT_CHUNK);
  let inserted = 0;

  for (const chunk of chunks) {
    const cols = Object.keys(chunk[0]);
    const values = [];
    const placeholders = chunk.map((row, ri) => {
      const ph = cols.map((col, ci) => {
        values.push(row[col]);
        return `$${ri * cols.length + ci + 1}`;
      });
      return `(${ph.join(', ')})`;
    });

    const quoted = (c) => `"${c}"`;
    const setCols = updateCols || cols.filter((c) => !conflictCols.includes(c));
    const setClause = setCols.length
      ? `DO UPDATE SET ${setCols.map((c) => `${quoted(c)} = EXCLUDED.${quoted(c)}`).join(', ')}`
      : 'DO NOTHING';

    const sql = `
      INSERT INTO ${quoted(table)} (${cols.map(quoted).join(', ')})
      VALUES ${placeholders.join(', ')}
      ON CONFLICT (${conflictCols.map(quoted).join(', ')})
      ${setClause}
    `;
    await pool.query(sql, values);
    inserted += chunk.length;
  }

  return inserted;
}

// ─────────────────────────────────────────────────────────
// updateDailyOhlc
// ─────────────────────────────────────────────────────────

/**
 * Fetch last `lookbackDays` of daily bars for each symbol from FMP and upsert into daily_ohlc.
 * @param {string[]} symbols
 * @param {number} lookbackDays defaults to 3 (covers weekends + today)
 */
async function updateDailyOhlc(symbols, lookbackDays = 3) {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) { logUpdate('DAILY_UPDATE_SKIP', { reason: 'no FMP_API_KEY' }); return; }

  const fromDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  const toDate = new Date().toISOString().slice(0, 10);

  const batches = chunkArray(symbols, 50);
  let processed = 0;

  for (const batch of batches) {
    for (const symbol of batch) {
      try {
        const url = `${FMP_BASE}/historical-chart/1day?symbol=${encodeURIComponent(symbol)}&from=${fromDate}&to=${toDate}&apikey=${encodeURIComponent(apiKey)}`;
        const raw = await fetchWithRetry(url);
        const rows = (Array.isArray(raw) ? raw : [])
          .map((r) => {
            const date = toIsoDate(r?.date);
            if (!date || date < fromDate) return null;
            return {
              symbol,
              date,
              open: toNum(r?.open),
              high: toNum(r?.high),
              low: toNum(r?.low),
              close: toNum(r?.close),
              volume: toVol(r?.volume),
            };
          })
          .filter(Boolean);

        if (rows.length) {
          await upsertRows('daily_ohlc', rows, ['symbol', 'date'], ['open', 'high', 'low', 'close', 'volume']);
        }
        await sleep(RATE_LIMIT_MS);
      } catch (err) {
        logUpdate('DAILY_UPDATE_SYMBOL_ERROR', { symbol, error: err?.message });
      }
    }

    processed += batch.length;
    if (processed % 500 === 0) {
      logUpdate('DAILY_UPDATE_PROGRESS', { processed, total: symbols.length });
    }
  }

  logUpdate('DAILY_UPDATE_COMPLETE', { symbols: symbols.length, fromDate, toDate });
}

// ─────────────────────────────────────────────────────────
// updateIntraday1m
// ─────────────────────────────────────────────────────────

/**
 * Fetch last `lookbackDays` of 1-minute bars for each symbol from FMP and upsert into intraday_1m.
 * Also runs 30-day retention cleanup.
 * @param {string[]} symbols
 * @param {number} lookbackDays defaults to 1 (today only during market hours)
 */
async function updateIntraday1m(symbols, lookbackDays = 1) {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) { logUpdate('INTRADAY_UPDATE_SKIP', { reason: 'no FMP_API_KEY' }); return; }

  const nowNY = new Date().toLocaleString('en-US', {
    timeZone: 'America/New_York',
  });
  const nyNowDate = new Date(nowNY);

  const fromDate = new Date(nyNowDate.getTime() - lookbackDays * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  const toDate = nyNowDate.toISOString().slice(0, 10);

  const batches = chunkArray(symbols, 20);
  let processed = 0;
  let totalInserted = 0;

  for (const batch of batches) {
    for (const symbol of batch) {
      try {
        console.log('[INGESTION] Starting intraday fetch from FMP');
        const url = `${FMP_BASE}/historical-chart/1min?symbol=${encodeURIComponent(symbol)}&from=${fromDate}&to=${toDate}&apikey=${encodeURIComponent(apiKey)}`;
        const raw = await fetchWithRetry(url);
        const rows = (Array.isArray(raw) ? raw : [])
          .map((r) => {
            const ts = toIsoTs(r?.date || r?.datetime);
            if (!ts) return null;
            return {
              symbol,
              timestamp: ts,
              open: toNum(r?.open),
              high: toNum(r?.high),
              low: toNum(r?.low),
              close: toNum(r?.close),
              volume: toVol(r?.volume),
            };
          })
          .filter(Boolean);

        if (rows.length) {
          const insertedBars = await upsertRows('intraday_1m', rows, ['symbol', 'timestamp'], ['open', 'high', 'low', 'close', 'volume']);
          console.log('[INGESTION] Inserted intraday bars:', insertedBars);
          totalInserted += Number(insertedBars || 0);
        } else {
          console.log('[INGESTION] FMP returned zero rows');
        }
        await sleep(RATE_LIMIT_MS);
      } catch (err) {
        logUpdate('INTRADAY_UPDATE_SYMBOL_ERROR', { symbol, error: err?.message });
      }
    }

    processed += batch.length;
    if (processed % 200 === 0) {
      logUpdate('INTRADAY_UPDATE_PROGRESS', { processed, total: symbols.length });
    }
  }

  // Retention: delete rows older than 7 days
  try {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const result = await pool.query(
      `DELETE FROM intraday_1m WHERE "timestamp" < $1`,
      [cutoff],
    );
    logUpdate('INTRADAY_RETENTION', { rows_deleted: result.rowCount || 0, cutoff });
  } catch (err) {
    logUpdate('INTRADAY_RETENTION_ERROR', { error: err?.message });
  }

  logUpdate('INTRADAY_UPDATE_COMPLETE', { symbols: symbols.length, fromDate, toDate });
  return {
    symbols: symbols.length,
    rows_processed: totalInserted,
  };
}

// ─────────────────────────────────────────────────────────
// updateNewsEvents
// ─────────────────────────────────────────────────────────

/**
 * Fetch latest news for each symbol from FMP and upsert into news_events.
 * Also runs 30-day retention cleanup.
 * @param {string[]} symbols
 * @param {number} limit  news items per symbol (default 25)
 */
async function updateNewsEvents(symbols, limit = 25) {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) { logUpdate('NEWS_UPDATE_SKIP', { reason: 'no FMP_API_KEY' }); return; }

  const cutoff = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();

  // FMP news endpoint accepts comma-separated symbols (up to ~200)
  const batches = chunkArray(symbols, 200);
  let processed = 0;

  for (const batch of batches) {
    try {
      const symbolsParam = batch.join(',');
      const url = `${FMP_BASE}/news/stock-latest?symbols=${encodeURIComponent(symbolsParam)}&limit=${limit * batch.length}&apikey=${encodeURIComponent(apiKey)}`;
      const raw = await fetchWithRetry(url);
      const rows = (Array.isArray(raw) ? raw : [])
        .map((r) => {
          const publishedAt = toIsoTs(r?.publishedDate || r?.published_at || r?.date);
          if (!publishedAt || publishedAt < cutoff) return null;
          const headline = String(r?.title || r?.headline || '').trim();
          if (!headline) return null;
          const sym = String(r?.symbol || r?.ticker || '').trim().toUpperCase();
          if (!sym || !batch.includes(sym)) return null;
          return {
            symbol: sym,
            published_at: publishedAt,
            headline,
            source: String(r?.site || r?.source || '').trim() || null,
            url: String(r?.url || '').trim() || null,
          };
        })
        .filter(Boolean);

      if (rows.length) {
        await upsertRows('news_events', rows, ['symbol', 'published_at', 'headline'], ['source', 'url']);
      }
      await sleep(RATE_LIMIT_MS);
    } catch (err) {
      logUpdate('NEWS_UPDATE_BATCH_ERROR', { error: err?.message });
    }

    processed += batch.length;
    if (processed % 1000 === 0) {
      logUpdate('NEWS_UPDATE_PROGRESS', { processed, total: symbols.length });
    }
  }

  // Retention: delete news older than 30 days
  try {
    const retCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const result = await pool.query(
      `DELETE FROM news_events WHERE published_at < $1`,
      [retCutoff],
    );
    logUpdate('NEWS_RETENTION', { rows_deleted: result.rowCount || 0 });
  } catch (err) {
    logUpdate('NEWS_RETENTION_ERROR', { error: err?.message });
  }

  logUpdate('NEWS_UPDATE_COMPLETE', { symbols: symbols.length });
}

// ─────────────────────────────────────────────────────────
// updateEarningsEvents
// ─────────────────────────────────────────────────────────

/**
 * Fetch earnings calendar from FMP for a rolling window around today and upsert
 * into earnings_events.  Uses the date-range endpoint (one request per window)
 * rather than per-symbol to stay within FMP rate limits.
 *
 * @param {string[]} symbols      Universe to filter against (only these symbols are upserted)
 * @param {number}   lookbackDays Days into the past to include (default 90)
 * @param {number}   futureDays   Days into the future to include (default 90)
 */
async function updateEarningsEvents(symbols, lookbackDays = 90, futureDays = 90) {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) { logUpdate('EARNINGS_UPDATE_SKIP', { reason: 'no FMP_API_KEY' }); return; }

  const fromDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  const toDate = new Date(Date.now() + futureDays * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);

  const symbolSet = new Set(symbols.map((s) => String(s || '').toUpperCase()).filter(Boolean));

  try {
    const url = `${FMP_BASE}/earnings-calendar?from=${fromDate}&to=${toDate}&apikey=${encodeURIComponent(apiKey)}`;
    const raw = await fetchWithRetry(url);

    const rows = (Array.isArray(raw) ? raw : [])
      .filter((r) => symbolSet.has(String(r?.symbol || '').toUpperCase()))
      .map((r) => {
        const reportDate = toIsoDate(r?.date || r?.reportDate);
        if (!reportDate) return null;

        const epsEst = toNum(r?.epsEstimated ?? r?.epsEstimate);
        const epsAct = toNum(r?.eps ?? r?.epsActual);
        const revEst = toNum(r?.revenueEstimated ?? r?.revenueEstimate);
        const revAct = toNum(r?.revenue ?? r?.revenueActual);

        const epsSurprise =
          epsEst != null && epsAct != null && epsEst !== 0
            ? +(((epsAct - epsEst) / Math.abs(epsEst)) * 100).toFixed(2)
            : null;
        const revSurprise =
          revEst != null && revAct != null && revEst !== 0
            ? +(((revAct - revEst) / Math.abs(revEst)) * 100).toFixed(2)
            : null;

        return {
          symbol: String(r?.symbol || '').toUpperCase(),
          report_date: reportDate,
          report_time: String(r?.time || r?.reportTime || '').toLowerCase() || null,
          eps_estimate: epsEst,
          eps_actual: epsAct,
          rev_estimate: revEst,
          rev_actual: revAct,
          eps_surprise_pct: epsSurprise,
          rev_surprise_pct: revSurprise,
        };
      })
      .filter(Boolean);

    if (rows.length) {
      await upsertRows(
        'earnings_events',
        rows,
        ['symbol', 'report_date'],
        ['report_time', 'eps_estimate', 'eps_actual', 'rev_estimate', 'rev_actual', 'eps_surprise_pct', 'rev_surprise_pct'],
      );
    }

    logUpdate('EARNINGS_UPDATE_COMPLETE', { symbolsUniverse: symbols.length, rows: rows.length, fromDate, toDate });
  } catch (err) {
    logUpdate('EARNINGS_UPDATE_ERROR', { error: err?.message });
  }
}

// ─────────────────────────────────────────────────────────
// updateGlobalNewsEvents
// ─────────────────────────────────────────────────────────

/**
 * Fetch the global FMP news feeds (all stocks + general market) and upsert
 * into news_events.  Called on scheduler bootstrap and every 15 minutes.
 * This is the primary driver of the News Scanner feed — no symbol filter,
 * so it returns the full breadth of FMP's news stream.
 */
async function updateGlobalNewsEvents() {
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) { logUpdate('GLOBAL_NEWS_SKIP', { reason: 'no FMP_API_KEY' }); return; }

  const cutoff = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();

  // Parallel: stock news (all symbols, no filter) + general market news
  const [stockRes, generalRes] = await Promise.allSettled([
    fetchWithRetry(`${FMP_BASE}/news/stock-latest?limit=500&apikey=${encodeURIComponent(apiKey)}`),
    fetchWithRetry(`${FMP_BASE}/news/general-latest?limit=200&apikey=${encodeURIComponent(apiKey)}`),
  ]);

  const allRows = [];

  const stockItems = stockRes.status === 'fulfilled' && Array.isArray(stockRes.value) ? stockRes.value : [];
  for (const r of stockItems) {
    const publishedAt = toIsoTs(r?.publishedDate || r?.published_at || r?.date);
    if (!publishedAt || publishedAt < cutoff) continue;
    const headline = String(r?.title || r?.headline || '').trim();
    if (!headline) continue;
    const sym = String(r?.symbol || r?.ticker || '').trim().toUpperCase() || 'GENERAL';
    allRows.push({ symbol: sym, published_at: publishedAt, headline,
      source: String(r?.site || r?.source || '').trim() || null,
      url: String(r?.url || '').trim() || null });
  }

  const generalItems = generalRes.status === 'fulfilled' && Array.isArray(generalRes.value) ? generalRes.value : [];
  for (const r of generalItems) {
    const publishedAt = toIsoTs(r?.publishedDate || r?.published_at || r?.date);
    if (!publishedAt || publishedAt < cutoff) continue;
    const headline = String(r?.title || r?.headline || '').trim();
    if (!headline) continue;
    allRows.push({ symbol: 'GENERAL', published_at: publishedAt, headline,
      source: String(r?.site || r?.source || '').trim() || null,
      url: String(r?.url || '').trim() || null });
  }

  // Deduplicate by (symbol, published_at, headline) before upsert — FMP may return the same
  // article for multiple symbols in the same batch, causing PG "row affected twice" errors
  const seen = new Set();
  const uniqueRows = allRows.filter((r) => {
    const key = `${r.symbol}|${r.published_at}|${r.headline}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (uniqueRows.length) {
    await upsertRows('news_events', uniqueRows, ['symbol', 'published_at', 'headline'], ['source', 'url']);
  }

  try {
    const retCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const del = await pool.query(`DELETE FROM news_events WHERE published_at < $1`, [retCutoff]);
    logUpdate('NEWS_RETENTION', { rows_deleted: del.rowCount || 0 });
  } catch (err) {
    logUpdate('NEWS_RETENTION_ERROR', { error: err?.message });
  }

  logUpdate('GLOBAL_NEWS_UPDATE_COMPLETE', { stockItems: stockItems.length, generalItems: generalItems.length, upserted: uniqueRows.length });
}

module.exports = { updateDailyOhlc, updateIntraday1m, updateNewsEvents, updateEarningsEvents, updateGlobalNewsEvents };
