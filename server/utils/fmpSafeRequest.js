const axios = require('axios');
const delay = require('./delay');

const FMP_DELAY_MS = 200;

async function fmpSafeRequest(url) {
  await delay(FMP_DELAY_MS);

  const res = await axios.get(url, {
    timeout: 10000,
  });

  return res.data;
}

module.exports = fmpSafeRequest;
