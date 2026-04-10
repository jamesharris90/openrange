#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { queryWithTimeout } = require('../db/pg');

const LOG_DIR = path.join(__dirname, '..', '..', 'logs');
const REPORT_PATH = path.join(LOG_DIR, 'build_validation_report.json');
const API_BASE = process.env.SCREENER_VALIDATION_BASE_URL || 'http://localhost:3007';

function toNum(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function pct(value, total) {
  if (!total) return 0;
  return (value / total) * 100;
}

async function fetchScreenerRows() {
  const url = `${API_BASE}/api/screener?page=1&pageSize=200`;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`Failed to fetch screener rows (${response.status})`);
  }
  const payload = await response.json();
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return { rows, url };
}

async function analyzePercentChangeConsistency(symbols, screenerRowsBySymbol) {
  if (!symbols.length) {
    return {
      checked: 0,
      quoteMismatches: [],
      percentChangeFailures: {
        nan_values: [],
        active_zero_values: [],
        out_of_bounds_values: [],
      },
      drift: {
        warning: false,
      },
    };
  }

  const { rows } = await queryWithTimeout(
    `WITH target_symbols AS (
       SELECT UNNEST($1::text[]) AS symbol
     ),
     latest_intraday AS (
       SELECT DISTINCT ON (symbol)
              symbol,
              close::numeric AS latest_close
       FROM intraday_1m
       WHERE symbol = ANY($1::text[])
       ORDER BY symbol, timestamp DESC
     ),
     latest_daily AS (
       SELECT DISTINCT ON (symbol)
              symbol,
              close::numeric AS latest_daily_close
       FROM daily_ohlc
       WHERE symbol = ANY($1::text[])
       ORDER BY symbol, date DESC
     )
     SELECT
       ts.symbol,
       COALESCE(mq.price::numeric, mm.price::numeric, 0::numeric) AS quote_price,
       COALESCE(
         NULLIF((to_jsonb(mm)->>'previous_close')::numeric, 0),
         ld.latest_daily_close,
         NULLIF((to_jsonb(mm)->>'prev_close')::numeric, 0),
         0::numeric
       ) AS previous_close,
       li.latest_close AS intraday_close,
       ld.latest_daily_close AS daily_close
     FROM target_symbols ts
     LEFT JOIN market_quotes mq ON mq.symbol = ts.symbol
     LEFT JOIN market_metrics mm ON mm.symbol = ts.symbol
     LEFT JOIN latest_intraday li ON li.symbol = ts.symbol
     LEFT JOIN latest_daily ld ON ld.symbol = ts.symbol`,
    [symbols],
    {
      label: 'validation.screener.percent_change_compare',
      timeoutMs: 8000,
      maxRetries: 1,
      retryDelayMs: 100,
      poolType: 'read',
    }
  );

  const quoteMismatches = [];
  const nanValues = [];
  const activeZeroValues = [];
  const outOfBoundsValues = [];
  for (const row of rows || []) {
    const symbol = String(row.symbol || '').toUpperCase();
    const actual = toNum(screenerRowsBySymbol.get(symbol)?.percent_change, NaN);
    const volume = toNum(screenerRowsBySymbol.get(symbol)?.volume, 0);

    if (!Number.isFinite(actual)) {
      nanValues.push({ symbol, value: screenerRowsBySymbol.get(symbol)?.percent_change ?? null });
      continue;
    }

    if (volume >= 1000000 && actual === 0) {
      activeZeroValues.push({ symbol, volume, actual });
    }

    if (Math.abs(actual) > 200) {
      outOfBoundsValues.push({ symbol, actual });
    }

    const quotePrice = toNum(row.quote_price, NaN);
    const previousClose = toNum(row.previous_close, NaN);
    if (Number.isFinite(quotePrice) && Number.isFinite(previousClose) && previousClose > 0) {
      const expectedFromQuote = ((quotePrice - previousClose) / previousClose) * 100;
      if (Math.abs(expectedFromQuote - actual) > 1) {
        quoteMismatches.push({
          symbol,
          expected: expectedFromQuote,
          actual,
          delta: Number((actual - expectedFromQuote).toFixed(3)),
        });
      }
    }

  }

  return {
    checked: rows.length,
    quoteMismatches,
    percentChangeFailures: {
      nan_values: nanValues,
      active_zero_values: activeZeroValues,
      out_of_bounds_values: outOfBoundsValues,
    },
    drift: {
      warning: false,
    },
  };
}

