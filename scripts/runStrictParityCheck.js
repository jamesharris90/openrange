/* eslint-disable no-console */

const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const pool = require("../server/db/pool");

dotenv.config({ path: path.resolve(process.cwd(), "server/.env") });

const API_BASE = process.env.API_BASE || "http://localhost:3001";
const API_KEY = process.env.PROXY_API_KEY || "";

function ensureDir(relPath) {
  const dir = path.resolve(process.cwd(), relPath);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function apiGet(pathname) {
  const response = await fetch(`${API_BASE}${pathname}`, {
    headers: {
      Accept: "application/json",
      ...(API_KEY ? { "x-api-key": API_KEY } : {}),
    },
  });

  const json = await response.json().catch(() => ({}));
  return { status: response.status, json };
}

function normalizeDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function compareTop(dbTop, apiTop, mode) {
  if (!dbTop || !apiTop) return false;

  if (mode === "news") {
    return (
      String(dbTop.symbol || "") === String(apiTop.symbol || "")
      && normalizeDate(dbTop.published_date) === normalizeDate(apiTop.published_date)
      && String(dbTop.title || "") === String(apiTop.title || "")
    );
  }

  return (
    String(dbTop.symbol || "") === String(apiTop.symbol || "")
    && normalizeDate(dbTop.event_date) === normalizeDate(apiTop.event_date)
  );
}

async function run() {
  const symbolsQ = await pool.query(`
    with e as (
      select symbol from earnings_calendar
      where symbol is not null and symbol <> ''
      order by random() limit 1
    ),
    n as (
      select symbol from news_articles
      where symbol is not null and symbol <> ''
      order by random() limit 1
    ),
    i as (
      select symbol from ipo_calendar
      where symbol is not null and symbol <> ''
      order by random() limit 1
    ),
    s as (
      select symbol from stock_splits
      where symbol is not null and symbol <> ''
      order by random() limit 1
    )
    select
      (select symbol from e) as earnings_symbol,
      (select symbol from n) as news_symbol,
      (select symbol from i) as ipos_symbol,
      (select symbol from s) as splits_symbol
  `);

  const symbols = symbolsQ.rows[0];

  const db = {
    earnings: await pool.query(
      "select symbol,event_date from earnings_calendar where symbol=$1 order by event_date desc limit 3",
      [symbols.earnings_symbol]
    ),
    news: await pool.query(
      "select symbol,published_date,title from news_articles where symbol=$1 order by published_date desc nulls last limit 3",
      [symbols.news_symbol]
    ),
    ipos: await pool.query(
      "select symbol,event_date from ipo_calendar where symbol=$1 order by event_date desc limit 3",
      [symbols.ipos_symbol]
    ),
    splits: await pool.query(
      "select symbol,event_date from stock_splits where symbol=$1 order by event_date desc limit 3",
      [symbols.splits_symbol]
    ),
  };

  const api = {
    earnings: await apiGet(`/api/earnings?symbol=${encodeURIComponent(symbols.earnings_symbol)}&limit=3`),
    news: await apiGet(`/api/news?symbol=${encodeURIComponent(symbols.news_symbol)}&limit=3`),
    ipos: await apiGet(`/api/ipos?symbol=${encodeURIComponent(symbols.ipos_symbol)}&limit=3`),
    splits: await apiGet(`/api/splits?symbol=${encodeURIComponent(symbols.splits_symbol)}&limit=3`),
  };

  const checks = {
    earnings: {
      status: api.earnings.status,
      dbRows: db.earnings.rows.length,
      apiRows: Array.isArray(api.earnings.json?.data) ? api.earnings.json.data.length : 0,
      topMatches: compareTop(
        db.earnings.rows[0] || null,
        Array.isArray(api.earnings.json?.data) ? api.earnings.json.data[0] || null : null,
        "event"
      ),
      dbTop: db.earnings.rows[0] || null,
      apiTop: Array.isArray(api.earnings.json?.data) ? api.earnings.json.data[0] || null : null,
    },
    news: {
      status: api.news.status,
      dbRows: db.news.rows.length,
      apiRows: Array.isArray(api.news.json?.data) ? api.news.json.data.length : 0,
      topMatches: compareTop(
        db.news.rows[0] || null,
        Array.isArray(api.news.json?.data) ? api.news.json.data[0] || null : null,
        "news"
      ),
      dbTop: db.news.rows[0] || null,
      apiTop: Array.isArray(api.news.json?.data) ? api.news.json.data[0] || null : null,
    },
    ipos: {
      status: api.ipos.status,
      dbRows: db.ipos.rows.length,
      apiRows: Array.isArray(api.ipos.json?.data) ? api.ipos.json.data.length : 0,
      topMatches: compareTop(
        db.ipos.rows[0] || null,
        Array.isArray(api.ipos.json?.data) ? api.ipos.json.data[0] || null : null,
        "event"
      ),
      dbTop: db.ipos.rows[0] || null,
      apiTop: Array.isArray(api.ipos.json?.data) ? api.ipos.json.data[0] || null : null,
    },
    splits: {
      status: api.splits.status,
      dbRows: db.splits.rows.length,
      apiRows: Array.isArray(api.splits.json?.data) ? api.splits.json.data.length : 0,
      topMatches: compareTop(
        db.splits.rows[0] || null,
        Array.isArray(api.splits.json?.data) ? api.splits.json.data[0] || null : null,
        "event"
      ),
      dbTop: db.splits.rows[0] || null,
      apiTop: Array.isArray(api.splits.json?.data) ? api.splits.json.data[0] || null : null,
    },
  };

  const report = {
    generatedAt: new Date().toISOString(),
    apiBase: API_BASE,
    symbols,
    checks,
    ok: Object.values(checks).every(
      (item) => item.status === 200 && item.dbRows > 0 && item.apiRows > 0 && item.topMatches === true
    ),
  };

  ensureDir("logs/backtests");
  const outPath = path.resolve(process.cwd(), "logs/backtests/parity-report.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8");

  console.log(JSON.stringify(report, null, 2));
  console.log(`Wrote ${outPath}`);

  if (!report.ok) {
    process.exitCode = 2;
  }
}

run()
  .catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
