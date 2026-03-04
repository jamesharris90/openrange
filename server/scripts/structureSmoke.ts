// @ts-nocheck
const path = require('path');
const dotenv = require('dotenv');
const axios = require('axios');

const { getChartMarketData } = require(path.join(__dirname, '..', 'services', 'marketDataEngineV1.ts'));
const { detectStructures } = require(path.join(__dirname, '..', 'services', 'strategyDetectionEngineV1.ts'));

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const FMP_BASE = 'https://financialmodelingprep.com';
const SAMPLE_SIZE = 30;

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
    { exchange: 'NASDAQ', limit: 220 },
    { exchange: 'NYSE', limit: 220 },
    { exchange: 'AMEX', limit: 120 },
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

function mapByTime(series) {
  return new Map((Array.isArray(series) ? series : []).map((p) => [p.time, p.value]));
}

function buildInvariantViolations(market, structure) {
  const violations = [];
  const intraday = market?.intradayCandles || [];
  const firstTime = intraday.length ? intraday[0].time : null;

  const atrPercentMap = mapByTime(market?.indicators?.atrPercent);
  const vwapMap = mapByTime(market?.indicators?.vwap);
  const candleByTime = new Map(intraday.map((c, i) => [c.time, { ...c, i }]));

  for (const s of structure?.structures || []) {
    if (s.structure === 'ORB') {
      if (Number.isFinite(firstTime) && Number.isFinite(s.time) && s.time > firstTime + (15 * 60)) {
        violations.push({
          type: 'ORB_WINDOW_VIOLATION',
          time: s.time,
        });
      }
    }

    if (s.structure === 'EMACompression') {
      const atrPct = toNum(atrPercentMap.get(s.time));
      if (Number.isFinite(atrPct) && atrPct > 5) {
        violations.push({
          type: 'EMA_COMPRESSION_ATR_VIOLATION',
          time: s.time,
          atrPercent: atrPct,
        });
      }
    }

    if (s.structure === 'VWAPReclaim') {
      const current = candleByTime.get(s.time);
      const prev = current && current.i > 0 ? intraday[current.i - 1] : null;
      const prevVwap = prev ? toNum(vwapMap.get(prev.time)) : null;
      const prevClose = toNum(prev?.close);
      if (!(Number.isFinite(prevVwap) && Number.isFinite(prevClose) && prevClose < prevVwap)) {
        violations.push({
          type: 'VWAP_RECLAIM_PRIOR_CLOSE_VIOLATION',
          time: s.time,
        });
      }
    }
  }

  return violations;
}

async function run() {
  const symbols = await fetchUniverseSymbols();
  if (!symbols.length) throw new Error('No symbols fetched for structure smoke');

  let totalViolations = 0;
  const sampleViolations = [];

  for (const symbol of symbols) {
    let market;
    try {
      market = await getChartMarketData(symbol, '1min');
    } catch {
      continue;
    }

    const structure = detectStructures(market);
    const violations = buildInvariantViolations(market, structure);

    if (violations.length) {
      totalViolations += violations.length;
      sampleViolations.push({ symbol, violations: violations.slice(0, 3) });
    }
  }

  console.log(JSON.stringify({ totalViolations, sampleViolations: sampleViolations.slice(0, 10) }, null, 2));

  if (totalViolations > 0) {
    process.exit(1);
  }

  process.exit(0);
}

run().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
