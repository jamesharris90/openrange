#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { getIndicators } = require('../engines/indicatorEngine');

const TARGETS = ['AAPL', 'TSLA', 'NVDA'];
const OUTPUT_PATH = path.resolve(__dirname, '..', '..', 'INDICATOR_VALIDATION_REPORT.json');

function hasNaN(value) {
  if (Array.isArray(value)) {
    return value.some((entry) => hasNaN(entry));
  }

  if (value && typeof value === 'object') {
    return Object.values(value).some((entry) => hasNaN(entry));
  }

  return typeof value === 'number' && Number.isNaN(value);
}

function isConstantHistogram(series) {
  const histogram = (Array.isArray(series) ? series : [])
    .map((row) => Number(row?.histogram))
    .filter((value) => Number.isFinite(value));

  if (histogram.length === 0) return true;
  return histogram.every((value) => value === histogram[0]);
}

async function run() {
  const report = {
    generated_at: new Date().toISOString(),
    ok: true,
    symbols: [],
  };

  for (const symbol of TARGETS) {
    const indicators = await getIndicators(symbol);
    const issues = [];
    const price = Number(indicators?.price);
    const vwap = Number(indicators?.vwap);
    const ema9 = Number(indicators?.ema9);
    const ema20 = Number(indicators?.ema20);
    const histogram = Number(indicators?.macd?.histogram);
    const series = indicators?.panels?.['1min'] || [];

    if (hasNaN(indicators)) {
      issues.push('nan_detected');
    }

    if (Number.isFinite(price) && Number.isFinite(vwap)) {
      const vwapDistance = Math.abs((price - vwap) / price);
      if (vwapDistance > 0.25) {
        issues.push('vwap_outside_realistic_range');
      }
    } else {
      issues.push('missing_price_or_vwap');
    }

    if (!Number.isFinite(ema9) || !Number.isFinite(ema20) || ema9 === ema20) {
      issues.push('ema9_equals_ema20');
    }

    if (!Number.isFinite(histogram) || histogram === 0 || isConstantHistogram(series)) {
      issues.push('macd_histogram_constant');
    }

    report.symbols.push({
      symbol,
      ok: issues.length === 0,
      snapshot: {
        price: indicators?.price ?? null,
        vwap: indicators?.vwap ?? null,
        ema9: indicators?.ema9 ?? null,
        ema20: indicators?.ema20 ?? null,
        macd: indicators?.macd ?? null,
      },
      issues,
    });

    if (issues.length > 0) {
      report.ok = false;
    }
  }

  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report, null, 2));

  if (!report.ok) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  const report = {
    generated_at: new Date().toISOString(),
    ok: false,
    error: error.message,
  };
  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
});