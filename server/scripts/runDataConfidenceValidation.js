#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
if (!process.env.DATABASE_URL) {
  require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });
}

const { queryWithTimeout } = require('../db/pg');
const { getResearchTerminalPayload, normalizeSymbol } = require('../services/researchCacheService');
const { getIndicators } = require('../engines/indicatorEngine');
const { getCoverageStatusBySymbols } = require('../v2/services/coverageEngine');
const { computeDataConfidence } = require('../services/dataConfidenceService');
const { getScreenerRows } = require('../v2/services/screenerService');

const REPORT_PATH = path.resolve(__dirname, '..', '..', 'DATA_CONFIDENCE_REPORT.json');

function normalizeCoveragePayload(symbol, coverageMap) {
  const row = coverageMap instanceof Map ? coverageMap.get(symbol) : null;
  return {
    symbol,
    has_news: Boolean(row?.has_news),
    has_earnings: Boolean(row?.has_earnings),
    has_technicals: Boolean(row?.has_technicals),
    coverage_score: Number(row?.coverage_score || 0),
  };
}

async function computeForSymbol(symbol) {
  const normalized = normalizeSymbol(symbol);
  const [payload, indicators, coverageMap] = await Promise.all([
    getResearchTerminalPayload(normalized),
    getIndicators(normalized),
    getCoverageStatusBySymbols([normalized]),
  ]);
  const coverage = normalizeCoveragePayload(normalized, coverageMap);
  const confidence = computeDataConfidence({ payload, indicators, coverage });

  return {
    symbol: normalized,
    coverage_score: confidence.coverage_score,
    freshness_score: confidence.freshness_score,
    source_quality: confidence.source_quality,
    data_confidence: confidence.data_confidence,
    data_confidence_label: confidence.data_confidence_label,
    has_news: coverage.has_news,
    has_earnings: coverage.has_earnings,
    has_technicals: coverage.has_technicals,
  };
}

async function mapSeries(values, mapper) {
  const output = [];
  for (const value of values) {
    output.push(await mapper(value));
  }
  return output;
}

async function selectHighCoverageSymbol() {
  const result = await queryWithTimeout(
    `SELECT symbol
     FROM data_coverage
     WHERE coverage_score = 100
     ORDER BY symbol ASC
     LIMIT 1`,
    [],
    {
      timeoutMs: 4000,
      label: 'data_confidence.high_coverage_symbol',
      maxRetries: 0,
      poolType: 'read',
    }
  );

  return result.rows?.[0]?.symbol || 'AAPL';
}

async function selectMissingNewsSymbol() {
  const result = await queryWithTimeout(
    `SELECT dc.symbol
     FROM data_coverage dc
     LEFT JOIN market_metrics mm ON UPPER(mm.symbol) = dc.symbol
     WHERE dc.has_news = FALSE
     ORDER BY dc.coverage_score DESC, COALESCE(mm.volume, 0) DESC, dc.symbol ASC
     LIMIT 1`,
    [],
    {
      timeoutMs: 4000,
      label: 'data_confidence.missing_news_symbol',
      maxRetries: 0,
      poolType: 'read',
    }
  );

  return result.rows?.[0]?.symbol || 'WBA';
}

async function main() {
  const highCoverageSymbol = await selectHighCoverageSymbol();
  const missingNewsSymbol = await selectMissingNewsSymbol();
  const [highCoverage, missingNews] = await mapSeries(
    [highCoverageSymbol, missingNewsSymbol],
    (symbol) => computeForSymbol(symbol)
  );

  const incompleteRows = await queryWithTimeout(
    `SELECT symbol
     FROM data_coverage
     WHERE coverage_score < 100
     ORDER BY coverage_score DESC, symbol ASC
    LIMIT 5`,
    [],
    {
      timeoutMs: 5000,
      label: 'data_confidence.incomplete_sample',
      maxRetries: 0,
      poolType: 'read',
    }
  );

  const sample = await mapSeries((incompleteRows.rows || []).map((row) => row.symbol), (symbol) => computeForSymbol(symbol));
  const fakeHighScores = sample.filter((row) => row.data_confidence_label === 'HIGH');
  const screenerResult = await getScreenerRows();
  const screenerRows = Array.isArray(screenerResult?.rows) ? screenerResult.rows : [];
  const dcsValues = screenerRows.map((row) => Number(row?.data_confidence || 0)).filter(Number.isFinite);
  const averageDcs = dcsValues.length
    ? Number((dcsValues.reduce((sum, value) => sum + value, 0) / dcsValues.length).toFixed(2))
    : 0;
  const sortedByVolume = [...screenerRows].sort((left, right) => Number(right?.volume || 0) - Number(left?.volume || 0));
  const summarizeTopVolumeDcs = (rows) => {
    const values = rows.map((row) => Number(row?.data_confidence || 0)).filter(Number.isFinite);
    const average = values.length
      ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2))
      : 0;
    return {
      count: rows.length,
      average_dcs: average,
      high_confidence: rows.filter((row) => Number(row?.data_confidence || 0) >= 85).length,
      medium_confidence: rows.filter((row) => Number(row?.data_confidence || 0) >= 65 && Number(row?.data_confidence || 0) < 85).length,
      low_confidence: rows.filter((row) => Number(row?.data_confidence || 0) < 65).length,
    };
  };

  const report = {
    generated_at: new Date().toISOString(),
    average_dcs: averageDcs,
    high_confidence_symbols: screenerRows.filter((row) => Number(row?.data_confidence || 0) >= 85).length,
    medium_confidence_symbols: screenerRows.filter((row) => Number(row?.data_confidence || 0) >= 65 && Number(row?.data_confidence || 0) < 85).length,
    low_confidence_symbols: screenerRows.filter((row) => Number(row?.data_confidence || 0) < 65).length,
    top_100_by_volume_dcs: summarizeTopVolumeDcs(sortedByVolume.slice(0, 100)),
    top_500_by_volume_dcs: summarizeTopVolumeDcs(sortedByVolume.slice(0, 500)),
    validation: {
      high_coverage_ticker_high_score: highCoverage.data_confidence_label === 'HIGH',
      missing_news_ticker_low_score: missingNews.data_confidence_label === 'LOW',
      no_fake_high_scores: fakeHighScores.length === 0,
    },
    samples: {
      high_coverage: highCoverage,
      missing_news: missingNews,
      incomplete_coverage_sample: sample,
      fake_high_scores: fakeHighScores,
    },
  };

  fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });