#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../server/.env'), override: true });
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), override: false });

const API_KEY = process.env.FMP_API_KEY;
const BASE = 'https://financialmodelingprep.com/stable';

function asArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

function toNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeSymbol(v) {
  return String(v || '').trim().toUpperCase();
}

async function fetchJson(url, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const res = await fetch(url, { signal: controller.signal });
    const raw = await res.text();
    let body = null;
    try {
      body = JSON.parse(raw);
    } catch (_err) {
      body = null;
    }
    return { status: res.status, body, ms: Date.now() - startedAt, error: null };
  } catch (err) {
    return {
      status: 0,
      body: null,
      ms: Date.now() - startedAt,
      error: err?.name === 'AbortError' ? 'timeout' : (err?.message || 'request_error')
    };
  } finally {
    clearTimeout(timer);
  }
}

function endpointUrl(url) {
  const joiner = url.includes('?') ? '&' : '?';
  return `${url}${joiner}apikey=${encodeURIComponent(API_KEY)}`;
}

async function main() {
  if (!API_KEY) throw new Error('FMP_API_KEY missing');

  const urls = {
    exchange: endpointUrl(`${BASE}/batch-exchange-quote?exchange=NASDAQ&short=true`),
    quote: endpointUrl(`${BASE}/batch-quote?symbols=AAPL,MSFT,NVDA,SPY,QQQ`),
    news: endpointUrl(`${BASE}/news/stock?symbols=AAPL,MSFT,NVDA,SPY,QQQ`),
    earnings: endpointUrl(`${BASE}/earnings-calendar`)
  };

  const [exchangeRes, quoteRes, newsRes, earningsRes] = await Promise.all([
    fetchJson(urls.exchange),
    fetchJson(urls.quote),
    fetchJson(urls.news),
    fetchJson(urls.earnings)
  ]);

  const exchangeRows = asArray(exchangeRes.body);
  const quoteRows = asArray(quoteRes.body);
  const newsRows = asArray(newsRes.body);
  const earningsRows = asArray(earningsRes.body);

  const universe = exchangeRows
    .map((r) => ({
      symbol: normalizeSymbol(r.symbol),
      price: toNumber(r.price),
      change_percent: toNumber(r.change),
      volume: toNumber(r.volume),
      updated_at: new Date().toISOString()
    }))
    .filter((r) => r.symbol && r.price !== null);

  const movers = universe
    .filter((r) => r.change_percent !== null && Math.abs(r.change_percent) >= 3 && (r.volume || 0) > 0)
    .sort((a, b) => Math.abs(b.change_percent) - Math.abs(a.change_percent));

  const newsBySymbol = new Map();
  for (const n of newsRows) {
    const sym = normalizeSymbol(n.symbol);
    if (!sym) continue;
    newsBySymbol.set(sym, (newsBySymbol.get(sym) || 0) + 1);
  }

  const earningsBySymbol = new Map();
  for (const e of earningsRows) {
    const sym = normalizeSymbol(e.symbol);
    if (!sym) continue;
    earningsBySymbol.set(sym, (earningsBySymbol.get(sym) || 0) + 1);
  }

  const contracts = movers.slice(0, 200).map((m) => ({
    symbol: m.symbol,
    price: m.price,
    change_percent: m.change_percent,
    volume: m.volume,
    news_count: newsBySymbol.get(m.symbol) || 0,
    earnings_count: earningsBySymbol.get(m.symbol) || 0
  }));

  const phaseResult = {
    generated_at: new Date().toISOString(),
    phase: 'fmp_dry_run_pipeline',
    no_writes_performed: true,
    endpoints: {
      batch_exchange_quote: { status: exchangeRes.status, size: exchangeRows.length, error: exchangeRes.error },
      batch_quote: { status: quoteRes.status, size: quoteRows.length, error: quoteRes.error },
      stock_news: { status: newsRes.status, size: newsRows.length, error: newsRes.error },
      earnings_calendar: { status: earningsRes.status, size: earningsRows.length, error: earningsRes.error }
    },
    counts: {
      universe_count: universe.length,
      movers_count: movers.length,
      contracts_count: contracts.length
    },
    samples: {
      top_movers: movers.slice(0, 10),
      contracts: contracts.slice(0, 10)
    },
    checks: {
      universe_gt_1000: universe.length > 1000,
      movers_gte_10: movers.length >= 10,
      endpoints_healthy: [exchangeRes, quoteRes, newsRes, earningsRes].every((r) => r.status >= 200 && r.status < 300)
    }
  };

  phaseResult.pass = Object.values(phaseResult.checks).every(Boolean);

  fs.mkdirSync(path.resolve(__dirname, '../logs'), { recursive: true });
  fs.writeFileSync(path.resolve(__dirname, '../logs/fmp_dry_run_pipeline.json'), JSON.stringify(phaseResult, null, 2));

  console.log('dry run written: logs/fmp_dry_run_pipeline.json');
  if (!phaseResult.pass) process.exit(1);
}

main().catch((err) => {
  fs.mkdirSync(path.resolve(__dirname, '../logs'), { recursive: true });
  fs.writeFileSync(
    path.resolve(__dirname, '../logs/fmp_dry_run_pipeline.json'),
    JSON.stringify({ generated_at: new Date().toISOString(), phase: 'fmp_dry_run_pipeline', pass: false, fatal_error: err.message }, null, 2)
  );
  console.error(err.message);
  process.exit(1);
});
