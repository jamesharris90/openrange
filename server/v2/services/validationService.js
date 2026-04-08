const axios = require('axios');

const { queryWithTimeout } = require('../../db/pg');
const { getLatestScreenerPayload } = require('./snapshotService');

const YAHOO_QUOTE_URL = 'https://query1.finance.yahoo.com/v7/finance/quote';
const YAHOO_SUMMARY_URL = 'https://query1.finance.yahoo.com/v10/finance/quoteSummary';
const FINVIZ_QUOTE_URL = 'https://finviz.com/quote.ashx';
const EXTERNAL_TIMEOUT_MS = 5000;
const DEFAULT_LIMIT = 10;

let ensureValidationSchemaPromise = null;

function normalizeSymbol(value) {
  return String(value || '').trim().toUpperCase();
}

function toNullableNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNullableString(value) {
  const text = String(value || '').trim();
  return text || null;
}

function normalizeDateKey(value) {
  const text = String(value || '').trim();
  if (!text) {
    return null;
  }

  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) {
    const direct = text.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(direct) ? direct : null;
  }

  return new Date(parsed).toISOString().slice(0, 10);
}

function normalizeReportTime(value) {
  const text = String(value || '').trim().toUpperCase();
  if (!text || /^(TBD|N\/A|NA|UNKNOWN|--|NONE)$/.test(text)) {
    return null;
  }

  if (text.includes('AMC')) return 'AMC';
  if (text.includes('BMO')) return 'BMO';
  return text;
}

async function ensureValidationSchema() {
  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS validation_logs (
      id BIGSERIAL PRIMARY KEY,
      validation_type TEXT NOT NULL,
      provider TEXT NOT NULL,
      symbol TEXT NOT NULL,
      field_name TEXT NOT NULL,
      local_value TEXT,
      provider_value TEXT,
      status TEXT NOT NULL,
      accuracy NUMERIC,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    [],
    {
      timeoutMs: 5000,
      label: 'validation_logs.ensure_table',
      maxRetries: 0,
      poolType: 'write',
    }
  );

  await queryWithTimeout(
    `CREATE INDEX IF NOT EXISTS idx_validation_logs_type_created_at
     ON validation_logs (validation_type, created_at DESC)`,
    [],
    {
      timeoutMs: 5000,
      label: 'validation_logs.ensure_index_type_created_at',
      maxRetries: 0,
      poolType: 'write',
    }
  );

  await queryWithTimeout(
    `CREATE INDEX IF NOT EXISTS idx_validation_logs_symbol_created_at
     ON validation_logs (symbol, created_at DESC)`,
    [],
    {
      timeoutMs: 5000,
      label: 'validation_logs.ensure_index_symbol_created_at',
      maxRetries: 0,
      poolType: 'write',
    }
  );
}

async function ensureValidationSchemaReady() {
  if (!ensureValidationSchemaPromise) {
    ensureValidationSchemaPromise = ensureValidationSchema().catch((error) => {
      ensureValidationSchemaPromise = null;
      throw error;
    });
  }

  return ensureValidationSchemaPromise;
}

async function insertValidationRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return;
  }

  await ensureValidationSchemaReady();
  await queryWithTimeout(
    `WITH payload AS (
       SELECT *
       FROM json_to_recordset($1::json) AS x(
         validation_type text,
         provider text,
         symbol text,
         field_name text,
         local_value text,
         provider_value text,
         status text,
         accuracy numeric,
         payload jsonb
       )
     )
     INSERT INTO validation_logs (
       validation_type,
       provider,
       symbol,
       field_name,
       local_value,
       provider_value,
       status,
       accuracy,
       payload
     )
     SELECT
       validation_type,
       provider,
       symbol,
       field_name,
       local_value,
       provider_value,
       status,
       accuracy,
       payload
     FROM payload`,
    [JSON.stringify(rows)],
    {
      timeoutMs: 5000,
      label: 'validation_logs.insert',
      maxRetries: 0,
      poolType: 'write',
    }
  );
}

function comparisonStatus(localValue, providerValue, pass) {
  if (providerValue === null || providerValue === undefined || providerValue === '') {
    return 'provider_missing';
  }

  if (localValue === null || localValue === undefined || localValue === '') {
    return 'local_missing';
  }

  return pass ? 'match' : 'mismatch';
}

