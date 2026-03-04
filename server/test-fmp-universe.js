require('dotenv').config();
const axios = require('axios');

const API_KEY = process.env.FMP_API_KEY || 'TEMP_INLINE_KEY_HERE';
const TIMEOUT_MS = 20000;
const US_EXCHANGES = new Set(['NASDAQ', 'NYSE', 'AMEX']);

function separator(title) {
  const line = '='.repeat(72);
  console.log(`\n${line}`);
  console.log(title);
  console.log(line);
}

function isTimeoutError(error) {
  return (
    error?.code === 'ECONNABORTED' ||
    error?.message?.toLowerCase?.().includes('timeout')
  );
}

function countUsExchangeRows(rows) {
  if (!Array.isArray(rows)) return 0;
  return rows.filter((item) => {
    const exchange = String(item?.exchange || item?.exchangeShortName || '').toUpperCase();
    return US_EXCHANGES.has(exchange);
  }).length;
}

function firstRecord(rows) {
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

async function runEndpointTest({ label, url, onSuccess }) {
  separator(label);

  try {
    const response = await axios.get(url, {
      timeout: TIMEOUT_MS,
      headers: {
        apikey: API_KEY,
      },
      validateStatus: () => true,
    });

    const data = response.data;

    console.log('HTTP status:', response.status);

    if (response.status >= 200 && response.status < 300) {
      onSuccess(data);
      return;
    }

    console.log('Error response.status:', response.status);
    console.log('Error response.data:', data);
  } catch (error) {
    if (error?.response) {
      console.log('Error response.status:', error.response.status);
      console.log('Error response.data:', error.response.data);
      return;
    }

    if (isTimeoutError(error)) {
      console.log('Timeout error:', error.message);
      return;
    }

    if (error?.request) {
      console.log('Network error: request made but no response received');
      console.log('Details:', error.message || error.code || 'Unknown network error');
      return;
    }

    console.log('Unexpected error:', error?.message || error);
  }
}

async function main() {
  if (!API_KEY || API_KEY === 'TEMP_INLINE_KEY_HERE') {
    console.warn('Warning: FMP_API_KEY is not set. Using fallback placeholder key.');
  }

  await runEndpointTest({
    label: 'TEST 1: /stable/stock-list',
    url: 'https://financialmodelingprep.com/stable/stock-list',
    onSuccess: (data) => {
      const rows = Array.isArray(data) ? data : [];
      console.log('Total symbols returned:', rows.length);
      console.log('US exchange count (NASDAQ/NYSE/AMEX):', countUsExchangeRows(rows));
      console.log('First sample record:', firstRecord(rows));
    },
  });

  await runEndpointTest({
    label: 'TEST 2: /stable/actively-trading-list',
    url: 'https://financialmodelingprep.com/stable/actively-trading-list',
    onSuccess: (data) => {
      const rows = Array.isArray(data) ? data : [];
      console.log('Total actively trading count:', rows.length);
      console.log('First sample record:', firstRecord(rows));
    },
  });
}

main().catch((error) => {
  console.error('Fatal script error:', error?.message || error);
  process.exitCode = 1;
});
