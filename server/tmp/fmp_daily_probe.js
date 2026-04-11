require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const { fmpFetch } = require('../services/fmpClient');

function normalizeRows(payload) {
  const rows = Array.isArray(payload) ? payload : [];
  return rows.map((row) => {
    const rawDate = String(row?.date || '').trim();
    let normalizedDate = null;
    const parsed = Date.parse(rawDate);
    if (rawDate && Number.isFinite(parsed)) {
      normalizedDate = new Date(parsed).toISOString().split('T')[0];
    }

    return {
      rawDate,
      normalizedDate,
      open: row?.open,
      high: row?.high,
      low: row?.low,
      close: row?.close,
      volume: row?.volume,
    };
  });
}

async function main() {
  const symbol = process.argv[2] || 'AAPL';
  const fromDate = process.argv[3] || '2026-04-09';
  const toDate = new Date().toISOString().slice(0, 10);
  const endpoints = [
    `/historical-price-eod/full?symbol=${encodeURIComponent(symbol)}&from=${fromDate}&to=${toDate}`,
    `/historical-price-eod/light?symbol=${encodeURIComponent(symbol)}&from=${fromDate}&to=${toDate}`,
    `/historical-chart/4hour?symbol=${encodeURIComponent(symbol)}&from=${fromDate}`,
  ];

  for (const endpoint of endpoints) {
    try {
      const payload = await fmpFetch(endpoint);
      const rows = normalizeRows(payload);
      console.log('[FMP ENDPOINT]', endpoint);
      console.log('[FMP DAILY RAW]', JSON.stringify((Array.isArray(payload) ? payload : []).slice(0, 3)));
      console.log('[FMP NORMALIZED SAMPLE]', JSON.stringify(rows.slice(0, 3)));
      console.log('[FMP HAS 2026-04-10]', rows.some((row) => row.normalizedDate === '2026-04-10'));
      console.log('[FMP MAX DATE]', rows.map((row) => row.normalizedDate).filter(Boolean).sort().slice(-1)[0] || null);
    } catch (error) {
      console.error('[FMP PROBE ERROR]', endpoint, error.message);
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
