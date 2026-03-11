const axios = require('axios');
const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');

async function ensureEarningsTable() {
  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS earnings_events (
      symbol TEXT,
      company TEXT,
      earnings_date DATE,
      time TEXT,
      eps_estimate NUMERIC,
      revenue_estimate NUMERIC,
      sector TEXT,
      updated_at TIMESTAMPTZ DEFAULT now()
    )`,
    [],
    { timeoutMs: 5000, label: 'engines.earningsEngine.ensure_table', maxRetries: 0 }
  );

  await queryWithTimeout(
    `ALTER TABLE earnings_events
      ADD COLUMN IF NOT EXISTS company TEXT,
      ADD COLUMN IF NOT EXISTS earnings_date DATE,
      ADD COLUMN IF NOT EXISTS time TEXT,
      ADD COLUMN IF NOT EXISTS eps_estimate NUMERIC,
      ADD COLUMN IF NOT EXISTS revenue_estimate NUMERIC,
      ADD COLUMN IF NOT EXISTS sector TEXT,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now()`,
    [],
    { timeoutMs: 5000, label: 'engines.earningsEngine.ensure_columns', maxRetries: 0 }
  );

  await queryWithTimeout(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_earnings_events_symbol_date
      ON earnings_events (symbol, earnings_date)`,
    [],
    { timeoutMs: 5000, label: 'engines.earningsEngine.ensure_index', maxRetries: 0 }
  );
}

function normalizeEarningsRow(row) {
  const symbol = String(row?.symbol || '').trim().toUpperCase();
  if (!symbol) return null;

  const dateValue = row?.date || row?.earningsDate || row?.reportDate || null;
  if (!dateValue) return null;

  return {
    symbol,
    company: row?.company || row?.name || null,
    earnings_date: dateValue,
    time: row?.time || row?.hour || row?.when || null,
    eps_estimate: row?.epsEstimated ?? row?.epsEstimate ?? null,
    revenue_estimate: row?.revenueEstimated ?? row?.revenueEstimate ?? null,
    sector: row?.sector || row?.industry || null,
  };
}

async function runEarningsEngine() {
  const startedAt = Date.now();
  await ensureEarningsTable();

  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey || apiKey === 'REQUIRED') {
    logger.warn('Earnings engine skipped: FMP_API_KEY missing');
    return { ingested: 0, runtimeMs: Date.now() - startedAt, skipped: true };
  }

  const today = new Date();
  const toDate = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
  const from = today.toISOString().slice(0, 10);
  const to = toDate.toISOString().slice(0, 10);

  const url = `https://financialmodelingprep.com/stable/earning_calendar?from=${from}&to=${to}&apikey=${encodeURIComponent(apiKey)}`;
  const response = await axios.get(url, { timeout: 20000 });
  const rawRows = Array.isArray(response.data) ? response.data : [];
  const rows = rawRows.map(normalizeEarningsRow).filter(Boolean);

  for (const row of rows) {
    await queryWithTimeout(
      `INSERT INTO earnings_events (symbol, company, earnings_date, time, eps_estimate, revenue_estimate, sector, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (symbol, earnings_date)
       DO UPDATE SET
         company = EXCLUDED.company,
         time = EXCLUDED.time,
         eps_estimate = EXCLUDED.eps_estimate,
         revenue_estimate = EXCLUDED.revenue_estimate,
         sector = EXCLUDED.sector,
         updated_at = now()`,
      [row.symbol, row.company, row.earnings_date, row.time, row.eps_estimate, row.revenue_estimate, row.sector],
      { timeoutMs: 5000, label: 'engines.earningsEngine.upsert', maxRetries: 0 }
    );
  }

  const runtimeMs = Date.now() - startedAt;
  logger.info('Earnings engine complete', { ingested: rows.length, runtimeMs, from, to });
  return { ingested: rows.length, runtimeMs, from, to };
}

module.exports = {
  runEarningsEngine,
};
