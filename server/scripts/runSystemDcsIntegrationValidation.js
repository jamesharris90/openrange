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
const { computeDataConfidence } = require('../services/dataConfidenceService');
const { getCoverageStatusBySymbols } = require('../v2/services/coverageEngine');
const { getScreenerRows } = require('../v2/services/screenerService');
const { buildOpportunitiesPayload } = require('../v2/services/opportunitiesService');
const { getCoveragePriorityPreview } = require('../v2/services/adminService');

const OUTPUT_PATH = path.resolve(__dirname, '..', '..', 'SYSTEM_DCS_INTEGRATION_REPORT.json');
const BADGE_COMPONENT_PATH = path.resolve(__dirname, '..', '..', 'trading-os', 'src', 'components', 'research', 'DataConfidenceBadge.jsx');
const RESEARCH_PAGE_PATH = path.resolve(__dirname, '..', '..', 'trading-os', 'src', 'components', 'research', 'ResearchPage.jsx');
const RESEARCH_CACHE_PATH = path.resolve(__dirname, '..', 'services', 'researchCacheService.js');

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeCoveragePayload(symbol, coverageMap) {
  const row = coverageMap instanceof Map ? coverageMap.get(symbol) : null;
  return {
    symbol,
    has_news: Boolean(row?.has_news),
    has_earnings: Boolean(row?.has_earnings),
    has_technicals: Boolean(row?.has_technicals),
    news_count: Number(row?.news_count || 0),
    earnings_count: Number(row?.earnings_count || 0),
    last_news_at: row?.last_news_at || null,
    last_earnings_at: row?.last_earnings_at || null,
    coverage_score: Number(row?.coverage_score || 0),
  };
}

function isSortedByFinalScore(rows) {
  for (let index = 1; index < rows.length; index += 1) {
    if (toNumber(rows[index - 1]?.final_score) < toNumber(rows[index]?.final_score)) {
      return false;
    }
  }

  return true;
}

function buildRankMap(rows, field) {
  return new Map(
    [...rows]
      .sort((left, right) => toNumber(right?.[field]) - toNumber(left?.[field]))
      .map((row, index) => [String(row?.symbol || ''), index + 1])
  );
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
      label: 'system_dcs.missing_news_symbol',
      maxRetries: 0,
      poolType: 'read',
    }
  );

  return result.rows?.[0]?.symbol || null;
}

async function loadResearchConfidence(symbol) {
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
    coverage,
    confidence,
  };
}

function readFileText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function hasBadgeContract() {
  const badgeSource = readFileText(BADGE_COMPONENT_PATH);
  const pageSource = readFileText(RESEARCH_PAGE_PATH);

  return {
    tooltip_markup_present: [
      'Data Confidence:',
      'Coverage:',
      'Freshness:',
      'Sources:',
      'Limited data coverage',
      'No recent company news',
    ].every((token) => badgeSource.includes(token)),
    research_page_passes_detail_props: [
      'coverageScore={terminal.coverage?.coverage_score}',
      'freshnessScore={terminal.freshness_score}',
      'sourceQuality={terminal.source_quality}',
      'hasNews={terminal.coverage?.has_news}',
    ].every((token) => pageSource.includes(token)),
  };
}

function validateEarningsPlaceholderContract() {
  const source = readFileText(RESEARCH_CACHE_PATH);
  const valuesMatch = source.match(/VALUES \(([\s\S]*?)\)\n\s+ON CONFLICT/);
  const placeholders = valuesMatch
    ? Array.from(valuesMatch[1].matchAll(/\$(\d+)/g)).map((match) => Number(match[1]))
    : [];

  return {
    placeholders,
    unique_placeholder_count: new Set(placeholders).size,
    expected_placeholder_count: 11,
    placeholders_unique: placeholders.length === 11 && new Set(placeholders).size === 11,
  };
}

