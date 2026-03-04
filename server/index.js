const path = require('path');
// Load from server/.env (works regardless of CWD at startup)
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
// Fallback: also try root .env in case server is started from project root
if (!process.env.FMP_API_KEY) {
  require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
}

const express = require('express');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const csv = require('csvtojson');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const fs = require('fs').promises;
const { randomUUID } = require('crypto');
const { withRetry } = require('./utils/retry');

// New layered architecture pieces
const loggingMiddleware = require('./middleware/logging');
const authMiddleware = require('./middleware/auth');
const { generalLimiter, registerLimiter } = require('./middleware/rateLimit');
const usageMiddleware = require('./middleware/usage');
const quotesRoutes = require('./routes/quotes');
const quotesBatchRoutes = require('./routes/quotesBatch');
const newsRoutes = require('./routes/news');
const gappersRoutes = require('./routes/gappers');
const historicalRoutes = require('./routes/historical');
const optionsRoutes = require('./routes/options');
const adminRoutes = require('./routes/admin');
const earningsRoutes = require('./routes/earnings');
const optionsApiRoutes = require('./routes/optionsRoutes');
const earningsIntelligenceRoutes = require('./routes/earningsRoutes');
const brokerRoutes = require('./routes/broker');
const marketService = require('./services/marketDataService');
const expectedMoveService = require('./services/expectedMoveService');
const { buildUniverseDataset } = require('./services/fmpService');
const { isCacheFresh, setUniverse, getUniverse, getLastUpdated } = require('./services/dataStore');
const { startScheduler, rebuildEngine } = require('./data-engine/scheduler');
const engineCache = require('./data-engine/cacheManager');
const { applyFilters } = require('./data-engine/filterEngine');
const { startPhaseScheduler } = require('./scheduler/phaseScheduler');
const profileRoutes = require('./routes/profile');
const systemStatusRoutes = require('./routes/systemStatus');
const screenerV3Routes = require('./routes/screenerV3');
const screenerV3EngineRoutes = require('./routes/screenerV3Engine.ts');
const canonicalNewsRoutes = require('./routes/canonical/news.ts');
const canonicalQuotesRoutes = require('./routes/canonical/quotes.ts');
const canonicalFmpScreenerRoutes = require('./routes/canonical/fmpScreener.ts');
const canonicalUniverseRoutes = require('./routes/canonical/universe.ts');
const canonicalUniverseV2Routes = require('./routes/canonical/universeV2.ts');
const directoryV1Routes = require('./routes/directoryV1.ts');
const newsV4Routes = require('./routes/newsV4.ts');
const exportV1Routes = require('./routes/exportV1.ts');
const chartV2Routes = require('./routes/chartV2.ts');
const newsV3Routes = require('./routes/newsV3');
const testNewsDbRoute = require('./routes/testNewsDb');
const { startSchedulerService } = require('./services/schedulerService.ts');
const { startIngestionScheduler } = require('./ingestion/scheduler');
const { startMetricsScheduler } = require('./metrics/metrics_scheduler');
const { startStrategyScheduler } = require('./strategy/strategy_scheduler');
const { startCatalystScheduler } = require('./catalyst/catalyst_scheduler');
const { getExpectedMoveRows } = require('./metrics/expected_move');
const { getMetricsHealth } = require('./monitoring/metricsHealth');
const { getIngestionHealth } = require('./monitoring/ingestionHealth');
const { getUniverseHealth } = require('./monitoring/universeHealth');
const { getQueueHealth } = require('./monitoring/queueHealth');
const { getSetupHealth } = require('./monitoring/setupHealth');
const { getCatalystHealth } = require('./monitoring/catalystHealth');
const { getSystemHealth } = require('./monitoring/systemHealth');
const intelligenceRoutes = require('./routes/intelligence');
const { pool } = require('./db/pg');

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
const FINVIZ_CSV_CACHE_MS = 90 * 1000;
const finvizCsvCache = {};

// FMP screener cache (in-memory)
const FMP_SCREENER_CACHE_KEY = 'fmp_screener';
const FMP_SCREENER_CACHE_MS = 60 * 1000;
const fmpScreenerCache = { key: FMP_SCREENER_CACHE_KEY, data: null, ts: 0 };
const FMP_FULL_UNIVERSE_CACHE_MS = 60 * 1000;
const fmpFullUniverseCache = { data: null, ts: 0 };
const FMP_QUOTES_CACHE_MS = 60 * 1000;
const fmpQuotesCache = new Map();

async function fetchFmpJson(url) {
  const response = await axios.get(url, { timeout: 15000 });
  return response.data;
}

async function fetchFmpBatches(baseUrl, symbols, batchSize = 500) {
  const all = [];
  for (let i = 0; i < symbols.length; i += batchSize) {
    const batch = symbols.slice(i, i + batchSize);
    const url = `${baseUrl}/${batch.join(',')}?apikey=${FMP_API_KEY}`;
    const data = await fetchFmpJson(url);
    if (Array.isArray(data)) all.push(...data);
  }
  return all;
}

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

function shouldRetryFinviz(err) {
  const status = err?.response?.status;
  return status === 429 || (status >= 500 && status < 600);
}

