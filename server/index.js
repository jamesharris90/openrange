const express = require('express');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const csv = require('csvtojson');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const path = require('path');
const cookieParser = require('cookie-parser');
const fs = require('fs').promises;
require('dotenv').config();

// Logger
const logger = require('./logger');

// User model for auth context
const userModel = require('./users/model');

// User management
const userRoutes = require('./users/routes');

// Finviz Elite News Endpoint (CSV export)
const FINVIZ_NEWS_TOKEN = process.env.FINVIZ_NEWS_TOKEN;
const FINVIZ_NEWS_URL = FINVIZ_NEWS_TOKEN
  ? `https://elite.finviz.com/news_export.ashx?v=1&auth=${FINVIZ_NEWS_TOKEN}`
  : null;
let finvizNewsCache = { data: null, ts: 0 };
const FINVIZ_NEWS_CACHE_MS = 60 * 1000; // 1 minute
let finvizNewsScannerCache = {};
const FINVIZ_NEWS_SCANNER_CACHE_MS = 2 * 60 * 1000; // 2 minutes

async function fetchFinvizNews() {
  if (!FINVIZ_NEWS_URL) {
    logger.warn('FINVIZ_NEWS_TOKEN not set. Skipping Finviz news fetch.');
    return;
  }
  try {
    const response = await axios.get(FINVIZ_NEWS_URL, { responseType: 'text', timeout: 10000 });
    const csvData = await csv().fromString(response.data);

    // Normalize Finviz CSV format to match Finnhub format
    // Expected Finnhub format: { datetime, headline, summary, source, url, image }
    const normalizedData = csvData.map(item => {
      // Finviz CSV typically has: Date, Time, Headline, Link, Source
      const datetime = item.Date && item.Time
        ? new Date(`${item.Date} ${item.Time}`).getTime() / 1000
        : Date.now() / 1000;

      return {
        datetime: datetime,
        headline: item.Headline || item.Title || item.headline || '',
        summary: '', // Finviz doesn't provide summaries
        source: item.Source || item.source || 'Finviz',
        url: item.Link || item.URL || item.url || '#',
        image: '' // Finviz doesn't provide images
      };
    });

    finvizNewsCache = { data: normalizedData, ts: Date.now() };
  } catch (err) {
    logger.error('Finviz news fetch error:', { error: err.message, stack: err.stack });
  }
}

// Initial fetch and periodic refresh only if token is configured
if (FINVIZ_NEWS_TOKEN) {
  fetchFinvizNews();
  setInterval(fetchFinvizNews, FINVIZ_NEWS_CACHE_MS);
}

async function loadScannerContext() {
  if (!FINVIZ_NEWS_TOKEN) {
    return { available: false, text: 'Scanner context unavailable: FINVIZ token missing.' };
  }
  try {
    const url = `https://elite.finviz.com/export.ashx?v=111&auth=${FINVIZ_NEWS_TOKEN}&f=sh_avgvol_o500,ta_change_u5`;
    const response = await axios.get(url, { responseType: 'text', timeout: 12000 });
    const csvData = await csv().fromString(response.data);
    const compact = (csvData || []).slice(0, 20).map(row => {
      const ticker = row.Ticker || row.ticker || row.Symbol || row.symbol || 'N/A';
      const price = row.Price || row.Last || row['Price'] || row['Last'];
      const change = row.Change || row['Change'] || row['Perf Week'];
      const relVol = row['Rel Volume'] || row.RelVolume || row.RV || row['Volume Ratio'];
      return `${ticker}: price ${price || 'n/a'}, %chg ${change || 'n/a'}, rvol ${relVol || 'n/a'}`;
    });
    const text = compact.join('\n').slice(0, 4000);
    return { available: compact.length > 0, text }; 
  } catch (err) {
    logger.warn('Scanner context load failed:', { error: err.message });
    return { available: false, text: 'Scanner context unavailable: fetch failed.' };
  }
}

async function loadSecContext() {
  try {
    const jsonExists = await fs.access(SEC_JSON_PATH).then(() => true).catch(() => false);
    if (jsonExists) {
      const raw = await fs.readFile(SEC_JSON_PATH, 'utf8');
      const data = JSON.parse(raw);
      const compact = (Array.isArray(data) ? data : []).slice(0, 25).map(item => {
        const sym = item.symbol || item.ticker || item.Symbol || 'N/A';
        const form = item.form || item.Form || item.type || 'Filing';
        const note = item.description || item.notes || item.summary || '';
        return `${sym} - ${form}${note ? `: ${note}` : ''}`;
      });
      const text = compact.join('\n').slice(0, 4000);
      return { available: compact.length > 0, text };
    }

    const mdExists = await fs.access(SEC_MD_PATH).then(() => true).catch(() => false);
    if (mdExists) {
      const md = await fs.readFile(SEC_MD_PATH, 'utf8');
      const text = md.slice(0, 4000);
      return { available: true, text };
    }

    return { available: false, text: 'SEC context unavailable: no filings file present.' };
  } catch (err) {
    logger.warn('SEC context load failed:', { error: err.message });
    return { available: false, text: 'SEC context unavailable: read failed.' };
  }
}

async function buildContext(contextSource = 'none') {
  if (contextSource === 'scanner') {
    const ctx = await loadScannerContext();
    return { usedContext: 'scanner', text: ctx.text, available: ctx.available };
  }
  if (contextSource === 'sec') {
    const ctx = await loadSecContext();
    return { usedContext: 'sec', text: ctx.text, available: ctx.available };
  }
  return { usedContext: 'none', text: '', available: false };
}

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// CORS configuration - restrict in production
const corsOptions = {
  origin: process.env.NODE_ENV === 'production'
    ? process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000']
    : true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key']
};
app.use(cors(corsOptions));

// Security headers middleware
app.use((req, res, next) => {
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');

  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // XSS protection
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // Referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Content Security Policy (adjust as needed for your widgets)
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Content-Security-Policy',
      "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://unpkg.com https://s3.tradingview.com https://fonts.googleapis.com; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src 'self' https://fonts.gstatic.com; " +
      "img-src 'self' data: https:; " +
      "connect-src 'self' https://gateway.saxobank.com https://finnhub.io https://elite.finviz.com; " +
      "frame-src 'self' https://s3.tradingview.com"
    );
  }

  // Permissions Policy
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  next();
});

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    // Log API requests (not static files)
    if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) {
      logger.info('Request', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration: `${duration}ms`,
        ip: req.ip || req.connection?.remoteAddress
      });
    }
  });
  next();
});

const PORT = process.env.PORT || 3000;
const SAXO_BASE = process.env.SAXO_API_URL || 'https://gateway.saxobank.com/openapi';
const SAXO_CLIENT_KEY = process.env.SAXO_CLIENT_KEY;
const PROXY_API_KEY = process.env.PROXY_API_KEY || null;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const FRONTEND_PATH = path.join(__dirname, '..');
const PPLX_API_KEY = process.env.PPLX_API_KEY || null;
const PPLX_MODEL = process.env.PPLX_MODEL || 'sonar-pro';
const SEC_JSON_PATH = path.join(__dirname, 'data', 'sec-earnings-today.json');
const SEC_MD_PATH = path.join(__dirname, 'data', 'sec-earnings-today-ai.md');
const PREMARKET_REPORT_JSON_PATH = path.join(__dirname, '..', 'premarket-screener', 'sample-output', 'report.json');
const PREMARKET_REPORT_MD_PATH = path.join(__dirname, '..', 'premarket-screener', 'sample-output', 'report.md');

// =====================================================
// Yahoo Finance via yahoo-finance2 npm package
// =====================================================
const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

// Yahoo per-ticker cache
const yahooCache = {};
const YAHOO_CACHE_MS = 5 * 60 * 1000;       // 5 minutes for options/quote
const YAHOO_HISTORY_CACHE_MS = 30 * 60 * 1000; // 30 minutes for history

function yahooCacheGet(ticker, type) {
  const key = `${ticker}:${type}`;
  const entry = yahooCache[key];
  const ttl = type === 'history' ? YAHOO_HISTORY_CACHE_MS : YAHOO_CACHE_MS;
  if (entry && Date.now() - entry.ts < ttl) return entry.data;
  return null;
}

function yahooCacheSet(ticker, type, data) {
  yahooCache[`${ticker}:${type}`] = { data, ts: Date.now() };
  // Evict oldest if cache grows too large
  const keys = Object.keys(yahooCache);
  if (keys.length > 200) {
    keys.sort((a, b) => yahooCache[a].ts - yahooCache[b].ts)
      .slice(0, 50)
      .forEach(k => delete yahooCache[k]);
  }
}

// Historical Volatility computation
function computeHVMetrics(closes) {
  if (!closes || closes.length < 22) return null;
  // Daily log returns
  const returns = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > 0 && closes[i - 1] > 0) {
      returns.push(Math.log(closes[i] / closes[i - 1]));
    }
  }
  // Rolling 20-day HV (annualized)
  const window = 20;
  const hvValues = [];
  for (let i = window; i <= returns.length; i++) {
    const slice = returns.slice(i - window, i);
    const mean = slice.reduce((a, b) => a + b, 0) / window;
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / (window - 1);
    const annualized = Math.sqrt(variance) * Math.sqrt(252);
    hvValues.push(annualized);
  }
  if (hvValues.length === 0) return null;
  const current = hvValues[hvValues.length - 1];
  const high = Math.max(...hvValues);
  const low = Math.min(...hvValues);
  const rank = high !== low ? ((current - low) / (high - low)) * 100 : 50;
  return {
    hvCurrent20: +current.toFixed(4),
    hvHigh52w: +high.toFixed(4),
    hvLow52w: +low.toFixed(4),
    hvRank: +rank.toFixed(2)
  };
}

// Initialize Saxo OAuth
const SaxoOAuth = require('./saxo-oauth');
const saxoAuth = new SaxoOAuth({
  appKey: process.env.SAXO_APP_KEY,
  appSecret: process.env.SAXO_APP_SECRET,
  authUrl: process.env.SAXO_AUTH_URL,
  tokenUrl: process.env.SAXO_TOKEN_URL,
  redirectUri: process.env.SAXO_REDIRECT_URI
});

// Load existing tokens on startup
saxoAuth.initialize().catch(err => {
  logger.warn('Failed to initialize Saxo OAuth:', err.message);
});

// Serve static files (HTML, CSS, JS) from parent directory FIRST
app.use(express.static(FRONTEND_PATH, {
  index: ['login.html']  // Default to login.html if no file specified
}));

// Serve React app (Vite build) at /app/* (allow SPA fallthrough)
const REACT_BUILD = path.join(__dirname, '..', 'client-dist');
app.use('/app', express.static(REACT_BUILD, { fallthrough: true }));
app.get('/app/*', (req, res) => {
  const indexPath = path.join(REACT_BUILD, 'index.html');
  const fs = require('fs');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('React app not built. Run: cd client && npm run build');
  }
});
// Friendly aliases for SPA deep links (earnings & watchlist) with optional trailing segments
app.get([
  '/earnings', '/earnings/*', '/app/earnings', '/app/earnings/*',
  '/watchlist', '/watchlist/*', '/app/watchlist', '/app/watchlist/*'
], (req, res) => {
  const indexPath = path.join(REACT_BUILD, 'index.html');
  const fs = require('fs');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('React app not built. Run: cd client && npm run build');
  }
});

// Rate limiting for registration endpoint (more strict)
const registrationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 registrations per 15 minutes
  message: { error: 'Too many registration attempts. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const limiter = rateLimit({ windowMs: 60 * 1000, max: 120 });

// Resolve Perplexity credentials with optional user override
async function resolvePplxConfig(req) {
  const fallbackModel = PPLX_MODEL || 'sonar-pro';
  let apiKey = PPLX_API_KEY;
  let model = fallbackModel;

  const token = req.get('Authorization')?.replace('Bearer ', '');
  if (token) {
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      const userSettings = await userModel.getPplxSettings(payload.id);
      if (userSettings?.apiKey) apiKey = userSettings.apiKey;
      if (userSettings?.model) model = userSettings.model;
    } catch (err) {
      logger.warn('Perplexity user context parse failed', { error: err.message });
    }
  }

  return { apiKey, model };
}

// Public endpoints (no auth required)
app.get('/api/health', (req, res) => {
  res.json({ ok: true, env: process.env.NODE_ENV || 'development' });
});

app.get('/api/config', (req, res) => {
  res.json({
    clientKey: process.env.SAXO_CLIENT_KEY || null,
    accountNumber: process.env.SAXO_ACCOUNT_NUMBER || null
  });
});

app.get('/api/scanner/status', async (req, res) => {
  if (!FINVIZ_NEWS_TOKEN) {
    return res.json({ available: false, message: 'Scanner context unavailable (FINVIZ token missing).' });
  }
  const ctx = await loadScannerContext();
  res.json({ available: ctx.available, message: ctx.available ? 'Scanner context loaded.' : 'Scanner context unavailable.' });
});

app.get('/api/sec-earnings-status', async (req, res) => {
  const ctx = await loadSecContext();
  res.json({ available: ctx.available, message: ctx.available ? 'SEC earnings context loaded.' : 'SEC earnings context unavailable.' });
});

app.get('/api/ai-quant/status', (req, res) => {
  const hasKey = Boolean(PPLX_API_KEY);
  res.json({
    available: hasKey,
    model: PPLX_MODEL || 'sonar-pro',
    message: hasKey ? 'Perplexity key detected in server environment.' : 'Set PPLX_API_KEY or add a user key to enable AI Quant.'
  });
});

// =====================================================
// AI Quant Engine — Market Context & Trade Plan Builder
// =====================================================

