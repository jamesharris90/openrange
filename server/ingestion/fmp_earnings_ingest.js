const { runEarningsIngestionEngine } = require('../engines/earningsIngestionEngine');

const ALLOWED_EXCHANGES = new Set(['NASDAQ', 'NYSE', 'AMEX']);

function toUtcDateOnly(input) {
  const parsed = new Date(input);
  if (!Number.isFinite(parsed.getTime())) return null;
  const year = parsed.getUTCFullYear();
  const month = String(parsed.getUTCMonth() + 1).padStart(2, '0');
  const day = String(parsed.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addUtcDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function normalizeSession(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (raw === 'bmo' || raw.includes('before')) return 'BMO';
  if (raw === 'amc' || raw.includes('after')) return 'AMC';
  return 'BMO';
}

function normalizeNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeExchange(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return null;
  if (raw.includes('NASDAQ')) return 'NASDAQ';
  if (raw.includes('NYSE')) return 'NYSE';
  if (raw.includes('AMEX') || raw.includes('NYSEAMERICAN') || raw.includes('AMERICAN')) return 'AMEX';
  return raw;
}

function inferUsExchangeFromSymbol(symbol) {
  const value = String(symbol || '').trim().toUpperCase();
  if (!value) return null;

  const base = value.replace(/[-.][A-Z]$/, '');
  const isUsLike = /^[A-Z]{1,5}$/.test(base);
  return isUsLike ? 'NASDAQ' : null;
}

function sanitizePositiveNumber(value) {
  const n = normalizeNumber(value);
  return n != null && n > 0 ? n : null;
}

function clampScore(value) {
  const n = normalizeNumber(value);
  if (n == null) return null;
  return Math.max(0, Math.min(100, n));
}

function calculateScore(row) {
  const expectedMove = sanitizePositiveNumber(row.expected_move_percent) ?? 0;
  const rvol = sanitizePositiveNumber(row.rvol) ?? 0;
  const marketCap = sanitizePositiveNumber(row.market_cap);
  const avgVolume = sanitizePositiveNumber(row.avg_volume) ?? 0;

  const expectedNorm = Math.max(0, Math.min(1, expectedMove / 15));
  const rvolNorm = Math.max(0, Math.min(1, rvol / 5));
  const marketCapNorm = marketCap != null
    ? Math.max(0, Math.min(1, (Math.log10(marketCap) - 6) / 6))
    : 0;
  const liquidityScore = avgVolume > 1_000_000 ? 1 : 0;
  const score = (expectedNorm * 40)
    + (rvolNorm * 30)
    + (marketCapNorm * 10)
    + (liquidityScore * 20);
  return clampScore(score);
}

function normalizeEarningsRows(payload, todayIso) {
  const rows = Array.isArray(payload) ? payload : [];
  const dedupe = new Map();
  let filteredOut = 0;

  for (const row of rows) {
    const symbol = mapFromProviderSymbol(normalizeSymbol(row?.symbol));
    const reportDate = toUtcDateOnly(row?.date || row?.reportDate || row?.report_date);
    const reportTime = normalizeSession(row?.time || row?.hour || row?.report_time);
    const providedExchange = normalizeExchange(
      row?.exchange
      ?? row?.exchangeShortName
      ?? row?.exchange_short_name
      ?? row?.exchangeName
      ?? row?.stockExchange
      ?? row?.stock_exchange
    );
    const inferredExchange = inferUsExchangeFromSymbol(symbol);
    const resolvedExchange = providedExchange || inferredExchange;

    if (!symbol || !reportDate) continue;
    if (reportDate < todayIso) continue;
    if (!resolvedExchange || !ALLOWED_EXCHANGES.has(resolvedExchange)) {
      filteredOut += 1;
      continue;
    }

    const key = `${symbol}|${reportDate}`;
    dedupe.set(key, {
      symbol,
      exchange: resolvedExchange,
      report_date: reportDate,
      report_time: reportTime,
      eps_estimate: normalizeNumber(row?.epsEstimated ?? row?.epsEstimate ?? row?.eps_estimate),
      eps_actual: normalizeNumber(row?.eps ?? row?.epsActual ?? row?.eps_actual),
      rev_estimate: normalizeNumber(
        row?.revenueEstimated
        ?? row?.revenueEstimate
        ?? row?.revEstimated
        ?? row?.revEstimate
        ?? row?.revenue_estimate
        ?? row?.rev_estimate
      ),
      rev_actual: normalizeNumber(row?.revenue ?? row?.revenueActual ?? row?.revActual ?? row?.rev_actual),
      price: null,
      market_cap: null,
      expected_move_percent: null,
      avg_volume: null,
      current_volume: null,
      rvol: null,
      atr: null,
      score: null,
      updated_at: new Date().toISOString(),
    });
  }

  const dedupedRows = Array.from(dedupe.values());
  logger.info('EARNINGS FILTERED', {
    removed: filteredOut,
    kept: dedupedRows.length,
  });

  return dedupedRows;
}

async function ensureEarningsSchema() {
  await queryWithTimeout(
    `ALTER TABLE earnings_events
       ADD COLUMN IF NOT EXISTS exchange TEXT,
       ADD COLUMN IF NOT EXISTS price NUMERIC,
       ADD COLUMN IF NOT EXISTS market_cap NUMERIC,
       ADD COLUMN IF NOT EXISTS expected_move_percent NUMERIC,
       ADD COLUMN IF NOT EXISTS avg_volume NUMERIC,
       ADD COLUMN IF NOT EXISTS current_volume NUMERIC,
       ADD COLUMN IF NOT EXISTS rvol NUMERIC,
       ADD COLUMN IF NOT EXISTS atr NUMERIC,
       ADD COLUMN IF NOT EXISTS score NUMERIC`,
    [],
    {
      timeoutMs: 7000,
      label: 'ingest.earnings.ensure_columns',
      maxRetries: 0,
      poolType: 'write',
    }
  );

  await queryWithTimeout(
    `DO $$
     BEGIN
       IF NOT EXISTS (
         SELECT 1 FROM pg_constraint
         WHERE conname = 'earnings_events_symbol_report_date_key'
           AND conrelid = 'earnings_events'::regclass
       ) THEN
         ALTER TABLE earnings_events
         ADD CONSTRAINT earnings_events_symbol_report_date_key UNIQUE (symbol, report_date);
       END IF;
     END$$`,
    [],
    {
      timeoutMs: 7000,
      label: 'ingest.earnings.ensure_unique',
      maxRetries: 0,
      poolType: 'write',
    }
  );
}

async function enrichRows(rows) {
  if (!rows.length) return rows;
  const symbols = [...new Set(rows.map((row) => row.symbol).filter(Boolean))];
  if (!symbols.length) return rows;

  const result = await queryWithTimeout(
    `SELECT
       s.symbol,
       COALESCE((to_jsonb(q)->>'price')::numeric, (to_jsonb(q)->>'last')::numeric) AS price,
       COALESCE((to_jsonb(q)->>'market_cap')::numeric, (to_jsonb(q)->>'marketCap')::numeric) AS market_cap,
       COALESCE((to_jsonb(m)->>'avg_volume')::numeric, (to_jsonb(m)->>'average_volume')::numeric, (to_jsonb(m)->>'volume_avg')::numeric) AS avg_volume,
      COALESCE((to_jsonb(m)->>'current_volume')::numeric, (to_jsonb(m)->>'volume')::numeric, (to_jsonb(m)->>'currentVolume')::numeric, (to_jsonb(q)->>'volume')::numeric) AS current_volume,
      COALESCE((to_jsonb(m)->>'relative_volume')::numeric, (to_jsonb(m)->>'rvol')::numeric) AS rvol,
       COALESCE((to_jsonb(m)->>'atr')::numeric, (to_jsonb(m)->>'atr_14')::numeric, (to_jsonb(m)->>'atr14')::numeric) AS atr,
       COALESCE((to_jsonb(m)->>'iv_expected_move_percent')::numeric, (to_jsonb(m)->>'expected_move_percent')::numeric) AS expected_move_percent
     FROM (SELECT unnest($1::text[]) AS symbol) s
     LEFT JOIN market_quotes q ON q.symbol = s.symbol
     LEFT JOIN market_metrics m ON m.symbol = s.symbol`,
    [symbols],
    {
      timeoutMs: 6000,
      label: 'ingest.earnings.enrichment',
      maxRetries: 1,
      retryDelayMs: 100,
    }
  );

  const bySymbol = new Map();
  for (const row of result.rows || []) {
    const expectedRaw = sanitizePositiveNumber(row.expected_move_percent);
    const atr = sanitizePositiveNumber(row.atr);
    const price = sanitizePositiveNumber(row.price);
    const marketCap = sanitizePositiveNumber(row.market_cap);
    const avgVolume = sanitizePositiveNumber(row.avg_volume);
    const currentVolume = sanitizePositiveNumber(row.current_volume);
    const rvolFromVolumes = avgVolume != null && currentVolume != null && avgVolume > 0
      ? currentVolume / avgVolume
      : null;
    const rvol = rvolFromVolumes ?? sanitizePositiveNumber(row.rvol);
    const derived = expectedRaw ?? ((atr != null && price != null && price > 0) ? (atr / price) * 100 : null);
    bySymbol.set(row.symbol, {
      price,
      market_cap: marketCap,
      expected_move_percent: sanitizePositiveNumber(derived),
      avg_volume: avgVolume,
      current_volume: currentVolume,
      rvol: sanitizePositiveNumber(rvol),
      atr,
    });
  }

  return rows.map((row) => {
    const enrich = bySymbol.get(row.symbol) || {};
    const merged = {
      ...row,
      price: enrich.price ?? null,
      market_cap: enrich.market_cap ?? null,
      expected_move_percent: enrich.expected_move_percent ?? null,
      avg_volume: enrich.avg_volume ?? null,
      current_volume: enrich.current_volume ?? null,
      rvol: enrich.rvol ?? null,
      atr: enrich.atr ?? null,
    };

    return {
      ...merged,
      score: calculateScore(merged),
    };
  });
}

async function replaceEarningsRows(rows) {
  await queryWithTimeout('DELETE FROM earnings_events', [], {
    timeoutMs: 15000,
    label: 'ingest.earnings.reset',
    maxRetries: 0,
    poolType: 'write',
  });

  if (!rows.length) return 0;

  const result = await queryWithTimeout(
    `WITH payload AS (
       SELECT *
       FROM json_to_recordset($1::json) AS x(
         symbol text,
         exchange text,
         report_date date,
         report_time text,
         eps_estimate numeric,
         eps_actual numeric,
         rev_estimate numeric,
         rev_actual numeric,
         price numeric,
         market_cap numeric,
         expected_move_percent numeric,
         avg_volume numeric,
         current_volume numeric,
         rvol numeric,
         atr numeric,
         score numeric,
         updated_at timestamptz
       )
     ), inserted AS (
       INSERT INTO earnings_events (
         symbol,
         exchange,
         report_date,
         report_time,
         eps_estimate,
         eps_actual,
         rev_estimate,
         rev_actual,
         price,
         market_cap,
         expected_move_percent,
         avg_volume,
         current_volume,
         rvol,
         atr,
         score,
         updated_at
       )
       SELECT
         symbol,
         exchange,
         report_date,
         report_time,
         eps_estimate,
         eps_actual,
         rev_estimate,
         rev_actual,
         price,
         market_cap,
         expected_move_percent,
         avg_volume,
         current_volume,
         rvol,
         atr,
         score,
         updated_at
       FROM payload
       WHERE symbol IS NOT NULL
         AND NULLIF(BTRIM(symbol), '') IS NOT NULL
         AND exchange = ANY($2::text[])
         AND report_date IS NOT NULL
         AND report_date >= CURRENT_DATE
         AND price IS NOT NULL
         AND price > 0
         AND score IS NOT NULL
       ON CONFLICT (symbol, report_date)
       DO UPDATE SET
         exchange = EXCLUDED.exchange,
         report_time = EXCLUDED.report_time,
         eps_estimate = EXCLUDED.eps_estimate,
         eps_actual = EXCLUDED.eps_actual,
         rev_estimate = EXCLUDED.rev_estimate,
         rev_actual = EXCLUDED.rev_actual,
         price = EXCLUDED.price,
         market_cap = EXCLUDED.market_cap,
         expected_move_percent = EXCLUDED.expected_move_percent,
         avg_volume = EXCLUDED.avg_volume,
         current_volume = EXCLUDED.current_volume,
         rvol = EXCLUDED.rvol,
         atr = EXCLUDED.atr,
         score = EXCLUDED.score,
         updated_at = EXCLUDED.updated_at
       RETURNING 1
     )
     SELECT COUNT(*)::int AS inserted FROM inserted`,
    [JSON.stringify(rows), Array.from(ALLOWED_EXCHANGES)],
    {
      timeoutMs: 30000,
      label: 'ingest.earnings.insert',
      maxRetries: 0,
      poolType: 'write',
    }
  );

  return Number(result.rows?.[0]?.inserted || 0);
}

async function runEarningsIngestion() {
  return runEarningsIngestionEngine();
}

module.exports = {
  runEarningsIngestion,
};