async function fetchFinvizCsv(url, cacheKey, timeout = 12000) {
  const cached = cacheKey ? finvizCsvCache[cacheKey] : null;
  const now = Date.now();
  if (cached && now - cached.ts < FINVIZ_CSV_CACHE_MS) return cached.data;

  try {
    const response = await withRetry(
      () => axios.get(url, { responseType: 'text', timeout }),
      {
        retries: 4,
        baseDelay: 400,
        factor: 2,
        shouldRetry: shouldRetryFinviz,
        onError: (err, attempt) => logger.warn('Finviz fetch retry', {
          cacheKey,
          attempt,
          status: err?.response?.status,
          error: err.message,
        }),
      }
    );

    const csvData = await csv().fromString(response.data);
    if (cacheKey) finvizCsvCache[cacheKey] = { data: csvData, ts: now };
    return csvData;
  } catch (err) {
    if (cacheKey && cached) {
      logger.warn('Finviz fetch failed, serving stale cache', { cacheKey, error: err.message });
      return cached.data;
    }
    throw err;
  }
}

async function loadScannerContext() {
  if (!FINVIZ_NEWS_TOKEN) {
    return { available: false, text: 'Scanner context unavailable: FINVIZ token missing.' };
  }
  try {
    const url = `https://elite.finviz.com/export.ashx?v=111&auth=${FINVIZ_NEWS_TOKEN}&f=sh_avgvol_o500,ta_change_u5`;
    const csvData = await fetchFinvizCsv(url, 'scanner:context');
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

function logUniverseDiagnostics(universe) {
  if (!Array.isArray(universe)) {
    console.error('Universe is not an array');
    return;
  }

  const total = universe.length;

  const symbolSet = new Set();
  const exchangeCounts = {};
  let nullExchange = 0;
  let nullPrice = 0;
  let nullMarketCap = 0;
  let duplicateCount = 0;

  let suffixW = 0;
  let suffixU = 0;
  let suffixR = 0;
  let suffixP = 0;

  for (const row of universe) {
    const symbol = row?.symbol;

    if (!symbolSet.has(symbol)) {
      symbolSet.add(symbol);
    } else {
      duplicateCount++;
    }

    const exchange = row?.exchange;
    if (!exchange) {
      nullExchange++;
    } else {
      exchangeCounts[exchange] = (exchangeCounts[exchange] || 0) + 1;
    }

    if (row?.price == null) nullPrice++;
    if (row?.marketCap == null) nullMarketCap++;

    if (symbol?.endsWith('W')) suffixW++;
    if (symbol?.endsWith('U')) suffixU++;
    if (symbol?.endsWith('R')) suffixR++;
    if (symbol?.includes('-P')) suffixP++;
  }

  console.log('========== UNIVERSE DIAGNOSTICS ==========');
  console.log('Total rows:', total);
  console.log('Unique symbols:', symbolSet.size);
  console.log('Duplicate count:', duplicateCount);
  console.log('Exchange counts:', exchangeCounts);
  console.log('Null exchange count:', nullExchange);
  console.log('Null price count:', nullPrice);
  console.log('Null marketCap count:', nullMarketCap);
  console.log('Suffix W:', suffixW);
  console.log('Suffix U:', suffixU);
  console.log('Suffix R:', suffixR);
  console.log('Suffix -P:', suffixP);
  console.log('==========================================');
}

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// New logging middleware
app.use(loggingMiddleware);

app.use((req, res, next) => {
  req.requestId = req.get('x-request-id') || randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
});

app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:3000',
    'https://openrangetrading.co.uk'
  ],
  credentials: true
}));

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
      "connect-src 'self' https://finnhub.io https://elite.finviz.com https://gateway.saxobank.com; " +
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
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const FMP_API_KEY = process.env.FMP_API_KEY || null;
logger.info(`FMP_API_KEY exists: ${!!FMP_API_KEY}`);
if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  logger.warn('JWT_SECRET not set — using insecure default. Set JWT_SECRET env var in production.');
}
const FRONTEND_PATH = path.join(__dirname, '..', 'pages');
const CLIENT_DIST = path.join(__dirname, '..', 'client', 'dist');
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

// In development, serve vanilla HTML/CSS/JS
if (process.env.NODE_ENV !== 'production') {
  app.use(express.static(FRONTEND_PATH, {
    index: ['login.html']
  }));
  // Serve JS, CSS, and other assets from repo root
  app.use(express.static(path.join(__dirname, '..')));
}
    
  // New modular routes
  app.use(quotesRoutes);
  app.use(quotesBatchRoutes);
  app.use(newsRoutes);
  app.use(gappersRoutes);
  app.use(historicalRoutes);
  app.use(optionsRoutes);
  app.use(earningsRoutes);
  app.use('/api/options', optionsApiRoutes);
  app.use('/api/earnings/intelligence', earningsIntelligenceRoutes);
  app.use(adminRoutes);
  // Phase-aware architecture routes
  app.use('/api', profileRoutes);
  app.use('/api', testNewsDbRoute);
  app.use('/api/system', systemStatusRoutes);
  app.use('/api/data', screenerV3Routes);
  app.use('/api/v3/screener', screenerV3EngineRoutes);
  app.use('/api/canonical/news', canonicalNewsRoutes);
  app.use('/api/canonical/quotes', canonicalQuotesRoutes);
  app.use('/api/canonical/fmp-screener', canonicalFmpScreenerRoutes);
  app.use('/api/canonical/universe', canonicalUniverseRoutes);
  app.use('/api/canonical/universe-v2', canonicalUniverseV2Routes);
  app.use('/api/v4/directory', directoryV1Routes);
  app.use('/api/v4', newsV4Routes);
  app.use('/api/v4', exportV1Routes);
  app.use('/api/v5', chartV2Routes);
  app.use(newsV3Routes);


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
  res.json({
    ok: true,
    ts: new Date().toISOString(),
    env: process.env.NODE_ENV || 'development'
  });
});

