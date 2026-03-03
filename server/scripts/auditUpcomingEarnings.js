const axios = require('axios');

const earningsWhispersTickers = [
  'CLNE', 'IOVA', 'XMTR', 'ATEC', 'EXPI', 'AXGN', 'EVH', 'MQ',
  'HURN', 'SUPN', 'AXON', 'AVNS',
  'HIMS', 'CNNE', 'BOOM', 'CWEN', 'EVER', 'PRA', 'BMRN',
  'ACVA', 'ERIE', 'MYGN', 'SCL', 'MAX', 'BLZE', 'OSG', 'TARS', 'SIBN',
  'UCTT', 'CRGO', 'LINC', 'BWXT', 'JBTM', 'SGHC', 'ADEA', 'KTOS', 'ALSN', 'VVX',
];

const API_BASE = process.env.EARNINGS_API_BASE || 'http://localhost:3030';
const BEARER_TOKEN = process.env.EARNINGS_BEARER_TOKEN || '';

async function run() {
  const results = [];
  const headers = {};
  if (BEARER_TOKEN) headers.Authorization = `Bearer ${BEARER_TOKEN}`;

  for (const symbol of earningsWhispersTickers) {
    try {
      const res = await axios.get(`${API_BASE}/api/earnings/events?symbol=${symbol}`, {
        timeout: 30000,
        headers,
        validateStatus: () => true,
      });

      if (res.status >= 200 && res.status < 300) {
        results.push({
          symbol,
          found: true,
          nextEarningsDate: res.data?.nextEarningsDate || null,
          reportTime: res.data?.reportTime || null,
          status: res.status,
        });
        continue;
      }

      results.push({
        symbol,
        found: false,
        status: res.status,
        error: res.data?.error || 'Not Found',
      });
    } catch (_err) {
      results.push({
        symbol,
        found: false,
        error: 'Request failed',
      });
    }
  }

  console.table(results);
}

run();
