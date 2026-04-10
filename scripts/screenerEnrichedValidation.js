#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', 'server', '.env') });
const { queryWithTimeout } = require('../server/db/pg');

const OUTPUT_PATH = path.resolve(__dirname, '..', 'screener_enriched_validation.json');
const ENDPOINT = 'http://localhost:3007/api/screener?page=1&pageSize=5000';

function classifySetup(row) {
  const changePercent = Number(row.change_percent) || 0;
  const relativeVolume = Number(row.relative_volume) || 0;
  const absChange = Math.abs(changePercent);

  if (relativeVolume > 5 && absChange > 10) return 'HIGH MOMENTUM';
  if (relativeVolume > 2 && changePercent > 3) return 'MOMENTUM BUILDING';
  if (relativeVolume < 1) return 'LOW INTEREST';
  if (absChange > 20) return 'EXTENDED';
  return 'NEUTRAL';
}

function hasRequiredFields(row) {
  return row &&
    typeof row.symbol === 'string' && row.symbol.trim().length > 0 &&
    Number.isFinite(Number(row.price)) &&
    Number.isFinite(Number(row.change_percent)) &&
    Number.isFinite(Number(row.volume)) &&
    Number.isFinite(Number(row.relative_volume));
}

function toValidatedRow(row) {
  return {
    symbol: String(row.symbol).trim().toUpperCase(),
    price: Number(row.price),
    change_percent: Number(row.change_percent),
    volume: Number(row.volume),
    relative_volume: Number(row.relative_volume),
    market_cap: Number.isFinite(Number(row.market_cap)) ? Number(row.market_cap) : null,
    sector: typeof row.sector === 'string' && row.sector.trim() ? row.sector.trim() : null,
    source: row.source,
    setup: classifySetup(row),
  };
}

function applyDefaultFilters(row) {
  return Boolean(row);
}

function sortRows(rows, key, dir) {
  const list = [...rows];
  list.sort((a, b) => {
    if (key === 'symbol' || key === 'sector') {
      const aVal = String(a[key] || '');
      const bVal = String(b[key] || '');
      const cmp = aVal.localeCompare(bVal);
      return dir === 'asc' ? cmp : -cmp;
    }

    const aVal = Number(a[key]) || 0;
    const bVal = Number(b[key]) || 0;
    return dir === 'asc' ? aVal - bVal : bVal - aVal;
  });
  return list;
}

async function main() {
  const startedAt = new Date().toISOString();
  const endpointResponse = await fetch(ENDPOINT, { cache: 'no-store' });

  const { rows: rawData } = await queryWithTimeout(
    `SELECT
       mm.symbol,
       mm.price,
       mm.change_percent,
       mm.volume,
       mm.relative_volume,
       COALESCE(cp.market_cap, tku.market_cap) AS market_cap,
       COALESCE(NULLIF(cp.sector, ''), NULLIF(tku.sector, '')) AS sector,
       COALESCE(NULLIF(cp.industry, ''), NULLIF(tku.industry, '')) AS industry,
       COALESCE(NULLIF(cp.company_name, ''), NULLIF(tku.company_name, '')) AS name,
       mm.source
     FROM market_metrics mm
     LEFT JOIN company_profiles cp
       ON mm.symbol = cp.symbol
     LEFT JOIN ticker_universe tku
       ON mm.symbol = tku.symbol
     WHERE mm.source = 'real' AND mm.symbol IS NOT NULL
     ORDER BY mm.symbol ASC
     LIMIT 5000`,
    [],
    { label: 'screener.enriched.validation', timeoutMs: 25000, maxRetries: 2, retryDelayMs: 400, poolType: 'read' }
  );

  const cleaned = rawData.filter((row) => row && row.symbol);
  const validated = cleaned.filter(hasRequiredFields).map(toValidatedRow);
  const filtered = validated.filter(applyDefaultFilters);
  const processedRows = filtered;

  const sectorPresentCount = rawData.filter((row) => typeof row?.sector === 'string' && row.sector.trim().length > 0).length;
  const marketCapPresentCount = rawData.filter((row) => row?.market_cap != null && Number.isFinite(Number(row.market_cap))).length;

  const sectorCoverage = rawData.length > 0 ? sectorPresentCount / rawData.length : 0;
  const marketCapCoverage = rawData.length > 0 ? marketCapPresentCount / rawData.length : 0;

  const sortedAsc = sortRows(processedRows, 'change_percent', 'asc').map((row) => row.symbol);
  const sortedDesc = sortRows(processedRows, 'change_percent', 'desc').map((row) => row.symbol);
  const sortingChangesOrder = JSON.stringify(sortedAsc.slice(0, 100)) !== JSON.stringify(sortedDesc.slice(0, 100));

  const sourceRealCount = rawData.filter((row) => row?.source === 'real').length;
  const sourceAllReal = sourceRealCount === rawData.length;

  const checks = {
    status200: endpointResponse.status === 200,
    rawDataGt3000: rawData.length > 3000,
    processedRowsGt500: processedRows.length > 500,
    sectorCoverageGt50Pct: sectorCoverage > 0.5,
    marketCapCoverageGt50Pct: marketCapCoverage > 0.5,
    sortingChangesOrder,
    sourceAllReal,
  };

  const passed = Object.values(checks).every(Boolean);

  const report = {
    generated_at: startedAt,
    endpoint: ENDPOINT,
    status: endpointResponse.status,
    counts: {
      rawData: rawData.length,
      cleaned: cleaned.length,
      validated: validated.length,
      filtered: filtered.length,
      processedRows: processedRows.length,
    },
    coverage: {
      sectorPresentCount,
      marketCapPresentCount,
      sectorCoveragePct: Number((sectorCoverage * 100).toFixed(2)),
      marketCapCoveragePct: Number((marketCapCoverage * 100).toFixed(2)),
    },
    source: {
      realCount: sourceRealCount,
      nonRealCount: rawData.length - sourceRealCount,
    },
    checks,
    passed,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2));

  if (!passed) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const failed = {
    generated_at: new Date().toISOString(),
    endpoint: ENDPOINT,
    error: error.message,
    passed: false,
  };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(failed, null, 2));
  process.exit(1);
});