app.get('/api/market-status', (req, res) => {
  const now = new Date();
  const nyOptions = { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hour12: false };
  const parts = new Intl.DateTimeFormat('en-US', nyOptions).formatToParts(now);
  const hour = parseInt(parts.find(p => p.type === 'hour').value, 10);
  const minute = parseInt(parts.find(p => p.type === 'minute').value, 10);
  const nyTime = hour * 60 + minute;
  const dayOfWeek = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' })).getDay();
  const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
  const isOpen = isWeekday && nyTime >= 570 && nyTime < 960; // 9:30-16:00 ET
  const isPreMarket = isWeekday && nyTime >= 240 && nyTime < 570; // 4:00-9:30 ET
  const isAfterHours = isWeekday && nyTime >= 960 && nyTime < 1200; // 16:00-20:00 ET
  res.json({ isOpen, isPreMarket, isAfterHours });
});

app.get('/api/config', (req, res) => {
  res.json({
    brokers: ['ibkr', 'saxo'],
    finvizEnabled: !!FINVIZ_NEWS_TOKEN,
    finnhubEnabled: !!process.env.FINNHUB_API_KEY,
    pplxEnabled: !!PPLX_API_KEY
  });
});

app.get('/api/metrics/health', async (req, res) => {
  try {
    const health = await getMetricsHealth();
    res.json(health);
  } catch (err) {
    logger.error('metrics health endpoint error', { error: err.message });
    res.status(500).json({ engine: 'metrics', status: 'error', error: err.message });
  }
});

app.get('/api/ingestion/health', async (req, res) => {
  try {
    const health = await getIngestionHealth();
    res.json(health);
  } catch (err) {
    logger.error('ingestion health endpoint error', { error: err.message });
    res.status(500).json({ engine: 'ingestion', status: 'error', error: err.message });
  }
});

app.get('/api/universe/health', async (req, res) => {
  try {
    const health = await getUniverseHealth();
    res.json(health);
  } catch (err) {
    logger.error('universe health endpoint error', { error: err.message });
    res.status(500).json({ engine: 'universe', status: 'error', error: err.message });
  }
});

app.get('/api/queue/health', async (req, res) => {
  try {
    const health = await getQueueHealth();
    res.json(health);
  } catch (err) {
    logger.error('queue health endpoint error', { error: err.message });
    res.status(500).json({ engine: 'queue', status: 'error', error: err.message });
  }
});

app.get('/api/system/health', async (req, res) => {
  try {
    const health = await getSystemHealth();
    res.json(health);
  } catch (err) {
    logger.error('system health endpoint error', { error: err.message });
    res.status(500).json({ system: 'openrange', status: 'error', error: err.message });
  }
});

app.get('/api/setups', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.*,
              c.catalyst_type,
              c.headline AS catalyst_headline,
              c.source AS catalyst_source,
              c.sentiment AS catalyst_sentiment,
              c.published_at AS catalyst_published_at,
              c.score AS catalyst_score
       FROM trade_setups s
       LEFT JOIN LATERAL (
         SELECT catalyst_type,
                headline,
                source,
                sentiment,
                published_at,
                score
         FROM trade_catalysts tc
         WHERE tc.symbol = s.symbol
         ORDER BY tc.published_at DESC NULLS LAST
         LIMIT 1
       ) c ON TRUE
       ORDER BY s.score DESC NULLS LAST
       LIMIT 50`
    );
    res.json(rows);
  } catch (err) {
    logger.error('setups endpoint db error', { error: err.message });
    res.json([]);
  }
});

app.get('/api/setups/types', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT setup,
              COUNT(*)::int AS count
       FROM trade_setups
       GROUP BY setup
       ORDER BY count DESC`
    );
    res.json(rows);
  } catch (err) {
    logger.error('setups types endpoint db error', { error: err.message });
    res.json([]);
  }
});

app.get('/api/catalysts', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT symbol,
              catalyst_type,
              headline,
              source,
              sentiment,
              published_at,
              score,
              created_at
       FROM trade_catalysts
       ORDER BY published_at DESC NULLS LAST
       LIMIT 100`
    );
    res.json(rows);
  } catch (err) {
    logger.error('catalysts endpoint db error', { error: err.message });
    res.json([]);
  }
});

app.get('/api/scanner', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT m.symbol,
              u.company_name,
              u.sector,
              m.price,
              m.gap_percent,
              m.relative_volume,
              m.atr,
              m.float_rotation
       FROM market_metrics m
       JOIN ticker_universe u
         ON m.symbol = u.symbol
       WHERE m.relative_volume > 1.5
       ORDER BY m.relative_volume DESC
       LIMIT 50`
    );
    res.json(rows);
  } catch (err) {
    logger.error('scanner endpoint db error', { error: err.message });
    res.json([]);
  }
});

app.get('/api/premarket', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT *
       FROM market_metrics
       WHERE gap_percent > 3
         AND relative_volume > 2
       ORDER BY gap_percent DESC
       LIMIT 50`
    );
    res.json(rows);
  } catch (err) {
    logger.error('premarket endpoint db error', { error: err.message });
    res.json([]);
  }
});

app.get('/api/metrics', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT *
       FROM market_metrics
       ORDER BY relative_volume DESC NULLS LAST
       LIMIT 100`
    );
    res.json(rows);
  } catch (err) {
    logger.error('metrics endpoint db error', { error: err.message });
    res.json([]);
  }
});

app.get('/api/intelligence', (req, res) => {
  res.json({ status: 'ok', data: [] });
});

app.get('/api/market', (req, res) => {
  res.json({ status: 'ok', data: [] });
});

app.get('/api/expected-move', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 100, 500));
    const rows = await getExpectedMoveRows(limit);
    res.json(rows);
  } catch (err) {
    logger.error('expected move endpoint db error', { error: err.message });
    res.json([]);
  }
});

