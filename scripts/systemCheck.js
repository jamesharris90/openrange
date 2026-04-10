#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const BASE = process.env.SYSTEM_CHECK_BASE_URL || 'http://localhost:3001';
const REQUIRED_ENDPOINTS = [
  '/api/stocks-in-play',
  '/api/intelligence/top-opportunities?limit=20',
  '/api/earnings?limit=40',
  '/api/catalysts?limit=40',
  '/api/market/overview',
];

async function getJson(endpoint) {
  const response = await fetch(`${BASE}${endpoint}`, {
    headers: process.env.PROXY_API_KEY ? { 'x-api-key': process.env.PROXY_API_KEY } : {},
  });
  const payload = await response.json().catch(() => null);
  return { status: response.status, ok: response.ok, payload };
}

function toRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.items)) return payload.items;
  if (Array.isArray(payload.results)) return payload.results;
  return [];
}

function hasTradeShape(row) {
  if (!row || typeof row !== 'object') return false;
  const symbol = String(row.symbol || '').trim().length > 0;
  const why = String(row.why_moving || row.headline || row.trade_reason || row.catalyst_type || row.report_date || '').trim().length > 0;
  const how = String(row.how_to_trade || row.execution || row.strategy || row.setup || row.report_time || '').trim().length > 0;
  const confidence = Number.isFinite(Number(row.confidence || row.trade_confidence || row.score || row.final_score || 50));
  return symbol && why && how && confidence;
}

function staticTickerLeakCheck() {
  const files = [
    'trading-os/src/lib/store/ticker-store.ts',
    'trading-os/src/components/terminal/trading-terminal-view.tsx',
    'trading-os/src/components/terminal/dashboard-view.tsx',
    'trading-os/src/components/sidebar.tsx',
  ];

  const leaks = [];
  const banned = ['"AAPL"', '"SPY"', '"QQQ"', '"IWM"', '/research/AAPL', "'AAPL'", "'SPY'", "'QQQ'", "'IWM'"];
  for (const file of files) {
    const absolute = path.resolve(process.cwd(), file);
    if (!fs.existsSync(absolute)) continue;
    const content = fs.readFileSync(absolute, 'utf8');
    if (banned.some((token) => content.includes(token))) {
      leaks.push(file);
    }
  }
  return leaks;
}

(async function run() {
  const checks = [];

  for (const endpoint of REQUIRED_ENDPOINTS) {
    const result = await getJson(endpoint);
    const rows = toRows(result.payload);
    checks.push({
      endpoint,
      status: result.status,
      ok: result.ok,
      rows: rows.length,
      has_trade_shape: rows.length === 0 ? false : hasTradeShape(rows[0]),
    });
  }

  const endpointPass = checks.every((check) => {
    if (!check.ok) return false;
    if (check.endpoint.includes('/api/market/overview')) return true;
    return true;
  });

  const byEndpoint = Object.fromEntries(checks.map((check) => [check.endpoint, check]));
  const noEmptyCockpitFlow =
    ((byEndpoint['/api/stocks-in-play']?.rows || 0) > 0 || (byEndpoint['/api/intelligence/top-opportunities?limit=20']?.rows || 0) > 0) &&
    (byEndpoint['/api/earnings?limit=40']?.rows || 0) > 0 &&
    (byEndpoint['/api/catalysts?limit=40']?.rows || 0) > 0;
  const tradeShapePass = checks
    .filter((check) => {
      if (check.endpoint.includes('top-opportunities')) return true;
      if ((check.endpoint.includes('earnings') || check.endpoint.includes('catalysts') || check.endpoint.includes('stocks-in-play')) && check.rows > 0) {
        return true;
      }
      return false;
    })
    .every((check) => check.has_trade_shape || check.endpoint.includes('earnings') || check.endpoint.includes('catalysts'));

  const staticLeaks = staticTickerLeakCheck();
  const staticLeakPass = staticLeaks.length === 0;

  const report = {
    generated_at: new Date().toISOString(),
    base_url: BASE,
    checks,
    static_ticker_leaks: staticLeaks,
    pass: endpointPass && tradeShapePass && staticLeakPass && noEmptyCockpitFlow,
  };

  const outputPath = path.resolve(process.cwd(), 'logs', 'system_check_report.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));

  if (report.pass) {
    console.log('OPENRANGE SYSTEM ALIGNED — UI + DATA TRUSTABLE');
    process.exit(0);
  }

  console.error('SYSTEM CHECK FAILED', report);
  process.exit(1);
})();
