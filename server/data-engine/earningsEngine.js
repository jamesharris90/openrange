const axios = require('axios');

async function fetchEarnings(apiKey) {
  const url = `https://financialmodelingprep.com/stable/earnings-calendar?apikey=${apiKey}`;
  const response = await axios.get(url, { timeout: 30000, validateStatus: () => true });
  if (response.status < 200 || response.status >= 300) return [];
  return Array.isArray(response.data) ? response.data : [];
}

function toWindow(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;
  const diff = Math.floor((new Date(d.toDateString()).getTime() - new Date(now.toDateString()).getTime()) / dayMs);
  if (diff === 0) return 'today';
  if (diff > 0 && diff <= 7) return 'thisWeek';
  if (diff < 0 && diff >= -7) return 'lastWeek';
  return 'other';
}

async function buildEarningsMap(universe, apiKey, logger = console) {
  const rows = await fetchEarnings(apiKey);
  const map = new Map();
  const bySymbol = new Map();

  rows.forEach((r) => {
    const s = String(r.symbol || '').toUpperCase();
    if (!s) return;
    if (!bySymbol.has(s)) bySymbol.set(s, []);
    bySymbol.get(s).push(r);
  });

  universe.forEach((row) => {
    const items = (bySymbol.get(row.symbol) || []).sort((a, b) => new Date(a.date) - new Date(b.date));
    const next = items.find((i) => new Date(i.date) >= new Date()) || null;
    map.set(row.symbol, {
      nextEarningsDate: next?.date || null,
      earningsWindow: toWindow(next?.date),
      earningsSession: next?.time || null,
      lastEarningsBeatMiss: null,
      epsSurprisePercent: null,
      revenueSurprisePercent: null,
      postEarningsMovePercent: null,
    });
  });

  logger.info('Earnings engine complete', { symbols: map.size, rawRows: rows.length });
  return map;
}

module.exports = {
  buildEarningsMap,
};