app.get('/api/screener', (req, res) => {
  res.json({ status: 'ok', data: [] });
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
  try {
    const ctx = await marketService.getMarketContext();
    res.json(ctx);
  } catch (err) {
    const upstreamStatus = Number(err?.response?.status);
    logger.error('Market context error', {
      method: req.method,
      path: req.originalUrl,
      requestId: req.requestId,
      error: err?.message,
      status: Number.isFinite(upstreamStatus) ? upstreamStatus : undefined,
      stack: err?.stack,
    });
    res.status(502).json({
      error: 'UPSTREAM_MARKET_CONTEXT_FAILED',
      message: 'Failed to fetch market context from provider',
      requestId: req.requestId,
      detail: err?.message || 'Unknown upstream error'
    });
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

  try {
    // ── 1. Parallel data fetching ──────────────────────────────────
    const now = new Date();
    const oneYearAgo = new Date(now); oneYearAgo.setFullYear(now.getFullYear() - 1);
    const thirtyDaysAgo = new Date(now); thirtyDaysAgo.setDate(now.getDate() - 30);
    const newsFrom = new Date(now); newsFrom.setDate(now.getDate() - 3);

    const [quoteResult, chartResult, chart30dResult, marketCtxResult, sectorResult, newsResult, earningsSummaryResult] = await Promise.allSettled([
      // Full quote (includes beta, sector, marketCap, volume)
      yahooFinance.quote(ticker),
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
    const canonicalMove = await expectedMoveService.getExpectedMove(ticker, null, 'screener');
    if (canonicalMove?.data) {
      const expectedMove = canonicalMove.data.impliedMoveDollar;
      const expectedMovePercent = canonicalMove.data.impliedMovePct != null
        ? +(canonicalMove.data.impliedMovePct * 100).toFixed(2)
        : null;
      optionsData = {
        atmStrike: canonicalMove.data.strike,
        daysToExpiry: canonicalMove.data.daysToExpiry,
        expirationDate: canonicalMove.data.expiration,
        atmCall: null,
        atmPut: null,
        straddleMid: null,
        avgIV: canonicalMove.data.iv,
        ivExpectedMove: expectedMove,
        expectedMove, expectedMovePercent,
        rangeHigh: expectedMove != null ? +(price + expectedMove).toFixed(2) : null,
        rangeLow: expectedMove != null ? +(price - expectedMove).toFixed(2) : null,
        callsCount: null,
        putsCount: null,
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

    // ── 4b. HV-derived fallback when options chain unavailable ───────
    if (!optionsData && hvMetrics?.hvCurrent20 != null && price > 0) {
      const hvIV = hvMetrics.hvCurrent20;
      // Use 30 trading-day horizon (standard 1-month window)
      const DTE = 30;
      const hvMovePct = hvIV * Math.sqrt(DTE / 252);
      const hvMoveDollar = +(price * hvMovePct).toFixed(2);
      const hvMovePctRounded = +(hvMovePct * 100).toFixed(2);
      optionsData = {
        atmStrike: null,
        daysToExpiry: DTE,
        expirationDate: null,
        atmCall: null,
        atmPut: null,
        straddleMid: null,
        avgIV: hvIV,
        ivExpectedMove: hvMoveDollar,
        expectedMove: hvMoveDollar,
        expectedMovePercent: hvMovePctRounded,
        rangeHigh: +(price + hvMoveDollar).toFixed(2),
        rangeLow: +(price - hvMoveDollar).toFixed(2),
        callsCount: 0,
        putsCount: 0,
        earningsDate: null,
        earningsInDays: null,
        _source: 'hv-derived',
      };
    }

    // SPY expected move for beta-adjusted comparison
    let spyExpectedMovePercent = null;
    if (marketCtx?.technicals?.SPY) {
      const spyEm = await expectedMoveService.getExpectedMove('SPY', null, 'screener');
      if (spyEm?.data?.impliedMovePct != null) {
        spyExpectedMovePercent = +(spyEm.data.impliedMovePct * 100).toFixed(2);
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
        method: optionsData?._source === 'hv-derived' ? 'HV-Derived' : optionsData?.straddleMid > 0 ? 'ATM Straddle' : 'IV-Derived',
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
        source: optionsData._source || 'iv-derived',
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

const isDev = process.env.NODE_ENV !== 'production';
const SYNC_HIT_LOG_THROTTLE_MS = 60 * 1000;
let lastSyncLogTime = 0;

// Build/rebuild universe cache on demand.
app.get('/api/data/sync', isDev ? (req, res, next) => next() : authMiddleware, async (req, res) => {
  try {
    if (engineCache.isFresh('enrichedUniverse', 10 * 60 * 1000)) {
      const cached = engineCache.getEnrichedUniverse();
      const now = Date.now();
      if (now - lastSyncLogTime > SYNC_HIT_LOG_THROTTLE_MS) {
        const requesterIp = req?.ip || null;
        const forwardedFor = req?.headers?.['x-forwarded-for'] || null;
        const userAgent = req?.get?.('user-agent') || null;
        const host = req?.headers?.host || null;
        const method = req?.method || null;

        logger.info('Data sync caller trace (throttled)', {
          route: '/api/data/sync',
          requesterIp,
          forwardedFor,
          userAgent,
          host,
          method,
          timestamp: new Date().toISOString(),
        });

        lastSyncLogTime = now;
      }
      return res.json({ status: 'ok', source: 'cache', count: cached.length, lastUpdated: engineCache.getLastUpdated('enrichedUniverse') });
    }

    logger.info('Data sync cache rebuild starting');
    const dataset = await rebuildEngine(FMP_API_KEY, logger);
    logUniverseDiagnostics(dataset);
    logger.info('Data sync cache rebuild complete', { count: dataset.length });
    return res.json({ status: 'ok', source: 'rebuild', count: dataset.length, lastUpdated: engineCache.getLastUpdated('enrichedUniverse') });
  } catch (err) {
    logger.error('Data sync failed', { error: err.message });
    return res.status(500).json({ error: 'Data sync failed', message: err.message });
  }
});

app.get('/api/data/debug', async (_req, res) => {
  const base = engineCache.getBaseUniverse();
  const enriched = engineCache.getEnrichedUniverse();
  return res.json({
    baseUniverseCount: Array.isArray(base) ? base.length : 0,
    enrichedUniverseCount: Array.isArray(enriched) ? enriched.length : 0,
    sampleRow: Array.isArray(enriched) && enriched.length ? enriched[0] : null,
  });
});

// Server-side screener using cached enriched universe.
// Read-only: never triggers a rebuild. Serves from cache only.
app.get('/api/data/screener', authMiddleware, async (req, res) => {
  try {
    const fullUniverse    = engineCache.getBaseUniverse();
    const enrichedUniverse = engineCache.getEnrichedUniverse();
    const operationalUniverse = engineCache.getDataset('operationalUniverse') || [];

    // useOperational=true → filter from operationalUniverse (preset-scoped)
    const useOperational = req.query.useOperational === 'true';
    let sourceDataset;
    if (useOperational && operationalUniverse.length) {
      // Resolve enriched rows for operational symbols
      const enrichedMap = new Map((enrichedUniverse.length ? enrichedUniverse : fullUniverse)
        .map((r) => [r.symbol, r]));
      sourceDataset = operationalUniverse.map((r) => enrichedMap.get(r.symbol) || r);
    } else {
      sourceDataset = enrichedUniverse.length ? enrichedUniverse : fullUniverse;
    }

    if (!Array.isArray(sourceDataset) || !sourceDataset.length) {
      return res.json({
        data: [], total: 0, page: 1, pageSize: 25, lastUpdated: null,
        totalFullUniverse: fullUniverse.length,
        totalOperationalUniverse: operationalUniverse.length,
        activeRefreshMode: 'no-data',
      });
    }

    const normalized = sourceDataset.map((row) => ({
      ...row,
      price:         row.price        ?? row.currentPrice ?? null,
      volume:        row.volume       ?? row.currentVolume ?? null,
      changePercent: row.changePercent ?? row.changesPercentage ?? row.changePercentage ?? row.dayChange ?? null,
    }));

    // Strip internal-only params before passing to filterEngine
    const { useOperational: _ignored, page: _p, pageSize: _ps, ...filterRest } = req.query;
    const filterPayload = {
      ...filterRest,
      exchange: filterRest.exchange ? String(filterRest.exchange).toUpperCase() : undefined,
    };
    const filtered = applyFilters(normalized, filterPayload);

    const page     = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 25, 1), 100);
    const start    = (page - 1) * pageSize;
    const paginatedRows = filtered.slice(start, start + pageSize);

    logger.info('Screener response generated', {
      total: filtered.length,
      page,
      pageSize,
      useOperational,
    });

    return res.json({
      data: paginatedRows,
      total: filtered.length,
      page,
      pageSize,
      lastUpdated:              engineCache.getLastUpdated('enrichedUniverse'),
      totalFullUniverse:        fullUniverse.length,
      totalOperationalUniverse: operationalUniverse.length,
      activeRefreshMode:        useOperational ? 'operational' : 'full',
    });
  } catch (err) {
    logger.error('Screener route failed', { error: err.message });
    return res.json({
      data: [],
      total: 0,
      page: 1,
      pageSize: 25,
      lastUpdated: engineCache.getLastUpdated('enrichedUniverse'),
    });
  }
});

app.get('/api/fmp/screener', async (req, res) => {
  console.log("Screener route hit");
  return res.status(410).json({
    error: 'Deprecated endpoint',
    message: 'Use /api/fmp/full-universe + /api/fmp/quotes'
  });
});

// Fetch the complete symbol universe from raw FMP stock-list endpoint.
app.get('/api/fmp/full-universe', async (_req, res) => {
  try {
    const response = await axios.get('https://financialmodelingprep.com/api/v3/stock-list', {
      params: { apikey: process.env.FMP_API_KEY || '' },
      validateStatus: () => true,
    });

    if (response.status !== 200) {
      const errorBody = response.data;
      console.error('FMP FULL UNIVERSE ERROR BODY:', errorBody);
      return res.status(response.status).json(errorBody);
    }

    const data = Array.isArray(response.data) ? response.data : [];
    console.log('Raw FMP length:', data.length);
    return res.json(data);
  } catch (err) {
    const errorBody = err.response?.data || { error: err.message };
    const status = err.response?.status || 500;
    console.error('FMP FULL UNIVERSE ERROR BODY:', errorBody);
    return res.status(status).json(errorBody);
  }
});

// Fetch batched quotes for a comma-separated symbol list.
app.get('/api/fmp/quotes', async (req, res) => {
  try {
    const symbols = String(req.query.symbols || '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
      .slice(0, 500);

    if (!symbols.length) {
      return res.status(400).json({ error: 'symbols query param is required' });
    }

    const cacheKey = symbols.join(',');
    const cached = fmpQuotesCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < FMP_QUOTES_CACHE_MS) {
      return res.json(cached.data);
    }

    const url = `https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(cacheKey)}&apikey=${process.env.FMP_API_KEY || ''}`;
    console.log('FMP URL:', url);
    const response = await axios.get(url, { validateStatus: () => true });
    if (response.status !== 200) {
      const errorBody = response.data;
      console.error('FMP QUOTES ERROR BODY:', errorBody);
      if (cached?.data) return res.json(cached.data);
      return res.status(response.status).json(errorBody);
    }
    const payload = Array.isArray(response.data) ? response.data : [];
    fmpQuotesCache.set(cacheKey, { data: payload, ts: Date.now() });
    return res.json(payload);
  } catch (err) {
    const errorBody = err.response?.data || { error: err.message };
    const status = err.response?.status || 500;
    console.error('FMP QUOTES ERROR BODY:', errorBody);
    const symbols = String(req.query.symbols || '')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
      .slice(0, 500)
      .join(',');
    const cached = fmpQuotesCache.get(symbols);
    if (cached?.data) return res.json(cached.data);
    return res.status(status).json(errorBody);
  }
});

// Finviz screener export endpoint (public)
app.get('/api/finviz/screener', async (req, res) => {
  if (!FINVIZ_NEWS_TOKEN) {
    return res.status(500).json({ error: 'FINVIZ_NEWS_TOKEN not set in server environment' });
  }

  try {
    // Get filter parameters from query string
    const tickers = req.query.t || ''; // Optional ticker list
    // When f= is explicitly passed (even empty string), use it as-is.
    // Only apply defaults when f is completely absent from the query.
    const filters = req.query.f !== undefined ? req.query.f : (tickers ? '' : 'sh_avgvol_o500,ta_change_u5');
    const view = req.query.v || '111'; // Default view
    const columns = req.query.c || ''; // Optional custom columns
    const order = req.query.o || ''; // Optional ordering
    const page = parseInt(req.query.r) || 0; // Row offset for pagination (Finviz uses r= param)

    // Build Finviz export URL - always include f= if filters are non-empty
    let url = `https://elite.finviz.com/export.ashx?v=${view}&auth=${FINVIZ_NEWS_TOKEN}`;
    if (filters) url += `&f=${filters}`;
    if (columns) url += `&c=${columns}`;
    if (order) url += `&o=${order}`;
    if (tickers) url += `&t=${tickers}`;
    if (page > 0) url += `&r=${page}`;

    logger.info('Fetching Finviz screener:', { filters: filters || 'none', view, page, tickers: tickers ? tickers.substring(0, 100) : 'none' });
    const cacheKey = `screener:${view}:${filters || 'none'}:${order || 'none'}:${tickers || 'none'}:${page}`;
    const csvData = await fetchFinvizCsv(url, cacheKey, 12000);
    res.json(csvData);

  } catch (err) {
    logger.error('Finviz screener fetch error:', { error: err.message, stack: err.stack });
    res.status(502).json({ error: 'Failed to fetch Finviz screener', detail: err.message });
  }
});

// Batch news freshness for screener tickers (public)
const newsFreshnessCache = {};
const NEWS_FRESHNESS_CACHE_MS = 120 * 1000; // 2 minutes
app.get('/api/finviz/news-freshness', async (req, res) => {
  const tickers = (req.query.t || '').trim().toUpperCase();
  if (!tickers) return res.json({});
  if (!FINVIZ_NEWS_TOKEN) return res.json({});

  const tickerList = tickers.split(',').slice(0, 100); // max 100 tickers
  const now = Date.now();
  const result = {};
  const missing = [];

  // Check cache first
  for (const t of tickerList) {
    const cached = newsFreshnessCache[t];
    if (cached && now - cached.ts < NEWS_FRESHNESS_CACHE_MS) {
      result[t] = cached.data;
    } else {
      missing.push(t);
    }
  }

  // Fetch missing from Finviz news scanner (batch by ticker list)
  if (missing.length > 0) {
    try {
      const batchTickers = missing.join(',');
      const url = `https://elite.finviz.com/news_export.ashx?v=3&auth=${FINVIZ_NEWS_TOKEN}&t=${batchTickers}`;
      const response = await axios.get(url, { responseType: 'text', timeout: 10000 });
      const csvData = await csv().fromString(response.data);

      // Group by ticker, find most recent article per ticker
      const byTicker = {};
      for (const row of csvData) {
        const ticker = (row.Ticker || '').trim().toUpperCase();
        if (!ticker) continue;
        const datetime = row.Date && row.Time
          ? new Date(`${row.Date} ${row.Time}`).getTime()
          : null;
        if (!datetime) continue;
        if (!byTicker[ticker] || datetime > byTicker[ticker].datetime) {
          byTicker[ticker] = {
            datetime,
            ageHours: (now - datetime) / (1000 * 60 * 60),
            headline: row.Headline || row.Title || '',
            source: row.Source || 'Finviz',
          };
        }
      }

      for (const t of missing) {
        const info = byTicker[t] || { ageHours: null, headline: null, source: null, datetime: null };
        result[t] = info;
        newsFreshnessCache[t] = { data: info, ts: now };
      }
    } catch (err) {
      logger.warn('News freshness batch fetch error:', { error: err.message });
      // Return what we have from cache
      for (const t of missing) {
        const stale = newsFreshnessCache[t];
        result[t] = stale ? stale.data : { ageHours: null, headline: null, source: null, datetime: null };
      }
    }
  }

  res.json(result);
});

// User management API (handles its own auth, but apply rate limiting to registration)
app.use('/api/users/register', registrationLimiter);
app.use('/api/users', userRoutes);

// Intelligence ingestion — own key auth, must be before JWT middleware
app.use(intelligenceRoutes);

// General rate limiting for other endpoints (new wrapper)
app.use(generalLimiter);

// API-key/JWT auth middleware
app.use(authMiddleware);

// Broker abstraction routes (monitoring-only)
app.use(brokerRoutes);

app.post('/api/gpt/analyse-cockpit', async (req, res) => {
  try {
    const screenshotBase64 = String(req.body?.screenshotBase64 || '');
    const metadata = req.body?.metadata || {};

    if (!screenshotBase64 || !screenshotBase64.startsWith('data:image')) {
      return res.status(400).json({ error: 'screenshotBase64 image payload required' });
    }

    return res.json({
      ok: true,
      message: 'Cockpit analysis request received. GPT processing not implemented in this route yet.',
      received: {
        screenshotBytesApprox: Math.round((screenshotBase64.length * 3) / 4),
        metadataKeys: Object.keys(metadata),
      },
    });
  } catch (err) {
    return res.status(500).json({ error: 'Failed to process cockpit analysis payload', detail: err.message });
  }
});

// Trade Intelligence routes
const tradesRoutes = require('./routes/trades');
const dailyReviewsRoutes = require('./routes/dailyReviews');
const demoRoutes = require('./routes/demo');
app.use(tradesRoutes);
app.use(dailyReviewsRoutes);
app.use(demoRoutes);

// Usage metrics (after auth so user is available)
app.use(usageMiddleware);

// Finnhub news endpoints moved to routes/news.js

// Premarket gappers endpoint (Finviz tickers + Yahoo enrich)
const GAP_DEFAULT_FILTERS = 'sh_price_o1,sh_avgvol_o500,ta_gap_u';
const GAP_BATCH_SIZE = 8;

function tagCatalyst(headline = '') {
  const h = headline.toLowerCase();
  if (!h) return null;
  if (h.includes('fda') || h.includes('phase') || h.includes('trial')) return 'FDA/Drug';
  if (h.includes('offering') || h.includes('pricing')) return 'Offering';
  if (h.includes('guid') || h.includes('forecast')) return 'Guidance';
  if (h.includes('earnings') || h.includes('results')) return 'Earnings';
  if (h.includes('upgrade') || h.includes('downgrade')) return 'Upgrade/Downgrade';
  if (h.includes('merger') || h.includes('acquire') || h.includes('acquisition')) return 'M&A';
  return 'News';
}

app.get('/api/gappers', async (req, res) => {
  if (!FINVIZ_NEWS_TOKEN) {
    return res.status(500).json({ error: 'FINVIZ_NEWS_TOKEN not set in server environment' });
  }

  const limit = Math.min(Number(req.query.limit) || 60, 200);
  const filters = req.query.f || GAP_DEFAULT_FILTERS;
  const view = req.query.v || '111';
  const order = req.query.o || '-change'; // order by change to bring movers to top
  const includeNews = req.query.news === '1';

  let rows = [];
  try {
    let url = `https://elite.finviz.com/export.ashx?v=${view}&auth=${FINVIZ_NEWS_TOKEN}`;
    if (filters) url += `&f=${filters}`;
    if (order) url += `&o=${order}`;

    logger.info('Fetching Finviz gappers list', { filters, view, order });
    const cacheKey = `gappers:${view}:${filters}:${order}`;
    rows = await fetchFinvizCsv(url, cacheKey, 12000);
  } catch (err) {
    logger.error('Gappers Finviz fetch error', { error: err.message, stack: err.stack });
    return res.status(502).json({ error: 'Failed to fetch gappers list', detail: err.message });
  }

  const tickers = rows
    .map(r => (r.Ticker || r.ticker || r.Symbol || '').trim().toUpperCase())
    .filter(Boolean)
    .slice(0, limit);

  if (!tickers.length) return res.json({ gappers: [] });

  const FHKEY = process.env.FINNHUB_API_KEY;
  const gappers = [];

  for (let i = 0; i < tickers.length; i += GAP_BATCH_SIZE) {
    const batch = tickers.slice(i, i + GAP_BATCH_SIZE);
    const results = await Promise.allSettled(batch.map(async (ticker) => {
      const cached = yahooCacheGet(ticker, 'gappers-quote');
      if (cached) return { ticker, quote: cached };
      const quote = await yahooFinance.quote(ticker);
      yahooCacheSet(ticker, 'gappers-quote', quote);
      return { ticker, quote };
    }));

    for (const r of results) {
      if (r.status !== 'fulfilled' || !r.value?.quote) continue;
      const { ticker, quote } = r.value;
      const prevClose = quote.regularMarketPreviousClose ?? null;
      const pmPrice = quote.preMarketPrice ?? null;
      const pmChange = (pmPrice != null && prevClose != null) ? +(pmPrice - prevClose).toFixed(2) : quote.preMarketChange ?? null;
      const pmChangePercent = (pmPrice != null && prevClose != null && prevClose !== 0)
        ? +(((pmPrice - prevClose) / prevClose) * 100).toFixed(2)
        : (quote.preMarketChangePercent != null ? +Number(quote.preMarketChangePercent).toFixed(2) : null);
      const avgVol = quote.averageDailyVolume10Day || quote.averageDailyVolume3Month || null;
      const curVol = quote.regularMarketVolume || null;
      const rvol = (avgVol && curVol && avgVol > 0) ? +(curVol / avgVol).toFixed(2) : null;

      gappers.push({
        symbol: ticker,
        shortName: quote.shortName || '',
        price: quote.regularMarketPrice ?? null,
        prevClose,
        preMarketPrice: pmPrice,
        preMarketChange: pmChange,
        preMarketChangePercent: pmChangePercent,
        marketCap: quote.marketCap ?? null,
        floatShares: quote.floatShares ?? null,
        avgVolume: avgVol,
        volume: curVol,
        rvol,
        fiftyTwoWeekHigh: quote.fiftyTwoWeekHigh ?? null,
        twoHundredDayAverage: quote.twoHundredDayAverage ?? null,
        source: 'finviz'
      });
    }
  }

  // Optional headline enrichment for the top few names
  if (includeNews && FHKEY) {
    const newsTargets = gappers.slice(0, Math.min(10, gappers.length));
    const now = new Date();
    const from = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const to = now.toISOString().slice(0, 10);

    const newsResults = await Promise.allSettled(newsTargets.map(async (g) => {
      const url = `https://finnhub.io/api/v1/company-news?symbol=${g.symbol}&from=${from}&to=${to}&token=${FHKEY}`;
      const resp = await axios.get(url, { timeout: 8000 });
      const item = Array.isArray(resp.data) ? resp.data.find(n => n.headline) : null;
      return { sym: g.symbol, headline: item?.headline || null, datetime: item?.datetime || null };
    }));

    const newsMap = {};
    newsResults.forEach(r => {
      if (r.status === 'fulfilled' && r.value) newsMap[r.value.sym] = r.value;
    });

    gappers.forEach(g => {
      const n = newsMap[g.symbol];
      if (n?.headline) {
        g.headline = n.headline;
        g.headlineTime = n.datetime ? n.datetime * 1000 : null;
        g.catalyst = tagCatalyst(n.headline);
      }
    });
  }

  const sorted = gappers.sort((a, b) => {
    const ap = a.preMarketChangePercent;
    const bp = b.preMarketChangePercent;
    if (ap == null && bp == null) return 0;
    if (ap == null) return 1;
    if (bp == null) return -1;
    return bp - ap;
  }).slice(0, limit);

  res.json({ gappers: sorted });
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

app.use((err, req, res, next) => {
  logger.error('Unhandled server error', {
    method: req?.method,
    path: req?.originalUrl || req?.path,
    requestId: req?.requestId,
    error: err?.message,
    stack: err?.stack,
  });

  if (res.headersSent) return next(err);

  res.status(err?.status || 500).json({
    error: err?.code || 'INTERNAL_SERVER_ERROR',
    message: err?.message || 'Internal server error',
    requestId: req?.requestId,
  });
});

// Production: serve Vite/React frontend from client/dist
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(CLIENT_DIST));

  // Also serve legacy static assets (pages/, js/, and root CSS) so deep links and
  // older HTML pages don't lose styling/scripts in production.
  app.use('/js', express.static(path.join(__dirname, '..', 'js')));
  app.use('/pages', express.static(path.join(__dirname, '..', 'pages')));
  app.use('/logo pack', express.static(path.join(__dirname, '..', 'logo pack')));
  app.get('/styles.css', (req, res) => res.sendFile(path.join(__dirname, '..', 'styles.css')));

  app.get('*', (req, res) => {
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
}

// Start daily review cron
const { startDailyReviewCron } = require('./services/trades/dailyReviewCron');
startDailyReviewCron();

// Phase-aware scheduler (replaces the old fixed-interval startScheduler)
if (FMP_API_KEY) {
  // Resolve the scheduler user (whose active preset drives the engine).
  // Falls back to user ID from env, then first admin user in DB.
  const SCHEDULER_USER_ID = process.env.SCHEDULER_USER_ID
    ? Number(process.env.SCHEDULER_USER_ID)
    : null;

  (async () => {
    try {
      let schedulerUserId = SCHEDULER_USER_ID;
      if (!schedulerUserId) {
        const adminUser = await userModel.findByUsernameOrEmail(
          process.env.ADMIN_EMAIL || 'admin'
        ).catch(() => null);
        schedulerUserId = adminUser?.id || 1;
      }
      await startPhaseScheduler(FMP_API_KEY, schedulerUserId, logger);
    } catch (err) {
      logger.error('Phase scheduler failed to start', { error: err.message });
      // Fallback: old scheduler still available if needed
      startScheduler(FMP_API_KEY, logger);
    }
  })();
}

if (FMP_API_KEY) {
  startSchedulerService();
}

if (process.env.ENABLE_INGESTION_SCHEDULER !== 'false') {
  startIngestionScheduler();
}

if (process.env.ENABLE_METRICS_SCHEDULER !== 'false') {
  startMetricsScheduler();
}

if (process.env.ENABLE_STRATEGY_SCHEDULER !== 'false') {
  startStrategyScheduler();
}

if (process.env.ENABLE_CATALYST_SCHEDULER !== 'false') {
  startCatalystScheduler();
}

app.listen(PORT, () => {
  logger.info(`OpenRange server listening on port ${PORT}`);
  console.log('[Intelligence] Ingestion endpoint ready');

  (async () => {
    try {
      const [metricsHealth, ingestionHealth, universeHealth, queueHealth, setupHealth, catalystHealth] = await Promise.all([
        getMetricsHealth(),
        getIngestionHealth(),
        getUniverseHealth(),
        getQueueHealth(),
        getSetupHealth(),
        getCatalystHealth(),
      ]);

      logger.info('OpenRange System Status', {
        metricsRows: metricsHealth.rows,
        lastMetricsRun: metricsHealth.last_update,
        ingestionRows: ingestionHealth.tables,
        universeCount: universeHealth.total_symbols,
        queueSize: queueHealth.queue_size,
        setupCount: setupHealth.setup_count,
        catalystCount: catalystHealth.catalyst_count,
      });
    } catch (err) {
      logger.error('OpenRange System Status failed', { error: err.message });
    }
  })();
});
