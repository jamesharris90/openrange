// @ts-nocheck
const path = require('path');
const dotenv = require('dotenv');
const axios = require('axios');

const { getChartMarketData } = require(path.join(__dirname, '..', 'services', 'marketDataEngineV1.ts'));
const { detectStructures } = require(path.join(__dirname, '..', 'services', 'strategyDetectionEngineV1.ts'));

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const FMP_BASE = 'https://financialmodelingprep.com';
const SAMPLE_SIZE = 40;
const ATR_MIN_THRESHOLD = 0.5;

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function shuffle(arr) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function latestValue(series) {
  if (!Array.isArray(series) || !series.length) return null;
  const v = Number(series[series.length - 1]?.value);
  return Number.isFinite(v) ? v : null;
}

async function fetchUniverseSymbols() {
  const key = process.env.FMP_API_KEY;
  if (!key) throw new Error('FMP_API_KEY missing');

  const endpoints = [
    { exchange: 'NASDAQ', limit: 300 },
    { exchange: 'NYSE', limit: 300 },
    { exchange: 'AMEX', limit: 180 },
  ];

  const all = [];
  for (const cfg of endpoints) {
    const response = await axios.get(`${FMP_BASE}/stable/company-screener`, {
      params: {
        exchange: cfg.exchange,
        isActivelyTrading: 'true',
        isEtf: 'false',
        isFund: 'false',
        limit: String(cfg.limit),
        apikey: key,
      },
      timeout: 30000,
      validateStatus: () => true,
    });

    if (response.status < 200 || response.status >= 300) continue;
    if (Array.isArray(response.data)) all.push(...response.data);
  }

  const symbols = [...new Set(
    all
      .map((row) => String(row?.symbol || '').trim().toUpperCase())
      .filter((symbol) => /^[A-Z.\-]{1,8}$/.test(symbol))
  )];

  return shuffle(symbols).slice(0, SAMPLE_SIZE);
}

async function run() {
  const symbols = await fetchUniverseSymbols();
  if (!symbols.length) throw new Error('No symbols fetched for structure hardening smoke');

  const violations = [];
  let structureCount = 0;
  let confidenceTotal = 0;

  for (const symbol of symbols) {
    let market;
    try {
      market = await getChartMarketData(symbol, '1min');
    } catch {
      continue;
    }

    const strategy = detectStructures(market, { trace: true });
    const atrPct = latestValue(market?.indicators?.atrPercent);

    for (const result of strategy?.structures || []) {
      structureCount += 1;
      confidenceTotal += Number(result?.confidence) || 0;

      if (result?.liquidityQualified !== true) {
        violations.push({ symbol, type: result?.type, rule: 'liquidityQualified must be true' });
      }

      if (Number(result?.confidence) > 80 && result?.primaryRulesPassed !== true) {
        violations.push({ symbol, type: result?.type, rule: 'confidence > 80 requires primary rules pass' });
      }

      if (!(Number.isFinite(atrPct) && atrPct >= ATR_MIN_THRESHOLD)) {
        violations.push({ symbol, type: result?.type, rule: 'no structure when ATR% below threshold', atrPercent: atrPct });
      }
    }
  }

  const avgConfidence = structureCount > 0 ? Number((confidenceTotal / structureCount).toFixed(2)) : 0;
  const summary = {
    sampledSymbols: symbols.length,
    structureCount,
    avgConfidence,
    violationCount: violations.length,
    sampleViolations: violations.slice(0, 15),
  };

  console.log(JSON.stringify(summary, null, 2));

  if (violations.length === 0) {
    console.log('Structure invariants: PASS');
    process.exit(0);
  }

  console.log('Structure invariants: FAIL');
  process.exit(1);
}

run().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