// Market Context: SPY, QQQ, VIX, DXY with technical analysis & bias
app.get('/api/ai-quant/market-context', async (req, res) => {
  const cached = yahooCacheGet('__market_ctx', 'context');
  if (cached) return res.json(cached);

  try {
    const tickers = ['SPY', 'QQQ', '^VIX', 'DX-Y.NYB'];
    const quoteResults = await Promise.allSettled(tickers.map(t => yahooFinance.quote(t)));

    const indices = tickers.map((sym, i) => {
      const r = quoteResults[i];
      if (r.status !== 'fulfilled' || !r.value) return { ticker: sym, error: true };
      const q = r.value;
      return {
        ticker: q.symbol || sym, name: q.shortName || sym,
        price: q.regularMarketPrice || 0,
        change: q.regularMarketChange != null ? +q.regularMarketChange.toFixed(2) : 0,
        changePercent: q.regularMarketChangePercent != null ? +q.regularMarketChangePercent.toFixed(2) : 0,
      };
    });

    // Fetch 100-day charts for SPY/QQQ MA calculations
    const chartStart = new Date(); chartStart.setDate(chartStart.getDate() - 100);
    const chartResults = await Promise.allSettled(
      ['SPY', 'QQQ'].map(t => yahooFinance.chart(t, { period1: chartStart, period2: new Date(), interval: '1d' }))
    );

    const smaCalc = (arr, p) => arr.length >= p ? +(arr.slice(-p).reduce((a, b) => a + b, 0) / p).toFixed(2) : null;
    const techMap = {};
    ['SPY', 'QQQ'].forEach((sym, i) => {
      const r = chartResults[i];
      if (r.status !== 'fulfilled' || !r.value) return;
      const quotes = (r.value.quotes || []).filter(q => q.close != null);
      if (quotes.length < 20) return;
      const closes = quotes.map(q => q.close);
      const cp = closes[closes.length - 1];
      const s9 = smaCalc(closes, 9), s20 = smaCalc(closes, 20), s50 = smaCalc(closes, 50);
      techMap[sym] = {
        price: cp, sma9: s9, sma20: s20, sma50: s50,
        aboveSMA9: s9 != null ? cp > s9 : null,
        aboveSMA20: s20 != null ? cp > s20 : null,
        aboveSMA50: s50 != null ? cp > s50 : null,
      };
    });

    // Rule-based market bias
    const spy = techMap['SPY'] || {};
    const qqq = techMap['QQQ'] || {};
    const vixObj = indices.find(i => (i.ticker || '').includes('VIX'));
    const vixPrice = vixObj?.price || 0;
    const spyIdx = indices.find(i => i.ticker === 'SPY');

    let bull = 0, bear = 0;
    const reasons = [];
    if (spy.aboveSMA20) { bull++; reasons.push('SPY > 20-SMA'); } else if (spy.aboveSMA20 === false) { bear++; reasons.push('SPY < 20-SMA'); }
    if (spy.aboveSMA50) { bull++; reasons.push('SPY > 50-SMA'); } else if (spy.aboveSMA50 === false) { bear++; reasons.push('SPY < 50-SMA'); }
    if (qqq.aboveSMA20) bull++; else if (qqq.aboveSMA20 === false) bear++;
    if (qqq.aboveSMA50) bull++; else if (qqq.aboveSMA50 === false) bear++;
    if (vixPrice > 25) { bear += 2; reasons.push(`VIX elevated (${vixPrice.toFixed(1)})`); }
    else if (vixPrice > 20) { bear++; reasons.push(`VIX cautious (${vixPrice.toFixed(1)})`); }
    else if (vixPrice < 15) { bull++; reasons.push(`VIX low (${vixPrice.toFixed(1)})`); }
    if (spyIdx?.changePercent > 0.5) { bull++; reasons.push('SPY up today'); }
    else if (spyIdx?.changePercent < -0.5) { bear++; reasons.push('SPY down today'); }

    const bias = bull >= bear + 2 ? 'bullish' : bear >= bull + 2 ? 'bearish' : 'neutral';
    const data = { indices, technicals: techMap, bias, biasReasons: reasons, timestamp: Date.now() };
    yahooCacheSet('__market_ctx', 'context', data);
    res.json(data);
  } catch (err) {
    logger.warn('Market context error', { error: err.message });
    res.status(502).json({ error: 'Failed to fetch market context', detail: err.message });
  }
});

// Sector performance — uses SPDR sector ETFs
app.get('/api/ai-quant/sector-performance', async (req, res) => {
  const cached = yahooCacheGet('__sectors', 'perf');
  if (cached) return res.json(cached);

  const SECTOR_ETFS = [
    { etf: 'XLK', sector: 'Technology' },
    { etf: 'XLF', sector: 'Financials' },
    { etf: 'XLE', sector: 'Energy' },
    { etf: 'XLV', sector: 'Healthcare' },
    { etf: 'XLY', sector: 'Consumer Disc.' },
    { etf: 'XLP', sector: 'Consumer Staples' },
    { etf: 'XLI', sector: 'Industrials' },
    { etf: 'XLRE', sector: 'Real Estate' },
    { etf: 'XLU', sector: 'Utilities' },
    { etf: 'XLB', sector: 'Materials' },
    { etf: 'XLC', sector: 'Communication' },
    { etf: 'BITO', sector: 'Crypto' },
  ];

  try {
    const results = await Promise.allSettled(
      SECTOR_ETFS.map(s => yahooFinance.quote(s.etf))
    );
    const sectors = SECTOR_ETFS.map((s, i) => {
      const r = results[i];
      if (r.status !== 'fulfilled' || !r.value) return { ...s, error: true };
      const q = r.value;
      return {
        etf: s.etf,
        sector: s.sector,
        price: q.regularMarketPrice || 0,
        change: q.regularMarketChange != null ? +Number(q.regularMarketChange).toFixed(2) : 0,
        changePercent: q.regularMarketChangePercent != null ? +Number(q.regularMarketChangePercent).toFixed(2) : 0,
      };
    }).filter(s => !s.error);

    // Sort by performance
    sectors.sort((a, b) => b.changePercent - a.changePercent);
    const data = { sectors, timestamp: Date.now() };
    yahooCacheSet('__sectors', 'perf', data);
    res.json(data);
  } catch (err) {
    logger.warn('Sector performance error', { error: err.message });
    res.status(502).json({ error: 'Failed to fetch sector data', detail: err.message });
  }
});

// =====================================================
// Market-Adjusted Expected Move Engine
// =====================================================
const { computeComposite } = require('./lib/scoring');
const scoringWeights = require('./lib/config/scoringWeights');

