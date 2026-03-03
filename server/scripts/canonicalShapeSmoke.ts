// @ts-nocheck
const path = require('path');
const dotenv = require('dotenv');
const axios = require('axios');

dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function run() {
  const headers = {};

  const response = await axios.get('http://127.0.0.1:3000/api/v3/screener/technical?symbol=AAPL&limit=1', {
    headers,
    timeout: 300000,
    validateStatus: () => true,
  });

  const row = Array.isArray(response.data?.data) ? response.data.data[0] : null;
  if (!row) {
    console.log(JSON.stringify({ status: response.status, error: 'No AAPL row' }, null, 2));
    process.exit(1);
  }

  const keys = Object.keys(row);
  const aliasKeys = ['forwardPe', 'peg', 'netMargin'];
  const aliasPresent = aliasKeys.filter((k) => Object.prototype.hasOwnProperty.call(row, k));

  const undefinedKeys = keys.filter((k) => row[k] === undefined);

  const result = {
    status: response.status,
    canonicalKeyCount: keys.length,
    hasForwardPE: Object.prototype.hasOwnProperty.call(row, 'forwardPE'),
    hasPegRatio: Object.prototype.hasOwnProperty.call(row, 'pegRatio'),
    hasNetProfitMargin: Object.prototype.hasOwnProperty.call(row, 'netProfitMargin'),
    aliasPresent,
    undefinedKeys,
    rsi14: row.rsi14,
    sma20: row.sma20,
    pe: row.pe,
  };

  console.log(JSON.stringify(result, null, 2));

  const pass =
    response.status === 200 &&
    result.hasForwardPE &&
    result.hasPegRatio &&
    result.hasNetProfitMargin &&
    aliasPresent.length === 0 &&
    undefinedKeys.length === 0 &&
    Number(row.rsi14) > 0 &&
    Number(row.sma20) > 0;

  process.exit(pass ? 0 : 1);
}

run().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
