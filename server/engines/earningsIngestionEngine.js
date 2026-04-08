const { queryWithTimeout } = require('../db/pg');
const { normalizeReportTime: normalizeCanonicalReportTime } = require('../services/earningsIntelligence');
const { fmpFetch } = require('../services/fmpClient');
const logger = require('../utils/logger');

const UPCOMING_WINDOW_DAYS = 14;
const NEXT_EVENT_LOOKAHEAD_DAYS = 180;
const HISTORY_LIMIT = 8;
const DEFAULT_SYMBOL_LIMIT = 10000;
const DEFAULT_HISTORY_WINDOW_DAYS = Math.max(1, Number(process.env.EARNINGS_INGEST_HISTORY_WINDOW_DAYS) || 7);
const DEFAULT_HISTORY_FETCH_CONCURRENCY = Math.max(1, Number(process.env.EARNINGS_INGEST_HISTORY_FETCH_CONCURRENCY) || 6);

let ensureEarningsSchemaPromise = null;

function normalizeSymbol(value) {
  return String(value || '').trim().toUpperCase();
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toPositiveNumber(value) {
  const numeric = toNumber(value);
  return numeric !== null && numeric > 0 ? numeric : null;
}

function formatIsoDate(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function addUtcDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function normalizeReportDate(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const parsed = new Date(text);
  if (!Number.isFinite(parsed.getTime())) return null;
  return formatIsoDate(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
}

function normalizeReportTime(value) {
  const normalized = normalizeCanonicalReportTime(value);
  if (normalized === 'AM') return 'BMO';
  if (normalized === 'PM') return 'AMC';

  const text = String(value || '').trim();
  if (!text) return 'TBD';
  if (/^(tbd|n\/a|na|unknown|none|--|null)$/i.test(text)) return 'TBD';
  return text.toUpperCase();
}

function toNonEmptyString(value, fallback = null) {
  const text = String(value || '').trim();
  return text || fallback;
}

function calculateSurprisePercent(actual, estimate) {
  if (actual === null || estimate === null || estimate === 0) {
    return null;
  }

  return Number((((actual - estimate) / Math.abs(estimate)) * 100).toFixed(2));
}

async function ensureEarningsSchema() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS earnings_history (
       symbol TEXT NOT NULL,
       report_date DATE NOT NULL,
       report_time TEXT,
       eps_actual NUMERIC,
       eps_estimate NUMERIC,
       eps_surprise_pct NUMERIC,
       revenue_actual NUMERIC,
       revenue_estimate NUMERIC,
       revenue_surprise_pct NUMERIC,
       expected_move_percent NUMERIC,
       actual_move_percent NUMERIC,
       pre_move_percent NUMERIC,
       post_move_percent NUMERIC,
       true_reaction_window TEXT,
       pre_price NUMERIC,
       post_price NUMERIC,
       day1_close NUMERIC,
       day3_close NUMERIC,
       source TEXT NOT NULL DEFAULT 'fmp_stable_earnings_surprises',
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
       PRIMARY KEY (symbol, report_date)
     )`,
    `ALTER TABLE earnings_events
       ADD COLUMN IF NOT EXISTS report_date DATE,
       ADD COLUMN IF NOT EXISTS report_time TEXT,
       ADD COLUMN IF NOT EXISTS eps_estimate NUMERIC,
       ADD COLUMN IF NOT EXISTS eps_actual NUMERIC,
       ADD COLUMN IF NOT EXISTS rev_estimate NUMERIC,
       ADD COLUMN IF NOT EXISTS rev_actual NUMERIC,
       ADD COLUMN IF NOT EXISTS eps_surprise_pct NUMERIC,
       ADD COLUMN IF NOT EXISTS revenue_estimate NUMERIC,
       ADD COLUMN IF NOT EXISTS revenue_actual NUMERIC,
       ADD COLUMN IF NOT EXISTS company TEXT,
       ADD COLUMN IF NOT EXISTS sector TEXT,
       ADD COLUMN IF NOT EXISTS industry TEXT,
       ADD COLUMN IF NOT EXISTS exchange TEXT,
       ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'fmp_stable_earnings_calendar',
       ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`,
      `UPDATE earnings_events
         SET revenue_estimate = COALESCE(revenue_estimate, rev_estimate),
           revenue_actual = COALESCE(revenue_actual, rev_actual),
           rev_estimate = COALESCE(rev_estimate, revenue_estimate),
           rev_actual = COALESCE(rev_actual, revenue_actual),
           source = COALESCE(NULLIF(BTRIM(source), ''), 'fmp_stable_earnings_calendar'),
           updated_at = COALESCE(updated_at, NOW())`,
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
    `CREATE INDEX IF NOT EXISTS idx_earnings_history_symbol_date ON earnings_history (symbol, report_date DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_earnings_events_symbol_date ON earnings_events (symbol, report_date ASC)`,
    `UPDATE earnings_events
       SET report_time = 'TBD'
     WHERE report_time IS NULL OR NULLIF(BTRIM(report_time), '') IS NULL`,
    `DELETE FROM earnings_events
     WHERE report_date IS NULL OR eps_estimate IS NULL`,
    `DELETE FROM earnings_history
     WHERE report_date IS NULL OR eps_actual IS NULL`
  ];

  for (const statement of statements) {
    await queryWithTimeout(statement, [], {
      timeoutMs: 15000,
      label: 'earnings_ingestion.ensure_schema',
      maxRetries: 0,
      poolType: 'write',
    });
  }
}

async function ensureEarningsSchemaCached() {
  if (!ensureEarningsSchemaPromise) {
    ensureEarningsSchemaPromise = ensureEarningsSchema().catch((error) => {
      ensureEarningsSchemaPromise = null;
      throw error;
    });
  }

  return ensureEarningsSchemaPromise;
}

async function loadTopUniverseSymbols(limit = DEFAULT_SYMBOL_LIMIT) {
  const schemaResult = await queryWithTimeout(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'ticker_universe'`,
    [],
    {
      timeoutMs: 5000,
      label: 'earnings_ingestion.load_symbols_schema',
      maxRetries: 0,
    }
  );
  const columns = new Set((schemaResult.rows || []).map((row) => String(row.column_name || '').toLowerCase()));
  const orderBy = [];
  if (columns.has('market_cap')) {
    orderBy.push('market_cap DESC NULLS LAST');
  }
  if (columns.has('avg_volume')) {
    orderBy.push('avg_volume DESC NULLS LAST');
  } else if (columns.has('volume')) {
    orderBy.push('volume DESC NULLS LAST');
  }
  if (columns.has('price')) {
    orderBy.push('price DESC NULLS LAST');
  }
  orderBy.push('symbol ASC');

  const result = await queryWithTimeout(
    `WITH ranked AS (
       SELECT DISTINCT
         UPPER(TRIM(symbol)) AS symbol,
         ${columns.has('market_cap') ? 'market_cap' : 'NULL::numeric AS market_cap'},
         ${columns.has('avg_volume') ? 'avg_volume' : columns.has('volume') ? 'volume' : 'NULL::numeric AS avg_volume'},
         ${columns.has('price') ? 'price' : 'NULL::numeric AS price'}
       FROM ticker_universe
       WHERE symbol IS NOT NULL
         AND NULLIF(BTRIM(symbol), '') IS NOT NULL
     )
     SELECT symbol
     FROM ranked
     ORDER BY ${orderBy.join(', ')}
     LIMIT $1`,
    [limit],
    {
      timeoutMs: 10000,
      label: 'earnings_ingestion.load_symbols',
      maxRetries: 0,
    }
  );

  return (result.rows || []).map((row) => normalizeSymbol(row.symbol)).filter(Boolean);
}

async function loadMarketEnrichment(symbols) {
  if (!symbols.length) {
    return new Map();
  }

  const result = await queryWithTimeout(
    `SELECT
       s.symbol,
       COALESCE((to_jsonb(q)->>'price')::numeric, (to_jsonb(m)->>'price')::numeric) AS price,
       COALESCE((to_jsonb(q)->>'market_cap')::numeric, (to_jsonb(m)->>'market_cap')::numeric) AS market_cap,
       COALESCE((to_jsonb(m)->>'avg_volume')::numeric, (to_jsonb(m)->>'average_volume')::numeric, (to_jsonb(m)->>'volume_avg')::numeric) AS avg_volume,
       COALESCE((to_jsonb(m)->>'current_volume')::numeric, (to_jsonb(m)->>'volume')::numeric, (to_jsonb(q)->>'volume')::numeric) AS current_volume,
       COALESCE((to_jsonb(m)->>'relative_volume')::numeric, (to_jsonb(m)->>'rvol')::numeric) AS relative_volume,
       COALESCE((to_jsonb(m)->>'atr')::numeric, (to_jsonb(m)->>'atr_14')::numeric, (to_jsonb(m)->>'atr14')::numeric) AS atr,
       COALESCE((to_jsonb(m)->>'iv_expected_move_percent')::numeric, (to_jsonb(m)->>'expected_move_percent')::numeric) AS expected_move_percent,
       tu.company_name,
       tu.sector,
       tu.industry,
       tu.exchange
     FROM (SELECT unnest($1::text[]) AS symbol) s
     LEFT JOIN market_quotes q ON UPPER(q.symbol) = s.symbol
     LEFT JOIN market_metrics m ON UPPER(m.symbol) = s.symbol
     LEFT JOIN ticker_universe tu ON UPPER(tu.symbol) = s.symbol`,
    [symbols],
    {
      timeoutMs: 10000,
      label: 'earnings_ingestion.market_enrichment',
      maxRetries: 0,
    }
  );

  const enrichment = new Map();
  for (const row of result.rows || []) {
    const price = toPositiveNumber(row.price);
    const atr = toPositiveNumber(row.atr);
    const expectedMovePercent = toPositiveNumber(row.expected_move_percent)
      ?? (price !== null && atr !== null ? Number(((atr / price) * 100).toFixed(2)) : null);

    enrichment.set(normalizeSymbol(row.symbol), {
      price,
      market_cap: toPositiveNumber(row.market_cap),
      avg_volume: toPositiveNumber(row.avg_volume),
      current_volume: toPositiveNumber(row.current_volume),
      relative_volume: toPositiveNumber(row.relative_volume),
      atr,
      expected_move_percent: expectedMovePercent,
      company: row.company_name || null,
      sector: row.sector || null,
      industry: row.industry || null,
      exchange: row.exchange || null,
    });
  }

  return enrichment;
}

function normalizeUpcomingEvents(payload, symbolSet, enrichmentBySymbol, fromDate, toDate) {
  const deduped = new Map();
  let droppedMissingFields = 0;
  let droppedOutOfUniverse = 0;
  let droppedOutOfRange = 0;

  for (const row of Array.isArray(payload) ? payload : []) {
    const symbol = normalizeSymbol(row?.symbol);
    if (!symbolSet.has(symbol)) {
      droppedOutOfUniverse += 1;
      continue;
    }

    const reportDate = normalizeReportDate(row?.date || row?.reportDate || row?.report_date);
    const epsEstimate = toNumber(row?.epsEstimated ?? row?.epsEstimate ?? row?.estimatedEps ?? row?.eps_estimate);
    if (!reportDate || epsEstimate === null) {
      droppedMissingFields += 1;
      continue;
    }

    if (reportDate < fromDate || reportDate > toDate) {
      droppedOutOfRange += 1;
      continue;
    }

    const enrichment = enrichmentBySymbol.get(symbol) || {};
    const key = `${symbol}|${reportDate}`;
    const revenueEstimate = toNumber(
      row?.revenueEstimated ?? row?.revenueEstimate ?? row?.estimatedRevenue ?? row?.revenue_estimate ?? row?.rev_estimate
    );
    const revenueActual = toNumber(
      row?.revenue ?? row?.revenueActual ?? row?.actualRevenue ?? row?.revenue_actual ?? row?.rev_actual
    );
    deduped.set(key, {
      symbol,
      report_date: reportDate,
      report_time: normalizeReportTime(row?.time || row?.hour || row?.report_time),
      eps_estimate: epsEstimate,
      eps_actual: toNumber(row?.eps ?? row?.epsActual ?? row?.actualEps ?? row?.eps_actual),
      rev_estimate: revenueEstimate,
      rev_actual: revenueActual,
      revenue_estimate: revenueEstimate,
      revenue_actual: revenueActual,
      eps_surprise_pct: calculateSurprisePercent(
        toNumber(row?.eps ?? row?.epsActual ?? row?.actualEps ?? row?.eps_actual),
        epsEstimate
      ),
      price: enrichment.price ?? null,
      market_cap: enrichment.market_cap ?? null,
      expected_move_percent: enrichment.expected_move_percent ?? null,
      avg_volume: enrichment.avg_volume ?? null,
      current_volume: enrichment.current_volume ?? null,
      rvol: enrichment.relative_volume ?? null,
      atr: enrichment.atr ?? null,
      company: row?.company || row?.name || enrichment.company || null,
      sector: row?.sector || enrichment.sector || null,
      industry: row?.industry || enrichment.industry || null,
      exchange: row?.exchange || enrichment.exchange || null,
      source: 'fmp_stable_earnings_calendar',
      updated_at: new Date().toISOString(),
    });
  }

  return {
    rows: Array.from(deduped.values()).sort((left, right) => left.report_date.localeCompare(right.report_date) || left.symbol.localeCompare(right.symbol)),
    stats: {
      dropped_missing_fields: droppedMissingFields,
      dropped_out_of_universe: droppedOutOfUniverse,
      dropped_out_of_range: droppedOutOfRange,
    },
  };
}

async function replaceUpcomingEvents(symbols, rows, fromDate, toDate) {
  if (symbols.length) {
    await queryWithTimeout(
      `DELETE FROM earnings_events
       WHERE symbol = ANY($1::text[])
         AND report_date BETWEEN $2::date AND $3::date`,
      [symbols, fromDate, toDate],
      {
        timeoutMs: 20000,
        label: 'earnings_ingestion.clear_upcoming',
        maxRetries: 0,
        poolType: 'write',
      }
    );
  }

  if (!rows.length) {
    return 0;
  }

  const result = await queryWithTimeout(
    `WITH payload AS (
       SELECT *
       FROM json_to_recordset($1::json) AS x(
         symbol text,
         report_date date,
         report_time text,
         eps_estimate numeric,
         eps_actual numeric,
         rev_estimate numeric,
         rev_actual numeric,
         revenue_estimate numeric,
         revenue_actual numeric,
         eps_surprise_pct numeric,
         price numeric,
         market_cap numeric,
         expected_move_percent numeric,
         avg_volume numeric,
         current_volume numeric,
         rvol numeric,
         atr numeric,
         company text,
         sector text,
         industry text,
         exchange text,
         source text,
         updated_at timestamptz
       )
     ), upserted AS (
       INSERT INTO earnings_events (
         symbol,
         report_date,
         report_time,
         eps_estimate,
         eps_actual,
         rev_estimate,
         rev_actual,
         revenue_estimate,
         revenue_actual,
         eps_surprise_pct,
         price,
         market_cap,
         expected_move_percent,
         avg_volume,
         current_volume,
         rvol,
         atr,
         company,
         sector,
         industry,
         exchange,
         source,
         updated_at
       )
       SELECT
         symbol,
         report_date,
         report_time,
         eps_estimate,
         eps_actual,
         rev_estimate,
         rev_actual,
         revenue_estimate,
         revenue_actual,
         eps_surprise_pct,
         price,
         market_cap,
         expected_move_percent,
         avg_volume,
         current_volume,
         rvol,
         atr,
         company,
         sector,
         industry,
         exchange,
         source,
         updated_at
       FROM payload
       WHERE report_date IS NOT NULL
         AND eps_estimate IS NOT NULL
       ON CONFLICT (symbol, report_date)
       DO UPDATE SET
         report_time = EXCLUDED.report_time,
         eps_estimate = EXCLUDED.eps_estimate,
         eps_actual = EXCLUDED.eps_actual,
         rev_estimate = COALESCE(EXCLUDED.rev_estimate, EXCLUDED.revenue_estimate),
         rev_actual = COALESCE(EXCLUDED.rev_actual, EXCLUDED.revenue_actual),
         revenue_estimate = COALESCE(EXCLUDED.revenue_estimate, EXCLUDED.rev_estimate),
         revenue_actual = COALESCE(EXCLUDED.revenue_actual, EXCLUDED.rev_actual),
         eps_surprise_pct = EXCLUDED.eps_surprise_pct,
         price = EXCLUDED.price,
         market_cap = EXCLUDED.market_cap,
         expected_move_percent = EXCLUDED.expected_move_percent,
         avg_volume = EXCLUDED.avg_volume,
         current_volume = EXCLUDED.current_volume,
         rvol = EXCLUDED.rvol,
         atr = EXCLUDED.atr,
         company = COALESCE(EXCLUDED.company, earnings_events.company),
         sector = COALESCE(EXCLUDED.sector, earnings_events.sector),
         industry = COALESCE(EXCLUDED.industry, earnings_events.industry),
         exchange = COALESCE(EXCLUDED.exchange, earnings_events.exchange),
         source = EXCLUDED.source,
         updated_at = EXCLUDED.updated_at
       RETURNING 1
     )
     SELECT COUNT(*)::int AS inserted FROM upserted`,
    [JSON.stringify(rows)],
    {
      timeoutMs: 30000,
      label: 'earnings_ingestion.upsert_upcoming',
      maxRetries: 0,
      poolType: 'write',
    }
  );

  return Number(result.rows?.[0]?.inserted || 0);
}

function buildEventLookup(rows) {
  const bySymbol = new Map();
  for (const row of rows) {
    if (!bySymbol.has(row.symbol)) {
      bySymbol.set(row.symbol, new Map());
    }
    bySymbol.get(row.symbol).set(row.report_date, row);
  }
  return bySymbol;
}

async function fetchCalendarWindows(fromDate, toDate, windowDays, fetchConcurrency = DEFAULT_HISTORY_FETCH_CONCURRENCY) {
  const windows = [];
  let cursor = new Date(`${fromDate}T00:00:00.000Z`);
  const end = new Date(`${toDate}T00:00:00.000Z`);

  while (cursor <= end) {
    const windowStart = formatIsoDate(cursor);
    const windowEndDate = addUtcDays(cursor, windowDays - 1);
    const boundedWindowEnd = windowEndDate > end ? end : windowEndDate;
    windows.push({
      from: windowStart,
      to: formatIsoDate(boundedWindowEnd),
    });
    cursor = addUtcDays(windowEndDate, 1);
  }

  const rows = [];
  for (let index = 0; index < windows.length; index += fetchConcurrency) {
    const group = windows.slice(index, index + fetchConcurrency);
    const payloads = await Promise.all(
      group.map((window) => fmpFetch('/earnings-calendar', window))
    );

    for (const payload of payloads) {
      rows.push(...(Array.isArray(payload) ? payload : []));
    }
  }

  return rows;
}

function normalizeHistoryRows(symbol, payload, eventLookup, enrichment) {
  const deduped = new Map();
  let droppedMissingFields = 0;

  for (const row of Array.isArray(payload) ? payload : []) {
    const reportDate = normalizeReportDate(
      row?.date || row?.reportDate || row?.report_date || row?.reportedDate || row?.fiscalDateEnding
    );
    const epsActual = toNumber(row?.epsActual ?? row?.actualEps ?? row?.eps ?? row?.eps_actual);

    if (!reportDate || epsActual === null) {
      droppedMissingFields += 1;
      continue;
    }

    if (deduped.has(reportDate)) {
      continue;
    }

    const matchedEvent = eventLookup?.get(reportDate) || null;
    const epsEstimate = toNumber(
      row?.epsEstimated
      ?? row?.epsEstimate
      ?? row?.estimatedEps
      ?? row?.eps_estimate
      ?? matchedEvent?.eps_estimate
    );
    const revenueEstimate = toNumber(
      row?.revenueEstimated
      ?? row?.revenueEstimate
      ?? row?.estimatedRevenue
      ?? row?.revenue_estimate
      ?? matchedEvent?.rev_estimate
    );
    const revenueActual = toNumber(
      row?.revenueActual
      ?? row?.actualRevenue
      ?? row?.revenue
      ?? row?.revenue_actual
      ?? row?.rev_actual
    );

    deduped.set(reportDate, {
      symbol,
      report_date: reportDate,
      report_time: normalizeReportTime(row?.time || row?.hour || row?.report_time || matchedEvent?.report_time),
      eps_actual: epsActual,
      eps_estimate: epsEstimate,
      eps_surprise_pct: toNumber(row?.surprisePercentage ?? row?.surprisePercent ?? row?.epsSurprisePercent)
        ?? calculateSurprisePercent(epsActual, epsEstimate),
      revenue_actual: revenueActual,
      revenue_estimate: revenueEstimate,
      revenue_surprise_pct: toNumber(row?.revenueSurprisePercentage ?? row?.revenueSurprisePercent),
      expected_move_percent: matchedEvent?.expected_move_percent ?? enrichment.expected_move_percent ?? null,
      actual_move_percent: null,
      pre_move_percent: null,
      post_move_percent: null,
      true_reaction_window: normalizeCanonicalReportTime(row?.time || row?.hour || row?.report_time || matchedEvent?.report_time) === 'PM'
        ? 'NEXT_DAY'
        : normalizeCanonicalReportTime(row?.time || row?.hour || row?.report_time || matchedEvent?.report_time) === 'AM'
          ? 'SAME_DAY'
          : 'PRIMARY_SESSION',
      pre_price: null,
      post_price: null,
      day1_close: null,
      day3_close: null,
      source: 'fmp_stable_earnings_surprises',
      updated_at: new Date().toISOString(),
    });

    if (deduped.size >= HISTORY_LIMIT) {
      break;
    }
  }

  return {
    rows: Array.from(deduped.values()),
    stats: {
      dropped_missing_fields: droppedMissingFields,
    },
  };
}

async function replaceHistoryRows(rowsBySymbol) {
  const refreshedSymbols = rowsBySymbol.map((entry) => entry.symbol);
  if (refreshedSymbols.length) {
    await queryWithTimeout(
      `DELETE FROM earnings_history
       WHERE symbol = ANY($1::text[])`,
      [refreshedSymbols],
      {
        timeoutMs: 30000,
        label: 'earnings_ingestion.clear_history',
        maxRetries: 0,
        poolType: 'write',
      }
    );
  }

  const rows = rowsBySymbol.flatMap((entry) => entry.rows);
  if (!rows.length) {
    return 0;
  }

  const result = await queryWithTimeout(
    `WITH payload AS (
       SELECT *
       FROM json_to_recordset($1::json) AS x(
         symbol text,
         report_date date,
         report_time text,
         eps_actual numeric,
         eps_estimate numeric,
         eps_surprise_pct numeric,
         revenue_actual numeric,
         revenue_estimate numeric,
         revenue_surprise_pct numeric,
         expected_move_percent numeric,
         actual_move_percent numeric,
         pre_move_percent numeric,
         post_move_percent numeric,
         true_reaction_window text,
         pre_price numeric,
         post_price numeric,
         day1_close numeric,
         day3_close numeric,
         source text,
         updated_at timestamptz
       )
     ), inserted AS (
       INSERT INTO earnings_history (
         symbol,
         report_date,
         report_time,
         eps_actual,
         eps_estimate,
         eps_surprise_pct,
         revenue_actual,
         revenue_estimate,
         revenue_surprise_pct,
         expected_move_percent,
         actual_move_percent,
         pre_move_percent,
         post_move_percent,
         true_reaction_window,
         pre_price,
         post_price,
         day1_close,
         day3_close,
         source,
         updated_at
       )
       SELECT
         symbol,
         report_date,
         report_time,
         eps_actual,
         eps_estimate,
         eps_surprise_pct,
         revenue_actual,
         revenue_estimate,
         revenue_surprise_pct,
         expected_move_percent,
         actual_move_percent,
         pre_move_percent,
         post_move_percent,
         true_reaction_window,
         pre_price,
         post_price,
         day1_close,
         day3_close,
         source,
         updated_at
       FROM payload
       WHERE report_date IS NOT NULL
         AND eps_actual IS NOT NULL
       ON CONFLICT (symbol, report_date)
       DO UPDATE SET
         report_time = EXCLUDED.report_time,
         eps_actual = EXCLUDED.eps_actual,
         eps_estimate = EXCLUDED.eps_estimate,
         eps_surprise_pct = EXCLUDED.eps_surprise_pct,
         revenue_actual = EXCLUDED.revenue_actual,
         revenue_estimate = EXCLUDED.revenue_estimate,
         revenue_surprise_pct = EXCLUDED.revenue_surprise_pct,
         expected_move_percent = EXCLUDED.expected_move_percent,
         actual_move_percent = EXCLUDED.actual_move_percent,
         pre_move_percent = EXCLUDED.pre_move_percent,
         post_move_percent = EXCLUDED.post_move_percent,
         true_reaction_window = EXCLUDED.true_reaction_window,
         pre_price = EXCLUDED.pre_price,
         post_price = EXCLUDED.post_price,
         day1_close = EXCLUDED.day1_close,
         day3_close = EXCLUDED.day3_close,
         source = EXCLUDED.source,
         updated_at = EXCLUDED.updated_at
       RETURNING 1
     )
     SELECT COUNT(*)::int AS inserted FROM inserted`,
    [JSON.stringify(rows)],
    {
      timeoutMs: 30000,
      label: 'earnings_ingestion.upsert_history',
      maxRetries: 0,
      poolType: 'write',
    }
  );

  return Number(result.rows?.[0]?.inserted || 0);
}

async function fetchNextEventForSymbol(symbol, lookaheadDays = NEXT_EVENT_LOOKAHEAD_DAYS) {
  const safeSymbol = normalizeSymbol(symbol);
  if (!safeSymbol) {
    return null;
  }

  const today = new Date();
  const initialStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

  for (let offset = 0; offset <= lookaheadDays; offset += 30) {
    const start = addUtcDays(initialStart, offset);
    const end = addUtcDays(start, 29);
    const payload = await fmpFetch('/earnings-calendar', {
      from: formatIsoDate(start),
      to: formatIsoDate(end),
    }).catch(() => []);
    const row = (Array.isArray(payload) ? payload : [])
      .filter((entry) => normalizeSymbol(entry?.symbol) === safeSymbol)
      .sort((left, right) => String(left?.date || '').localeCompare(String(right?.date || '')))[0];

    if (row) {
      const reportDate = normalizeReportDate(row?.date || row?.reportDate || row?.report_date);
      const epsEstimate = toNumber(row?.epsEstimated ?? row?.epsEstimate ?? row?.estimatedEps ?? row?.eps_estimate);
      if (!reportDate || epsEstimate === null) {
        return null;
      }

      return {
        date: reportDate,
        report_time: normalizeReportTime(row?.time || row?.hour || row?.report_time),
        eps_actual: toNumber(row?.eps ?? row?.epsActual ?? row?.actualEps ?? row?.eps_actual),
        eps_estimate: epsEstimate,
        revenue_estimate: toNumber(
          row?.revenueEstimated ?? row?.revenueEstimate ?? row?.estimatedRevenue ?? row?.revenue_estimate ?? row?.rev_estimate
        ),
        revenue_actual: toNumber(
          row?.revenue ?? row?.revenueActual ?? row?.actualRevenue ?? row?.revenue_actual ?? row?.rev_actual
        ),
        expected_move_percent: null,
        source: toNonEmptyString(row?.source, 'fmp_stable_earnings_calendar'),
        updated_at: new Date().toISOString(),
      };
    }
  }

  return null;
}

async function runEarningsIngestionEngine(options = {}) {
  const startedAt = Date.now();
  await ensureEarningsSchemaCached();

  const requestedSymbols = Array.isArray(options.symbols) && options.symbols.length
    ? Array.from(new Set(options.symbols.map(normalizeSymbol).filter(Boolean)))
    : await loadTopUniverseSymbols(Number(options.symbolLimit) || DEFAULT_SYMBOL_LIMIT);
  const symbolSet = new Set(requestedSymbols);
  const marketEnrichment = await loadMarketEnrichment(requestedSymbols);

  const today = new Date();
  const fromDate = formatIsoDate(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const toDate = formatIsoDate(addUtcDays(today, Number(options.upcomingDays) || UPCOMING_WINDOW_DAYS));
  const historyWindowDays = Math.max(1, Number(options.historyWindowDays) || DEFAULT_HISTORY_WINDOW_DAYS);
  const historyFetchConcurrency = Math.max(1, Number(options.historyFetchConcurrency) || DEFAULT_HISTORY_FETCH_CONCURRENCY);

  const calendarPayload = await fmpFetch('/earnings-calendar', { from: fromDate, to: toDate });
  const upcoming = normalizeUpcomingEvents(calendarPayload, symbolSet, marketEnrichment, fromDate, toDate);
  const eventRows = upcoming.rows;
  const insertedEvents = await replaceUpcomingEvents(requestedSymbols, eventRows, fromDate, toDate);
  const eventLookup = buildEventLookup(eventRows);
  const historyFromDate = formatIsoDate(addUtcDays(today, -900));
  const historicalCalendarPayload = await fetchCalendarWindows(
    historyFromDate,
    fromDate,
    historyWindowDays,
    historyFetchConcurrency
  );
  const historyRowsBySymbol = new Map();

  for (const row of Array.isArray(historicalCalendarPayload) ? historicalCalendarPayload : []) {
    const symbol = normalizeSymbol(row?.symbol);
    if (!symbolSet.has(symbol)) {
      continue;
    }
    if (!historyRowsBySymbol.has(symbol)) {
      historyRowsBySymbol.set(symbol, []);
    }
    historyRowsBySymbol.get(symbol).push(row);
  }

  const successfulHistory = requestedSymbols.map((symbol) => {
    const normalized = normalizeHistoryRows(
      symbol,
      historyRowsBySymbol.get(symbol) || [],
      eventLookup.get(symbol),
      marketEnrichment.get(symbol) || {}
    );
    return {
      symbol,
      rows: normalized.rows,
      dropped_missing_fields: normalized.stats.dropped_missing_fields,
      failed: false,
    };
  });
  const insertedHistory = await replaceHistoryRows(successfulHistory);
  const symbolsWithFullHistory = successfulHistory.filter((entry) => entry.rows.length >= HISTORY_LIMIT).length;
  const symbolsWithPartialHistory = successfulHistory.filter((entry) => entry.rows.length > 0 && entry.rows.length < HISTORY_LIMIT).length;
  const failedSymbols = [];

  const result = {
    success: true,
    symbols_requested: requestedSymbols.length,
    upcoming_window_days: Number(options.upcomingDays) || UPCOMING_WINDOW_DAYS,
    history_window_days: historyWindowDays,
    history_fetch_concurrency: historyFetchConcurrency,
    history_quarters_requested: HISTORY_LIMIT,
    events_fetched: Array.isArray(calendarPayload) ? calendarPayload.length : 0,
    history_events_fetched: Array.isArray(historicalCalendarPayload) ? historicalCalendarPayload.length : 0,
    events_ingested: insertedEvents,
    history_ingested: insertedHistory,
    symbols_with_full_history: symbolsWithFullHistory,
    symbols_with_partial_history: symbolsWithPartialHistory,
    symbols_with_no_history: successfulHistory.filter((entry) => entry.rows.length === 0).length,
    failed_symbols: failedSymbols,
    dropped_invalid_event_rows: upcoming.stats.dropped_missing_fields,
    dropped_invalid_history_rows: successfulHistory.reduce((sum, entry) => sum + Number(entry.dropped_missing_fields || 0), 0),
    duration_ms: Date.now() - startedAt,
    from: fromDate,
    to: toDate,
    history_from: historyFromDate,
  };

  logger.info('earnings ingestion engine complete', result);
  return result;
}

module.exports = {
  ensureEarningsSchema,
  ensureEarningsSchemaCached,
  fetchNextEventForSymbol,
  loadTopUniverseSymbols,
  runEarningsIngestion: runEarningsIngestionEngine,
  runEarningsIngestionEngine,
};