app.get('/api/expected-move-enhanced', async (req, res) => {
  const ticker = (req.query.ticker || req.query.t || '').trim().toUpperCase();
  if (!ticker || !/^[A-Z0-9.^-]{1,10}$/.test(ticker)) {
    return res.status(400).json({ error: 'Invalid or missing ticker parameter' });
  }

  // Check cache first (2-minute TTL for enhanced analysis)
  const cached = yahooCacheGet(ticker, 'em-enhanced');
  if (cached) return res.json(cached);

  try {
    // ── 1. Parallel data fetching ──────────────────────────────────
    const now = new Date();
    const oneYearAgo = new Date(now); oneYearAgo.setFullYear(now.getFullYear() - 1);
    const thirtyDaysAgo = new Date(now); thirtyDaysAgo.setDate(now.getDate() - 30);
    const newsFrom = new Date(now); newsFrom.setDate(now.getDate() - 3);

    const [quoteResult, optionsResult, chartResult, chart30dResult, marketCtxResult, sectorResult, newsResult, earningsSummaryResult] = await Promise.allSettled([
      // Full quote (includes beta, sector, marketCap, volume)
      yahooFinance.quote(ticker),
      // Options chain (nearest expiry)
      yahooFinance.options(ticker, {}),
      // 1-year chart for HV + 52W levels + SMA200
      yahooFinance.chart(ticker, { period1: oneYearAgo, period2: now, interval: '1d' }),
      // 30-day chart for ATR + SMA20
      yahooFinance.chart(ticker, { period1: thirtyDaysAgo, period2: now, interval: '1d' }),
      // Market context (SPY/QQQ/VIX)
      (async () => {
        const c = yahooCacheGet('__market_ctx', 'context');
        if (c) return c;
        // Inline fetch if not cached
        const ticks = ['SPY', 'QQQ', '^VIX'];
        const qr = await Promise.allSettled(ticks.map(t => yahooFinance.quote(t)));
        const indices = ticks.map((s, i) => {
          const r = qr[i]; if (r.status !== 'fulfilled' || !r.value) return { ticker: s, error: true };
          const q = r.value;
          return { ticker: q.symbol || s, name: q.shortName || s, price: q.regularMarketPrice || 0,
            change: q.regularMarketChange != null ? +q.regularMarketChange.toFixed(2) : 0,
            changePercent: q.regularMarketChangePercent != null ? +q.regularMarketChangePercent.toFixed(2) : 0 };
        });
        const chartStart = new Date(); chartStart.setDate(chartStart.getDate() - 100);
        const cr = await Promise.allSettled(['SPY', 'QQQ'].map(t => yahooFinance.chart(t, { period1: chartStart, period2: new Date(), interval: '1d' })));
        const smaCalc = (arr, p) => arr.length >= p ? +(arr.slice(-p).reduce((a, b) => a + b, 0) / p).toFixed(2) : null;
        const techMap = {};
        ['SPY', 'QQQ'].forEach((sym, i) => {
          const r = cr[i]; if (r.status !== 'fulfilled' || !r.value) return;
          const quotes = (r.value.quotes || []).filter(q => q.close != null);
          if (quotes.length < 20) return;
          const cls = quotes.map(q => q.close); const cp = cls[cls.length - 1];
          const s9 = smaCalc(cls, 9), s20 = smaCalc(cls, 20), s50 = smaCalc(cls, 50);
          techMap[sym] = { price: cp, sma9: s9, sma20: s20, sma50: s50,
            aboveSMA9: s9 != null ? cp > s9 : null, aboveSMA20: s20 != null ? cp > s20 : null, aboveSMA50: s50 != null ? cp > s50 : null };
        });
        let bull = 0, bear = 0; const reasons = [];
        const spy = techMap['SPY'] || {};
        if (spy.aboveSMA20) { bull++; reasons.push('SPY > 20-SMA'); } else if (spy.aboveSMA20 === false) { bear++; reasons.push('SPY < 20-SMA'); }
        if (spy.aboveSMA50) { bull++; reasons.push('SPY > 50-SMA'); } else if (spy.aboveSMA50 === false) { bear++; reasons.push('SPY < 50-SMA'); }
        const vixObj = indices.find(i => (i.ticker || '').includes('VIX'));
        const vp = vixObj?.price || 0;
        if (vp > 25) { bear += 2; } else if (vp < 15) { bull++; }
        const bias = bull >= bear + 2 ? 'bullish' : bear >= bull + 2 ? 'bearish' : 'neutral';
        return { indices, technicals: techMap, bias, biasReasons: reasons };
      })(),
      // Sector performance
      (async () => {
        const c = yahooCacheGet('__sectors', 'perf');
        if (c) return c;
        const SECTOR_ETFS = [
          { etf: 'XLK', sector: 'Technology' }, { etf: 'XLF', sector: 'Financials' },
          { etf: 'XLE', sector: 'Energy' }, { etf: 'XLV', sector: 'Healthcare' },
          { etf: 'XLY', sector: 'Consumer Disc.' }, { etf: 'XLP', sector: 'Consumer Staples' },
          { etf: 'XLI', sector: 'Industrials' }, { etf: 'XLRE', sector: 'Real Estate' },
          { etf: 'XLU', sector: 'Utilities' }, { etf: 'XLB', sector: 'Materials' },
          { etf: 'XLC', sector: 'Communication' },
        ];
        const results = await Promise.allSettled(SECTOR_ETFS.map(s => yahooFinance.quote(s.etf)));
        return { sectors: SECTOR_ETFS.map((s, i) => {
          const r = results[i]; if (r.status !== 'fulfilled' || !r.value) return { ...s, error: true };
          const q = r.value;
          return { etf: s.etf, sector: s.sector, price: q.regularMarketPrice || 0,
            change: q.regularMarketChange != null ? +Number(q.regularMarketChange).toFixed(2) : 0,
            changePercent: q.regularMarketChangePercent != null ? +Number(q.regularMarketChangePercent).toFixed(2) : 0 };
        }).filter(s => !s.error) };
      })(),
      // News (Finnhub)
      (async () => {
        if (!process.env.FINNHUB_API_KEY) return [];
        const from = newsFrom.toISOString().split('T')[0];
        const to = now.toISOString().split('T')[0];
        const url = `https://finnhub.io/api/v1/company-news?symbol=${ticker}&from=${from}&to=${to}&token=${process.env.FINNHUB_API_KEY}`;
        const resp = await fetch(url);
        if (!resp.ok) return [];
        const data = await resp.json();
        return Array.isArray(data) ? data.slice(0, 20) : [];
      })(),
      // Earnings detail (next date + surprise)
      yahooFinance.quoteSummary(ticker, { modules: ['earnings', 'calendarEvents'] }),
    ]);

    // ── 2. Extract data ────────────────────────────────────────────
    const quote = quoteResult.status === 'fulfilled' ? quoteResult.value : null;
    const optionsRaw = optionsResult.status === 'fulfilled' ? optionsResult.value : null;
    const chartData = chartResult.status === 'fulfilled' ? chartResult.value : null;
    const chart30d = chart30dResult.status === 'fulfilled' ? chart30dResult.value : null;
    const marketCtx = marketCtxResult.status === 'fulfilled' ? marketCtxResult.value : null;
    const sectorData = sectorResult.status === 'fulfilled' ? sectorResult.value : null;
    const newsItems = newsResult.status === 'fulfilled' ? newsResult.value : [];
    const earningsSummary = earningsSummaryResult.status === 'fulfilled' ? earningsSummaryResult.value : null;

    if (!quote) {
      return res.status(404).json({ error: `No data found for ${ticker}` });
    }

    const price = quote.regularMarketPrice || 0;
    const changePercent = quote.regularMarketChangePercent != null ? +Number(quote.regularMarketChangePercent).toFixed(2) : 0;
    const beta = quote.beta || null;
    const marketCap = quote.marketCap || null;
    const sectorName = quote.sector || null;
    const avgVolume20 = quote.averageDailyVolume10Day || quote.averageVolume || null;

    // ── 3. Options parsing ─────────────────────────────────────────
    let optionsData = null;
    if (optionsRaw) {
      // If nearest expiry is today or past, try next
      let opts = optionsRaw.options?.[0] || {};
      if (optionsRaw.options?.length > 1) {
        const firstExpiry = opts.expirationDate;
        const exMs = firstExpiry instanceof Date ? firstExpiry.getTime() : (firstExpiry ? firstExpiry * 1000 : 0);
        const dte = Math.ceil((exMs - Date.now()) / 86400000);
        if (dte <= 0 && optionsRaw.expirationDates?.length > 1) {
          const nextDate = optionsRaw.expirationDates[1];
          const nd = nextDate instanceof Date ? nextDate : new Date(nextDate * 1000);
          try {
            const nextResult = await yahooFinance.options(ticker, { date: nd });
            opts = nextResult?.options?.[0] || opts;
          } catch (e) { /* use first */ }
        }
      }

      const calls = opts.calls || [];
      const puts = opts.puts || [];
      const expirationDate = opts.expirationDate || null;
      const expiryMs = expirationDate instanceof Date ? expirationDate.getTime() : (expirationDate ? expirationDate * 1000 : 0);
      const expiryStr = expiryMs ? new Date(expiryMs).toISOString().split('T')[0] : null;
      const daysToExpiry = expiryMs ? Math.max(0, Math.ceil((expiryMs - Date.now()) / 86400000)) : 0;

      const allStrikes = [...new Set([...calls.map(c => c.strike), ...puts.map(p => p.strike)])].sort((a, b) => a - b);
      const atmStrike = allStrikes.length ? allStrikes.reduce((best, s) => Math.abs(s - price) < Math.abs(best - price) ? s : best, allStrikes[0]) : price;

      const atmCall = calls.find(c => c.strike === atmStrike) || null;
      const atmPut = puts.find(p => p.strike === atmStrike) || null;

      const ivVals = [atmCall?.impliedVolatility, atmPut?.impliedVolatility].filter(v => v != null);
      const avgIV = ivVals.length ? +(ivVals.reduce((a, b) => a + b, 0) / ivVals.length).toFixed(4) : null;

      const callMidRaw = atmCall ? ((atmCall.bid || 0) + (atmCall.ask || 0)) / 2 : 0;
      const callMid = callMidRaw > 0 ? callMidRaw : (atmCall?.lastPrice || 0);
      const putMidRaw = atmPut ? ((atmPut.bid || 0) + (atmPut.ask || 0)) / 2 : 0;
      const putMid = putMidRaw > 0 ? putMidRaw : (atmPut?.lastPrice || 0);
      const straddleMid = +(callMid + putMid).toFixed(2);
      const ivExpectedMove = avgIV && price ? +(price * avgIV * Math.sqrt(Math.max(daysToExpiry, 1) / 365)).toFixed(2) : 0;
      const expectedMove = straddleMid > 0 ? straddleMid : ivExpectedMove;
      const expectedMovePercent = price ? +((expectedMove / price) * 100).toFixed(2) : 0;

      // Earnings
      optionsData = {
        atmStrike, daysToExpiry, expirationDate: expiryStr,
        atmCall: atmCall ? { strike: atmCall.strike, bid: atmCall.bid || 0, ask: atmCall.ask || 0, mid: +callMid.toFixed(2), lastPrice: atmCall.lastPrice || 0, iv: atmCall.impliedVolatility || null, volume: atmCall.volume || 0, openInterest: atmCall.openInterest || 0 } : null,
        atmPut: atmPut ? { strike: atmPut.strike, bid: atmPut.bid || 0, ask: atmPut.ask || 0, mid: +putMid.toFixed(2), lastPrice: atmPut.lastPrice || 0, iv: atmPut.impliedVolatility || null, volume: atmPut.volume || 0, openInterest: atmPut.openInterest || 0 } : null,
        straddleMid, avgIV, ivExpectedMove,
        expectedMove, expectedMovePercent,
        rangeHigh: +(price + expectedMove).toFixed(2),
        rangeLow: +(price - expectedMove).toFixed(2),
        callsCount: calls.length, putsCount: puts.length,
        earningsDate: null, earningsInDays: null,
      };
    }

    // ── 3b. Earnings (next date + last surprise) ─────────────────
    const normalizeDateMs = (val) => {
      if (!val) return null;
      if (val instanceof Date) return val.getTime();
      if (typeof val === 'number') return val > 1e12 ? val : val * 1000;
      const d = new Date(val);
      return Number.isFinite(d.getTime()) ? d.getTime() : null;
    };

    const calEvents = earningsSummary?.calendarEvents || {};
    const earningsModule = earningsSummary?.earnings || {};

    const earningsDateRaw = calEvents?.earnings?.earningsDate;
    let earningsDateMs = Array.isArray(earningsDateRaw) && earningsDateRaw.length
      ? normalizeDateMs(earningsDateRaw[0])
      : normalizeDateMs(earningsDateRaw);
    if (!earningsDateMs && optionsData?.earningsDate) earningsDateMs = normalizeDateMs(optionsData.earningsDate);
    if (!earningsDateMs && optionsData?.earningsInDays != null && optionsData.earningsInDays > 0) {
      earningsDateMs = Date.now() + optionsData.earningsInDays * 86400000;
    }
    if (!earningsDateMs && optionsRaw?.quote?.earningsTimestamp) earningsDateMs = normalizeDateMs(optionsRaw.quote.earningsTimestamp);
    if (!earningsDateMs && quote?.earningsTimestamp) earningsDateMs = normalizeDateMs(quote.earningsTimestamp);

    const earningsDateStr = earningsDateMs ? new Date(earningsDateMs).toISOString().split('T')[0] : optionsData?.earningsDate || null;
    const earningsInDays = earningsDateMs ? Math.ceil((earningsDateMs - Date.now()) / 86400000) : optionsData?.earningsInDays ?? null;
    if (optionsData) {
      optionsData.earningsDate = earningsDateStr;
      optionsData.earningsInDays = earningsInDays;
    }

    const quarterly = earningsModule?.earningsChart?.quarterly || [];
    let lastPeriod = null;
    let lastEpsActual = null;
    let lastEpsEstimate = null;
    let lastSurprisePercent = null;
    let beatsInLast4 = null;
    if (quarterly.length) {
      const last = quarterly[quarterly.length - 1];
      lastPeriod = last?.date || null;
      lastEpsActual = last?.actual?.raw ?? last?.actual ?? null;
      lastEpsEstimate = last?.estimate?.raw ?? last?.estimate ?? null;
      if (lastEpsActual != null && lastEpsEstimate != null && lastEpsEstimate !== 0) {
        lastSurprisePercent = +(((lastEpsActual - lastEpsEstimate) / Math.abs(lastEpsEstimate)) * 100).toFixed(2);
      }
      if (lastSurprisePercent == null && last?.surprisePct != null) {
        const parsed = parseFloat(last.surprisePct);
        if (!Number.isNaN(parsed)) lastSurprisePercent = +parsed.toFixed(2);
      }
      beatsInLast4 = quarterly.filter(q => {
        const act = q?.actual?.raw ?? q?.actual;
        const est = q?.estimate?.raw ?? q?.estimate;
        return act != null && est != null && act >= est;
      }).length;
    }

    // ── 4. Chart-derived technicals ────────────────────────────────
    const allQuotes = (chartData?.quotes || []).filter(q => q.close != null);
    const closes = allQuotes.map(q => q.close);
    const highs = allQuotes.map(q => q.high).filter(h => h != null);
    const lows = allQuotes.map(q => q.low).filter(l => l != null);
    const high52w = highs.length ? Math.max(...highs) : null;
    const low52w = lows.length ? Math.min(...lows) : null;

    const hvMetrics = computeHVMetrics(closes);
    const smaCalcLocal = (arr, p) => arr.length >= p ? +(arr.slice(-p).reduce((a, b) => a + b, 0) / p).toFixed(2) : null;
    const sma20 = smaCalcLocal(closes, 20);
    const sma50 = smaCalcLocal(closes, 50);
    const sma200 = smaCalcLocal(closes, 200);

    // ATR-14 from 30d chart
    let atr14 = null;
    const bars30d = (chart30d?.quotes || []).filter(q => q.close != null && q.high != null && q.low != null);
    if (bars30d.length >= 15) {
      const recent = bars30d.slice(-15);
      let sum = 0;
      for (let i = 1; i < recent.length; i++) {
        sum += Math.max(recent[i].high - recent[i].low, Math.abs(recent[i].high - recent[i - 1].close), Math.abs(recent[i].low - recent[i - 1].close));
      }
      atr14 = +(sum / 14).toFixed(2);
    }

    // SPY expected move for beta-adjusted comparison
    let spyExpectedMovePercent = null;
    if (marketCtx?.technicals?.SPY) {
      const spyCached = yahooCacheGet('SPY', 'options');
      if (spyCached) {
        spyExpectedMovePercent = spyCached.expectedMovePercent || null;
      }
    }

    // ── 5. Probability calculations ────────────────────────────────
    const probContainment1SD = 68.2;  // by definition for 1 standard deviation
    const probBreach1SD = 31.8;
    // If IV is significantly above HV, empirically containment is higher
    let adjustedContainment = probContainment1SD;
    if (optionsData?.avgIV != null && hvMetrics?.hvCurrent20 != null) {
      const ivPremium = optionsData.avgIV - hvMetrics.hvCurrent20;
      if (ivPremium > 0.1) adjustedContainment = Math.min(85, probContainment1SD + ivPremium * 50);
      else if (ivPremium < -0.05) adjustedContainment = Math.max(55, probContainment1SD + ivPremium * 40);
    }

    // ── 6. Compute composite score ─────────────────────────────────
    const sectorETF = sectorName ? scoringWeights.sectorMap[sectorName] || null : null;
    const scoringData = {
      // Liquidity
      atmCall: optionsData?.atmCall, atmPut: optionsData?.atmPut,
      marketCap, price,
      // Volatility
      avgIV: optionsData?.avgIV,
      hvCurrent20: hvMetrics?.hvCurrent20, hvRank: hvMetrics?.hvRank,
      hvHigh52w: hvMetrics?.hvHigh52w, hvLow52w: hvMetrics?.hvLow52w,
      earningsInDays,
      earningsSurprisePercent: lastSurprisePercent,
      earningsBeatsInLast4: beatsInLast4,
      daysToExpiry: optionsData?.daysToExpiry,
      // Catalyst
      newsItems, avgVolume20,
      // Market Regime
      marketContext: marketCtx, beta,
      expectedMovePercent: optionsData?.expectedMovePercent,
      spyExpectedMovePercent,
      // Sector
      stockChangePercent: changePercent,
      sectorETF, sectorPerformance: sectorData?.sectors, sectorName,
      // Technical
      closes, expectedMove: optionsData?.expectedMove,
      atr14, sma20, sma50, sma200, high52w, low52w,
    };

    const scoring = computeComposite(scoringData);

    // ── 7. Assemble response ───────────────────────────────────────
    const response = {
      ticker,
      price,
      change: quote.regularMarketChange != null ? +Number(quote.regularMarketChange).toFixed(2) : 0,
      changePercent,
      marketCap,
      beta,
      sector: sectorName,
      sectorETF,

      // Expected Move
      expectedMove: optionsData?.expectedMove || 0,
      expectedMovePercent: optionsData?.expectedMovePercent || 0,
      straddleMid: optionsData?.straddleMid || 0,
      ivExpectedMove: optionsData?.ivExpectedMove || 0,
      rangeHigh: optionsData?.rangeHigh || 0,
      rangeLow: optionsData?.rangeLow || 0,

      // Implied 1SD Range
      probability: {
        containment: +adjustedContainment.toFixed(1),
        breach: +(100 - adjustedContainment).toFixed(1),
        method: optionsData?.straddleMid > 0 ? 'ATM Straddle' : 'IV-Derived',
      },

      // Options details
      options: optionsData ? {
        expirationDate: optionsData.expirationDate,
        daysToExpiry: optionsData.daysToExpiry,
        atmStrike: optionsData.atmStrike,
        atmCall: optionsData.atmCall,
        atmPut: optionsData.atmPut,
        avgIV: optionsData.avgIV,
        callsCount: optionsData.callsCount,
        putsCount: optionsData.putsCount,
        earningsDate: optionsData.earningsDate,
        earningsInDays: optionsData.earningsInDays,
      } : null,

      // Earnings snapshot
      earnings: {
        nextDate: earningsDateStr,
        nextInDays: earningsInDays,
        lastPeriod,
        lastActualEPS: lastEpsActual != null ? +Number(lastEpsActual).toFixed(2) : null,
        lastEstimateEPS: lastEpsEstimate != null ? +Number(lastEpsEstimate).toFixed(2) : null,
        lastSurprisePercent,
        beatsInLast4: beatsInLast4 != null ? beatsInLast4 : null,
      },

      // Volatility metrics
      volatility: {
        avgIV: optionsData?.avgIV ? +(optionsData.avgIV * 100).toFixed(1) : null,
        hvCurrent20: hvMetrics?.hvCurrent20 ? +(hvMetrics.hvCurrent20 * 100).toFixed(1) : null,
        hvRank: hvMetrics?.hvRank != null ? +hvMetrics.hvRank.toFixed(1) : null,
        hvHigh52w: hvMetrics?.hvHigh52w ? +(hvMetrics.hvHigh52w * 100).toFixed(1) : null,
        hvLow52w: hvMetrics?.hvLow52w ? +(hvMetrics.hvLow52w * 100).toFixed(1) : null,
        ivHvSpread: (optionsData?.avgIV != null && hvMetrics?.hvCurrent20 != null)
          ? +((optionsData.avgIV - hvMetrics.hvCurrent20) * 100).toFixed(1) : null,
      },

      // Technicals
      technicals: {
        sma20, sma50, sma200, atr14,
        high52w, low52w,
        aboveSMA20: sma20 != null ? price > sma20 : null,
        aboveSMA50: sma50 != null ? price > sma50 : null,
        aboveSMA200: sma200 != null ? price > sma200 : null,
        emAtrRatio: (optionsData?.expectedMove && atr14) ? +(optionsData.expectedMove / atr14).toFixed(2) : null,
      },

      // Beta-adjusted market contribution
      betaAdjusted: beta != null && spyExpectedMovePercent != null ? {
        beta,
        spyEM: spyExpectedMovePercent,
        betaAdjustedMove: +(beta * spyExpectedMovePercent).toFixed(2),
        alphaComponent: optionsData?.expectedMovePercent != null
          ? +(optionsData.expectedMovePercent - beta * spyExpectedMovePercent).toFixed(2) : null,
      } : null,

      // Market context
      market: marketCtx ? {
        bias: marketCtx.bias,
        biasReasons: marketCtx.biasReasons,
        vix: (marketCtx.indices || []).find(i => (i.ticker || '').includes('VIX'))?.price || null,
        spyChange: (marketCtx.indices || []).find(i => i.ticker === 'SPY')?.changePercent || null,
      } : null,

      // Sector context
      sectorContext: sectorData?.sectors ? {
        etf: sectorETF,
        sector: sectorName,
        sectorChange: sectorData.sectors.find(s => s.etf === sectorETF)?.changePercent || null,
        relativeStrength: sectorETF && stockChangePercent != null
          ? +(changePercent - (sectorData.sectors.find(s => s.etf === sectorETF)?.changePercent || 0)).toFixed(2) : null,
      } : null,

      // Composite Confidence Score
      scoring,

      // News summary
      newsSummary: {
        total: newsItems.length,
        recent24h: newsItems.filter(n => (Date.now() - (n.datetime || 0) * 1000) < 86400000).length,
        hasBreaking: newsItems.some(n => (Date.now() - (n.datetime || 0) * 1000) < 30 * 60 * 1000),
      },

      timestamp: Date.now(),
    };

    yahooCacheSet(ticker, 'em-enhanced', response);
    res.json(response);
  } catch (err) {
    logger.warn('Expected move enhanced error', { ticker, error: err.message });
    res.status(502).json({ error: 'Failed to compute enhanced expected move', detail: err.message });
  }
});