function compareNumeric(localValue, providerValue, toleranceRatio = 0.03) {
  const localNumber = toNullableNumber(localValue);
  const providerNumber = toNullableNumber(providerValue);

  if (localNumber === null || providerNumber === null) {
    return {
      pass: false,
      accuracy: null,
    };
  }

  const denominator = Math.max(Math.abs(providerNumber), 0.0001);
  const deltaRatio = Math.abs(localNumber - providerNumber) / denominator;
  return {
    pass: deltaRatio <= toleranceRatio,
    accuracy: Math.max(0, 100 - (deltaRatio * 100)),
  };
}

function compareDate(localValue, providerValue) {
  const localDate = normalizeDateKey(localValue);
  const providerDate = normalizeDateKey(providerValue);
  return {
    pass: Boolean(localDate && providerDate && localDate === providerDate),
    accuracy: localDate && providerDate && localDate === providerDate ? 100 : 0,
    localDate,
    providerDate,
  };
}

function compareTime(localValue, providerValue) {
  const localTime = normalizeReportTime(localValue);
  const providerTime = normalizeReportTime(providerValue);
  if (!localTime || !providerTime) {
    return {
      pass: false,
      accuracy: null,
      localTime,
      providerTime,
    };
  }

  return {
    pass: localTime === providerTime,
    accuracy: localTime === providerTime ? 100 : 0,
    localTime,
    providerTime,
  };
}

async function fetchYahooQuotes(symbols) {
  const normalizedSymbols = Array.from(new Set((Array.isArray(symbols) ? symbols : []).map(normalizeSymbol).filter(Boolean)));
  if (!normalizedSymbols.length) {
    return new Map();
  }

  try {
    const response = await axios.get(YAHOO_QUOTE_URL, {
      params: {
        symbols: normalizedSymbols.join(','),
      },
      timeout: EXTERNAL_TIMEOUT_MS,
      validateStatus: () => true,
    });

    if (response.status !== 200) {
      return new Map();
    }

    const rows = response.data?.quoteResponse?.result || [];
    return new Map(
      rows
        .map((row) => ({
          symbol: normalizeSymbol(row.symbol),
          price: toNullableNumber(row.regularMarketPrice),
          change_percent: toNullableNumber(row.regularMarketChangePercent),
        }))
        .filter((row) => row.symbol)
        .map((row) => [row.symbol, row])
    );
  } catch (_error) {
    return new Map();
  }
}