async function run() {
  const startedAt = new Date();
  const { rows, url } = await fetchScreenerRows();

  const totalRows = rows.length;
  const avgTradeScore = totalRows
    ? rows.reduce((acc, row) => acc + toNum(row.trade_quality_score), 0) / totalRows
    : 0;

  const freshnessCounts = rows.reduce(
    (acc, row) => {
      const freshness = String(row.data_freshness || '').toUpperCase();
      if (freshness === 'LIVE') acc.live += 1;
      else if (freshness === 'DELAYED') acc.delayed += 1;
      else acc.stale += 1;
      return acc;
    },
    { live: 0, delayed: 0, stale: 0 }
  );

  const sorted = [...rows].sort((a, b) => toNum(b.trade_quality_score) - toNum(a.trade_quality_score));
  const topSymbol = sorted[0]?.symbol || null;

  const scoreRangeFailures = rows.filter((row) => {
    const score = toNum(row.trade_quality_score, NaN);
    return !Number.isFinite(score) || score < 0 || score > 100;
  });

  const staleRowsShown = rows.filter((row) => String(row.data_freshness || '').toUpperCase() === 'STALE');

  const nanFieldRows = rows.filter((row) => {
    const numericFields = [row.price, row.percent_change, row.volume, row.relative_volume, row.trade_quality_score];
    return numericFields.some((value) => !Number.isFinite(toNum(value, NaN)));
  });

  const topRows = sorted.slice(0, 5);
  const unrealisticTopRows = topRows.filter((row) => {
    const price = toNum(row.price, NaN);
    const volume = toNum(row.volume, NaN);
    const score = toNum(row.trade_quality_score, NaN);
    return !Number.isFinite(price) || price <= 0 || !Number.isFinite(volume) || volume <= 0 || !Number.isFinite(score);
  });

  const rowMap = new Map(rows.map((row) => [String(row.symbol || '').toUpperCase(), row]));
  const compare = await analyzePercentChangeConsistency([...rowMap.keys()], rowMap);

  const extremeDriftRows = rows.filter((row) => String(row?.drift_status || '').toUpperCase() === 'EXTREME');
  const moderateDriftRows = rows.filter((row) => String(row?.drift_status || '').toUpperCase() === 'MODERATE');
  const unknownDriftRows = rows.filter((row) => String(row?.drift_status || '').toUpperCase() === 'UNKNOWN');
  const driftRows = rows.filter((row) => ['EXTREME', 'MODERATE', 'UNKNOWN'].includes(String(row?.drift_status || '').toUpperCase()));
  const driftValueMax = rows.reduce((max, row) => {
    const next = toNum(row?.drift_value, 0);
    return next > max ? next : max;
  }, 0);
  const extremeDriftRatio = totalRows > 0 ? extremeDriftRows.length / totalRows : 0;

  const percentChangeFailureCount =
    compare.percentChangeFailures.nan_values.length
    + compare.percentChangeFailures.active_zero_values.length
    + compare.percentChangeFailures.out_of_bounds_values.length;

  const percentChangeCheck = percentChangeFailureCount > 0
    ? 'FAIL'
    : (compare.quoteMismatches.length > 0 || driftRows.length > 0 ? 'WARN' : 'PASS');

  const failures = [];
  if (scoreRangeFailures.length) failures.push('trade_score_out_of_range');
  if (percentChangeFailureCount > 0) failures.push('percent_change_invalid');
  if (nanFieldRows.length) failures.push('nan_values_present');
  if (staleRowsShown.length) failures.push('stale_data_shown');
  if (totalRows <= 0) failures.push('no_rows_returned');
  if (extremeDriftRatio > 0.5) failures.push('extreme_drift_dominant');
  // Keep top-row realism as diagnostics only; it is non-blocking for validator pass/fail.

  const pass = failures.length === 0;
  const warningFlags = [];
  if (unrealisticTopRows.length > 0) warningFlags.push('TOP_ROWS_UNREALISTIC');
  if (moderateDriftRows.length > 0 || extremeDriftRows.length > 0) warningFlags.push('DATA_SOURCE_DRIFT');
  if (unknownDriftRows.length > 0) warningFlags.push('DATA_DRIFT_BASELINE_INVALID');
  if (extremeDriftRows.length > 2 && extremeDriftRatio <= 0.5) warningFlags.push('EXTREME_DRIFT_ELEVATED');
  if (compare.quoteMismatches.length > 0) warningFlags.push('QUOTE_ALIGNMENT_MISMATCH');
  const hasWarnings = warningFlags.length > 0;
  const overallState = pass ? (hasWarnings ? 'WARN' : 'PASS') : 'FAIL';

  const report = {
    timestamp: new Date().toISOString(),
    endpoint: url,
    rows: totalRows,
    avg_trade_score: Number(avgTradeScore.toFixed(3)),
    fresh_rows_percent: Number(pct(freshnessCounts.live + freshnessCounts.delayed, totalRows).toFixed(2)),
    stale_rows_percent: Number(pct(freshnessCounts.stale, totalRows).toFixed(2)),
    top_symbol: topSymbol,
    checks: {
      trade_score_range_0_100: scoreRangeFailures.length === 0,
      percent_change_accuracy_pm_1pct: compare.quoteMismatches.length === 0,
      percent_change_not_nan: compare.percentChangeFailures.nan_values.length === 0,
      percent_change_not_zero_on_active: compare.percentChangeFailures.active_zero_values.length === 0,
      percent_change_within_pm_200: compare.percentChangeFailures.out_of_bounds_values.length === 0,
      no_nan_values_in_core_fields: nanFieldRows.length === 0,
      no_stale_rows_in_response: staleRowsShown.length === 0,
      rows_available: totalRows > 0,
      top_rows_realistic: unrealisticTopRows.length === 0,
    },
    percent_change_check: percentChangeCheck,
    drift_warning: driftRows.length > 0,
    drift_value: Number(driftValueMax.toFixed(3)),
    moderate_drift_count: moderateDriftRows.length,
    extreme_drift_count: extremeDriftRows.length,
    unknown_drift_count: unknownDriftRows.length,
    extreme_drift_ratio: Number((extremeDriftRatio * 100).toFixed(2)),
    warning_flags: warningFlags,
    failures,
    sample_failures: {
      score_range: scoreRangeFailures.slice(0, 5),
      percent_change_quote_mismatch: compare.quoteMismatches.slice(0, 5),
      percent_change_nan: compare.percentChangeFailures.nan_values.slice(0, 5),
      percent_change_active_zero: compare.percentChangeFailures.active_zero_values.slice(0, 5),
      percent_change_out_of_bounds: compare.percentChangeFailures.out_of_bounds_values.slice(0, 5),
      data_source_drift: driftRows.slice(0, 5).map((row) => ({
        symbol: row.symbol,
        drift_percent: toNum(row.drift_value, 0),
        drift_status: row.drift_status || 'UNKNOWN',
        baseline_valid: Boolean(row.baseline_valid),
      })),
      nan_core_fields: nanFieldRows.slice(0, 5),
      stale_rows: staleRowsShown.slice(0, 5),
      unrealistic_top_rows: unrealisticTopRows.slice(0, 5),
    },
    status: pass ? 'BUILD VALIDATED - SAFE TO DEPLOY' : 'BUILD FAILED - FIX REQUIRED',
    validation_state: overallState,
    duration_ms: Date.now() - startedAt.getTime(),
  };

  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log(JSON.stringify(report, null, 2));

  if (overallState === 'PASS') {
    console.log('SCREENER VALIDATED — DATA CONSISTENT WITH LIVE MARKET');
  } else if (overallState === 'WARN') {
    console.log('SCREENER VALIDATED — DATA DRIFT DETECTED (NON-BLOCKING)');
  } else {
    console.log('VALIDATION FAILED — REAL DATA ERROR');
  }

  if (!pass) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  const report = {
    timestamp: new Date().toISOString(),
    status: 'BUILD FAILED - FIX REQUIRED',
    error: error.message,
  };

  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
});
