const axios = require('axios');
const csv = require('csvtojson');
const cache = require('../utils/cache');
const { FINVIZ_NEWS_TOKEN } = require('../utils/config');
const { withRetry } = require('../utils/retry');

const GAP_TTL = 45 * 1000;
const GAP_DEFAULT_FILTERS = 'sh_price_o1,sh_avgvol_o500,ta_gap_u';

async function fetchGappers(limit = 60, filters = GAP_DEFAULT_FILTERS, order = '-change') {
  if (!FINVIZ_NEWS_TOKEN) throw new Error('FINVIZ_NEWS_TOKEN missing');
  const key = `fgap:${limit}:${filters}:${order}`;
  const cached = cache.get(key);
  if (cached) return cached;
  let url = `https://elite.finviz.com/export.ashx?v=111&auth=${FINVIZ_NEWS_TOKEN}`;
  if (filters) url += `&f=${filters}`;
  if (order) url += `&o=${order}`;
  const resp = await withRetry(() => axios.get(url, { responseType: 'text', timeout: 12000 }));
  const rows = await csv().fromString(resp.data);
  const tickers = rows.map(r => (r.Ticker || r.ticker || r.Symbol || '').trim().toUpperCase()).filter(Boolean).slice(0, limit);
  cache.set(key, tickers, GAP_TTL);
  return tickers;
}

module.exports = { name: 'finviz', fetchGappers };
