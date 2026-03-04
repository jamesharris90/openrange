// @ts-nocheck
const path = require('path');
const dotenv = require('dotenv');
const axios = require('axios');

const { getChartMarketData } = require(path.join(__dirname, '..', 'services', 'marketDataEngineV1.ts'));

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const FMP_BASE = 'https://financialmodelingprep.com';
const SAMPLE_SIZE = 50;

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

async function fetchUniverseSymbols() {
  const key = process.env.FMP_API_KEY;
  if (!key) throw new Error('FMP_API_KEY missing');

  const endpoints = [
    { exchange: 'NASDAQ', limit: 400 },
    { exchange: 'NYSE', limit: 400 },
    { exchange: 'AMEX', limit: 250 },
  ];

  const all = [];
  for (const cfg of endpoints) {
    const r = await axios.get(`${FMP_BASE}/stable/company-screener`, {
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

    if (r.status < 200 || r.status >= 300) continue;
    if (Array.isArray(r.data)) all.push(...r.data);
  }

  const symbols = [...new Set(
    all
      .map((x) => String(x?.symbol || '').trim().toUpperCase())
      .filter((s) => /^[A-Z.\-]{1,8}$/.test(s))
  )];

  return shuffle(symbols).slice(0, SAMPLE_SIZE);
}

function latestValue(series) {
  if (!Array.isArray(series) || !series.length) return null;
  return toNum(series[series.length - 1]?.value);
}

function getCoercedFundamentalZeroCount(fundamentals) {
  const rows = [fundamentals?.keyMetrics, fundamentals?.ratios, fundamentals?.profile].filter(Boolean);
  if (!rows.length) return 0;

  let suspiciousDomainZeros = 0;
  for (const row of rows) {
    const marginFields = ['grossProfitMargin', 'operatingProfitMargin', 'netProfitMargin', 'ebitdaMargin'];
    const growthFields = ['revenueGrowth', 'epsGrowth'];
    const ownershipFields = ['insiderOwnership', 'institutionalOwnership', 'shortFloatPercent'];

    const allZero = (fields) => {
      const present = fields.filter((f) => Object.prototype.hasOwnProperty.call(row, f));
      if (present.length !== fields.length) return false;
      return present.every((f) => toNum(row[f]) === 0);
    };

    if (allZero(marginFields)) suspiciousDomainZeros += 1;
    if (allZero(growthFields)) suspiciousDomainZeros += 1;
    if (allZero(ownershipFields)) suspiciousDomainZeros += 1;
  }

  return suspiciousDomainZeros;
}

async function run() {
  const symbols = await fetchUniverseSymbols();
  if (!symbols.length) throw new Error('No symbols fetched for smoke test');

  let avgVolumeZeroCount = 0;
  let rvolZeroCount = 0;
  let atrZeroCount = 0;
  let invalidRSICount = 0;
  let coercedFundamentalZeros = 0;
  let vwapZeroWhenVolumeExists = 0;

  for (const symbol of symbols) {
    let data;
    try {
      data = await getChartMarketData(symbol, '1min');
    } catch {
      continue;
    }

    const avgVolume = toNum(data?.metrics?.avgVolume);
    const currentVolume = toNum(data?.metrics?.currentVolume);
    const relativeVolume = toNum(data?.metrics?.relativeVolume);

    if (avgVolume === 0) avgVolumeZeroCount += 1;

    if (Number.isFinite(currentVolume) && Number.isFinite(avgVolume) && currentVolume > avgVolume && relativeVolume === 0) {
      rvolZeroCount += 1;
    }

    const latestAtr = latestValue(data?.indicators?.atr);
    if (!(Number.isFinite(latestAtr) && latestAtr > 0)) {
      atrZeroCount += 1;
    }

    const latestRsi = latestValue(data?.indicators?.rsi14);
    if (!(Number.isFinite(latestRsi) && latestRsi >= 0 && latestRsi <= 100)) {
      invalidRSICount += 1;
    }

    const latestVwap = latestValue(data?.indicators?.vwap);
    if (Number.isFinite(currentVolume) && currentVolume > 0 && latestVwap === 0) {
      vwapZeroWhenVolumeExists += 1;
    }

    coercedFundamentalZeros += getCoercedFundamentalZeroCount(data?.fundamentals);
  }

  const summary = {
    avgVolumeZeroCount,
    rvolZeroCount,
    atrZeroCount,
    invalidRSICount,
    coercedFundamentalZeros,
  };

  console.log(JSON.stringify(summary, null, 2));
  if (vwapZeroWhenVolumeExists > 0) {
    console.log(JSON.stringify({ vwapZeroWhenVolumeExists }, null, 2));
  }

  if (avgVolumeZeroCount > 5 || coercedFundamentalZeros > 0) {
    process.exit(1);
  }

  process.exit(0);
}

run().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