// Trade Plan Builder — structured entry/stop/target based on ATR
app.post('/api/ai-quant/build-plan', async (req, res) => {
  const { ticker, strategy, direction = 'long', entryPrice, atr: inputAtr, expectedMove } = req.body || {};
  if (!ticker) return res.status(400).json({ error: 'Ticker is required' });

  try {
    const sym = ticker.toUpperCase();
    let price = entryPrice;
    let atrVal = inputAtr;

    if (!price || !atrVal) {
      const [qr, cr] = await Promise.allSettled([
        yahooFinance.quote(sym),
        yahooFinance.chart(sym, { period1: new Date(Date.now() - 30 * 86400000), period2: new Date(), interval: '1d' })
      ]);
      if (!price && qr.status === 'fulfilled') price = qr.value?.regularMarketPrice;
      if (!atrVal && cr.status === 'fulfilled') {
        const bars = (cr.value?.quotes || []).filter(q => q.close != null && q.high != null && q.low != null);
        if (bars.length >= 15) {
          const recent = bars.slice(-15);
          let sum = 0;
          for (let i = 1; i < recent.length; i++) {
            sum += Math.max(recent[i].high - recent[i].low, Math.abs(recent[i].high - recent[i - 1].close), Math.abs(recent[i].low - recent[i - 1].close));
          }
          atrVal = +(sum / 14).toFixed(2);
        }
      }
    }

    if (!price) return res.status(400).json({ error: `Could not determine price for ${sym}` });
    atrVal = atrVal || +(price * 0.02).toFixed(2);

    const isLong = direction === 'long';
    const stopDist = +(atrVal * 1.5).toFixed(2);
    const entry = +price.toFixed(2);
    const stop = isLong ? +(entry - stopDist).toFixed(2) : +(entry + stopDist).toFixed(2);
    const risk = Math.abs(entry - stop);
    const targets = [1, 2, 3].map(m => ({
      label: `${m}R`, rr: `${m}:1`,
      price: isLong ? +(entry + risk * m).toFixed(2) : +(entry - risk * m).toFixed(2),
    }));

    const notes = [];
    if (strategy === 'orb') {
      notes.push('Entry on break of opening range (first 5-15 min candle)');
      notes.push('Stop below/above the opening range extreme');
      notes.push('Scale out at 1R, trail remainder');
    } else if (strategy === 'earnings') {
      notes.push('Entry on post-earnings gap confirmation');
      if (expectedMove) notes.push(`Expected move: $${expectedMove}`);
      notes.push('Watch for gap-fill reversal as key risk');
    } else if (strategy === 'continuation') {
      notes.push('Entry on pullback to support or breakout confirmation');
      notes.push('Stop below prior day low or key moving average');
      notes.push('Multi-day hold — review at each close');
    }

    res.json({ ticker: sym, strategy, direction, entry, stop, stopDistance: stopDist, riskPerShare: +risk.toFixed(2), targets, atr: atrVal, atrPercent: +((atrVal / price) * 100).toFixed(2), expectedMove: expectedMove || null, notes });
  } catch (err) {
    logger.warn('Build plan error', { ticker, error: err.message });
    res.status(502).json({ error: 'Failed to build trade plan', detail: err.message });
  }
});

// Pre-market mock report endpoints (public)
app.get('/api/premarket/report', async (req, res) => {
  try {
    const raw = await fs.readFile(PREMARKET_REPORT_JSON_PATH, 'utf8');
    res.json(JSON.parse(raw));
  } catch (err) {
    logger.error('Failed to read premarket report JSON', { error: err.message });
    res.status(404).json({ error: 'Premarket report not found' });
  }
});

app.get('/api/premarket/report-md', async (req, res) => {
  try {
    const raw = await fs.readFile(PREMARKET_REPORT_MD_PATH, 'utf8');
    res.type('text/markdown').send(raw);
  } catch (err) {
    logger.error('Failed to read premarket report MD', { error: err.message });
    res.status(404).json({ error: 'Premarket markdown not found' });
  }
});

// =====================================================
// Yahoo Finance proxy endpoints (public, before auth)
// =====================================================

// Lightweight quote: current price + change
app.get('/api/yahoo/quote', async (req, res) => {
  const ticker = (req.query.t || '').trim().toUpperCase();
  if (!ticker || !/^[A-Z0-9.^-]{1,10}$/.test(ticker)) {
    return res.status(400).json({ error: 'Invalid ticker symbol' });
  }

  const cached = yahooCacheGet(ticker, 'quote');
  if (cached) return res.json(cached);

  try {
    const q = await yahooFinance.quote(ticker);
    if (!q) return res.status(404).json({ error: `No data for ${ticker}` });

    const data = {
      ticker: q.symbol || ticker,
      price: q.regularMarketPrice || 0,
      previousClose: q.regularMarketPreviousClose || 0,
      change: q.regularMarketChange != null ? +q.regularMarketChange.toFixed(2) : 0,
      changePercent: q.regularMarketChangePercent != null ? +q.regularMarketChangePercent.toFixed(2) : 0,
      currency: q.currency || 'USD',
      exchangeName: q.fullExchangeName || q.exchange || ''
    };
    yahooCacheSet(ticker, 'quote', data);
    res.json(data);
  } catch (err) {
    logger.warn('Yahoo quote error', { ticker, error: err.message });
    res.status(502).json({ error: 'Failed to fetch Yahoo quote', detail: err.message });
  }
});

// Options chain: nearest expiry with ATM straddle and expected move
app.get('/api/yahoo/options', async (req, res) => {
  const ticker = (req.query.t || '').trim().toUpperCase();
  if (!ticker || !/^[A-Z0-9.^-]{1,10}$/.test(ticker)) {
    return res.status(400).json({ error: 'Invalid ticker symbol' });
  }
  const dateParam = req.query.date || '';
  const cacheKey = dateParam ? `options:${dateParam}` : 'options';
  const cached = yahooCacheGet(ticker, cacheKey);
  if (cached) return res.json(cached);

  try {
    const queryOptions = {};
    if (dateParam) queryOptions.date = new Date(parseInt(dateParam) * 1000);

    let result = await yahooFinance.options(ticker, queryOptions);
    if (!result) return res.status(404).json({ error: `No options data for ${ticker}` });

    // If the nearest expiry is today (0 DTE) or past, try the next expiration
    if (!dateParam && result.expirationDates?.length > 1) {
      const firstExpiry = result.options?.[0]?.expirationDate;
      if (firstExpiry) {
        const exMs = firstExpiry instanceof Date ? firstExpiry.getTime() : firstExpiry * 1000;
        const dte = Math.ceil((exMs - Date.now()) / 86400000);
        if (dte <= 0) {
          const nextExpiry = result.expirationDates[1];
          if (nextExpiry) {
            const nextDate = nextExpiry instanceof Date ? nextExpiry : new Date(nextExpiry * 1000);
            result = await yahooFinance.options(ticker, { date: nextDate });
          }
        }
      }
    }

    const quote = result.quote || {};
    const price = quote.regularMarketPrice || 0;
    const opts = result.options?.[0] || {};
    const calls = opts.calls || [];
    const puts = opts.puts || [];
    const expirationDate = opts.expirationDate || null;
    const allExpirations = result.expirationDates || [];

    // Find ATM strike (closest to current price)
    const allStrikes = [...new Set([
      ...calls.map(c => c.strike),
      ...puts.map(p => p.strike)
    ])].sort((a, b) => a - b);

    const atmStrike = allStrikes.length
      ? allStrikes.reduce((best, s) => Math.abs(s - price) < Math.abs(best - price) ? s : best, allStrikes[0])
      : price;

    const atmCall = calls.find(c => c.strike === atmStrike);
    const atmPut = puts.find(p => p.strike === atmStrike);

    // Average IV from ATM options (computed first for IV-based fallback)
    const ivValues = [atmCall?.impliedVolatility, atmPut?.impliedVolatility].filter(v => v != null);
    const avgIV = ivValues.length ? +(ivValues.reduce((a, b) => a + b, 0) / ivValues.length).toFixed(4) : null;

    // Earnings date
    const earningsDateRaw = quote.earningsTimestamp || null;
    const earningsDateStr = earningsDateRaw ? (earningsDateRaw instanceof Date ? earningsDateRaw.toISOString().split('T')[0] : new Date(earningsDateRaw * 1000).toISOString().split('T')[0]) : null;
    const earningsMs = earningsDateRaw instanceof Date ? earningsDateRaw.getTime() : (earningsDateRaw ? earningsDateRaw * 1000 : null);
    const earningsInDays = earningsMs ? Math.ceil((earningsMs - Date.now()) / 86400000) : null;

    // Expiration date handling
    const expiryMs = expirationDate instanceof Date ? expirationDate.getTime() : (expirationDate ? expirationDate * 1000 : 0);
    const expiryStr = expiryMs ? new Date(expiryMs).toISOString().split('T')[0] : null;
    const daysToExpiry = expiryMs ? Math.max(0, Math.ceil((expiryMs - Date.now()) / 86400000)) : 0;

    // ATM mid prices — use lastPrice as fallback when bid/ask are 0 (off-hours)
    const callBidAsk = atmCall ? ((atmCall.bid || 0) + (atmCall.ask || 0)) / 2 : 0;
    const callMid = callBidAsk > 0 ? callBidAsk : (atmCall?.lastPrice || 0);
    const putBidAsk = atmPut ? ((atmPut.bid || 0) + (atmPut.ask || 0)) / 2 : 0;
    const putMid = putBidAsk > 0 ? putBidAsk : (atmPut?.lastPrice || 0);
    const straddleMid = +(callMid + putMid).toFixed(2);

    // IV-based expected move as secondary calculation
    const ivExpectedMove = avgIV && price ? +(price * avgIV * Math.sqrt(Math.max(daysToExpiry, 1) / 365)).toFixed(2) : 0;

    // Use straddle price if available, else IV-based
    const expectedMove = straddleMid > 0 ? straddleMid : ivExpectedMove;
    const expectedMovePercent = price ? +((expectedMove / price) * 100).toFixed(2) : 0;

    const data = {
      ticker: quote.symbol || ticker,
      price,
      previousClose: quote.regularMarketPreviousClose || 0,
      change: quote.regularMarketChange != null ? +Number(quote.regularMarketChange).toFixed(2) : 0,
      changePercent: quote.regularMarketChangePercent != null ? +Number(quote.regularMarketChangePercent).toFixed(2) : 0,
      marketCap: quote.marketCap || null,
      expirationDate: expiryStr,
      daysToExpiry,
      allExpirations: allExpirations.map(d => d instanceof Date ? Math.floor(d.getTime() / 1000) : d),
      earningsDate: earningsDateStr,
      earningsInDays,
      atmStrike,
      atmCall: atmCall ? {
        strike: atmCall.strike, bid: atmCall.bid || 0, ask: atmCall.ask || 0,
        mid: +callMid.toFixed(2), lastPrice: atmCall.lastPrice || 0,
        iv: atmCall.impliedVolatility || null,
        volume: atmCall.volume || 0, openInterest: atmCall.openInterest || 0
      } : null,
      atmPut: atmPut ? {
        strike: atmPut.strike, bid: atmPut.bid || 0, ask: atmPut.ask || 0,
        mid: +putMid.toFixed(2), lastPrice: atmPut.lastPrice || 0,
        iv: atmPut.impliedVolatility || null,
        volume: atmPut.volume || 0, openInterest: atmPut.openInterest || 0
      } : null,
      expectedMove,
      expectedMovePercent,
      ivExpectedMove,
      rangeHigh: +(price + expectedMove).toFixed(2),
      rangeLow: +(price - expectedMove).toFixed(2),
      avgIV,
      callsCount: calls.length,
      putsCount: puts.length
    };

    yahooCacheSet(ticker, cacheKey, data);
    res.json(data);
  } catch (err) {
    logger.warn('Yahoo options error', { ticker, error: err.message });
    res.status(502).json({ error: 'Failed to fetch options chain', detail: err.message });
  }
});

