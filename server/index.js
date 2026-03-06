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
const { runEnvCheck } = require('./utils/envCheck');
const { getCachedValue, setCachedValue } = require('./utils/responseCache');

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
const marketDataRoutes = require('./modules/marketData/marketDataRoutes');
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
const alertsRoutes = require('./routes/alerts');
const opportunitiesRoutes = require('./routes/opportunities');
const { fetchMarketNewsFallback } = require('./services/marketNewsFallback');
const { runIntelNewsWithFallback } = require('./services/intelNewsRunner');
const { generateRadarNarrative } = require('./services/RadarNarrativeEngine');
const { startSchedulerService } = require('./services/schedulerService.ts');
const { startIngestionScheduler } = require('./ingestion/scheduler');
const { startMetricsScheduler } = require('./metrics/metrics_scheduler');
const { startStrategyScheduler } = require('./strategy/strategy_scheduler');
const { startCatalystScheduler } = require('./catalyst/catalyst_scheduler');
const { startDiscoveryScheduler } = require('./discovery/discovery_scheduler');
const { startOpportunityStreamScheduler } = require('./opportunity/stream_scheduler');
const { startNarrativeScheduler } = require('./narrative/narrative_scheduler');
const { getMetricsHealth } = require('./monitoring/metricsHealth');
const { getIngestionHealth } = require('./monitoring/ingestionHealth');
const { getUniverseHealth } = require('./monitoring/universeHealth');
const { getQueueHealth } = require('./monitoring/queueHealth');
const { getSetupHealth } = require('./monitoring/setupHealth');
const { getCatalystHealth } = require('./monitoring/catalystHealth');
const { getDiscoveryHealth } = require('./monitoring/discoveryHealth');
const { getSystemHealth } = require('./monitoring/systemHealth');
const { startAlertScheduler } = require('./alerts/alert_scheduler');
const {
  startEngineScheduler,
  runIngestionNow,
  runMetricsNow,
  runUniverseBuilderNow,
  runStrategyEngineNow,
} = require('./engines/scheduler');
const { detectTrendForSymbol, ensureTrendTable } = require('./engines/trendDetectionEngine');
const { getFilterRegistry, getScoringRules } = require('./config/intelligenceConfig');
const intelligenceRoutes = require('./routes/intelligence');
const { pool, queryWithTimeout } = require('./db/pg');

function isDbTimeoutError(error) {
  const msg = String(error?.message || '').toLowerCase();
  return error?.code === 'QUERY_TIMEOUT' || msg.includes('timeout');
}

// Logger
const logger = require('./logger');

// User model for auth context
const userModel = require('./users/model');

// User management
const userRoutes = require('./users/routes');

runEnvCheck();

if (!process.env.FMP_API_KEY || process.env.FMP_API_KEY === 'REQUIRED') {
  logger.warn('FMP_API_KEY missing – ingestion disabled');
}

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

let personalizationTablesReady = false;

function getOptionalAuthUser(req) {
  if (req?.user?.id) return req.user;
  const token = req.get('Authorization')?.replace('Bearer ', '');
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (_error) {
    return null;
  }
}

async function ensurePersonalizationTables() {
  if (personalizationTablesReady) return;

  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      email TEXT UNIQUE,
      password_hash TEXT,
      plan TEXT DEFAULT 'free',
      created_at TIMESTAMPTZ DEFAULT now()
    )`,
    [],
    { timeoutMs: 6000, label: 'personalization.ensure.users', maxRetries: 0 }
  );

  await queryWithTimeout(
    `ALTER TABLE users
      ADD COLUMN IF NOT EXISTS password_hash TEXT,
      ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free',
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now()`,
    [],
    { timeoutMs: 6000, label: 'personalization.ensure.users.columns', maxRetries: 0 }
  );

  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS user_preferences (
      user_id BIGINT PRIMARY KEY,
      min_price NUMERIC,
      max_price NUMERIC,
      min_rvol NUMERIC,
      min_gap NUMERIC,
      preferred_sectors TEXT[] DEFAULT ARRAY[]::TEXT[],
      enabled_strategies TEXT[] DEFAULT ARRAY[]::TEXT[],
      updated_at TIMESTAMPTZ DEFAULT now()
    )`,
    [],
    { timeoutMs: 6000, label: 'personalization.ensure.preferences', maxRetries: 0 }
  );

  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS user_watchlists (
      user_id BIGINT NOT NULL,
      symbol TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (user_id, symbol)
    )`,
    [],
    { timeoutMs: 6000, label: 'personalization.ensure.watchlists', maxRetries: 0 }
  );

  await queryWithTimeout(
    `ALTER TABLE user_watchlists
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now()`,
    [],
    { timeoutMs: 6000, label: 'personalization.ensure.watchlists.columns', maxRetries: 0 }
  );

  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS user_signal_feedback (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL,
      signal_id TEXT NOT NULL,
      rating TEXT NOT NULL CHECK (rating IN ('good', 'bad', 'ignored')),
      created_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE (user_id, signal_id)
    )`,
    [],
    { timeoutMs: 6000, label: 'personalization.ensure.feedback', maxRetries: 0 }
  );

  await queryWithTimeout(
    `ALTER TABLE user_signal_feedback
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now()`,
    [],
    { timeoutMs: 6000, label: 'personalization.ensure.feedback.columns', maxRetries: 0 }
  );

  await queryWithTimeout(
    `CREATE INDEX IF NOT EXISTS idx_user_preferences_user_id ON user_preferences(user_id);
     CREATE INDEX IF NOT EXISTS idx_user_watchlists_user_id ON user_watchlists(user_id);
     CREATE INDEX IF NOT EXISTS idx_user_watchlists_symbol ON user_watchlists(symbol);
     CREATE INDEX IF NOT EXISTS idx_user_signal_feedback_user_id ON user_signal_feedback(user_id);
     CREATE INDEX IF NOT EXISTS idx_user_signal_feedback_signal_id ON user_signal_feedback(signal_id);`,
    [],
    { timeoutMs: 6000, label: 'personalization.ensure.indexes', maxRetries: 0 }
  );

  personalizationTablesReady = true;
}

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
  app.use('/api/market', marketDataRoutes);
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

app.get('/api/filters', (req, res) => {
  try {
    const registry = getFilterRegistry();
    res.json(registry);
  } catch (err) {
    logger.error('filters registry endpoint error', { error: err.message });
    res.json({ filters: [] });
  }
});

app.get('/api/scoring-rules', (req, res) => {
  try {
    const rules = getScoringRules();
    res.json(rules);
  } catch (err) {
    logger.error('scoring rules endpoint error', { error: err.message });
    res.json({ strategy: {}, grading: {}, catalyst_scores: {} });
  }
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
    res.json({
      system: 'openrange',
      status: 'degraded',
      error: err.message,
      checked_at: new Date().toISOString(),
    });
  }
});

app.get('/api/system/report', async (req, res) => {
  const requiredTables = [
    'daily_ohlc',
    'intraday_1m',
    'market_metrics',
    'trade_setups',
    'trade_catalysts',
    'opportunity_stream',
    'market_narratives',
    'ticker_universe',
  ];

  try {
    const tablesResult = await queryWithTimeout(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public'",
      [],
      { label: 'system.report.table_scan', timeoutMs: 5000 }
    );

    const availableTables = new Set(tablesResult.rows.map((row) => row.table_name));
    const missingTables = requiredTables.filter((tableName) => !availableTables.has(tableName));

    const countTargets = [
      ['market_metrics', 'metrics_rows'],
      ['trade_setups', 'setups_count'],
      ['trade_catalysts', 'catalysts_count'],
      ['ticker_universe', 'ticker_universe_size'],
      ['symbol_queue', 'queue_size'],
      ['opportunity_stream', 'opportunity_stream_count'],
      ['market_narratives', 'narrative_count'],
    ];

    const counts = {};
    const queryErrors = [];

    await Promise.all(countTargets.map(async ([tableName, outputKey]) => {
      if (!availableTables.has(tableName)) {
        counts[outputKey] = null;
        return;
      }
      try {
        const countResult = await queryWithTimeout(
          `SELECT COUNT(*)::int AS count FROM ${tableName}`,
          [],
          { label: `system.report.count.${tableName}`, timeoutMs: 5000 }
        );
        counts[outputKey] = countResult.rows[0]?.count ?? 0;
      } catch (error) {
        counts[outputKey] = null;
        queryErrors.push({ table: tableName, detail: error.message });
      }
    }));

    const degraded = missingTables.length > 0 || queryErrors.length > 0;

    res.json({
      status: degraded ? 'degraded' : 'ok',
      missing_tables: missingTables,
      query_errors: queryErrors,
      ...counts,
      checked_at: new Date().toISOString(),
    });
  } catch (err) {
    logger.error('system report endpoint error', { error: err.message });
    res.json({
      status: 'degraded',
      missing_tables: requiredTables,
      detail: err.message,
      checked_at: new Date().toISOString(),
    });
  }
});

