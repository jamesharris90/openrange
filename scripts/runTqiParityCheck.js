/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(process.cwd(), 'server/.env') });

const API_BASE = process.env.API_BASE || 'http://localhost:3001';
const API_KEY = process.env.PROXY_API_KEY || '';
const API_TIMEOUT_MS = Number.parseInt(process.env.API_TIMEOUT_MS || '45000', 10);

function ensureDir(relPath) {
  const dir = path.resolve(process.cwd(), relPath);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function apiGet(pathname) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE}${pathname}`, {
      headers: {
        Accept: 'application/json',
        ...(API_KEY ? { 'x-api-key': API_KEY } : {}),
      },
      signal: controller.signal,
    });

    const json = await response.json().catch(() => ({}));
    return { status: response.status, json };
  } finally {
    clearTimeout(timeout);
  }
}

function toRows(payload) {
  if (!payload || typeof payload !== 'object') return [];
  if (Array.isArray(payload.results)) return payload.results;
  if (Array.isArray(payload.items)) return payload.items;
  return [];
}

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

async function run() {
  const limit = 25;

  const normal = await apiGet(`/api/intelligence/top-opportunities?limit=${limit}`);
  const strict = await apiGet(`/api/intelligence/top-opportunities?limit=${limit}&strict=true`);

  const normalRows = toRows(normal.json);
  const strictRows = toRows(strict.json);

  const normalMissingTradeQuality = normalRows
    .filter((row) => !isFiniteNumber(row?.trade_quality))
    .map((row) => row?.symbol || null);

  const normalMissingCompleteness = normalRows
    .filter((row) => !isFiniteNumber(row?.completeness))
    .map((row) => row?.symbol || null);

  const strictThresholdViolations = strictRows
    .filter((row) => Number(row?.trade_quality || 0) < 70)
    .map((row) => ({ symbol: row?.symbol || null, trade_quality: row?.trade_quality ?? null }));

  const report = {
    generatedAt: new Date().toISOString(),
    apiBase: API_BASE,
    checks: {
      normalStatus200: normal.status === 200,
      strictStatus200: strict.status === 200,
      normalHasResultsKey: Object.prototype.hasOwnProperty.call(normal.json || {}, 'results'),
      strictHasResultsKey: Object.prototype.hasOwnProperty.call(strict.json || {}, 'results'),
      normalCountMatchesRows: Number(normal.json?.count) === normalRows.length,
      strictCountMatchesRows: Number(strict.json?.count) === strictRows.length,
      strictModeFlag: strict.json?.strict_mode === true,
      strictNotGreaterThanNormal: strictRows.length <= normalRows.length,
      allNormalRowsHaveTradeQuality: normalMissingTradeQuality.length === 0,
      allNormalRowsHaveCompleteness: normalMissingCompleteness.length === 0,
      strictRowsMeetThreshold: strictThresholdViolations.length === 0,
    },
    stats: {
      normalCount: normalRows.length,
      strictCount: strictRows.length,
      strictReduction: normalRows.length - strictRows.length,
      normalTopTradeQuality: normalRows.length > 0
        ? Math.max(...normalRows.map((row) => Number(row?.trade_quality || 0)))
        : null,
      strictTopTradeQuality: strictRows.length > 0
        ? Math.max(...strictRows.map((row) => Number(row?.trade_quality || 0)))
        : null,
    },
    failures: {
      normalMissingTradeQuality,
      normalMissingCompleteness,
      strictThresholdViolations,
    },
    samples: {
      normalTop3: normalRows.slice(0, 3).map((row) => ({
        symbol: row?.symbol || null,
        trade_quality: row?.trade_quality ?? null,
        completeness: row?.completeness ?? null,
      })),
      strictTop3: strictRows.slice(0, 3).map((row) => ({
        symbol: row?.symbol || null,
        trade_quality: row?.trade_quality ?? null,
        completeness: row?.completeness ?? null,
      })),
    },
  };

  report.ok = Object.values(report.checks).every(Boolean);

  ensureDir('logs/backtests');
  const outPath = path.resolve(process.cwd(), 'logs/backtests/tqi-parity-report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');

  console.log(JSON.stringify(report, null, 2));
  console.log(`Wrote ${outPath}`);

  if (!report.ok) {
    process.exitCode = 2;
  }
}

run().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