// 1-year price history with historical volatility metrics
app.get('/api/yahoo/history', async (req, res) => {
  const ticker = (req.query.t || '').trim().toUpperCase();
  if (!ticker || !/^[A-Z0-9.^-]{1,10}$/.test(ticker)) {
    return res.status(400).json({ error: 'Invalid ticker symbol' });
  }

  const cached = yahooCacheGet(ticker, 'history');
  if (cached) return res.json(cached);

  try {
    const now = new Date();
    const oneYearAgo = new Date(now);
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    const results = await yahooFinance.chart(ticker, {
      period1: oneYearAgo,
      period2: now,
      interval: '1d'
    });

    const quotes = results?.quotes || [];
    if (!quotes.length) return res.status(404).json({ error: `No history for ${ticker}` });

    const closes = quotes.map(q => q.close).filter(c => c != null);
    const hv = computeHVMetrics(closes);

    const data = {
      ticker,
      count: closes.length,
      ...(hv || { hvCurrent20: null, hvHigh52w: null, hvLow52w: null, hvRank: null })
    };

    yahooCacheSet(ticker, 'history', data);
    res.json(data);
  } catch (err) {
    logger.warn('Yahoo history error', { ticker, error: err.message });
    res.status(502).json({ error: 'Failed to fetch price history', detail: err.message });
  }
});

// Yahoo symbol search for autocomplete (company name → ticker)
app.get('/api/yahoo/search', async (req, res) => {
  const query = (req.query.q || '').trim();
  if (!query || query.length < 2) return res.json([]);

  const cacheKey = `search:${query.toLowerCase()}`;
  const cached = yahooCacheGet(cacheKey, 'search');
  if (cached) return res.json(cached);

  try {
    const result = await yahooFinance.search(query, { quotesCount: 10, newsCount: 0 });
    const quotes = (result.quotes || [])
      .filter(q => q.quoteType === 'EQUITY' && q.symbol)
      .slice(0, 10)
      .map(q => ({
        symbol: q.symbol,
        name: q.shortname || q.longname || '',
        exchange: q.exchange || ''
      }));
    yahooCacheSet(cacheKey, 'search', quotes);
    res.json(quotes);
  } catch (err) {
    logger.warn('Yahoo search error', { query, error: err.message });
    res.json([]);
  }
});

// Batch Yahoo quotes (for watchlist stats)
app.get('/api/yahoo/quote-batch', async (req, res) => {
  const raw = (req.query.symbols || '').trim();
  if (!raw) return res.json({ quotes: [] });
  const symbols = raw.split(',').map(s => s.trim().toUpperCase()).filter(s => /^[A-Z0-9.^-]{1,10}$/.test(s)).slice(0, 50);
  if (!symbols.length) return res.json({ quotes: [] });

  const quotes = [];
  const batchSize = 10;
  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    const results = await Promise.allSettled(batch.map(async (ticker) => {
      const cached = yahooCacheGet(ticker, 'quote');
      if (cached) return cached;
      const quote = await yahooFinance.quote(ticker);
      const data = {
        ticker: quote.symbol || ticker,
        price: quote.regularMarketPrice || 0,
        previousClose: quote.regularMarketPreviousClose || 0,
        change: quote.regularMarketChange != null ? +Number(quote.regularMarketChange).toFixed(2) : 0,
        changePercent: quote.regularMarketChangePercent != null ? +Number(quote.regularMarketChangePercent).toFixed(2) : 0,
        marketCap: quote.marketCap || null,
        shortName: quote.shortName || '',
        analystRating: quote.averageAnalystRating || null,
        currency: quote.currency || 'USD',
        exchangeName: quote.fullExchangeName || ''
      };
      yahooCacheSet(ticker, 'quote', data);
      return data;
    }));
    results.forEach(r => { if (r.status === 'fulfilled') quotes.push(r.value); });
  }
  res.json({ quotes });
});

// Earnings calendar (Finnhub + Yahoo enrichment)
const earningsCache = {};
const EARNINGS_CACHE_MS = 15 * 60 * 1000;

app.get('/api/earnings/calendar', async (req, res) => {
  const FHKEY = process.env.FINNHUB_API_KEY;
  if (!FHKEY) return res.status(500).json({ error: 'FINNHUB_API_KEY not set' });

  const from = req.query.from || new Date().toISOString().split('T')[0];
  const to = req.query.to || from;
  const cacheKey = `${from}:${to}`;

  if (earningsCache[cacheKey] && Date.now() - earningsCache[cacheKey].ts < EARNINGS_CACHE_MS) {
    return res.json(earningsCache[cacheKey].data);
  }

  try {
    const url = `https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&token=${FHKEY}`;
    const fhRes = await axios.get(url, { timeout: 15000 });
    const calendar = fhRes.data?.earningsCalendar || [];

    // Enrich with Yahoo quotes (batched, 10 concurrent)
    const uniqueSymbols = [...new Set(calendar.map(e => e.symbol).filter(Boolean))];
    const quoteMap = {};
    const batchSize = 10;
    for (let i = 0; i < uniqueSymbols.length; i += batchSize) {
      const batch = uniqueSymbols.slice(i, i + batchSize);
      const results = await Promise.allSettled(batch.map(async (ticker) => {
        const cached = yahooCacheGet(ticker, 'earnings-quote');
        if (cached) return { ticker, ...cached };
        try {
          const quote = await yahooFinance.quote(ticker);
          const avgVol = quote.averageDailyVolume3Month || quote.averageDailyVolume10Day || null;
          const curVol = quote.regularMarketVolume || null;
          const rvol = (avgVol && curVol && avgVol > 0) ? +(curVol / avgVol).toFixed(2) : null;
          const high52 = quote.fiftyTwoWeekHigh || null;
          const ma200 = quote.twoHundredDayAverage || null;
          const curPrice = quote.regularMarketPrice || 0;
          const dist200MA = (ma200 && curPrice) ? +(((curPrice - ma200) / ma200) * 100).toFixed(2) : null;
          const dist52WH = (high52 && curPrice) ? +(((curPrice - high52) / high52) * 100).toFixed(2) : null;
          const data = {
            ticker: quote.symbol || ticker,
            price: curPrice,
            change: quote.regularMarketChange != null ? +Number(quote.regularMarketChange).toFixed(2) : 0,
            changePercent: quote.regularMarketChangePercent != null ? +Number(quote.regularMarketChangePercent).toFixed(2) : 0,
            marketCap: quote.marketCap || null,
            shortName: quote.shortName || '',
            exchange: quote.exchange || null,
            fullExchangeName: quote.fullExchangeName || null,
            market: quote.market || null,
            analystRating: quote.averageAnalystRating || null,
            floatShares: quote.floatShares || null,
            sharesShort: quote.sharesShort || null,
            shortPercentOfFloat: quote.shortPercentOfFloat != null ? +(quote.shortPercentOfFloat * 100).toFixed(2) : null,
            avgVolume: avgVol,
            volume: curVol,
            rvol,
            preMarketPrice: quote.preMarketPrice || null,
            preMarketChange: quote.preMarketChange != null ? +Number(quote.preMarketChange).toFixed(2) : null,
            preMarketChangePercent: quote.preMarketChangePercent != null ? +Number(quote.preMarketChangePercent).toFixed(2) : null,
            fiftyTwoWeekHigh: high52,
            twoHundredDayAverage: ma200,
            dist200MA,
            dist52WH,
          };
          yahooCacheSet(ticker, 'earnings-quote', data);
          return { ticker, ...data };
        } catch { return { ticker }; }
      }));
      results.forEach(r => { if (r.status === 'fulfilled') quoteMap[r.value.ticker] = r.value; });
    }

    // Deduplicate Finnhub entries (same symbol+date)
    const seen = new Set();
    const dedupedCalendar = calendar.filter(e => {
      const key = `${e.symbol}:${e.date}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const allowedShortExchanges = new Set([
      'NYQ','NYS','NYSE','NMS','NSQ','NAS','NGM','NCM','ASE','BATS','PCX','ARC','AMEX','PSE','LSE','IOB','XLON'
    ]);
    const allowedFullExchanges = [
      'NASDAQ','NYSE','LONDON STOCK EXCHANGE','LSE','BATS','NYSE ARCA','NYSE MKT','AMEX'
    ];
    const isUsUkSymbol = (symbol, quote = {}) => {
      const sym = (symbol || '').toUpperCase();
      const ex = (quote.exchange || '').toUpperCase();
      const full = (quote.fullExchangeName || '').toUpperCase();
      const market = (quote.market || '').toUpperCase();
      const suffix = sym.includes('.') ? sym.split('.').pop() : '';
      const ukSuffix = ['L', 'LN', 'LON', 'LSE'].includes(suffix);
      const usSuffix = suffix === 'US' || !sym.includes('.');
      if (allowedShortExchanges.has(ex)) return true;
      if (allowedFullExchanges.some(f => full.includes(f))) return true;
      if (market.includes('NYSE') || market.includes('NASDAQ') || market.includes('LSE')) return true;
      if (ukSuffix) return true;
      if (usSuffix) return true;
      return false;
    };

    const filteredCalendar = dedupedCalendar.filter(e => isUsUkSymbol(e.symbol, quoteMap[e.symbol] || {}));

    const earnings = filteredCalendar.map(e => {
      const q = quoteMap[e.symbol] || {};
      const surprisePercent = (e.epsActual != null && e.epsEstimate != null && e.epsEstimate !== 0)
        ? +((e.epsActual - e.epsEstimate) / Math.abs(e.epsEstimate) * 100).toFixed(2)
        : null;
      return {
        symbol: e.symbol,
        companyName: q.shortName || '',
        date: e.date,
        epsEstimate: e.epsEstimate ?? null,
        epsActual: e.epsActual ?? null,
        surprisePercent,
        revenueEstimate: e.revenueEstimate ?? null,
        revenueActual: e.revenueActual ?? null,
        hour: e.hour || 'tns',
        quarter: e.quarter,
        year: e.year,
        price: q.price ?? null,
        change: q.change ?? null,
        changePercent: q.changePercent ?? null,
        marketCap: q.marketCap ?? null,
        analystRating: q.analystRating || null,
        // Screener enrichment fields
        floatShares: q.floatShares ?? null,
        sharesShort: q.sharesShort ?? null,
        shortPercentOfFloat: q.shortPercentOfFloat ?? null,
        avgVolume: q.avgVolume ?? null,
        volume: q.volume ?? null,
        rvol: q.rvol ?? null,
        preMarketPrice: q.preMarketPrice ?? null,
        preMarketChange: q.preMarketChange ?? null,
        preMarketChangePercent: q.preMarketChangePercent ?? null,
        fiftyTwoWeekHigh: q.fiftyTwoWeekHigh ?? null,
        twoHundredDayAverage: q.twoHundredDayAverage ?? null,
        dist200MA: q.dist200MA ?? null,
        dist52WH: q.dist52WH ?? null,
      };
    });

    // Batch-fetch historical earnings beats from Finnhub
    const beatsMap = {};
    const beatsSymbols = [...new Set(earnings.map(e => e.symbol).filter(Boolean))].slice(0, 150); // expanded so AI Quant scoring has beat history for more names
    for (let i = 0; i < beatsSymbols.length; i += batchSize) {
      const batch = beatsSymbols.slice(i, i + batchSize);
      const beatsResults = await Promise.allSettled(
        batch.map(sym =>
          axios.get(`https://finnhub.io/api/v1/stock/earnings?symbol=${sym}&limit=4&token=${FHKEY}`, { timeout: 8000 })
            .then(r => {
              const hist = r.data || [];
              const beats = hist.filter(h => h.actual != null && h.estimate != null && h.actual > h.estimate).length;
              return { sym, beats, total: hist.filter(h => h.actual != null && h.estimate != null).length };
            })
        )
      );
      beatsResults.forEach(r => {
        if (r.status === 'fulfilled') beatsMap[r.value.sym] = r.value;
      });
    }
    // Attach beatsInLast4 to each earnings entry
    for (const e of earnings) {
      const b = beatsMap[e.symbol];
      e.beatsInLast4 = b ? b.beats : null;
    }

    const data = { earnings, from, to };

    // Fallback enrich: pull surprise/eps from Yahoo when Finnhub missing
    const needYahoo = [...new Set(earnings
      .filter(e => e.symbol && (e.surprisePercent == null || e.epsActual == null || e.epsEstimate == null || e.beatsInLast4 == null))
      .map(e => e.symbol)
    )].slice(0, 300); // expanded cap for 5-day windows

    if (needYahoo.length) {
      for (const sym of needYahoo) {
        try {
          const summary = await yahooFinance.quoteSummary(sym, { modules: ['earnings'] });
          const qtrs = summary?.earnings?.earningsChart?.quarterly || [];
          if (!qtrs.length) continue;
          const last = qtrs[qtrs.length - 1];
          const act = last?.actual?.raw ?? last?.actual ?? null;
          const est = last?.estimate?.raw ?? last?.estimate ?? null;
          let surprise = null;
          if (act != null && est != null && est !== 0) surprise = +(((act - est) / Math.abs(est)) * 100).toFixed(2);
          if (surprise == null && last?.surprisePct != null && !Number.isNaN(parseFloat(last.surprisePct))) {
            surprise = +parseFloat(last.surprisePct).toFixed(2);
          }
          const beats = qtrs.filter(q => {
            const qa = q?.actual?.raw ?? q?.actual;
            const qe = q?.estimate?.raw ?? q?.estimate;
            return qa != null && qe != null && qa >= qe;
          }).length;

          earnings.forEach(e => {
            if (e.symbol !== sym) return;
            if (e.surprisePercent == null && surprise != null) e.surprisePercent = surprise;
            if (e.epsActual == null && act != null) e.epsActual = act;
            if (e.epsEstimate == null && est != null) e.epsEstimate = est;
            if ((e.beatsInLast4 == null || Number.isNaN(e.beatsInLast4)) && beats) e.beatsInLast4 = beats;
          });
        } catch (err) {
          logger.debug('earnings yahoo fallback failed', { sym, error: err.message });
        }
      }
    }

    earningsCache[cacheKey] = { data, ts: Date.now() };
    // Evict old cache entries
    const keys = Object.keys(earningsCache);
    if (keys.length > 20) {
      keys.sort((a, b) => earningsCache[a].ts - earningsCache[b].ts);
      keys.slice(0, keys.length - 20).forEach(k => delete earningsCache[k]);
    }
    res.json(data);
  } catch (err) {
    logger.warn('Earnings calendar error', { error: err.message });
    // Fail soft with empty payload so the UI does not block
    res.json({ earnings: [], from, to, error: 'Failed to fetch earnings calendar', detail: err.message });
  }
});