async function main() {
  const screenerResult = await getScreenerRows();
  const screenerRows = Array.isArray(screenerResult?.rows) ? screenerResult.rows : [];
  const opportunities = await buildOpportunitiesPayload({
    rows: screenerRows,
    macroContext: screenerResult?.macroContext || null,
  });
  const opportunityRows = Array.isArray(opportunities?.rows) ? opportunities.rows : [];
  const preview = await getCoveragePriorityPreview({ limit: 50 });
  const previewRows = Array.isArray(preview?.rows) ? preview.rows : [];

  const topFinalRows = screenerRows.slice(0, 10).map((row) => ({
    symbol: row.symbol,
    tqi: toNumber(row.tqi),
    data_confidence: toNumber(row.data_confidence),
    final_score: toNumber(row.final_score),
    coverage_score: toNumber(row.coverage_score),
    tradeable: Boolean(row.tradeable),
  }));
  const lowDcsHighTqiRows = screenerRows
    .filter((row) => toNumber(row.data_confidence) < 60)
    .sort((left, right) => toNumber(right.tqi) - toNumber(left.tqi));
  const finalScoreRanks = buildRankMap(screenerRows, 'final_score');
  const tqiRanks = buildRankMap(screenerRows, 'tqi');
  const lowDcsCandidate = lowDcsHighTqiRows[0] || null;
  const demotionCheck = lowDcsCandidate
    ? {
        symbol: lowDcsCandidate.symbol,
        tqi_rank: tqiRanks.get(lowDcsCandidate.symbol) || null,
        final_score_rank: finalScoreRanks.get(lowDcsCandidate.symbol) || null,
        passed: (finalScoreRanks.get(lowDcsCandidate.symbol) || Number.POSITIVE_INFINITY) > (tqiRanks.get(lowDcsCandidate.symbol) || 0),
      }
    : {
        symbol: null,
        tqi_rank: null,
        final_score_rank: null,
        passed: true,
      };

  const researchProbeSymbol = lowDcsCandidate?.symbol || screenerRows[0]?.symbol || 'AAPL';
  const researchProbe = await loadResearchConfidence(researchProbeSymbol);
  const missingNewsSymbol = await selectMissingNewsSymbol();
  const missingNewsProbe = missingNewsSymbol ? await loadResearchConfidence(missingNewsSymbol) : null;
  const badgeContract = hasBadgeContract();
  const placeholderContract = validateEarningsPlaceholderContract();

  const validations = {
    screener_sorted_by_final_score: isSortedByFinalScore(screenerRows),
    high_tqi_low_dcs_demoted: demotionCheck.passed,
    no_tradeable_ticker_with_low_dcs: screenerRows.every((row) => !row.tradeable || toNumber(row.data_confidence) >= 50),
    no_top_ranked_ticker_with_incomplete_data: screenerRows.slice(0, 10).every((row) => toNumber(row.data_confidence) >= 60 && toNumber(row.coverage_score) >= 60),
    opportunities_exclude_low_dcs: opportunityRows.every((row) => toNumber(row.data_confidence) >= 60),
    research_badge_tooltip_contract_ready: badgeContract.tooltip_markup_present && badgeContract.research_page_passes_detail_props,
    research_payload_contains_tooltip_fields: [
      researchProbe.confidence.data_confidence,
      researchProbe.confidence.freshness_score,
      researchProbe.confidence.source_quality,
      researchProbe.coverage.coverage_score,
    ].every((value) => Number.isFinite(Number(value))),
    missing_news_probe_warnable: missingNewsProbe ? !missingNewsProbe.coverage.has_news : true,
    admin_priority_preview_available: previewRows.every((row) => Array.isArray(row.missing_fields)) && previewRows.length <= 50,
    earnings_sql_placeholders_unique: placeholderContract.placeholders_unique,
  };

  const report = {
    generated_at: new Date().toISOString(),
    screener: {
      row_count: screenerRows.length,
      top_10: topFinalRows,
      low_dcs_high_tqi_candidate: demotionCheck,
    },
    opportunities: {
      row_count: opportunityRows.length,
      sample: opportunityRows.slice(0, 4).map((row) => ({
        symbol: row.symbol,
        data_confidence: toNumber(row.data_confidence),
        final_score: toNumber(row.final_score),
        confidence: toNumber(row.confidence),
      })),
    },
    research: {
      probe_symbol: researchProbe.symbol,
      probe_confidence: researchProbe.confidence,
      probe_coverage: researchProbe.coverage,
      missing_news_probe: missingNewsProbe,
      badge_contract: badgeContract,
    },
    admin: {
      preview_count: previewRows.length,
      preview_sample: previewRows.slice(0, 10),
    },
    database: {
      placeholder_contract: placeholderContract,
    },
    validations,
    pass: Object.values(validations).every(Boolean),
  };

  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(report, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });