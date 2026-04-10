const dotenv = require('../server/node_modules/dotenv');

dotenv.config({ path: 'server/.env' });

function pick(obj, keys) {
  return keys.reduce((acc, key) => {
    acc[key] = obj?.[key];
    return acc;
  }, {});
}

async function main() {
  const base = process.env.API_BASE || 'http://127.0.0.1:3001';
  const headers = { Accept: 'application/json' };
  if (process.env.PROXY_API_KEY) {
    headers['x-api-key'] = process.env.PROXY_API_KEY;
  }

  const checks = [];

  const screenerRes = await fetch(base + '/api/screener', { headers });
  const screener = await screenerRes.json().catch(() => ({}));
  const screenerRow = Array.isArray(screener?.rows) ? screener.rows[0] : null;
  checks.push({
    endpoint: '/api/screener',
    status: screenerRes.status,
    criticalFields: pick(screenerRow || {}, ['symbol', 'price', 'relative_volume', 'change_percent']),
    nullCriticalFields: Object.entries(pick(screenerRow || {}, ['symbol', 'price'])).filter(([, v]) => v == null).map(([k]) => k),
  });

  const overviewRes = await fetch(base + '/api/market/overview', { headers });
  const overview = await overviewRes.json().catch(() => ({}));
  checks.push({
    endpoint: '/api/market/overview',
    status: overviewRes.status,
    criticalFields: {
      spy: overview?.indices?.SPY ?? null,
      qqq: overview?.indices?.QQQ ?? null,
      vix: overview?.volatility?.VIX ?? null,
      breadth: overview?.breadth ?? null,
    },
    nullCriticalFields: [
      overview?.indices?.SPY == null ? 'indices.SPY' : null,
      overview?.indices?.QQQ == null ? 'indices.QQQ' : null,
      overview?.volatility?.VIX == null ? 'volatility.VIX' : null,
      overview?.breadth == null ? 'breadth' : null,
    ].filter(Boolean),
  });

  const quotesRes = await fetch(base + '/api/market/quotes?symbols=SPY,QQQ,AAPL', { headers });
  const quotes = await quotesRes.json().catch(() => ({}));
  const quoteRow = Array.isArray(quotes?.quotes) ? quotes.quotes[0] : (Array.isArray(quotes?.data) ? quotes.data[0] : null);
  checks.push({
    endpoint: '/api/market/quotes',
    status: quotesRes.status,
    criticalFields: pick(quoteRow || {}, ['symbol', 'price', 'change_percent', 'relative_volume']),
    nullCriticalFields: Object.entries(pick(quoteRow || {}, ['symbol', 'price'])).filter(([, v]) => v == null).map(([k]) => k),
  });

  const decisionRes = await fetch(base + '/api/intelligence/decision/AAPL', { headers });
  const decision = await decisionRes.json().catch(() => ({}));
  const d = decision?.decision || {};
  checks.push({
    endpoint: '/api/intelligence/decision/AAPL',
    status: decisionRes.status,
    criticalFields: {
      why_moving: d?.why_moving ?? null,
      tradeability: d?.tradeability ?? null,
      execution_plan: d?.execution_plan ?? null,
      data_quality: d?.data_quality ?? null,
    },
    nullCriticalFields: [
      d?.why_moving == null ? 'why_moving' : null,
      d?.tradeability == null ? 'tradeability' : null,
      d?.execution_plan == null ? 'execution_plan' : null,
      d?.data_quality == null ? 'data_quality' : null,
    ].filter(Boolean),
  });

  const failing = checks.filter((c) => c.status !== 200 || c.nullCriticalFields.length > 0);

  console.log(JSON.stringify({ checks, failingCount: failing.length, failing }, null, 2));
  process.exit(failing.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(JSON.stringify({ fatal: error.message }, null, 2));
  process.exit(1);
});