async function fetchYahooEarnings(symbol) {
  if (!symbol) {
    return {};
  }

  try {
    const response = await axios.get(`${YAHOO_SUMMARY_URL}/${encodeURIComponent(symbol)}`, {
      params: {
        modules: 'calendarEvents',
      },
      timeout: EXTERNAL_TIMEOUT_MS,
      validateStatus: () => true,
    });

    if (response.status !== 200) {
      return {};
    }

    const result = response.data?.quoteSummary?.result?.[0]?.calendarEvents || {};
    const earningsDate = Array.isArray(result.earnings?.earningsDate) ? result.earnings.earningsDate : [];
    const firstDate = earningsDate[0]?.fmt || earningsDate[0]?.raw || null;
    return {
      report_date: normalizeDateKey(firstDate),
      report_time: normalizeReportTime(result.earnings?.earningsAverage),
    };
  } catch (_error) {
    return {};
  }
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchFinvizQuote(symbol) {
  if (!symbol) {
    return {};
  }

  try {
    const response = await axios.get(FINVIZ_QUOTE_URL, {
      params: { t: symbol },
      timeout: EXTERNAL_TIMEOUT_MS,
      validateStatus: () => true,
      headers: {
        'User-Agent': 'Mozilla/5.0 OpenRange Validation Bot',
      },
    });

    if (response.status !== 200) {
      return {};
    }

    const html = String(response.data || '');
    const earningsMatch = html.match(/>Earnings<\/td><td[^>]*>(.*?)<\/td>/i);
    const priceMatch = html.match(/"last_price":"?([0-9]+(?:\.[0-9]+)?)"?/i)
      || html.match(/quote-price[^>]*>\s*([0-9]+(?:\.[0-9]+)?)/i)
      || stripHtml(html).match(/Price\s+([0-9]+(?:\.[0-9]+)?)/i);

    const earningsText = stripHtml(earningsMatch?.[1] || '');
    const earningsDate = earningsText.match(/([A-Z][a-z]{2}\s+\d{1,2}(?:\s+'?\d{2,4})?)/);

    return {
      price: toNullableNumber(priceMatch?.[1]),
      report_date: normalizeDateKey(earningsDate?.[1] || null),
      report_time: normalizeReportTime(earningsText),
      raw_earnings: earningsText || null,
    };
  } catch (_error) {
    return {};
  }
}

async function getLocalScreenerRows(symbols, limit) {
  const payload = await getLatestScreenerPayload();
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const symbolSet = new Set((Array.isArray(symbols) ? symbols : []).map(normalizeSymbol).filter(Boolean));

  return rows
    .filter((row) => symbolSet.size === 0 || symbolSet.has(normalizeSymbol(row.symbol)))
    .slice(0, Math.max(1, limit || DEFAULT_LIMIT));
}

async function getLocalEarningsRows(symbols, limit) {
  const symbolSet = new Set((Array.isArray(symbols) ? symbols : []).map(normalizeSymbol).filter(Boolean));

  const result = await queryWithTimeout(
    `WITH ranked AS (
       SELECT
         symbol,
         report_date,
         report_time,
         ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY report_date ASC) AS rn
       FROM earnings_events
       WHERE report_date >= CURRENT_DATE - INTERVAL '7 days'
     )
     SELECT symbol, report_date, report_time
     FROM ranked
     WHERE rn = 1
     ORDER BY report_date ASC
     LIMIT $1`,
    [Math.max(1, limit || DEFAULT_LIMIT)],
    {
      timeoutMs: 4000,
      label: 'validation.local_earnings',
      maxRetries: 0,
    }
  );

  return (result.rows || []).filter((row) => symbolSet.size === 0 || symbolSet.has(normalizeSymbol(row.symbol)));
}

function buildSummary(type, rows) {
  const total = rows.length;
  const matched = rows.filter((row) => row.status === 'match').length;
  const accuracy = total > 0 ? Number(((matched / total) * 100).toFixed(2)) : 0;
  const byProvider = rows.reduce((acc, row) => {
    acc[row.provider] = acc[row.provider] || { total: 0, matched: 0 };
    acc[row.provider].total += 1;
    if (row.status === 'match') {
      acc[row.provider].matched += 1;
    }
    return acc;
  }, {});

  return {
    validation_type: type,
    checked: total,
    matched,
    accuracy,
    by_provider: Object.fromEntries(
      Object.entries(byProvider).map(([provider, stats]) => [provider, {
        total: stats.total,
        matched: stats.matched,
        accuracy: stats.total > 0 ? Number(((stats.matched / stats.total) * 100).toFixed(2)) : 0,
      }])
    ),
  };
}

async function runScreenerValidation(options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit || DEFAULT_LIMIT), 25));
  const symbols = Array.isArray(options.symbols) ? options.symbols : [];
  const localRows = await getLocalScreenerRows(symbols, limit);
  const yahooQuotes = await fetchYahooQuotes(localRows.map((row) => row.symbol));
  const finvizQuotes = await Promise.all(localRows.map((row) => fetchFinvizQuote(row.symbol)));

  const results = [];
  localRows.forEach((row, index) => {
    const symbol = normalizeSymbol(row.symbol);
    const yahoo = yahooQuotes.get(symbol) || {};
    const finviz = finvizQuotes[index] || {};

    const comparisons = [
      { provider: 'yahoo', field: 'price', local: row.price, providerValue: yahoo.price, compare: compareNumeric(row.price, yahoo.price) },
      { provider: 'yahoo', field: 'change_percent', local: row.change_percent, providerValue: yahoo.change_percent, compare: compareNumeric(row.change_percent, yahoo.change_percent, 0.15) },
      { provider: 'finviz', field: 'price', local: row.price, providerValue: finviz.price, compare: compareNumeric(row.price, finviz.price) },
    ];

    comparisons.forEach((comparison) => {
      results.push({
        validation_type: 'screener',
        provider: comparison.provider,
        symbol,
        field_name: comparison.field,
        local_value: comparison.local == null ? null : String(comparison.local),
        provider_value: comparison.providerValue == null ? null : String(comparison.providerValue),
        status: comparisonStatus(comparison.local, comparison.providerValue, comparison.compare.pass),
        accuracy: comparison.compare.accuracy,
        payload: {
          local_row: row,
          provider_row: comparison.provider === 'yahoo' ? yahoo : finviz,
        },
      });
    });
  });

  await insertValidationRows(results);
  return {
    summary: buildSummary('screener', results),
    rows: results,
  };
}

async function runEarningsValidation(options = {}) {
  const limit = Math.max(1, Math.min(Number(options.limit || DEFAULT_LIMIT), 25));
  const symbols = Array.isArray(options.symbols) ? options.symbols : [];
  const localRows = await getLocalEarningsRows(symbols, limit);

  const yahooRows = await Promise.all(localRows.map((row) => fetchYahooEarnings(row.symbol)));
  const finvizRows = await Promise.all(localRows.map((row) => fetchFinvizQuote(row.symbol)));
  const results = [];

  localRows.forEach((row, index) => {
    const symbol = normalizeSymbol(row.symbol);
    const yahoo = yahooRows[index] || {};
    const finviz = finvizRows[index] || {};
    const dateComparisons = [
      { provider: 'yahoo', field: 'report_date', providerValue: yahoo.report_date, compare: compareDate(row.report_date, yahoo.report_date) },
      { provider: 'finviz', field: 'report_date', providerValue: finviz.report_date, compare: compareDate(row.report_date, finviz.report_date) },
    ];
    const timeComparisons = [
      { provider: 'yahoo', field: 'report_time', providerValue: yahoo.report_time, compare: compareTime(row.report_time, yahoo.report_time) },
      { provider: 'finviz', field: 'report_time', providerValue: finviz.report_time, compare: compareTime(row.report_time, finviz.report_time) },
    ];

    [...dateComparisons, ...timeComparisons].forEach((comparison) => {
      const localValue = comparison.field === 'report_date'
        ? comparison.compare.localDate || normalizeDateKey(row.report_date)
        : comparison.compare.localTime || normalizeReportTime(row.report_time);
      const providerValue = comparison.field === 'report_date'
        ? comparison.compare.providerDate || normalizeDateKey(comparison.providerValue)
        : comparison.compare.providerTime || normalizeReportTime(comparison.providerValue);

      results.push({
        validation_type: 'earnings',
        provider: comparison.provider,
        symbol,
        field_name: comparison.field,
        local_value: localValue,
        provider_value: providerValue,
        status: comparisonStatus(localValue, providerValue, comparison.compare.pass),
        accuracy: comparison.compare.accuracy,
        payload: {
          local_row: row,
          provider_row: comparison.provider === 'yahoo' ? yahoo : finviz,
        },
      });
    });
  });

  await insertValidationRows(results);
  return {
    summary: buildSummary('earnings', results),
    rows: results,
  };
}

async function getValidationRollup() {
  await ensureValidationSchemaReady();
  const result = await queryWithTimeout(
    `SELECT
       validation_type,
       provider,
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE status = 'match')::int AS matched,
       MAX(created_at) AS last_run_at
     FROM validation_logs
     WHERE created_at >= NOW() - INTERVAL '24 hours'
     GROUP BY validation_type, provider
     ORDER BY validation_type ASC, provider ASC`,
    [],
    {
      timeoutMs: 4000,
      label: 'validation.rollup',
      maxRetries: 0,
    }
  );

  const rows = result.rows || [];
  return rows.map((row) => ({
    validation_type: row.validation_type,
    provider: row.provider,
    total: Number(row.total || 0),
    matched: Number(row.matched || 0),
    accuracy: Number(row.total || 0) > 0 ? Number(((Number(row.matched || 0) / Number(row.total || 1)) * 100).toFixed(2)) : 0,
    last_run_at: row.last_run_at,
  }));
}

module.exports = {
  ensureValidationSchemaReady,
  getValidationRollup,
  runEarningsValidation,
  runScreenerValidation,
};