async function fastRowsQuery(sql, params, label, timeoutMs = 180) {
  try {
    const { rows } = await queryWithTimeout(sql, params, {
      timeoutMs,
      maxRetries: 0,
      slowQueryMs: 120,
      label,
    });
    return rows;
  } catch (error) {
    logger.warn('Fast endpoint fallback', { label, error: error.message });
    return [];
  }
}

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
              u.industry,
              m.price,
              m.gap_percent,
              m.relative_volume,
              m.atr,
              m.float_rotation,
              s.setup,
              s.grade,
              s.score AS setup_score
       FROM market_metrics m
       JOIN ticker_universe u
         ON m.symbol = u.symbol
       JOIN trade_setups s
         ON m.symbol = s.symbol
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
      `SELECT m.*,
              d.source,
              d.score AS discovery_score
       FROM discovered_symbols d
       JOIN market_metrics m
         ON d.symbol = m.symbol
       WHERE m.gap_percent > 3
         AND m.relative_volume > 2
       ORDER BY m.gap_percent DESC
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

app.get('/api/pre-market/bias', async (req, res) => {
  const rows = await fastRowsQuery(
    `SELECT symbol, price, change_percent, updated_at
     FROM market_quotes
     WHERE symbol IN ('SPY', 'QQQ')`,
    [],
    'api.pre_market.bias',
    180
  );

  const spy = rows.find((row) => row.symbol === 'SPY');
  const qqq = rows.find((row) => row.symbol === 'QQQ');
  const spyChange = Number(spy?.change_percent || 0);
  const qqqChange = Number(qqq?.change_percent || 0);

  let bias = 'neutral';
  if (spyChange > 0 && qqqChange > 0) bias = 'bullish';
  if (spyChange < 0 && qqqChange < 0) bias = 'bearish';

  const drivers = [];
  if (spy) drivers.push(`SPY change ${spyChange.toFixed(2)}%`);
  if (qqq) drivers.push(`QQQ change ${qqqChange.toFixed(2)}%`);

  return res.json({ bias, drivers });
});

app.get('/api/pre-market/gap-leaders', async (req, res) => {
  const leaders = await fastRowsQuery(
    `SELECT symbol,
            gap_percent,
            volume,
            updated_at
     FROM market_metrics
     ORDER BY gap_percent DESC NULLS LAST
     LIMIT 10`,
    [],
    'api.pre_market.gap_leaders',
    180
  );

  return res.json({ leaders });
});

app.get('/api/pre-market/catalysts', async (req, res) => {
  const catalysts = await fastRowsQuery(
    `SELECT id,
            subject,
            sender AS "from",
            source_tag,
            received_at,
            LEFT(raw_text, 220) AS summary
     FROM intelligence_emails
     ORDER BY received_at DESC
     LIMIT 10`,
    [],
    'api.pre_market.catalysts',
    180
  );

  return res.json({ catalysts });
});

function computeRegime(indexCards, sectorLeaders) {
  const bySymbol = new Map((Array.isArray(indexCards) ? indexCards : []).map((row) => [String(row?.symbol || '').toUpperCase(), row]));
  const spy = bySymbol.get('SPY') || {};
  const qqq = bySymbol.get('QQQ') || {};
  const vix = bySymbol.get('VIX') || {};

  const spyChange = Number(spy?.change_percent ?? 0);
  const qqqChange = Number(qqq?.change_percent ?? 0);
  const vixChange = Number(vix?.change_percent ?? 0);
  const spyVsVwap = Number(spy?.vwap_delta_percent ?? 0);
  const topSectorStrength = Number(sectorLeaders?.[0]?.avg_change_percent ?? 0);

  if (spyChange > 0 && qqqChange > 0 && vixChange <= 0 && spyVsVwap >= 0 && topSectorStrength > 0) {
    return 'Bullish';
  }

  if (spyChange < 0 && qqqChange < 0 && (vixChange > 0 || spyVsVwap < 0)) {
    return 'Risk Off';
  }

  return 'Neutral';
}

function buildSparklineFromChange(price, changePercent) {
  const p = Number(price);
  const c = Number(changePercent);
  const base = Number.isFinite(p) && p > 0 ? p : 100;
  const delta = Number.isFinite(c) ? (base * c) / 100 : 0;
  const start = base - delta;
  return [
    start,
    start + (delta * 0.2),
    start + (delta * 0.35),
    start + (delta * 0.55),
    start + (delta * 0.75),
    start + (delta * 0.9),
    base,
  ].map((value) => Number(value.toFixed(4)));
}

app.get('/api/premarket/summary', async (req, res) => {
  const cacheKey = 'api.premarket.summary';
  const cacheTtlMs = 30_000;
  const nowMs = Date.now();
  const cached = getCachedValue(cacheKey);

  if (cached && (nowMs - new Date(cached.generated_at || 0).getTime()) <= cacheTtlMs) {
    return res.json(cached);
  }

  const warnings = [];
  const safeRows = async (label, sql, params, timeoutMs = 1200) => {
    try {
      const { rows } = await queryWithTimeout(sql, params, { label, timeoutMs, maxRetries: 0, retryDelayMs: 100 });
      return rows;
    } catch (error) {
      warnings.push(`${label}: ${error.message || 'query failed'}`);
      return [];
    }
  };

  const [indexRows, sectorRows, gapRows, setupRows, catalystRows, earningsRows, surgeRows] = await Promise.all([
    safeRows(
      'api.premarket.summary.index_cards',
      `SELECT
        q.symbol,
        q.price,
        q.change_percent,
        m.vwap,
        CASE
          WHEN m.vwap IS NOT NULL AND m.vwap <> 0 AND q.price IS NOT NULL
            THEN ((q.price - m.vwap) / NULLIF(m.vwap, 0)) * 100
          ELSE NULL
        END AS vwap_delta_percent
       FROM market_quotes q
       LEFT JOIN market_metrics m ON m.symbol = q.symbol
       WHERE q.symbol = ANY($1::text[])
       ORDER BY array_position($1::text[], q.symbol)`,
      [['SPY', 'QQQ', 'IWM', 'VIX']]
    ),
    safeRows(
      'api.premarket.summary.sector_strength',
      `SELECT
        COALESCE(NULLIF(TRIM(sector), ''), 'Unknown') AS sector,
        AVG(COALESCE(change_percent, 0)) AS avg_change_percent
       FROM market_quotes
       WHERE sector IS NOT NULL
       GROUP BY COALESCE(NULLIF(TRIM(sector), ''), 'Unknown')
       ORDER BY AVG(COALESCE(change_percent, 0)) DESC
       LIMIT 3`,
      []
    ),
    safeRows(
      'api.premarket.summary.gap_leaders',
      `SELECT
        m.symbol,
        COALESCE(m.gap_percent, 0) AS gap_percent,
        COALESCE(m.relative_volume, 0) AS relative_volume,
        COALESCE(m.float_shares, m.float_rotation, 0) AS float,
        COALESCE(c.headline, 'No catalyst available') AS catalyst
       FROM market_metrics m
       LEFT JOIN LATERAL (
         SELECT headline
         FROM trade_catalysts tc
         WHERE tc.symbol = m.symbol
         ORDER BY tc.published_at DESC NULLS LAST
         LIMIT 1
       ) c ON TRUE
       WHERE COALESCE(m.gap_percent, 0) > 3
         AND COALESCE(m.relative_volume, 0) > 2
       ORDER BY COALESCE(m.gap_percent, 0) DESC NULLS LAST
       LIMIT 24`,
      []
    ),
    safeRows(
      'api.premarket.summary.top_setups',
      `SELECT
        s.symbol,
        COALESCE(NULLIF(s.strategy, ''), 'Momentum Continuation') AS setup_type,
        COALESCE(s.score, 0) AS strategy_score,
        COALESCE(s.relative_volume, m.relative_volume, 0) AS relative_volume,
        COALESCE(s.gap_percent, m.gap_percent, 0) AS gap_percent,
        COALESCE(m.previous_high, NULL) AS previous_high,
        COALESCE(m.vwap, NULL) AS vwap
       FROM strategy_signals s
       LEFT JOIN market_metrics m ON m.symbol = s.symbol
       ORDER BY COALESCE(s.score, 0) DESC NULLS LAST, COALESCE(s.relative_volume, m.relative_volume, 0) DESC NULLS LAST
       LIMIT 18`,
      []
    ),
    safeRows(
      'api.premarket.summary.catalysts',
      `SELECT
        symbol,
        COALESCE(catalyst_type, 'General') AS catalyst_type,
        headline,
        sentiment,
        source,
        published_at
       FROM trade_catalysts
       ORDER BY published_at DESC NULLS LAST
       LIMIT 24`,
      []
    ),
    safeRows(
      'api.premarket.summary.earnings',
      `SELECT
        symbol,
        company,
        earnings_date::text AS earnings_date,
        eps_estimate,
        revenue_estimate
       FROM earnings_events
       WHERE earnings_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '1 day'
       ORDER BY earnings_date ASC, symbol ASC
       LIMIT 30`,
      []
    ),
    safeRows(
      'api.premarket.summary.volume_surges',
      `SELECT
        symbol,
        COALESCE(relative_volume, 0) AS relative_volume,
        COALESCE(volume, 0) AS volume,
        COALESCE(gap_percent, 0) AS gap_percent,
        COALESCE(change_percent, 0) AS change_percent
       FROM market_metrics
       WHERE COALESCE(relative_volume, 0) > 2
       ORDER BY COALESCE(relative_volume, 0) DESC NULLS LAST
       LIMIT 20`,
      []
    ),
  ]);

  const indexCards = indexRows.map((row) => ({
    symbol: String(row?.symbol || '').toUpperCase(),
    price: Number(row?.price ?? 0),
    change_percent: Number(row?.change_percent ?? 0),
    vwap_delta_percent: row?.vwap_delta_percent == null ? null : Number(row.vwap_delta_percent),
    sparkline: buildSparklineFromChange(row?.price, row?.change_percent),
  }));

  const marketRegime = computeRegime(indexCards, sectorRows);
  const topSector = sectorRows?.[0];
  const spyCard = indexCards.find((row) => row.symbol === 'SPY');
  const vixCard = indexCards.find((row) => row.symbol === 'VIX');
  const marketContext = {
    regime: marketRegime,
    drivers: [
      {
        label: 'SPY vs VWAP',
        value: spyCard?.vwap_delta_percent == null
          ? 'Unavailable'
          : `${spyCard.vwap_delta_percent >= 0 ? '+' : ''}${spyCard.vwap_delta_percent.toFixed(2)}%`,
      },
      {
        label: 'Sector strength',
        value: topSector
          ? `${topSector.sector} ${Number(topSector.avg_change_percent || 0).toFixed(2)}%`
          : 'Unavailable',
      },
      {
        label: 'VIX trend',
        value: vixCard ? `${Number(vixCard.change_percent || 0).toFixed(2)}%` : 'Unavailable',
      },
    ],
  };

  const topSetups = setupRows.map((row) => ({
    symbol: String(row?.symbol || '').toUpperCase(),
    setup_type: row?.setup_type || 'Momentum Continuation',
    strategy_score: Number(row?.strategy_score ?? 0),
    relative_volume: Number(row?.relative_volume ?? 0),
    gap_percent: Number(row?.gap_percent ?? 0),
    trade_idea: Number(row?.previous_high) > 0
      ? `ORB breakout above ${Number(row.previous_high).toFixed(2)}`
      : 'VWAP reclaim entry after first pullback',
  }));

  const payload = {
    success: true,
    degraded: warnings.length > 0,
    generated_at: new Date().toISOString(),
    market_context: marketContext,
    index_cards: indexCards,
    gap_leaders: gapRows,
    top_setups: topSetups,
    catalysts: catalystRows,
    earnings: earningsRows,
    volume_surges: surgeRows,
    warnings,
  };

  setCachedValue(cacheKey, payload);
  return res.json(payload);
});

app.get('/api/radar/summary', async (req, res) => {
  const cacheKey = 'api.radar.summary';
  const cacheTtlMs = 20_000;
  const cached = getCachedValue(cacheKey);

  if (cached && (Date.now() - new Date(cached.generated_at || 0).getTime()) <= cacheTtlMs) {
    return res.json(cached);
  }

  const warnings = [];
  const safeRows = async (label, sql, params, timeoutMs = 1200) => {
    try {
      const { rows } = await queryWithTimeout(sql, params, { label, timeoutMs, maxRetries: 0, retryDelayMs: 100 });
      return rows;
    } catch (error) {
      warnings.push(`${label}: ${error.message || 'query failed'}`);
      return [];
    }
  };

  const [indicesRows, momentumRows, signalRows, volumeRows, catalystRows, opportunityRows, sectorRows, newsRows] = await Promise.all([
    safeRows(
      'api.radar.summary.index_cards',
      `SELECT
        q.symbol,
        q.price,
        q.change_percent,
        q.sector,
        q.market_cap,
        COALESCE(m.relative_volume, 0) AS relative_volume,
        COALESCE(m.gap_percent, 0) AS gap_percent
       FROM market_quotes q
       LEFT JOIN market_metrics m ON m.symbol = q.symbol
       WHERE q.symbol = ANY($1::text[])
       ORDER BY array_position($1::text[], q.symbol)`,
      [['SPY', 'QQQ', 'IWM', 'VIX', 'DXY', '10Y', 'TNX', '^TNX']]
    ),
    safeRows(
      'api.radar.summary.momentum_leaders',
      `SELECT
        m.symbol,
        COALESCE(m.price, q.price) AS price,
        COALESCE(m.gap_percent, 0) AS gap_percent,
        COALESCE(m.relative_volume, 0) AS relative_volume,
        COALESCE(s.score, 0) AS strategy_score,
        COALESCE(m.change_percent, q.change_percent, 0) AS change_percent,
        q.market_cap,
        q.sector
       FROM market_metrics m
       LEFT JOIN strategy_signals s ON s.symbol = m.symbol
       LEFT JOIN market_quotes q ON q.symbol = m.symbol
       ORDER BY COALESCE(m.relative_volume, 0) DESC NULLS LAST, ABS(COALESCE(m.gap_percent, 0)) DESC NULLS LAST
       LIMIT 30`,
      []
    ),
    safeRows(
      'api.radar.summary.strategy_signals',
      `SELECT
        s.symbol,
        COALESCE(NULLIF(s.strategy, ''), 'Momentum Continuation') AS strategy,
        COALESCE(s.score, 0) AS score,
        COALESCE(s.gap_percent, m.gap_percent, 0) AS gap_percent,
        COALESCE(s.relative_volume, m.relative_volume, 0) AS relative_volume,
        COALESCE(s.change_percent, m.change_percent, q.change_percent, 0) AS change_percent,
        COALESCE(c.headline, '') AS catalyst_headline
      FROM strategy_signals s
      LEFT JOIN market_metrics m ON m.symbol = s.symbol
      LEFT JOIN market_quotes q ON q.symbol = s.symbol
      LEFT JOIN LATERAL (
        SELECT headline
        FROM trade_catalysts tc
        WHERE tc.symbol = s.symbol
        ORDER BY tc.published_at DESC NULLS LAST
        LIMIT 1
      ) c ON TRUE
      ORDER BY COALESCE(s.score, 0) DESC NULLS LAST
      LIMIT 40`,
      []
    ),
    safeRows(
      'api.radar.summary.volume_surges',
      `SELECT
        m.symbol,
        COALESCE(m.relative_volume, 0) AS relative_volume,
        COALESCE(m.volume, q.volume, 0) AS volume,
        COALESCE(m.gap_percent, 0) AS gap_percent,
        COALESCE(m.change_percent, q.change_percent, 0) AS change_percent,
        q.sector,
        q.market_cap
      FROM market_metrics m
      LEFT JOIN market_quotes q ON q.symbol = m.symbol
      WHERE COALESCE(m.relative_volume, 0) > 1.5
      ORDER BY COALESCE(m.relative_volume, 0) DESC NULLS LAST
      LIMIT 30`,
      []
    ),
    safeRows(
      'api.radar.summary.catalyst_alerts',
      `SELECT symbol, catalyst_type, headline, source, sentiment, published_at
       FROM trade_catalysts
       ORDER BY published_at DESC NULLS LAST
       LIMIT 25`,
      []
    ),
    safeRows(
      'api.radar.summary.opportunity_stream',
      `SELECT
        s.symbol,
        COALESCE(s.score, 0) AS score,
        COALESCE(s.gap_percent, m.gap_percent, 0) AS gap,
        COALESCE(s.relative_volume, m.relative_volume, 0) AS rvol,
        COALESCE(s.volume, m.volume, q.volume, 0) AS volume,
        COALESCE(s.strategy, 'Momentum Continuation') AS strategy,
        COALESCE(c.headline, 'No catalyst') AS catalyst,
        q.sector,
        q.market_cap
      FROM strategy_signals s
      LEFT JOIN market_metrics m ON m.symbol = s.symbol
      LEFT JOIN market_quotes q ON q.symbol = s.symbol
      LEFT JOIN LATERAL (
        SELECT headline
        FROM trade_catalysts tc
        WHERE tc.symbol = s.symbol
        ORDER BY tc.published_at DESC NULLS LAST
        LIMIT 1
      ) c ON TRUE
      ORDER BY COALESCE(s.score, 0) DESC NULLS LAST
      LIMIT 25`,
      []
    ),
    safeRows(
      'api.radar.summary.sector_movers',
      `SELECT
        s.sector,
        s.market_cap,
        s.volume,
        s.relative_volume,
        s.price_change,
        s.tickers
      FROM (
        WITH base AS (
          SELECT
            COALESCE(q.sector, 'Unknown') AS sector,
            m.symbol,
            COALESCE(q.market_cap, 0) AS market_cap,
            COALESCE(m.volume, q.volume, 0) AS volume,
            COALESCE(m.relative_volume, 0) AS relative_volume,
            COALESCE(m.change_percent, q.change_percent, 0) AS price_change
          FROM market_metrics m
          LEFT JOIN market_quotes q ON q.symbol = m.symbol
        ),
        sector_agg AS (
          SELECT
            sector,
            SUM(market_cap)::numeric AS market_cap,
            SUM(volume)::bigint AS volume,
            AVG(relative_volume)::numeric AS relative_volume,
            AVG(price_change)::numeric AS price_change
          FROM base
          GROUP BY sector
        ),
        ticker_ranked AS (
          SELECT
            b.*,
            ROW_NUMBER() OVER (PARTITION BY b.sector ORDER BY COALESCE(b.volume, 0) DESC NULLS LAST) AS rank_in_sector
          FROM base b
        )
        SELECT
          sa.sector,
          sa.market_cap,
          sa.volume,
          sa.relative_volume,
          sa.price_change,
          COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'symbol', tr.symbol,
                'market_cap', tr.market_cap,
                'volume', tr.volume,
                'relative_volume', tr.relative_volume,
                'price_change', tr.price_change
              ) ORDER BY tr.volume DESC NULLS LAST
            ) FILTER (WHERE tr.rank_in_sector <= 15),
            '[]'::jsonb
          ) AS tickers
        FROM sector_agg sa
        LEFT JOIN ticker_ranked tr ON tr.sector = sa.sector
        GROUP BY sa.sector, sa.market_cap, sa.volume, sa.relative_volume, sa.price_change
      ) s
      ORDER BY s.market_cap DESC NULLS LAST
      LIMIT 12`,
      []
    ),
    safeRows(
      'api.radar.summary.news',
      `SELECT symbol, headline, source, sentiment, published_at
       FROM intel_news
       ORDER BY published_at DESC NULLS LAST
       LIMIT 30`,
      []
    ),
  ]);

  const requestedSymbols = ['SPY', 'QQQ', 'IWM', 'VIX', 'DXY', 'US10Y'];
  const indexMap = new Map(indicesRows.map((row) => [String(row?.symbol || '').toUpperCase(), row]));
  const normalizedIndices = requestedSymbols.map((symbol) => {
    const row = symbol === 'US10Y'
      ? indexMap.get('10Y') || indexMap.get('TNX') || indexMap.get('^TNX')
      : indexMap.get(symbol);

    const change = Number(row?.change_percent ?? 0);
    const price = Number(row?.price ?? 0);
    const base = price > 0 ? price - ((price * change) / 100) : 100;
    const sparkline = [
      base,
      base + ((price - base) * 0.2),
      base + ((price - base) * 0.35),
      base + ((price - base) * 0.55),
      base + ((price - base) * 0.75),
      price || base,
    ];

    return {
      symbol,
      price,
      change_percent: change,
      sparkline,
      sector_influence: row?.sector || 'Macro Index',
      etf_composition: symbol === 'SPY' ? 'S&P 500 mega-cap blend' : symbol === 'QQQ' ? 'Nasdaq 100 growth-heavy' : symbol,
      key_drivers: opportunityRows.slice(0, 3).map((item) => ({
        symbol: String(item?.symbol || '').toUpperCase(),
        move: Number(item?.gap ?? item?.rvol ?? 0),
      })),
    };
  });

  const byStrategy = new Map();
  for (const row of signalRows) {
    const strategy = String(row?.strategy || 'Momentum Continuation');
    const current = byStrategy.get(strategy) || { wins: 0, total: 0, moveSum: 0, failures: 0 };
    const move = Number(row?.change_percent || 0);
    current.total += 1;
    current.moveSum += Math.abs(move);
    if (move >= 0) current.wins += 1;
    if (move < 0) current.failures += 1;
    byStrategy.set(strategy, current);
  }

  const strategySignals = signalRows.map((row) => {
    const rvol = Number(row?.relative_volume || 0);
    const gap = Math.abs(Number(row?.gap_percent || 0));
    const strategy = String(row?.strategy || 'Momentum Continuation');
    const stats = byStrategy.get(strategy) || { wins: 0, total: 0, moveSum: 0, failures: 0 };
    const total = Math.max(1, stats.total);

    return {
      ...row,
      score_breakdown: {
        volume_weight: Math.min(40, Math.round(rvol * 12)),
        gap_weight: Math.min(25, Math.round(gap * 3)),
        catalyst_weight: row?.catalyst_headline ? 19 : 8,
        trend_weight: Math.min(15, Math.max(0, Math.round((Number(row?.change_percent || 0) + 2) * 3))),
      },
      accuracy: {
        win_rate: Number(((stats.wins / total) * 100).toFixed(1)),
        average_move: Number((stats.moveSum / total).toFixed(2)),
        failure_rate: Number(((stats.failures / total) * 100).toFixed(1)),
      },
    };
  });

  const momentumLeaders = momentumRows.map((row) => {
    const strategy = String(row?.strategy || 'Momentum Continuation');
    const stats = byStrategy.get(strategy) || { wins: 0, total: 0, moveSum: 0, failures: 0 };
    const total = Math.max(1, stats.total);
    const rvol = Number(row?.relative_volume || 0);
    const gap = Math.abs(Number(row?.gap_percent || 0));

    return {
      ...row,
      score_breakdown: {
        volume_weight: Math.min(40, Math.round(rvol * 12)),
        gap_weight: Math.min(25, Math.round(gap * 3)),
        catalyst_weight: row?.catalyst ? 19 : 8,
        trend_weight: Math.min(15, Math.max(0, Math.round((Number(row?.change_percent || 0) + 2) * 3))),
      },
      accuracy: {
        win_rate: Number(((stats.wins / total) * 100).toFixed(1)),
        average_move: Number((stats.moveSum / total).toFixed(2)),
        failure_rate: Number(((stats.failures / total) * 100).toFixed(1)),
      },
    };
  });

  const narrative = await generateRadarNarrative({
    indexCards: normalizedIndices,
    sectorMovers: sectorRows,
    newsItems: newsRows,
  }, {
    apiKey: PPLX_API_KEY,
    model: PPLX_MODEL,
  });

  const payload = {
    success: true,
    degraded: warnings.length > 0,
    generated_at: new Date().toISOString(),
    index_cards: normalizedIndices,
    market_narrative: narrative,
    momentum_leaders: momentumLeaders,
    strategy_signals: strategySignals,
    volume_surges: volumeRows,
    catalyst_alerts: catalystRows,
    opportunity_stream: opportunityRows,
    sector_movers: sectorRows,
    warnings,
  };

  setCachedValue(cacheKey, payload);
  return res.json(payload);
});

app.get('/api/earnings/today', async (req, res) => {
  try {
    await queryWithTimeout(
      `CREATE TABLE IF NOT EXISTS earnings_events (
        symbol TEXT,
        company TEXT,
        earnings_date DATE,
        eps_estimate NUMERIC,
        revenue_estimate NUMERIC,
        sector TEXT,
        updated_at TIMESTAMPTZ DEFAULT now()
      )`,
      [],
      { timeoutMs: 5000, label: 'api.earnings.ensure_table', maxRetries: 0 }
    );

    await queryWithTimeout(
      `ALTER TABLE earnings_events
        ADD COLUMN IF NOT EXISTS sector TEXT`,
      [],
      { timeoutMs: 5000, label: 'api.earnings.ensure_sector', maxRetries: 0 }
    );

    const { rows } = await queryWithTimeout(
      `SELECT symbol,
              earnings_date::text AS date,
              company,
              eps_estimate,
              revenue_estimate,
              sector,
              updated_at
       FROM earnings_events
       WHERE earnings_date = CURRENT_DATE
       ORDER BY symbol ASC
       LIMIT 200`,
      [],
      {
        timeoutMs: 1200,
        maxRetries: 0,
        slowQueryMs: 120,
        label: 'api.earnings.today',
      }
    );
    return res.json({ earnings: rows });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Failed to load earnings today' });
  }
});

app.get('/api/earnings/week', async (req, res) => {
  try {
    await queryWithTimeout(
      `CREATE TABLE IF NOT EXISTS earnings_events (
        symbol TEXT,
        company TEXT,
        earnings_date DATE,
        eps_estimate NUMERIC,
        revenue_estimate NUMERIC,
        sector TEXT,
        updated_at TIMESTAMPTZ DEFAULT now()
      )`,
      [],
      { timeoutMs: 5000, label: 'api.earnings.ensure_table.week', maxRetries: 0 }
    );

    await queryWithTimeout(
      `ALTER TABLE earnings_events
        ADD COLUMN IF NOT EXISTS sector TEXT`,
      [],
      { timeoutMs: 5000, label: 'api.earnings.ensure_sector.week', maxRetries: 0 }
    );

    const { rows } = await queryWithTimeout(
      `SELECT symbol,
              company,
              earnings_date::text AS date,
              eps_estimate,
              revenue_estimate,
              sector,
              updated_at
       FROM earnings_events
       WHERE earnings_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
       ORDER BY earnings_date ASC, symbol ASC
       LIMIT 1000`,
      [],
      {
        timeoutMs: 500,
        maxRetries: 0,
        slowQueryMs: 120,
        label: 'api.earnings.week',
      }
    );
    return res.json({ earnings: rows });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Failed to load earnings week' });
  }
});

app.get('/api/signals', async (req, res) => {
  try {
    await ensurePersonalizationTables();

    const user = getOptionalAuthUser(req);
    const userId = Number(user?.id);
    const hasUser = Number.isFinite(userId) && userId > 0;

    let preferences = null;
    if (hasUser) {
      const prefResult = await queryWithTimeout(
        `SELECT
            user_id,
            min_price,
            max_price,
            min_rvol,
            min_gap,
            preferred_sectors,
            enabled_strategies
         FROM user_preferences
         WHERE user_id = $1
         LIMIT 1`,
        [userId],
        { label: 'api.signals.preferences', timeoutMs: 1000, maxRetries: 0 }
      );
      preferences = prefResult.rows[0] || null;
    }

    const where = [];
    const params = [];
    const addCondition = (sql, value) => {
      params.push(value);
      where.push(sql.replace('?', `$${params.length}`));
    };

    if (preferences) {
      if (preferences.min_price != null) addCondition('COALESCE(q.price, 0) >= ?', preferences.min_price);
      if (preferences.max_price != null) addCondition('COALESCE(q.price, 0) <= ?', preferences.max_price);
      if (preferences.min_rvol != null) addCondition('COALESCE(s.relative_volume, 0) >= ?', preferences.min_rvol);
      if (preferences.min_gap != null) addCondition('ABS(COALESCE(s.gap_percent, 0)) >= ?', preferences.min_gap);

      if (Array.isArray(preferences.preferred_sectors) && preferences.preferred_sectors.length > 0) {
        addCondition('LOWER(COALESCE(q.sector, \'\')) = ANY(?::text[])', preferences.preferred_sectors.map((sector) => String(sector || '').toLowerCase()));
      }

      if (Array.isArray(preferences.enabled_strategies) && preferences.enabled_strategies.length > 0) {
        addCondition('COALESCE(s.strategy, \'\') = ANY(?::text[])', preferences.enabled_strategies.map((strategy) => String(strategy || '')));
      }
    }

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const { rows } = await queryWithTimeout(
      `SELECT
          s.symbol,
          s.strategy,
          s.class,
          s.score,
          s.probability,
          s.change_percent,
          s.gap_percent,
          s.relative_volume,
          s.volume,
          q.sector,
          s.updated_at,
          s.updated_at AS timestamp
       FROM strategy_signals s
       LEFT JOIN market_quotes q ON q.symbol = s.symbol
       ${whereClause}
       ORDER BY s.score DESC NULLS LAST
       LIMIT 50`,
      params,
      { label: 'api.signals', timeoutMs: 1800, maxRetries: 1, retryDelayMs: 120 }
    );

    return res.json({
      signals: rows,
      personalized: Boolean(preferences),
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Failed to load signals' });
  }
});

app.get('/api/signals/:symbol', async (req, res) => {
  try {
    const symbol = String(req.params.symbol || '').trim().toUpperCase();
    if (!symbol) return res.status(400).json({ success: false, error: 'symbol is required' });

    const { rows } = await queryWithTimeout(
      `SELECT
        s.symbol,
        s.strategy,
        s.score,
        s.class,
        s.gap_percent,
        s.relative_volume,
        q.sector,
        COALESCE(n.headline, e.subject, 'No catalyst available') AS catalyst
       FROM strategy_signals s
       LEFT JOIN market_quotes q ON q.symbol = s.symbol
       LEFT JOIN LATERAL (
         SELECT headline
         FROM intel_news i
         WHERE i.symbol = s.symbol
         ORDER BY i.published_at DESC NULLS LAST
         LIMIT 1
       ) n ON TRUE
       LEFT JOIN LATERAL (
         SELECT subject
         FROM intelligence_emails ie
         WHERE ie.subject ILIKE ('%' || s.symbol || '%')
         ORDER BY ie.received_at DESC NULLS LAST
         LIMIT 1
       ) e ON TRUE
       WHERE s.symbol = $1
       LIMIT 1`,
      [symbol],
      { label: 'api.signals.symbol', timeoutMs: 1200, maxRetries: 1, retryDelayMs: 150 }
    );

    if (!rows.length) return res.status(404).json({ success: false, error: `No signal found for ${symbol}` });
    return res.json(rows[0]);
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Failed to load signal explanation' });
  }
});

app.get('/api/watchlist/signals', authMiddleware, async (req, res) => {
  try {
    await ensurePersonalizationTables();

    const userId = Number(req.user?.id);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(401).json({ success: false, error: 'Invalid user context' });
    }

    const { rows } = await queryWithTimeout(
      `SELECT
         s.symbol,
         s.strategy,
         s.class,
         s.score,
         s.probability,
         s.change_percent,
         s.gap_percent,
         s.relative_volume,
         s.volume,
         q.sector,
         s.updated_at,
         s.updated_at AS timestamp
       FROM user_watchlists w
       JOIN strategy_signals s ON s.symbol = w.symbol
       LEFT JOIN market_quotes q ON q.symbol = s.symbol
       WHERE w.user_id = $1
       ORDER BY s.score DESC NULLS LAST
       LIMIT 200`,
      [userId],
      { label: 'api.watchlist.signals', timeoutMs: 2000, maxRetries: 1, retryDelayMs: 120 }
    );

    return res.json({ success: true, signals: rows });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Failed to load watchlist signals' });
  }
});

app.post('/api/signals/feedback', authMiddleware, async (req, res) => {
  try {
    await ensurePersonalizationTables();

    const userId = Number(req.user?.id);
    const signalId = String(req.body?.signal_id || '').trim();
    const rating = String(req.body?.rating || '').trim().toLowerCase();

    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(401).json({ success: false, error: 'Invalid user context' });
    }
    if (!signalId) {
      return res.status(400).json({ success: false, error: 'signal_id is required' });
    }
    if (!['good', 'bad', 'ignored'].includes(rating)) {
      return res.status(400).json({ success: false, error: 'rating must be one of: good, bad, ignored' });
    }

    await queryWithTimeout(
      `INSERT INTO user_signal_feedback (user_id, signal_id, rating, created_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (user_id, signal_id)
       DO UPDATE SET
         rating = EXCLUDED.rating,
         created_at = now()`,
      [userId, signalId.toUpperCase(), rating],
      { label: 'api.signals.feedback', timeoutMs: 2000, maxRetries: 1, retryDelayMs: 120 }
    );

    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Failed to save feedback' });
  }
});

app.get('/api/user/performance', authMiddleware, async (req, res) => {
  try {
    await ensurePersonalizationTables();

    const userId = Number(req.user?.id);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(401).json({ success: false, error: 'Invalid user context' });
    }

    const totals = await queryWithTimeout(
      `SELECT
          COUNT(*)::int AS signals_taken,
          COUNT(*) FILTER (WHERE rating = 'good')::int AS good_count,
          COUNT(*) FILTER (WHERE rating = 'bad')::int AS bad_count
       FROM user_signal_feedback
       WHERE user_id = $1`,
      [userId],
      { label: 'api.user.performance.totals', timeoutMs: 1200, maxRetries: 1, retryDelayMs: 100 }
    );

    const best = await queryWithTimeout(
      `SELECT
          COALESCE(s.strategy, 'Unknown') AS strategy,
          AVG(CASE WHEN f.rating = 'good' THEN 1 ELSE 0 END)::numeric AS score
       FROM user_signal_feedback f
       LEFT JOIN strategy_signals s ON s.symbol = f.signal_id
       WHERE f.user_id = $1
         AND f.rating IN ('good', 'bad')
       GROUP BY COALESCE(s.strategy, 'Unknown')
       ORDER BY score DESC NULLS LAST, strategy ASC
       LIMIT 1`,
      [userId],
      { label: 'api.user.performance.best', timeoutMs: 1200, maxRetries: 1, retryDelayMs: 100 }
    );

    const worst = await queryWithTimeout(
      `SELECT
          COALESCE(s.strategy, 'Unknown') AS strategy,
          AVG(CASE WHEN f.rating = 'good' THEN 1 ELSE 0 END)::numeric AS score
       FROM user_signal_feedback f
       LEFT JOIN strategy_signals s ON s.symbol = f.signal_id
       WHERE f.user_id = $1
         AND f.rating IN ('good', 'bad')
       GROUP BY COALESCE(s.strategy, 'Unknown')
       ORDER BY score ASC NULLS LAST, strategy ASC
       LIMIT 1`,
      [userId],
      { label: 'api.user.performance.worst', timeoutMs: 1200, maxRetries: 1, retryDelayMs: 100 }
    );

    const row = totals.rows[0] || { signals_taken: 0, good_count: 0, bad_count: 0 };
    const denominator = Number(row.good_count || 0) + Number(row.bad_count || 0);
    const winRate = denominator > 0 ? Number(((Number(row.good_count || 0) / denominator) * 100).toFixed(2)) : 0;

    return res.json({
      success: true,
      signals_taken: Number(row.signals_taken || 0),
      win_rate: winRate,
      best_strategy: best.rows[0]?.strategy || null,
      worst_strategy: worst.rows[0]?.strategy || null,
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Failed to load user performance' });
  }
});

app.get('/api/intelligence', (req, res) => {
  res.json({ status: 'ok', data: [] });
});

app.get('/api/market', (req, res) => {
  res.json({ status: 'ok', data: [] });
});

app.get('/api/market-news', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 100, 200));
    const items = await fetchMarketNewsFallback(limit);
    return res.json({ success: true, items });
  } catch (error) {
    logger.error('market-news endpoint error', { error: error.message });
    return res.status(500).json({ success: false, error: error.message || 'Failed to load market news' });
  }
});

app.get('/api/market/quotes', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 200, 5000));
    const { rows } = await queryWithTimeout(
      `SELECT symbol, price, change_percent, volume, market_cap, sector, updated_at
       FROM market_quotes
       ORDER BY updated_at DESC
       LIMIT $1`,
      [limit],
      { label: 'api.market.quotes', timeoutMs: 5000, maxRetries: 1, retryDelayMs: 200 }
    );
    res.json(rows);
  } catch (err) {
    logger.error('market quotes endpoint error', { error: err.message });
    res.status(500).json({ error: 'Failed to load market quotes', detail: err.message });
  }
});

app.get('/api/market/movers', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 50, 500));
    const { rows } = await queryWithTimeout(
      `SELECT q.symbol,
              q.price,
              q.change_percent,
              q.volume,
              q.market_cap,
              q.sector,
              m.relative_volume,
              m.gap_percent,
              m.updated_at
       FROM market_quotes q
       LEFT JOIN market_metrics m ON m.symbol = q.symbol
       ORDER BY ABS(COALESCE(q.change_percent, 0)) DESC, COALESCE(m.relative_volume, 0) DESC
       LIMIT $1`,
      [limit],
      { label: 'api.market.movers', timeoutMs: 10000 }
    );
    res.json(rows);
  } catch (err) {
    logger.error('market movers endpoint error', { error: err.message });
    res.status(500).json({ error: 'Failed to load market movers', detail: err.message });
  }
});

app.get('/api/market/sectors', async (req, res) => {
  try {
    const { rows } = await queryWithTimeout(
      `WITH base AS (
         SELECT
           COALESCE(q.sector, 'Unknown') AS sector,
           m.symbol,
           COALESCE(m.change_percent, q.change_percent, 0) AS change_percent,
           COALESCE(m.volume, q.volume, 0) AS volume
         FROM market_metrics m
         LEFT JOIN market_quotes q ON q.symbol = m.symbol
       ),
       ranked AS (
         SELECT
           sector,
           symbol,
           change_percent,
           volume,
           ROW_NUMBER() OVER (PARTITION BY sector ORDER BY change_percent DESC NULLS LAST) AS rank_in_sector
         FROM base
       )
       SELECT
         sector,
         AVG(change_percent)::numeric AS avg_change,
         AVG(change_percent)::numeric AS avg_change_percent,
         SUM(volume)::bigint AS total_volume,
         COUNT(symbol)::int AS symbols,
         COALESCE(
           jsonb_agg(
             jsonb_build_object('symbol', symbol, 'change_percent', change_percent)
             ORDER BY change_percent DESC
           ) FILTER (WHERE rank_in_sector <= 3),
           '[]'::jsonb
         ) AS leaders
       FROM ranked
       GROUP BY sector
       ORDER BY avg_change DESC NULLS LAST`,
      [],
      { label: 'api.market.sectors', timeoutMs: 10000 }
    );
    res.json({ sectors: rows, leaders: rows.slice(0, 3) });
  } catch (err) {
    logger.error('market sectors endpoint error', { error: err.message });
    res.status(500).json({ success: false, error: err.message || 'Failed to load market sectors' });
  }
});

app.get('/api/market/sector-strength', async (req, res) => {
  const cacheKey = 'api.market.sector-strength';
  const cacheTtlMs = 30_000;
  const cached = getCachedValue(cacheKey);

  if (cached && (Date.now() - new Date(cached.timestamp || 0).getTime()) <= cacheTtlMs) {
    return res.json(cached);
  }

  try {
    const { rows } = await queryWithTimeout(
      `WITH base AS (
         SELECT
           COALESCE(q.sector, 'Unknown') AS sector,
           m.symbol,
           COALESCE(q.market_cap, 0) AS market_cap,
           COALESCE(m.volume, q.volume, 0) AS volume,
           COALESCE(m.relative_volume, 0) AS relative_volume,
           COALESCE(m.change_percent, q.change_percent, 0) AS price_change
         FROM market_metrics m
         LEFT JOIN market_quotes q ON q.symbol = m.symbol
       ),
       sector_agg AS (
         SELECT
           sector,
           SUM(market_cap)::numeric AS market_cap,
           SUM(volume)::bigint AS volume,
           AVG(relative_volume)::numeric AS relative_volume,
           AVG(price_change)::numeric AS price_change
         FROM base
         GROUP BY sector
       ),
       ticker_ranked AS (
         SELECT
           b.*,
           ROW_NUMBER() OVER (
             PARTITION BY b.sector
             ORDER BY COALESCE(b.volume, 0) DESC NULLS LAST, COALESCE(b.relative_volume, 0) DESC NULLS LAST
           ) AS rank_in_sector
         FROM base b
       )
       SELECT
         s.sector,
         s.market_cap,
         s.volume,
         s.relative_volume,
         s.price_change,
         COALESCE(
           jsonb_agg(
             jsonb_build_object(
               'symbol', t.symbol,
               'market_cap', t.market_cap,
               'volume', t.volume,
               'relative_volume', t.relative_volume,
               'price_change', t.price_change
             )
             ORDER BY t.volume DESC NULLS LAST
           ) FILTER (WHERE t.rank_in_sector <= 25),
           '[]'::jsonb
         ) AS tickers
       FROM sector_agg s
       LEFT JOIN ticker_ranked t ON t.sector = s.sector
       GROUP BY s.sector, s.market_cap, s.volume, s.relative_volume, s.price_change
       ORDER BY s.market_cap DESC NULLS LAST`,
      [],
      { label: 'api.market.sector_strength', timeoutMs: 1500, maxRetries: 0, retryDelayMs: 120 }
    );

    const payload = { success: true, degraded: false, sectors: rows, data: rows, timestamp: new Date().toISOString() };
    setCachedValue(cacheKey, payload);
    return res.json(payload);
  } catch (error) {
    if (isDbTimeoutError(error)) {
      return res.json({
        success: true,
        degraded: true,
        sectors: cached?.sectors || [],
        data: cached?.sectors || [],
        warning: 'SECTOR_STRENGTH_CACHE_FALLBACK',
        detail: error.message || 'Timeout loading sector strength',
      });
    }

    return res.json({
      success: true,
      degraded: true,
      sectors: cached?.sectors || [],
      data: cached?.sectors || [],
      warning: 'SECTOR_STRENGTH_DEGRADED',
      detail: error.message || 'Failed to load sector strength',
    });
  }
});

app.get('/api/sector/:sector', async (req, res) => {
  try {
    const sector = String(req.params.sector || '').trim();
    if (!sector) return res.status(400).json({ success: false, error: 'sector is required' });

    const { rows } = await queryWithTimeout(
      `SELECT
        m.symbol,
        COALESCE(m.price, q.price) AS price,
        COALESCE(m.change_percent, q.change_percent) AS change_percent,
        m.gap_percent,
        m.relative_volume,
        COALESCE(m.volume, q.volume) AS volume,
        COALESCE(q.sector, 'Unknown') AS sector
       FROM market_metrics m
       LEFT JOIN market_quotes q ON q.symbol = m.symbol
       WHERE COALESCE(q.sector, '') ILIKE $1
       ORDER BY COALESCE(m.change_percent, q.change_percent, 0) DESC NULLS LAST
       LIMIT 500`,
      [`%${sector}%`],
      { label: 'api.market.sector_detail', timeoutMs: 10000 }
    );

    return res.json({ success: true, sector, stocks: rows });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Failed to load sector stocks' });
  }
});

app.get('/api/market/indices', async (req, res) => {
  try {
    const requested = ['SPY', 'QQQ', 'IWM', 'VIX', 'DXY', '10Y'];
    const { rows } = await queryWithTimeout(
      `SELECT symbol, price, change_percent
       FROM market_quotes
       WHERE symbol = ANY($1::text[])
       ORDER BY array_position($1::text[], symbol)`,
      [['SPY', 'QQQ', 'IWM', 'VIX', 'DXY', '10Y', 'TNX', '^TNX']],
      { label: 'api.market.indices', timeoutMs: 1200, maxRetries: 1, retryDelayMs: 150 }
    );

    const rowMap = new Map(rows.map((row) => [String(row?.symbol || '').toUpperCase(), row]));
    const normalized = requested.map((symbol) => {
      if (symbol === '10Y') {
        return rowMap.get('10Y') || rowMap.get('TNX') || rowMap.get('^TNX') || { symbol: '10Y', price: null, change_percent: null };
      }
      return rowMap.get(symbol) || { symbol, price: null, change_percent: null };
    });

    return res.json({ success: true, indices: normalized });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Failed to load market indices' });
  }
});

app.get('/api/market/tickers', async (req, res) => {
  try {
    const { rows } = await queryWithTimeout(
      `SELECT symbol, price, change_percent, sector
       FROM market_quotes
       ORDER BY COALESCE(change_percent, 0) DESC NULLS LAST
       LIMIT 20`,
      [],
      { label: 'api.market.tickers', timeoutMs: 1200, maxRetries: 1, retryDelayMs: 150 }
    );
    return res.json({ success: true, tickers: rows });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Failed to load market tickers' });
  }
});

app.get('/api/market/ticker', async (req, res) => {
  try {
    const [indices, gainers, losers, crypto] = await Promise.all([
      queryWithTimeout(
        `SELECT symbol, price, change_percent
         FROM market_quotes
         WHERE symbol = ANY($1::text[])
         ORDER BY array_position($1::text[], symbol)`,
        [['SPY', 'QQQ', 'IWM', 'DIA']],
        { label: 'api.market.ticker.indices', timeoutMs: 1200, maxRetries: 1, retryDelayMs: 120 }
      ),
      queryWithTimeout(
        `SELECT symbol, price, change_percent
         FROM market_quotes
         ORDER BY COALESCE(change_percent, 0) DESC NULLS LAST
         LIMIT 20`,
        [],
        { label: 'api.market.ticker.gainers', timeoutMs: 1200, maxRetries: 1, retryDelayMs: 120 }
      ),
      queryWithTimeout(
        `SELECT symbol, price, change_percent
         FROM market_quotes
         ORDER BY COALESCE(change_percent, 0) ASC NULLS LAST
         LIMIT 20`,
        [],
        { label: 'api.market.ticker.losers', timeoutMs: 1200, maxRetries: 1, retryDelayMs: 120 }
      ),
      queryWithTimeout(
        `SELECT symbol, price, change_percent
         FROM market_quotes
         WHERE symbol = ANY($1::text[])
         ORDER BY array_position($1::text[], symbol)`,
        [['BTCUSD', 'ETHUSD', 'SOLUSD', 'DOGEUSD']],
        { label: 'api.market.ticker.crypto', timeoutMs: 1200, maxRetries: 1, retryDelayMs: 120 }
      ),
    ]);

    return res.json({
      success: true,
      sections: {
        indices: indices.rows,
        top_gainers: gainers.rows,
        top_losers: losers.rows,
        crypto: crypto.rows,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Failed to load ticker tape data' });
  }
});

app.get('/api/expected-move', async (req, res) => {
  const symbol = String(req.query.symbol || '').trim().toUpperCase();
  const limit = Math.max(1, Math.min(Number(req.query.limit) || 100, 500));
  const cacheKey = `api.expected-move:${symbol || 'ALL'}:${limit}`;
  const cacheTtlMs = 30_000;
  const cached = getCachedValue(cacheKey);

  if (cached && (Date.now() - new Date(cached.timestamp || 0).getTime()) <= cacheTtlMs) {
    if (symbol) return res.json(cached.data?.[0] || null);
    return res.json(cached.data || []);
  }

  try {
    const { rows } = await queryWithTimeout(
      `SELECT
        e.symbol,
        COALESCE(m.price, q.price, 0) AS price,
        COALESCE(m.atr, 0) AS atr,
        COALESCE(
          NULLIF(m.atr, 0),
          (COALESCE(m.price, q.price, 0) * COALESCE(ABS(m.gap_percent), ABS(COALESCE(m.change_percent, q.change_percent)), 0)) / 100,
          0
        ) AS expected_move,
        CASE
          WHEN COALESCE(m.price, q.price, 0) > 0 THEN
            (COALESCE(
              NULLIF(m.atr, 0),
              (COALESCE(m.price, q.price, 0) * COALESCE(ABS(m.gap_percent), ABS(COALESCE(m.change_percent, q.change_percent)), 0)) / 100,
              0
            ) / COALESCE(m.price, q.price, 1)) * 100
          ELSE NULL
        END AS expected_move_percent,
        e.earnings_date,
        COALESCE(m.updated_at, q.updated_at, now()) AS updated_at
      FROM earnings_events e
      LEFT JOIN market_metrics m ON m.symbol = e.symbol
      LEFT JOIN market_quotes q ON q.symbol = e.symbol
      WHERE e.earnings_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
        AND ($1::text = '' OR e.symbol = $1)
       ORDER BY expected_move DESC NULLS LAST
       LIMIT $2`,
      [symbol, limit],
      { label: 'api.expected_move', timeoutMs: 1500, maxRetries: 0, retryDelayMs: 120 }
    );

    setCachedValue(cacheKey, {
      success: true,
      degraded: false,
      data: rows,
      timestamp: new Date().toISOString(),
    });

    if (symbol) {
      return res.json(rows[0] || null);
    }

    return res.json(rows);
  } catch (err) {
    logger.error('expected move endpoint db error', { error: err.message });
    if (isDbTimeoutError(err)) {
      return res.json({
        success: true,
        degraded: true,
        data: cached?.data || [],
        warning: 'EXPECTED_MOVE_CACHE_FALLBACK',
        detail: err.message || 'Timeout loading expected move',
      });
    }

    return res.json({
      success: true,
      degraded: true,
      data: cached?.data || [],
      warning: 'EXPECTED_MOVE_DEGRADED',
      detail: err.message || 'Failed to load expected move',
    });
  }
});

async function loadScreenerRows() {
  return fastRowsQuery(
    `SELECT
      symbol,
      price,
      change_percent,
      relative_volume,
      volume
     FROM market_metrics
     ORDER BY change_percent DESC NULLS LAST
     LIMIT 50`,
    [],
    'api.screener',
    1200
  );
}

app.get('/api/screener', async (req, res) => {
  const rows = await loadScreenerRows();
  res.json({ rows });
});

app.get('/api/screener/full', async (req, res) => {
  try {
    const where = [];
    const params = [];

    const addCondition = (condition, value) => {
      params.push(value);
      where.push(condition.replace('?', `$${params.length}`));
    };

    const priceMin = Number(req.query.price_min);
    const priceMax = Number(req.query.price_max);
    const rvolMin = Number(req.query.rvol_min);
    const gapMin = Number(req.query.gap_min);
    const marketCapMin = Number(req.query.market_cap);
    const sector = String(req.query.sector || '').trim();
    const strategy = String(req.query.strategy || '').trim();

    if (Number.isFinite(priceMin)) addCondition('COALESCE(tu.price, 0) >= ?', priceMin);
    if (Number.isFinite(priceMax)) addCondition('COALESCE(tu.price, 0) <= ?', priceMax);
    if (Number.isFinite(rvolMin)) addCondition('COALESCE(tu.relative_volume, 0) >= ?', rvolMin);
    if (Number.isFinite(gapMin)) addCondition('COALESCE(tu.gap_percent, 0) >= ?', gapMin);
    if (Number.isFinite(marketCapMin)) addCondition('COALESCE(q.market_cap, 0) >= ?', marketCapMin);
    if (sector) addCondition("COALESCE(q.sector, '') ILIKE ?", `%${sector}%`);
    if (strategy) addCondition("COALESCE(ss.strategy, '') ILIKE ?", `%${strategy}%`);

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const { rows } = await queryWithTimeout(
      `SELECT
        tu.symbol,
        tu.price,
        tu.change_percent,
        tu.gap_percent,
        tu.relative_volume,
        tu.volume,
        tu.avg_volume_30d,
        q.sector,
        q.market_cap,
        ss.strategy
      FROM tradable_universe tu
      LEFT JOIN market_quotes q ON q.symbol = tu.symbol
      LEFT JOIN strategy_signals ss ON ss.symbol = tu.symbol
      ${whereClause}
      ORDER BY COALESCE(tu.relative_volume, 0) DESC NULLS LAST
      LIMIT 200`,
      params,
      { label: 'api.screener.full', timeoutMs: 10000, maxRetries: 1, retryDelayMs: 200 }
    );

    return res.json({ success: true, rows });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Failed to load full screener' });
  }
});

app.post('/api/screener', async (req, res) => {
  const rows = await loadScreenerRows();
  res.json({ rows });
});

app.get('/api/scanner/status', async (req, res) => {
  if (!FINVIZ_NEWS_TOKEN) {
    return res.json({ available: false, message: 'Scanner context unavailable (FINVIZ token missing).' });
  }
  const ctx = await loadScannerContext();
  res.json({ available: ctx.available, message: ctx.available ? 'Scanner context loaded.' : 'Scanner context unavailable.' });
});

app.get('/api/opportunity-stream', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id,
              symbol,
              event_type,
              headline,
              score,
              source,
              created_at,
              created_at AS timestamp
       FROM opportunity_stream
       ORDER BY created_at DESC
       LIMIT 50`
    );
    res.json(rows);
  } catch (err) {
    logger.error('opportunity stream endpoint db error', { error: err.message });
    res.json([]);
  }
});