// =====================================================
// Earnings Research Panel — comprehensive per-ticker data
// =====================================================
app.get('/api/earnings-research/:ticker', async (req, res) => {
  const ticker = (req.params.ticker || '').trim().toUpperCase();
  if (!ticker || !/^[A-Z0-9.^-]{1,10}$/.test(ticker)) {
    return res.status(400).json({ error: 'Invalid ticker symbol' });
  }

  const cached = yahooCacheGet(ticker, 'earnings-research');
  if (cached) return res.json(cached);

  const FHKEY = process.env.FINNHUB_API_KEY;
  const now = new Date();
  const oneYearAgo = new Date(now);
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const today = now.toISOString().split('T')[0];
  const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0];

  // Helper: safe date to string
  const toDateStr = (d) => {
    if (!d) return null;
    if (d instanceof Date) return d.toISOString().split('T')[0];
    if (typeof d === 'number') return new Date(d > 1e10 ? d : d * 1000).toISOString().split('T')[0];
    return String(d);
  };

  try {
    // Parallel fetch all data sources
    const [summaryResult, optionsResult, chartResult, newsResult] = await Promise.allSettled([
      yahooFinance.quoteSummary(ticker, {
        modules: ['price', 'summaryProfile', 'defaultKeyStatistics', 'financialData',
                  'earnings', 'calendarEvents', 'recommendationTrend',
                  'majorHoldersBreakdown', 'insiderTransactions', 'upgradeDowngradeHistory']
      }),
      yahooFinance.options(ticker),
      yahooFinance.chart(ticker, { period1: oneYearAgo, period2: now, interval: '1d' }),
      FHKEY
        ? axios.get(`https://finnhub.io/api/v1/company-news?symbol=${ticker}&from=${twoWeeksAgo}&to=${today}&token=${FHKEY}`, { timeout: 8000 }).then(r => r.data)
        : Promise.resolve([]),
    ]);

    const summary = summaryResult.status === 'fulfilled' ? summaryResult.value : {};
    const optionsRaw = optionsResult.status === 'fulfilled' ? optionsResult.value : null;
    const chartRaw = chartResult.status === 'fulfilled' ? chartResult.value : null;
    const newsItems = newsResult.status === 'fulfilled' ? (newsResult.value || []) : [];

    // Extract Yahoo modules (defensive)
    const priceData = summary.price || {};
    const profile = summary.summaryProfile || {};
    const keyStats = summary.defaultKeyStatistics || {};
    const finData = summary.financialData || {};
    const earningsModule = summary.earnings || {};
    const calEvents = summary.calendarEvents || {};
    const recTrend = summary.recommendationTrend || {};
    const holders = summary.majorHoldersBreakdown || {};
    const insiderTxns = (summary.insiderTransactions || {}).transactions || [];
    const upgradeHistory = (summary.upgradeDowngradeHistory || {}).history || [];

    const currentPrice = priceData.regularMarketPrice ?? 0;

    // ── Section A: Earnings Intelligence ──
    const quarterlyEarnings = (earningsModule.earningsChart?.quarterly || []).map(q => ({
      quarter: q.date || '',
      actual: q.actual?.raw ?? q.actual ?? null,
      estimate: q.estimate?.raw ?? q.estimate ?? null,
      surprise: (q.actual != null && q.estimate != null && q.estimate !== 0)
        ? +(((q.actual?.raw ?? q.actual) - (q.estimate?.raw ?? q.estimate)) / Math.abs(q.estimate?.raw ?? q.estimate) * 100).toFixed(2)
        : null,
      beat: q.actual != null && q.estimate != null
        ? (q.actual?.raw ?? q.actual) >= (q.estimate?.raw ?? q.estimate) : null,
    }));

    const quarterlyRevenue = (earningsModule.financialsChart?.quarterly || []).map(q => ({
      quarter: q.date || '',
      revenue: q.revenue?.raw ?? q.revenue ?? null,
      earnings: q.earnings?.raw ?? q.earnings ?? null,
    }));

    const earningsDateRaw = calEvents.earnings?.earningsDate;
    const earningsDate = Array.isArray(earningsDateRaw) && earningsDateRaw.length
      ? earningsDateRaw[0] : earningsDateRaw || null;

    const earnings = {
      earningsDate: toDateStr(earningsDate),
      epsEstimate: calEvents.earnings?.earningsAverage ?? earningsModule.earningsChart?.currentQuarterEstimate ?? null,
      epsHigh: calEvents.earnings?.earningsHigh ?? null,
      epsLow: calEvents.earnings?.earningsLow ?? null,
      revenueEstimate: calEvents.earnings?.revenueAverage ?? null,
      revenueGrowth: finData.revenueGrowth != null ? +(finData.revenueGrowth * 100).toFixed(2) : null,
      quarterlyHistory: quarterlyEarnings,
      quarterlyRevenue,
      beatsInLast4: quarterlyEarnings.filter(q => q.beat === true).length,
      missesInLast4: quarterlyEarnings.filter(q => q.beat === false).length,
    };

    // ── Section B: Expected Move ──
    let expectedMove = { available: false };
    if (optionsRaw) {
      const oQuote = optionsRaw.quote || {};
      const opts = optionsRaw.options?.[0] || {};
      const calls = opts.calls || [];
      const puts = opts.puts || [];
      const opPrice = oQuote.regularMarketPrice || currentPrice;
      const allStrikes = [...new Set([...calls.map(c => c.strike), ...puts.map(p => p.strike)])].sort((a, b) => a - b);
      const atmStrike = allStrikes.length
        ? allStrikes.reduce((best, s) => Math.abs(s - opPrice) < Math.abs(best - opPrice) ? s : best, allStrikes[0])
        : opPrice;
      const atmCall = calls.find(c => c.strike === atmStrike);
      const atmPut = puts.find(p => p.strike === atmStrike);
      const ivValues = [atmCall?.impliedVolatility, atmPut?.impliedVolatility].filter(v => v != null);
      const avgIV = ivValues.length ? +(ivValues.reduce((a, b) => a + b, 0) / ivValues.length).toFixed(4) : null;

      const callBidAsk = atmCall ? ((atmCall.bid || 0) + (atmCall.ask || 0)) / 2 : 0;
      const callMid = callBidAsk > 0 ? callBidAsk : (atmCall?.lastPrice || 0);
      const putBidAsk = atmPut ? ((atmPut.bid || 0) + (atmPut.ask || 0)) / 2 : 0;
      const putMid = putBidAsk > 0 ? putBidAsk : (atmPut?.lastPrice || 0);
      const straddle = +(callMid + putMid).toFixed(2);

      const expiryDate = opts.expirationDate;
      const expiryMs = expiryDate instanceof Date ? expiryDate.getTime() : (expiryDate ? expiryDate * 1000 : 0);
      const expiryStr = expiryMs ? new Date(expiryMs).toISOString().split('T')[0] : null;
      const dte = expiryMs ? Math.max(0, Math.ceil((expiryMs - Date.now()) / 86400000)) : 0;
      const ivEM = avgIV && opPrice ? +(opPrice * avgIV * Math.sqrt(Math.max(dte, 1) / 365)).toFixed(2) : 0;
      const em = straddle > 0 ? straddle : ivEM;

      expectedMove = {
        available: true,
        atmStrike,
        straddle,
        avgIV,
        ivPercent: avgIV ? +(avgIV * 100).toFixed(1) : null,
        expectedMove: em,
        expectedMovePercent: opPrice ? +((em / opPrice) * 100).toFixed(2) : 0,
        rangeHigh: +(opPrice + em).toFixed(2),
        rangeLow: +(opPrice - em).toFixed(2),
        expiryDate: expiryStr,
        daysToExpiry: dte,
        callIV: atmCall?.impliedVolatility ? +(atmCall.impliedVolatility * 100).toFixed(1) : null,
        putIV: atmPut?.impliedVolatility ? +(atmPut.impliedVolatility * 100).toFixed(1) : null,
      };
    }

    // ── Section C: Company Snapshot ──
    const avgVol = priceData.averageDailyVolume3Month || priceData.averageDailyVolume10Day || null;
    const company = {
      name: priceData.shortName || priceData.longName || '',
      sector: profile.sector || '',
      industry: profile.industry || '',
      marketCap: priceData.marketCap ?? null,
      floatShares: keyStats.floatShares ?? null,
      avgVolume: avgVol,
      sharesShort: keyStats.sharesShort ?? null,
      shortPercentOfFloat: keyStats.shortPercentOfFloat != null ? +(keyStats.shortPercentOfFloat * 100).toFixed(2) : null,
      shortRatio: keyStats.shortRatio ?? null,
      insiderPercent: holders.insidersPercentHeld != null ? +(holders.insidersPercentHeld * 100).toFixed(2)
        : keyStats.heldPercentInsiders != null ? +(keyStats.heldPercentInsiders * 100).toFixed(2) : null,
      institutionalPercent: holders.institutionsPercentHeld != null ? +(holders.institutionsPercentHeld * 100).toFixed(2)
        : keyStats.heldPercentInstitutions != null ? +(keyStats.heldPercentInstitutions * 100).toFixed(2) : null,
      institutionCount: holders.institutionsCount ?? null,
      beta: keyStats.beta ?? null,
      recentInsiderTxns: insiderTxns.slice(0, 5).map(t => ({
        name: t.filerName || '',
        relation: t.filerRelation || '',
        type: t.transactionText || '',
        shares: t.shares ?? null,
        value: t.value ?? null,
        date: toDateStr(t.startDate),
      })),
    };

    // ── Section D: Sentiment ──
    const currentMonth = (recTrend.trend || []).find(t => t.period === '0m') || {};
    const prevMonth = (recTrend.trend || []).find(t => t.period === '-1m') || {};
    const cutoff90d = Date.now() - 90 * 86400000;
    const recentUpgrades = upgradeHistory.filter(u => {
      const ts = u.epochGradeDate instanceof Date ? u.epochGradeDate.getTime() : ((u.epochGradeDate || 0) * 1000);
      return ts > cutoff90d;
    }).slice(0, 10).map(u => ({
      firm: u.firm || '',
      toGrade: u.toGrade || '',
      fromGrade: u.fromGrade || '',
      action: u.action || '',
      date: toDateStr(u.epochGradeDate),
    }));

    const sentiment = {
      recommendationKey: finData.recommendationKey || null,
      recommendationMean: finData.recommendationMean ?? null,
      numberOfAnalysts: finData.numberOfAnalystOpinions ?? null,
      targetMeanPrice: finData.targetMeanPrice ?? null,
      targetHighPrice: finData.targetHighPrice ?? null,
      targetLowPrice: finData.targetLowPrice ?? null,
      targetMedianPrice: finData.targetMedianPrice ?? null,
      targetVsPrice: finData.targetMeanPrice && currentPrice
        ? +(((finData.targetMeanPrice - currentPrice) / currentPrice) * 100).toFixed(2) : null,
      currentMonth: {
        strongBuy: currentMonth.strongBuy || 0, buy: currentMonth.buy || 0,
        hold: currentMonth.hold || 0, sell: currentMonth.sell || 0, strongSell: currentMonth.strongSell || 0,
      },
      prevMonth: {
        strongBuy: prevMonth.strongBuy || 0, buy: prevMonth.buy || 0,
        hold: prevMonth.hold || 0, sell: prevMonth.sell || 0, strongSell: prevMonth.strongSell || 0,
      },
      recentUpgrades,
    };

    // ── Section E: News ──
    const news = (Array.isArray(newsItems) ? newsItems : []).slice(0, 10).map(n => ({
      headline: n.headline || '',
      source: n.source || '',
      url: n.url || '',
      datetime: n.datetime || 0,
      category: n.category || '',
      summary: (n.summary || '').slice(0, 200),
    }));

    // ── Section F: Technicals ──
    let technicals = { available: false };
    const quotes = chartRaw?.quotes || [];
    const validQuotes = quotes.filter(q => q.close != null && q.high != null && q.low != null);
    if (validQuotes.length >= 20) {
      const closes = validQuotes.map(q => q.close);
      const cp = closes[closes.length - 1];

      const sma = (arr, period) => {
        if (arr.length < period) return null;
        return +(arr.slice(-period).reduce((a, b) => a + b, 0) / period).toFixed(2);
      };

      // RSI(14) — Wilder smoothing
      const computeRSI = (closes, period = 14) => {
        if (closes.length < period + 1) return null;
        const recent = closes.slice(-(period + 1));
        let gains = 0, losses = 0;
        for (let i = 1; i < recent.length; i++) {
          const diff = recent[i] - recent[i - 1];
          if (diff > 0) gains += diff; else losses -= diff;
        }
        const avgGain = gains / period;
        const avgLoss = losses / period;
        if (avgLoss === 0) return 100;
        return +(100 - 100 / (1 + avgGain / avgLoss)).toFixed(2);
      };

      // ATR(14) — Average True Range
      const computeATR = (bars, period = 14) => {
        if (bars.length < period + 1) return null;
        const recent = bars.slice(-(period + 1));
        let sum = 0;
        for (let i = 1; i < recent.length; i++) {
          const tr = Math.max(
            recent[i].high - recent[i].low,
            Math.abs(recent[i].high - recent[i - 1].close),
            Math.abs(recent[i].low - recent[i - 1].close)
          );
          sum += tr;
        }
        return +(sum / period).toFixed(2);
      };

      const sma20 = sma(closes, 20);
      const sma50 = sma(closes, 50);
      const sma200 = sma(closes, 200);
      const rsi = computeRSI(closes);
      const atr = computeATR(validQuotes);

      const year52 = validQuotes.slice(-252);
      const high52w = year52.length ? +Math.max(...year52.map(q => q.high)).toFixed(2) : null;
      const low52w = year52.length ? +Math.min(...year52.map(q => q.low)).toFixed(2) : null;

      const recent20 = validQuotes.slice(-20);
      const recentHigh = recent20.length ? +Math.max(...recent20.map(q => q.high)).toFixed(2) : null;
      const recentLow = recent20.length ? +Math.min(...recent20.map(q => q.low)).toFixed(2) : null;

      const aboveSMA20 = sma20 ? cp > sma20 : null;
      const aboveSMA50 = sma50 ? cp > sma50 : null;
      const aboveSMA200 = sma200 ? cp > sma200 : null;
      let trend = 'mixed';
      if (aboveSMA20 && aboveSMA50 && aboveSMA200) trend = 'bullish';
      else if (aboveSMA20 === false && aboveSMA50 === false && aboveSMA200 === false) trend = 'bearish';

      technicals = {
        available: true, currentPrice: cp,
        sma20, sma50, sma200,
        distSMA20: sma20 ? +(((cp - sma20) / sma20) * 100).toFixed(2) : null,
        distSMA50: sma50 ? +(((cp - sma50) / sma50) * 100).toFixed(2) : null,
        distSMA200: sma200 ? +(((cp - sma200) / sma200) * 100).toFixed(2) : null,
        aboveSMA20, aboveSMA50, aboveSMA200,
        rsi, atr,
        atrPercent: atr && cp ? +((atr / cp) * 100).toFixed(2) : null,
        high52w, low52w,
        distHigh52w: high52w && cp ? +(((cp - high52w) / high52w) * 100).toFixed(2) : null,
        distLow52w: low52w && cp ? +(((cp - low52w) / low52w) * 100).toFixed(2) : null,
        recentHigh, recentLow, trend,
      };
    }

    // ── Earnings Setup Score (0–100) ──
    const computeSetupScore = () => {
      const b = {};

      // Earnings Track Record (0–20)
      let et = 10;
      quarterlyEarnings.slice(0, 4).forEach(q => { if (q.beat === true) et += 3; else if (q.beat === false) et -= 3; });
      b.earningsTrack = Math.max(0, Math.min(20, et));

      // Expected Move / Options (0–15)
      let emScore = 7;
      if (expectedMove.available) {
        if (expectedMove.expectedMovePercent > 0 && expectedMove.expectedMovePercent < 15) emScore += 4;
        if (expectedMove.avgIV && expectedMove.avgIV < 1.0) emScore += 2;
        if (expectedMove.straddle > 0) emScore += 2;
      }
      b.expectedMove = Math.max(0, Math.min(15, emScore));

      // Liquidity (0–15)
      let liq = 5;
      if (company.avgVolume > 2e6) liq += 5;
      else if (company.avgVolume > 500e3) liq += 3;
      else if (company.avgVolume && company.avgVolume < 200e3) liq -= 3;
      if (company.floatShares && company.floatShares < 50e6) liq += 2;
      if (company.marketCap && company.marketCap > 1e9) liq += 3;
      else if (company.marketCap && company.marketCap > 300e6) liq += 1;
      b.liquidity = Math.max(0, Math.min(15, liq));

      // Short Interest Catalyst (0–10)
      let si = 3;
      if (company.shortPercentOfFloat > 20) si += 5;
      else if (company.shortPercentOfFloat > 10) si += 3;
      else if (company.shortPercentOfFloat > 5) si += 1;
      b.shortInterest = Math.max(0, Math.min(10, si));

      // Analyst Sentiment (0–15)
      let an = 7;
      if (sentiment.recommendationMean) {
        if (sentiment.recommendationMean <= 2.0) an += 4;
        else if (sentiment.recommendationMean <= 2.5) an += 2;
        else if (sentiment.recommendationMean >= 3.5) an -= 2;
      }
      if (sentiment.targetVsPrice > 20) an += 3;
      else if (sentiment.targetVsPrice > 10) an += 1;
      else if (sentiment.targetVsPrice && sentiment.targetVsPrice < -10) an -= 2;
      b.analystSentiment = Math.max(0, Math.min(15, an));

      // Technical Setup (0–15)
      let tech = 7;
      if (technicals.available) {
        if (technicals.trend === 'bullish') tech += 4;
        else if (technicals.trend === 'bearish') tech -= 2;
        if (technicals.rsi && technicals.rsi > 30 && technicals.rsi < 70) tech += 2;
        if (technicals.distHigh52w && technicals.distHigh52w > -10) tech += 2;
      }
      b.technicals = Math.max(0, Math.min(15, tech));

      // News Momentum (0–10)
      let nm = 3;
      if (news.length >= 5) nm += 4;
      else if (news.length >= 2) nm += 2;
      const freshNews = news.filter(n => (Date.now() / 1000 - n.datetime) < 3 * 86400);
      if (freshNews.length > 0) nm += 3;
      b.newsMomentum = Math.max(0, Math.min(10, nm));

      const total = Object.values(b).reduce((a, v) => a + v, 0);
      return { score: Math.max(0, Math.min(100, total)), breakdown: b };
    };

    const setupScore = computeSetupScore();

    const data = {
      ticker, price: currentPrice, name: company.name,
      earnings, expectedMove, company, sentiment, news, technicals, setupScore,
    };

    yahooCacheSet(ticker, 'earnings-research', data);
    res.json(data);
  } catch (err) {
    logger.warn('Earnings research error', { ticker, error: err.message });
    res.status(502).json({ error: 'Failed to fetch earnings research data', detail: err.message });
  }
});

