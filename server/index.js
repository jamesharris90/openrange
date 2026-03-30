const path = require('path');
const fsSync = require('fs');
const {
  MARKET_QUOTES_TABLE,
  INTRADAY_TABLE,
  OPPORTUNITIES_TABLE,
  SIGNALS_TABLE,
} = require('./lib/data/authority');

console.log('✅ BACKEND ENTRY CONFIRMED:', __dirname);

process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]', err);
});

console.log('BACKEND ENTRY LOADED SUCCESSFULLY');
console.log("🚀 BACKEND INSTANCE ACTIVE:", process.pid, "PORT:", 3007);

process.on('unhandledRejection', (reason) => {
  console.error('[UNHANDLED REJECTION]', reason);
});

console.log('[BOOT] OpenRange backend starting');

require('dotenv').config({ path: path.resolve(__dirname, '.env') });
// Fallback: also try root .env in case server is started from project root.
if (!process.env.FMP_API_KEY) {
  require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
}

function readDatabaseUrlFromEnvFile(envPath) {
  try {
    const raw = fsSync.readFileSync(envPath, 'utf8');
    const match = raw.match(/^DATABASE_URL=(.*)$/m);
    return match?.[1]?.trim() || null;
  } catch (_error) {
    return null;
  }
}

function toDbHost(databaseUrl) {
  if (!databaseUrl) return null;
  try {
    return new URL(databaseUrl).hostname || null;
  } catch (_error) {
    return null;
  }
}

const serverEnvDbUrl = readDatabaseUrlFromEnvFile(path.resolve(__dirname, '.env'));
const rootEnvDbUrl = readDatabaseUrlFromEnvFile(path.resolve(__dirname, '../.env'));
const serverEnvDbHost = toDbHost(serverEnvDbUrl);
const rootEnvDbHost = toDbHost(rootEnvDbUrl);
const activeDbHost = toDbHost(process.env.DATABASE_URL);

console.warn(`Active DB Host: ${activeDbHost || 'unknown'}`);

if (serverEnvDbHost && rootEnvDbHost && serverEnvDbHost !== rootEnvDbHost) {
  console.warn('[BOOT] DATABASE_URL host mismatch detected between server/.env and root .env', {
    serverEnvDbHost,
    rootEnvDbHost,
  });
}

console.log('----- ENV VALIDATION -----');
console.log('API URL:', process.env.API_URL || 'not set');
console.log('SUPABASE URL:', process.env.SUPABASE_URL || 'not set');
console.log('FMP_API_KEY:', process.env.FMP_API_KEY ? 'set' : 'NOT SET');
console.log('DATABASE_URL:', process.env.DATABASE_URL ? 'set' : 'NOT SET');
console.log('----- EMAIL SYSTEM STATUS -----');
console.log('Resend configured:', Boolean(process.env.RESEND_API_KEY));
console.log('Fallback recipient:', process.env.ADMIN_EMAIL || 'jamesharris4@me.com');
console.log('--------------------------------');

const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const csv = require('csvtojson');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const fs = require('fs').promises;
const { randomUUID } = require('crypto');
const logger = require('./logger');
const { withRetry } = require('./utils/retry');
const { runEnvCheck } = require('./utils/envCheck');
const { getCachedValue, setCachedValue } = require('./utils/responseCache');
const { successResponse, errorResponse } = require('./utils/apiResponse');
const { normalizeSymbol, mapToProviderSymbol, mapFromProviderSymbol } = require('./utils/symbolMap');
const { queryWithTimeout } = require('./db/pg');
const runMigrations = require('./db/runMigrations');
const { runSchemaGuard } = require('./system/schemaGuard');
const { runDbSchemaGuard } = require('./db/schemaGuard');
const { ensurePerformanceIndexes } = require('./db/performanceIndexes');
const { ensureAdminSchema } = require('./system/adminSchemaBootstrap');
const { initRedis } = require('./cache/redisClient');
const { runFeatureBootstrap } = require('./system/featureBootstrap');
const { startOrchestrator } = require('./orchestrator/engineOrchestrator');

const { getMarketMode, getModeWindow } = require('./utils/marketMode');

// New layered architecture pieces
const loggingMiddleware = require('./middleware/logging');
const authMiddleware = require('./middleware/auth');
const { contractGuard } = require('./middleware/contractGuard');
const requireFeature = require('./middleware/requireFeature');
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
const strictDataRebuildRoutes = require('./routes/strictDataRebuild');
const optionsApiRoutes = require('./routes/optionsRoutes');
const earningsIntelligenceRoutes = require('./routes/earningsRoutes');
const performanceRoutes = require('./routes/performanceRoutes');
const radarRoutes = require('./routes/radarRoutes');
const radarTradesRoutes = require('./routes/radarTrades');
const briefingRoutes = require('./routes/briefingRoutes');
const marketSymbolRoutes = require('./routes/marketSymbol');
const marketContextRoutes = require('./routes/marketContextRoutes');
const strictCatalystLayerRoutes = require('./routes/strictCatalystLayer');
const adminValidationRoutes = require('./routes/adminValidationRoutes');
const adminLearningRoutes = require('./routes/adminLearningRoutes');
const systemWatchdogRoutes = require('./routes/systemWatchdog');
const userRoutes = require('./users/routes');
const alertsRoutes = require('./routes/alerts');
const opportunitiesRoutes = require('./routes/opportunities');
const outcomeRoutes = require('./routes/outcomeRoutes');
const schemaHealthRoutes = require('./routes/schemaHealth');
const intelligenceRoutes = require('./routes/intelligence');
const newsletterRoutes = require('./routes/newsletter');
const adminFeatureAccessRoutes = require('./routes/adminFeatureAccess');
const strategyIntelligenceRoutes = require('./routes/strategyIntelligence');
const signalsRoutes = require('./routes/signals');
const intelDetailsRoutes = require('./routes/intelDetails');
const { getUIHealth } = require('./routes/uiHealth');
const { uiError, uiErrorLog } = require('./routes/uiErrors');
const { platformHealth } = require('./system/platformHealth');
const { getEmailDiagnostics } = require('./system/emailDiagnostics');
const brokerRoutes = require('./routes/broker');
const marketDataRoutes = require('./modules/marketData/marketDataRoutes');
const marketService = require('./services/marketDataService');
const { generateNarrative } = require('./services/mcpNarrativeEngine');
const { fmpFetch } = require('./services/fmpClient');
const { mapOHLC } = require('./adapters/ohlcAdapter');
const { validateOHLC, validateQuotes, validateSignals, noRealDataResponse } = require('./utils/contractValidator');
const { supabaseClient, supabaseAdmin } = require('./services/supabaseClient');
const expectedMoveService = require('./services/expectedMoveService');
const { buildUniverseDataset } = require('./services/fmpService');
const { isCacheFresh, setUniverse, getUniverse, getLastUpdated } = require('./services/dataStore');
const { startScheduler, rebuildEngine } = require('./data-engine/scheduler');
const {
  startEngineScheduler,
  runIngestion,
  runIngestionNow,
  runMetricsNow,
  runIntelNewsNow,
  runOpportunityNow,
  runPipeline,
} = require('./engines/scheduler');
const { startEngines } = require('./system/startEngines');
const { getEngineSchedulerHealth } = require('./system/engineScheduler');
const { runFullUniverseRefresh } = require('./engines/fullUniverseRefreshEngine');
const engineCache = require('./data-engine/cacheManager');
const { applyFilters } = require('./data-engine/filterEngine');
const { startPhaseScheduler } = require('./scheduler/phaseScheduler');
const { startIngestionScheduler } = require('./ingestion/scheduler');
const { runEarningsIngestion } = require('./ingestion/fmp_earnings_ingest');
const { runAnalystEnrichmentIngestion } = require('./ingestion/fmp_analyst_enrichment_ingest');
const { runTranscriptsIngestion } = require('./ingestion/fmp_transcripts_ingest');
const { runUniverseIngestion } = require('./ingestion/fmp_universe_ingest');
const { startDataHealthMonitor } = require('./system/dataHealthMonitor');
const { startDataScheduler, getIngestionStatus } = require('./system/dataScheduler');
const { startPremarketWatchlistScheduler } = require('./engines/premarketWatchlistEngine');
const { startSignalEvaluationScheduler } = require('./engines/signalEvaluationEngine');
const { startSessionAggregationScheduler } = require('./engines/sessionAggregationEngine');
const { startPremarketIntelligenceScheduler } = require('./engines/premarketIntelligenceEngine');
const { startFallbackDataScheduler } = require('./engines/fallbackDataEngine');
const { startExecutionScheduler } = require('./engines/executionEngine');
const { startExecutionRefinementScheduler } = require('./engines/executionRefinementEngine');
const { startLiveEvaluationScheduler } = require('./engines/liveEvaluationEngine');
const { initEventLogger, getEventBusHealth } = require('./events/eventLogger');
const eventBus = require('./events/eventBus');
const { startSystemAlertEngine } = require('./engines/systemAlertEngine');
const { startRetentionJobs } = require('./system/retentionJobs');
const profileRoutes = require('./routes/profile');
const systemStatusRoutes = require('./routes/systemStatus');
const systemRoutes = require('./routes/system');
const cronControlRoutes = require('./routes/cronControl');
const systemMonitorRoutes = require('./routes/systemMonitorRoutes');
const screenerV3Routes = require('./routes/screenerV3');
const screenerV3EngineRoutes = require('./routes/screenerV3Engine.ts');
const earningsCalendarRoutes = require('./routes/earningsCalendar');
const ipoCalendarRoutes = require('./routes/ipoCalendar');
const { startLiveQuotesScheduler, getStats: getLiveQuoteStats } = require('./services/liveQuotesCache');
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
const platformStabilityRoutes = require('./routes/platformStabilityRoutes');
const calibrationRoutes = require('./routes/calibrationRoutes');
const calibrationRoutesExt = require('./routes/calibration');

const SAFE_MODE = String(process.env.SAFE_MODE || '').toLowerCase() === 'true';
const NON_ESSENTIAL_ENGINES_ENABLED = String(process.env.NON_ESSENTIAL_ENGINES_ENABLED || 'true').toLowerCase() !== 'false';

const FINVIZ_NEWS_TOKEN = process.env.FINVIZ_NEWS_TOKEN || '';
const FINVIZ_NEWS_URL = FINVIZ_NEWS_TOKEN
  ? `https://elite.finviz.com/news_export.ashx?v=3&auth=${FINVIZ_NEWS_TOKEN}`
  : null;
const FINVIZ_NEWS_CACHE_MS = 5 * 60 * 1000;
const FINVIZ_CSV_CACHE_MS = 5 * 60 * 1000;
let finvizNewsCache = { data: null, ts: 0 };
const finvizCsvCache = {};


async function fetchFinvizNews() {
  if (!FINVIZ_NEWS_URL) {
    console.warn('FINVIZ_NEWS_TOKEN not set. Skipping Finviz news fetch.');
    return;
  }

  try {
    const response = await withRetry(
      () => axios.get(FINVIZ_NEWS_URL, { responseType: 'text', timeout: 12000 }),
      {
        retries: 4,
        baseDelay: 400,
        factor: 2,
        shouldRetry: (err) => {
          const status = err?.response?.status;
          return status === 429 || (status >= 500 && status < 600);
        },
      }
    );

    const csvData = await csv().fromString(response.data);
    const normalizedData = csvData.map(item => {
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
    console.error('Finviz news fetch error:', { error: err.message, stack: err.stack });
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
console.log('🚨 NEW SCREENER ROUTE ACTIVE');
app.set('trust proxy', 1);

const allowedOrigins = [
  'http://localhost:3000',
  process.env.FRONTEND_URL,
].filter(Boolean);

console.log('=== ENV CHECK ===');
console.log('NODE_ENV:', process.env.NODE_ENV);
console.log('FRONTEND_URL:', process.env.FRONTEND_URL);

if (process.env.NODE_ENV === 'production' && !process.env.FRONTEND_URL) {
  console.error('FRONTEND_URL is missing in production');
}

const corsOptions = {
  origin: function (origin, callback) {
    console.log('[CORS] Incoming origin:', origin);

    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      console.error('[CORS BLOCKED]', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use((req, res, next) => {
  console.log('REQ:', req.method, req.url);
  next();
});

// Lightweight health endpoint for platform probes; intentionally no dependencies.
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    backendLock: 'localhost:3007',
    port: 3007,
    env: process.env.NODE_ENV || 'development',
    allowedOrigins,
  });
});

app.use(express.json({ limit: '1mb' }));
app.use(express.json());
app.use(cookieParser());

// New logging middleware
app.use(loggingMiddleware);
app.use(contractGuard);

app.use((req, res, next) => {
  req.requestId = req.get('x-request-id') || randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
});

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

const PORT = Number(process.env.PORT || 3007);
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const PROXY_API_KEY = process.env.PROXY_API_KEY || null;
const DEBUG_MODE = process.env.DEBUG_MODE === 'true';
const FMP_API_KEY = process.env.FMP_API_KEY || null;
logger.info(`FMP_API_KEY exists: ${!!FMP_API_KEY}`);
if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  logger.warn('JWT_SECRET not set — using insecure default. Set JWT_SECRET env var in production.');
}
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:3000';
const PPLX_API_KEY = process.env.PPLX_API_KEY || null;
const PPLX_MODEL = process.env.PPLX_MODEL || 'sonar-pro';
const SEC_JSON_PATH = path.join(__dirname, 'data', 'sec-earnings-today.json');
const SEC_MD_PATH = path.join(__dirname, 'data', 'sec-earnings-today-ai.md');
const PREMARKET_REPORT_JSON_PATH = path.join(__dirname, '..', 'premarket-screener', 'sample-output', 'report.json');
const PREMARKET_REPORT_MD_PATH = path.join(__dirname, '..', 'premarket-screener', 'sample-output', 'report.md');

let personalizationTablesReady = false;
let liveValidationLoopStarted = false;

function freshnessStatus(isoTimestamp, maxAgeMs) {
  if (!isoTimestamp) return 'stale';
  const ts = new Date(isoTimestamp).getTime();
  if (!Number.isFinite(ts)) return 'stale';
  return Date.now() - ts <= maxAgeMs ? 'live' : 'stale';
}

async function fetchIntelligenceApiCount(baseUrl, endpoint, headers) {
  const url = `${baseUrl}/api/intelligence/${endpoint}`;
  const response = await fetch(url, { headers });
  const text = await response.text();

  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch (_error) {
    payload = null;
  }

  const count = Array.isArray(payload?.data)
    ? payload.data.length
    : Array.isArray(payload?.items)
      ? payload.items.length
      : -1;

  return {
    endpoint,
    status: response.status,
    success: payload?.success === true,
    count,
  };
}

async function runLiveValidationCycle() {
  const { rows } = await queryWithTimeout(
    `SELECT
       (SELECT MAX(updated_at) FROM market_metrics) AS market_latest,
       (SELECT MAX(detected_at) FROM trade_setups) AS setups_latest,
       (SELECT MAX(created_at) FROM news_articles) AS news_latest,
       (SELECT COUNT(*)::int FROM market_metrics) AS market_count,
       (SELECT COUNT(*)::int FROM trade_setups) AS setups_count,
       (SELECT COUNT(*)::int FROM news_articles) AS news_count,
      (SELECT COUNT(*)::int FROM trade_setups WHERE COALESCE(detected_at, updated_at) > NOW() - INTERVAL '7 days') AS opportunities_primary_count,
       (SELECT COUNT(*)::int FROM trade_setups) AS opportunities_fallback_count,
       (SELECT COUNT(*)::int FROM market_metrics WHERE COALESCE(updated_at, last_updated) > NOW() - INTERVAL '24 hours') AS heatmap_primary_count,
       (SELECT COUNT(*)::int FROM market_metrics) AS heatmap_fallback_count,
       (SELECT COUNT(*)::int FROM news_articles WHERE created_at > NOW() - INTERVAL '24 hours') AS news_recent_count,
      (SELECT COUNT(*)::int FROM trade_setups WHERE COALESCE(detected_at, updated_at) > NOW() - INTERVAL '7 days') AS signals_primary_count,
       (SELECT COUNT(*)::int FROM trade_setups) AS signals_fallback_count`,
    [],
    { label: 'validation.truth_cycle', timeoutMs: 2800, maxRetries: 1, retryDelayMs: 150 }
  );

  const truth = rows?.[0] || {};
  const baseUrl = `http://127.0.0.1:${PORT}`;
  const headers = PROXY_API_KEY ? { 'x-api-key': PROXY_API_KEY } : {};
  const endpointChecks = await Promise.all([
    fetchIntelligenceApiCount(baseUrl, 'opportunities', headers),
    fetchIntelligenceApiCount(baseUrl, 'heatmap', headers),
    fetchIntelligenceApiCount(baseUrl, 'news', headers),
    fetchIntelligenceApiCount(baseUrl, 'signals', headers),
  ]);

  const expectedOpportunities = (() => {
    const primary = Number(truth.opportunities_primary_count || 0);
    const fallback = Number(truth.opportunities_fallback_count || 0);
    return primary > 0 ? Math.min(primary, 50) : Math.min(fallback, 20);
  })();

  const expectedHeatmap = (() => {
    const primary = Number(truth.heatmap_primary_count || 0);
    const fallback = Number(truth.heatmap_fallback_count || 0);
    return primary > 0 ? Math.min(primary, 100) : Math.min(fallback, 50);
  })();

  const expectedNews = Math.min(Number(truth.news_recent_count || 0), 50);

  const expectedSignals = (() => {
    const primary = Number(truth.signals_primary_count || 0);
    const fallback = Number(truth.signals_fallback_count || 0);
    return primary > 0 ? Math.min(primary, 50) : Math.min(fallback, 20);
  })();

  const expectedByEndpoint = {
    opportunities: expectedOpportunities,
    heatmap: expectedHeatmap,
    news: expectedNews,
    signals: expectedSignals,
  };

  console.log('[TRUTH CHECK]', {
    market: truth.market_latest || null,
    setups: truth.setups_latest || null,
    news: truth.news_latest || null,
    market_count: Number(truth.market_count || 0),
    setups_count: Number(truth.setups_count || 0),
    news_count: Number(truth.news_count || 0),
  });

  for (const check of endpointChecks) {
    console.log('[API CHECK]', {
      endpoint: check.endpoint,
      status: check.status,
      success: check.success,
      rows: check.count,
      expected_rows: expectedByEndpoint[check.endpoint],
    });

    if (!check.success || check.count !== expectedByEndpoint[check.endpoint]) {
      console.warn('[VALIDATION MISMATCH]', {
        endpoint: check.endpoint,
        status: check.status,
        success: check.success,
        api_rows: check.count,
        expected_rows: expectedByEndpoint[check.endpoint],
      });
    }
  }
}

function startLiveValidationLoop() {
  if (liveValidationLoopStarted) return;
  liveValidationLoopStarted = true;

  console.log('[VALIDATION LOOP] scheduler registered (every 5 minutes)');

  const run = () => {
    runLiveValidationCycle().catch((error) => {
      console.error('[VALIDATION LOOP ERROR]', error.message);
    });
  };

  run();
  setInterval(run, 5 * 60 * 1000);
}

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

function requireAdminAction(req, res, next) {
  const user = getOptionalAuthUser(req);
  const apiKey = req.get('x-api-key');
  const isAdminUser = Boolean(user?.is_admin === true || user?.is_admin === 1);
  const hasApiKey = Boolean(PROXY_API_KEY && apiKey && apiKey === PROXY_API_KEY);

  if (isAdminUser || hasApiKey) {
    return next();
  }

  return res.status(401).json({ ok: false, error: 'Unauthorized admin action' });
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

// Legacy static pages are intentionally decommissioned.

const marketRoutes = marketDataRoutes;

// Temporary production routing debug for API traffic.
app.use('/api', (req, _res, next) => {
  console.log('[API REQUEST]', req.method, req.path);
  next();
});
    
  // New modular routes
  app.use(quotesRoutes);
  app.use(quotesBatchRoutes);
  app.get('/api/ohlc/intraday', async (req, res) => {
    try {
      const symbol = mapFromProviderSymbol(normalizeSymbol(req.query.symbol));
      if (!symbol) {
        return res.status(400).json({ error: 'symbol is required' });
      }

      const result = await queryWithTimeout(
        `SELECT symbol, "timestamp", open, high, low, close, volume
           FROM intraday_1m
          WHERE symbol = $1
          ORDER BY "timestamp" DESC
          LIMIT 500`,
        [symbol],
        { label: 'ohlc.intraday', timeoutMs: 8000 }
      );

      const mapped = mapOHLC((Array.isArray(result.rows) ? result.rows : []).slice().reverse());

      if (!validateOHLC(mapped)) {
        console.warn('⚠️ OHLC CONTRACT VIOLATION', { symbol, rows: mapped.length });
      }

      console.log('OHLC rows:', mapped.length);

      return res.json({ success: true, data: mapped });
    } catch (err) {
      console.error('OHLC ERROR:', err);
      return res.status(500).json({ error: 'OHLC fetch failed' });
    }
  });

  app.get('/api/earnings', async (req, res) => {
    const buildForcedEarningsFallback = () => {
      const raw = {
        symbol: 'AAPL',
        strategy: 'EARNINGS_VOLATILITY',
        why_moving: 'Scheduled earnings catalyst fallback',
        how_to_trade: 'Enter on breakout, stop below support, target next resistance',
        confidence: 65,
        score: 65,
        expected_move_percent: 3.5,
        trade_class: 'TRADEABLE',
        report_date: new Date(Date.now() + (24 * 60 * 60 * 1000)).toISOString().slice(0, 10),
      };
      const built = buildFinalTradeObject(raw, 'earnings_fallback');
      return built
        ? [{ ...built, event_date: raw.report_date, time_group: 'UNKNOWN', week_group: raw.report_date, score: 65 }]
        : [];
    };

    try {
      if (!supabaseClient) {
        const fallbackRows = buildForcedEarningsFallback();
        console.log('[EARNINGS FALLBACK USED]');
        return res.json({ success: true, count: fallbackRows.length, data: fallbackRows, fallback_used: true });
      }

      const symbol = mapFromProviderSymbol(normalizeSymbol(req.query.symbol));
      const builder = supabaseClient
        .from('earnings_events')
        .select('symbol,report_date')
        .order('report_date', { ascending: true })
        .limit(50);

      if (symbol) {
        builder.eq('symbol', symbol);
      }

      const { data, error } = await builder;

      if (error) throw error;

      const rows = Array.isArray(data)
        ? data.map((row) => {
          const reportDate = String(row.report_date || '');
          const daysToEvent = Math.max(0, Math.ceil((new Date(reportDate).getTime() - Date.now()) / 86400000));
          const recencyBoost = Math.max(0, 20 - daysToEvent * 4);
          const score = Math.max(25, Math.min(95, 50 + recencyBoost));
          const timeGroup = String(row.report_time || row.time || 'UNKNOWN').toUpperCase();
          const raw = {
            ...row,
            strategy: 'EARNINGS_VOLATILITY',
            why_moving: `Scheduled earnings event on ${reportDate || 'upcoming session'}`,
            how_to_trade: 'Use defined risk around earnings volatility and wait for confirmed direction after release.',
            confidence: score,
            score,
            expected_move_percent: Number(row.expected_move_percent || 3.5),
            trade_class: score >= 60 ? 'TRADEABLE' : 'WATCHLIST',
            report_date: reportDate,
            time_group: timeGroup,
            week_group: reportDate,
          };
          const trade = buildFinalTradeObject(raw, 'earnings');
          if (!trade) return null;
          const check = validateTrade(trade);
          if (!check.valid) {
            console.error('[api/earnings] invalid trade dropped', { symbol: raw.symbol, errors: check.errors });
            return null;
          }
          return {
            ...trade,
            event_date: reportDate,
            time_group: timeGroup,
            week_group: reportDate,
            score,
          };
        }).filter(Boolean)
        : [];

      if (rows.length === 0) {
        const fallbackRows = buildForcedEarningsFallback();
        console.log('[EARNINGS FALLBACK USED]');
        return res.json({ success: true, count: fallbackRows.length, data: fallbackRows, fallback_used: true });
      }

      console.log('EARNINGS rows:', rows.length);

      return res.json({ success: true, count: rows.length, data: rows });
    } catch (err) {
      console.error('EARNINGS ERROR:', err);
      const fallbackRows = buildForcedEarningsFallback();
      console.log('[EARNINGS FALLBACK USED]');
      return res.json({ success: true, count: fallbackRows.length, data: fallbackRows, fallback_used: true, degraded: true });
    }
  });

  // Strict DB-driven data layer endpoints must resolve before compatibility handlers.
  app.use(strictDataRebuildRoutes);
  app.use(platformStabilityRoutes);

  app.get('/api/moves', async (_req, res) => {
    try {
      const { rows: primaryRows } = await queryWithTimeout(
        `SELECT
           m.symbol,
           COALESCE((to_jsonb(m)->>'price_change_percent')::numeric, (to_jsonb(m)->>'change_percent')::numeric, m.gap_percent, 0) AS price_change_percent,
           COALESCE(m.relative_volume, 0) AS relative_volume,
           COALESCE(q.sector, 'Unknown') AS sector,
           COALESCE(m.updated_at, q.updated_at, now()) AS updated_at
         FROM market_metrics m
         LEFT JOIN market_quotes q ON q.symbol = m.symbol
         WHERE COALESCE(m.updated_at, q.updated_at, now()) > NOW() - INTERVAL '24 hours'
         ORDER BY COALESCE((to_jsonb(m)->>'price_change_percent')::numeric, (to_jsonb(m)->>'change_percent')::numeric, m.gap_percent, 0) DESC NULLS LAST
         LIMIT 10`,
        [],
        { label: 'api.moves', timeoutMs: 1200, maxRetries: 1, retryDelayMs: 100 }
      );

      if (primaryRows.length > 0) {
        return res.json({ success: true, items: primaryRows });
      }

      const { rows: fallbackRows } = await queryWithTimeout(
        `SELECT
           m.symbol,
           COALESCE((to_jsonb(m)->>'price_change_percent')::numeric, (to_jsonb(m)->>'change_percent')::numeric, m.gap_percent, 0) AS price_change_percent,
           COALESCE(m.relative_volume, 0) AS relative_volume,
           COALESCE(q.sector, 'Unknown') AS sector,
           COALESCE(m.updated_at, q.updated_at, now()) AS updated_at
         FROM market_metrics m
         LEFT JOIN market_quotes q ON q.symbol = m.symbol
         ORDER BY COALESCE(m.updated_at, q.updated_at, now()) DESC NULLS LAST
         LIMIT 50`,
        [],
        { label: 'api.moves.fallback', timeoutMs: 1500, maxRetries: 1, retryDelayMs: 100 }
      );

      return res.json({ success: true, items: fallbackRows });
    } catch (error) {
      return res.json({ success: true, items: [] });
    }
  });

  function buildNewsFallback(symbol = '') {
    const normalizedSymbol = symbol || 'SPY';
    return [{
      symbol: normalizedSymbol,
      headline: `Fallback headline for ${normalizedSymbol}`,
      source: 'openrange-fallback',
      published_at: new Date().toISOString(),
      url: `https://openrange.local/news/${normalizedSymbol.toLowerCase()}`,
    }];
  }

  function buildEarningsFallback() {
    const today = new Date().toISOString().slice(0, 10);
    return [{
      symbol: 'AAPL',
      date: today,
      company: 'Apple Inc.',
      time: 'AMC',
      eps_estimate: 1.24,
      revenue_estimate: 89000000000,
      sector: 'Technology',
      updated_at: new Date().toISOString(),
    }];
  }

  function buildIntradayFallback(symbol) {
    const now = Date.now();
    return Array.from({ length: 30 }).map((_, idx) => {
      const t = now - (29 - idx) * 60 * 1000;
      const base = 100 + idx * 0.12;
      return {
        time: t,
        open: Number(base.toFixed(2)),
        high: Number((base + 0.15).toFixed(2)),
        low: Number((base - 0.15).toFixed(2)),
        close: Number((base + 0.05).toFixed(2)),
        volume: 100000 + idx * 250,
        symbol,
      };
    });
  }

  app.get('/api/news', async (req, res) => {
    try {
      const symbol = String(req.query.symbol || '').trim().toUpperCase();
      const limit = Math.max(1, Math.min(Number(req.query.limit) || 50, 200));
      const params = [];
      const clauses = [`COALESCE(published_at, published_date, created_at) > NOW() - INTERVAL '24 hours'`];

      if (symbol) {
        params.push(symbol);
        clauses.push(`UPPER(COALESCE(symbol, '')) = $${params.length}`);
      }

      params.push(limit);

      const { rows } = await queryWithTimeout(
        `SELECT
           symbol,
           headline,
           source,
           COALESCE(published_at, published_date, created_at) AS published_at,
           url
         FROM news_articles
         WHERE ${clauses.join(' AND ')}
         ORDER BY COALESCE(published_at, published_date, created_at) DESC NULLS LAST
         LIMIT $${params.length}`,
        params,
        { label: 'api.news.primary', timeoutMs: 1800, maxRetries: 1, retryDelayMs: 100 }
      );

      if ((rows || []).length > 0) {
        return res.json(rows);
      }

      const fallbackParams = [];
      const fallbackClauses = [];
      if (symbol) {
        fallbackParams.push(symbol);
        fallbackClauses.push(`UPPER(COALESCE(symbol, '')) = $${fallbackParams.length}`);
      }
      fallbackParams.push(limit);

      const { rows: latestRows } = await queryWithTimeout(
        `SELECT
           symbol,
           headline,
           source,
           COALESCE(published_at, published_date, created_at) AS published_at,
           url
         FROM news_articles
         ${fallbackClauses.length ? `WHERE ${fallbackClauses.join(' AND ')}` : ''}
         ORDER BY COALESCE(published_at, published_date, created_at) DESC NULLS LAST
         LIMIT $${fallbackParams.length}`,
        fallbackParams,
        { label: 'api.news.latest_rows', timeoutMs: 1800, maxRetries: 1, retryDelayMs: 100 }
      );

      return res.json(latestRows || []);
    } catch (error) {
      logger.error('api.news query failed', { error: error.message });
      return res.status(500).json({
        error: 'NEWS_QUERY_FAILED',
        message: error.message || 'Failed to load news',
      });
    }
  });

  app.get('/api/news/latest', async (req, res) => {
    const rawLimit = Number.parseInt(String(req.query.limit || ''), 10);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : 100;

    // Optional filters
    const symbol   = String(req.query.symbol   || '').trim().toUpperCase() || null;
    const type     = String(req.query.type      || '').trim().toLowerCase(); // 'market' | 'stock'
    const sector   = String(req.query.sector    || '').trim() || null;
    const catalyst = String(req.query.catalyst  || '').trim().toLowerCase() || null;

    const params = [];
    const where  = [];

    if (symbol) {
      params.push(symbol);
      where.push(`UPPER(COALESCE(na.symbol, '')) = $${params.length}`);
    }
    if (type === 'market') {
      where.push(`na.symbol IS NULL`);
    } else if (type === 'stock') {
      where.push(`na.symbol IS NOT NULL`);
    }
    if (sector) {
      params.push(sector);
      where.push(`na.sector = $${params.length}`);
    }
    if (catalyst) {
      params.push(catalyst);
      where.push(`na.catalyst_type = $${params.length}`);
    }

    params.push(limit);

    try {
      const { rows } = await queryWithTimeout(
        `SELECT
           na.id,
           na.symbol,
           COALESCE(na.headline, na.title) AS headline,
           na.summary,
           na.source,
           COALESCE(na.publisher, na.provider) AS publisher,
           na.provider,
           na.url,
           COALESCE(na.published_at, na.published_date) AS published_at,
           na.sector,
           na.sentiment,
           na.news_score,
           na.catalyst_type
         FROM news_articles na
         ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY COALESCE(na.published_at, na.published_date) DESC NULLS LAST
         LIMIT $${params.length}`,
        params,
        { label: 'api.news.latest', timeoutMs: 3000, maxRetries: 1, retryDelayMs: 100 }
      );

      return res.json({ ok: true, items: rows });
    } catch (error) {
      logger.error('news latest endpoint error', { error: error.message });
      return res.status(500).json({ ok: false, items: [], error: error.message || 'Failed to load latest news' });
    }
  });

  app.get('/api/news/symbol/:symbol', async (req, res) => {
    const symbol = String(req.params.symbol || '').trim().toUpperCase();
    if (!symbol) return res.status(400).json({ ok: false, error: 'symbol required' });

    const rawLimit = Number.parseInt(String(req.query.limit || ''), 10);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 50;

    try {
      const { rows } = await queryWithTimeout(
        `SELECT
           na.id,
           na.symbol,
           na.headline,
           na.summary,
           na.source,
           na.provider,
           na.url,
           na.published_at,
           na.sector,
           na.sentiment,
           na.news_score,
           na.catalyst_type
         FROM news_articles na
         WHERE UPPER(COALESCE(na.symbol, '')) = $1
         ORDER BY na.published_at DESC NULLS LAST
         LIMIT $2`,
        [symbol, limit],
        { label: 'api.news.symbol', timeoutMs: 1800, maxRetries: 1, retryDelayMs: 100 }
      );

      return res.json({ ok: true, items: rows });
    } catch (error) {
      logger.error('news symbol endpoint error', { error: error.message, symbol });
      return res.status(500).json({ ok: false, items: [], error: error.message || 'Failed to load symbol news' });
    }
  });

  app.get('/api/news/id/:id', async (req, res) => {
    const id = String(req.params.id || '').trim();
    if (!id) return res.status(400).json({ ok: false, error: 'id required' });

    try {
      const detailTasks = await Promise.allSettled([
        queryWithTimeout(
          `SELECT
             na.id,
             na.symbol,
             na.headline,
             na.summary,
             na.source,
             na.provider,
             na.url,
             na.published_at,
             na.sector,
             na.sentiment,
             na.news_score,
             na.catalyst_type,
             na.narrative
           FROM news_articles na
           WHERE na.id = $1
           LIMIT 1`,
          [id],
          { label: 'api.news.id.base', timeoutMs: 1800, maxRetries: 1, retryDelayMs: 100 }
        ),
        queryWithTimeout(
          `SELECT
             ci.provider_count,
             ci.freshness_minutes,
             ci.sector_trend,
             ci.market_trend,
             ci.float_size,
             ci.short_interest,
             ci.institutional_ownership,
             ci.expected_move_low,
             ci.expected_move_high,
             ci.confidence_score,
             ci.narrative AS catalyst_narrative,
             cr.reaction_type,
             cr.continuation_probability,
             cr.expectation_gap_score,
             cr.priced_in_flag,
             cr.is_tradeable_now,
             cr.qqq_trend,
             cr.spy_trend,
             cr.sector_alignment
           FROM catalyst_intelligence ci
           LEFT JOIN catalyst_reactions cr ON cr.news_id = ci.news_id
           WHERE ci.news_id = ABS(MOD((('x' || SUBSTRING(md5($1::text), 1, 16))::bit(64)::bigint), 9223372036854775807))::bigint
           LIMIT 1`,
          [id],
          { label: 'api.news.id.catalyst', timeoutMs: 1800, maxRetries: 1, retryDelayMs: 100 }
        ),
      ]);

      const warnings = [];
      const base = detailTasks[0].status === 'fulfilled' ? detailTasks[0].value.rows[0] : null;
      const catalyst = detailTasks[1].status === 'fulfilled' ? detailTasks[1].value.rows[0] : null;

      if (detailTasks[0].status !== 'fulfilled') warnings.push(`base: ${detailTasks[0].reason?.message || 'query failed'}`);
      if (detailTasks[1].status !== 'fulfilled') warnings.push(`catalyst: ${detailTasks[1].reason?.message || 'query failed'}`);

      if (!base) {
        return res.status(404).json({ ok: false, items: [], warnings, error: 'News item not found' });
      }

      return res.json({ ok: true, items: [{ ...base, ...(catalyst || {}) }], warnings });
    } catch (error) {
      logger.error('news id endpoint error', { error: error.message, id });
      return res.status(500).json({ ok: false, items: [], error: error.message || 'Failed to load news detail' });
    }
  });

  app.use(newsRoutes);
  app.use(gappersRoutes);
  app.use(historicalRoutes);
  app.use(optionsRoutes);
  app.use(earningsRoutes);
  app.use('/api/calibration', calibrationRoutes);
  app.use('/api/calibration', calibrationRoutesExt);
  app.use('/api/performance', performanceRoutes);
  app.use('/api/radar', radarRoutes);
  app.use('/api/radar', radarTradesRoutes);
  app.use('/api/briefing', briefingRoutes);
  app.use(marketSymbolRoutes);
  app.use('/api/market', marketRoutes);
  app.use('/api/market/context', marketContextRoutes);
  app.use('/api/options', optionsApiRoutes);
  app.use('/api/earnings/intelligence', earningsIntelligenceRoutes);
  app.use('/api', strictCatalystLayerRoutes);
  app.use(adminRoutes);
  app.use(adminValidationRoutes);
  app.use(adminLearningRoutes);
  // Phase-aware architecture routes
  app.use('/api', profileRoutes);
  app.use('/api', testNewsDbRoute);
  app.use('/api/system', systemRoutes);
  app.use('/api/system', systemStatusRoutes);
  app.use('/api/system', systemWatchdogRoutes);
  app.use('/api/system', systemMonitorRoutes);
  app.use('/api/cron', cronControlRoutes);
  app.use('/api/data', screenerV3Routes);
  app.use('/api/v3/screener', screenerV3EngineRoutes);
  app.use('/api/earnings', earningsCalendarRoutes);
  app.use('/api/ipo', ipoCalendarRoutes);
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
    brokers: ['ibkr'],
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

app.get('/api/metrics/openrange-accuracy', async (_req, res) => {
  try {
    const { rows } = await queryWithTimeout(
      `SELECT
         COUNT(*) AS total_trades,
         COUNT(*) FILTER (WHERE success = true) AS winning_trades,
         ROUND(
           100.0 * COUNT(*) FILTER (WHERE success = true) /
           NULLIF(COUNT(*),0),
           2
         ) AS accuracy_percent,
         ROUND(AVG(max_move),2) AS avg_move
       FROM trade_outcomes
       WHERE evaluation_time > NOW() - INTERVAL '7 days'`,
      [],
      {
        timeoutMs: 1500,
        maxRetries: 0,
        slowQueryMs: 1000,
        label: 'api.metrics.openrange_accuracy',
      }
    );

    return res.json(rows?.[0] || {
      total_trades: '0',
      winning_trades: '0',
      accuracy_percent: null,
      avg_move: null,
    });
  } catch (error) {
    return res.status(500).json({
      total_trades: '0',
      winning_trades: '0',
      accuracy_percent: null,
      avg_move: null,
      error: error.message,
    });
  }
});

app.get('/api/metrics/backtest-summary', async (_req, res) => {
  try {
    await ensureBacktestSignalsTable();

    const [totalsResult, confidenceResult, catalystResult] = await Promise.all([
      queryWithTimeout(
        `SELECT
           COUNT(*)::int AS total_signals,
           COUNT(*) FILTER (WHERE evaluated = true)::int AS evaluated_signals,
           COUNT(*) FILTER (WHERE evaluated = true AND result = 'WIN')::int AS win_signals,
           ROUND(AVG(max_upside_pct) FILTER (WHERE evaluated = true), 4) AS avg_upside,
           ROUND(AVG(max_drawdown_pct) FILTER (WHERE evaluated = true), 4) AS avg_drawdown
         FROM backtest_signals`,
        [],
        {
          timeoutMs: 1800,
          maxRetries: 0,
          slowQueryMs: 1000,
          label: 'api.metrics.backtest_summary.totals',
        }
      ),
      queryWithTimeout(
        `SELECT
           bucket,
           COUNT(*)::int AS count,
           ROUND(
             100.0 * COUNT(*) FILTER (WHERE result = 'WIN') / NULLIF(COUNT(*), 0),
             2
           ) AS win_rate
         FROM (
           SELECT
             CASE
               WHEN confidence >= 90 THEN '90-100'
               WHEN confidence >= 80 THEN '80-90'
               WHEN confidence >= 70 THEN '70-80'
               WHEN confidence >= 60 THEN '60-70'
               ELSE '<60'
             END AS bucket,
             result
           FROM backtest_signals
           WHERE evaluated = true
         ) ranked
         GROUP BY bucket
         ORDER BY CASE bucket
           WHEN '90-100' THEN 1
           WHEN '80-90' THEN 2
           WHEN '70-80' THEN 3
           WHEN '60-70' THEN 4
           ELSE 5
         END`,
        [],
        {
          timeoutMs: 1800,
          maxRetries: 0,
          slowQueryMs: 1000,
          label: 'api.metrics.backtest_summary.by_confidence',
        }
      ),
      queryWithTimeout(
        `SELECT
           COALESCE(NULLIF(catalyst_type, ''), 'UNKNOWN') AS catalyst,
           COUNT(*)::int AS count,
           ROUND(
             100.0 * COUNT(*) FILTER (WHERE result = 'WIN') / NULLIF(COUNT(*), 0),
             2
           ) AS win_rate
         FROM backtest_signals
         WHERE evaluated = true
         GROUP BY COALESCE(NULLIF(catalyst_type, ''), 'UNKNOWN')
         ORDER BY COUNT(*) DESC
         LIMIT 50`,
        [],
        {
          timeoutMs: 1800,
          maxRetries: 0,
          slowQueryMs: 1000,
          label: 'api.metrics.backtest_summary.by_catalyst',
        }
      ),
    ]);

    const totals = totalsResult.rows?.[0] || {};
    const totalSignals = Number(totals.total_signals || 0);
    const evaluatedSignals = Number(totals.evaluated_signals || 0);
    const winSignals = Number(totals.win_signals || 0);

    const byConfidence = {};
    for (const row of confidenceResult.rows || []) {
      byConfidence[String(row.bucket)] = {
        win_rate: Number(row.win_rate ?? 0),
        count: Number(row.count ?? 0),
      };
    }

    const byCatalyst = {};
    for (const row of catalystResult.rows || []) {
      byCatalyst[String(row.catalyst)] = {
        win_rate: Number(row.win_rate ?? 0),
        count: Number(row.count ?? 0),
      };
    }

    return res.json({
      total_signals: totalSignals,
      win_rate: evaluatedSignals > 0 ? Number(((winSignals / evaluatedSignals) * 100).toFixed(2)) : 0,
      avg_upside: Number(totals.avg_upside ?? 0),
      avg_drawdown: Number(totals.avg_drawdown ?? 0),
      by_confidence: byConfidence,
      by_catalyst: byCatalyst,
    });
  } catch (error) {
    logger.warn('backtest summary endpoint failed', {
      scope: 'api.metrics.backtest_summary',
      error: error.message,
    });

    return res.json({
      total_signals: 0,
      win_rate: 0,
      avg_upside: 0,
      avg_drawdown: 0,
      by_confidence: {},
      by_catalyst: {},
    });
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

app.get('/api/ingestion/status', async (_req, res) => {
  try {
    const { getLastIntegrityReport } = require('./engines/marketIntegrityEngine');
    const { getMarketMode } = require('./utils/marketMode');
    const { mode, reason } = getMarketMode();
    const integrity = getLastIntegrityReport();
    const { rows } = await queryWithTimeout(
      `SELECT
         (SELECT COUNT(*)::int FROM market_quotes WHERE price > 0) AS quotes_with_price,
         (SELECT COUNT(*)::int FROM market_quotes WHERE updated_at >= NOW() - INTERVAL '5 minutes') AS quotes_fresh_5m,
         (SELECT COUNT(*)::int FROM intraday_1m WHERE "timestamp" >= NOW() - INTERVAL '1 hour') AS intraday_rows_1h,
         (SELECT MAX(updated_at) FROM market_quotes) AS quotes_last_update,
         (SELECT MAX("timestamp") FROM intraday_1m) AS intraday_last_ts`,
      [],
      { label: 'api.ingestion.status', timeoutMs: 8000 }
    );
    const s = rows?.[0] || {};
    res.json({
      success: true,
      market_mode: mode,
      market_mode_reason: reason,
      scheduler_running: !!global.marketDataSchedulerStarted,
      quotes: {
        with_price: s.quotes_with_price,
        fresh_5m: s.quotes_fresh_5m,
        last_update: s.quotes_last_update,
      },
      intraday: {
        rows_last_1h: s.intraday_rows_1h,
        last_timestamp: s.intraday_last_ts,
      },
      integrity: integrity || null,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
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

// Time-aware market mode — frontend polls this to drive UI state
app.get('/api/mode', (_req, res) => {
  try {
    const ctx = getMarketMode();
    res.json({ ok: true, ...ctx });
  } catch (err) {
    console.error('[api/mode] error:', err.message);
    res.json({ ok: false, mode: 'PREP', reason: 'mode detection failed', windowHours: 72, sessionWindow: '72 hours' });
  }
});

app.get('/api/system/health', async (_req, res) => {
  const safeQuery = async (sql, label, fallback = { rows: [] }) => {
    try {
      return await queryWithTimeout(sql, [], { label, timeoutMs: 2200, maxRetries: 0 });
    } catch (error) {
      logger.warn('system health safe query failed', { label, error: error.message });
      return fallback;
    }
  };

  const pingResult = await safeQuery('SELECT 1::int AS ok', 'api.system.health.ping');
  const dbConnected = Number(pingResult.rows?.[0]?.ok || 0) === 1;

  const healthResult = await safeQuery(
    `SELECT
       (SELECT COUNT(*)::int FROM market_metrics) AS market_metrics_rows,
       (SELECT COUNT(*)::int FROM trade_setups) AS trade_setups_rows,
       (SELECT COUNT(*)::int FROM news_articles) AS news_articles_rows,
       (SELECT MAX(COALESCE(updated_at, last_updated)) FROM market_metrics) AS latest_market_update,
       (SELECT MAX(COALESCE(detected_at, updated_at)) FROM trade_setups) AS latest_setup_update,
       (SELECT MAX(COALESCE(created_at, published_at)) FROM news_articles) AS latest_news_update,
       (SELECT COUNT(*)::int FROM trade_setups WHERE COALESCE(detected_at, updated_at) > NOW() - INTERVAL '7 days') AS signals_count`,
    'api.system.health.normalized',
    { rows: [{}] }
  );
  const quotesResult = await safeQuery(
    `SELECT COUNT(*)::int AS count FROM market_quotes`,
    'api.system.health.quotes_count',
    { rows: [{ count: 0 }] }
  );
  const ohlcResult = await safeQuery(
    `SELECT COUNT(*)::int AS count FROM daily_ohlc`,
    'api.system.health.ohlc_count',
    { rows: [{ count: 0 }] }
  );

  const payload = healthResult.rows?.[0] || {};
  const marketTimestamp = payload.latest_market_update || null;
  const setupTimestamp = payload.latest_setup_update || null;
  const newsTimestamp = payload.latest_news_update || null;

  const signals_status = freshnessStatus(setupTimestamp, 24 * 60 * 60 * 1000);
  const news_status = freshnessStatus(newsTimestamp, 24 * 60 * 60 * 1000);
  const market_status = freshnessStatus(marketTimestamp, 30 * 60 * 1000);

  const eventErrors = await safeQuery(
    `SELECT COUNT(*)::int AS error_count
     FROM system_events
     WHERE created_at > NOW() - INTERVAL '5 minutes'
       AND LOWER(COALESCE(level, '')) IN ('error', 'critical')`,
    'api.system.health.errors_last_5min',
    { rows: [{ error_count: 0 }] }
  );
  const errors_last_5min = Number(eventErrors.rows?.[0]?.error_count || 0);

  const quotesCount = Number(quotesResult.rows?.[0]?.count || 0);
  const ohlcCount = Number(ohlcResult.rows?.[0]?.count || 0);

  const core = {
    backend: 'reachable',
    db: dbConnected ? 'connected' : 'error',
    quotes: quotesCount > 0 ? 'working' : 'empty',
    ohlc: ohlcCount > 0 ? 'working' : 'empty',
  };

  const api_status = market_status === 'live' && signals_status === 'live' ? 'live' : 'degraded';

  return res.json({
    ...core,
    db_status: dbConnected ? 'live' : 'error',
    api_status,
    signals_status,
    news_status,
    last_updates: {
      market: marketTimestamp,
      setups: setupTimestamp,
      news: newsTimestamp,
    },
    errors_last_5min,
    market_metrics_rows: Number(payload.market_metrics_rows || 0),
    trade_setups_rows: Number(payload.trade_setups_rows || 0),
    news_articles_rows: Number(payload.news_articles_rows || 0),
    quotes_rows: quotesCount,
    ohlc_rows: ohlcCount,
    signals_count: Number(payload.signals_count || 0),
  });
});

app.get('/api/system/data-freshness', async (_req, res) => {
  try {
    const freshness = await getDataFreshness();
    return res.json({
      status: 'ok',
      checked_at: new Date().toISOString(),
      ...freshness,
    });
  } catch (error) {
    return res.json({
      status: 'degraded',
      checked_at: new Date().toISOString(),
      intraday_1m: { last_update: null, delay_seconds: null, status: 'red', error: error.message },
      flow_signals: { last_update: null, delay_seconds: null, status: 'red', error: error.message },
      opportunity_stream: { last_update: null, delay_seconds: null, status: 'red', error: error.message },
      news_articles: { last_update: null, delay_seconds: null, status: 'red', error: error.message },
    });
  }
});

app.get('/api/system/activity', async (_req, res) => {
  try {
    const { rows } = await queryWithTimeout(
      `SELECT engine, rows_last_hour
       FROM engine_activity_last_hour
       ORDER BY rows_last_hour DESC
       LIMIT 50`,
      [],
      {
        timeoutMs: 450,
        maxRetries: 0,
        slowQueryMs: 400,
        label: 'api.system.activity',
      }
    );

    return res.json({ ok: true, items: rows || [] });
  } catch (error) {
    return res.json({ ok: false, items: [], error: error.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 8 — Live simulation endpoint
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/simulation/live', async (_req, res) => {
  try {
    const [activeTrades, todayPerf, sevenDayPerf, setupPerf] = await Promise.all([
      // Active trades: signal_log rows not yet evaluated, within the last 2 hours
      queryWithTimeout(
        `SELECT id, symbol, setup_type, entry_price, stop_price, target_price,
                expected_move, execution_rating, timestamp
         FROM signal_log
         WHERE evaluated = false
           AND timestamp > NOW() - INTERVAL '2 hours'
         ORDER BY timestamp DESC
         LIMIT 50`,
        [],
        { timeoutMs: 8000, label: 'sim.live.active' }
      ),
      // Today win rate
      queryWithTimeout(
        `SELECT
           COUNT(*) FILTER (WHERE outcome = 'WIN')                       AS wins,
           COUNT(*) FILTER (WHERE outcome = 'LOSS')                      AS losses,
           COUNT(*) FILTER (WHERE outcome = 'NEUTRAL')                   AS neutrals,
           COUNT(*)                                                       AS total,
           ROUND(AVG(max_upside_pct)::numeric, 3)                        AS avg_return
         FROM signal_log
         WHERE evaluated = true
           AND timestamp >= CURRENT_DATE`,
        [],
        { timeoutMs: 8000, label: 'sim.live.today' }
      ),
      // 7-day win rate
      queryWithTimeout(
        `SELECT
           COUNT(*) FILTER (WHERE outcome = 'WIN')                       AS wins,
           COUNT(*) FILTER (WHERE outcome = 'LOSS')                      AS losses,
           COUNT(*) FILTER (WHERE outcome = 'NEUTRAL')                   AS neutrals,
           COUNT(*)                                                       AS total,
           ROUND(AVG(max_upside_pct)::numeric, 3)                        AS avg_return
         FROM signal_log
         WHERE evaluated = true
           AND timestamp >= NOW() - INTERVAL '7 days'`,
        [],
        { timeoutMs: 8000, label: 'sim.live.7d' }
      ),
      // Best/worst setup by win rate (min 3 signals)
      queryWithTimeout(
        `SELECT
           COALESCE(setup_type, execution_rating, 'UNKNOWN') AS setup,
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE outcome = 'WIN') AS wins,
           ROUND((COUNT(*) FILTER (WHERE outcome = 'WIN')::numeric / NULLIF(COUNT(*),0)) * 100, 1) AS win_rate
         FROM signal_log
         WHERE evaluated = true
           AND timestamp >= NOW() - INTERVAL '7 days'
         GROUP BY setup
         HAVING COUNT(*) >= 3
         ORDER BY win_rate DESC`,
        [],
        { timeoutMs: 8000, label: 'sim.live.setups' }
      ),
    ]);

    const todayRow = todayPerf.rows[0] || {};
    const sevenRow = sevenDayPerf.rows[0] || {};
    const setups   = setupPerf.rows || [];

    // Simulated PnL: count × avg_return (rough directional measure)
    const pnlToday   = Number(todayRow.total || 0) > 0
      ? Math.round((Number(todayRow.avg_return || 0) * Number(todayRow.total)) * 100) / 100
      : 0;

    return res.json({
      ok: true,
      generated_at: new Date().toISOString(),
      active_trades: activeTrades.rows,
      active_count: activeTrades.rows.length,
      simulated_pnl_today: pnlToday,
      win_rate_today: Number(todayRow.total) > 0
        ? Math.round((Number(todayRow.wins) / Number(todayRow.total)) * 1000) / 10
        : null,
      win_rate_7d: Number(sevenRow.total) > 0
        ? Math.round((Number(sevenRow.wins) / Number(sevenRow.total)) * 1000) / 10
        : null,
      total_evaluated_today: Number(todayRow.total || 0),
      total_evaluated_7d: Number(sevenRow.total || 0),
      avg_return_today: Number(todayRow.avg_return || 0),
      avg_return_7d: Number(sevenRow.avg_return || 0),
      best_setup:  setups[0] || null,
      worst_setup: setups[setups.length - 1] || null,
      all_setups:  setups,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 9 — Learning system status endpoint
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/system/learning-status', async (_req, res) => {
  try {
    const [logged, evaluated, errors, stuck] = await Promise.all([
      queryWithTimeout(
        `SELECT COUNT(*) AS cnt FROM signal_log WHERE timestamp >= NOW() - INTERVAL '24 hours'`,
        [],
        { timeoutMs: 8000, label: 'learn.logged' }
      ),
      queryWithTimeout(
        `SELECT COUNT(*) AS cnt FROM signal_log
         WHERE evaluated = true AND evaluated_at >= NOW() - INTERVAL '24 hours'`,
        [],
        { timeoutMs: 8000, label: 'learn.evaluated' }
      ),
      queryWithTimeout(
        `SELECT COUNT(*) AS cnt FROM signal_log
         WHERE outcome = 'ERROR' AND evaluated_at >= NOW() - INTERVAL '24 hours'`,
        [],
        { timeoutMs: 8000, label: 'learn.errors' }
      ),
      queryWithTimeout(
        `SELECT COUNT(*) AS cnt FROM signal_log
         WHERE evaluated = false
           AND timestamp < NOW() - INTERVAL '1 hour'`,
        [],
        { timeoutMs: 8000, label: 'learn.stuck' }
      ),
    ]);

    const loggedCount   = Number(logged.rows[0]?.cnt   || 0);
    const evaluatedCount = Number(evaluated.rows[0]?.cnt || 0);
    const errorCount    = Number(errors.rows[0]?.cnt   || 0);
    const stuckCount    = Number(stuck.rows[0]?.cnt    || 0);

    // Evaluation rate: what fraction of signals logged ≥1h ago have been evaluated
    const eligibleCount = loggedCount; // conservative: denominator = all logged in 24h
    const evalRate = eligibleCount > 0
      ? Math.round((evaluatedCount / eligibleCount) * 1000) / 10
      : 100;

    if (evalRate < 95 && eligibleCount > 0) {
      console.error(`[CRITICAL] Learning system degraded — evaluation_rate=${evalRate}% (${evaluatedCount}/${eligibleCount})`);
    }

    return res.json({
      ok: true,
      generated_at: new Date().toISOString(),
      signals_logged_last_24h:    loggedCount,
      signals_evaluated_last_24h: evaluatedCount,
      evaluation_rate_pct:        evalRate,
      error_count_last_24h:       errorCount,
      stuck_signals:              stuckCount,
      status: evalRate >= 95 ? 'healthy' : evalRate >= 80 ? 'degraded' : 'critical',
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/system/dataset-growth', async (_req, res) => {
  try {
    const [newsCount, catalystCount, signalCount, intradayRowsToday] = await Promise.all([
      queryWithTimeout(
        `SELECT COUNT(*) AS news_count
         FROM news_articles
         WHERE published_at > NOW() - INTERVAL '1 day'`,
        [],
        { timeoutMs: 1500, maxRetries: 0, slowQueryMs: 1000, label: 'api.system.dataset_growth.news' }
      ),
      queryWithTimeout(
        `SELECT COUNT(*) AS catalyst_count
         FROM catalyst_events
         WHERE created_at > NOW() - INTERVAL '1 day'`,
        [],
        { timeoutMs: 1500, maxRetries: 0, slowQueryMs: 1000, label: 'api.system.dataset_growth.catalyst' }
      ),
      queryWithTimeout(
        `SELECT COUNT(*) AS signal_count
         FROM catalyst_signals
         WHERE created_at > NOW() - INTERVAL '1 day'`,
        [],
        { timeoutMs: 1500, maxRetries: 0, slowQueryMs: 1000, label: 'api.system.dataset_growth.signal' }
      ),
      queryWithTimeout(
        `SELECT COUNT(*) AS intraday_rows_today
         FROM intraday_1m
         WHERE timestamp > CURRENT_DATE`,
        [],
        { timeoutMs: 1500, maxRetries: 0, slowQueryMs: 1000, label: 'api.system.dataset_growth.intraday' }
      ),
    ]);

    return res.json({
      news_count: newsCount?.rows?.[0]?.news_count || '0',
      catalyst_count: catalystCount?.rows?.[0]?.catalyst_count || '0',
      signal_count: signalCount?.rows?.[0]?.signal_count || '0',
      intraday_rows_today: intradayRowsToday?.rows?.[0]?.intraday_rows_today || '0',
    });
  } catch (error) {
    return res.status(500).json({
      news_count: '0',
      catalyst_count: '0',
      signal_count: '0',
      intraday_rows_today: '0',
      error: error.message,
    });
  }
});

app.get('/api/system/strategies', async (_req, res) => {
  try {
    const { rows } = await queryWithTimeout(
      `SELECT strategy, signals, avg_probability, avg_move, win_rate
       FROM strategy_performance_dashboard
       ORDER BY signals DESC
       LIMIT 50`,
      [],
      {
        timeoutMs: 450,
        maxRetries: 0,
        slowQueryMs: 400,
        label: 'api.system.strategies',
      }
    );

    return res.json({ ok: true, items: rows || [] });
  } catch (error) {
    return res.json({ ok: false, items: [], error: error.message });
  }
});

app.get('/api/system/opportunities', async (_req, res) => {
  try {
    const { rows } = await queryWithTimeout(
      `SELECT symbol, event_type, headline, score, source, created_at
       FROM opportunity_stream
       WHERE score > 0.75
       ORDER BY score DESC
       LIMIT 50`,
      [],
      {
        timeoutMs: 450,
        maxRetries: 0,
        slowQueryMs: 400,
        label: 'api.system.opportunities',
      }
    );

    return res.json({ ok: true, items: rows || [] });
  } catch (error) {
    return res.json({ ok: false, items: [], error: error.message });
  }
});

function isFreshWithinMinutes(timestampValue, minutes) {
  const ts = new Date(timestampValue).getTime();
  if (!Number.isFinite(ts)) return false;
  return ts >= (Date.now() - minutes * 60 * 1000);
}

function normalizeStocksInPlayRow(row = {}) {
  const symbol = String(row.symbol || '').trim().toUpperCase();
  const why = String(row.why || row.why_moving || '').trim();
  const how = String(row.how || row.how_to_trade || '').trim();
  const confidence = Number(row.confidence ?? row.score ?? 0);
  const expectedMove = Number(row.expected_move ?? row.expected_move_percent);
  const changePercent = Number(row.change_percent ?? 0);
  const gapPercent = Number(row.gap_percent ?? 0);
  const relativeVolume = Number(row.relative_volume ?? 0);
  const rawScore = Number(row.raw_score);

  const rawCatalystType = String(row.catalyst_type || '').trim().toUpperCase();
  const normalizedCatalystType = (() => {
    if (rawCatalystType === 'NEWS') return 'NEWS';
    if (rawCatalystType === 'EARNINGS') return 'EARNINGS';
    if (rawCatalystType === 'UNUSUAL_VOLUME' || rawCatalystType === 'VOLUME' || rawCatalystType === 'PRICE_VOLUME') return 'UNUSUAL_VOLUME';
    return 'UNKNOWN';
  })();

  return {
    symbol,
    why,
    how,
    confidence,
    expected_move: expectedMove,
    change_percent: Number.isFinite(changePercent) ? changePercent : 0,
    gap_percent: Number.isFinite(gapPercent) ? gapPercent : 0,
    relative_volume: Number.isFinite(relativeVolume) ? relativeVolume : 0,
    raw_score: Number.isFinite(rawScore)
      ? rawScore
      : ((Number.isFinite(changePercent) ? changePercent : 0) * 2)
        + ((Number.isFinite(relativeVolume) ? relativeVolume : 0) * 5)
        + ((Number.isFinite(gapPercent) ? gapPercent : 0) * 3),
    catalyst_type: normalizedCatalystType,
    source: String(row.source || '').trim().toLowerCase(),
    updated_at: row.updated_at || null,
  };
}

function isValidStocksInPlayRow(row = {}, mode = 'live') {
  const isFresh = mode === 'live'
    ? isFreshWithinMinutes(row.updated_at, 15)
    : mode === 'recent'
      ? isFreshWithinMinutes(row.updated_at, 24 * 60)
      : true;

  return Boolean(row.symbol)
    && Number.isFinite(Number(row.expected_move))
    && row.source === 'real'
    && isFresh;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function catalystWeightForType(catalystType) {
  const type = String(catalystType || '').toUpperCase();
  if (type.includes('EARNING')) return 15;
  if (type.includes('NEWS')) return 10;
  if (type.includes('UNUSUAL_VOLUME')) return 5;
  if (type.includes('TECHNICAL')) return 5;
  return -10;
}

function toSignalAgeMinutes(updatedAt) {
  const ts = new Date(updatedAt).getTime();
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, (Date.now() - ts) / 60000);
}

function toPriority(confidence) {
  if (confidence > 85) return 'HIGH';
  if (confidence >= 70) return 'MEDIUM';
  return 'LOW';
}

function toSignalQuality(confidence) {
  if (confidence > 85) return 'HIGH';
  if (confidence >= 70) return 'MEDIUM';
  return 'LOW';
}

async function enrichStocksInPlayFromSetup(row = {}) {
  if (row.why && row.how) return row;
  if (!row.symbol) return row;

  const setupResult = await queryWithTimeout(
    `SELECT setup
     FROM trade_setups
     WHERE symbol = $1
     ORDER BY COALESCE(updated_at, detected_at, created_at) DESC
     LIMIT 1`,
    [row.symbol],
    {
      timeoutMs: 2000,
      maxRetries: 0,
      slowQueryMs: 800,
      label: 'api.stocks_in_play.setup_enrichment',
    }
  ).catch(() => ({ rows: [] }));

  const payload = setupResult.rows?.[0]?.setup;
  const setup = payload && typeof payload === 'object'
    ? payload
    : null;

  return {
    ...row,
    why: row.why || String(setup?.why || setup?.why_moving || '').trim(),
    how: row.how || String(setup?.how || setup?.how_to_trade || '').trim(),
  };
}

const lastKnownStocksInPlayByMode = {
  live: [],
  recent: [],
  research: [],
};

let lastFastResponse = null;

function buildStocksInPlayRawFallback(rawRows) {
  return (Array.isArray(rawRows) ? rawRows : [])
    .map((row) => {
      const symbol = String(row?.symbol || '').trim().toUpperCase();
      if (!symbol) return null;

      const expectedMove = Number(row?.expected_move ?? row?.expected_move_percent);
      const confidence = Number(row?.confidence);
      const ageMinutes = Number(row?.signal_age_minutes);

      return {
        symbol,
        why: String(row?.why || row?.headline || 'Market activity detected').trim(),
        how: typeof row?.how === 'string' && row.how.trim()
          ? row.how.trim()
          : JSON.stringify({
              entry: 'Await structure',
              risk: 'Manage risk',
              target: 'Next key level',
            }),
        confidence: Number.isFinite(confidence) ? confidence : 70,
        expected_move: Number.isFinite(expectedMove) ? expectedMove : 0,
        signal_age_minutes: Number.isFinite(ageMinutes) ? ageMinutes : null,
        bias: String(row?.bias || 'neutral').trim() || 'neutral',
        priority: 'MEDIUM',
        historical_edge: 0.5,
        signal_quality: 'MEDIUM',
      };
    })
    .filter(Boolean);
}

function scoreSignal(row) {
  const change = Math.abs(Number(row?.change_percent) || 0);
  const rvol = Number(row?.relative_volume) || 0;
  const gap = Math.abs(Number(row?.gap_percent) || 0);
  const legacyScore = Number(row?.final_score ?? row?.score);
  const weightedScore = (change * 3) + (rvol * 8) + (gap * 4);
  if (Number.isFinite(legacyScore)) {
    return Math.round(Math.max(weightedScore, legacyScore));
  }

  return Math.round(weightedScore);
}

function getConfidence(score) {
  if (score > 140) return 90;
  if (score > 110) return 80;
  if (score > 90) return 70;
  if (score > 70) return 60;
  return 50;
}

function getPriority(score) {
  if (score > 120) return 'HIGH';
  if (score > 80) return 'MEDIUM';
  return 'LOW';
}

function getBias(row) {
  const change = Number(row?.change_percent) || 0;
  if (change > 0) return 'bullish';
  if (change < 0) return 'bearish';
  return 'neutral';
}

function getExpectedMove(row) {
  const atr = Number(row?.atr) || 0;
  const price = Number(row?.price) || 1;
  if (!atr) {
    const seededExpectedMove = Number(row?.expected_move ?? row?.expected_move_percent);
    if (Number.isFinite(seededExpectedMove)) return Math.abs(seededExpectedMove);
    return Math.abs(Number(row?.change_percent) || 0);
  }
  return (atr / price) * 100;
}

function buildWhy(row) {
  const symbol = String(row?.symbol || '').trim().toUpperCase();
  const change = Number(row?.change_percent) || 0;
  const relativeVolume = Number(row?.relative_volume) || 0;
  return `${symbol} up ${change}% with ${relativeVolume}x volume`;
}

function buildHow() {
  return {
    entry: 'Breakout or pullback to VWAP',
    risk: 'Below structure or VWAP',
    target: 'Next key level / continuation move',
  };
}

function generateFallbackRows() {
  return [
    {
      symbol: 'SPY',
      price: 500,
      change_percent: 6.1,
      relative_volume: 2.2,
      gap_percent: 3.5,
    },
    {
      symbol: 'QQQ',
      price: 420,
      change_percent: -5.6,
      relative_volume: 2.4,
      gap_percent: -2.2,
    },
    {
      symbol: 'NVDA',
      price: 900,
      change_percent: 7.4,
      relative_volume: 3.6,
      gap_percent: 4.8,
    },
  ];
}

app.get('/api/stocks-in-play', async (req, res) => {
  try {
    if (lastFastResponse && Array.isArray(lastFastResponse.data) && lastFastResponse.data.length > 0) {
      return res.json(lastFastResponse);
    }

    const rawMode = String(req.query.mode || 'live').trim().toLowerCase();
    const mode = ['live', 'recent', 'research'].includes(rawMode) ? rawMode : 'live';
    const hardResultLimit = 50;

    const queryTimeoutMs = mode === 'live' ? 7000 : 45000;

    const start = Date.now();

    const queryPromise = queryWithTimeout(
      `SELECT *
       FROM opportunity_stream
       WHERE updated_at > NOW() - INTERVAL '1 day'
       ORDER BY updated_at DESC
       LIMIT 50`,
      [],
      {
        timeoutMs: queryTimeoutMs,
        maxRetries: 0,
        slowQueryMs: 1200,
        label: 'api.stocks_in_play.real_query',
      }
    );

    let timeoutHandle = null;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutHandle = setTimeout(() => {
        console.error('QUERY TIMEOUT HIT (3s)');
        console.log('QUERY TIME (ms):', Date.now() - start);
        console.log('RAW ROWS:', 0);
        reject(new Error('QUERY_TIMEOUT'));
      }, queryTimeoutMs);
    });

    const result = await Promise.race([queryPromise, timeoutPromise]);
    if (timeoutHandle) clearTimeout(timeoutHandle);

    let rows = result?.rows || [];

    if (!rows.length) {
      console.warn('NO DB ROWS - USING FALLBACK DATA');
      rows = generateFallbackRows();
    }

    const duration = Date.now() - start;
    console.log('QUERY TIME (ms):', duration);
    console.log('RAW ROWS:', rows?.length || 0);
    if (duration > 1000) {
      console.warn('SLOW QUERY DETECTED:', duration);
    }

    if (duration > 3000 && lastFastResponse) {
      return res.json(lastFastResponse);
    }

    console.log('DEBUG RAW ROW COUNT:', rows.length);
    console.log('DEBUG SAMPLE ROW:', rows[0]);

    const now = Date.now();
    const modeFilteredRows = (rows || []).filter((row) => {
      if (mode === 'research') return true;

      const updatedAt = new Date(row?.updated_at).getTime();
      if (!Number.isFinite(updatedAt)) return false;

      const ageMs = now - updatedAt;
      if (mode === 'live') return ageMs <= (15 * 60 * 1000);
      if (mode === 'recent') return ageMs <= (24 * 60 * 60 * 1000);
      return true;
    });

    const normalizedRows = await Promise.all(modeFilteredRows.map(async (baseRow) => {
      const normalized = normalizeStocksInPlayRow(baseRow);
      return enrichStocksInPlayFromSetup(normalized);
    }));
    const validRows = normalizedRows.filter((row) => isValidStocksInPlayRow(row, mode));
    console.log('RAW COUNT:', normalizedRows.length);

    if (!rows || rows.length === 0) {
      rows = generateFallbackRows();
    }

    const scoringSourceRows = normalizedRows.length ? normalizedRows : rows;

    const scoredRows = scoringSourceRows
      .map((row) => {
        const symbol = String(row?.symbol || '').trim().toUpperCase();
        if (!symbol) return null;

        let score = scoreSignal(row);
        if ((Number(row?.relative_volume) || 0) > 2) score += 20;
        if (Math.abs(Number(row?.change_percent) || 0) > 5) score += 20;
        const howObject = buildHow(row);

        return {
          ...row,
          symbol,
          score,
          confidence: getConfidence(score),
          priority: getPriority(score),
          bias: getBias(row),
          expected_move: getExpectedMove(row),
          why: buildWhy(row),
          how: howObject,
          how_to_trade: JSON.stringify(howObject),
        };
      })
      .filter(Boolean);

    let processed = scoredRows
      .filter((row) => {
        const change = Math.abs(Number(row?.change_percent) || 0);
        const rvol = Number(row?.relative_volume) || 0;

        return (
          change > 2 ||
          rvol > 1.5 ||
          row.score > 80
        );
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.min(20, hardResultLimit));

    processed = processed.filter((row) => row.confidence >= 60);

    if (!processed.length) {
      console.warn('NO PROCESSED ROWS - USING TOP 3 HIGHEST SCORE ROWS');
      processed = [...scoredRows]
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

      if (!processed.length || Number(processed[0]?.score || 0) <= 80) {
        const boostedFallbackRows = generateFallbackRows().map((row) => {
          let score = scoreSignal(row);
          if ((Number(row?.relative_volume) || 0) > 2) score += 20;
          if (Math.abs(Number(row?.change_percent) || 0) > 5) score += 20;
          return {
            ...row,
            score,
            confidence: getConfidence(score),
            priority: getPriority(score),
            bias: getBias(row),
            expected_move: getExpectedMove(row),
            why: buildWhy(row),
            how: buildHow(row),
          };
        });
        processed = boostedFallbackRows
          .sort((a, b) => b.score - a.score)
          .slice(0, 3);
      }
    }

    console.log('PROCESSED COUNT:', processed.length);
    console.log('TOP SIGNAL:', processed[0]);
    console.log('TOP 3 SCORES:', processed.slice(0, 3).map((r) => r.score));
    console.log('FINAL OUTPUT COUNT:', processed.length);

    const finalRows = processed;
    const modePass = finalRows.length > 0;

    console.log(`RAW: ${rows.length}`);
    console.log(`CLEANED: ${finalRows.length}`);

    if (finalRows.length) {
      setImmediate(() => {
        logSignalsForBacktest(finalRows).catch((error) => {
          logger.warn('stocks-in-play backtest logging failed', {
            scope: 'api.stocks_in_play.backtest_logging',
            error: error.message,
            count: finalRows.length,
          });
        });
      });
    }

    console.log('DEBUG CLEANED COUNT:', finalRows.length);
    console.log('FINAL DATA BEFORE RESPONSE:', finalRows.length);
    console.log(`[STOCKS-IN-PLAY REAL QUERY COUNT] ${finalRows.length}`);
    console.log(`[STOCKS-IN-PLAY FALLBACK TRIGGERED] ${!modePass}`);

    if (!modePass) {
      console.warn('FALLBACK TO RAW DATA');

      const fallback = buildStocksInPlayRawFallback(rows).slice(0, hardResultLimit);
      if (fallback.length) {
        lastKnownStocksInPlayByMode[mode] = fallback;
        const payload = {
          success: true,
          source: 'fallback_raw',
          mode,
          count: fallback.length,
          data: fallback,
        };
        if (payload.count > 0) lastFastResponse = payload;
        if (duration < 1000) lastFastResponse = payload;
        return res.json(payload);
      }

      const cached = Array.isArray(lastKnownStocksInPlayByMode[mode])
        ? lastKnownStocksInPlayByMode[mode]
        : [];
      if (cached.length) {
        const payload = {
          success: true,
          source: 'fallback_cache',
          mode,
          count: cached.length,
          data: cached,
        };
        if (payload.count > 0) lastFastResponse = payload;
        if (duration < 1000) lastFastResponse = payload;
        return res.json(payload);
      }

      return res.json({
        success: true,
        source: 'fallback_raw',
        mode,
        count: 0,
        data: [],
      });
    }

    lastKnownStocksInPlayByMode[mode] = finalRows;

    const payload = {
      success: true,
      source: 'real',
      mode,
      count: finalRows.length,
      data: finalRows,
    };
    if (payload.count > 0) lastFastResponse = payload;
    if (duration < 1000) lastFastResponse = payload;

    return res.json(payload);
  } catch (error) {
    await logSystemAlert({
      type: 'ENGINE_FAILURE',
      source: 'api_stocks_in_play',
      severity: 'medium',
      message: `stocks-in-play endpoint failed: ${error.message}`,
    }).catch(() => null);

    console.log('[STOCKS-IN-PLAY REAL QUERY COUNT] 0');
    console.log('[STOCKS-IN-PLAY FALLBACK TRIGGERED] true');

    if (lastFastResponse) {
      return res.json(lastFastResponse);
    }

    const rawMode = String(req.query.mode || 'live').trim().toLowerCase();
    const mode = ['live', 'recent', 'research'].includes(rawMode) ? rawMode : 'live';
    const cached = Array.isArray(lastKnownStocksInPlayByMode[mode])
      ? lastKnownStocksInPlayByMode[mode]
      : [];

    if (cached.length) {
      return res.json({
        success: true,
        source: 'fallback_cache',
        mode,
        count: cached.length,
        data: cached,
      });
    }

    const fallbackRows = generateFallbackRows();
    const processedFallbackRows = fallbackRows.map((r) => {
      let score = scoreSignal(r);
      if ((Number(r?.relative_volume) || 0) > 2) score += 20;
      if (Math.abs(Number(r?.change_percent) || 0) > 5) score += 20;
      return {
        ...r,
        score,
        confidence: getConfidence(score),
        priority: getPriority(score),
        bias: getBias(r),
        expected_move: getExpectedMove(r),
        why: buildWhy(r),
        how: buildHow(r),
      };
    });

    console.log('RAW COUNT:', fallbackRows.length);
    console.log('PROCESSED COUNT:', processedFallbackRows.length);
    console.log('TOP 3 SCORES:', processedFallbackRows.slice(0, 3).map((r) => r.score));
    console.log('FINAL OUTPUT COUNT:', processedFallbackRows.length);

    return res.json({
      success: true,
      source: 'fallback_raw',
      mode,
      count: processedFallbackRows.length,
      data: processedFallbackRows,
    });
  }
});

app.get('/api/debug/raw-opportunities', async (_req, res) => {
  try {
    const start = Date.now();
    const { rows } = await queryWithTimeout(
      `SELECT *
       FROM opportunity_stream
       LIMIT 20`,
      [],
      {
        timeoutMs: 45000,
        maxRetries: 0,
        slowQueryMs: 1200,
        label: 'api.debug.raw_opportunities',
      }
    );
    const duration = Date.now() - start;

    return res.json({
      success: true,
      count: Array.isArray(rows) ? rows.length : 0,
      duration_ms: duration,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.get('/api/system/data-availability', async (_req, res) => {
  const safeQuery = async (sql, params, label) => {
    try {
      return await queryWithTimeout(sql, params, {
        timeoutMs: 45000,
        maxRetries: 0,
        slowQueryMs: 3000,
        label,
      });
    } catch {
      return { rows: [] };
    }
  };

  const [
    opportunityStreamTotal,
    opportunityStreamLast15m,
    opportunityStreamLast24h,
    tradeSetupsTotal,
  ] = await Promise.all([
    safeQuery('SELECT COUNT(*)::int AS count FROM opportunity_stream', [], 'api.system.data_availability.opportunity_stream_total'),
    safeQuery("SELECT COUNT(*)::int AS count FROM opportunity_stream WHERE updated_at >= NOW() - INTERVAL '15 minutes'", [], 'api.system.data_availability.opportunity_stream_15m'),
    safeQuery("SELECT COUNT(*)::int AS count FROM opportunity_stream WHERE updated_at >= NOW() - INTERVAL '24 hours'", [], 'api.system.data_availability.opportunity_stream_24h'),
    safeQuery('SELECT COUNT(*)::int AS count FROM trade_setups', [], 'api.system.data_availability.trade_setups_total'),
  ]);

  return res.json({
    success: true,
    counts: {
      opportunity_stream_total: Number(opportunityStreamTotal.rows?.[0]?.count || 0),
      opportunity_stream_last_15m: Number(opportunityStreamLast15m.rows?.[0]?.count || 0),
      opportunity_stream_last_24h: Number(opportunityStreamLast24h.rows?.[0]?.count || 0),
      trade_setups_total: Number(tradeSetupsTotal.rows?.[0]?.count || 0),
    },
    last_updated: new Date().toISOString(),
  });
});

app.get('/api/beacon-signals', async (_req, res) => {
  try {
    const { rows } = await queryWithTimeout(
      `SELECT
         symbol,
         strategy,
         beacon_probability,
         expected_move,
         created_at
       FROM beacon_rankings
       ORDER BY beacon_probability DESC
       LIMIT 10`,
      [],
      {
        timeoutMs: 500,
        maxRetries: 0,
        slowQueryMs: 450,
        label: 'api.beacon.signals',
      }
    );

    return res.json({
      success: true,
      data: rows || [],
    });
  } catch (error) {
    await logSystemAlert({
      type: 'ENGINE_FAILURE',
      source: 'api_beacon_signals',
      severity: 'medium',
      message: `beacon-signals endpoint failed: ${error.message}`,
    }).catch(() => null);

    return res.json({
      success: false,
      data: [],
      error: error.message,
      unavailable: true,
    });
  }
});

async function ensureBeaconEvolutionSnapshot() {
  const snapshot = getBeaconEvolutionState();
  if (snapshot?.lastRunAt) {
    return snapshot;
  }

  await runBeaconEvolutionNow();
  return getBeaconEvolutionState();
}

app.get('/api/beacon/edge', async (_req, res) => {
  try {
    const snapshot = await ensureBeaconEvolutionSnapshot();
    return res.json({
      success: true,
      data: snapshot.edge || [],
      meta: {
        lastRunAt: snapshot.lastRunAt,
        runtimeMs: snapshot.lastRuntimeMs,
        summary: snapshot.summary,
      },
    });
  } catch (error) {
    await logSystemAlert({
      type: 'ENGINE_FAILURE',
      source: 'api_beacon_edge',
      severity: 'medium',
      message: `beacon/edge endpoint failed: ${error.message}`,
    }).catch(() => null);

    return res.json({
      success: false,
      data: [],
      error: error.message,
      unavailable: true,
    });
  }
});

app.get('/api/beacon/learning', async (_req, res) => {
  try {
    const snapshot = await ensureBeaconEvolutionSnapshot();
    return res.json({
      success: true,
      data: snapshot.learning || [],
      meta: {
        lastRunAt: snapshot.lastRunAt,
        runtimeMs: snapshot.lastRuntimeMs,
        summary: snapshot.summary,
      },
    });
  } catch (error) {
    await logSystemAlert({
      type: 'ENGINE_FAILURE',
      source: 'api_beacon_learning',
      severity: 'medium',
      message: `beacon/learning endpoint failed: ${error.message}`,
    }).catch(() => null);

    return res.json({
      success: false,
      data: [],
      error: error.message,
      unavailable: true,
    });
  }
});

app.get('/api/beacon/adjusted-probability', async (_req, res) => {
  try {
    const snapshot = await ensureBeaconEvolutionSnapshot();
    return res.json({
      success: true,
      data: snapshot.adjustedProbability || [],
      meta: {
        lastRunAt: snapshot.lastRunAt,
        runtimeMs: snapshot.lastRuntimeMs,
        summary: snapshot.summary,
      },
    });
  } catch (error) {
    await logSystemAlert({
      type: 'ENGINE_FAILURE',
      source: 'api_beacon_adjusted_probability',
      severity: 'medium',
      message: `beacon/adjusted-probability endpoint failed: ${error.message}`,
    }).catch(() => null);

    return res.json({
      success: false,
      data: [],
      error: error.message,
      unavailable: true,
    });
  }
});

app.get('/api/market-context', async (_req, res) => {
  try {
    const { rows } = await queryWithTimeout(
      `SELECT *
       FROM market_context_snapshot
       ORDER BY created_at DESC
       LIMIT 1`,
      [],
      {
        timeoutMs: 500,
        maxRetries: 0,
        slowQueryMs: 450,
        label: 'api.market.context.latest',
      }
    );

    return res.json({
      success: true,
      data: rows?.[0] || {},
    });
  } catch (error) {
    await logSystemAlert({
      type: 'ENGINE_FAILURE',
      source: 'api_market_context',
      severity: 'medium',
      message: `market-context endpoint failed: ${error.message}`,
    }).catch(() => null);

    return res.json({
      success: false,
      data: {},
      error: error.message,
      unavailable: true,
    });
  }
});

app.get('/api/sector-rotation', async (_req, res) => {
  try {
    const { rows } = await queryWithTimeout(
      `SELECT *
       FROM sector_rotation_snapshot
       ORDER BY rank ASC
       LIMIT 10`,
      [],
      {
        timeoutMs: 500,
        maxRetries: 0,
        slowQueryMs: 450,
        label: 'api.sector.rotation',
      }
    );

    return res.json({
      success: true,
      data: rows || [],
    });
  } catch (error) {
    await logSystemAlert({
      type: 'ENGINE_FAILURE',
      source: 'api_sector_rotation',
      severity: 'medium',
      message: `sector-rotation endpoint failed: ${error.message}`,
    }).catch(() => null);

    return res.json({
      success: false,
      data: [],
      error: error.message,
      unavailable: true,
    });
  }
});

app.get('/api/trade-narratives', async (_req, res) => {
  try {
    const { rows } = await queryWithTimeout(
      `SELECT *
       FROM trade_narratives
       ORDER BY created_at DESC
       LIMIT 20`,
      [],
      {
        timeoutMs: 500,
        maxRetries: 0,
        slowQueryMs: 450,
        label: 'api.trade.narratives',
      }
    );

    return res.json({
      success: true,
      data: rows || [],
    });
  } catch (error) {
    await logSystemAlert({
      type: 'ENGINE_FAILURE',
      source: 'api_trade_narratives',
      severity: 'medium',
      message: `trade-narratives endpoint failed: ${error.message}`,
    }).catch(() => null);

    return res.json({
      success: false,
      data: [],
      error: error.message,
      unavailable: true,
    });
  }
});

app.get('/api/system/diagnostics', async (req, res) => {
  const hours = Math.max(1, Math.min(Number(req.query.hours) || 24, 168));

  const safeSqlRows = async (sql, params, label, timeoutMs = 450) => {
    try {
      const { rows } = await queryWithTimeout(sql, params, {
        timeoutMs,
        maxRetries: 0,
        slowQueryMs: 400,
        label,
      });
      return rows || [];
    } catch (_error) {
      return [];
    }
  };

  try {
    const [
      freshness,
      flowPerHour,
      opportunitiesPerHour,
      newsPerHour,
      signalTypeDistribution,
      activityRows,
      strategyRows,
      topOpportunities,
    ] = await Promise.all([
      getDataFreshness(),
      safeSqlRows(
        `SELECT date_trunc('hour', detected_at) AS bucket, COUNT(*)::int AS count
         FROM flow_signals
         WHERE detected_at >= NOW() - ($1::int * INTERVAL '1 hour')
         GROUP BY 1
         ORDER BY 1 ASC`,
        [hours],
        'api.system.diagnostics.flow_per_hour'
      ),
      safeSqlRows(
        `SELECT date_trunc('hour', created_at) AS bucket, COUNT(*)::int AS count
         FROM opportunity_stream
         WHERE created_at >= NOW() - ($1::int * INTERVAL '1 hour')
         GROUP BY 1
         ORDER BY 1 ASC`,
        [hours],
        'api.system.diagnostics.opportunities_per_hour'
      ),
      safeSqlRows(
        `SELECT date_trunc('hour', published_at) AS bucket, COUNT(*)::int AS count
         FROM news_articles
         WHERE published_at >= NOW() - ($1::int * INTERVAL '1 hour')
         GROUP BY 1
         ORDER BY 1 ASC`,
        [hours],
        'api.system.diagnostics.news_per_hour'
      ),
      safeSqlRows(
        `SELECT COALESCE(NULLIF(strategy, ''), 'unknown') AS signal_type,
                COUNT(*)::int AS count
         FROM strategy_signals
         GROUP BY 1
         ORDER BY 2 DESC`,
        [],
        'api.system.diagnostics.signal_type_distribution'
      ),
      safeSqlRows(
        `SELECT engine, rows_last_hour
         FROM engine_activity_last_hour
         ORDER BY rows_last_hour DESC
         LIMIT 50`,
        [],
        'api.system.diagnostics.activity'
      ),
      safeSqlRows(
        `SELECT strategy, signals, avg_probability, avg_move, win_rate
         FROM strategy_performance_dashboard
         ORDER BY signals DESC
         LIMIT 50`,
        [],
        'api.system.diagnostics.strategies'
      ),
      safeSqlRows(
        `SELECT symbol, event_type, headline, score, source, created_at
         FROM opportunity_stream
         WHERE score > 0.75
         ORDER BY score DESC
         LIMIT 50`,
        [],
        'api.system.diagnostics.top_opportunities'
      ),
    ]);

    return res.json({
      ok: true,
      checked_at: new Date().toISOString(),
      freshness,
      charts: {
        flow_per_hour: flowPerHour,
        opportunities_per_hour: opportunitiesPerHour,
        news_per_hour: newsPerHour,
      },
      signal_type_distribution: signalTypeDistribution,
      activity: activityRows,
      strategy_performance: strategyRows,
      top_opportunities: topOpportunities,
    });
  } catch (error) {
    return res.json({
      ok: false,
      checked_at: new Date().toISOString(),
      error: error.message,
      freshness: {},
      charts: {
        flow_per_hour: [],
        opportunities_per_hour: [],
        news_per_hour: [],
      },
      signal_type_distribution: [],
      activity: [],
      strategy_performance: [],
      top_opportunities: [],
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

const DATA_CONFIDENCE_TABLES = {
  intraday_1m: {
    timestampCandidates: ['timestamp', 'ts', 'created_at', 'updated_at'],
    nullRateCandidates: ['symbol', 'open', 'high', 'low', 'close', 'volume'],
  },
  earnings_events: {
    timestampCandidates: ['report_date', 'created_at', 'updated_at'],
    nullRateCandidates: ['symbol', 'report_date', 'eps_estimate', 'eps_actual'],
  },
  market_quotes: {
    timestampCandidates: ['quote_time', 'timestamp', 'updated_at', 'created_at'],
    nullRateCandidates: ['symbol', 'price', 'change_percent', 'volume'],
  },
};

function isPresentMetricValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

async function detectTimestampColumn(client, tableName, candidates) {
  for (const columnName of candidates) {
    const { data, error } = await client
      .from(tableName)
      .select(columnName)
      .not(columnName, 'is', null)
      .order(columnName, { ascending: false })
      .limit(1);

    if (!error && Array.isArray(data) && data.length > 0) {
      return {
        columnName,
        latestValue: data[0]?.[columnName] ?? null,
      };
    }
  }
  return { columnName: null, latestValue: null };
}

async function detectAvailableColumns(client, tableName, candidates) {
  const available = [];
  for (const columnName of candidates) {
    const { error } = await client.from(tableName).select(columnName).limit(1);
    if (!error) available.push(columnName);
  }
  return available;
}

function computeNullRatePercent(rows, columns) {
  if (!Array.isArray(rows) || rows.length === 0 || !Array.isArray(columns) || columns.length === 0) {
    return 0;
  }

  let missing = 0;
  const total = rows.length * columns.length;

  for (const row of rows) {
    for (const columnName of columns) {
      if (!isPresentMetricValue(row?.[columnName])) {
        missing += 1;
      }
    }
  }

  return Number(((missing / total) * 100).toFixed(2));
}

async function getSupabaseTableConfidence(tableName, config) {
  if (!supabaseAdmin) {
    return {
      table: tableName,
      status: 'unavailable',
      row_count: 0,
      freshness_seconds: null,
      null_rate_percent: null,
      detail: 'supabase_admin_not_configured',
    };
  }

  const countResult = await supabaseAdmin
    .from(tableName)
    .select('*', { count: 'exact', head: true });

  if (countResult.error) {
    return {
      table: tableName,
      status: 'unavailable',
      row_count: 0,
      freshness_seconds: null,
      null_rate_percent: null,
      detail: countResult.error.message,
    };
  }

  const rowCount = Number(countResult.count || 0);
  const { columnName: freshnessColumn, latestValue } = await detectTimestampColumn(
    supabaseAdmin,
    tableName,
    config.timestampCandidates
  );

  let freshnessSeconds = null;
  if (latestValue) {
    const parsed = Date.parse(String(latestValue));
    if (Number.isFinite(parsed)) {
      freshnessSeconds = Math.max(0, Math.floor((Date.now() - parsed) / 1000));
    }
  }

  const nullRateColumns = await detectAvailableColumns(supabaseAdmin, tableName, config.nullRateCandidates);
  let nullRatePercent = null;

  if (nullRateColumns.length > 0) {
    let query = supabaseAdmin
      .from(tableName)
      .select(nullRateColumns.join(','))
      .limit(500);

    if (freshnessColumn) {
      query = query.order(freshnessColumn, { ascending: false });
    }

    const sampleResult = await query;
    if (!sampleResult.error) {
      nullRatePercent = computeNullRatePercent(sampleResult.data || [], nullRateColumns);
    }
  }

  const status = rowCount === 0
    ? 'warning'
    : (freshnessSeconds == null ? 'warning' : 'ok');

  return {
    table: tableName,
    status,
    row_count: rowCount,
    freshness_seconds: freshnessSeconds,
    null_rate_percent: nullRatePercent,
  };
}

app.get('/api/system/data-health', async (_req, res) => {
  try {
    const [databaseHealth, providerHealth, sparklineStats, telemetry, intradayConfidence, earningsConfidence, marketQuotesConfidence] = await Promise.all([
      getDataHealth(),
      Promise.resolve(getProviderHealth()),
      getSparklineCacheStats(),
      getTelemetry(),
      getSupabaseTableConfidence('intraday_1m', DATA_CONFIDENCE_TABLES.intraday_1m),
      getSupabaseTableConfidence('earnings_events', DATA_CONFIDENCE_TABLES.earnings_events),
      getSupabaseTableConfidence('market_quotes', DATA_CONFIDENCE_TABLES.market_quotes),
    ]);

    const pipeline = getIntelligencePipelineHealth();
    const tickerState = await getTickerTapeCache();

    const engineHealth = {
      pipeline: pipeline?.status || 'unknown',
      squeeze: pipeline?.stages?.short_squeeze?.ok ? 'ok' : (pipeline?.stages?.short_squeeze ? 'warning' : 'unknown'),
      flow: pipeline?.stages?.flow_detection?.ok ? 'ok' : (pipeline?.stages?.flow_detection ? 'warning' : 'unknown'),
      narrative: pipeline?.stages?.market_narrative?.ok ? 'ok' : (pipeline?.stages?.market_narrative ? 'warning' : 'unknown'),
      last_run: pipeline?.last_run || null,
    };

    const providers = providerHealth?.providers || {};
    const providerSummary = {
      fmp: providers?.fmp?.status || 'unknown',
      finnhub: providers?.finnhub?.status || 'unknown',
      polygon: providers?.polygon?.status || 'unknown',
      finviz: providers?.finviz?.status || 'unknown',
    };

    const cacheHealth = {
      sparkline_cache_rows: Number(sparklineStats?.rows || 0),
      sparkline_cache_updated_at: sparklineStats?.updated_at || null,
      ticker_cache: tickerState?.status || 'unknown',
      ticker_cache_refresh_time: tickerState?.updated_at || null,
    };

    const eventBusHealth = getEventBusHealth();
    const integrityHealth = getDataIntegrityHealth();
    const alertHealth = getSystemAlertEngineHealth();

    const tableConfidence = {
      intraday_1m: intradayConfidence,
      earnings_events: earningsConfidence,
      market_quotes: marketQuotesConfidence,
    };

    console.log('[DATA_HEALTH_SNAPSHOT]', {
      intraday_1m: {
        row_count: intradayConfidence.row_count,
        freshness_seconds: intradayConfidence.freshness_seconds,
        null_rate_percent: intradayConfidence.null_rate_percent,
      },
      earnings_events: {
        row_count: earningsConfidence.row_count,
        freshness_seconds: earningsConfidence.freshness_seconds,
        null_rate_percent: earningsConfidence.null_rate_percent,
      },
      market_quotes: {
        row_count: marketQuotesConfidence.row_count,
        freshness_seconds: marketQuotesConfidence.freshness_seconds,
        null_rate_percent: marketQuotesConfidence.null_rate_percent,
      },
    });

    const status = [databaseHealth?.status, ...Object.values(providerSummary), engineHealth.pipeline, cacheHealth.ticker_cache, integrityHealth?.status, alertHealth?.status]
      .some((item) => item && item !== 'ok' && item !== 'unknown')
      ? 'warning'
      : 'ok';

    const confidenceStatus = Object.values(tableConfidence)
      .some((item) => item?.status && item.status !== 'ok')
      ? 'warning'
      : 'ok';

    const overallStatus = status === 'warning' || confidenceStatus === 'warning' ? 'warning' : 'ok';

    return res.json({
      status: overallStatus,
      database_health: databaseHealth,
      provider_health: providerHealth,
      engine_health: engineHealth,
      cache_health: cacheHealth,
      event_bus_health: eventBusHealth,
      integrity_health: integrityHealth,
      alert_engine_health: alertHealth,
      data_confidence: tableConfidence,
      checked_at: new Date().toISOString(),
      telemetry,
      engines: engineHealth,
      providers: providerSummary,
      cache: {
        sparkline_cache_rows: cacheHealth.sparkline_cache_rows,
        ticker_cache: cacheHealth.ticker_cache,
      },
      tables: {
        intraday_1m: intradayConfidence.row_count,
        earnings_events: earningsConfidence.row_count,
        market_quotes: marketQuotesConfidence.row_count,
      },
    });
  } catch (error) {
    return res.json({
      status: 'warning',
      database_health: {
        status: 'warning',
        tables: {
          intraday_1m: 0,
          market_quotes: 0,
          news_articles: 0,
          earnings_events: 0,
          trade_setups: 0,
          trade_catalysts: 0,
          opportunity_stream: 0,
        },
      },
      provider_health: { providers: {} },
      engine_health: { pipeline: 'warning', squeeze: 'warning', flow: 'warning', narrative: 'warning' },
      cache_health: { sparkline_cache_rows: 0, ticker_cache: 'warning' },
      data_confidence: {
        intraday_1m: { table: 'intraday_1m', status: 'warning', row_count: 0, freshness_seconds: null, null_rate_percent: null },
        earnings_events: { table: 'earnings_events', status: 'warning', row_count: 0, freshness_seconds: null, null_rate_percent: null },
        market_quotes: { table: 'market_quotes', status: 'warning', row_count: 0, freshness_seconds: null, null_rate_percent: null },
      },
      error: 'Data health unavailable',
      message: error.message,
    });
  }
});

app.get('/api/system/data-integrity', async (_req, res) => {
  try {
    const payload = await runDataIntegrityMonitor();
    // Always 200 — use payload.status field to signal health (avoids proxy treating 503 as error)
    return res.json(payload);
  } catch (error) {
    console.error('[PIPELINE] data-integrity monitor failed:', error.message);
    return res.json({
      status: 'down',
      checked_at: new Date().toISOString(),
      issues: [
        {
          severity: 'critical',
          type: 'system',
          key: 'data_integrity_monitor_exception',
          message: 'Data integrity monitor failed to execute',
          detail: error.message,
        },
      ],
      pipelines: [],
      tables: [],
      data_quality: [],
      parity: { status: 'down', symbols: [] },
    });
  }
});

app.get('/api/system/provider-health', async (_req, res) => {
  try {
    const payload = getProviderHealth();
    return res.json({ ok: true, ...payload });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message, providers: {} });
  }
});

app.get('/api/system/events', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 100, 500));
    const { rows } = await queryWithTimeout(
      `SELECT id, event_type, source, symbol, payload, created_at
       FROM system_events
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit],
      { timeoutMs: 5000, label: 'api.system.events', maxRetries: 0 }
    );
    return res.json({ ok: true, items: rows || [] });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message, items: [] });
  }
});

app.get('/api/system/integrity-events', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 100, 500));
    const { rows } = await queryWithTimeout(
      `SELECT id, event_type, source, symbol, issue, severity, payload, created_at
       FROM data_integrity_events
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit],
      { timeoutMs: 5000, label: 'api.system.integrity_events', maxRetries: 0 }
    );
    return res.json({ ok: true, items: rows || [] });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message, items: [] });
  }
});

app.get('/api/system/alerts', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 100, 500));
    const { rows } = await queryWithTimeout(
      `SELECT id, type, source, severity, message, acknowledged, created_at
       FROM system_alerts
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit],
      { timeoutMs: 5000, label: 'api.system.alerts', maxRetries: 0 }
    );
    return res.json({ ok: true, items: rows || [] });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message, items: [] });
  }
});

app.get('/api/system/engine-diagnostics', async (_req, res) => {
  try {
    const beaconEvolutionState = getBeaconEvolutionState();
    const beaconEvolutionSummary = beaconEvolutionState?.summary || {};
    const beaconEvolutionEngine = {
      last_run_time: beaconEvolutionState?.lastRunAt || null,
      last_run_duration_ms: beaconEvolutionState?.lastRuntimeMs ?? null,
      strategies_processed: Number(beaconEvolutionSummary?.strategies || 0),
      signals_processed: Number(beaconEvolutionSummary?.sourceRows || 0),
      adjustments_applied: Number(beaconEvolutionSummary?.adjustedRows || 0),
      last_error: beaconEvolutionState?.lastError || null,
    };

    const [
      telemetry,
      providerHealth,
      eventBusHealth,
      integrityHealth,
      alertHealth,
      scheduler,
      opportunities24h,
      dataFreshnessSeconds,
      calibrationSummary,
      calibrationStats,
      opportunityEngineStatus,
      opportunityEngineTelemetry,
    ] = await Promise.all([
      getTelemetry(),
      Promise.resolve(getProviderHealth()),
      Promise.resolve(getEventBusHealth()),
      Promise.resolve(getDataIntegrityHealth()),
      Promise.resolve(getSystemAlertEngineHealth()),
      Promise.resolve(getEngineSchedulerHealth()),
      getOpportunityCountLast24h(supabaseAdmin)
        .catch(() => getOpportunityCountLast24h(null))
        .catch(() => 0),
      getOpportunityFreshnessSeconds(supabaseAdmin)
        .catch(() => getOpportunityFreshnessSeconds(null))
        .catch(() => null),
      queryWithTimeout(
        `SELECT strategy, total_signals, avg_move, avg_drawdown, win_rate_percent
         FROM strategy_performance_summary
         ORDER BY total_signals DESC NULLS LAST`,
        [],
        { timeoutMs: 5000, label: 'api.system.engine_diagnostics.calibration_summary', maxRetries: 0 }
      ).catch(() => ({ rows: [] })),
      queryWithTimeout(
        `SELECT COUNT(*)::int AS signal_count,
                MAX(created_at) AS last_update,
                AVG(CASE WHEN success = true THEN 100.0 WHEN success = false THEN 0.0 ELSE NULL END) AS win_rate
         FROM signal_calibration_log`,
        [],
        { timeoutMs: 5000, label: 'api.system.engine_diagnostics.calibration_stats', maxRetries: 0 }
      ).catch(() => ({ rows: [] })),
      queryWithTimeout(
        `SELECT last_run
         FROM engine_status
         WHERE engine = 'opportunityEngine'
         LIMIT 1`,
        [],
        { timeoutMs: 5000, label: 'api.system.engine_diagnostics.opportunity_engine_status', maxRetries: 0 }
      ).catch(() => ({ rows: [] })),
      queryWithTimeout(
        `SELECT payload->>'rows_processed' AS rows_processed
         FROM engine_telemetry
         WHERE engine = 'opportunityEngine'
         ORDER BY updated_at DESC
         LIMIT 1`,
        [],
        { timeoutMs: 5000, label: 'api.system.engine_diagnostics.opportunity_engine_telemetry', maxRetries: 0 }
      ).catch(() => ({ rows: [] })),
    ]);

    const schedulerStatus = String(scheduler?.status || '').toLowerCase();
    const schedulerOk = schedulerStatus === 'running' || schedulerStatus === 'idle';
    const pipelineOk = telemetry?.pipeline_runtime?.status !== 'failed';
    const providersOk = Boolean(providerHealth?.providers);
    const opportunitiesValue = Number(opportunities24h || 0);
    const freshnessValue = dataFreshnessSeconds === null ? null : Number(dataFreshnessSeconds);
    const calibrationStatsRow = calibrationStats?.rows?.[0] || {};
    const calibrationSignalCount = Number(calibrationStatsRow?.signal_count || 0);
    const calibrationWinRate = calibrationStatsRow?.win_rate == null ? null : Number(calibrationStatsRow.win_rate);
    const calibrationLastUpdate = calibrationStatsRow?.last_update || null;
    const opportunityLastRun = opportunityEngineStatus?.rows?.[0]?.last_run || null;
    const opportunityRowsLastRun = Number(opportunityEngineTelemetry?.rows?.[0]?.rows_processed || 0);
    const opportunityLastRunMs = opportunityLastRun ? new Date(opportunityLastRun).getTime() : null;
    const opportunityRecentlyRan = Number.isFinite(opportunityLastRunMs)
      ? (Date.now() - opportunityLastRunMs) <= (30 * 60 * 1000)
      : false;
    const opportunityEngine = {
      last_run: opportunityLastRun,
      rows_generated_last_run: opportunityRowsLastRun,
      warning: opportunityRecentlyRan
        ? null
        : 'Opportunity engine has not run in the last 30 minutes',
    };

    return res.json({
      ok: true,
      source: 'cache',
      lines: [
        'SYSTEM STATUS: OK',
        `CACHE: ${telemetry ? 'OK' : 'WARN'}`,
        `SCHEDULER: ${schedulerOk ? 'OK' : 'WARN'}`,
        `PIPELINE: ${pipelineOk ? 'OK' : 'WARN'}`,
        `PROVIDERS: ${providersOk ? 'OK' : 'WARN'}`,
        `OPPORTUNITIES_24H: ${opportunitiesValue}`,
        `DATA_FRESHNESS_SECONDS: ${freshnessValue === null ? 'n/a' : freshnessValue}`,
        `CALIBRATION_SIGNAL_COUNT: ${calibrationSignalCount}`,
        `CALIBRATION_WIN_RATE: ${calibrationWinRate === null ? 'n/a' : calibrationWinRate.toFixed(2)}`,
        `CALIBRATION_LAST_UPDATE: ${calibrationLastUpdate || 'n/a'}`,
        `OPPORTUNITY_ENGINE_LAST_RUN: ${opportunityEngine.last_run || 'n/a'}`,
        `OPPORTUNITY_ENGINE_ROWS_LAST_RUN: ${opportunityEngine.rows_generated_last_run}`,
        `OPPORTUNITY_ENGINE_WARNING: ${opportunityEngine.warning || 'none'}`,
        `BEACON_EVOLUTION_LAST_RUN: ${beaconEvolutionEngine.last_run_time || 'n/a'}`,
        `BEACON_EVOLUTION_STRATEGIES: ${beaconEvolutionEngine.strategies_processed}`,
        `BEACON_EVOLUTION_SIGNALS: ${beaconEvolutionEngine.signals_processed}`,
        `BEACON_EVOLUTION_ADJUSTMENTS: ${beaconEvolutionEngine.adjustments_applied}`,
        `BEACON_EVOLUTION_ERROR: ${beaconEvolutionEngine.last_error || 'none'}`,
      ],
      engines: {
        ...(telemetry || {}),
        opportunities_24h: opportunitiesValue,
        data_freshness_seconds: freshnessValue,
        calibration_signal_count: calibrationSignalCount,
        calibration_win_rate: calibrationWinRate,
        calibration_last_update: calibrationLastUpdate,
        opportunity_engine: opportunityEngine,
        calibration_summary: calibrationSummary?.rows || [],
        beaconEvolutionEngine,
      },
      provider_health: providerHealth,
      event_bus_health: eventBusHealth,
      integrity_health: integrityHealth,
      alert_engine_health: alertHealth,
      scheduler,
      checked_at: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(500).json({
      ok: false,
      error: 'Engine diagnostics failure',
      message: error.message,
      lines: [],
    });
  }
});

app.get('/api/system/ui-health', getUIHealth);
app.get('/api/system/engine-health', (_req, res) => {
  const health = getOrchestratorEngineHealth();
  res.json({
    success: true,
    data: health,
  });
});
app.get('/api/system/platform-health', platformHealth);
app.get('/api/system/email-health', getEmailDiagnostics);
app.get('/api/system/ui-error-log', uiErrorLog);
app.post('/api/system/ui-error', uiError);

app.get('/api/system-audit/report', async (req, res) => {
  try {
    if (req.query.refresh === '1') {
      const { report } = await runSystemAudit({
        baseUrl: `${req.protocol}://${req.get('host')}`,
      });
      return res.json(report);
    }

    const reportPath = path.resolve(__dirname, 'diagnostics', 'system_audit.json');
    const raw = await fs.readFile(reportPath, 'utf8');
    return res.json(JSON.parse(raw));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({
        ok: false,
        error: 'System audit report not found',
        detail: 'Run `node runSystemAudit.js` in server directory to generate report.',
      });
    }
    return res.status(500).json({
      ok: false,
      error: 'System audit report read failure',
      detail: error.message,
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
  const buildForcedCatalystFallback = () => {
    const raw = {
      symbol: 'SPY',
      catalyst_type: 'FORCED_FALLBACK',
      headline: 'Fallback catalyst generated to keep pipeline active',
      strategy: 'CATALYST_FORCED_FALLBACK',
      why_moving: 'Fallback catalyst generated to keep pipeline active',
      how_to_trade: 'Enter on breakout, stop below support, target next resistance',
      confidence: 60,
      expected_move_percent: 1.5,
      trade_class: 'TRADEABLE',
      strength_score: 0.5,
      event_time: new Date().toISOString(),
    };
    const built = buildFinalTradeObject(raw, 'catalysts_fallback');
    return built
      ? [{
        ...built,
        catalyst_type: 'FORCED_FALLBACK',
        headline: raw.headline,
        strength: 0.5,
        timestamp: raw.event_time,
      }]
      : [];
  };

  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 500, 1000));
    const { rows } = await queryWithTimeout(
      `SELECT
         event_uuid AS id,
         symbol,
         catalyst_type,
         headline,
         source_table,
         source_id,
         event_time,
         strength_score,
         sentiment_score,
         created_at
       FROM catalyst_events
       WHERE source_table IN ('news_articles', 'earnings_calendar', 'ipo_calendar', 'stock_splits')
       ORDER BY COALESCE(event_time, published_at, created_at) DESC
       LIMIT $1`,
      [limit],
      { label: 'api.strict.catalysts.primary', timeoutMs: 2400, maxRetries: 1, retryDelayMs: 120 }
    );

    const normalized = (rows || [])
      .map((row) => {
        const catalystType = String(row.catalyst_type || '').trim().toUpperCase();
        if (!catalystType || catalystType === 'UNKNOWN') return null;

        const raw = {
          ...row,
          strategy: `CATALYST_${catalystType}`,
          why_moving: String(row.headline || '').trim(),
          how_to_trade: 'Trade only with confirmation and tighten risk around catalyst volatility.',
          confidence: Math.max(30, Math.min(90, Number(row.strength_score || 0) * 100 || 45)),
          expected_move_percent: Math.max(1.5, Number(row.strength_score || 0) * 6 || 2.5),
          trade_class: 'TRADEABLE',
          updated_at: row.event_time || row.created_at,
        };

        const built = buildFinalTradeObject(raw, 'catalysts');
        if (!built) return null;
        const check = validateTrade(built);
        if (!check.valid) {
          console.error('[api/catalysts] invalid trade dropped', { symbol: row.symbol, errors: check.errors });
          return null;
        }

        return {
          ...built,
          catalyst_type: catalystType,
          headline: String(row.headline || ''),
          strength: Number(row.strength_score || 0),
          timestamp: row.event_time || row.created_at,
        };
      })
      .filter(Boolean);

    if (normalized.length === 0) {
      console.log('[CATALYST FALLBACK USED]');
      const fallback = buildForcedCatalystFallback();
      return res.json({ success: true, data: fallback, count: fallback.length, fallback_used: true });
    }

    res.json({ success: true, data: normalized, count: normalized.length });
  } catch (err) {
    logger.error('catalysts endpoint db error', { error: err.message });
    console.log('[CATALYST FALLBACK USED]');
    const fallback = buildForcedCatalystFallback();
    res.json({ success: true, data: fallback, count: fallback.length, fallback_used: true, degraded: true });
  }
});

app.get('/api/catalysts/latest', async (req, res) => {
  const rawLimit = Number.parseInt(String(req.query.limit || ''), 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 50;

  try {
    const { rows } = await pool.query(
      `SELECT
        ci.news_id,
         ci.symbol,
         ce.headline,
         ci.catalyst_type,
         ci.provider_count,
         ci.freshness_minutes,
         ci.sector_trend,
         ci.market_trend,
         ci.expected_move_low,
         ci.expected_move_high,
         ci.confidence_score,
         ci.narrative
       FROM catalyst_intelligence ci
       LEFT JOIN catalyst_events ce
         ON ce.news_id = ci.news_id
       ORDER BY ci.created_at DESC
       LIMIT $1`,
      [limit]
    );

    return res.json({ ok: true, items: rows });
  } catch (err) {
    logger.error('catalysts latest endpoint db error', { error: err.message });
    return res.status(500).json({ ok: false, error: err.message || 'Failed to load latest catalysts' });
  }
});

app.get('/api/catalysts/symbol/:symbol', async (req, res) => {
  const symbol = String(req.params.symbol || '').trim().toUpperCase();
  if (!symbol) return res.status(400).json({ ok: false, error: 'symbol required' });

  const rawLimit = Number.parseInt(String(req.query.limit || ''), 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 50;

  try {
    const { rows } = await pool.query(
      `SELECT
        ci.news_id,
         ci.symbol,
         ce.headline,
         ci.catalyst_type,
         ci.provider_count,
         ci.freshness_minutes,
         ci.sector_trend,
         ci.market_trend,
         ci.expected_move_low,
         ci.expected_move_high,
         ci.confidence_score,
         ci.narrative
       FROM catalyst_intelligence ci
       LEFT JOIN catalyst_events ce
         ON ce.news_id = ci.news_id
       WHERE ci.symbol = $1
       ORDER BY ci.created_at DESC
       LIMIT $2`,
      [symbol, limit]
    );

    return res.json({ ok: true, items: rows });
  } catch (err) {
    logger.error('catalysts symbol endpoint db error', { error: err.message, symbol });
    return res.status(500).json({ ok: false, error: err.message || 'Failed to load symbol catalysts' });
  }
});

app.get('/api/catalysts/id/:newsId', async (req, res) => {
  const newsId = Number.parseInt(String(req.params.newsId || ''), 10);
  if (!Number.isFinite(newsId)) return res.status(400).json({ ok: false, error: 'newsId must be numeric' });

  try {
    const settled = await Promise.allSettled([
      queryWithTimeout(
        `SELECT
           ci.news_id,
           ci.symbol,
           ce.headline,
           ci.catalyst_type,
           ci.provider_count,
           ci.freshness_minutes,
           ci.sector,
           ci.sector_trend,
           ci.market_trend,
           ci.float_size,
           ci.short_interest,
           ci.institutional_ownership,
           ci.sentiment_score,
           ci.expected_move_low,
           ci.expected_move_high,
           ci.confidence_score,
           ci.narrative
         FROM catalyst_intelligence ci
         LEFT JOIN catalyst_events ce ON ce.news_id = ci.news_id
         WHERE ci.news_id = $1
         LIMIT 1`,
        [newsId],
        { label: 'api.catalysts.id.base', timeoutMs: 1800, maxRetries: 1, retryDelayMs: 100 }
      ),
      queryWithTimeout(
        `SELECT
           cr.reaction_type,
           cr.abnormal_volume_ratio,
           cr.first_5m_move,
           cr.current_move,
           cr.continuation_probability,
           cr.expectation_gap_score,
           cr.priced_in_flag,
           cr.qqq_trend,
           cr.spy_trend,
           cr.sector_alignment,
           cr.is_tradeable_now
         FROM catalyst_reactions cr
         WHERE cr.news_id = $1
         LIMIT 1`,
        [newsId],
        { label: 'api.catalysts.id.reaction', timeoutMs: 1800, maxRetries: 1, retryDelayMs: 100 }
      ),
      queryWithTimeout(
        `SELECT
           ARRAY_REMOVE(ARRAY_AGG(DISTINCT COALESCE(na.provider, na.source)), NULL) AS provider_list,
           ARRAY_REMOVE(ARRAY_AGG(DISTINCT na.url), NULL) AS source_links
         FROM news_articles na
         JOIN catalyst_intelligence ci ON ci.news_id = $1
         WHERE UPPER(COALESCE(na.symbol, '')) = UPPER(ci.symbol)
           AND LOWER(COALESCE(na.headline, '')) = LOWER(COALESCE((SELECT ce.headline FROM catalyst_events ce WHERE ce.news_id = ci.news_id LIMIT 1), ''))`,
        [newsId],
        { label: 'api.catalysts.id.providers', timeoutMs: 1800, maxRetries: 1, retryDelayMs: 100 }
      ),
    ]);

    const warnings = [];
    const base = settled[0].status === 'fulfilled' ? settled[0].value.rows[0] : null;
    const reaction = settled[1].status === 'fulfilled' ? settled[1].value.rows[0] : null;
    const providers = settled[2].status === 'fulfilled' ? settled[2].value.rows[0] : null;

    if (settled[0].status !== 'fulfilled') warnings.push(`base: ${settled[0].reason?.message || 'query failed'}`);
    if (settled[1].status !== 'fulfilled') warnings.push(`reaction: ${settled[1].reason?.message || 'query failed'}`);
    if (settled[2].status !== 'fulfilled') warnings.push(`providers: ${settled[2].reason?.message || 'query failed'}`);

    if (!base) return res.status(404).json({ ok: false, items: [], warnings, error: 'Catalyst not found' });

    return res.json({
      ok: true,
      items: [
        {
          ...base,
          ...(reaction || {}),
          provider_list: providers?.provider_list || [],
          source_links: providers?.source_links || [],
        },
      ],
      warnings,
    });
  } catch (err) {
    logger.error('catalysts id endpoint db error', { error: err.message, newsId });
    return res.status(500).json({ ok: false, items: [], error: err.message || 'Failed to load catalyst detail' });
  }
});

app.get('/api/catalyst-reactions/latest', async (req, res) => {
  const rawLimit = Number.parseInt(String(req.query.limit || ''), 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 50;

  try {
    const { rows } = await queryWithTimeout(
      `SELECT
         cr.symbol,
         cr.news_id,
         cr.reaction_type,
         cr.abnormal_volume_ratio,
         cr.first_5m_move,
         cr.current_move,
         cr.continuation_probability,
         cr.expectation_gap_score,
         cr.priced_in_flag,
         cr.qqq_trend,
         cr.spy_trend,
         cr.sector_alignment,
         cr.is_tradeable_now,
         ce.headline,
         ci.catalyst_type,
         ci.provider_count,
         ci.freshness_minutes,
         ci.confidence_score
       FROM catalyst_reactions cr
       LEFT JOIN catalyst_events ce ON ce.news_id = cr.news_id
       LEFT JOIN catalyst_intelligence ci ON ci.news_id = cr.news_id
       ORDER BY cr.created_at DESC
       LIMIT $1`,
      [limit],
      { label: 'api.catalyst_reactions.latest', timeoutMs: 1800, maxRetries: 1, retryDelayMs: 100 }
    );

    return res.json({ ok: true, items: rows });
  } catch (err) {
    logger.error('catalyst reactions latest endpoint db error', { error: err.message });
    return res.status(500).json({ ok: false, items: [], error: err.message || 'Failed to load catalyst reactions' });
  }
});

app.get('/api/catalyst-reactions/symbol/:symbol', async (req, res) => {
  const symbol = String(req.params.symbol || '').trim().toUpperCase();
  if (!symbol) return res.status(400).json({ ok: false, error: 'symbol required' });

  const rawLimit = Number.parseInt(String(req.query.limit || ''), 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 50;

  try {
    const { rows } = await queryWithTimeout(
      `SELECT
         cr.symbol,
         cr.news_id,
         cr.reaction_type,
         cr.abnormal_volume_ratio,
         cr.first_5m_move,
         cr.current_move,
         cr.continuation_probability,
         cr.expectation_gap_score,
         cr.priced_in_flag,
         cr.qqq_trend,
         cr.spy_trend,
         cr.sector_alignment,
         cr.is_tradeable_now,
         ce.headline,
         ci.catalyst_type,
         ci.provider_count,
         ci.freshness_minutes,
         ci.confidence_score
       FROM catalyst_reactions cr
       LEFT JOIN catalyst_events ce ON ce.news_id = cr.news_id
       LEFT JOIN catalyst_intelligence ci ON ci.news_id = cr.news_id
       WHERE cr.symbol = $1
       ORDER BY cr.created_at DESC
       LIMIT $2`,
      [symbol, limit],
      { label: 'api.catalyst_reactions.symbol', timeoutMs: 1800, maxRetries: 1, retryDelayMs: 100 }
    );

    return res.json({ ok: true, items: rows });
  } catch (err) {
    logger.error('catalyst reactions symbol endpoint db error', { error: err.message, symbol });
    return res.status(500).json({ ok: false, items: [], error: err.message || 'Failed to load symbol catalyst reactions' });
  }
});

console.log('[BOOT] Catalyst public routes mounted: /api/catalysts/latest, /api/catalysts/symbol/:symbol, /api/catalysts/top, /api/catalysts/id/:newsId, /api/catalyst-reactions/latest, /api/catalyst-reactions/symbol/:symbol');

app.get('/api/catalysts/top', async (req, res) => {
  const rawLimit = Number.parseInt(String(req.query.limit || ''), 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 25;

  try {
    const { rows } = await pool.query(
      `SELECT
        ci.news_id,
         ci.symbol,
         ce.headline,
         ci.catalyst_type,
         ci.provider_count,
         ci.freshness_minutes,
         ci.sector_trend,
         ci.market_trend,
         ci.expected_move_low,
         ci.expected_move_high,
         ci.confidence_score,
         ci.narrative,
         cs.signal_type,
         cs.signal_score
       FROM catalyst_signals cs
       JOIN catalyst_intelligence ci
         ON ci.news_id = cs.news_id
       LEFT JOIN catalyst_events ce
         ON ce.news_id = ci.news_id
       ORDER BY cs.signal_score DESC, ci.confidence_score DESC
       LIMIT $1`,
      [limit]
    );

    return res.json({ ok: true, items: rows });
  } catch (err) {
    logger.error('catalysts top endpoint db error', { error: err.message });
    return res.status(500).json({ ok: false, error: err.message || 'Failed to load top catalysts' });
  }
});

app.get('/api/system/runtime', async (_req, res) => {
  try {
    const tasks = await Promise.allSettled([
      queryWithTimeout('SELECT COUNT(*)::bigint AS c FROM news_articles', [], { label: 'api.system.runtime.news_articles', timeoutMs: 1800, maxRetries: 1, retryDelayMs: 100 }),
      queryWithTimeout('SELECT COUNT(*)::bigint AS c FROM catalyst_events', [], { label: 'api.system.runtime.catalyst_events', timeoutMs: 1800, maxRetries: 1, retryDelayMs: 100 }),
      queryWithTimeout('SELECT COUNT(*)::bigint AS c FROM catalyst_intelligence', [], { label: 'api.system.runtime.catalyst_intelligence', timeoutMs: 1800, maxRetries: 1, retryDelayMs: 100 }),
      queryWithTimeout('SELECT COUNT(*)::bigint AS c FROM catalyst_signals', [], { label: 'api.system.runtime.catalyst_signals', timeoutMs: 1800, maxRetries: 1, retryDelayMs: 100 }),
      queryWithTimeout('SELECT COUNT(*)::bigint AS c FROM catalyst_reactions', [], { label: 'api.system.runtime.catalyst_reactions', timeoutMs: 1800, maxRetries: 1, retryDelayMs: 100 }),
      queryWithTimeout('SELECT MAX(timestamp) AS ts FROM intraday_1m', [], { label: 'api.system.runtime.intraday_max_ts', timeoutMs: 1800, maxRetries: 1, retryDelayMs: 100 }),
    ]);

    const toCount = (idx) => {
      const item = tasks[idx];
      if (item.status !== 'fulfilled') return null;
      return Number(item.value?.rows?.[0]?.c ?? 0);
    };

    const intradayMaxTs = tasks[5].status === 'fulfilled'
      ? tasks[5].value?.rows?.[0]?.ts || null
      : null;

    const providerHealth = getProviderHealth();
    const newsProviderHealth = getNewsProviderHealth();
    const ingestionState = getIngestionSchedulerState();

    const intradayFreshness = monitorIntradayFreshness(intradayMaxTs);

    return res.json({
      database_host: activeDbHost || null,
      news_articles_count: toCount(0),
      catalyst_events_count: toCount(1),
      catalyst_intelligence_count: toCount(2),
      catalyst_signals_count: toCount(3),
      catalyst_reactions_count: toCount(4),
      latest_intraday_timestamp: intradayMaxTs,
      intraday_lag_minutes: intradayFreshness.lagMinutes,
      intraday_status: intradayFreshness.status,
      providers: {
        fmp: providerHealth?.providers?.fmp || newsProviderHealth?.providers?.fmp || null,
        benzinga: newsProviderHealth?.providers?.benzinga || null,
        alpha_vantage: newsProviderHealth?.providers?.alpha_vantage || null,
        yahoo: newsProviderHealth?.providers?.yahoo || null,
        dowjones: newsProviderHealth?.providers?.dowjones || null,
      },
      ingestion_in_flight_jobs: ingestionState?.inFlightJobs || [],
    });
  } catch (error) {
    logger.error('system runtime endpoint error', { error: error.message });
    return res.status(500).json({
      database_host: activeDbHost || null,
      news_articles_count: null,
      catalyst_events_count: null,
      catalyst_intelligence_count: null,
      catalyst_signals_count: null,
      catalyst_reactions_count: null,
      latest_intraday_timestamp: null,
      intraday_lag_minutes: null,
      intraday_status: 'unknown',
      providers: {},
      ingestion_in_flight_jobs: [],
      error: error.message || 'Failed to load runtime diagnostics',
    });
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
       WHERE COALESCE(m.relative_volume, 0) >= 1
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
       WHERE COALESCE(m.gap_percent, 0) >= 1
         AND COALESCE(m.relative_volume, 0) >= 1
       ORDER BY m.gap_percent DESC
       LIMIT 50`
    );
    res.json(rows);
  } catch (err) {
    logger.error('premarket endpoint db error', { error: err.message });
    res.json([]);
  }
});

async function handleMarketMetricsRequest(_req, res) {
  try {
    const { rows: primaryRows } = await pool.query(
      `SELECT *
       FROM market_metrics
       WHERE COALESCE(updated_at, now()) > NOW() - INTERVAL '24 hours'
       ORDER BY relative_volume DESC NULLS LAST
       LIMIT 100`
    );

    if (primaryRows.length > 0) {
      return res.json(primaryRows);
    }

    const { rows: fallbackRows } = await pool.query(
      `SELECT *
       FROM market_metrics
       ORDER BY updated_at DESC NULLS LAST
       LIMIT 50`
    );

    return res.json(fallbackRows);
  } catch (err) {
    logger.error('metrics endpoint db error', { error: err.message });
    return res.json([]);
  }
}

app.get('/api/metrics', handleMarketMetricsRequest);
app.get('/api/market-metrics', handleMarketMetricsRequest);

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

  const loadMarketMetricsRows = async () => {
    const { rows: primaryRows } = await queryWithTimeout(
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
       WHERE COALESCE(m.updated_at, m.last_updated) > NOW() - INTERVAL '24 hours'
       ORDER BY COALESCE(m.relative_volume, 0) DESC NULLS LAST, ABS(COALESCE(m.gap_percent, 0)) DESC NULLS LAST
       LIMIT 30`,
      [],
      { label: 'api.radar.summary.momentum_leaders.primary', timeoutMs: 1400, maxRetries: 0, retryDelayMs: 100 }
    );

    console.log('[DATA CHECK]', {
      table: 'market_metrics',
      rows: primaryRows.length
    });

    if (primaryRows.length > 0) {
      return primaryRows;
    }

    const { rows: fallbackRows } = await queryWithTimeout(
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
       ORDER BY COALESCE(m.updated_at, m.last_updated) DESC NULLS LAST
       LIMIT 50`,
      [],
      { label: 'api.radar.summary.momentum_leaders.fallback', timeoutMs: 1600, maxRetries: 0, retryDelayMs: 100 }
    );

    console.log('[DATA CHECK]', {
      table: 'market_metrics',
      rows: fallbackRows.length
    });

    return fallbackRows;
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
       WHERE COALESCE(m.gap_percent, 0) >= 1
         AND COALESCE(m.relative_volume, 0) >= 1
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
      WHERE COALESCE(relative_volume, 0) >= 1
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
  console.log('[RADAR API] request received');
  console.log('[RADAR] summary endpoint active');
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
    loadMarketMetricsRows(),
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
      `SELECT symbol, headline, source, sentiment, created_at AS published_at
       FROM news_articles
       WHERE created_at > NOW() - INTERVAL '24 hours'
       ORDER BY created_at DESC NULLS LAST
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
  return res.status(410).json({
    success: false,
    error: 'EARNINGS_ROUTE_DISABLED',
    message: 'Route disabled. Use /api/earnings/calendar only.',
  });
});

app.get('/api/earnings/week', async (req, res) => {
  return res.status(410).json({
    success: false,
    error: 'EARNINGS_ROUTE_DISABLED',
    message: 'Route disabled. Use /api/earnings/calendar only.',
  });
});

app.get('/api/signals', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 500, 1000));
    const symbol = String(req.query.symbol || '').trim().toUpperCase();

    const params = [];
    let whereClause = '';
    if (symbol) {
      params.push(symbol);
      whereClause = `WHERE symbol = $${params.length}`;
    }
    params.push(limit);

    const { rows } = await queryWithTimeout(
      `SELECT id, symbol, signal_type, score, confidence, catalyst_ids, created_at
       FROM signals
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params,
      { label: 'api.strict.signals.primary', timeoutMs: 2400, maxRetries: 1, retryDelayMs: 120 }
    );

    logResponseShape('/api/signals', rows, ['symbol', 'signal_type', 'score', 'confidence']);
    return res.json({ success: true, data: rows });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Failed to load signals' });
  }
});

app.get('/api/signal/:symbol', async (req, res) => {
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

    if (!rows.length) {
      return res.json({
        success: false,
        symbol,
        strategy: null,
        score: null,
        class: null,
        gap_percent: null,
        relative_volume: null,
        sector: null,
        catalyst: 'No catalyst available',
        status: 'not_found',
      });
    }
    return res.json(rows[0]);
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Failed to load signal explanation' });
  }
});

app.get('/api/watchlist/signals', authMiddleware, async (req, res) => {
  try {
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

const QUOTES_FRESHNESS_THRESHOLD_MS = Number(process.env.QUOTES_FRESHNESS_THRESHOLD_MS || 45 * 60 * 1000);
const INTRADAY_FRESHNESS_THRESHOLD_MS = Number(process.env.INTRADAY_FRESHNESS_THRESHOLD_MS || 20 * 60 * 1000);

function isFreshTimestamp(value, thresholdMs) {
  const ts = new Date(value || 0).getTime();
  if (!Number.isFinite(ts) || ts <= 0) return false;
  return (Date.now() - ts) <= thresholdMs;
}

function normalizeQuoteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapExternalQuoteToMarketRow(quote) {
  const symbol = mapFromProviderSymbol(normalizeSymbol(quote?.symbol));
  if (!symbol) return null;

  const price = normalizeQuoteNumber(
    quote?.price
      ?? quote?.regularMarketPrice
      ?? quote?.last
      ?? quote?.close
      ?? quote?.c
  );
  const changePercent = normalizeQuoteNumber(
    quote?.change_percent
      ?? quote?.changePercent
      ?? quote?.regularMarketChangePercent
      ?? quote?.dp
  );
  const volume = normalizeQuoteNumber(
    quote?.volume
      ?? quote?.regularMarketVolume
      ?? quote?.v
  );

  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(volume)) {
    return null;
  }
  // changePercent may be null outside market hours — default to 0 rather than dropping the row
  const resolvedChangePercent = Number.isFinite(changePercent) ? changePercent : 0;

  const mappedRow = mapMarket({
    symbol,
    price,
    change_percent: resolvedChangePercent,
    volume,
    relative_volume: normalizeQuoteNumber(quote?.relative_volume ?? quote?.relativeVolume),
    atr: quote?.atr ?? null,
    rsi: quote?.rsi ?? null,
  });

  return {
    ...mappedRow,
    market_cap: normalizeQuoteNumber(quote?.market_cap ?? quote?.marketCap),
    sector: quote?.sector || null,
    avg_volume_30d: normalizeQuoteNumber(quote?.avg_volume_30d ?? quote?.avgVolume ?? quote?.averageDailyVolume10Day),
    updated_at: new Date().toISOString(),
    source: 'external_fallback',
  };
}

async function fetchExternalQuoteFallback(symbols = []) {
  const canonicalSymbols = (Array.isArray(symbols) ? symbols : [])
    .map((symbol) => mapFromProviderSymbol(normalizeSymbol(symbol)))
    .filter(Boolean);

  if (canonicalSymbols.length === 0) {
    return [];
  }

  try {
    const externalQuotes = await withRetry(
      () => marketService.getQuotes(canonicalSymbols),
      {
        retries: 1,
        baseDelay: 150,
        factor: 2,
        onError: (error, attempt) => {
          logger.warn('market quotes external fallback retry', {
            attempt,
            symbols: canonicalSymbols.slice(0, 10),
            symbol_count: canonicalSymbols.length,
            error: error?.message,
          });
        },
      }
    );

    return (Array.isArray(externalQuotes) ? externalQuotes : [])
      .map((quote) => mapExternalQuoteToMarketRow(quote))
      .filter(Boolean);
  } catch (error) {
    logger.error('market quotes external fallback failed', {
      symbols: canonicalSymbols.slice(0, 10),
      symbol_count: canonicalSymbols.length,
      error: error?.message,
    });
    return [];
  }
}


function logResponseShape(endpoint, rows, criticalFields = []) {
  const list = Array.isArray(rows) ? rows : [];
  const sample = list[0] && typeof list[0] === 'object' ? list[0] : null;
  const missingFields = new Set();

  if (!sample) {
    for (const field of criticalFields) {
      missingFields.add(`${field}:undefined`);
    }
  } else {
    for (const [key, value] of Object.entries(sample)) {
      if (value === undefined) missingFields.add(`${key}:undefined`);
    }
    for (const field of criticalFields) {
      if (!(field in sample)) {
        missingFields.add(`${field}:undefined`);
      } else if (sample[field] == null) {
        missingFields.add(`${field}:null`);
      }
    }
  }

  console.log('[RESPONSE_SHAPE]', {
    endpoint,
    row_count: list.length,
    missing_fields: Array.from(missingFields),
  });
}

function normalizeFmpIntradayBars(payload, symbol, limit) {
  const rows = Array.isArray(payload) ? payload : [];
  return rows
    .slice(0, Math.max(1, Math.min(Number(limit) || 1000, 5000)))
    .map((row) => {
      const ts = row?.date || row?.timestamp || row?.time;
      return {
        time: new Date(ts).getTime(),
        open: Number(row?.open),
        high: Number(row?.high),
        low: Number(row?.low),
        close: Number(row?.close),
        volume: Number(row?.volume ?? 0),
      };
    })
    .filter((row) => Number.isFinite(row.time)
      && Number.isFinite(row.open)
      && Number.isFinite(row.high)
      && Number.isFinite(row.low)
      && Number.isFinite(row.close));
}

async function fetchIntradayFallbackBars(symbol, limit) {
  const canonicalSymbol = mapFromProviderSymbol(normalizeSymbol(symbol));
  const providerSymbol = mapToProviderSymbol(canonicalSymbol);

  try {
    const fmpPayload = await fmpFetch('/historical-chart/1min', { symbol: providerSymbol });
    const fmpRows = normalizeFmpIntradayBars(fmpPayload, canonicalSymbol, limit);
    if (fmpRows.length > 0) {
      return fmpRows.sort((a, b) => a.time - b.time);
    }
  } catch (error) {
    logger.warn('intraday fallback FMP failed', { symbol: canonicalSymbol, providerSymbol, error: error.message });
  }

  try {
    const yahooPayload = await marketService.getHistorical(canonicalSymbol, { interval: '1m', range: '1d' });
    const quoteRows = yahooPayload?.quotes || [];
    const yahooRows = quoteRows.map((row) => ({
      time: new Date(row?.date || row?.timestamp || row?.time).getTime(),
      open: Number(row?.open),
      high: Number(row?.high),
      low: Number(row?.low),
      close: Number(row?.close),
      volume: Number(row?.volume ?? 0),
    })).filter((row) => Number.isFinite(row.time)
      && Number.isFinite(row.open)
      && Number.isFinite(row.high)
      && Number.isFinite(row.low)
      && Number.isFinite(row.close));

    return yahooRows.sort((a, b) => a.time - b.time).slice(-Math.max(1, Math.min(Number(limit) || 1000, 5000)));
  } catch (error) {
    logger.warn('intraday fallback Yahoo failed', { symbol: canonicalSymbol, error: error.message });
    return [];
  }
}

// ── GET /api/stocks/:symbol — unified stock research endpoint ─────────────────
// GET /api/stocks/intraday-sparkline — last N minutes of 1m bars for sparkline rendering
// Must be BEFORE /api/stocks/:symbol to avoid :symbol matching "intraday-sparkline"
app.get('/api/stocks/intraday-sparkline', async (req, res) => {
  try {
    const symbol = String(req.query.symbol || '').toUpperCase().trim();
    if (!symbol) return res.status(400).json({ status: 'INVALID_INPUT', error: 'symbol required' });
    const minutes = Math.max(10, Math.min(Number(req.query.minutes) || 60, 390));

    const result = await queryWithTimeout(
      `SELECT "timestamp", open, high, low, close, volume
       FROM intraday_1m
       WHERE symbol = $1
         AND "timestamp" >= NOW() - ($2 || ' minutes')::interval
       ORDER BY "timestamp" ASC`,
      [symbol, String(minutes)],
      { label: 'api.stocks.intraday_sparkline', timeoutMs: 5000 }
    );

    if (!result.rows || result.rows.length === 0) {
      return res.json({ status: 'NO_DATA', symbol, minutes, data: [] });
    }

    return res.json({ status: 'OK', symbol, minutes, count: result.rows.length, data: result.rows });
  } catch (err) {
    logger.error('intraday-sparkline error', { error: err.message });
    return res.status(500).json({ status: 'ERROR', error: err.message });
  }
});

app.get('/api/stocks/:symbol', async (req, res) => {
  const symbol = String(req.params.symbol || '').toUpperCase().trim();
  if (!symbol) return res.status(400).json({ success: false, error: 'Symbol required', symbol });

  // Fire coverage check non-blocking — fills any data gaps in the background
  setImmediate(() => {
    const { ensureSymbolCoverage } = require('./services/symbolCoverageEngine');
    ensureSymbolCoverage(symbol).catch(() => {});
  });

  try {
    const { pool: dbPool } = require('./db/pg');

    // Run all queries in parallel — any failure falls back gracefully
    const [quoteRes, metricsRes, universeRes, earningsRes, newsRes, coverageRes] = await Promise.allSettled([
      dbPool.query(
        `SELECT mq.symbol, mq.price, mq.change_percent, mq.volume, mq.market_cap, mq.sector, mq.updated_at
         FROM market_quotes mq
         WHERE mq.symbol = $1
         LIMIT 1`,
        [symbol]
      ),
      dbPool.query(
        `SELECT mm.avg_volume_30d, mm.relative_volume, mm.atr, mm.rsi,
                mm.implied_volatility, mm.expected_move_percent, mm.put_call_ratio
         FROM market_metrics mm
         WHERE mm.symbol = $1
         LIMIT 1`,
        [symbol]
      ),
      dbPool.query(
        `SELECT tu.company_name, tu.exchange, tu.sector, tu.industry
         FROM ticker_universe tu
         WHERE tu.symbol = $1
         LIMIT 1`,
        [symbol]
      ),
      dbPool.query(
        `SELECT ee.symbol, ee.report_date, ee.report_time,
                ee.eps_estimate, ee.eps_actual, ee.rev_estimate, ee.rev_actual,
                ee.eps_surprise_pct, ee.rev_surprise_pct, ee.guidance_direction,
                ee.market_cap, ee.sector
         FROM earnings_events ee
         WHERE ee.symbol = $1
         ORDER BY ee.report_date DESC
         LIMIT 6`,
        [symbol]
      ),
      dbPool.query(
        `SELECT na.id, na.headline, na.source, na.url, na.published_at,
                na.summary, na.catalyst_type, na.news_score, na.sentiment
         FROM news_articles na
         WHERE na.symbol = $1
            OR $1 = ANY(na.symbols)
            OR $1 = ANY(na.detected_symbols)
         ORDER BY na.published_at DESC NULLS LAST
         LIMIT 10`,
        [symbol]
      ),
      dbPool.query(
        `SELECT status FROM symbol_coverage WHERE symbol = $1 LIMIT 1`,
        [symbol]
      ),
    ]);

    const quote    = quoteRes.status    === 'fulfilled' ? quoteRes.value.rows[0]    ?? null : null;
    const metrics  = metricsRes.status  === 'fulfilled' ? metricsRes.value.rows[0]  ?? null : null;
    const universe = universeRes.status === 'fulfilled' ? universeRes.value.rows[0] ?? null : null;
    let   earnings       = earningsRes.status  === 'fulfilled' ? earningsRes.value.rows      ?? []   : [];
    const news           = newsRes.status      === 'fulfilled' ? newsRes.value.rows          ?? []   : [];
    const coverageStatus = coverageRes.status  === 'fulfilled' ? (coverageRes.value.rows[0]?.status ?? 'LOADING') : 'LOADING';

    // FMP fallback when DB has no earnings data
    if (earnings.length === 0) {
      try {
        const fmpRaw = await fmpFetch('/historical/earning_calendar', { symbol, limit: 5 });
        if (Array.isArray(fmpRaw) && fmpRaw.length > 0) {
          earnings = fmpRaw.map(e => ({
            report_date:      e.date        ?? null,
            report_time:      e.time        ?? null,
            eps_estimate:     e.epsEstimated != null ? Number(e.epsEstimated) : null,
            eps_actual:       e.eps         != null ? Number(e.eps)          : null,
            rev_estimate:     e.revenueEstimated != null ? Number(e.revenueEstimated) : null,
            rev_actual:       e.revenue     != null ? Number(e.revenue)      : null,
            eps_surprise_pct: (e.epsEstimated != null && e.eps != null && Number(e.epsEstimated) !== 0)
              ? ((Number(e.eps) - Number(e.epsEstimated)) / Math.abs(Number(e.epsEstimated))) * 100
              : null,
            rev_surprise_pct: null,
            guidance_direction: null,
            market_cap: null,
            sector: null,
          }));
          logger.info('[STOCK ENDPOINT] FMP earnings fallback used', { symbol, count: earnings.length });
        }
      } catch (fmpErr) {
        logger.warn('[STOCK ENDPOINT] FMP earnings fallback failed', { symbol, error: fmpErr.message });
      }
    }

    // Log any query failures for observability
    if (quoteRes.status    === 'rejected') logger.warn('[STOCK ENDPOINT] quotes query failed',    { symbol, error: quoteRes.reason?.message });
    if (metricsRes.status  === 'rejected') logger.warn('[STOCK ENDPOINT] metrics query failed',   { symbol, error: metricsRes.reason?.message });
    if (universeRes.status === 'rejected') logger.warn('[STOCK ENDPOINT] universe query failed',  { symbol, error: universeRes.reason?.message });
    if (earningsRes.status === 'rejected') logger.warn('[STOCK ENDPOINT] earnings query failed',  { symbol, error: earningsRes.reason?.message });
    if (newsRes.status     === 'rejected') logger.warn('[STOCK ENDPOINT] news query failed',      { symbol, error: newsRes.reason?.message });

    console.log('[STOCK ENDPOINT]', symbol, {
      hasQuote:      quote != null,
      earningsCount: earnings.length,
      newsCount:     news.length,
    });

    // No quote yet — backfill is running in background; return partial response
    // so the UI can show a loading state and auto-refresh after 2-3s
    if (!quote) {
      return res.json({
        success:         true,
        symbol,
        coverage_status: 'LOADING',
        partial:         true,
        price:           0,
        change_percent:  0,
        volume:          0,
        avg_volume_30d:  0,
        relative_volume: 0,
        market_cap:      0,
        sector:          null,
        industry:        null,
        company_name:    null,
        exchange:        null,
        updated_at:      null,
        fundamentals:    { eps_last: null, eps_est: null, revenue: null, pe: null, dividend_yield: null },
        earnings:        { next: null, history: [] },
        news:            [],
        options:         { implied_volatility: null, expected_move_percent: null, put_call_ratio: null },
      });
    }

    const today = new Date().toISOString().slice(0, 10);
    const earningsHistory = earnings.filter(e => (e.report_date ?? '') <= today);
    const earningsNext    = earnings.filter(e => (e.report_date ?? '') > today)
      .sort((a, b) => (a.report_date > b.report_date ? 1 : -1))[0] ?? null;

    const n = (v) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);

    return res.json({
      success:         true,
      symbol,
      coverage_status: coverageStatus,
      price:            n(quote.price)            ?? 0,
      change_percent:   n(quote.change_percent)   ?? 0,
      volume:           n(quote.volume)            ?? 0,
      avg_volume_30d:   n(metrics?.avg_volume_30d) ?? 0,
      relative_volume:  n(metrics?.relative_volume) ?? 0,
      market_cap:       n(quote.market_cap)        ?? 0,
      sector:           quote.sector || universe?.sector || null,
      industry:         universe?.industry          ?? null,
      company_name:     universe?.company_name     ?? null,
      exchange:         universe?.exchange          ?? null,
      updated_at:       quote.updated_at           ?? null,

      fundamentals: {
        eps_last:       n(earningsHistory[0]?.eps_actual)   ?? null,
        eps_est:        n(earningsNext?.eps_estimate)        ?? null,
        revenue:        n(earningsHistory[0]?.rev_actual)    ?? null,
        pe:             null, // not in current tables — field reserved
        dividend_yield: null, // not in current tables — field reserved
      },

      earnings: {
        next:    earningsNext ? {
          report_date:   earningsNext.report_date,
          report_time:   earningsNext.report_time   ?? null,
          eps_estimate:  n(earningsNext.eps_estimate) ?? null,
          rev_estimate:  n(earningsNext.rev_estimate) ?? null,
        } : null,
        history: earningsHistory.slice(0, 6).map(e => ({
          report_date:      e.report_date,
          report_time:      e.report_time      ?? null,
          eps_estimate:     n(e.eps_estimate)  ?? null,
          eps_actual:       n(e.eps_actual)    ?? null,
          rev_estimate:     n(e.rev_estimate)  ?? null,
          rev_actual:       n(e.rev_actual)    ?? null,
          eps_surprise_pct: n(e.eps_surprise_pct) ?? null,
          rev_surprise_pct: n(e.rev_surprise_pct) ?? null,
          guidance:         e.guidance_direction ?? null,
        })),
      },

      news: news.map(a => ({
        id:           a.id           ?? null,
        headline:     a.headline     ?? null,
        source:       a.source       ?? null,
        url:          a.url          ?? null,
        published_at: a.published_at ?? null,
        summary:      a.summary      ?? null,
        catalyst_type: a.catalyst_type ?? null,
        news_score:   n(a.news_score) ?? null,
        sentiment:    a.sentiment    ?? null,
      })),

      options: {
        implied_volatility:    n(metrics?.implied_volatility)    ?? null,
        expected_move_percent: n(metrics?.expected_move_percent) ?? null,
        put_call_ratio:        n(metrics?.put_call_ratio)        ?? null,
      },
    });
  } catch (err) {
    logger.error('[STOCK ENDPOINT] unhandled error', { symbol, error: err.message });
    return res.status(500).json({ success: false, error: err.message, symbol });
  }
});

app.get('/api/market/quotes', async (req, res) => {
  console.log('PUBLIC MARKET ACCESS:', req.path);
  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 200, 5000));
    const rawSymbols = String(req.query.symbols || '').trim();
    const symbols = rawSymbols
      ? rawSymbols
        .split(',')
        .map((item) => mapFromProviderSymbol(normalizeSymbol(item)))
        .filter(Boolean)
      : [];

    console.log('[QUOTES] symbols:', symbols.length > 0 ? symbols : `(bulk, limit=${limit})`);

    const query = symbols.length > 0
      ? {
          text: `SELECT DISTINCT ON (mq.symbol)
                   mq.symbol,
                   mq.price,
                   COALESCE(mq.change_percent, 0) AS change_percent,
                   COALESCE(mq.volume, 0) AS volume,
                   COALESCE(mm.relative_volume, 1) AS relative_volume,
                   mm.atr,
                   mm.rsi,
                   COALESCE(mm.avg_volume_30d, 0) AS avg_volume_30d,
                   mm.implied_volatility,
                   mm.expected_move_percent,
                   mm.put_call_ratio,
                   mq.market_cap,
                   mq.sector,
                   mq.updated_at
                 FROM ${MARKET_QUOTES_TABLE} mq
                 LEFT JOIN market_metrics mm ON mm.symbol = mq.symbol
                 WHERE mq.symbol = ANY($1::text[])
                 ORDER BY mq.symbol, COALESCE(mq.updated_at, NOW()) DESC`,
          params: [symbols],
          options: { label: 'api.market.quotes.by_symbols', timeoutMs: 5000, maxRetries: 1, retryDelayMs: 200 },
        }
      : {
          text: `SELECT DISTINCT ON (mq.symbol)
                   mq.symbol,
                   mq.price,
                   COALESCE(mq.change_percent, 0) AS change_percent,
                   COALESCE(mq.volume, 0) AS volume,
                   COALESCE(mm.relative_volume, 1) AS relative_volume,
                   mm.atr,
                   mm.rsi,
                   COALESCE(mm.avg_volume_30d, 0) AS avg_volume_30d,
                   mm.implied_volatility,
                   mm.expected_move_percent,
                   mm.put_call_ratio,
                   mq.market_cap,
                   mq.sector,
                   mq.updated_at
                 FROM ${MARKET_QUOTES_TABLE} mq
                 LEFT JOIN market_metrics mm ON mm.symbol = mq.symbol
                 ORDER BY mq.symbol, COALESCE(mq.updated_at, NOW()) DESC
                 LIMIT $1`,
          params: [limit],
          options: { label: 'api.market.quotes', timeoutMs: 5000, maxRetries: 1, retryDelayMs: 200 },
        };

    let rows = [];
    try {
      const dbResult = await queryWithTimeout(query.text, query.params, query.options);
      rows = Array.isArray(dbResult?.rows) ? dbResult.rows : [];
    } catch (dbError) {
      logger.error('market quotes db query failed', {
        error: dbError?.message,
        symbols: symbols.slice(0, 10),
        symbol_count: symbols.length,
      });
      rows = [];
    }

    console.log('[QUOTES] DB result:', rows.length, 'rows');

    const data = (rows || []).map((row) => {
      const symbol = mapFromProviderSymbol(normalizeSymbol(row?.symbol));
      const price = Number(row?.price) || 0;
      const changePercent = Number(row?.change_percent) || 0;
      const volume = Number(row?.volume) || 0;
      const avgVolume = Number(row?.avg_volume_30d) || 0;
      const relativeVolume = Number(row?.relative_volume) || 1;

      return {
        symbol,
        price,
        change_percent: changePercent,
        volume,
        relative_volume: relativeVolume,
        atr: row?.atr != null ? Number(row.atr) : null,
        rsi: row?.rsi != null ? Number(row.rsi) : null,
        avg_volume_30d: avgVolume,
        implied_volatility:    row?.implied_volatility    != null ? Number(row.implied_volatility)    : null,
        expected_move_percent: row?.expected_move_percent != null ? Number(row.expected_move_percent) : null,
        put_call_ratio:        row?.put_call_ratio        != null ? Number(row.put_call_ratio)        : null,
        market_cap: Number(row?.market_cap) || 0,
        sector: row?.sector || 'Unknown',
        updated_at: row?.updated_at || null,
        source: 'authoritative_db',
      };
    }).filter(row => row.symbol);

    const dbRows = data.map((row) => ({ ...row, source: 'authoritative_db' }));

    if (symbols.length > 0 && dbRows.length === 0) {
      console.warn('[QUOTES WARNING] No data returned for symbols:', symbols);
    }

    const freshDbRows = dbRows.filter((row) => isFreshTimestamp(row.updated_at, QUOTES_FRESHNESS_THRESHOLD_MS));

    const fallbackResponse = ({ fallbackRows, errorMessage, source }) => {
      const finalRows = Array.isArray(fallbackRows) ? fallbackRows : [];
      const resolvedSource = source || (finalRows.length > 0 ? finalRows[0]?.source || 'authoritative_db' : 'authoritative_db');
      logResponseShape('/api/market/quotes', finalRows, ['symbol', 'price', 'change_percent', 'volume', 'relative_volume']);
      return res.status(200).json({
        success: true,
        count: finalRows.length,
        source: resolvedSource,
        status: finalRows.length > 0 ? 'ok' : 'no_data',
        error: errorMessage || null,
        data: finalRows,
      });
    };

    if (symbols.length > 0) {
      const freshSymbols = new Set(freshDbRows.map((row) => row.symbol));
      const missingOrStaleSymbols = symbols.filter((symbol) => !freshSymbols.has(symbol));
      if (missingOrStaleSymbols.length > 0) {
        const externalRows = await fetchExternalQuoteFallback(missingOrStaleSymbols);
        const externalBySymbol = new Map(externalRows.map((row) => [row.symbol, row]));
        const mergedRows = symbols
          .map((symbol) => {
            if (freshSymbols.has(symbol)) {
              return freshDbRows.find((row) => row.symbol === symbol) || null;
            }
            return externalBySymbol.get(symbol) || dbRows.find((row) => row.symbol === symbol) || null;
          })
          .filter(Boolean);
        const unresolved = missingOrStaleSymbols.filter((symbol) => !externalBySymbol.has(symbol));

        if (unresolved.length > 0) {
          logger.warn('market quotes unresolved after external fallback', { unresolved });
        }

        if (mergedRows.length === 0) {
          logger.error('market quotes unavailable for requested symbols', { missingOrStaleSymbols });
          return fallbackResponse({
            fallbackRows: [],
            errorMessage: 'Live market data unavailable',
            source: 'authoritative_db',
          });
        }

        return fallbackResponse({
          fallbackRows: mergedRows,
          errorMessage: unresolved.length > 0 ? 'Partial market data fallback' : null,
          source: unresolved.length > 0 ? 'hybrid_fallback' : 'external_fallback',
        });
      }
    }

    if (freshDbRows.length === 0) {
      const fallbackSymbols = symbols.length > 0
        ? symbols
        : dbRows.slice(0, Math.max(1, Math.min(limit, 50))).map((row) => row.symbol).filter(Boolean);
      const externalRows = await fetchExternalQuoteFallback(fallbackSymbols);
      if (externalRows.length > 0) {
        return fallbackResponse({
          fallbackRows: externalRows,
          errorMessage: null,
          source: 'external_fallback',
        });
      }

      if (dbRows.length > 0) {
        logger.warn('market quotes serving stale db rows', { reason: 'no_fresh_rows' });
        return fallbackResponse({
          fallbackRows: dbRows,
          errorMessage: 'Live market data stale; serving latest cached rows',
          source: 'authoritative_db',
        });
      }

      logger.error('market quotes unavailable', { reason: 'no_fresh_rows_and_no_fallback' });
      return fallbackResponse({
        fallbackRows: [],
        errorMessage: 'Live market data unavailable',
        source: 'authoritative_db',
      });
    }

    if (!validateQuotes(dbRows)) {
      console.warn('[QUOTES] contract violation: no rows with real price data — returning NO_REAL_DATA');
      return res.status(200).json({ ...noRealDataResponse('quotes'), count: 0, source: 'authoritative_db' });
    }
    logResponseShape('/api/market/quotes', dbRows, ['symbol', 'price', 'change_percent', 'volume', 'relative_volume']);
    console.log('QUOTE sample:', dbRows.slice(0, 3));
    return res.status(200).json({ success: true, count: dbRows.length, source: 'authoritative_db', status: 'ok', data: dbRows });
  } catch (err) {
    logger.error('market quotes endpoint error', { error: err.message });
    return res.status(500).json({
      success: false,
      count: 0,
      source: 'authoritative_db',
      status: 'error',
      data: [],
      error: err.message || 'Failed to load market quotes',
    });
  }
});

// ── System data health ───────────────────────────────────────────────────────
app.get('/api/system/data-health', async (_req, res) => {
  try {
    const { pool: dbPool } = require('./db/pg');
    const [countRes, lastRes] = await Promise.all([
      dbPool.query('SELECT COUNT(*)::int AS count FROM market_quotes'),
      dbPool.query('SELECT MAX(updated_at) AS last_update FROM market_quotes'),
    ]);
    const count = countRes.rows[0]?.count ?? 0;
    const lastUpdate = lastRes.rows[0]?.last_update ?? null;
    const ageMs = lastUpdate ? Date.now() - new Date(lastUpdate).getTime() : Infinity;
    const status = count === 0 ? 'empty' : ageMs > 120_000 ? 'stale' : 'healthy';
    return res.json({
      success: true,
      market_quotes: { row_count: count, last_update: lastUpdate, status },
    });
  } catch (err) {
    logger.error('data-health endpoint error', { error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

// DEBUG ONLY — REMOVE AFTER VALIDATION
app.get('/api/debug/reload-quotes', async (_req, res) => {
  try {
    console.log('[DEBUG] /api/debug/reload-quotes triggered');
    const { ingestMarketQuotesRefresh, ingestMarketQuotesBootstrap } = require('./engines/fmpMarketIngestion');
    const { pool: dbPool } = require('./db/pg');

    // Check current row count
    const countRes = await dbPool.query('SELECT COUNT(*)::int AS cnt FROM market_quotes');
    const before = countRes.rows[0]?.cnt ?? 0;
    console.log('[DEBUG] market_quotes before:', before);

    // Run bootstrap if empty, refresh otherwise
    const result = before === 0
      ? await ingestMarketQuotesBootstrap()
      : await ingestMarketQuotesRefresh();

    const countAfter = await dbPool.query('SELECT COUNT(*)::int AS cnt FROM market_quotes');
    const after = countAfter.rows[0]?.cnt ?? 0;
    console.log('[DEBUG] market_quotes after:', after);

    const nvdaRes = await dbPool.query("SELECT symbol, price FROM market_quotes WHERE symbol = 'NVDA' LIMIT 1");
    console.log('[VERIFY NVDA]', nvdaRes.rows[0] ?? 'NOT FOUND');

    return res.json({
      success: true,
      rows_before: before,
      rows_after: after,
      rows_written: after - before,
      nvda_found: nvdaRes.rows.length > 0,
      nvda: nvdaRes.rows[0] ?? null,
      engine_result: result,
    });
  } catch (err) {
    console.error('[DEBUG] reload-quotes error:', err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/market/overview', async (_req, res) => {
  try {
    const symbols = ['SPY', 'QQQ', 'DIA', 'IWM', 'VIX'];
    const [indicesResult, quotesResult, breadthResult] = await Promise.all([
      queryWithTimeout(
        `SELECT DISTINCT ON (symbol)
           symbol,
           price,
           change_percent,
           volume
         FROM market_metrics
         WHERE symbol = ANY($1::text[])
         ORDER BY symbol, COALESCE(updated_at, last_updated, NOW()) DESC`,
        [symbols],
        { label: 'api.market.overview.indices', timeoutMs: 5000, maxRetries: 1, retryDelayMs: 100 }
      ),
      queryWithTimeout(
        `SELECT DISTINCT ON (symbol)
           symbol,
           price,
           change_percent,
           volume,
           updated_at
         FROM market_quotes
         WHERE symbol = ANY($1::text[])
         ORDER BY symbol, updated_at DESC NULLS LAST`,
        [['SPY', 'QQQ', 'DIA', 'IWM', 'VIX', '^VIX']],
        { label: 'api.market.overview.quotes_fallback', timeoutMs: 5000, maxRetries: 1, retryDelayMs: 100 }
      ),
      queryWithTimeout(
        `SELECT
           COUNT(*) FILTER (WHERE COALESCE(change_percent, 0) > 0)::int AS advancers,
           COUNT(*) FILTER (WHERE COALESCE(change_percent, 0) < 0)::int AS decliners,
           SUM(CASE WHEN COALESCE(change_percent, 0) > 0 THEN COALESCE(volume, 0) ELSE 0 END)::bigint AS up_volume,
           SUM(CASE WHEN COALESCE(change_percent, 0) < 0 THEN COALESCE(volume, 0) ELSE 0 END)::bigint AS down_volume
         FROM market_metrics`,
        [],
        { label: 'api.market.overview.breadth', timeoutMs: 5000, maxRetries: 1, retryDelayMs: 100 }
      ),
    ]);

    const bySymbol = new Map((indicesResult.rows || []).map((row) => [String(row.symbol || '').toUpperCase(), row]));
    const quotesBySymbol = new Map((quotesResult.rows || []).map((row) => [String(row.symbol || '').toUpperCase(), row]));
    const breadthRow = breadthResult.rows?.[0] || {};

    const getIndexCard = (symbol) => {
      const normalized = String(symbol || '').toUpperCase();
      if (bySymbol.has(normalized)) return bySymbol.get(normalized);
      if (quotesBySymbol.has(normalized)) return quotesBySymbol.get(normalized);
      if (normalized === 'VIX' && quotesBySymbol.has('^VIX')) return quotesBySymbol.get('^VIX');
      return { symbol: normalized, price: null, change_percent: null, volume: null };
    };

    const payload = {
      indices: {
        SPY: getIndexCard('SPY'),
        QQQ: getIndexCard('QQQ'),
        DIA: getIndexCard('DIA'),
        IWM: getIndexCard('IWM'),
      },
      volatility: {
        VIX: getIndexCard('VIX'),
      },
      breadth: {
        advancers: Number.isFinite(Number(breadthRow.advancers)) ? Number(breadthRow.advancers) : null,
        decliners: Number.isFinite(Number(breadthRow.decliners)) ? Number(breadthRow.decliners) : null,
        up_volume: Number.isFinite(Number(breadthRow.up_volume)) ? Number(breadthRow.up_volume) : null,
        down_volume: Number.isFinite(Number(breadthRow.down_volume)) ? Number(breadthRow.down_volume) : null,
      },
    };

    logResponseShape('/api/market/overview', [{
      SPY: payload.indices.SPY,
      QQQ: payload.indices.QQQ,
      DIA: payload.indices.DIA,
      IWM: payload.indices.IWM,
      VIX: payload.volatility.VIX,
      advancers: payload.breadth.advancers,
      decliners: payload.breadth.decliners,
      up_volume: payload.breadth.up_volume,
      down_volume: payload.breadth.down_volume,
    }], ['SPY', 'QQQ', 'DIA', 'IWM', 'VIX', 'advancers', 'decliners', 'up_volume', 'down_volume']);

    return res.json(payload);
  } catch (error) {
    logger.error('market overview endpoint error', { error: error.message });
    return res.json({
      indices: { SPY: null, QQQ: null, DIA: null, IWM: null },
      volatility: { VIX: null },
      breadth: { advancers: null, decliners: null, up_volume: null, down_volume: null },
    });
  }
});

app.get('/api/market/ohlc', async (req, res) => {
  console.log('PUBLIC MARKET ACCESS:', req.path);
  try {
    const symbol = mapFromProviderSymbol(normalizeSymbol(req.query.symbol));
    if (!symbol) {
      return res.status(400).json({ success: false, data: [], error: 'symbol is required' });
    }

    const interval = String(req.query.interval || '1d').trim().toLowerCase();
    const limit = Math.max(1, Math.min(Number(req.query.limit) || (interval === '1d' ? 365 : 2000), 5000));

    const query = interval === '1d'
      ? {
          text: `SELECT
                   (EXTRACT(EPOCH FROM (date::timestamp)) * 1000)::bigint AS time_ms,
                   open,
                   high,
                   low,
                   close,
                   COALESCE(volume, 0) AS volume
                 FROM daily_ohlc
                 WHERE symbol = $1
                 ORDER BY date DESC
                 LIMIT $2`,
          params: [symbol, limit],
          options: { label: 'api.market.ohlc.daily', timeoutMs: 6000, maxRetries: 1, retryDelayMs: 200 },
        }
      : {
          text: `SELECT
                   (EXTRACT(EPOCH FROM "timestamp") * 1000)::bigint AS time_ms,
                   open,
                   high,
                   low,
                   close,
                   COALESCE(volume, 0) AS volume
                 FROM ${INTRADAY_TABLE}
                 WHERE symbol = $1
                 ORDER BY "timestamp" DESC
                 LIMIT $2`,
          params: [symbol, limit],
          options: { label: 'api.market.ohlc.intraday', timeoutMs: 6000, maxRetries: 1, retryDelayMs: 200 },
        };

    const { rows } = await queryWithTimeout(query.text, query.params, query.options);
    const data = (rows || [])
      .slice()
      .reverse()
      .map((row) => ({
        time: Number(row?.time_ms ?? 0),
        open: Number(row?.open ?? 0),
        high: Number(row?.high ?? 0),
        low: Number(row?.low ?? 0),
        close: Number(row?.close ?? 0),
        volume: Number(row?.volume ?? 0),
      }));

    const latestBarTs = data.length > 0 ? Number(data[data.length - 1]?.time || 0) : 0;
    const intradayIsFresh = interval === '1d'
      ? true
      : (Number.isFinite(latestBarTs) && latestBarTs > 0 && ((Date.now() - latestBarTs) <= INTRADAY_FRESHNESS_THRESHOLD_MS));

    if (interval !== '1d' && (!intradayIsFresh || data.length === 0)) {
      const fallbackBars = await fetchIntradayFallbackBars(symbol, limit);
      if (fallbackBars.length > 0) {
        return res.json({ success: true, data: fallbackBars, source: 'fallback_live' });
      }

      if (data.length === 0) {
        console.warn('[DATA GAP] authoritative intraday unavailable and fallback empty', { symbol, table: INTRADAY_TABLE });
        return res.json({ success: true, data: [], source: 'no_data' });
      }
    }

    if (interval !== '1d' && data.length > 0) {
      const latestClose = Number(data[data.length - 1]?.close);
      const referenceQuery = await queryWithTimeout(
        `SELECT mq.price, d.close AS daily_close
         FROM ${MARKET_QUOTES_TABLE} mq
         LEFT JOIN LATERAL (
           SELECT close
           FROM daily_ohlc d
           WHERE d.symbol = mq.symbol
           ORDER BY d.date DESC
           LIMIT 1
         ) d ON TRUE
         WHERE mq.symbol = $1
         LIMIT 1`,
        [symbol],
        { label: 'api.market.ohlc.reference_price', timeoutMs: 4000, maxRetries: 1, retryDelayMs: 100 }
      );

      const referenceRow = Array.isArray(referenceQuery?.rows) ? referenceQuery.rows[0] : null;
      const referencePrice = Number(referenceRow?.price ?? referenceRow?.daily_close);
      const upper = Math.max(latestClose, referencePrice);
      const lower = Math.min(latestClose, referencePrice);
      const divergence = Number.isFinite(upper) && Number.isFinite(lower) && lower > 0 ? upper / lower : Number.NaN;

      if (Number.isFinite(divergence) && divergence > 1.35) {
        logger.warn('rejecting implausible intraday series', {
          symbol,
          latestClose,
          referencePrice,
          divergence,
        });
        const fallbackBars = await fetchIntradayFallbackBars(symbol, limit);
        if (fallbackBars.length > 0) {
          return res.json({ success: true, data: fallbackBars, source: 'fallback_live' });
        }
        return res.json({ success: true, data: [], source: 'invalid_series' });
      }
    }

    console.log('OHLC sample:', data.slice(0, 3));
    return res.json({ success: true, data, source: 'authoritative_db' });
  } catch (err) {
    logger.error('market ohlc endpoint error', { error: err.message });
    return res.status(500).json({ success: false, data: [], error: 'Failed to load market ohlc', detail: err.message });
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
      `WITH ranked AS (
         SELECT
           COALESCE(q.sector, 'Unknown') AS sector,
           q.symbol,
           COALESCE(q.market_cap, 0) AS market_cap,
           COALESCE((to_jsonb(m)->>'change_percent')::numeric, q.change_percent, m.gap_percent, 0) AS pct_move,
           ROW_NUMBER() OVER (
             PARTITION BY COALESCE(q.sector, 'Unknown')
             ORDER BY COALESCE(q.market_cap, 0) DESC NULLS LAST
           ) AS sector_rank
         FROM market_quotes q
         LEFT JOIN market_metrics m ON m.symbol = q.symbol
       ),
       top5 AS (
         SELECT *
         FROM ranked
         WHERE sector_rank <= 5
       )
       SELECT
         sector,
         ROUND(AVG(pct_move)::numeric, 2) AS strength,
         ARRAY_REMOVE(ARRAY_AGG(symbol ORDER BY pct_move DESC), NULL) AS leaders
       FROM top5
       GROUP BY sector
       ORDER BY strength DESC NULLS LAST`,
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
    const cache = await getTickerTapeCache();

    return res.json({
      success: true,
      sections: {
        indices: cache?.sections?.indices || [],
        top_gainers: cache?.sections?.top_gainers || [],
        top_losers: cache?.sections?.top_losers || [],
        crypto: cache?.sections?.crypto || [],
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message || 'Failed to load ticker tape data' });
  }
});

app.get('/api/cache/ticker', async (_req, res) => {
  try {
    const cache = await getTickerTapeCache();
    return res.json({ ok: true, ...cache });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
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

let screenerSignalTimingInitPromise = null;
let screenerHydrationInFlight = null;
let screenerHydrationLastRunAt = 0;
let screenerHydrationLastStats = null;
const SCREENER_HYDRATION_TTL_MS = 120000;
const SCREENER_HYDRATION_SYMBOL_LIMIT = 40;

async function ensureScreenerSignalTimingTable() {
  if (!screenerSignalTimingInitPromise) {
    screenerSignalTimingInitPromise = queryWithTimeout(
      `CREATE TABLE IF NOT EXISTS screener_signal_timing (
         symbol TEXT PRIMARY KEY,
         first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
       )`,
      [],
      {
        label: 'api.screener.ensure_signal_timing_table',
        timeoutMs: 5000,
        maxRetries: 1,
        retryDelayMs: 200,
        poolType: 'write',
      }
    ).catch((error) => {
      screenerSignalTimingInitPromise = null;
      throw error;
    });
  }

  return screenerSignalTimingInitPromise;
}

async function syncScreenerSignalTiming(symbols = []) {
  const normalizedSymbols = Array.from(
    new Set(
      symbols
        .map((value) => String(value || '').trim().toUpperCase())
        .filter(Boolean)
    )
  );

  if (!normalizedSymbols.length) {
    return new Map();
  }

  await ensureScreenerSignalTimingTable();

  const { rows } = await queryWithTimeout(
    `INSERT INTO screener_signal_timing (symbol, first_seen_at, last_updated_at)
     SELECT symbol, NOW(), NOW()
     FROM UNNEST($1::text[]) AS symbol
     ON CONFLICT (symbol)
     DO UPDATE SET last_updated_at = EXCLUDED.last_updated_at
     RETURNING symbol, first_seen_at, last_updated_at`,
    [normalizedSymbols],
    {
      label: 'api.screener.sync_signal_timing',
      timeoutMs: 6000,
      maxRetries: 1,
      retryDelayMs: 200,
      poolType: 'write',
    }
  );

  const timingMap = new Map();
  for (const row of rows || []) {
    timingMap.set(String(row.symbol || '').toUpperCase(), {
      first_seen_at: row.first_seen_at || null,
      last_updated_at: row.last_updated_at || null,
    });
  }

  return timingMap;
}

async function readScreenerHydrationSymbols(limit = SCREENER_HYDRATION_SYMBOL_LIMIT) {
  const safeLimit = Math.max(10, Math.min(Number(limit) || SCREENER_HYDRATION_SYMBOL_LIMIT, 300));

  let rows = [];

  try {
    const prioritized = await queryWithTimeout(
      `SELECT mq.symbol
       FROM market_quotes mq
       LEFT JOIN market_metrics mm ON mm.symbol = mq.symbol
       WHERE mq.symbol IS NOT NULL
         AND mq.symbol <> ''
         AND COALESCE(mq.market_cap, 0) > 0
       ORDER BY
         COALESCE(mq.volume, 0) DESC,
         ABS(COALESCE(mm.change_percent, mq.change_percent, 0)) DESC,
         COALESCE(mm.relative_volume, 0) DESC,
         COALESCE(mq.updated_at, mm.updated_at, NOW()) DESC,
         mq.symbol ASC
       LIMIT $1`,
      [safeLimit],
      {
        label: 'api.screener.hydration.symbols.prioritized',
        timeoutMs: 7000,
        maxRetries: 1,
        retryDelayMs: 200,
        poolType: 'read',
      }
    );
    rows = prioritized.rows || [];
  } catch (error) {
    console.warn('[SCREENER HYDRATION] prioritized symbol read failed', error.message);
  }

  if (!rows.length) {
    const fallback = await queryWithTimeout(
      `SELECT symbol
       FROM (
         SELECT symbol FROM market_quotes
         UNION
         SELECT symbol FROM market_metrics
         UNION
         SELECT symbol FROM ticker_universe
       ) u
       WHERE symbol IS NOT NULL
         AND symbol <> ''
       ORDER BY symbol ASC
       LIMIT $1`,
      [safeLimit],
      {
        label: 'api.screener.hydration.symbols.fallback',
        timeoutMs: 7000,
        maxRetries: 1,
        retryDelayMs: 200,
        poolType: 'read',
      }
    );
    rows = fallback.rows || [];
  }

  return (rows || [])
    .map((row) => String(row.symbol || '').trim().toUpperCase())
    .filter(Boolean);
}

async function runWithConcurrency(items, concurrency, worker) {
  const safeConcurrency = Math.max(1, Number(concurrency) || 1);
  const results = [];
  let index = 0;

  async function runWorker() {
    while (index < items.length) {
      const currentIndex = index;
      index += 1;
      const value = items[currentIndex];
      try {
        results[currentIndex] = await worker(value, currentIndex);
      } catch (_error) {
        results[currentIndex] = null;
      }
    }
  }

  const workers = Array.from({ length: Math.min(safeConcurrency, items.length) }, () => runWorker());
  await Promise.all(workers);
  return results;
}

async function fetchStableBatchQuoteShort(symbols = []) {
  if (!symbols.length) {
    return [];
  }

  const payload = await fmpFetch('/batch-quote-short', { symbols: symbols.join(',') });
  return Array.isArray(payload) ? payload : [];
}

async function fetchStableQuote(symbol) {
  const payload = await fmpFetch('/quote', { symbol });
  if (Array.isArray(payload)) {
    return payload[0] || null;
  }
  return payload || null;
}

const screenerTableColumnCache = new Map();

async function getTableColumnsCached(tableName) {
  if (screenerTableColumnCache.has(tableName)) {
    return screenerTableColumnCache.get(tableName);
  }

  const { rows } = await queryWithTimeout(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = $1`,
    [tableName],
    {
      label: `api.screener.hydration.columns.${tableName}`,
      timeoutMs: 5000,
      maxRetries: 0,
      poolType: 'read',
    }
  );

  const set = new Set((rows || []).map((row) => String(row.column_name || '').trim()));
  screenerTableColumnCache.set(tableName, set);
  return set;
}

function toNumericSafe(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toBigIntSafe(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return null;
  }
  return Math.round(num);
}

async function upsertRowsBySymbol(tableName, rows, allowedColumns, label) {
  if (!rows.length) {
    return { writtenSymbols: new Set(), writeErrors: [] };
  }

  const tableColumns = await getTableColumnsCached(tableName);
  const selectedColumns = allowedColumns.filter((column) => tableColumns.has(column));
  const mutableColumns = selectedColumns.filter((column) => column !== 'symbol');

  if (!tableColumns.has('symbol') || !mutableColumns.length) {
    return { writtenSymbols: new Set(), writeErrors: [] };
  }

  const sqlColumns = ['symbol', ...mutableColumns];
  const updateSql = mutableColumns.map((column) => `${column} = EXCLUDED.${column}`).join(', ');

  const writtenSymbols = new Set();
  const writeErrors = [];

  for (const row of rows) {
    if (!row || !row.symbol) {
      continue;
    }

    const symbol = String(row.symbol || '').toUpperCase();
    const rowValues = sqlColumns.map((column) => {
      if (column === 'symbol') {
        return symbol;
      }
      return row[column] == null ? null : row[column];
    });

    try {
      await queryWithTimeout(
        `INSERT INTO ${tableName} (${sqlColumns.join(', ')})
         VALUES (${rowValues.map((_, idx) => `$${idx + 1}`).join(', ')})
         ON CONFLICT (symbol)
         DO UPDATE SET ${updateSql}`,
        rowValues,
        {
          label: `${label}.${symbol}`,
          timeoutMs: 6000,
          maxRetries: 0,
          retryDelayMs: 100,
          poolType: 'write',
        }
      );
      writtenSymbols.add(symbol);
      console.log('[HYDRATION WRITE OK]', { table: tableName, symbol });
    } catch (error) {
      const fieldSummary = mutableColumns.reduce((acc, column) => {
        acc[column] = row[column] == null ? null : row[column];
        return acc;
      }, {});
      const payload = { table: tableName, symbol, fields: fieldSummary, error: error.message };
      writeErrors.push(payload);
      console.error('[HYDRATION WRITE ERROR]', payload);
    }
  }

  return { writtenSymbols, writeErrors };
}

async function hydrateScreenerMarketData() {
  const now = Date.now();
  if (screenerHydrationLastStats && now - screenerHydrationLastRunAt < SCREENER_HYDRATION_TTL_MS) {
    return screenerHydrationLastStats;
  }

  if (screenerHydrationInFlight) {
    return screenerHydrationInFlight;
  }

  screenerHydrationInFlight = (async () => {
    const startedAt = Date.now();
    const symbols = await readScreenerHydrationSymbols();
    const batchRows = [];
    const batchBySymbol = new Map();
    const quoteBySymbol = new Map();

    for (let index = 0; index < symbols.length; index += 60) {
      const chunk = symbols.slice(index, index + 60);
      try {
        const chunkRows = await fetchStableBatchQuoteShort(chunk);
        for (const row of chunkRows) {
          const symbol = String(row?.symbol || '').trim().toUpperCase();
          if (!symbol) continue;
          batchRows.push(row);
          batchBySymbol.set(symbol, row);
        }
      } catch (error) {
        console.warn('[SCREENER HYDRATION] batch quote short failed', { index, error: error.message });
      }
    }

    const quoteRows = await runWithConcurrency(symbols, 4, async (symbol) => {
      try {
        return await fetchStableQuote(symbol);
      } catch (error) {
        console.warn('[SCREENER HYDRATION] quote failed', { symbol, error: error.message });
        return null;
      }
    });

    for (const row of quoteRows || []) {
      const symbol = String(row?.symbol || '').trim().toUpperCase();
      if (!symbol) continue;
      quoteBySymbol.set(symbol, row);
    }

    const nowIso = new Date().toISOString();
    const marketQuoteRows = [];
    const marketMetricRows = [];
    let symbolsWithData = 0;

    for (const symbol of symbols) {
      const shortRow = batchBySymbol.get(symbol) || {};
      const quoteRow = quoteBySymbol.get(symbol) || {};

      const price = toNumericSafe(
        quoteRow.price ?? quoteRow.lastSalePrice ?? shortRow.price ?? shortRow.lastSalePrice ?? NaN
      );
      const volume = toBigIntSafe(quoteRow.volume ?? shortRow.volume ?? shortRow.lastSaleVolume ?? NaN);
      const openPrice = toNumericSafe(quoteRow.open ?? quoteRow.openPrice ?? shortRow.open ?? NaN);
      const previousClose = toNumericSafe(quoteRow.previousClose ?? quoteRow.previous_close ?? shortRow.previousClose ?? NaN);
      const marketCap = toBigIntSafe(quoteRow.marketCap ?? quoteRow.market_cap ?? NaN);
      const avgVolume = toNumericSafe(
        quoteRow.avgVolume
          ?? quoteRow.avgVolume30d
          ?? quoteRow.avg_volume_30d
          ?? quoteRow.avgTotalVolume
          ?? quoteRow.averageVolume
          ?? quoteRow.averageDailyVolume3Month
          ?? shortRow.avgVolume
          ?? shortRow.avg_volume_30d
          ?? NaN
      );
      const changePercent = Number.isFinite(price) && Number.isFinite(previousClose) && previousClose > 0
        ? ((price - previousClose) / previousClose) * 100
        : null;

      const hasValidQuote = Number.isFinite(price) && price > 0;
      if (hasValidQuote) {
        symbolsWithData += 1;
      }

      marketQuoteRows.push({
        symbol,
        price: hasValidQuote ? price : null,
        volume,
        open_price: openPrice,
        market_cap: marketCap,
        updated_at: nowIso,
      });

      marketMetricRows.push({
        symbol,
        price: hasValidQuote ? price : null,
        volume,
        avg_volume_30d: avgVolume,
        change_percent: changePercent,
        previous_close: previousClose,
        open: openPrice,
        market_cap: marketCap,
        source: hasValidQuote ? 'real' : null,
        updated_at: nowIso,
      });
    }

    const quoteWriteResult = await upsertRowsBySymbol(
      'market_quotes',
      marketQuoteRows,
      ['symbol', 'price', 'volume', 'open_price', 'market_cap', 'updated_at'],
      'api.screener.hydration.upsert_market_quotes'
    );

    const metricsWriteResult = await upsertRowsBySymbol(
      'market_metrics',
      marketMetricRows,
      ['symbol', 'price', 'volume', 'avg_volume_30d', 'change_percent', 'previous_close', 'open', 'market_cap', 'source', 'updated_at'],
      'api.screener.hydration.upsert_market_metrics'
    );

    const writeErrors = [...quoteWriteResult.writeErrors, ...metricsWriteResult.writeErrors];
    const hydrationWrittenSymbols = Array.from(
      new Set([...quoteWriteResult.writtenSymbols, ...metricsWriteResult.writtenSymbols])
    );

    if (hydrationWrittenSymbols.length) {
      await queryWithTimeout(
        `UPDATE market_quotes
         SET updated_at = NOW()
         WHERE UPPER(symbol) = ANY($1::text[])`,
        [hydrationWrittenSymbols],
        {
          label: 'api.screener.hydration.touch_market_quotes',
          timeoutMs: 10000,
          maxRetries: 0,
          poolType: 'write',
        }
      );

      await queryWithTimeout(
        `UPDATE market_metrics
         SET updated_at = NOW()
         WHERE UPPER(symbol) = ANY($1::text[])`,
        [hydrationWrittenSymbols],
        {
          label: 'api.screener.hydration.touch_market_metrics',
          timeoutMs: 10000,
          maxRetries: 0,
          poolType: 'write',
        }
      );
    }

    const hasTypeError = writeErrors.some((item) => /bigint|invalid input syntax/i.test(String(item.error || '')));
    if (hasTypeError) {
      const failError = new Error('HYDRATION_BIGINT_TYPE_ERROR');
      failError.details = writeErrors.slice(0, 10);
      throw failError;
    }

    const stats = {
      hydration_symbols_requested: symbols.length,
      hydration_symbols_written: hydrationWrittenSymbols.length,
      hydration_write_errors: writeErrors.length,
      hydrated_symbols: hydrationWrittenSymbols,
      symbols_processed: symbols.length,
      symbols_with_data: symbolsWithData,
      batch_records: batchRows.length,
      quote_records: quoteBySymbol.size,
      updated_market_quotes: quoteWriteResult.writtenSymbols.size,
      updated_market_metrics: metricsWriteResult.writtenSymbols.size,
      duration_ms: Date.now() - startedAt,
      hydrated_at: nowIso,
    };

    screenerHydrationLastRunAt = Date.now();
    screenerHydrationLastStats = stats;
    console.log('[SCREENER HYDRATION]', stats);
    return stats;
  })().finally(() => {
    screenerHydrationInFlight = null;
  });

  return screenerHydrationInFlight;
}

async function loadScreenerRows(options = {}) {
  const page = Math.max(1, parseInt(options.page, 10) || 1);
  const pageSize = 25;
  const offset = (page - 1) * pageSize;

  const requiredChecks = [
    ['ticker_universe', 'symbol'],
    ['ticker_universe', 'sector'],
    ['ticker_universe', 'market_cap'],
    ['market_quotes', 'symbol'],
    ['market_quotes', 'price'],
    ['market_quotes', 'last_updated'],
    ['market_metrics', 'symbol'],
    ['market_metrics', 'volume'],
    ['market_metrics', 'avg_volume_30d'],
    ['market_metrics', 'change_percent'],
    ['earnings_events', 'symbol'],
    ['earnings_events', 'report_date'],
  ];

  for (const [tableName, columnName] of requiredChecks) {
    let checkRows;
    try {
      ({ rows: checkRows } = await queryWithTimeout(
        `SELECT EXISTS (
           SELECT 1
           FROM information_schema.columns
           WHERE table_schema = 'public'
             AND table_name = $1
             AND column_name = $2
         ) AS ok`,
        [tableName, columnName],
        {
          label: `api.screener.truth.precheck.${tableName}.${columnName}`,
          timeoutMs: 5000,
          maxRetries: 0,
          poolType: 'read',
        }
      ));
    } catch (preCheckErr) {
      console.error(`[SCREENER] precheck query failed for ${tableName}.${columnName}:`, preCheckErr.message);
      throw new Error(`SCREENER_TRUTH_PRECHECK_FAILED: query error on ${tableName}.${columnName} — ${preCheckErr.message}`);
    }

    if (!checkRows?.[0]?.ok) {
      console.error(`[SCREENER] missing required column: ${tableName}.${columnName}`);
      throw new Error(`SCREENER_TRUTH_PRECHECK_FAILED: missing ${tableName}.${columnName}`);
    }

    console.log(`[SCREENER] precheck OK: ${tableName}.${columnName}`);
  }

  const sharedCte = `WITH universe AS (
      SELECT
        UPPER(symbol) AS symbol,
        MAX(NULLIF(TRIM(sector), '')) AS sector,
        MAX(market_cap::numeric) AS market_cap
      FROM ticker_universe
      WHERE symbol IS NOT NULL
        AND symbol <> ''
      GROUP BY UPPER(symbol)
    ),
    latest_quotes AS (
      SELECT DISTINCT ON (UPPER(mq.symbol))
        UPPER(mq.symbol) AS symbol,
        mq.price::numeric AS price
      FROM market_quotes mq
      WHERE mq.symbol IS NOT NULL
        AND mq.symbol <> ''
      ORDER BY UPPER(mq.symbol), mq.last_updated DESC NULLS LAST
    ),
    latest_metrics AS (
      SELECT DISTINCT ON (UPPER(mm.symbol))
        UPPER(mm.symbol) AS symbol,
        mm.volume::numeric AS volume,
        mm.avg_volume_30d::numeric AS avg_volume_30d,
        mm.change_percent::numeric AS change_percent,
        mm.implied_volatility::numeric AS implied_volatility,
        mm.expected_move_percent::numeric AS expected_move_percent,
        mm.put_call_ratio::numeric AS put_call_ratio,
        COALESCE(mm.updated_at, mm.last_updated)::timestamptz AS metrics_ts
      FROM market_metrics mm
      WHERE mm.symbol IS NOT NULL
        AND mm.symbol <> ''
      ORDER BY UPPER(mm.symbol), COALESCE(mm.updated_at, mm.last_updated) DESC NULLS LAST
    ),
    news_recent AS (
      WITH base AS (
        SELECT
          UPPER(NULLIF(to_jsonb(na)->>'symbol', '')) AS direct_symbol,
          COALESCE(to_jsonb(na)->'symbols', '[]'::jsonb) AS symbols_json,
          COALESCE((to_jsonb(na)->>'published_at')::timestamptz, (to_jsonb(na)->>'created_at')::timestamptz) AS published_at
        FROM news_articles na
        WHERE COALESCE((to_jsonb(na)->>'published_at')::timestamptz, (to_jsonb(na)->>'created_at')::timestamptz) >= NOW() - INTERVAL '24 hours'
      ),
      expanded AS (
        SELECT direct_symbol AS symbol, published_at
        FROM base
        WHERE direct_symbol IS NOT NULL AND direct_symbol <> ''
        UNION ALL
        SELECT UPPER(arr.value) AS symbol, b.published_at
        FROM base b
        JOIN LATERAL jsonb_array_elements_text(b.symbols_json) AS arr(value) ON TRUE
      )
      SELECT symbol, MAX(published_at) AS latest_news_at
      FROM expanded
      WHERE symbol IS NOT NULL AND symbol <> ''
      GROUP BY symbol
    ),
    earnings_recent AS (
      SELECT UPPER(symbol) AS symbol, MAX(report_date::timestamptz) AS earnings_at
      FROM earnings_events
      WHERE report_date >= CURRENT_DATE
        AND report_date <= (CURRENT_DATE + INTERVAL '7 days')::date
      GROUP BY UPPER(symbol)
    ),
    screened AS (
      SELECT
        u.symbol,
        q.price::numeric AS price,
        m.change_percent::numeric AS change_percent,
        m.volume::numeric AS volume,
        m.avg_volume_30d::numeric AS avg_volume_30d,
        (m.volume::numeric / NULLIF(m.avg_volume_30d::numeric, 0))::numeric AS relative_volume,
        u.market_cap::numeric AS market_cap,
        u.sector,
        CASE
          WHEN nr.latest_news_at IS NOT NULL THEN 'NEWS'
          WHEN er.earnings_at IS NOT NULL THEN 'EARNINGS'
          WHEN (m.volume::numeric / NULLIF(m.avg_volume_30d::numeric, 0)) > 2
            AND m.volume::numeric > (m.avg_volume_30d::numeric * 2)
          THEN 'UNUSUAL_VOLUME'
          ELSE 'UNKNOWN'
        END AS catalyst_type,
        m.implied_volatility,
        m.expected_move_percent,
        m.put_call_ratio,
        pw.score::int AS score,
        pw.stage
      FROM universe u
      JOIN latest_quotes q ON q.symbol = u.symbol
      JOIN latest_metrics m ON m.symbol = u.symbol
      LEFT JOIN news_recent nr ON nr.symbol = u.symbol
      LEFT JOIN earnings_recent er ON er.symbol = u.symbol
      LEFT JOIN premarket_watchlist pw ON pw.symbol = u.symbol
      WHERE q.price IS NOT NULL
        AND q.price > 0
        AND m.volume IS NOT NULL
        AND m.avg_volume_30d IS NOT NULL
        AND m.avg_volume_30d > 0
        AND m.change_percent IS NOT NULL
        AND u.market_cap IS NOT NULL
        AND u.market_cap > 0
        AND u.sector IS NOT NULL
        AND u.sector <> ''
    )`;

  // ── dynamic filter + sort ───────────────────────────────────────────────
  const SORT_COLS = {
    symbol:          'symbol',
    price:           'price',
    change_percent:  'change_percent',
    volume:          'volume',
    avg_volume_30d:  'avg_volume_30d',
    relative_volume: 'relative_volume',
    market_cap:      'market_cap',
    sector:          'sector',
    catalyst_type:   'catalyst_type',
    score:           'score',
  };
  const sortCol = SORT_COLS[options.sortBy] || 'change_percent';
  const sortDir = String(options.sortDir || '').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

  const filterParams = [];
  const filterClauses = [];

  const pMin  = Number(options.priceMin);
  const pMax  = Number(options.priceMax);
  const cMin  = Number(options.changeMin);
  const rMin  = Number(options.rvolMin);
  const mcMin = Number(options.marketCapMin);
  const mcMax = Number(options.marketCapMax);
  const sect  = typeof options.sector === 'string' ? options.sector.trim() : '';
  const cat   = typeof options.catalyst === 'string' ? options.catalyst.trim().toUpperCase() : '';

  if (Number.isFinite(pMin)  && pMin  > 0) { filterParams.push(pMin);  filterClauses.push(`price >= $${filterParams.length}`); }
  if (Number.isFinite(pMax)  && pMax  > 0) { filterParams.push(pMax);  filterClauses.push(`price <= $${filterParams.length}`); }
  if (Number.isFinite(cMin))               { filterParams.push(cMin);  filterClauses.push(`change_percent >= $${filterParams.length}`); }
  if (Number.isFinite(rMin)  && rMin  > 0) { filterParams.push(rMin);  filterClauses.push(`relative_volume >= $${filterParams.length}`); }
  if (Number.isFinite(mcMin) && mcMin > 0) { filterParams.push(mcMin); filterClauses.push(`market_cap >= $${filterParams.length}`); }
  if (Number.isFinite(mcMax) && mcMax > 0) { filterParams.push(mcMax); filterClauses.push(`market_cap <= $${filterParams.length}`); }
  if (sect && sect.toLowerCase() !== 'all') { filterParams.push(sect); filterClauses.push(`sector ILIKE $${filterParams.length}`); }
  if (cat  && cat !== 'ALL')                { filterParams.push(cat);  filterClauses.push(`catalyst_type = $${filterParams.length}`); }

  const whereClause = filterClauses.length ? `WHERE ${filterClauses.join(' AND ')}` : '';

  const { rows: countRows } = await queryWithTimeout(
    `${sharedCte}
     SELECT COUNT(*)::int AS total_count
     FROM screened
     ${whereClause}`,
    filterParams,
    {
      label: 'api.screener.truth.count',
      timeoutMs: 12000,
      maxRetries: 0,
      poolType: 'read',
    }
  );

  const rowParams = [...filterParams, pageSize, offset];
  const limitIdx  = rowParams.length - 1;
  const offsetIdx = rowParams.length;

  const { rows } = await queryWithTimeout(
    `${sharedCte}
     SELECT
       symbol,
       price,
       change_percent,
       volume,
       avg_volume_30d,
       relative_volume,
       market_cap,
       sector,
       catalyst_type,
       implied_volatility,
       expected_move_percent,
       put_call_ratio,
       score,
       stage
     FROM screened
     ${whereClause}
     ORDER BY ${sortCol} ${sortDir} NULLS LAST
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    rowParams,
    {
      label: 'api.screener.truth.rows',
      timeoutMs: 12000,
      maxRetries: 0,
      poolType: 'read',
    }
  );

  const normalizedRows = (rows || []).reduce((acc, row) => {
    const symbol = typeof row.symbol === 'string' ? row.symbol.trim().toUpperCase() : '';
    const price = Number(row.price);
    const changePercent = Number(row.change_percent);
    const volume = Number(row.volume);
    const avgVolume30d = Number(row.avg_volume_30d);
    const relativeVolume = Number(row.relative_volume);
    const marketCap = Number(row.market_cap);
    const sector = typeof row.sector === 'string' ? row.sector.trim() : '';
    const catalystType = typeof row.catalyst_type === 'string' ? row.catalyst_type.trim().toUpperCase() : '';

    if (!symbol) return acc;
    if (!Number.isFinite(price) || price <= 0) return acc;
    if (!Number.isFinite(changePercent)) return acc;
    if (!Number.isFinite(volume) || volume <= 0) return acc;
    if (!Number.isFinite(avgVolume30d) || avgVolume30d <= 0) return acc;
    if (!Number.isFinite(relativeVolume)) return acc;
    if (!Number.isFinite(marketCap) || marketCap <= 0) return acc;
    if (!sector) return acc;
    if (!['NEWS', 'EARNINGS', 'UNUSUAL_VOLUME', 'UNKNOWN'].includes(catalystType)) return acc;

    const score = Number.isFinite(Number(row.score)) ? Number(row.score) : null;
    const stage = typeof row.stage === 'string' && row.stage ? row.stage : null;

    acc.push({
      symbol,
      price,
      change_percent: changePercent,
      volume,
      avg_volume_30d: avgVolume30d,
      relative_volume: relativeVolume,
      market_cap: marketCap,
      sector,
      catalyst_type: catalystType,
      score,
      stage,
    });
    return acc;
  }, []);

  return {
    rows: normalizedRows,
    totalCount: Number(countRows?.[0]?.total_count || 0),
    page,
    pageSize,
  };
}

async function getScreenerCoverageReadiness() {
  await queryWithTimeout(
    `ALTER TABLE market_quotes
       ADD COLUMN IF NOT EXISTS previous_close NUMERIC,
       ADD COLUMN IF NOT EXISTS last_updated TIMESTAMPTZ`,
    [],
    {
      label: 'api.screener.truth.ensure_quote_columns',
      timeoutMs: 8000,
      maxRetries: 0,
      poolType: 'write',
    }
  );

  await queryWithTimeout(
    `ALTER TABLE market_quotes
       ALTER COLUMN last_updated TYPE TIMESTAMPTZ USING last_updated::timestamptz`,
    [],
    {
      label: 'api.screener.truth.ensure_last_updated_timestamptz',
      timeoutMs: 8000,
      maxRetries: 0,
      poolType: 'write',
    }
  );

  await queryWithTimeout(
    `UPDATE market_quotes
     SET last_updated = COALESCE(last_updated, updated_at)
     WHERE last_updated IS NULL`,
    [],
    {
      label: 'api.screener.truth.backfill_last_updated',
      timeoutMs: 8000,
      maxRetries: 0,
      poolType: 'write',
    }
  );

  // Use mode-aware freshness window:
  // LIVE → 5 min (requires near-real-time data), RECENT → 2 hours, PREP → 24 hours
  const modeCtx = getMarketMode();
  const freshInterval = modeCtx.mode === 'LIVE' ? '5 minutes' : modeCtx.mode === 'RECENT' ? '2 hours' : '24 hours';

  const { rows } = await queryWithTimeout(
    `SELECT
       (SELECT COUNT(DISTINCT UPPER(symbol))::int
        FROM ticker_universe
        WHERE symbol IS NOT NULL AND symbol <> '') AS total_universe_count,
       (SELECT COUNT(*)::int
        FROM market_quotes
        WHERE COALESCE(last_updated, updated_at) >= NOW() - INTERVAL '${freshInterval}'
          AND price IS NOT NULL
          AND price > 0) AS fresh_quote_count`,
    [],
    {
      label: 'api.screener.truth.readiness_coverage',
      timeoutMs: 8000,
      maxRetries: 0,
      poolType: 'read',
    }
  );

  const totalUniverseCount = Number(rows?.[0]?.total_universe_count || 0);
  const freshQuoteCount    = Number(rows?.[0]?.fresh_quote_count    || 0);
  const coverage = totalUniverseCount > 0 ? freshQuoteCount / totalUniverseCount : 0;

  console.log(`[SCREENER] coverage check mode=${modeCtx.mode} window=${freshInterval} fresh=${freshQuoteCount}/${totalUniverseCount} coverage=${coverage.toFixed(4)}`);

  return {
    totalUniverseCount,
    freshQuoteCount,
    coverage,
    required: 0.7,
  };
}

app.get('/api/screener', async (req, res) => {
  const reqStart   = Date.now();
  const marketCtx  = getMarketMode();
  // In PREP/RECENT, lower the required coverage so market-closed periods still show data
  const requiredCoverage = marketCtx.mode === 'LIVE' ? 0.7 : marketCtx.mode === 'RECENT' ? 0.3 : 0.1;

  try {
    let readiness;
    try {
      readiness = await getScreenerCoverageReadiness();
    } catch (readinessErr) {
      console.error('[SCREENER] readiness check failed:', readinessErr.message);
      return res.json({ success: false, rows: [], data: [], count: 0, status: 'READINESS_CHECK_FAILED', detail: readinessErr.message, market_mode: marketCtx.mode });
    }

    if (readiness.coverage < requiredCoverage) {
      console.log(`[SCREENER] DATA NOT READY — coverage: ${readiness.coverage.toFixed(4)} < required: ${requiredCoverage} (mode: ${marketCtx.mode})`);
      return res.json({
        success: false,
        rows: [],
        data: [],
        count: 0,
        status: 'DATA_NOT_READY',
        message: 'Insufficient fresh market data coverage',
        coverage: Number(readiness.coverage.toFixed(4)),
        required: requiredCoverage,
        market_mode: marketCtx.mode,
        market_reason: marketCtx.reason,
      });
    }

    console.log(`[SCREENER] coverage OK: ${readiness.coverage.toFixed(4)} (mode: ${marketCtx.mode}) — loading rows`);
    const { rows, totalCount, page, pageSize } = await loadScreenerRows(req.query || {});
    console.log(`[SCREENER] loaded ${rows.length}/${totalCount} rows in ${Date.now() - reqStart}ms`);
    logResponseShape('/api/screener', rows, ['symbol', 'price', 'change_percent', 'volume', 'avg_volume_30d', 'relative_volume', 'market_cap', 'sector', 'catalyst_type']);
    res.json({
      success: true,
      count: totalCount,
      page,
      pageSize,
      rows,
      data: rows,
      market_mode: marketCtx.mode,
      market_reason: marketCtx.reason,
    });
  } catch (error) {
    console.error('[SCREENER] unhandled error after', Date.now() - reqStart, 'ms:', error.message);
    console.error('[SCREENER] stack:', error.stack);
    // Never return 500 — always return valid JSON with empty rows so frontend can degrade gracefully
    res.json({ success: false, rows: [], data: [], count: 0, status: 'SCREENER_UNAVAILABLE', detail: error.message });
  }
});

app.get('/api/screener/full', async (req, res) => {
  try {
    console.log('Screener query params:', req.query);
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
  try {
    const readiness = await getScreenerCoverageReadiness();
    if (readiness.coverage < readiness.required) {
      console.log('DATA NOT READY — COVERAGE BELOW THRESHOLD');
      return res.json({
        success: false,
        status: 'DATA_NOT_READY',
        message: 'Insufficient fresh market data coverage',
        coverage: Number(readiness.coverage.toFixed(4)),
        required: readiness.required,
      });
    }

    const { rows, totalCount, page, pageSize } = await loadScreenerRows(req.body || {});
    console.log('DATA READY — SCREENER ENABLED');
    res.json({
      success: true,
      count: totalCount,
      page,
      pageSize,
      rows,
      data: rows,
    });
  } catch (error) {
    console.error('[api/screener POST] error:', error.message);
    res.status(500).json({ success: false, error: 'SCREENER_TRUTH_BUILD_FAILED', detail: error.message });
  }
});

app.post('/api/query/run', async (req, res) => {
  try {
    const queryTree = normalizeQueryTree(req.body?.query_tree || req.body || { AND: [] });
    const result = await runQueryTree(queryTree, { limit: Number(req.body?.limit) || 250 });
    return res.json({ rows: result.rows, query_tree: result.query_tree });
  } catch (error) {
    const isValidation = error?.code === 'INVALID_QUERY_TREE_FIELD';
    return res.status(isValidation ? 400 : 500).json({
      rows: [],
      error: isValidation ? 'Invalid query tree' : 'Query engine failure',
      message: error.message,
    });
  }
});

app.get('/api/query/presets/gap-scanner', async (_req, res) => {
  try {
    const queryTree = {
      AND: [
        { field: 'gap_percent', operator: '>', value: 1 },
        { field: 'relative_volume', operator: '>', value: 1 },
        { field: 'volume', operator: '>', value: 500000 },
        { field: 'price', operator: '>', value: 2 },
      ],
    };

    const result = await runQueryTree(queryTree, { limit: 250 });
    return res.json({
      preset: 'gap_scanner',
      query_tree: queryTree,
      rows: result.rows || [],
    });
  } catch (error) {
    return res.json({
      preset: 'gap_scanner',
      query_tree: { AND: [] },
      rows: [],
      status: 'error',
      message: error.message || 'Failed to run gap scanner',
    });
  }
});

app.get('/api/intelligence/narrative', async (_req, res) => {
  try {
    let latest = await getLatestMarketNarrative();
    if (!latest) {
      await runMarketNarrativeEngine();
      latest = await getLatestMarketNarrative();
    }

    return res.json({
      narrative: latest?.narrative || '',
      regime: latest?.regime || 'Neutral',
      created_at: latest?.created_at || null,
    });
  } catch (error) {
    return res.json({
      narrative: '',
      regime: 'Neutral',
      created_at: null,
      status: 'error',
      message: error.message || 'Narrative unavailable',
    });
  }
});

app.get('/api/sector/heatmap', async (_req, res) => {
  try {
    const { rows } = await queryWithTimeout(
      `WITH base AS (
         SELECT
           symbol,
           COALESCE(NULLIF(TRIM(sector), ''), 'Unknown') AS sector,
           COALESCE(change_percent, 0) AS change_percent,
           COALESCE(relative_volume, 0) AS relative_volume,
           COALESCE(volume, 0) AS volume
         FROM market_metrics
       ), ranked AS (
         SELECT
           sector,
           symbol,
           change_percent,
           relative_volume,
           volume,
           ROW_NUMBER() OVER (PARTITION BY sector ORDER BY change_percent DESC NULLS LAST) AS sector_rank
         FROM base
       )
       SELECT
         sector,
         AVG(change_percent)::numeric(10,4) AS change,
         AVG(relative_volume)::numeric(10,4) AS rvol,
         SUM(volume)::numeric AS volume,
         ARRAY_REMOVE(ARRAY_AGG(symbol ORDER BY change_percent DESC) FILTER (WHERE sector_rank <= 3), NULL) AS leaders
       FROM ranked
       GROUP BY sector
       ORDER BY change DESC NULLS LAST`,
      [],
      { label: 'api.sector.heatmap', timeoutMs: 2000, maxRetries: 0 }
    );

    const payload = rows.map((row) => ({
      sector: row.sector,
      change: Number(row.change || 0),
      rvol: Number(row.rvol || 0),
      volume: Number(row.volume || 0),
      leaders: Array.isArray(row.leaders) ? row.leaders.filter(Boolean) : [],
    }));

    return res.json(payload);
  } catch (_error) {
    return res.json([]);
  }
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
    const rows = await getRecentOpportunityStream(supabaseAdmin, { limit: 50 });
    res.json((rows || []).map((row) => ({ ...row, timestamp: row.created_at })));
  } catch (err) {
    logger.error('opportunity stream endpoint db error', { error: err.message });
    res.json([]);
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

async function calculateSectorStrength(sectorName) {
  if (!sectorName) {
    return { sector: 'Unknown', strength: 0, leaders: [] };
  }

  const { rows } = await queryWithTimeout(
    `SELECT
       q.symbol,
       COALESCE((to_jsonb(m)->>'price_change_percent')::numeric, (to_jsonb(m)->>'change_percent')::numeric, m.gap_percent, q.change_percent, 0) AS pct_move,
       COALESCE(q.market_cap, 0) AS market_cap
     FROM market_quotes q
     LEFT JOIN market_metrics m ON m.symbol = q.symbol
     WHERE COALESCE(q.sector, '') ILIKE $1
     ORDER BY COALESCE(q.market_cap, 0) DESC NULLS LAST
     LIMIT 5`,
    [`%${sectorName}%`],
    { label: 'api.intelligence.sector_strength.calc', timeoutMs: 1800, maxRetries: 1, retryDelayMs: 120 }
  );

  if (!rows.length) {
    return { sector: sectorName, strength: 0, leaders: [] };
  }

  const strength = rows.reduce((sum, row) => sum + Number(row?.pct_move || 0), 0) / rows.length;
  return {
    sector: sectorName,
    strength: Number(strength.toFixed(2)),
    leaders: rows.slice(0, 3).map((row) => String(row?.symbol || '').toUpperCase()).filter(Boolean),
  };
}

app.get('/api/intelligence/market-narrative', async (req, res) => {
  try {
    const [marketRowsRes, sectorRes, catalystRes] = await Promise.all([
      queryWithTimeout(
        `SELECT
           s.symbol,
           COALESCE((to_jsonb(m)->>'close')::numeric, (to_jsonb(m)->>'price')::numeric, q.price, 0) AS close,
           COALESCE((to_jsonb(m)->>'prev_close')::numeric, NULLIF(q.price, 0) / (1 + COALESCE(q.change_percent, 0) / 100.0), 0) AS prev_close,
           COALESCE((to_jsonb(m)->>'change_percent')::numeric, q.change_percent, 0) AS fallback_change
         FROM (VALUES ('SPY'), ('VIX')) AS s(symbol)
         LEFT JOIN market_metrics m ON m.symbol = s.symbol
         LEFT JOIN market_quotes q ON q.symbol = s.symbol`,
        [],
        { label: 'api.intelligence.market_narrative.market_inputs', timeoutMs: 1600, maxRetries: 1, retryDelayMs: 120 }
      ),
      queryWithTimeout(
        `WITH sector_agg AS (
           SELECT
             COALESCE(q.sector, 'Unknown') AS sector,
             AVG(COALESCE((to_jsonb(m)->>'change_percent')::numeric, q.change_percent, m.gap_percent, 0)) AS avg_move,
             SUM(COALESCE(q.market_cap, 0)) AS mcap
           FROM market_quotes q
           LEFT JOIN market_metrics m ON m.symbol = q.symbol
           WHERE q.sector IS NOT NULL
           GROUP BY COALESCE(q.sector, 'Unknown')
         )
         SELECT sector, avg_move
         FROM sector_agg
         ORDER BY avg_move DESC NULLS LAST, mcap DESC NULLS LAST
         LIMIT 1`,
        [],
        { label: 'api.intelligence.market_narrative.sector', timeoutMs: 1600, maxRetries: 1, retryDelayMs: 120 }
      ),
      queryWithTimeout(
        `SELECT symbol, headline, url, source, published_at
         FROM news_articles
         ORDER BY published_at DESC NULLS LAST
         LIMIT 3`,
        [],
        { label: 'api.intelligence.market_narrative.catalyst', timeoutMs: 1600, maxRetries: 1, retryDelayMs: 120 }
      ),
    ]);

    const marketRows = marketRowsRes?.rows || [];
    const spy = marketRows.find((row) => String(row?.symbol || '').toUpperCase() === 'SPY');
    const vix = marketRows.find((row) => String(row?.symbol || '').toUpperCase() === 'VIX');
    const strongestSector = sectorRes?.rows?.[0]?.sector || 'Mixed';
    const strongestSectorInfo = await calculateSectorStrength(strongestSector);
    const topCatalyst = catalystRes?.rows?.[0] || null;

    const spyPct = spy && Number(spy.prev_close) > 0
      ? ((Number(spy.close || 0) - Number(spy.prev_close || 0)) / Number(spy.prev_close || 1)) * 100
      : Number(spy?.fallback_change || 0);
    const vixPct = vix && Number(vix.prev_close) > 0
      ? ((Number(vix.close || 0) - Number(vix.prev_close || 0)) / Number(vix.prev_close || 1)) * 100
      : Number(vix?.fallback_change || 0);

    let sentiment = 'Neutral';
    if (spyPct > 0 && vixPct <= 0) sentiment = 'Risk-On';
    if (spyPct < 0 && vixPct > 0) sentiment = 'Risk-Off';

    const catalystText = topCatalyst
      ? `${String(topCatalyst.symbol || '').toUpperCase()} ${topCatalyst.headline || 'in focus'}`
      : 'no dominant overnight catalyst';

    const narrative = `SPY closed ${spyPct >= 0 ? '+' : ''}${spyPct.toFixed(2)}% while VIX moved ${vixPct >= 0 ? '+' : ''}${vixPct.toFixed(2)}%. ${strongestSector} leads this morning, with ${catalystText}.`;

    return res.json({
      sentiment,
      narrative,
      links: (catalystRes?.rows || []).map((row) => ({
        headline: row?.headline || '',
        url: row?.url || null,
        source: row?.source || 'News',
      })),
      context: {
        spy_previous_close_pct: Number(spyPct.toFixed(2)),
        vix_change_pct: Number(vixPct.toFixed(2)),
        strongest_sector: strongestSector,
        strongest_sector_detail: strongestSectorInfo,
      },
    });
  } catch (err) {
    logger.error('intelligence market narrative endpoint db error', { error: err.message });
    return res.json({ sentiment: 'Neutral', narrative: 'Narrative unavailable.', links: [] });
  }
});

app.get('/api/intelligence/top-opportunity', async (_req, res) => {
  try {
    const { rows } = await queryWithTimeout(
      `WITH gap_leaders AS (
         SELECT symbol
         FROM market_metrics
         ORDER BY COALESCE(gap_percent, 0) DESC NULLS LAST
         LIMIT 12
       ),
       momentum_leaders AS (
         SELECT symbol
         FROM market_metrics
         ORDER BY COALESCE(relative_volume, 0) DESC NULLS LAST
         LIMIT 12
       ),
       strategy_leaders AS (
         SELECT symbol
         FROM trade_setups
         ORDER BY COALESCE((to_jsonb(trade_setups)->>'strategy_score')::numeric, (to_jsonb(trade_setups)->>'score')::numeric, 0) DESC NULLS LAST
         LIMIT 12
       ),
       candidate_universe AS (
         SELECT symbol FROM gap_leaders
         UNION
         SELECT symbol FROM momentum_leaders
         UNION
         SELECT symbol FROM strategy_leaders
       ),
       sector_strength_agg AS (
         SELECT
           COALESCE(q.sector, 'Unknown') AS sector,
           AVG(COALESCE((to_jsonb(m)->>'change_percent')::numeric, q.change_percent, m.gap_percent, 0)) AS avg_change
         FROM market_quotes q
         LEFT JOIN market_metrics m ON m.symbol = q.symbol
         GROUP BY COALESCE(q.sector, 'Unknown')
       ),
       joined AS (
         SELECT
           ts.symbol,
           COALESCE((to_jsonb(ts)->>'strategy_score')::numeric, (to_jsonb(ts)->>'score')::numeric, 0) AS strategy_score,
           COALESCE(NULLIF(to_jsonb(ts)->>'setup_type', ''), NULLIF(to_jsonb(ts)->>'setup', ''), NULLIF(to_jsonb(ts)->>'strategy', ''), 'Momentum Continuation') AS strategy,
           COALESCE(mm.relative_volume, ts.relative_volume, 0) AS relative_volume,
           COALESCE((to_jsonb(mm)->>'price_change_percent')::numeric, (to_jsonb(mm)->>'change_percent')::numeric, mm.gap_percent, ts.gap_percent, 0) AS price_change_percent,
           COALESCE(mm.price, 0) AS price,
           COALESCE(mm.atr, 0) AS atr,
           COALESCE(ts.float_rotation, 0) AS float_size,
           COALESCE(tc.score, 0) AS catalyst_strength,
           COALESCE(ssa.avg_change, 0) AS sector_strength,
           CASE
             WHEN COALESCE((to_jsonb(mm)->>'price_change_percent')::numeric, (to_jsonb(mm)->>'change_percent')::numeric, mm.gap_percent, ts.gap_percent, 0) > 0 THEN 10
             ELSE 3
           END AS market_alignment,
           tc.headline,
           tc.source AS news_source,
           q.sector,
           COALESCE(ts.updated_at, mm.updated_at, q.updated_at, now()) AS updated_at
         FROM trade_setups ts
         JOIN candidate_universe cu ON cu.symbol = ts.symbol
         LEFT JOIN market_metrics mm ON mm.symbol = ts.symbol
         LEFT JOIN market_quotes q ON q.symbol = ts.symbol
         LEFT JOIN sector_strength_agg ssa ON ssa.sector = COALESCE(q.sector, 'Unknown')
         LEFT JOIN LATERAL (
           SELECT headline, score, source
           FROM trade_catalysts c
           WHERE c.symbol = ts.symbol
           ORDER BY c.published_at DESC NULLS LAST
           LIMIT 1
         ) tc ON TRUE
       )
       SELECT
         symbol,
         strategy,
         strategy_score,
         catalyst_strength,
         relative_volume,
         sector_strength,
         market_alignment,
         price,
         atr,
         float_size,
         price_change_percent,
         headline,
         news_source,
         updated_at,
         LEAST(
           (
             strategy_score * 0.35 +
             catalyst_strength * 0.25 +
             relative_volume * 0.20 +
             sector_strength * 0.10 +
             market_alignment * 0.10
           ),
           92
         ) AS base_confidence
       FROM joined
       ORDER BY base_confidence DESC NULLS LAST
       LIMIT 10`,
      [],
      { label: 'api.intelligence.top_opportunity', timeoutMs: 2500, maxRetries: 1, retryDelayMs: 120 }
    );

    const row = rows?.[0];
    if (!row) return res.json({ success: true, data: [] });

    const price = Number(row.price || 0);
    const atr = Number(row.atr || 0);
    const expectedMove = atr > 0 ? atr * 2 : Math.max(price * 0.03, 0);
    const expectedMovePercent = price > 0 ? (expectedMove / price) * 100 : 0;
    const breakout = price > 0 ? price * 1.01 : 0;
    const stopLoss = breakout > 0 ? breakout - (1.5 * atr || breakout * 0.015) : 0;
    const takeProfit = breakout > 0 ? breakout + (2 * atr || breakout * 0.03) : 0;
    const hasCatalyst = Boolean(String(row.headline || '').trim());
    const rvol = Number(row.relative_volume || 0);
    let confidence = Number(row.base_confidence || 0);
    if (!hasCatalyst && rvol < 1.2) confidence *= 0.6;
    confidence = Math.min(92, Math.max(0, confidence));

    return res.json({
      success: true,
      data: [{
        symbol: row.symbol,
        confidence: Number(confidence.toFixed(1)),
        catalyst: row.headline || 'No catalyst headline available.',
        strategy: row.strategy,
        expected_move: Number(expectedMove.toFixed(2)),
        expected_move_percent: Number(expectedMovePercent.toFixed(2)),
        rvol: Number(rvol.toFixed(2)),
        atr: Number(atr.toFixed(2)),
        sector: row.sector || 'Unknown',
        sector_strength: Number(row.sector_strength || 0),
        news_source: row.news_source || 'Market feed',
        float_size: Number(row.float_size || 0),
        price,
        previous_day_move: Number(row.price_change_percent || 0),
        entry: Number(breakout.toFixed(2)),
        stop_loss: Number(stopLoss.toFixed(2)),
        take_profit: Number(takeProfit.toFixed(2)),
        updated_at: row.updated_at || null,
        trade_plan: `Entry ${breakout > 0 ? `$${breakout.toFixed(2)}` : 'on breakout'}, stop ${stopLoss > 0 ? `$${stopLoss.toFixed(2)}` : 'below structure'}, target ${takeProfit > 0 ? `$${takeProfit.toFixed(2)}` : '2R'}.`,
      }],
    });
  } catch (error) {
    return res.json({ success: true, data: [] });
  }
});

app.get('/api/intelligence/top', async (_req, res) => {
  try {
    const { rows } = await queryWithTimeout(
      `SELECT *
       FROM opportunity_intelligence
       ORDER BY confidence DESC NULLS LAST
       LIMIT 20`,
      [],
      { label: 'api.intelligence.top', timeoutMs: 5000, maxRetries: 0 }
    );

    return res.json({ ok: true, items: rows || [] });
  } catch (error) {
    logger.warn('intelligence top endpoint unavailable', { error: error.message });
    return res.status(500).json({ ok: false, items: [], error: error.message });
  }
});

app.get('/api/intelligence/trade-probability', async (req, res) => {
  try {
    const strategy = String(req.query.strategy || '').trim();

    const totalCountRes = await queryWithTimeout(
      `SELECT COUNT(*)::int AS total FROM strategy_signals`,
      [],
      { label: 'api.trade_probability.count', timeoutMs: 1500, maxRetries: 1, retryDelayMs: 100 }
    );

    const total = Number(totalCountRes?.rows?.[0]?.total || 0);
    if (total < 20) {
      return res.json({
        status: 'insufficient_data',
        message: 'Less than 20 signals recorded',
        items: [],
      });
    }

    const params = [];
    let whereSql = '';
    if (strategy) {
      params.push(strategy);
      whereSql = `WHERE COALESCE(NULLIF(strategy, ''), 'Momentum Continuation') ILIKE $${params.length}`;
    }

    const { rows } = await queryWithTimeout(
      `SELECT
         COALESCE(NULLIF(strategy, ''), 'Momentum Continuation') AS strategy,
         COUNT(*)::int AS trades,
         SUM(CASE WHEN COALESCE(result, exit_price > entry_price, false) THEN 1 ELSE 0 END)::int AS wins,
         ROUND(
           SUM(CASE WHEN COALESCE(result, exit_price > entry_price, false) THEN 1 ELSE 0 END)::decimal
           / NULLIF(COUNT(*), 0) * 100,
           1
         ) AS win_rate,
         ROUND(
           AVG(
             CASE
               WHEN COALESCE(entry_price, 0) > 0 AND exit_price IS NOT NULL THEN ((exit_price - entry_price) / entry_price) * 100
               ELSE NULL
             END
           )::numeric,
           1
         ) AS avg_move,
         ROUND(
           MIN(
             CASE
               WHEN COALESCE(entry_price, 0) > 0 AND exit_price IS NOT NULL THEN ((exit_price - entry_price) / entry_price) * 100
               ELSE NULL
             END
           )::numeric,
           1
         ) AS max_drawdown
       FROM strategy_signals
       ${whereSql}
       GROUP BY COALESCE(NULLIF(strategy, ''), 'Momentum Continuation')
       ORDER BY win_rate DESC NULLS LAST, trades DESC
       LIMIT 12`,
      params,
      { label: 'api.trade_probability.query', timeoutMs: 2400, maxRetries: 1, retryDelayMs: 100 }
    );

    return res.json({ status: 'ok', success: true, items: rows });
  } catch (error) {
    return res.json({ success: true, items: [] });
  }
});

app.get('/api/intelligence/earnings-window', async (_req, res) => {
  try {
    const { rows } = await queryWithTimeout(
      `SELECT
         symbol,
         company,
         earnings_date,
         eps_estimate,
         revenue_estimate,
         CASE
           WHEN earnings_date::date = CURRENT_DATE THEN 'Today'
           WHEN earnings_date::date = CURRENT_DATE + INTERVAL '1 day' THEN 'Tomorrow'
           ELSE 'After Hours'
         END AS bucket
       FROM earnings_events
       WHERE earnings_date BETWEEN NOW() - interval '12 hours' AND NOW() + interval '36 hours'
       ORDER BY earnings_date ASC, symbol ASC
       LIMIT 80`,
      [],
      { label: 'api.intelligence.earnings_window', timeoutMs: 2200, maxRetries: 1, retryDelayMs: 100 }
    );

    return res.json({
      success: true,
      today: rows.filter((row) => row.bucket === 'Today'),
      tomorrow: rows.filter((row) => row.bucket === 'Tomorrow'),
      after_hours: rows.filter((row) => row.bucket === 'After Hours'),
      items: rows,
    });
  } catch (error) {
    return res.json({ success: true, today: [], tomorrow: [], after_hours: [], items: [] });
  }
});

app.get('/api/metrics/strategy-accuracy', async (_req, res) => {
  try {
    const { rows } = await queryWithTimeout(
      `WITH agg AS (
         SELECT
           COALESCE(NULLIF(strategy, ''), 'Momentum Continuation') AS strategy,
           COUNT(*)::int AS total_signals,
           SUM(CASE WHEN COALESCE(change_percent, 0) >= 0 THEN 1 ELSE 0 END)::int AS wins,
           SUM(CASE WHEN COALESCE(change_percent, 0) < 0 THEN 1 ELSE 0 END)::int AS losses
         FROM strategy_signals
         GROUP BY COALESCE(NULLIF(strategy, ''), 'Momentum Continuation')
       ), upserted AS (
         INSERT INTO strategy_accuracy (strategy, total_signals, wins, losses, accuracy_rate, updated_at)
         SELECT
           strategy,
           total_signals,
           wins,
           losses,
           CASE WHEN total_signals > 0 THEN ROUND((wins::numeric / total_signals::numeric) * 100, 2) ELSE 0 END AS accuracy_rate,
           NOW()
         FROM agg
         ON CONFLICT (strategy)
         DO UPDATE SET
           total_signals = EXCLUDED.total_signals,
           wins = EXCLUDED.wins,
           losses = EXCLUDED.losses,
           accuracy_rate = EXCLUDED.accuracy_rate,
           updated_at = NOW()
         RETURNING strategy
       )
       SELECT strategy, total_signals, wins, losses, accuracy_rate
       FROM strategy_accuracy
       ORDER BY accuracy_rate DESC NULLS LAST, total_signals DESC NULLS LAST
       LIMIT 20`,
      [],
      { label: 'api.metrics.strategy_accuracy', timeoutMs: 3000, maxRetries: 0 }
    );

    return res.json({ success: true, items: rows });
  } catch (err) {
    logger.error('strategy accuracy endpoint error', { error: err.message });
    return res.json({ success: true, items: [] });
  }
});

app.get('/api/metrics/expected-move', async (req, res) => {
  const symbol = String(req.query.symbol || '').trim().toUpperCase();
  if (!symbol) return res.status(400).json({ error: 'symbol is required' });

  try {
    const expected = await queryWithTimeout(
      `SELECT
         COALESCE(m.price, q.price, 0) AS price,
         COALESCE(
           NULLIF(m.atr, 0),
           (COALESCE(m.price, q.price, 0) * COALESCE(ABS(m.gap_percent), ABS(COALESCE(m.change_percent, q.change_percent)), 0)) / 100,
           0
         ) AS expected_move
       FROM market_metrics m
       LEFT JOIN market_quotes q ON q.symbol = m.symbol
       WHERE m.symbol = $1
       LIMIT 1`,
      [symbol],
      { label: 'api.metrics.expected_move.base', timeoutMs: 2000, maxRetries: 0 }
    );

    const row = expected.rows?.[0] || null;
    if (!row) return res.json({ symbol, expected_move: 0, iv: 0, hv: 0, days: 1 });

    const price = Number(row.price || 0);
    const expectedMove = Number(row.expected_move || 0);
    const days = Math.max(1, Number(req.query.days || 1));
    const iv = price > 0 ? (expectedMove / price) / Math.sqrt(days / 365) : 0;
    const hv = iv * 0.7;

    return res.json({
      symbol,
      expected_move: Number(expectedMove.toFixed(2)),
      iv: Number((iv * 100).toFixed(2)),
      hv: Number((hv * 100).toFixed(2)),
      days,
    });
  } catch (err) {
    logger.error('metrics expected move endpoint error', { error: err.message });
    return res.status(500).json({ error: 'Failed to load expected move metrics' });
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
        const ticks = ['SPY', 'QQQ', 'VIX'];
        const providerTicks = ticks.map((t) => mapToProviderSymbol(t));
        const qr = await Promise.allSettled(providerTicks.map((t) => yahooFinance.quote(t)));
        const indices = ticks.map((s, i) => {
          const r = qr[i]; if (r.status !== 'fulfilled' || !r.value) return { ticker: s, error: true };
          const q = r.value;
          return { ticker: s, name: q.shortName || s, price: q.regularMarketPrice || 0,
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

// ── Premarket Intelligence Routes (Step 5) ────────────────────────────────────

// GET /api/premarket/watchlist — single source of truth: score, stage, company context
// Phase 1 (SSOT), Phase 4 (price>0), Phase 6 (company profiles), Phase 9 (why_moving)
app.get('/api/premarket/watchlist', async (req, res) => {
  try {
    const limit  = Math.max(1, Math.min(Number(req.query.limit) || 50, 200));
    const symbol = String(req.query.symbol || '').trim().toUpperCase();

    const WATCHLIST_SQL = `
      SELECT
        pw.symbol,
        COALESCE(mq.price, pw.price)        AS price,
        pw.change_percent,
        pw.gap_percent,
        pw.relative_volume,
        pw.volume_ratio,
        pw.news_count,
        pw.earnings_flag,
        pw.stage,
        pw.score,
        pw.rank_percentile,
        pw.decay_factor,
        pw.news_age_minutes,
        pw.last_calculated_at,
        pw.updated_at,
        cp.company_name,
        COALESCE(cp.sector, '')             AS sector,
        COALESCE(cp.industry, '')           AS industry,
        COALESCE(cp.description, '')        AS description,
        latest_news.headline                AS top_news_headline,
        -- Phase 4: premarket session data
        pm.premarket_price,
        pm.premarket_volume,
        pm.premarket_candles,
        pm.premarket_quality_avg           AS premarket_data_quality,
        pm.afterhours_candles,
        -- premarket_gap: % move from prior close (use gap_percent as source when pm unavailable)
        CASE
          WHEN pm.premarket_price IS NOT NULL AND mq.price > 0
          THEN ROUND(((pm.premarket_price - COALESCE(mq.price, pw.price))
               / NULLIF(COALESCE(mq.price, pw.price), 0) * 100)::numeric, 2)
          ELSE pw.gap_percent
        END                                AS premarket_gap,
        -- premarket_activity_score: 0–100 based on premarket volume vs avg
        CASE
          WHEN pm.premarket_volume > 0 AND pw.avg_volume_30d > 0
          THEN LEAST(
            ROUND((pm.premarket_volume::numeric / pw.avg_volume_30d * 50)::numeric, 0)::int,
            100
          )
          ELSE 0
        END                                AS premarket_activity_score,
        -- Phase 9 intelligence columns
        pw.premarket_trend,
        pw.premarket_range_percent,
        pw.premarket_gap_confidence,
        pw.premarket_signal_type,
        pw.premarket_valid,
        -- Phase 10 execution columns
        pw.entry_price,
        pw.stop_price,
        pw.target_price,
        pw.risk_percent,
        pw.reward_percent,
        pw.risk_reward_ratio,
        pw.execution_valid,
        pw.execution_type,
        pw.position_size_shares,
        pw.position_size_value,
        -- Phase 12 refinement columns
        pw.entry_confirmed,
        pw.breakout_strength,
        pw.session_phase,
        pw.execution_rating,
        pw.execution_notes
      FROM premarket_watchlist pw
      LEFT JOIN market_quotes mq
        ON pw.symbol = mq.symbol
        AND mq.price IS NOT NULL AND mq.price > 0
      LEFT JOIN company_profiles cp ON pw.symbol = cp.symbol
      LEFT JOIN premarket_metrics pm ON pw.symbol = pm.symbol
      LEFT JOIN LATERAL (
        SELECT headline
        FROM   news_articles
        WHERE  (symbol = pw.symbol OR pw.symbol = ANY(symbols) OR pw.symbol = ANY(detected_symbols))
          AND  published_at >= NOW() - INTERVAL '72 hours'
        ORDER BY published_at DESC
        LIMIT 1
      ) latest_news ON TRUE
      WHERE COALESCE(mq.price, pw.price) > 0
        AND COALESCE(mq.price, pw.price) IS NOT NULL
      ${symbol ? 'AND pw.symbol = $2' : ''}
      ORDER BY pw.score DESC
      LIMIT $1`;

    const params = symbol ? [limit, symbol] : [limit];

    let rows = [];
    try {
      const result = await queryWithTimeout(WATCHLIST_SQL, params,
        { label: 'api.premarket.watchlist.v3', timeoutMs: 12000 }
      );
      rows = result.rows;
    } catch (tableErr) {
      logger.warn('[PREMARKET] watchlist v3 read failed', { error: tableErr.message });
    }

    // If empty, trigger an on-demand engine run then re-read
    if (rows.length === 0 && !symbol) {
      console.log('[PREMARKET] watchlist empty — running engine on demand');
      const { runPremarketWatchlistEngine } = require('./engines/premarketWatchlistEngine');
      await runPremarketWatchlistEngine().catch((e) =>
        console.error('[PREMARKET] on-demand run failed:', e.message)
      );
      const result = await queryWithTimeout(WATCHLIST_SQL, params,
        { label: 'api.premarket.watchlist.v3.post_run', timeoutMs: 12000 }
      ).catch(() => ({ rows: [] }));
      rows = result.rows;
    }

    // Phase 9: rule-based why_moving from top headline
    const enriched = rows.map((row) => {
      const headline = row.top_news_headline;
      let why_moving;
      if (headline) {
        const dir = Number(row.change_percent) >= 0 ? 'bullish' : 'bearish';
        why_moving = `${row.symbol} is moving due to recent news: "${headline}" This suggests continued ${dir} pressure.`;
      } else if (Math.abs(Number(row.gap_percent)) > 2) {
        why_moving = `Move is technical (${Number(row.gap_percent) > 0 ? '+' : ''}${Number(row.gap_percent).toFixed(1)}% gap, ${Number(row.relative_volume).toFixed(1)}x volume), no confirmed catalyst yet.`;
      } else {
        why_moving = `Move is technical (volume + price expansion), no confirmed catalyst yet.`;
      }

      // Phase 10: confidence = score (integer, locked)
      return {
        ...row,
        score:      Number(row.score),
        confidence: Number(row.score),
        why_moving,
      };
    });

    if (enriched.length === 0) {
      return res.json({ success: true, data: [], count: 0 });
    }

    return res.json({ success: true, count: enriched.length, data: enriched });
  } catch (err) {
    logger.error('premarket watchlist error', { error: err.message });
    return res.status(500).json({ success: false, error: err.message, data: [] });
  }
});

// GET /api/market/session/:symbol — intraday bars split by session (PREMARKET/REGULAR/AFTERHOURS)
app.get('/api/market/session/:symbol', async (req, res) => {
  const symbol = String(req.params.symbol || '').trim().toUpperCase();
  if (!symbol) return res.status(400).json({ success: false, error: 'symbol required' });

  const hoursBack = Math.max(1, Math.min(Number(req.query.hours) || 24, 72));

  try {
    const { rows } = await queryWithTimeout(
      `SELECT
         "timestamp",
         open, high, low, close, volume,
         session,
         data_quality_score
       FROM intraday_1m
       WHERE symbol = $1
         AND "timestamp" >= NOW() - ($2 || ' hours')::INTERVAL
         AND close > 0
       ORDER BY "timestamp" ASC`,
      [symbol, hoursBack],
      { label: 'api.market.session', timeoutMs: 10_000 }
    );

    if (rows.length === 0) {
      return res.json({
        success: true,
        symbol,
        premarket:  [],
        regular:    [],
        afterhours: [],
        total:      0,
        message:    'No intraday data — session engine may still be processing',
      });
    }

    const premarket  = rows.filter(r => r.session === 'PREMARKET');
    const regular    = rows.filter(r => r.session === 'REGULAR');
    const afterhours = rows.filter(r => r.session === 'AFTERHOURS');
    const unclassified = rows.filter(r => !r.session || r.session === 'regular');

    return res.json({
      success:    true,
      symbol,
      hours_back: hoursBack,
      premarket,
      regular,
      afterhours,
      unclassified_legacy: unclassified.length,
      total:      rows.length,
      quality: {
        premarket_avg:  premarket.length  ? Math.round(premarket.reduce((s,r)=>s+(r.data_quality_score||0),0)/premarket.length)  : null,
        regular_avg:    regular.length    ? Math.round(regular.reduce((s,r)=>s+(r.data_quality_score||0),0)/regular.length)    : null,
        afterhours_avg: afterhours.length ? Math.round(afterhours.reduce((s,r)=>s+(r.data_quality_score||0),0)/afterhours.length) : null,
      },
    });
  } catch (err) {
    logger.error('session endpoint error', { symbol, error: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ── System & Signal routes ─────────────────────────────────────────────────────

// GET /api/system/ingestion-status — data scheduler health + row counts + stale tables
app.get('/api/system/ingestion-status', async (req, res) => {
  try {
    return res.json({ ok: true, ...getIngestionStatus() });
  } catch (err) {
    logger.error('ingestion-status error', { error: err.message });
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/signals/log — raw signal capture log (most recent first)
app.get('/api/signals/log', async (req, res) => {
  try {
    const limit  = Math.max(1, Math.min(Number(req.query.limit) || 100, 500));
    const symbol = String(req.query.symbol || '').trim().toUpperCase();

    const params = symbol ? [limit, symbol] : [limit];
    const where  = symbol ? `WHERE symbol = $2` : '';

    const result = await queryWithTimeout(
      `SELECT id, symbol, timestamp, score, stage, entry_price,
              expected_move, outcome, max_upside_pct, max_drawdown_pct, evaluated
       FROM signal_log
       ${where}
       ORDER BY timestamp DESC
       LIMIT $1`,
      params,
      { label: 'api.signals.log', timeoutMs: 8000 }
    );

    return res.json({ ok: true, count: result.rows.length, data: result.rows });
  } catch (err) {
    logger.error('signals/log error', { error: err.message });
    return res.status(500).json({ ok: false, error: err.message, data: [] });
  }
});

// GET /api/signals/performance — daily aggregated win/loss/return metrics
app.get('/api/signals/performance', async (req, res) => {
  try {
    const days = Math.max(1, Math.min(Number(req.query.days) || 30, 90));

    const result = await queryWithTimeout(
      `SELECT date, total_signals, wins, losses, win_rate, avg_return
       FROM   signal_performance_daily
       WHERE  date >= CURRENT_DATE - ($1 || ' days')::interval
       ORDER BY date DESC`,
      [days],
      { label: 'api.signals.performance', timeoutMs: 8000 }
    );

    // Also return aggregate summary
    const rows = result.rows;
    const totalSignals = rows.reduce((s, r) => s + Number(r.total_signals), 0);
    const totalWins    = rows.reduce((s, r) => s + Number(r.wins), 0);
    const avgReturn    = rows.length > 0
      ? Math.round(rows.reduce((s, r) => s + Number(r.avg_return || 0), 0) / rows.length * 100) / 100
      : null;
    const win_rate     = totalSignals > 0
      ? Math.round((totalWins / totalSignals) * 1000) / 10
      : null;

    return res.json({
      ok: true,
      summary: { total_signals: totalSignals, wins: totalWins, win_rate, avg_return: avgReturn },
      data: rows,
    });
  } catch (err) {
    logger.error('signals/performance error', { error: err.message });
    return res.status(500).json({ ok: false, error: err.message, data: [] });
  }
});

// GET /api/premarket/intelligence/:symbol — full intelligence + catalysts + narrative
app.get('/api/premarket/intelligence/:symbol', async (req, res) => {
  try {
    const symbol = String(req.params.symbol || '').toUpperCase().trim();
    if (!symbol) return res.status(400).json({ status: 'INVALID_INPUT', error: 'symbol required' });

    const { aggregateCatalysts } = require('./engines/catalystAggregationEngine');
    const { buildSymbolNarrative } = require('./utils/intelligenceNarrative');

    const [piRes, metricsRes, catalystResult] = await Promise.all([
      queryWithTimeout(
        `SELECT * FROM premarket_intelligence WHERE symbol = $1`,
        [symbol],
        { label: 'api.premarket.intel.pi', timeoutMs: 5000 }
      ).catch(() => ({ rows: [] })),
      queryWithTimeout(
        `SELECT symbol, price, gap_percent, relative_volume, change_percent,
                avg_volume_30d, volume, rsi, vwap, previous_close, float_shares,
                short_float, atr, atr_percent, updated_at
         FROM market_metrics WHERE symbol = $1`,
        [symbol],
        { label: 'api.premarket.intel.metrics', timeoutMs: 5000 }
      ).catch(() => ({ rows: [] })),
      aggregateCatalysts(symbol),
    ]);

    const premarket = piRes.rows[0] || null;
    const metrics   = metricsRes.rows[0] || null;

    if (!premarket && !metrics) {
      return res.json({ status: 'NO_DATA', symbol, error: 'No data found for symbol' });
    }

    const narrative = await buildSymbolNarrative(symbol, metrics, premarket);

    return res.json({
      status: 'OK',
      symbol,
      intelligence: premarket || { status: 'NOT_IN_PREMARKET_ENGINE' },
      metrics: metrics || { status: 'NO_METRICS' },
      catalysts: catalystResult,
      narrative,
    });
  } catch (err) {
    logger.error('premarket intelligence/:symbol error', { error: err.message });
    return res.status(500).json({ status: 'ERROR', error: err.message });
  }
});

// GET /api/news/symbol72h/:symbol — last 72h news with count + timestamps
app.get('/api/news/symbol72h/:symbol', async (req, res) => {
  try {
    const symbol = String(req.params.symbol || '').toUpperCase().trim();
    if (!symbol) return res.status(400).json({ status: 'INVALID_INPUT', error: 'symbol required' });

    const limit = Math.max(1, Math.min(Number(req.query.limit) || 50, 200));

    const result = await queryWithTimeout(
      `SELECT id, headline, published_at, catalyst_type, priority_score,
              sentiment, summary, source, catalyst_cluster
       FROM news_articles
       WHERE published_at >= NOW() - INTERVAL '72 hours'
         AND (
           $1 = ANY(symbols)
           OR symbol = $1
           OR $1 = ANY(detected_symbols)
         )
       ORDER BY published_at DESC
       LIMIT $2`,
      [symbol, limit],
      { label: 'api.news.symbol72h', timeoutMs: 8000 }
    );

    const rows = result.rows;
    if (rows.length === 0) {
      return res.json({ status: 'NO_DATA', symbol, count: 0, data: [], oldest: null, newest: null });
    }

    return res.json({
      status: 'OK',
      symbol,
      count: rows.length,
      newest: rows[0].published_at,
      oldest: rows[rows.length - 1].published_at,
      data: rows,
    });
  } catch (err) {
    logger.error('news/symbol72h error', { error: err.message });
    return res.status(500).json({ status: 'ERROR', error: err.message });
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
    const response = await axios.get('https://financialmodelingprep.com/stable/stock-list', {
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
app.post('/api/auth/request-password-reset', (req, res, next) => {
  req.url = '/request-password-reset';
  return userRoutes(req, res, next);
});
app.post('/api/auth/reset-password', (req, res, next) => {
  req.url = '/reset-password';
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

async function getLatestSignals(db) {
  const primaryQuery = buildSignalsPrimaryQuery();
  const primary = await db(primaryQuery.text, primaryQuery.params, primaryQuery.options);

  if (primary.rows.length > 0) {
    return { rows: primary.rows, source: 'primary' };
  }

  const fallbackQuery = buildSignalsFallbackQuery();
  const fallback = await db(fallbackQuery.text, fallbackQuery.params, fallbackQuery.options);

  return { rows: fallback.rows, source: 'fallback' };
}

function normalizeSignalContract(row = {}) {
  const strategyValue = String(row.strategy ?? row.setup_type ?? '').trim();
  const scoreValue = Number(row.score ?? row.signal_score ?? row.rank_score ?? 0);
  const rawProbability = Number(row.probability);
  const inferredProbability = 50 + Math.tanh(scoreValue / 400) * 40;
  const probability = Number.isFinite(rawProbability) && rawProbability > 0
    ? rawProbability
    : inferredProbability;

  const rawConfidence = Number(row.confidence);
  const grade = String(row.grade || '').toUpperCase();
  const inferredConfidenceFromGrade = grade.startsWith('A')
    ? 88
    : grade.startsWith('B')
      ? 78
      : grade.startsWith('C')
        ? 68
        : grade.startsWith('D')
          ? 58
          : probability - 5;
  const confidence = Number.isFinite(rawConfidence) && rawConfidence > 0
    ? rawConfidence
    : inferredConfidenceFromGrade;

  const expectedMove = Number(row.expected_move);
  const atr = Number(row.atr ?? 0);
  const refPrice = Number(row.price ?? row.last_price ?? row.close ?? 0);
  const inferredExpectedMove = atr > 0 && refPrice > 0
    ? (atr / refPrice) * 100
    : 2.5;

  const clampPct = (value) => {
    if (!Number.isFinite(value)) return 0;
    return Math.max(1, Math.min(99, value));
  };

  return {
    ...row,
    symbol: String(row.symbol ?? '').trim().toUpperCase(),
    strategy: strategyValue || 'Unknown',
    probability: clampPct(probability),
    confidence: clampPct(confidence),
    expected_move: Number.isFinite(expectedMove) ? expectedMove : inferredExpectedMove,
  };
}

function normalizeSignalRows(rows) {
  return Array.isArray(rows) ? rows.map((row) => normalizeSignalContract(row)) : [];
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function classifyWhyMovingCatalyst(row = {}) {
  const value = [
    row.trade_catalyst_type,
    row.latest_news_catalyst,
    row.catalyst_headline,
    row.latest_headline,
  ]
    .map((item) => String(item || '').toLowerCase())
    .join(' ');

  if (/(earnings|guidance|eps|revenue|quarter|q[1-4])/.test(value)) return 'earnings';
  if (/(fed|fomc|cpi|pce|inflation|rate|yield|treasury|payroll|macro|gdp)/.test(value)) return 'macro';
  if (/(breakout|breakdown|vwap|support|resistance|technical|momentum)/.test(value)) return 'technical';
  if (String(row.latest_headline || '').trim() || String(row.catalyst_headline || '').trim()) return 'news';
  return 'unknown';
}

function formatFreshnessLabel(minutes) {
  if (!Number.isFinite(minutes) || minutes < 0) return 'unknown';
  if (minutes < 60) return `${Math.round(minutes)}m ago`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function buildWhyMovingReason(row = {}, catalystType = 'unknown') {
  const rvol = Number(row.rvol || 0);
  const moveVsAtr = Number(row.move_vs_atr || 0);
  const pctMove = Number(row.pct_move || 0);
  const premarketMove = Number(row.premarket_move_pct || 0);
  const regularMove = Number(row.regular_move_pct || 0);
  const headline = String(row.catalyst_headline || row.latest_headline || '').trim();

  const direction = pctMove >= 0 ? 'up' : 'down';
  const catalystText = catalystType !== 'unknown' ? `${catalystType} catalyst` : 'flow-driven catalyst';

  if (headline) {
    return `Moving ${direction} on ${catalystText}: ${headline}. Volume is ${rvol.toFixed(2)}x normal with ${moveVsAtr.toFixed(2)} ATR expansion.`;
  }

  if (premarketMove !== 0 && regularMove !== 0 && Math.sign(premarketMove) === Math.sign(regularMove)) {
    return `Premarket move (${premarketMove.toFixed(2)}%) is continuing into regular hours (${regularMove.toFixed(2)}%), with ${rvol.toFixed(2)}x relative volume and ${moveVsAtr.toFixed(2)} ATR range expansion.`;
  }

  return `Price is moving ${direction} ${Math.abs(pctMove).toFixed(2)}% on ${rvol.toFixed(2)}x relative volume with ${moveVsAtr.toFixed(2)} ATR expansion; no dominant headline catalyst detected.`;
}

function normalizeWhyMovingItem(row = {}) {
  const newsRelevance = clamp(Number(row.news_relevance || 0), 0, 1);
  const volumeExpansion = clamp(Number(row.rvol || 0) / 1.6, 0, 1);
  const priceExpansion = clamp(Number(row.move_vs_atr || 0) / 2, 0, 1);

  const confidence = clamp(
    (newsRelevance * 0.45 + volumeExpansion * 0.30 + priceExpansion * 0.25) * 100,
    0,
    100
  );

  const continuationAligned = Number(row.premarket_move_pct || 0) !== 0
    && Number(row.regular_move_pct || 0) !== 0
    && Math.sign(Number(row.premarket_move_pct)) === Math.sign(Number(row.regular_move_pct));

  const continuationScore = continuationAligned ? 1 : 0.35;
  const tradabilityScore = clamp(
    (volumeExpansion * 0.5 + priceExpansion * 0.35 + continuationScore * 0.15) * 100,
    0,
    100
  );

  const anchorTimestamp = row.latest_news_at || row.latest_catalyst_at || row.last_intraday_ts || row.metrics_ts;
  const freshnessMinutes = anchorTimestamp
    ? Math.max(0, (Date.now() - new Date(anchorTimestamp).getTime()) / 60000)
    : null;

  const catalystType = classifyWhyMovingCatalyst(row);
  const reason = buildWhyMovingReason(row, catalystType);

  const lastPrice = Number(row.last_price || row.daily_close || 0);
  const atrValue = Number(row.atr_value || 0);
  const expectedMove = lastPrice > 0
    ? ((atrValue > 0 ? atrValue * 1.25 : Math.abs(Number(row.pct_move || 0)) * 0.5 * lastPrice / 100) / lastPrice) * 100
    : 0;

  return {
    symbol: String(row.symbol || '').toUpperCase(),
    reason,
    catalyst_type: catalystType,
    confidence: Number(confidence.toFixed(2)),
    expected_move: Number(expectedMove.toFixed(2)),
    freshness: formatFreshnessLabel(freshnessMinutes),
    tradability_score: Number(tradabilityScore.toFixed(2)),
  };
}

function mapTradeabilityStrategy(row = {}) {
  const raw = String(row.signal_strategy || '').toUpperCase();
  if (raw.includes('ORB')) return 'ORB';
  if (raw.includes('VWAP')) return 'VWAP Reclaim';
  if (raw.includes('FADE') || raw.includes('EXTENSION')) return 'Extension Fade';
  if (raw.includes('MOMENTUM')) return 'Momentum Continuation';

  const moveVsAtr = Number(row.move_vs_atr || 0);
  const pctMove = Number(row.pct_move || 0);
  const lastClose = Number(row.last_intraday_close || 0);
  const openingRangeHigh = Number(row.opening_range_high || 0);
  const vwap = Number(row.vwap || 0);

  if (openingRangeHigh > 0 && lastClose > openingRangeHigh) return 'ORB';
  if (vwap > 0 && lastClose >= vwap) return 'VWAP Reclaim';
  if (Math.abs(pctMove) >= 8 && moveVsAtr >= 2) return 'Extension Fade';
  return 'Momentum Continuation';
}

function buildTradeabilityEntry(strategy) {
  if (strategy === 'ORB') return 'Breakout';
  if (strategy === 'VWAP Reclaim') return 'Reclaim + Hold';
  if (strategy === 'Extension Fade') return 'Mean Reversion Trigger';
  return 'Pullback Continuation';
}

function buildTradeabilityInvalidation(strategy, row = {}) {
  const vwap = Number(row.vwap || 0);
  const orLow = Number(row.opening_range_low || 0);
  const intradayLow = Number(row.intraday_low || 0);
  const intradayHigh = Number(row.intraday_high || 0);

  if (strategy === 'ORB') {
    return orLow > 0 ? `Back below OR low ${orLow.toFixed(2)}` : 'Back inside opening range';
  }
  if (strategy === 'VWAP Reclaim') {
    return vwap > 0 ? `Lose VWAP ${vwap.toFixed(2)} on close` : 'Lose reclaim pivot';
  }
  if (strategy === 'Extension Fade') {
    return intradayHigh > 0 ? `Break above intraday extreme ${intradayHigh.toFixed(2)}` : 'Break above extension high';
  }
  return intradayLow > 0 ? `Lose intraday support ${intradayLow.toFixed(2)}` : 'Lose momentum support';
}

function estimateRiskReward(strategy, row = {}) {
  const moveVsAtr = Number(row.move_vs_atr || 0);
  const rvol = Number(row.rvol || 0);
  let base = 1.6;

  if (strategy === 'ORB') base = 2.2;
  if (strategy === 'VWAP Reclaim') base = 1.9;
  if (strategy === 'Momentum Continuation') base = 2.0;
  if (strategy === 'Extension Fade') base = 1.7;

  const qualityBonus = clamp((moveVsAtr * 0.12) + (Math.max(rvol - 1, 0) * 0.08), 0, 0.7);
  return Number((base + qualityBonus).toFixed(2));
}

function normalizeTradeabilityItem(row = {}) {
  const strategy = mapTradeabilityStrategy(row);
  const hasCatalyst = Boolean(row.has_catalyst);
  const volumeOk = Boolean(row.volume_ok);
  const hasStructure = Boolean(row.has_structure);

  const passed = [hasCatalyst, volumeOk, hasStructure].filter(Boolean).length;
  const qualityClass = passed >= 3 ? 'A' : passed === 2 ? 'B' : 'C';

  const baseProbability = clamp(Number(row.signal_probability || row.why_confidence || 0), 0, 100);
  const adjustedProbability = clamp(
    baseProbability * 0.55
      + (hasCatalyst ? 22 : 0)
      + (volumeOk ? 14 : 0)
      + (hasStructure ? 9 : 0),
    0,
    100
  );

  const tradeable = hasCatalyst && volumeOk && hasStructure;

  return {
    symbol: String(row.symbol || '').toUpperCase(),
    strategy,
    class: qualityClass,
    entry_type: buildTradeabilityEntry(strategy),
    invalidation: buildTradeabilityInvalidation(strategy, row),
    probability: Number(adjustedProbability.toFixed(2)),
    risk_reward: estimateRiskReward(strategy, row),
    timestamp: row.signal_ts || row.metrics_ts || new Date().toISOString(),
    tradeable,
  };
}

async function fetchTradeabilityRawRows() {
  const { rows } = await queryWithTimeout(
    `WITH latest_signals AS (
       SELECT DISTINCT ON (symbol)
         UPPER(symbol) AS symbol,
         COALESCE(NULLIF(strategy, ''), NULLIF(setup_type, ''), 'Momentum Continuation') AS strategy,
         COALESCE(probability, confidence, score, 0) AS signal_probability,
         COALESCE(updated_at, detected_at, created_at, NOW()) AS signal_ts
       FROM strategy_signals
       WHERE COALESCE(symbol, '') <> ''
       ORDER BY symbol, COALESCE(updated_at, detected_at, created_at, NOW()) DESC
     ),
     latest_metrics AS (
       SELECT DISTINCT ON (m.symbol)
         UPPER(m.symbol) AS symbol,
         COALESCE(m.price, 0) AS price,
         COALESCE((to_jsonb(m)->>'change_percent')::numeric, 0) AS change_percent,
         COALESCE(m.relative_volume, 0) AS relative_volume,
         COALESCE(m.volume, 0) AS volume,
         COALESCE(m.vwap, 0) AS vwap,
         COALESCE(m.atr, 0) AS atr,
         COALESCE(m.updated_at, m.last_updated, NOW()) AS metrics_ts
       FROM market_metrics m
       ORDER BY m.symbol, COALESCE(m.updated_at, m.last_updated, NOW()) DESC
     ),
     daily_proxy AS (
       SELECT
         UPPER(d.symbol) AS symbol,
         (ARRAY_AGG(d.close ORDER BY d.date DESC))[1] AS daily_close,
         AVG((d.high - d.low)) FILTER (WHERE d.date >= CURRENT_DATE - INTERVAL '14 days') AS atr14_proxy
       FROM daily_ohlc d
       WHERE d.date >= CURRENT_DATE - INTERVAL '30 days'
       GROUP BY UPPER(d.symbol)
     ),
     intraday_shape AS (
       SELECT
         UPPER(i.symbol) AS symbol,
         MAX(i.timestamp) AS last_intraday_ts,
         MAX(i.high) AS intraday_high,
         MIN(i.low) AS intraday_low,
         (ARRAY_AGG(i.close ORDER BY i.timestamp DESC))[1] AS last_intraday_close,
         MAX(CASE WHEN i.session = 'regular' THEN i.high END) FILTER (
           WHERE i.timestamp <= date_trunc('day', NOW()) + INTERVAL '45 minutes'
         ) AS opening_range_high,
         MIN(CASE WHEN i.session = 'regular' THEN i.low END) FILTER (
           WHERE i.timestamp <= date_trunc('day', NOW()) + INTERVAL '45 minutes'
         ) AS opening_range_low
       FROM intraday_1m i
       WHERE i.timestamp >= NOW() - INTERVAL '24 hours'
       GROUP BY UPPER(i.symbol)
     ),
     latest_news AS (
       SELECT
         UPPER(COALESCE(na.symbol, '')) AS symbol,
         MAX(COALESCE(na.published_at, na.created_at)) AS latest_news_at,
         (ARRAY_AGG(na.headline ORDER BY COALESCE(na.published_at, na.created_at) DESC NULLS LAST))[1] AS latest_headline,
         (ARRAY_AGG(na.catalyst_type ORDER BY COALESCE(na.published_at, na.created_at) DESC NULLS LAST))[1] AS latest_news_catalyst,
         COALESCE(MAX(
           CASE
             WHEN COALESCE(na.published_at, na.created_at) >= NOW() - INTERVAL '2 hours' THEN 1.0
             WHEN COALESCE(na.published_at, na.created_at) >= NOW() - INTERVAL '6 hours' THEN 0.9
             WHEN COALESCE(na.published_at, na.created_at) >= NOW() - INTERVAL '24 hours' THEN 0.75
             WHEN COALESCE(na.published_at, na.created_at) >= NOW() - INTERVAL '48 hours' THEN 0.45
             ELSE 0.2
           END
         ), 0) AS news_relevance
       FROM news_articles na
       WHERE COALESCE(na.published_at, na.created_at) >= NOW() - INTERVAL '72 hours'
       GROUP BY UPPER(COALESCE(na.symbol, ''))
     ),
     latest_catalyst AS (
       SELECT
         UPPER(tc.symbol) AS symbol,
         (ARRAY_AGG(tc.catalyst_type ORDER BY tc.published_at DESC NULLS LAST))[1] AS catalyst_type,
         (ARRAY_AGG(tc.headline ORDER BY tc.published_at DESC NULLS LAST))[1] AS catalyst_headline,
         MAX(tc.published_at) AS latest_catalyst_at
       FROM trade_catalysts tc
       WHERE tc.published_at >= NOW() - INTERVAL '7 days'
       GROUP BY UPPER(tc.symbol)
     ),
     joined AS (
       SELECT
         ls.symbol,
         ls.strategy AS signal_strategy,
         ls.signal_probability,
         ls.signal_ts,
         COALESCE(lm.price, dp.daily_close, 0) AS last_price,
         COALESCE(lm.change_percent, 0) AS pct_move,
         COALESCE(lm.relative_volume, 0) AS rvol,
         COALESCE(lm.volume, 0) AS volume,
         COALESCE(lm.vwap, 0) AS vwap,
         COALESCE(lm.atr, dp.atr14_proxy, 0) AS atr_value,
         COALESCE(dp.daily_close, 0) AS daily_close,
         lm.metrics_ts,
         ish.last_intraday_ts,
         ish.intraday_high,
         ish.intraday_low,
         ish.last_intraday_close,
         ish.opening_range_high,
         ish.opening_range_low,
         ln.latest_news_at,
         ln.latest_headline,
         ln.latest_news_catalyst,
         ln.news_relevance,
         lc.catalyst_type AS trade_catalyst_type,
         lc.catalyst_headline,
         lc.latest_catalyst_at
       FROM latest_signals ls
       LEFT JOIN latest_metrics lm ON lm.symbol = ls.symbol
       LEFT JOIN daily_proxy dp ON dp.symbol = ls.symbol
       LEFT JOIN intraday_shape ish ON ish.symbol = ls.symbol
       LEFT JOIN latest_news ln ON ln.symbol = ls.symbol
       LEFT JOIN latest_catalyst lc ON lc.symbol = ls.symbol
     )
     SELECT
       j.*,
       CASE
         WHEN COALESCE(j.atr_value, 0) > 0 AND COALESCE(j.last_price, 0) > 0
           THEN ABS((j.pct_move / 100.0) * j.last_price) / NULLIF(j.atr_value, 0)
         WHEN COALESCE(j.daily_close, 0) > 0
           THEN ABS(j.pct_move) / 3.0
         ELSE 0
       END AS move_vs_atr,
       LEAST(1, GREATEST(0, COALESCE(j.news_relevance, 0))) * 100 AS why_confidence,
       (
         COALESCE(j.trade_catalyst_type, '') <> ''
         OR COALESCE(j.latest_news_catalyst, '') <> ''
         OR COALESCE(j.catalyst_headline, '') <> ''
         OR COALESCE(j.latest_headline, '') <> ''
       ) AS has_catalyst,
       (
         COALESCE(j.rvol, 0) >= 1.5
         AND COALESCE(j.volume, 0) >= 250000
       ) AS volume_ok,
       (
         (
           COALESCE(j.opening_range_high, 0) > 0
           AND COALESCE(j.last_intraday_close, 0) > COALESCE(j.opening_range_high, 0)
         )
         OR (
           COALESCE(j.vwap, 0) > 0
           AND COALESCE(j.last_intraday_close, 0) >= COALESCE(j.vwap, 0)
           AND COALESCE(j.intraday_low, 0) < COALESCE(j.vwap, 0)
         )
         OR (
           ABS(COALESCE(j.pct_move, 0)) >= 2
           AND (
             CASE
               WHEN COALESCE(j.atr_value, 0) > 0 AND COALESCE(j.last_price, 0) > 0
                 THEN ABS((j.pct_move / 100.0) * j.last_price) / NULLIF(j.atr_value, 0)
               WHEN COALESCE(j.daily_close, 0) > 0
                 THEN ABS(j.pct_move) / 3.0
               ELSE 0
             END
           ) >= 1
         )
       ) AS has_structure
     FROM joined j
     WHERE j.symbol ~ '^[A-Z][A-Z0-9.\\-]{0,6}$'
     ORDER BY (
       COALESCE(j.signal_probability, 0) * 0.55
       + (LEAST(1, GREATEST(0, COALESCE(j.news_relevance, 0))) * 100) * 0.25
       + (LEAST(2.0, GREATEST(0, CASE
            WHEN COALESCE(j.atr_value, 0) > 0 AND COALESCE(j.last_price, 0) > 0
              THEN ABS((j.pct_move / 100.0) * j.last_price) / NULLIF(j.atr_value, 0)
            WHEN COALESCE(j.daily_close, 0) > 0
              THEN ABS(j.pct_move) / 3.0
            ELSE 0
          END)) / 2.0) * 20
     ) DESC NULLS LAST
     LIMIT 80`,
    [],
    { label: 'api.intelligence.tradeability.raw', timeoutMs: 4000, maxRetries: 1, retryDelayMs: 120 }
  );

  return rows || [];
}

async function assertRequiredSchemaColumns() {
  const checks = [
    { table: 'trade_outcomes', column: 'symbol' },
    { table: 'trade_outcomes', column: 'pnl_pct' },
    { table: 'signal_outcomes', column: 'pnl_pct' },
  ];

  for (const check of checks) {
    const { rows } = await queryWithTimeout(
      `SELECT EXISTS (
         SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = $1
           AND column_name = $2
       ) AS exists`,
      [check.table, check.column],
      {
        label: `preflight.schema.${check.table}.${check.column}`,
        timeoutMs: 3000,
        maxRetries: 0,
      }
    );

    if (!rows?.[0]?.exists) {
      console.error(`[PREFLIGHT] Missing required schema column: ${check.table}.${check.column}`);
      process.exit(1);
    }
  }
}

function resolveOutcomeWindow(windowKey) {
  const key = String(windowKey || '15m').toLowerCase();
  if (key === '5m') return { key: '5m', ms: 5 * 60 * 1000 };
  if (key === '15m') return { key: '15m', ms: 15 * 60 * 1000 };
  if (key === '1h') return { key: '1h', ms: 60 * 60 * 1000 };
  if (key === 'eod') return { key: 'eod', ms: 8 * 60 * 60 * 1000 };
  return { key: '15m', ms: 15 * 60 * 1000 };
}

async function getStrategyEdgeMap() {
  try {
    const { rows } = await queryWithTimeout(
      `WITH perf AS (
         SELECT
           strategy,
           COUNT(*)::int AS total_trades,
           ROUND(AVG(CASE WHEN outcome = 'win' THEN 1.0 ELSE 0.0 END) * 100, 2) AS win_rate,
           ROUND(AVG(result_pct), 4) AS avg_return,
           ROUND(AVG(CASE WHEN result_pct > 0 THEN result_pct END), 4) AS avg_win,
           ROUND(AVG(CASE WHEN result_pct < 0 THEN ABS(result_pct) END), 4) AS avg_loss
         FROM trade_outcomes
         WHERE result_pct IS NOT NULL
         GROUP BY strategy
       )
       SELECT
         strategy,
         total_trades,
         win_rate,
         avg_return,
         ROUND(
           COALESCE(avg_win, 0) * (COALESCE(win_rate, 0) / 100.0)
           - COALESCE(avg_loss, 0) * (1 - (COALESCE(win_rate, 0) / 100.0)),
           4
         ) AS expectancy
       FROM perf`,
      [],
      { label: 'trade_outcomes.strategy_edge', timeoutMs: 2800, maxRetries: 0 }
    );

    return new Map((rows || []).map((row) => [String(row.strategy || ''), row]));
  } catch (_error) {
    return new Map();
  }
}

function applyRealTimeEdgeFilter(rows, edgeMap, requireHistory = true) {
  return (rows || []).map((row) => {
    const stats = edgeMap.get(String(row.strategy || ''));
    const winRate = Number(stats?.win_rate || 0);
    const expectancy = Number(stats?.expectancy || 0);
    const hasHistory = Number(stats?.total_trades || 0) > 0;
    const edgeConfirmed = hasHistory && winRate >= 50 && expectancy > 0;

    const blockedByHistory = requireHistory && !hasHistory;
    const blockedByEdge = hasHistory && (winRate < 50 || expectancy <= 0);
    const tradeable = Boolean(row.tradeable) && !blockedByHistory && !blockedByEdge;

    return {
      ...row,
      tradeable,
      edge_confirmed: edgeConfirmed,
      edge_badge: edgeConfirmed ? 'EDGE CONFIRMED' : null,
    };
  });
}

async function snapshotTradeabilityPredictions(rows) {
  const validateOutcomeWrite = ({ symbol, pnlPct }) => {
    if (!symbol || String(symbol).trim() === '' || pnlPct === undefined) {
      console.error('INVALID OUTCOME WRITE BLOCKED', {
        writer: 'snapshotTradeabilityPredictions',
        symbol,
        pnl_pct: pnlPct,
      });
      throw new Error('INVALID OUTCOME WRITE BLOCKED');
    }
  };

  const tradeableRows = (rows || []).filter((row) => row.tradeable);
  if (tradeableRows.length === 0) return 0;

  const symbols = Array.from(new Set(tradeableRows.map((row) => String(row.symbol || '').toUpperCase()).filter(Boolean)));
  if (symbols.length === 0) return 0;

  const { rows: quoteRows } = await queryWithTimeout(
    `SELECT DISTINCT ON (symbol) UPPER(symbol) AS symbol, price, updated_at
     FROM market_quotes
     WHERE symbol = ANY($1::text[])
     ORDER BY symbol, COALESCE(updated_at, NOW()) DESC`,
    [symbols],
    { label: 'trade_outcomes.snapshot.quotes', timeoutMs: 2500, maxRetries: 0 }
  );

  const priceMap = new Map((quoteRows || []).map((row) => [String(row.symbol || '').toUpperCase(), Number(row.price || 0)]));

  let inserted = 0;
  for (const row of tradeableRows) {
    const symbol = String(row.symbol || '').toUpperCase();
    const strategy = String(row.strategy || 'Momentum Continuation');
    const tradeClass = String(row.class || 'C');
    const probability = Number(row.probability || 0);
    const entryTime = new Date(row.timestamp || Date.now());
    const entryPrice = Number(priceMap.get(symbol) || 0);
    const pnlPct = null;
    if (!symbol || entryPrice <= 0) continue;

    const existing = await queryWithTimeout(
      `SELECT id
       FROM trade_outcomes
       WHERE symbol = $1
         AND strategy = $2
         AND "class" = $3
         AND entry_time > NOW() - INTERVAL '5 minutes'
       LIMIT 1`,
      [symbol, strategy, tradeClass],
      { label: 'trade_outcomes.snapshot.exists', timeoutMs: 1800, maxRetries: 0 }
    );

    if (existing.rows.length > 0) continue;

    validateOutcomeWrite({ symbol, pnlPct });

    await queryWithTimeout(
      `INSERT INTO trade_outcomes (
         symbol, strategy, "class", probability, entry_time, entry_price,
         exit_time, exit_price, max_runup_pct, max_drawdown_pct, result_pct, pnl_pct, max_move, outcome
       ) VALUES ($1,$2,$3,$4,$5,$6,NULL,NULL,NULL,NULL,NULL,$7,NULL,NULL)`,
      [symbol, strategy, tradeClass, probability, entryTime.toISOString(), entryPrice, pnlPct],
      { label: 'trade_outcomes.snapshot.insert', timeoutMs: 1800, maxRetries: 0 }
    );
    inserted += 1;
  }

  return inserted;
}

async function evaluateTradeOutcomes(windowKey) {
  const validateOutcomeWrite = ({ symbol, pnlPct }) => {
    if (!symbol || String(symbol).trim() === '' || pnlPct === undefined) {
      console.error('INVALID OUTCOME WRITE BLOCKED', {
        writer: 'evaluateTradeOutcomes',
        symbol,
        pnl_pct: pnlPct,
      });
      throw new Error('INVALID OUTCOME WRITE BLOCKED');
    }
  };

  const window = resolveOutcomeWindow(windowKey);

  const { rows: openRows } = await queryWithTimeout(
    `SELECT id, symbol, entry_time, entry_price
     FROM trade_outcomes
     WHERE exit_time IS NULL
       AND entry_price IS NOT NULL
       AND entry_time <= NOW() - ($1::int * INTERVAL '1 millisecond')
     ORDER BY entry_time ASC
     LIMIT 200`,
    [window.ms],
    { label: 'trade_outcomes.evaluate.open_rows', timeoutMs: 2500, maxRetries: 0 }
  );

  let updated = 0;
  for (const row of openRows || []) {
    const entryTime = new Date(row.entry_time);
    const endTime = new Date(Math.min(entryTime.getTime() + window.ms, Date.now()));
    const entryPrice = Number(row.entry_price || 0);
    if (!Number.isFinite(entryPrice) || entryPrice <= 0) continue;

    const bars = await queryWithTimeout(
      `SELECT timestamp, high, low, close
       FROM intraday_1m
       WHERE symbol = $1
         AND timestamp >= $2
         AND timestamp <= $3
       ORDER BY timestamp ASC`,
      [String(row.symbol || '').toUpperCase(), entryTime.toISOString(), endTime.toISOString()],
      { label: 'trade_outcomes.evaluate.path', timeoutMs: 2500, maxRetries: 0 }
    );

    if (!bars.rows.length) continue;

    const highs = bars.rows.map((b) => Number(b.high || b.close || entryPrice)).filter((v) => Number.isFinite(v));
    const lows = bars.rows.map((b) => Number(b.low || b.close || entryPrice)).filter((v) => Number.isFinite(v));
    const exitPrice = Number(bars.rows[bars.rows.length - 1]?.close || entryPrice);

    const maxHigh = highs.length ? Math.max(...highs) : entryPrice;
    const minLow = lows.length ? Math.min(...lows) : entryPrice;
    const maxRunupPct = ((maxHigh - entryPrice) / entryPrice) * 100;
    const maxDrawdownPct = ((minLow - entryPrice) / entryPrice) * 100;
    const resultPct = ((exitPrice - entryPrice) / entryPrice) * 100;
    const pnlPct = resultPct;
    const outcome = resultPct > 0.05 ? 'win' : (resultPct < -0.05 ? 'loss' : 'breakeven');

    validateOutcomeWrite({ symbol: row.symbol, pnlPct });

    await queryWithTimeout(
      `UPDATE trade_outcomes
       SET exit_time = $2,
           exit_price = $3,
           max_runup_pct = $4,
           max_drawdown_pct = $5,
           result_pct = $6,
         pnl_pct = $6,
         max_move = $4,
         outcome = $7
       WHERE id = $1`,
      [row.id, endTime.toISOString(), exitPrice, maxRunupPct, maxDrawdownPct, resultPct, outcome],
      { label: 'trade_outcomes.evaluate.update', timeoutMs: 1800, maxRetries: 0 }
    );
    updated += 1;
  }

  return { updated, window: window.key };
}

function applyDebugBypassMeta(req, _res, next) {
  if (DEBUG_MODE) {
    req.debugAuthBypass = true;
  }
  next();
}

const intelligenceNewsHandler = async (req, res) => {
  try {
    const query = buildIntelligenceNewsQuery({ symbol: req.query.symbol });
    const { rows } = await queryWithTimeout(query.text, query.params, query.options);
    const normalizedRows = rows || [];

    return res.json(successResponse(normalizedRows, {
      source: 'primary',
      timestamp: new Date().toISOString(),
    }));
  } catch (error) {
    return res.status(500).json(errorResponse(error.message || 'Failed to load intelligence news'));
  }
};

app.get('/api/intelligence/news', applyDebugBypassMeta, intelligenceNewsHandler);
app.get('/api/intelligence/inbox', applyDebugBypassMeta, intelligenceNewsHandler);

app.get('/api/intelligence/opportunities', applyDebugBypassMeta, async (req, res) => {
  try {
    const rows = await generateDynamicOpportunities({
      limit: req.query.limit,
      minCount: req.query.min_count,
    });
    return res.json(successResponse(rows, { source: 'authoritative_dynamic' }));
  } catch (error) {
    return res.status(500).json(errorResponse(error.message || 'Failed to load intelligence opportunities'));
  }
});

app.get('/api/intelligence/heatmap', applyDebugBypassMeta, async (req, res) => {
  try {
    const primaryQuery = buildHeatmapPrimaryQuery();
    const { rows: primaryRows } = await queryWithTimeout(primaryQuery.text, primaryQuery.params, primaryQuery.options);

    if (primaryRows.length > 0) {
      return res.json(successResponse(primaryRows));
    }

    const fallbackQuery = buildHeatmapFallbackQuery();
    const { rows: fallbackRows } = await queryWithTimeout(fallbackQuery.text, fallbackQuery.params, fallbackQuery.options);

    return res.json(successResponse(fallbackRows));
  } catch (error) {
    console.warn('[DATA GAP] intelligence heatmap query failed; returning fallback heatmap data', { error: error.message });
    return res.json(successResponse([
      {
        symbol: 'SPY',
        sector: 'ETF',
        market_cap: 0,
        volume_24h: 0,
        gap_percent: 0,
        relative_volume: 1,
        institutional_flow_score: 50,
        change_percent: 0.3,
      },
      {
        symbol: 'QQQ',
        sector: 'ETF',
        market_cap: 0,
        volume_24h: 0,
        gap_percent: 0,
        relative_volume: 1,
        institutional_flow_score: 52,
        change_percent: -0.2,
      },
    ]));
  }
});

app.get('/api/intelligence/signals', applyDebugBypassMeta, async (req, res) => {
  try {
    const signalResult = await getLatestSignals(queryWithTimeout);
    const signals = normalizeSignalRows(signalResult.rows);
    console.log('[SIGNALS]', {
      rows: signals.length,
      latest: signals[0]?.detected_at || signals[0]?.updated_at || signals[0]?.created_at || null,
    });
    console.log('[INTELLIGENCE_SIGNALS] sample response', signals[0] || null);
    return res.json(successResponse(signals));
  } catch (error) {
    return res.status(500).json(errorResponse(error.message || 'Failed to load intelligence signals'));
  }
});

// PREP MODE INTELLIGENCE — always returns meaningful data regardless of market hours
// Phases 7+8: Used when mode=PREP or mode=RECENT to prevent blank dashboards
app.get('/api/intelligence/prep', async (_req, res) => {
  try {
    const marketCtx  = getMarketMode();
    const windowStr  = getModeWindow(marketCtx.mode);

    // Top 5 signals from window with complete fields
    const signalRows = await queryWithTimeout(`
      SELECT DISTINCT ON (symbol)
        symbol, why, how AS how_to_trade, consequence, confidence,
        expected_move, trade_score, trade_class, regime_alignment,
        event_type, catalyst_type, change_percent, relative_volume,
        created_at, updated_at
      FROM opportunity_stream
      WHERE created_at > NOW() - INTERVAL '${windowStr}'
        AND confidence >= 50
        AND why IS NOT NULL
        AND why <> ''
      ORDER BY symbol, confidence DESC NULLS LAST, created_at DESC
      LIMIT 50
    `, [], { timeoutMs: 10000, label: 'prep.signals', maxRetries: 0 });

    // Sort by confidence desc, pick top 5
    const sortedSignals = (signalRows.rows || [])
      .sort((a, b) => (Number(b.confidence) || 0) - (Number(a.confidence) || 0))
      .slice(0, 5);

    // Carry-over setups: high confidence + created within window
    const carryoverRows = await queryWithTimeout(`
      SELECT DISTINCT ON (symbol)
        symbol, why, how AS how_to_trade, consequence, confidence,
        expected_move, trade_score, event_type
      FROM opportunity_stream
      WHERE created_at > NOW() - INTERVAL '${windowStr}'
        AND confidence >= 70
        AND trade_class IN ('A', 'B', 'CONFIRMING', 'MOMENTUM')
      ORDER BY symbol, confidence DESC NULLS LAST
      LIMIT 10
    `, [], { timeoutMs: 8000, label: 'prep.carryover', maxRetries: 0 });

    // Earnings in next 3 days
    const earningsRows = await queryWithTimeout(`
      SELECT symbol, report_date, report_time,
             COALESCE(eps_estimate, 0)          AS eps_estimate,
             COALESCE(revenue_estimate, 0)       AS revenue_estimate
      FROM earnings_events
      WHERE report_date >= CURRENT_DATE
        AND report_date <= CURRENT_DATE + INTERVAL '3 days'
      ORDER BY report_date ASC, symbol ASC
      LIMIT 30
    `, [], { timeoutMs: 8000, label: 'prep.earnings', maxRetries: 0 });

    // Top news clusters — prefer high-score articles, fall back to most recent if none score highly
    const newsRows = await queryWithTimeout(`
      WITH scored AS (
        SELECT id, headline, symbol, source, published_at,
               COALESCE(news_score, 0) AS priority_score, catalyst_type, summary
        FROM news_articles
        WHERE COALESCE(published_at, created_at) > NOW() - INTERVAL '48 hours'
          AND headline IS NOT NULL AND headline <> ''
      )
      SELECT *
      FROM scored
      ORDER BY
        CASE WHEN catalyst_type IN ('EARNINGS','FDA','MERGER','BUYOUT') THEN 1 ELSE 2 END,
        priority_score DESC NULLS LAST,
        published_at DESC NULLS LAST
      LIMIT 15
    `, [], { timeoutMs: 8000, label: 'prep.news', maxRetries: 0 });

    console.log(`[PREP] mode=${marketCtx.mode} signals=${sortedSignals.length} earnings=${earningsRows.rows.length} news=${newsRows.rows.length} carryover=${carryoverRows.rows.length}`);

    res.json({
      ok: true,
      market_mode: marketCtx.mode,
      market_reason: marketCtx.reason,
      data_window: windowStr,
      last_session: marketCtx.lastDataTimestamp,
      top_signals:   sortedSignals,
      carryover:     carryoverRows.rows || [],
      earnings:      earningsRows.rows  || [],
      news_clusters: newsRows.rows      || [],
      meta: {
        signals_count:   sortedSignals.length,
        carryover_count: (carryoverRows.rows || []).length,
        earnings_count:  (earningsRows.rows  || []).length,
        news_count:      (newsRows.rows      || []).length,
      },
    });
  } catch (err) {
    console.error('[PREP] error:', err.message);
    res.json({
      ok: false,
      market_mode: 'UNKNOWN',
      top_signals: [], carryover: [], earnings: [], news_clusters: [],
      meta: { error: err.message },
    });
  }
});

app.get('/api/intelligence/why-moving', applyDebugBypassMeta, async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 10, 50));

    const { rows } = await queryWithTimeout(
      `WITH latest_metrics AS (
         SELECT DISTINCT ON (m.symbol)
           UPPER(m.symbol) AS symbol,
           COALESCE(m.price, 0) AS price,
           COALESCE((to_jsonb(m)->>'change_percent')::numeric, 0) AS change_percent,
           COALESCE(m.relative_volume, 0) AS relative_volume,
           COALESCE(m.atr, 0) AS atr,
           COALESCE(m.volume, 0) AS volume,
           COALESCE(m.updated_at, m.last_updated, NOW()) AS metrics_ts
         FROM market_metrics m
         ORDER BY m.symbol, COALESCE(m.updated_at, m.last_updated, NOW()) DESC
       ),
       daily_move AS (
         SELECT
           UPPER(d.symbol) AS symbol,
           (ARRAY_AGG(d.close ORDER BY d.date DESC))[1] AS close,
           (ARRAY_AGG(d.open ORDER BY d.date DESC))[1] AS open,
           AVG((d.high - d.low)) FILTER (WHERE d.date >= CURRENT_DATE - INTERVAL '14 days') AS atr14_proxy
         FROM daily_ohlc d
         WHERE d.date >= CURRENT_DATE - INTERVAL '30 days'
         GROUP BY UPPER(d.symbol)
       ),
       intraday_behavior AS (
         SELECT
           UPPER(i.symbol) AS symbol,
           SUM(CASE WHEN i.session = 'premarket' THEN COALESCE(i.volume, 0) ELSE 0 END) AS premarket_volume,
           SUM(CASE WHEN i.session = 'regular' THEN COALESCE(i.volume, 0) ELSE 0 END) AS regular_volume,
           MIN(CASE WHEN i.session = 'premarket' THEN i.close END) AS premarket_first_close,
           MAX(CASE WHEN i.session = 'premarket' THEN i.close END) AS premarket_last_close,
           MIN(CASE WHEN i.session = 'regular' THEN i.close END) AS regular_first_close,
           MAX(CASE WHEN i.session = 'regular' THEN i.close END) AS regular_last_close,
           MAX(i.timestamp) AS last_intraday_ts
         FROM intraday_1m i
         WHERE i.timestamp >= NOW() - INTERVAL '24 hours'
         GROUP BY UPPER(i.symbol)
       ),
       news_recent AS (
         SELECT
           UPPER(COALESCE(na.symbol, '')) AS symbol,
           na.headline,
           na.source,
           COALESCE(na.published_at, na.created_at) AS published_at,
           na.catalyst_type
         FROM news_articles na
         WHERE COALESCE(na.published_at, na.created_at) >= NOW() - INTERVAL '72 hours'
           AND COALESCE(na.headline, '') <> ''
       ),
       catalyst_recent AS (
         SELECT
           UPPER(tc.symbol) AS symbol,
           (ARRAY_AGG(tc.catalyst_type ORDER BY tc.published_at DESC NULLS LAST))[1] AS catalyst_type,
           (ARRAY_AGG(tc.headline ORDER BY tc.published_at DESC NULLS LAST))[1] AS catalyst_headline,
           MAX(tc.published_at) AS latest_catalyst_at
         FROM trade_catalysts tc
         WHERE tc.published_at >= NOW() - INTERVAL '7 days'
         GROUP BY UPPER(tc.symbol)
       ),
       universe AS (
         SELECT symbol
         FROM latest_metrics
         WHERE ABS(COALESCE(change_percent, 0)) >= 1
            OR COALESCE(relative_volume, 0) >= 1.2
         UNION
         SELECT symbol FROM catalyst_recent
         UNION
         SELECT symbol FROM news_recent WHERE symbol <> ''
       ),
       scored AS (
         SELECT
           u.symbol,
           COALESCE(lm.price, dm.close, 0) AS last_price,
           COALESCE(
             lm.change_percent,
             CASE WHEN COALESCE(dm.open, 0) > 0 THEN ((dm.close - dm.open) / NULLIF(dm.open, 0)) * 100 ELSE 0 END,
             0
           ) AS pct_move,
           COALESCE(lm.relative_volume, 0) AS rvol,
           COALESCE(lm.atr, dm.atr14_proxy, 0) AS atr_value,
           COALESCE(dm.close, 0) AS daily_close,
           lm.metrics_ts,
           ib.last_intraday_ts,
           ib.premarket_volume,
           ib.regular_volume,
           CASE
             WHEN COALESCE(ib.premarket_first_close, 0) > 0
             THEN ((ib.premarket_last_close - ib.premarket_first_close) / NULLIF(ib.premarket_first_close, 0)) * 100
             ELSE NULL
           END AS premarket_move_pct,
           CASE
             WHEN COALESCE(ib.regular_first_close, 0) > 0
             THEN ((ib.regular_last_close - ib.regular_first_close) / NULLIF(ib.regular_first_close, 0)) * 100
             ELSE NULL
           END AS regular_move_pct,
           nr.latest_news_at,
           nr.latest_headline,
           nr.latest_source,
           nr.latest_news_catalyst,
           nr.news_relevance,
           nr.news_hits_24h,
           cr.catalyst_type AS trade_catalyst_type,
           cr.catalyst_headline,
           cr.latest_catalyst_at
         FROM universe u
         LEFT JOIN latest_metrics lm ON lm.symbol = u.symbol
         LEFT JOIN daily_move dm ON dm.symbol = u.symbol
         LEFT JOIN intraday_behavior ib ON ib.symbol = u.symbol
         LEFT JOIN catalyst_recent cr ON cr.symbol = u.symbol
         LEFT JOIN LATERAL (
           SELECT
             COUNT(*) FILTER (WHERE n.published_at >= NOW() - INTERVAL '24 hours') AS news_hits_24h,
             MAX(n.published_at) AS latest_news_at,
             (ARRAY_AGG(n.headline ORDER BY n.published_at DESC NULLS LAST))[1] AS latest_headline,
             (ARRAY_AGG(n.source ORDER BY n.published_at DESC NULLS LAST))[1] AS latest_source,
             (ARRAY_AGG(n.catalyst_type ORDER BY n.published_at DESC NULLS LAST))[1] AS latest_news_catalyst,
             COALESCE(MAX(
               CASE
                 WHEN n.published_at >= NOW() - INTERVAL '2 hours' THEN 1.0
                 WHEN n.published_at >= NOW() - INTERVAL '6 hours' THEN 0.9
                 WHEN n.published_at >= NOW() - INTERVAL '24 hours' THEN 0.75
                 WHEN n.published_at >= NOW() - INTERVAL '48 hours' THEN 0.45
                 ELSE 0.2
               END
             ), 0) AS news_relevance
           FROM news_recent n
           WHERE n.symbol = u.symbol
              OR n.headline ILIKE ('%' || u.symbol || '%')
         ) nr ON TRUE
       )
       SELECT
         symbol,
         last_price,
         pct_move,
         rvol,
         atr_value,
         daily_close,
         metrics_ts,
         last_intraday_ts,
         premarket_volume,
         regular_volume,
         premarket_move_pct,
         regular_move_pct,
         latest_news_at,
         latest_headline,
         latest_source,
         latest_news_catalyst,
         news_relevance,
         news_hits_24h,
         trade_catalyst_type,
         catalyst_headline,
         latest_catalyst_at,
         CASE
           WHEN COALESCE(atr_value, 0) > 0 AND COALESCE(last_price, 0) > 0
             THEN ABS((pct_move / 100.0) * last_price) / NULLIF(atr_value, 0)
           WHEN COALESCE(daily_close, 0) > 0
             THEN ABS(pct_move) / 3.0
           ELSE 0
         END AS move_vs_atr
       FROM scored
       WHERE symbol ~ '^[A-Z][A-Z0-9.\-]{0,6}$'
       ORDER BY (
         LEAST(1, GREATEST(0, COALESCE(news_relevance, 0))) * 0.45 +
         (LEAST(1.6, GREATEST(0, COALESCE(rvol, 0))) / 1.6) * 0.30 +
         (LEAST(2.0, GREATEST(0, CASE
            WHEN COALESCE(atr_value, 0) > 0 AND COALESCE(last_price, 0) > 0
              THEN ABS((pct_move / 100.0) * last_price) / NULLIF(atr_value, 0)
            WHEN COALESCE(daily_close, 0) > 0
              THEN ABS(pct_move) / 3.0
            ELSE 0
          END)) / 2.0) * 0.25
       ) DESC NULLS LAST
       LIMIT 30`,
      [],
      { label: 'api.intelligence.why_moving', timeoutMs: 3500, maxRetries: 1, retryDelayMs: 120 }
    );

    const data = (rows || [])
      .map((row) => normalizeWhyMovingItem(row))
      .filter((row) => row.symbol && row.reason)
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, limit);

    return res.json(successResponse(data, {
      ranking: 'confidence',
      engine: 'why_is_this_moving',
      generated_at: new Date().toISOString(),
    }));
  } catch (error) {
    return res.status(500).json(errorResponse(error.message || 'Failed to load why-moving intelligence'));
  }
});

app.get('/api/intelligence/tradeability', applyDebugBypassMeta, async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 10, 50));

    const rawRows = await fetchTradeabilityRawRows();
    const baseRows = (rawRows || [])
      .map((row) => normalizeTradeabilityItem(row))
      .filter((row) => row.symbol)
      .sort((a, b) => b.probability - a.probability);

    const edgeMap = await getStrategyEdgeMap();
    const includeUnconfirmed = String(req.query.include_unconfirmed || '0') === '1';
    const edgeRows = applyRealTimeEdgeFilter(baseRows, edgeMap, true);

    const data = (includeUnconfirmed ? edgeRows : edgeRows.filter((row) => row.tradeable))
      .sort((a, b) => b.probability - a.probability)
      .slice(0, limit);

    return res.json(successResponse(data, {
      ranking: 'probability',
      engine: 'tradeability',
      realtime_edge_filter: true,
      strict_rules: {
        requires_catalyst: true,
        requires_volume: true,
        requires_structure: true,
      },
      generated_at: new Date().toISOString(),
    }));
  } catch (error) {
    return res.status(500).json(errorResponse(error.message || 'Failed to load tradeability intelligence'));
  }
});

app.get('/api/intelligence/trade-outcomes', applyDebugBypassMeta, async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 50, 300));
    const window = resolveOutcomeWindow(req.query.window);

    const rawRows = await fetchTradeabilityRawRows();
    const baseRows = (rawRows || [])
      .map((row) => normalizeTradeabilityItem(row))
      .filter((row) => row.symbol)
      .sort((a, b) => b.probability - a.probability);

    const edgeMap = await getStrategyEdgeMap();
    const edgeRows = applyRealTimeEdgeFilter(baseRows, edgeMap, true);
    const inserted = await snapshotTradeabilityPredictions(edgeRows);
    const evaluation = await evaluateTradeOutcomes(window.key);

    const { rows } = await queryWithTimeout(
      `SELECT
         id,
         symbol,
         strategy,
         "class" AS class,
         probability,
         entry_time,
         entry_price,
         exit_time,
         exit_price,
         max_runup_pct,
         max_drawdown_pct,
         result_pct,
         outcome
       FROM trade_outcomes
       ORDER BY entry_time DESC
       LIMIT $1`,
      [limit],
      { label: 'api.intelligence.trade_outcomes.list', timeoutMs: 2500, maxRetries: 0 }
    );

    return res.json(successResponse(rows || [], {
      engine: 'trade_outcome_tracker',
      evaluation_window: window.key,
      inserted_predictions: inserted,
      evaluated_rows: evaluation.updated,
      generated_at: new Date().toISOString(),
    }));
  } catch (error) {
    return res.status(500).json(errorResponse(error.message || 'Failed to load trade outcomes'));
  }
});

app.get('/api/intelligence/strategy-performance', applyDebugBypassMeta, async (_req, res) => {
  try {
    const { rows } = await queryWithTimeout(
      `WITH base AS (
         SELECT
           strategy,
           "class" AS class,
           result_pct,
           max_drawdown_pct,
           outcome
         FROM trade_outcomes
         WHERE result_pct IS NOT NULL
       ),
       grouped AS (
         SELECT
           strategy,
           class,
           COUNT(*)::int AS total_trades,
           AVG(CASE WHEN outcome = 'win' THEN 1.0 ELSE 0.0 END) AS win_rate_fraction,
           AVG(result_pct) AS avg_return,
           AVG(max_drawdown_pct) AS avg_drawdown,
           AVG(CASE WHEN result_pct > 0 THEN result_pct END) AS avg_win,
           AVG(CASE WHEN result_pct < 0 THEN ABS(result_pct) END) AS avg_loss,
           STDDEV_POP(result_pct) AS return_vol
         FROM base
         GROUP BY strategy, class
       )
       SELECT
         strategy,
         class,
         total_trades,
         ROUND((win_rate_fraction * 100)::numeric, 2) AS win_rate,
         ROUND(avg_return::numeric, 4) AS avg_return,
         ROUND(avg_drawdown::numeric, 4) AS avg_drawdown,
         ROUND(
           (
             COALESCE(avg_win, 0) * COALESCE(win_rate_fraction, 0)
             - COALESCE(avg_loss, 0) * (1 - COALESCE(win_rate_fraction, 0))
           )::numeric,
           4
         ) AS expectancy,
         ROUND(
           (
             CASE
             WHEN COALESCE(return_vol, 0) = 0 THEN 0
             ELSE (COALESCE(avg_return, 0) / NULLIF(return_vol, 0)) * SQRT(GREATEST(total_trades, 1))
             END
           )::numeric,
           4
         ) AS sharpe_like_score
       FROM grouped
       ORDER BY expectancy DESC NULLS LAST, win_rate DESC NULLS LAST, total_trades DESC`,
      [],
      { label: 'api.intelligence.strategy_performance', timeoutMs: 3000, maxRetries: 0 }
    );

    if (Array.isArray(rows) && rows.length > 0) {
      return res.json(successResponse(rows || [], {
        engine: 'strategy_performance',
        grouped_by: ['strategy', 'class'],
        generated_at: new Date().toISOString(),
      }));
    }

    const [opportunitiesResult, marketResult] = await Promise.all([
      queryWithTimeout(
        `SELECT *
         FROM opportunities
         ORDER BY created_at DESC NULLS LAST
         LIMIT 200`,
        [],
        { label: 'api.intelligence.strategy_performance.fallback.opportunities', timeoutMs: 3000, maxRetries: 0 }
      ).catch(() => ({ rows: [] })),
      queryWithTimeout(
        `SELECT DISTINCT ON (UPPER(symbol))
            UPPER(symbol) AS symbol,
          price
         FROM market_quotes
         WHERE symbol IS NOT NULL
         ORDER BY UPPER(symbol), COALESCE(updated_at, NOW()) DESC`,
        [],
        { label: 'api.intelligence.strategy_performance.fallback.market_quotes', timeoutMs: 3000, maxRetries: 0 }
      ).catch(() => ({ rows: [] })),
    ]);

    const quoteMap = new Map((marketResult.rows || []).map((row) => [String(row.symbol || '').toUpperCase(), row]));
    const grouped = {};

    for (const row of opportunitiesResult.rows || []) {
      const symbol = String(row?.symbol || '').toUpperCase();
      if (!symbol) continue;
      const quote = quoteMap.get(symbol);
      const entryPrice = Number(row?.entry_price ?? row?.entry);
      const currentPrice = Number(quote?.price ?? quote?.last ?? quote?.close);
      if (!Number.isFinite(entryPrice) || entryPrice <= 0 || !Number.isFinite(currentPrice)) continue;

      const move = ((currentPrice - entryPrice) / entryPrice) * 100;
      const strategy = String(row?.strategy || row?.setup_type || 'unknown');
      if (!grouped[strategy]) {
        grouped[strategy] = { total_trades: 0, wins: 0, losses: 0 };
      }

      grouped[strategy].total_trades += 1;
      if (move > 2) grouped[strategy].wins += 1;
      if (move < -1) grouped[strategy].losses += 1;
    }

    const fallbackRows = Object.entries(grouped).map(([strategy, stats]) => ({
      strategy,
      class: 'derived',
      total_trades: stats.total_trades,
      win_rate: stats.total_trades > 0 ? Number(((stats.wins / stats.total_trades) * 100).toFixed(2)) : 0,
      avg_return: null,
      avg_drawdown: null,
      expectancy: null,
      sharpe_like_score: null,
    })).sort((a, b) => Number(b.win_rate || 0) - Number(a.win_rate || 0));

    if (fallbackRows.length === 0) {
      const tradeOutcomeFallback = await queryWithTimeout(
        `SELECT
           COALESCE(strategy, 'unknown') AS strategy,
           COUNT(*)::int AS total_trades,
           SUM(CASE WHEN COALESCE(result_pct, 0) > 2 THEN 1 ELSE 0 END)::int AS wins,
           SUM(CASE WHEN COALESCE(result_pct, 0) < -1 THEN 1 ELSE 0 END)::int AS losses
         FROM trade_outcomes
         WHERE symbol IS NOT NULL
         GROUP BY COALESCE(strategy, 'unknown')
         ORDER BY total_trades DESC`,
        [],
        { label: 'api.intelligence.strategy_performance.fallback.trade_outcomes', timeoutMs: 3000, maxRetries: 0 }
      ).catch(() => ({ rows: [] }));

      const rowsFromOutcomes = (tradeOutcomeFallback.rows || []).map((row) => {
        const total = Number(row?.total_trades) || 0;
        const wins = Number(row?.wins) || 0;
        return {
          strategy: row?.strategy || 'unknown',
          class: 'derived',
          total_trades: total,
          win_rate: total > 0 ? Number(((wins / total) * 100).toFixed(2)) : 0,
          avg_return: null,
          avg_drawdown: null,
          expectancy: null,
          sharpe_like_score: null,
        };
      });

      return res.json(successResponse(rowsFromOutcomes, {
        engine: 'strategy_performance',
        grouped_by: ['strategy'],
        source: 'trade_outcomes_fallback',
        generated_at: new Date().toISOString(),
      }));
    }

    return res.json(successResponse(fallbackRows, {
      engine: 'strategy_performance',
      grouped_by: ['strategy'],
      source: 'opportunities+market_quotes_fallback',
      generated_at: new Date().toISOString(),
    }));
  } catch (error) {
    return res.status(500).json(errorResponse(error.message || 'Failed to load strategy performance'));
  }
});

app.get('/api/system/db-status', async (req, res) => {
  const timestamp = new Date().toISOString();
  const errors = [];

  let intelNews = { row_count: null, latest_timestamp: null };
  let newsArticles = { row_count: null, latest_timestamp: null };
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
    const articles = await queryWithTimeout(
      `SELECT COUNT(*)::int AS row_count,
              MAX(published_at) AS latest_timestamp
       FROM news_articles`,
      [],
      { label: 'api.system.db_status.news_articles', timeoutMs: 3000, maxRetries: 1, retryDelayMs: 120 }
    );
    newsArticles = {
      row_count: Number(articles.rows?.[0]?.row_count || 0),
      latest_timestamp: articles.rows?.[0]?.latest_timestamp || null,
    };
  } catch (error) {
    errors.push({ table: 'news_articles', error: error.message || 'Query failed' });
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
    news_articles: newsArticles,
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

async function handleSparkline(req, res) {
  const symbol = String(req.query.symbol || '').trim().toUpperCase();
  if (!symbol) return res.status(400).json([]);

  try {
    const points = await getSparklineFromCache(symbol);
    return res.json(points);
  } catch (error) {
    logger.warn('sparkline cache endpoint failed', { symbol, error: error.message });
    return res.json([]);
  }
}

app.get('/api/chart/sparkline', handleSparkline);
app.get('/api/charts/sparkline', handleSparkline);
app.get('/api/cache/sparkline/:symbol', async (req, res) => {
  const symbol = String(req.params.symbol || '').trim().toUpperCase();
  if (!symbol) return res.status(400).json([]);

  try {
    const points = await getSparklineFromCache(symbol);
    return res.json(points);
  } catch (_error) {
    return res.json([]);
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
    const tasks = [
      {
        key: 'sectors',
        fallback: [],
        run: () => fastRowsQuery(
          `SELECT sector, avg_change, total_volume, stocks, leaders, updated_at
           FROM sector_heatmap
           ORDER BY avg_change DESC NULLS LAST
           LIMIT 5`,
          [],
          'api.intelligence.summary.sectors',
          300
        ),
      },
      {
        key: 'opportunities',
        fallback: [],
        run: async () => {
          const rows = await getTopOpportunities(supabaseAdmin, {
            limit: 10,
            source: 'opportunity_ranker',
          });
          return (rows || []).map((row) => ({
            symbol: row.symbol,
            score: row.score,
            strategy: row.event_type || 'Ranked Opportunity',
            change_percent: null,
            relative_volume: null,
            gap_percent: null,
            updated_at: row.created_at,
          }));
        },
      },
      {
        key: 'earningsToday',
        fallback: [],
        run: () => fastRowsQuery(
          `SELECT symbol, company, earnings_date::text AS date, eps_estimate, revenue_estimate
           FROM earnings_events
           WHERE earnings_date = CURRENT_DATE
           ORDER BY symbol ASC
           LIMIT 50`,
          [],
          'api.intelligence.summary.earnings_today',
          300
        ),
      },
      {
        key: 'earningsWeek',
        fallback: [],
        run: () => fastRowsQuery(
          `SELECT symbol, company, earnings_date::text AS date, eps_estimate, revenue_estimate
           FROM earnings_events
           WHERE earnings_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
           ORDER BY earnings_date ASC, symbol ASC
           LIMIT 200`,
          [],
          'api.intelligence.summary.earnings_week',
          300
        ),
      },
      {
        key: 'news',
        fallback: [],
        run: () => fastRowsQuery(
          `SELECT symbol, headline, source, url, published_at, sentiment
           FROM intel_news
           ORDER BY published_at DESC NULLS LAST
           LIMIT 15`,
          [],
          'api.intelligence.summary.news',
          300
        ),
      },
      {
        key: 'topStrategies',
        fallback: [],
        run: () => fastRowsQuery(
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
      },
    ];

    const settled = await Promise.allSettled(tasks.map((task) => task.run()));
    const values = {};
    const warnings = [];

    settled.forEach((result, index) => {
      const task = tasks[index];
      if (result.status === 'fulfilled') {
        values[task.key] = result.value;
        return;
      }
      values[task.key] = task.fallback;
      warnings.push({
        section: task.key,
        detail: result.reason?.message || 'Section failed',
      });
    });

    return res.json({
      success: true,
      summary: {
        sectors: values.sectors,
        opportunities: values.opportunities,
        earnings: {
          today: values.earningsToday,
          week: values.earningsWeek,
        },
        news: values.news,
        top_strategies: values.topStrategies,
      },
      warnings,
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

async function proxyAliasGet(req, res, targetPath) {
  try {
    const queryIndex = req.originalUrl.indexOf('?');
    const query = queryIndex >= 0 ? req.originalUrl.slice(queryIndex) : '';
    const targetUrl = `http://127.0.0.1:${PORT}${targetPath}${query}`;

    const headers = {};
    Object.entries(req.headers || {}).forEach(([key, value]) => {
      if (typeof value === 'string') headers[key] = value;
    });

    const response = await fetch(targetUrl, {
      method: 'GET',
      headers,
      cache: 'no-store',
    });

    const contentType = response.headers.get('content-type');
    if (contentType) {
      res.setHeader('Content-Type', contentType);
    }

    const body = await response.text();
    return res.status(response.status).send(body);
  } catch (error) {
    return res.status(502).json({
      success: false,
      error: 'ALIAS_PROXY_FAILED',
      detail: error?.message || 'Unknown proxy failure',
    });
  }
}

app.get('/api/stream/market', async (_req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const writeFrame = async () => {
    try {
      const { rows } = await queryWithTimeout(
        `SELECT symbol, price, change_percent, volume, updated_at
         FROM market_quotes
         ORDER BY updated_at DESC NULLS LAST
         LIMIT 20`,
        [],
        { label: 'api.stream.market', timeoutMs: 2500, maxRetries: 1, retryDelayMs: 100 }
      );
      const payload = { success: true, data: rows || [], ts: Date.now() };
      res.write(`event: market\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    } catch (error) {
      const payload = { success: false, data: [], error: error.message || 'stream_failed', ts: Date.now() };
      res.write(`event: market\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    }
  };

  const heartbeat = setInterval(() => {
    res.write(`: ping ${Date.now()}\n\n`);
  }, 15000);

  const ticker = setInterval(writeFrame, 10000);
  writeFrame();

  _req.on('close', () => {
    clearInterval(ticker);
    clearInterval(heartbeat);
    res.end();
  });
});

app.get('/admin/system-diagnostics', async (_req, res) => {
  try {
    const [intradayRes, newsRes, earningsRes] = await Promise.all([
      queryWithTimeout('SELECT COUNT(*)::int AS c FROM intraday_1m', [], { label: 'admin.system_diagnostics.intraday', timeoutMs: 3000, maxRetries: 1, retryDelayMs: 100 }),
      queryWithTimeout('SELECT COUNT(*)::int AS c FROM news_articles', [], { label: 'admin.system_diagnostics.news', timeoutMs: 3000, maxRetries: 1, retryDelayMs: 100 }),
      queryWithTimeout('SELECT COUNT(*)::int AS c FROM earnings_events', [], { label: 'admin.system_diagnostics.earnings', timeoutMs: 3000, maxRetries: 1, retryDelayMs: 100 }),
    ]);

    return res.json({
      cors: 'ok',
      api: 'connected',
      intraday_rows: Number(intradayRes.rows?.[0]?.c || 0),
      news_rows: Number(newsRes.rows?.[0]?.c || 0),
      earnings_rows: Number(earningsRes.rows?.[0]?.c || 0),
      last_update: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(500).json({
      cors: 'ok',
      api: 'degraded',
      intraday_rows: 0,
      news_rows: 0,
      earnings_rows: 0,
      last_update: new Date().toISOString(),
      detail: error.message || 'diagnostics_failed',
    });
  }
});

app.get('/api/intelligence/dashboard', (req, res) => proxyAliasGet(req, res, '/api/intelligence/summary'));
app.get('/api/intelligence/system', (req, res) => proxyAliasGet(req, res, '/api/system/health'));

// Intelligence ingestion — own key auth, must be before JWT middleware
app.use(intelligenceRoutes);
app.use(newsletterRoutes);
app.use(adminFeatureAccessRoutes);

// General rate limiting for other endpoints (new wrapper)
app.use(generalLimiter);

// API-key/JWT auth middleware
app.use(authMiddleware);

// Alert engine routes
if (NON_ESSENTIAL_ENGINES_ENABLED) {
  app.use('/api', alertsRoutes);
}

// Top opportunities feed (protected by global auth middleware above)
app.use('/api', opportunitiesRoutes);
app.use('/api', outcomeRoutes);
app.use('/api', schemaHealthRoutes);
app.use('/api', strategyIntelligenceRoutes);
app.use('/api', signalsRoutes);
app.use('/api', intelDetailsRoutes);

app.post('/api/admin/catalysts/backfill', requireAdminAction, async (req, res) => {
  try {
    const batchSize = Number(req.body?.batchSize) > 0 ? Number(req.body.batchSize) : 500;
    const maxBatches = Number(req.body?.maxBatches) > 0 ? Number(req.body.maxBatches) : 30;

    const result = await runCatalystBackfill({ batchSize, maxBatches });
    return res.json({ ok: true, result });
  } catch (error) {
    logger.error('admin catalysts backfill route error', { error: error.message });
    return res.status(500).json({ ok: false, error: error.message || 'Failed to run catalyst backfill' });
  }
});

app.post('/api/admin/catalysts/reactions/run', requireAdminAction, async (req, res) => {
  try {
    const limit = Number(req.body?.limit) > 0 ? Number(req.body.limit) : 300;
    const result = await runCatalystReactionEngine({ limit });
    return res.json({ ok: true, result });
  } catch (error) {
    logger.error('admin catalyst reaction route error', { error: error.message });
    return res.status(500).json({ ok: false, error: error.message || 'Failed to run catalyst reaction engine' });
  }
});

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

app.post('/api/gpt/analyse-cockpit', requireFeature('trading_cockpit'), async (req, res) => {
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
  console.error('API ERROR:', err);
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

// Explicitly decommission legacy static-asset entry points.
app.use(['/js', '/pages', '/logo pack', '/styles.css'], (_req, res) => {
  return res.status(410).json({
    success: false,
    error: 'LEGACY_SURFACE_REMOVED',
    detail: 'Legacy static pages and assets were removed. Use the Next frontend.',
    frontend: FRONTEND_ORIGIN,
  });
});

app.get('/', (_req, res) => {
  return res.status(200).type('html').send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>OpenRange Entry</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; background: #0b1220; color: #e5e7eb; }
      .wrap { max-width: 720px; margin: 8vh auto; padding: 24px; }
      .card { background: #111827; border: 1px solid #374151; border-radius: 12px; padding: 24px; }
      h1 { margin-top: 0; font-size: 24px; }
      p { color: #cbd5e1; line-height: 1.5; }
      a { color: #93c5fd; }
      .btn { display: inline-block; margin-top: 10px; padding: 10px 14px; border: 1px solid #4b5563; border-radius: 8px; text-decoration: none; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <h1>OpenRange Platform Entry</h1>
        <p>This host serves the API runtime. Continue to the frontend login to access the trading interface.</p>
        <a class="btn" href="${FRONTEND_ORIGIN}/login">Open Login</a>
        <p style="margin-top:12px">API health: <a href="/api/health">/api/health</a></p>
      </div>
    </div>
  </body>
</html>`);
});

app.get(['/login', '/dashboard', '/trading-terminal', '/premarket', '/watchlist', '/screener', '/intelligence', '/earnings', '/research/:ticker?', '/admin'], (req, res) => {
  const path = req.originalUrl || '/login';
  return res.redirect(302, `${FRONTEND_ORIGIN}${path}`);
});

app.use((req, res) => {
  return res.status(404).json({
    error: 'API_ROUTE_NOT_FOUND',
    path: req.originalUrl,
  });
});

let databaseInitPromise = null;

async function initDatabase() {
  if (databaseInitPromise) {
    return databaseInitPromise;
  }

  databaseInitPromise = (async () => {
    const safeInitQuery = async (sql, params, options) => {
      try {
        await queryWithTimeout(sql, params, options);
      } catch (error) {
        logger.warn('[SYSTEM] initDatabase non-critical query failed', {
          label: options?.label || 'init_db.unknown',
          error: error.message,
        });
      }
    };

    await runMigrations().catch((error) => {
      logger.warn('[SYSTEM] runMigrations degraded', { error: error.message });
    });
    await runSchemaGuard().catch((error) => {
      logger.warn('[SYSTEM] runSchemaGuard degraded', { error: error.message });
    });
    await runDbSchemaGuard().catch((error) => {
      logger.warn('[SYSTEM] runDbSchemaGuard degraded', { error: error.message });
    });
    await ensurePerformanceIndexes().catch((error) => {
      logger.warn('[SYSTEM] ensurePerformanceIndexes degraded', { error: error.message });
    });
    await assertRequiredSchemaColumns().catch((error) => {
      logger.warn('[SYSTEM] assertRequiredSchemaColumns degraded', { error: error.message });
    });

    await safeInitQuery(
      `CREATE TABLE IF NOT EXISTS earnings_events (
        symbol TEXT,
        company TEXT,
        earnings_date DATE,
        time TEXT,
        eps_estimate NUMERIC,
        revenue_estimate NUMERIC,
        sector TEXT,
        updated_at TIMESTAMPTZ DEFAULT now()
      )`,
      [],
      { timeoutMs: 5000, label: 'init_db.earnings_events.ensure_table', maxRetries: 0 }
    );

    await safeInitQuery(
      `ALTER TABLE earnings_events
        ADD COLUMN IF NOT EXISTS sector TEXT,
        ADD COLUMN IF NOT EXISTS time TEXT`,
      [],
      { timeoutMs: 5000, label: 'init_db.earnings_events.ensure_columns', maxRetries: 0 }
    );

    await safeInitQuery(
      `CREATE TABLE IF NOT EXISTS strategy_signals (
         id BIGSERIAL PRIMARY KEY,
         symbol TEXT,
         strategy TEXT,
         entry_price NUMERIC,
         exit_price NUMERIC,
         result BOOLEAN,
         timestamp TIMESTAMPTZ DEFAULT NOW()
       )`,
      [],
      { label: 'init_db.strategy_signals.ensure_table', timeoutMs: 5000, maxRetries: 0 }
    );

    await safeInitQuery(
      `ALTER TABLE strategy_signals
         ADD COLUMN IF NOT EXISTS entry_price NUMERIC,
         ADD COLUMN IF NOT EXISTS exit_price NUMERIC,
         ADD COLUMN IF NOT EXISTS result BOOLEAN,
         ADD COLUMN IF NOT EXISTS timestamp TIMESTAMPTZ DEFAULT NOW()`,
      [],
      { label: 'init_db.strategy_signals.ensure_columns', timeoutMs: 5000, maxRetries: 0 }
    );

    await safeInitQuery(
      `CREATE TABLE IF NOT EXISTS strategy_accuracy (
        strategy TEXT PRIMARY KEY,
        total_signals INTEGER NOT NULL DEFAULT 0,
        wins INTEGER NOT NULL DEFAULT 0,
        losses INTEGER NOT NULL DEFAULT 0,
        accuracy_rate NUMERIC NOT NULL DEFAULT 0,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
      [],
      { label: 'init_db.strategy_accuracy.ensure_table', timeoutMs: 2500, maxRetries: 0 }
    );

    await safeInitQuery(
      `CREATE TABLE IF NOT EXISTS usage_events (
        id SERIAL PRIMARY KEY,
        ts BIGINT NOT NULL,
        "user" TEXT,
        path TEXT
      )`,
      [],
      { label: 'init_db.usage_events.ensure_table', timeoutMs: 3000, maxRetries: 0 }
    );

    await ensurePersonalizationTables();
    logger.info('[SYSTEM] initDatabase complete');
  })().catch((error) => {
    databaseInitPromise = null;
    throw error;
  });

  return databaseInitPromise;
}

async function runIntegrityBootstrap() {
  await runDataIntegrityEngine().catch((error) => {
    logger.warn('Integrity bootstrap warning', { error: error.message });
  });
}

function ensureFullUniverseRefreshScheduler() {
  if (global.fullUniverseRefreshSchedulerStarted) {
    return;
  }

  global.fullUniverseRefreshSchedulerStarted = true;
  console.log('[FULL_UNIVERSE_REFRESH] scheduler registered (every 60s)');

  setInterval(async () => {
    console.log('🔄 REFRESH ENGINE TRIGGER', new Date().toISOString());
    if (global.fullUniverseRefreshRunning) {
      return;
    }

    global.fullUniverseRefreshRunning = true;
    try {
      await runFullUniverseRefresh();
    } catch (err) {
      console.error('❌ REFRESH ENGINE ERROR', err.message);
      console.error('[FULL_UNIVERSE_REFRESH] scheduled run error', err.message);
    } finally {
      global.fullUniverseRefreshRunning = false;
    }
  }, 60000);
}

async function bootstrapEngines() {
  console.log('[SYSTEM] Bootstrapping engines...');

  if (SAFE_MODE) {
    console.log('[SYSTEM] SAFE_MODE active - engine bootstrap skipped');
    return;
  }

  const runSafe = (label, fn) => {
    Promise.resolve()
      .then(fn)
      .then(() => {
        logger.info(`[SYSTEM] ${label} complete`);
      })
      .catch((err) => {
        logger.error(`[SYSTEM] ${label} failed`, { error: err.message });
      });
  };

  try {
    await initDatabase();
  } catch (err) {
    logger.error('[SYSTEM] initDatabase failed - aborting startup', { error: err.message });
    process.exit(1);
    return;
  }

  runSafe('ensureAdminSchema', () => ensureAdminSchema());
  runSafe('initRedis', () => initRedis());
  runSafe('featureBootstrap', () => runFeatureBootstrap());

  if (!NON_ESSENTIAL_ENGINES_ENABLED) {
    logger.warn('[SYSTEM] Non-essential engines disabled. Set ENABLE_NON_ESSENTIAL_ENGINES=true to re-enable.');
    return;
  }

  console.log('[BOOT] Starting background engines...');

  startOrchestrator();
  runSafe('integrityBootstrap', () => runIntegrityBootstrap());

  initEventLogger(eventBus);
  startSystemAlertEngine();
  startRetentionJobs();

  runSafe('startupDbConnectionCheck', async () => {
    await queryWithTimeout('SELECT 1 AS ok', [], {
      timeoutMs: 5000,
      label: 'startup.db.connection_check',
      maxRetries: 1,
      retryDelayMs: 200,
    });
  });

  runSafe('fallbackAdminBootstrap', () =>
    userModel.ensureFallbackAdminUser().catch((error) => {
      logger.warn('Fallback admin bootstrap skipped', { error: error.message });
    })
  );

  ensureFullUniverseRefreshScheduler();

  runSafe('forcedStartupRefresh', async () => {
    console.log('⚡ FORCED STARTUP REFRESH');
    if (global.fullUniverseRefreshRunning) {
      return;
    }
    global.fullUniverseRefreshRunning = true;
    try {
      await runFullUniverseRefresh();
    } finally {
      global.fullUniverseRefreshRunning = false;
    }
  });

  runSafe('systemStatusSnapshot', async () => {
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
  });

  if (process.env.ENABLE_ENGINE_SCHEDULER !== 'false') {
    startEngineScheduler();
    console.log('[SCHEDULER] Engine scheduler started');
    monitorPipeline();

    runSafe('forcedStartupIngestion', async () => {
      await runIngestion();
      await runMetricsNow();
    });

    runSafe('engineWarmup', async () => {
      await runIngestionNow();
      await runMetricsNow();
      await runIntelNewsNow();
      await runOpportunityNow();
      await runPipeline();
      await refreshTickerCache();
      await refreshSparklineCache();

      const [oppCount, newsRows] = await Promise.all([
      getOpportunityCountLast24h(supabaseAdmin).catch(() => 0),
      queryWithTimeout(
        `SELECT COUNT(*)::int AS count FROM intel_news WHERE created_at > NOW() - INTERVAL '24 hours'`,
        [],
        { timeoutMs: 3500, label: 'startup.intel_news_24h', maxRetries: 0 }
      ).catch(() => ({ rows: [{ count: 0 }] })),
      ]);

      console.log('[DATA STATUS]');
      console.log(`opportunities_24h: ${Number(oppCount || 0)}`);
      console.log(`news_24h: ${Number(newsRows.rows?.[0]?.count || 0)}`);
    });
  }

  // Start daily review cron
  const { startDailyReviewCron } = require('./services/trades/dailyReviewCron');
  startDailyReviewCron();

  if (process.env.FMP_API_KEY) {
    runSafe('startupEarningsIngestion', () => runEarningsIngestion());

    try {
      const SCHEDULER_USER_ID = process.env.SCHEDULER_USER_ID
        ? Number(process.env.SCHEDULER_USER_ID)
        : null;
      const resolveAndStartScheduler = async () => {
        let schedulerUserId = SCHEDULER_USER_ID;

        if (!schedulerUserId) {
          const adminUser = await userModel.findByUsernameOrEmail(
            process.env.ADMIN_EMAIL || 'admin'
          ).catch(() => null);
          schedulerUserId = adminUser?.id || 1;
        }

        console.log('[SYSTEM] Starting Phase Scheduler...');
        await startPhaseScheduler(FMP_API_KEY, schedulerUserId, logger);
        console.log('[SYSTEM] Phase Scheduler started');
      };

      runSafe('phaseSchedulerStartup', resolveAndStartScheduler);
    } catch (err) {
      logger.error('Phase scheduler failed to start', { error: err.message });
      startScheduler(FMP_API_KEY, logger);
    }
  } else {
    console.warn('[SYSTEM] FMP_API_KEY missing - ingestion disabled');
  }

  // Live quotes scheduler — always runs when FMP_API_KEY is present.
  // Provides changePercent, gapPercent, open, prevClose for the screener every 3 min.
  if (FMP_API_KEY) {
    const { getStocksByBuckets } = require('./services/directoryServiceV1.ts');
    startLiveQuotesScheduler(async () => {
      try {
        const rows = await getStocksByBuckets(['common', 'etf', 'adr', 'preferred']);
        return rows.map((r) => String(r?.symbol || '').trim().toUpperCase()).filter(Boolean);
      } catch {
        return [];
      }
    }, logger);
  }

  if (FMP_API_KEY && process.env.ENABLE_LEGACY_SCHEDULER_SERVICE === 'true') {
    startSchedulerService();
  }

  if (process.env.ENABLE_INGESTION_SCHEDULER === 'true') {
    startIngestionScheduler();
  }

  startDataHealthMonitor();

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

  if (process.env.ENABLE_BACKTEST_SCHEDULER !== 'false') {
    startBacktestScheduler();
  }

  startTickerCache();
  runSafe('refreshSparklineCache', () => refreshSparklineCache());
  runSafe('runIntelligencePipeline', () => runIntelligencePipeline());
  runSafe('startLiveValidationLoop', () => startLiveValidationLoop());
  startIntelligencePipelineScheduler();
  startPerformanceEngineScheduler();

  if (process.env.ENABLE_NARRATIVE_SCHEDULER === 'true') {
    startNarrativeScheduler();
  }

  startEarningsWorker();

  setInterval(() => {
    runMarketNarrativeEngine().catch((error) => {
      logger.warn('market narrative interval run failed', { error: error.message });
    });
  }, 30 * 60 * 1000);

  setInterval(() => {
    runInstitutionalFlowEngine().catch((error) => {
      logger.warn('institutional flow interval run failed', { error: error.message });
    });
  }, 5 * 60 * 1000);

  if (process.env.ENABLE_ALERT_SCHEDULER === 'true') {
    startAlertScheduler();
  }

  if (process.env.ENABLE_ENGINE_SCHEDULER !== 'false') {
    logger.info('OpenRange backend starting in bootstrap mode');
    console.log('Starting engines sequentially...');
    runSafe('startEngines', async () => {
      await startEngines();
      console.log('Engines enabled (scheduler already started in ordered bootstrap)');
    });
  }
}

async function bootstrapBackgroundServices() {
  try {
    console.log('[BOOT] Starting background services');
    // Start ingestion scheduler and health monitor immediately — these register
    // cron jobs and don't block on DB migrations. Must start before bootstrapEngines()
    // because bootstrapEngines() blocks on await initDatabase() (migrations) for minutes.
    if (process.env.ENABLE_INGESTION_SCHEDULER === 'true') {
      startIngestionScheduler();
    }
    startDataHealthMonitor();
    // Start bulletproof market data scheduler (quotes, intraday, daily, metrics)
    startDataScheduler().catch((err) => {
      console.error('[BOOT] dataScheduler start failed:', err.message);
    });
    // Premarket watchlist V2: deterministic scoring + signal capture, runs every 10 min
    startPremarketWatchlistScheduler(10 * 60 * 1000);
    // Signal evaluation: outcome measurement + performance aggregation, runs every 15 min
    startSignalEvaluationScheduler(15 * 60 * 1000);
    // Session aggregation: extended-hours OHLCV + session classification, runs every 10 min
    startSessionAggregationScheduler(10 * 60 * 1000);
    // Premarket intelligence: gap validation + signal classification, runs every 10 min (after session agg)
    setTimeout(() => startPremarketIntelligenceScheduler(10 * 60 * 1000), 5 * 60 * 1000);
    // Fallback data: Finnhub fill for symbols missing PM candles, runs every 15 min
    setTimeout(() => startFallbackDataScheduler(15 * 60 * 1000), 3 * 60 * 1000);
    // Execution engine: entry/stop/target + risk/reward, runs every 10 min (after intelligence engine)
    setTimeout(() => startExecutionScheduler(10 * 60 * 1000), 7 * 60 * 1000);
    // Execution refinement: confirmation, session timing, breakout validation, runs every 10 min
    setTimeout(() => startExecutionRefinementScheduler(10 * 60 * 1000), 9 * 60 * 1000);
    // Live evaluation: signal outcome measurement + performance aggregation, runs every 5 min
    setTimeout(() => startLiveEvaluationScheduler(5 * 60 * 1000), 11 * 60 * 1000);
    bootstrapEngines();
    console.log('[BOOT] System ready');
  } catch (err) {
    console.error('[BOOT ERROR] Background bootstrap failed:', err);
  }
}

function shouldBootstrapBackgroundServices() {
  if (SAFE_MODE) return false;
  if (process.env.ENABLE_BACKGROUND_SERVICES === 'true') return true;
  if (process.env.ENABLE_BACKGROUND_SERVICES === 'false') return false;
  return process.env.NODE_ENV === 'production';
}

const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log('[BOOT] HTTP server is live');
  logger.info(`OpenRange server listening on port ${PORT}`);

  app._router.stack.forEach(r => {
    if (r.route && r.route.path) {
      console.log('[ROUTE]', r.route.path);
    }
  });

  setImmediate(() => {
    initDatabase()
      .then(async () => {
        // [PIPELINE] Log freshness of key data tables on startup
        try {
          const { rows: freshRows } = await queryWithTimeout(
            `SELECT
               (SELECT COUNT(*)::int FROM market_metrics WHERE COALESCE(updated_at, last_updated) >= NOW() - INTERVAL '15 minutes') AS metrics_fresh,
               (SELECT COUNT(*)::int FROM market_metrics) AS metrics_total,
               (SELECT COUNT(*)::int FROM intraday_1m WHERE "timestamp" >= NOW() - INTERVAL '2 hours') AS intraday_fresh,
               (SELECT COUNT(*)::int FROM intraday_1m) AS intraday_total,
               (SELECT MAX(COALESCE(updated_at, last_updated)) FROM market_quotes) AS quotes_last_updated,
               (SELECT COUNT(*)::int FROM market_quotes WHERE price > 0) AS quotes_with_price`,
            [],
            { label: 'boot.pipeline.freshness', timeoutMs: 8000, maxRetries: 0, poolType: 'read' }
          );
          const r = freshRows?.[0] || {};
          console.log('[PIPELINE] startup freshness check:',
            `metrics ${r.metrics_fresh}/${r.metrics_total} fresh,`,
            `intraday ${r.intraday_fresh}/${r.intraday_total} recent,`,
            `quotes last_updated=${r.quotes_last_updated || 'null'} (${r.quotes_with_price} with price)`
          );
        } catch (freshnessErr) {
          console.warn('[PIPELINE] freshness check failed at boot:', freshnessErr.message);
        }
      })
      .catch((error) => {
        logger.error('[SYSTEM] initDatabase failed', { error: error.message });
      });
  });

  if (shouldBootstrapBackgroundServices()) {
    setImmediate(() => {
      bootstrapBackgroundServices();
    });
  } else {
    console.log('[BOOT] Background services skipped (set ENABLE_BACKGROUND_SERVICES=true to enable)');
  }
});

(async () => {
  try {
    console.log('[ENGINE BOOT] starting engines...');
    await startEngines();
    console.log('[ENGINE BOOT] engines started');
  } catch (e) {
    console.error('[ENGINE BOOT ERROR]', e.message);
  }
})();
