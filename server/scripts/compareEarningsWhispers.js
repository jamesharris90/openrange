const axios = require('axios');

const earningsWhispersTickers = [
  'CLNE', 'IOVA', 'XMTR', 'ATEC', 'EXPI', 'AXGN', 'EVH', 'MQ',
  'HURN', 'SUPN', 'AXON', 'AVNS',
  'HIMS', 'CNNE', 'BOOM', 'CWEN', 'EVER', 'PRA', 'BMRN',
  'ACVA', 'ERIE', 'MYGN', 'SCL', 'MAX', 'BLZE', 'OSG', 'TARS', 'SIBN',
  'UCTT', 'CRGO', 'LINC', 'BWXT', 'JBTM', 'SGHC', 'ADEA', 'KTOS', 'ALSN', 'VVX',
];

const API_BASE = process.env.EARNINGS_API_BASE || 'http://localhost:3030';

function pick(value, fallback = null) {
  return value == null ? fallback : value;
}

async function run() {
  const results = [];

  for (const symbol of earningsWhispersTickers) {
    try {
      const res = await axios.get(`${API_BASE}/api/earnings/intelligence?symbol=${symbol}`, {
        timeout: 30000,
        validateStatus: () => true,
      });

      if (res.status < 200 || res.status >= 300 || !res.data || res.data.error) {
        results.push({
          symbol,
          status: res.status,
          error: res.data?.error || 'Not Found',
        });
        continue;
      }

      const row = res.data;
      results.push({
        symbol,
        tier: pick(row.tier),
        totalScore: pick(row.totalScore, row.total_score),
        expectedMove: pick(row.expectedMovePct, row.expected_move_pct),
        continuationBias: pick(row.continuationBias, row.continuation_bias),
      });
    } catch (_err) {
      results.push({
        symbol,
        error: 'Not Found',
      });
    }
  }

  console.table(results.sort((a, b) => (Number(b.totalScore) || 0) - (Number(a.totalScore) || 0)));
}

run();