app.post('/api/ai-quant/query', limiter, async (req, res) => {
  const { prompt, contextSource = 'none' } = req.body || {};
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  try {
    const { apiKey, model } = await resolvePplxConfig(req);

    if (!apiKey) {
      return res.status(500).json({ error: 'Perplexity API key not set. Add it in your profile or server environment.' });
    }

    const ctx = await buildContext(contextSource);
    const systemPrompt = [
      'You are an AI Quant assistant for intraday and swing traders.',
      'You read provided context (scanner results, SEC filings, or none).',
      'Suggest concrete trading setups, not generic commentary.',
      "Always add a final line starting with 'In layman\'s terms:' explaining in simple language."
    ].join(' ');

    const userPrompt = `${ctx.text ? `Context (source: ${ctx.usedContext}):\n${ctx.text}\n\n` : ''}User Question:\n${prompt}`;

    const pplxResponse = await axios.post('https://api.perplexity.ai/chat/completions', {
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 800,
      temperature: 0.2
    }, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 20000,
      validateStatus: () => true
    });

    if (pplxResponse.status >= 300) {
      logger.warn('Perplexity API non-200', { status: pplxResponse.status, data: pplxResponse.data });
      return res.status(502).json({ error: 'AI provider error', detail: pplxResponse.data });
    }

    const answer = pplxResponse.data?.choices?.[0]?.message?.content || 'No answer generated.';
    res.json({ answer, usedContext: ctx.usedContext });
  } catch (err) {
    logger.error('AI Quant endpoint error:', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Failed to process AI Quant request', detail: err.message });
  }
});

// Auth verification endpoint
app.get('/api/auth/verify', (req, res) => {
  const token = req.get('Authorization')?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ valid: false, error: 'No token provided' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    res.json({ valid: true, user: { id: payload.id, username: payload.username, email: payload.email, is_admin: payload.is_admin } });
  } catch (err) {
    res.status(401).json({ valid: false, error: 'Invalid or expired token' });
  }
});

// Saxo OAuth endpoints
app.get('/auth/saxo/login', (req, res) => {
  const { url, state } = saxoAuth.getAuthorizationUrl();
  // Store state in session or cookie for CSRF protection
  res.cookie('saxo_oauth_state', state, { httpOnly: true, maxAge: 600000 }); // 10 minutes
  res.redirect(url);
});

app.get('/auth/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    logger.error('Saxo OAuth error:', error);
    return res.redirect('/index.html?error=oauth_failed');
  }

  // Verify state to prevent CSRF
  const savedState = req.cookies.saxo_oauth_state;
  if (!savedState || savedState !== state) {
    logger.error('OAuth state mismatch');
    return res.redirect('/index.html?error=oauth_state_mismatch');
  }

  try {
    await saxoAuth.getTokensFromCode(code);
    res.clearCookie('saxo_oauth_state');
    res.redirect('/index.html?saxo_connected=true');
  } catch (error) {
    logger.error('Failed to get Saxo tokens:', error.message);
    res.redirect('/index.html?error=oauth_token_failed');
  }
});

app.get('/api/saxo/auth/status', (req, res) => {
  res.json({
    authenticated: saxoAuth.isAuthenticated(),
    hasTokens: saxoAuth.tokens !== null,
    expiresAt: saxoAuth.tokens?.expires_at || null
  });
});

app.post('/api/saxo/auth/disconnect', async (req, res) => {
  await saxoAuth.clearTokens();
  res.json({ success: true, message: 'Saxo account disconnected' });
});

// Finviz news endpoint
app.get('/api/finviz/news', async (req, res) => {
  if (!FINVIZ_NEWS_TOKEN) {
    return res.status(500).json({ error: 'FINVIZ_NEWS_TOKEN not set in server environment' });
  }
  if (finvizNewsCache.data && Date.now() - finvizNewsCache.ts < FINVIZ_NEWS_CACHE_MS * 2) {
    return res.json(finvizNewsCache.data);
  }
  // If cache is empty or stale, fetch immediately
  try {
    await fetchFinvizNews();
    return res.json(finvizNewsCache.data || []);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch Finviz news', detail: err.message });
  }
});

// User management API (handles its own auth, but apply rate limiting to registration)
app.use('/api/users/register', registrationLimiter);
app.use('/api/users', userRoutes);

// General rate limiting for other endpoints
app.use(limiter);

// API-key auth middleware for protected API endpoints only
app.use((req, res, next) => {
  // Only apply auth to /api/ routes — let static files pass through
  if (!req.path.startsWith('/api/')) return next();

  // Allowlisted endpoints (public data) skip auth
  const publicPaths = [
    '/api/finviz/screener',
    '/api/finviz/news-scanner',
    '/api/finviz/quote',
    '/api/finviz/news',
    '/api/news',
    '/api/news/snippet',
    '/api/premarket/report',
    '/api/premarket/report-md',
    '/api/scanner/status',
    '/api/yahoo/quote',
    '/api/yahoo/quote-batch',
    '/api/yahoo/options',
    '/api/yahoo/history',
    '/api/yahoo/search',
    '/api/earnings/calendar',
    '/api/finnhub/news/symbol',
    '/api/expected-move-enhanced'
  ];
  if (publicPaths.includes(req.path)) return next();
  if (req.path.startsWith('/api/earnings-research/')) return next();
  if (req.path.startsWith('/api/ai-quant/')) return next();

  // Saxo proxy handles its own OAuth authentication
  if (req.path.startsWith('/api/saxo/')) return next();

  // For other endpoints: check JWT token OR API key
  const token = req.get('Authorization')?.replace('Bearer ', '');
  const apiKey = req.get('x-api-key') || req.query['api_key'];

  // If JWT token is provided, verify it
  if (token) {
    try {
      jwt.verify(token, JWT_SECRET);
      return next(); // JWT valid, allow request
    } catch (err) {
      // JWT invalid or expired, fall through to API key check
    }
  }

  // If no JWT, require API key
  if (!PROXY_API_KEY) {
    return res.status(502).json({ error: 'Proxy API key not configured on server' });
  }

  if (!apiKey || apiKey !== PROXY_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized - provide valid JWT or API key' });
  }

  next();
});

// News endpoint: provide market news (stub data for now)
app.get('/api/saxo/news', async (req, res) => {
  try {
    // Return sample market news
    const news = [
      {
        id: 1,
        headline: 'Federal Reserve Announces Interest Rate Decision',
        summary: 'The Fed decided to hold interest rates steady amid mixed economic signals.',
        source: 'Reuters',
        timestamp: new Date(Date.now() - 2 * 3600000).toISOString(),
        category: 'economics'
      },
      {
        id: 2,
        headline: 'Tech Stocks Rally on Positive Earnings',
        summary: 'Major technology companies exceed quarterly earnings expectations, driving markets higher.',
        source: 'Bloomberg',
        timestamp: new Date(Date.now() - 4 * 3600000).toISOString(),
        category: 'stocks'
      },
      {
        id: 3,
        headline: 'Oil Prices Drop on Supply Concerns',
        summary: 'Crude oil futures decline as OPEC signals potential production increases.',
        source: 'CNBC',
        timestamp: new Date(Date.now() - 6 * 3600000).toISOString(),
        category: 'commodities'
      },
      {
        id: 4,
        headline: 'European Markets Mixed as Inflation Data Released',
        summary: 'European stocks show mixed performance following latest inflation figures across the region.',
        source: 'MarketWatch',
        timestamp: new Date(Date.now() - 8 * 3600000).toISOString(),
        category: 'forex'
      }
    ];
    
    res.json(news);
  } catch (err) {
    logger.error('News endpoint error:', { error: err.message, stack: err.stack });
    res.status(500).json({ error: 'Failed to fetch news', detail: err.message });
  }
});

