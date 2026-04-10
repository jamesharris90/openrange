const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const ROOT_DIR = path.resolve(__dirname, '..');
require('dotenv').config({ path: path.join(ROOT_DIR, '.env') });

const API = process.env.OUTCOME_API || 'http://localhost:3001';

const FIVE_MIN_MS = Number(process.env.OUTCOME_TRACKER_5M_MS || (5 * 60 * 1000));
const FIFTEEN_MIN_ADDITIONAL_MS = Number(process.env.OUTCOME_TRACKER_15M_ADDITIONAL_MS || (10 * 60 * 1000));
const SIXTY_MIN_ADDITIONAL_MS = Number(process.env.OUTCOME_TRACKER_60M_ADDITIONAL_MS || (45 * 60 * 1000));

async function fetchCompat(url) {
  if (typeof fetch === 'function') return fetch(url);
  const mod = await import('node-fetch');
  return mod.default(url);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getTop5() {
  const res = await fetchCompat(`${API}/api/intelligence/top-opportunities?limit=5`);
  if (!res.ok) throw new Error(`top-opportunities status ${res.status}`);
  const json = await res.json();
  const rows = Array.isArray(json?.data)
    ? json.data
    : (Array.isArray(json?.results) ? json.results : []);
  return rows.slice(0, 5);
}

async function getQuote(symbol) {
  const res = await fetchCompat(`${API}/api/market/quotes?symbols=${encodeURIComponent(symbol)}`);
  if (!res.ok) return null;
  const json = await res.json();
  const row = Array.isArray(json?.data) ? json.data[0] : null;
  const price = Number(row?.price);
  return Number.isFinite(price) ? price : null;
}

function movePct(current, entry) {
  if (!Number.isFinite(current) || !Number.isFinite(entry) || entry <= 0) return null;
  return Number((((current - entry) / entry) * 100).toFixed(4));
}

function classifyOutcome(move15m) {
  if (!Number.isFinite(move15m)) return 'NEUTRAL';
  if (move15m > 1) return 'WINNER';
  if (move15m < -1) return 'LOSER';
  return 'NEUTRAL';
}

async function sendEmailReport(results, filePath) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const wins = results.filter((r) => r.outcome === 'WINNER').length;
  const total = results.length;

  const summary = `
Top 5 Outcome Report

Total: ${total}
Wins: ${wins}
Win Rate: ${total > 0 ? (wins / total).toFixed(2) : '0.00'}

Details:
${results.map((r) => `
${r.symbol}
Entry: ${r.entry_price}
5m: ${Number.isFinite(Number(r.move_5m)) ? Number(r.move_5m).toFixed(2) : 'N/A'}%
15m: ${Number.isFinite(Number(r.move_15m)) ? Number(r.move_15m).toFixed(2) : 'N/A'}%
60m: ${Number.isFinite(Number(r.move_60m)) ? Number(r.move_60m).toFixed(2) : 'N/A'}%
Outcome: ${r.outcome}
`).join('\n')}
Saved File: ${filePath}
`;

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: process.env.EMAIL_TO,
    subject: `Trade Outcome Report (${new Date().toLocaleTimeString()})`,
    text: summary,
  });

  console.log('[EMAIL] Report sent');
}

async function run() {
  const timestamp = new Date().toISOString();
  const top5 = await getTop5();

  const results = [];

  for (const t of top5) {
    const symbol = String(t?.symbol || '').toUpperCase();
    if (!symbol) continue;

    const entry = await getQuote(symbol);

    results.push({
      symbol,
      entry_price: entry,
      final_score: Number.isFinite(Number(t?.final_score)) ? Number(t.final_score) : null,
      relative_volume: Number.isFinite(Number(t?.relative_volume)) ? Number(t.relative_volume) : null,
      timestamp,
      move_5m: null,
      move_15m: null,
      move_60m: null,
      outcome: null,
    });
  }

  console.log('[TRACK] Initial snapshot captured', { symbols: results.map((r) => r.symbol) });

  await sleep(FIVE_MIN_MS);
  for (const r of results) {
    const quote = await getQuote(r.symbol);
    r.move_5m = movePct(quote, r.entry_price);
  }

  await sleep(FIFTEEN_MIN_ADDITIONAL_MS);
  for (const r of results) {
    const quote = await getQuote(r.symbol);
    r.move_15m = movePct(quote, r.entry_price);
  }

  await sleep(SIXTY_MIN_ADDITIONAL_MS);
  for (const r of results) {
    const quote = await getQuote(r.symbol);
    r.move_60m = movePct(quote, r.entry_price);
    r.outcome = classifyOutcome(r.move_15m);
  }

  const outDir = path.join(process.cwd(), 'logs');
  fs.mkdirSync(outDir, { recursive: true });

  const now = new Date();
  const label = now.toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(outDir, `outcome_${label}.json`);

  fs.writeFileSync(filePath, JSON.stringify(results, null, 2));

  console.log('[TRACK] Saved:', filePath);

  if (process.env.EMAIL_USER && process.env.EMAIL_PASS && process.env.EMAIL_TO) {
    await sendEmailReport(results, filePath);
  } else {
    console.log('[EMAIL] Skipped: EMAIL_USER/EMAIL_PASS/EMAIL_TO not fully configured');
  }

  console.log('[TRACK] Outcome tracking complete', { filePath, count: results.length });
}

run().catch((error) => {
  console.error('[TRACK] failed', error.message || String(error));
  process.exit(1);
});