app.get('/api/opportunities', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 50, 200));
    const { rows } = await queryWithTimeout(
      `SELECT
              symbol,
              score,
              strategy,
              change_percent,
              relative_volume,
              gap_percent,
              volume,
              updated_at,
              updated_at AS timestamp
       FROM opportunities_v2
       ORDER BY score DESC NULLS LAST
       LIMIT $1`,
      [limit],
      { label: 'api.opportunities', timeoutMs: 1500, maxRetries: 1, retryDelayMs: 200 }
    );
    return res.json({ opportunities: rows });
  } catch (err) {
    logger.error('opportunities endpoint db error', { error: err.message });
    return res.json({ opportunities: [] });
  }
});

app.get('/api/market-narrative', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, narrative, regime, created_at
       FROM market_narratives
       ORDER BY created_at DESC
       LIMIT 1`
    );
    res.json(rows[0] || null);
  } catch (err) {
    logger.error('market narrative endpoint db error', { error: err.message });
    res.json(null);
  }
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
app.post('/api/auth/login', (req, res, next) => {
  req.url = '/login';
  return userRoutes(req, res, next);
});
app.use('/api/users', userRoutes);

app.get('/api/intelligence/feed', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 50, 200));
    const { rows } = await queryWithTimeout(
      `SELECT
        symbol,
        headline,
        source,
        url,
        published_at,
        sentiment,
        updated_at
      FROM intel_news
      ORDER BY published_at DESC NULLS LAST
      LIMIT $1`,
      [limit],
      { label: 'api.intelligence.feed', timeoutMs: 1500, maxRetries: 1, retryDelayMs: 200 }
    );

    return res.json({ success: true, items: rows });
  } catch (error) {
    logger.error('intelligence feed endpoint error', { error: error.message });
    return res.json({
      success: true,
      items: [],
      warning: 'INTELLIGENCE_FEED_FALLBACK',
      detail: error.message,
    });
  }
});

app.get('/api/intelligence/news', async (req, res) => {
  const cacheKey = `api.intelligence.news:${JSON.stringify(req.query || {})}`;
  const cacheTtlMs = 10_000;
  const cached = getCachedValue(cacheKey);

  if (cached && (Date.now() - new Date(cached.timestamp || 0).getTime()) <= cacheTtlMs) {
    return res.json(cached);
  }

  try {
    const where = [];
    const params = [];

    const addCondition = (condition, value) => {
      params.push(value);
      where.push(condition.replace('?', `$${params.length}`));
    };

    const symbol = String(req.query.symbol || '').trim().toUpperCase();
    const sector = String(req.query.sector || '').trim();
    const sentiment = String(req.query.sentiment || '').trim().toLowerCase();
    const hours = Number(req.query.hours);

    if (symbol) addCondition('n.symbol = ?', symbol);
    if (sentiment) addCondition("COALESCE(n.sentiment, '') ILIKE ?", `%${sentiment}%`);
    if (sector) addCondition("COALESCE(q.sector, '') ILIKE ?", `%${sector}%`);
    if (Number.isFinite(hours) && hours > 0) addCondition('n.published_at >= now() - make_interval(hours => ?)', Math.min(hours, 168));

    const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const { rows } = await queryWithTimeout(
      `SELECT
        n.symbol,
        q.sector,
        n.headline,
        n.source,
        n.url,
        n.sentiment,
        n.published_at
       FROM intel_news n
       LEFT JOIN market_quotes q ON q.symbol = n.symbol
       ${whereClause}
       ORDER BY n.published_at DESC NULLS LAST
       LIMIT 50`,
      params,
      { label: 'api.intelligence.news', timeoutMs: 1500, maxRetries: 0, retryDelayMs: 120 }
    );

    const items = rows.map((row) => ({
      ...row,
      timestamp: row.published_at || null,
      published_at: row.published_at || null,
    }));

    const payload = { success: true, degraded: false, items, data: items, timestamp: new Date().toISOString() };
    setCachedValue(cacheKey, payload);
    return res.json(payload);
  } catch (error) {
    if (isDbTimeoutError(error)) {
      return res.json({
        success: true,
        degraded: true,
        items: cached?.items || [],
        data: cached?.items || [],
        warning: 'INTELLIGENCE_NEWS_CACHE_FALLBACK',
        detail: error.message || 'Timeout loading intelligence news',
      });
    }

    return res.json({
      success: true,
      degraded: true,
      items: cached?.items || [],
      data: cached?.items || [],
      warning: 'INTELLIGENCE_NEWS_DEGRADED',
      detail: error.message || 'Failed to load intelligence news',
    });
  }
});

app.get('/api/system/db-status', async (req, res) => {
  const timestamp = new Date().toISOString();
  const errors = [];

  let intelNews = { row_count: null, latest_timestamp: null };
  let marketQuotes = { row_count: null };

  try {
    const intel = await queryWithTimeout(
      `SELECT COUNT(*)::int AS row_count,
              MAX(published_at) AS latest_timestamp
       FROM intel_news`,
      [],
      { label: 'api.system.db_status.intel_news', timeoutMs: 3000, maxRetries: 1, retryDelayMs: 120 }
    );
    intelNews = {
      row_count: Number(intel.rows?.[0]?.row_count || 0),
      latest_timestamp: intel.rows?.[0]?.latest_timestamp || null,
    };
  } catch (error) {
    errors.push({ table: 'intel_news', error: error.message || 'Query failed' });
  }

  try {
    const quotes = await queryWithTimeout(
      `SELECT COUNT(*)::int AS row_count
       FROM market_quotes`,
      [],
      { label: 'api.system.db_status.market_quotes', timeoutMs: 3000, maxRetries: 1, retryDelayMs: 120 }
    );
    marketQuotes = {
      row_count: Number(quotes.rows?.[0]?.row_count || 0),
    };
  } catch (error) {
    errors.push({ table: 'market_quotes', error: error.message || 'Query failed' });
  }

  return res.json({
    success: errors.length === 0,
    degraded: errors.length > 0,
    intel_news: intelNews,
    market_quotes: marketQuotes,
    errors,
    timestamp,
  });
});

app.get('/api/chart/mini/:symbol', async (req, res) => {
  try {
    const symbol = String(req.params.symbol || '').trim().toUpperCase();
    if (!symbol) return res.status(400).json({ success: false, error: 'symbol is required' });

    const { rows } = await queryWithTimeout(
      `SELECT EXTRACT(EPOCH FROM "timestamp")::bigint AS ts_unix, close
       FROM intraday_1m
       WHERE symbol = $1
       ORDER BY "timestamp" DESC
       LIMIT 50`,
      [symbol],
      { label: 'api.chart.mini', timeoutMs: 1500, maxRetries: 1, retryDelayMs: 120 }
    );

    const candles = rows
      .slice()
      .reverse()
      .map((row) => ({
        time: Number(row.ts_unix),
        close: Number(row.close),
      }))
      .filter((row) => Number.isFinite(row.close));

    return res.json({ success: true, symbol, candles });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Failed to load mini chart' });
  }
});

app.get('/api/chart/trend/:symbol', async (req, res) => {
  try {
    const symbol = String(req.params.symbol || '').trim().toUpperCase();
    if (!symbol) return res.status(400).json({ success: false, error: 'symbol is required' });

    await ensureTrendTable();

    const cached = await queryWithTimeout(
      `SELECT symbol, trend, support, resistance, channel, breakouts, updated_at
       FROM chart_trends
       WHERE symbol = $1
       LIMIT 1`,
      [symbol],
      { label: 'api.chart.trend.cached', timeoutMs: 1000, maxRetries: 0 }
    );

    if (cached.rows.length) {
      return res.json({
        symbol,
        trend: cached.rows[0].trend || 'sideways',
        support: cached.rows[0].support || [],
        resistance: cached.rows[0].resistance || [],
        channel: cached.rows[0].channel || [],
        breakouts: cached.rows[0].breakouts || [],
        updated_at: cached.rows[0].updated_at,
      });
    }

    const detected = await detectTrendForSymbol(symbol);
    if (!detected) {
      return res.status(404).json({ success: false, error: `Insufficient data to detect trend for ${symbol}` });
    }

    return res.json(detected);
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Failed to detect chart trend' });
  }
});

app.get('/api/intelligence/summary', async (req, res) => {
  try {
    const [sectors, opportunities, earningsToday, earningsWeek, news, topStrategies] = await Promise.all([
      fastRowsQuery(
        `SELECT sector, avg_change, total_volume, stocks, leaders, updated_at
         FROM sector_heatmap
         ORDER BY avg_change DESC NULLS LAST
         LIMIT 5`,
        [],
        'api.intelligence.summary.sectors',
        300
      ),
      fastRowsQuery(
        `SELECT symbol, score, strategy, change_percent, relative_volume, gap_percent, updated_at
         FROM opportunities_v2
         ORDER BY score DESC NULLS LAST
         LIMIT 10`,
        [],
        'api.intelligence.summary.opportunities',
        300
      ),
      fastRowsQuery(
        `SELECT symbol, company, earnings_date::text AS date, eps_estimate, revenue_estimate
         FROM earnings_events
         WHERE earnings_date = CURRENT_DATE
         ORDER BY symbol ASC
         LIMIT 50`,
        [],
        'api.intelligence.summary.earnings_today',
        300
      ),
      fastRowsQuery(
        `SELECT symbol, company, earnings_date::text AS date, eps_estimate, revenue_estimate
         FROM earnings_events
         WHERE earnings_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
         ORDER BY earnings_date ASC, symbol ASC
         LIMIT 200`,
        [],
        'api.intelligence.summary.earnings_week',
        300
      ),
      fastRowsQuery(
        `SELECT symbol, headline, source, url, published_at, sentiment
         FROM intel_news
         ORDER BY published_at DESC NULLS LAST
         LIMIT 15`,
        [],
        'api.intelligence.summary.news',
        300
      ),
      fastRowsQuery(
        `SELECT strategy,
                class,
                COUNT(*)::int AS count,
                AVG(score)::numeric AS avg_score,
                MAX(probability)::numeric AS max_probability
         FROM strategy_signals
         GROUP BY strategy, class
         ORDER BY avg_score DESC NULLS LAST, count DESC
         LIMIT 10`,
        [],
        'api.intelligence.summary.top_strategies',
        300
      ),
    ]);

    return res.json({
      success: true,
      summary: {
        sectors,
        opportunities,
        earnings: {
          today: earningsToday,
          week: earningsWeek,
        },
        news,
        top_strategies: topStrategies,
      },
      generated_at: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('intelligence summary endpoint error', { error: error.message });
    return res.json({
      success: true,
      summary: { sectors: [], opportunities: [], earnings: { today: [], week: [] }, news: [], top_strategies: [] },
      warning: 'INTELLIGENCE_SUMMARY_FALLBACK',
      detail: error.message,
      generated_at: new Date().toISOString(),
    });
  }
});

// Intelligence ingestion — own key auth, must be before JWT middleware
app.use(intelligenceRoutes);

// General rate limiting for other endpoints (new wrapper)
app.use(generalLimiter);

// API-key/JWT auth middleware
app.use(authMiddleware);

// Alert engine routes
app.use('/api', alertsRoutes);

// Top opportunities feed (protected by global auth middleware above)
app.use('/api', opportunitiesRoutes);

app.post('/api/intelligence/news/run', async (req, res) => {
  try {
    const result = await runIntelNewsWithFallback();
    return res.json({ success: true, result });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Failed to run intel news' });
  }
});

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

app.use('/api', (req, res) => {
  return res.status(404).json({
    success: false,
    error: 'API route not found',
    path: req.originalUrl,
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

// Phase-aware scheduler (legacy mode, opt-in)
if (FMP_API_KEY && process.env.ENABLE_PHASE_SCHEDULER === 'true') {
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

if (FMP_API_KEY && process.env.ENABLE_LEGACY_SCHEDULER_SERVICE === 'true') {
  startSchedulerService();
}

if (process.env.ENABLE_INGESTION_SCHEDULER === 'true') {
  startIngestionScheduler();
}

if (process.env.ENABLE_METRICS_SCHEDULER === 'true') {
  startMetricsScheduler();
}

if (process.env.ENABLE_STRATEGY_SCHEDULER === 'true') {
  startStrategyScheduler();
}

if (process.env.ENABLE_CATALYST_SCHEDULER === 'true') {
  startCatalystScheduler();
}

if (process.env.ENABLE_DISCOVERY_SCHEDULER === 'true') {
  startDiscoveryScheduler();
}

if (process.env.ENABLE_OPPORTUNITY_STREAM_SCHEDULER === 'true') {
  startOpportunityStreamScheduler();
}

if (process.env.ENABLE_NARRATIVE_SCHEDULER === 'true') {
  startNarrativeScheduler();
}

if (process.env.ENABLE_ALERT_SCHEDULER === 'true') {
  startAlertScheduler();
}

if (process.env.ENABLE_ENGINE_SCHEDULER !== 'false') {
  logger.info('OpenRange backend starting in bootstrap mode');
  startEngineScheduler();

  (async () => {
    try {
      await runIngestionNow();
      await runMetricsNow();
      await runUniverseBuilderNow();
      await runStrategyEngineNow();
    } catch (error) {
      logger.error('Initial engine bootstrap failed', { error: error.message });
    }
  })();
}

app.listen(PORT, () => {
  logger.info(`OpenRange server listening on port ${PORT}`);
  console.log('[Intelligence] Ingestion endpoint ready');
  console.log('Scheduler active');
  console.log('Opportunity engine active');

  (async () => {
    try {
      await queryWithTimeout('SELECT 1 AS ok', [], {
        timeoutMs: 5000,
        label: 'startup.db.connection_check',
        maxRetries: 1,
        retryDelayMs: 200,
      });
      console.log('DB connection successful');

      await userModel.ensureFallbackAdminUser().catch((error) => {
        logger.warn('Fallback admin bootstrap skipped', { error: error.message });
      });

      const [metricsHealth, ingestionHealth, universeHealth, queueHealth, setupHealth, catalystHealth, discoveryHealth] = await Promise.all([
        getMetricsHealth(),
        getIngestionHealth(),
        getUniverseHealth(),
        getQueueHealth(),
        getSetupHealth(),
        getCatalystHealth(),
        getDiscoveryHealth(),
      ]);

      logger.info('OpenRange System Status', {
        metricsRows: metricsHealth.rows,
        lastMetricsRun: metricsHealth.last_update,
        ingestionRows: ingestionHealth.tables,
        universeCount: universeHealth.total_symbols,
        queueSize: queueHealth.queue_size,
        setupCount: setupHealth.setup_count,
        catalystCount: catalystHealth.catalyst_count,
        discoveredSymbolCount: discoveryHealth.discovered_symbol_count,
      });
    } catch (err) {
      logger.error('OpenRange System Status failed', { error: err.message });
    }
  })();
});