// Finnhub News Proxy Endpoint
const FINNHUB_API_KEY = process.env.FINNHUB_API_KEY;
const newsCache = { data: null, ts: 0 };
const NEWS_CACHE_MS = 5 * 60 * 1000; // 5 min

app.get('/api/news', async (req, res) => {
  if (!FINNHUB_API_KEY) {
    return res.status(500).json({ error: 'FINNHUB_API_KEY not set in server environment' });
  }
  // Use cache if fresh
  if (newsCache.data && Date.now() - newsCache.ts < NEWS_CACHE_MS) {
    return res.json(newsCache.data);
  }
  try {
    // US market news (general)
    const url = `https://finnhub.io/api/v1/news?category=general&token=${FINNHUB_API_KEY}`;
    const response = await axios.get(url, { timeout: 10000 });
    newsCache.data = response.data;
    newsCache.ts = Date.now();
    res.json(response.data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch news', detail: err.message });
  }
});

// Finnhub company-specific news
const symbolNewsCache = {};
const SYMBOL_NEWS_CACHE_MS = 5 * 60 * 1000;

app.get('/api/finnhub/news/symbol', async (req, res) => {
  if (!FINNHUB_API_KEY) return res.status(500).json({ error: 'FINNHUB_API_KEY not set' });
  const symbol = (req.query.symbol || '').trim().toUpperCase();
  if (!symbol) return res.json([]);

  const today = new Date().toISOString().split('T')[0];
  const weekAgo = new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0];
  const from = req.query.from || weekAgo;
  const to = req.query.to || today;
  const cacheKey = `${symbol}:${from}:${to}`;

  if (symbolNewsCache[cacheKey] && Date.now() - symbolNewsCache[cacheKey].ts < SYMBOL_NEWS_CACHE_MS) {
    return res.json(symbolNewsCache[cacheKey].data);
  }

  try {
    const url = `https://finnhub.io/api/v1/company-news?symbol=${symbol}&from=${from}&to=${to}&token=${FINNHUB_API_KEY}`;
    const response = await axios.get(url, { timeout: 10000 });
    const data = (response.data || []).slice(0, 50);
    symbolNewsCache[cacheKey] = { data, ts: Date.now() };
    // Evict old entries
    const keys = Object.keys(symbolNewsCache);
    if (keys.length > 100) {
      keys.sort((a, b) => symbolNewsCache[a].ts - symbolNewsCache[b].ts);
      keys.slice(0, keys.length - 50).forEach(k => delete symbolNewsCache[k]);
    }
    res.json(data);
  } catch (err) {
    logger.warn('Finnhub company news error', { symbol, error: err.message });
    res.json([]);
  }
});

// Finviz screener export endpoint
app.get('/api/finviz/screener', async (req, res) => {
  if (!FINVIZ_NEWS_TOKEN) {
    return res.status(500).json({ error: 'FINVIZ_NEWS_TOKEN not set in server environment' });
  }

  try {
    // Get filter parameters from query string
    const tickers = req.query.t || ''; // Optional ticker list
    const filters = req.query.f !== undefined ? req.query.f : (tickers ? '' : 'sh_avgvol_o500,ta_change_u5'); // Default filters only if no tickers specified
    const view = req.query.v || '111'; // Default view
    const columns = req.query.c || ''; // Optional custom columns
    const order = req.query.o || ''; // Optional ordering

    // Build Finviz export URL - use filters only if provided or if no tickers
    let url = `https://elite.finviz.com/export.ashx?v=${view}&auth=${FINVIZ_NEWS_TOKEN}`;
    if (filters) url += `&f=${filters}`;
    if (columns) url += `&c=${columns}`;
    if (order) url += `&o=${order}`;
    if (tickers) url += `&t=${tickers}`;

    logger.info('Fetching Finviz screener:', { filters: filters || 'none', view, tickers: tickers ? tickers.substring(0, 100) : 'none' });

    const response = await axios.get(url, {
      responseType: 'text',
      timeout: 10000
    });

    // Parse CSV to JSON
    const csvData = await csv().fromString(response.data);
    res.json(csvData);

  } catch (err) {
    logger.error('Finviz screener fetch error:', { error: err.message, stack: err.stack });
    res.status(502).json({ error: 'Failed to fetch Finviz screener', detail: err.message });
  }
});

// Finviz news scanner endpoint
app.get('/api/finviz/news-scanner', async (req, res) => {
  if (!FINVIZ_NEWS_TOKEN) {
    return res.status(500).json({ error: 'FINVIZ_NEWS_TOKEN not set in server environment' });
  }

  const view = req.query.v || '3'; // Default: Stocks feed
  const tickers = req.query.t || ''; // Optional ticker filter
  const newsOnly = req.query.c || ''; // c=1 for news only, c=2 for blogs only
  const cacheKey = `${view}|${tickers}|${newsOnly}`;
  const cached = finvizNewsScannerCache[cacheKey];
  const now = Date.now();
  if (cached && now - cached.ts < FINVIZ_NEWS_SCANNER_CACHE_MS) {
    logger.info('Serving Finviz news scanner from cache', { view, tickers });
    return res.json(cached.data);
  }

  try {
    // Build Finviz news export URL
    let url = `https://elite.finviz.com/news_export.ashx?v=${view}&auth=${FINVIZ_NEWS_TOKEN}`;
    if (tickers) url += `&t=${tickers}`;
    if (newsOnly) url += `&c=${newsOnly}`;

    logger.info('Fetching Finviz news scanner:', { view, tickers });

    const response = await axios.get(url, {
      responseType: 'text',
      timeout: 15000
    });

    // Parse CSV to JSON
    const csvData = await csv().fromString(response.data);
    finvizNewsScannerCache[cacheKey] = { data: csvData, ts: Date.now() };
    res.json(csvData);

  } catch (err) {
    const status = err.response?.status;
    const detail = err.response?.statusText || err.message;
    if (cached) {
      logger.warn('Finviz news scanner error, serving stale cache', { status, view, tickers, detail });
      return res.json(cached.data);
    }
    if (status === 429) {
      logger.warn('Finviz news scanner rate limited by upstream', { view, tickers });
      return res.json([]);
    }
    logger.error('Finviz news scanner fetch error:', { error: err.message, stack: err.stack });
    res.status(502).json({ error: 'Failed to fetch Finviz news scanner', detail: err.message });
  }
});

// Finviz quote scraper (public quote page)
app.get('/api/finviz/quote', async (req, res) => {
  const ticker = (req.query.t || '').trim().toUpperCase();
  if (!ticker) {
    return res.status(400).json({ error: 'Missing ticker symbol' });
  }

  const url = `https://finviz.com/quote.ashx?t=${encodeURIComponent(ticker)}`;

  try {
    const response = await axios.get(url, {
      timeout: 12000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Referer: 'https://finviz.com/'
      }
    });

    const html = response.data || '';
    const snapshot = {};

    // Current Finviz layout (2025+): label and value cells both use "snapshot-td2"
    // Labels:  <td class="snapshot-td2 cursor-pointer w-[7%]" ...>Label</td>
    // Values:  <td class="snapshot-td2 w-[8%] ..." ...><b>Value</b></td>
    const pairRegex = /<td class="snapshot-td2 cursor-pointer[^"]*"[^>]*>([^<]+)<\/td>\s*<td class="snapshot-td2[^"]*"[^>]*>(?:<b>)?([^<]*)(?:<\/b>)?<\/td>/gi;
    let match;
    while ((match = pairRegex.exec(html)) !== null) {
      const label = match[1].trim();
      const value = match[2].trim();
      if (label) snapshot[label] = value;
    }

    // Fallback: try legacy format (snapshot-td2-cp for labels)
    if (Object.keys(snapshot).length === 0) {
      const legacyRegex = /<td class="snapshot-td2-cp">([^<]+)<\/td>\s*<td class="snapshot-td2">([^<]*)<\/td>/gi;
      while ((match = legacyRegex.exec(html)) !== null) {
        const label = match[1].trim();
        const value = match[2].trim();
        if (label) snapshot[label] = value;
      }
    }

    // Extract price from dedicated price element
    const priceMatch = html.match(/quote-price_wrapper_price">([^<]+)/);
    const livePrice = priceMatch ? priceMatch[1].trim() : '';

    // Extract dollar change and percent change from price wrapper
    // Structure: <div class="sr-only">Dollar change</div>-3.50 ... <div class="sr-only">Percentage change</div>-1.26
    const dollarChangeMatch = html.match(/Dollar change<\/div>([^<]+)/);
    const pctChangeMatch = html.match(/Percentage change<\/div>([^<]+)/);
    const dollarChange = dollarChangeMatch ? dollarChangeMatch[1].trim() : '';
    const pctChange = pctChangeMatch ? pctChangeMatch[1].trim() : '';
    const changeStr = dollarChange && pctChange ? `${dollarChange} (${pctChange}%)` : dollarChange || '';

    // Extract sector, country from screener links:
    //   <a href="screener.ashx?v=111&f=sec_technology" class="tab-link">Technology</a>
    //   <a href="screener.ashx?v=111&f=geo_usa" class="tab-link">USA</a>
    const sectorMatch = html.match(/f=sec_[^"]*" class="tab-link">([^<]+)/);
    const countryMatch = html.match(/f=geo_[^"]*" class="tab-link">([^<]+)/);
    const sector = sectorMatch ? sectorMatch[1].trim() : (snapshot.Sector || '');
    const country = countryMatch ? countryMatch[1].trim() : (snapshot.Country || '');

    // Industry: from profile-bio section or from a link with industry param
    const industryMatch = html.match(/f=ind_[^"]*"[^>]*>([^<]+)/);
    // Fallback: look in the profile area for "Industry | Sector" pattern
    const profileIndustryMatch = html.match(/quote_profile[\s\S]*?class="tab-link"[^>]*>([^<]+)/);
    const industry = industryMatch ? industryMatch[1].trim()
      : profileIndustryMatch ? profileIndustryMatch[1].trim()
      : (snapshot.Industry || '');

    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    let companyName = '';
    if (titleMatch && titleMatch[1]) {
      const parts = titleMatch[1].split(' - ');
      companyName = parts.length > 1 ? parts[1].replace(/ Stock Quote.*/, '').trim() : titleMatch[1].trim();
    }

    // Profile description: current layout uses class "profile-bio"
    const bioMatch = html.match(/profile-bio">([\s\S]*?)<\/td>/i);
    const legacyProfileMatch = html.match(/fullview-profile">([\s\S]*?)<\/td>/i);
    const profileRaw = bioMatch || legacyProfileMatch;
    const description = profileRaw ? profileRaw[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';

    const data = {
      ticker,
      companyName,
      price: livePrice || snapshot.Price || snapshot.Last || '',
      change: changeStr || snapshot.Change || '',
      sector,
      industry,
      country,
      snapshot,
      description
    };

    res.json(data);
  } catch (err) {
    logger.warn('Finviz quote fetch error', { ticker, error: err.message });
    res.status(502).json({ error: 'Failed to fetch Finviz quote', detail: err.message });
  }
});

// Lightweight article snippet fetcher for hover previews
app.get('/api/news/snippet', async (req, res) => {
  const url = req.query.url;

  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: 'Invalid or missing url parameter' });
  }

  try {
    const response = await axios.get(url, { timeout: 8000 });
    const html = response.data || '';
    const match = html.match(/<p[^>]*>(.*?)<\/p>/is);
    const snippet = match && match[1]
      ? match[1]
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      : null;

    res.json({ snippet });
  } catch (err) {
    logger.warn('News snippet fetch error', { url, error: err.message });
    res.status(502).json({ error: 'Failed to fetch snippet' });
  }
});

// Proxy endpoint: forwards requests to Saxo OpenAPI
app.all('/api/saxo/*', async (req, res) => {
  try {
    // Get OAuth access token
    let accessToken;
    try {
      accessToken = await saxoAuth.getAccessToken();
    } catch (error) {
      return res.status(401).json({
        error: 'Saxo not authenticated',
        message: 'Please connect your Saxo account',
        authUrl: '/auth/saxo/login'
      });
    }

    const targetPath = req.originalUrl.replace(/^\/api\/saxo/, '');
    const targetUrl = `${SAXO_BASE}${targetPath}`;

    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': req.get('content-type') || 'application/json'
    };

    // Query params are already in targetUrl, don't duplicate them
    const axiosConfig = {
      method: req.method,
      url: targetUrl,
      headers,
      data: req.body,
      timeout: parseInt(process.env.REQUEST_TIMEOUT || '10000', 10),
      validateStatus: () => true
    };

    const response = await axios(axiosConfig);

    // Log response for debugging
    if (response.status !== 200) {
      logger.warn('Saxo API returned non-200:', {
        status: response.status,
        url: targetUrl,
        data: response.data
      });
    }

    // Forward status and data
    res.status(response.status);
    // Avoid forwarding certain hop-by-hop headers
    const excluded = ['transfer-encoding', 'content-encoding', 'content-length', 'connection'];
    Object.entries(response.headers || {}).forEach(([k, v]) => {
      if (!excluded.includes(k.toLowerCase())) {
        res.setHeader(k, v);
      }
    });

    if (response.data && typeof response.data === 'object') {
      return res.json(response.data);
    }

    return res.send(response.data);
  } catch (err) {
    logger.error('Proxy error:', { error: err.message || err, stack: err.stack });
    if (err.response) {
      return res.status(err.response.status).json(err.response.data || { error: 'Upstream error' });
    }
    return res.status(500).json({ error: 'Proxy failed', detail: err.message });
  }
});

// Final SPA catch-all for /app/* deep links (watchlist, earnings, etc.)
app.get('/app/*', (req, res) => {
  const indexPath = path.join(REACT_BUILD, 'index.html');
  const fs = require('fs');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send('React app not built. Run: cd client && npm run build');
  }
});

app.listen(PORT, () => logger.info(`Saxo proxy listening on http://localhost:${PORT}`));
