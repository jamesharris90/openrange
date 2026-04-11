// @ts-nocheck
const express = require('express');
const axios = require('axios');
const YahooFinance = require('yahoo-finance2').default;
const fs = require('fs/promises');
const path = require('path');
const pool = require('../pg');
const { queryWithTimeout } = require('../db/pg');
const { getChartMarketData, computeEMA, computeRSI, computeATR } = require('../services/marketDataEngineV1.ts');
const { enrichWithIntraday } = require('../services/intradayEnrichmentService.ts');
const { detectStructures } = require('../services/strategyDetectionEngineV1.ts');
const { applyDepthPolicy } = require('../utils/candleDepthPolicy.ts');
const { getMarketSession } = require('../utils/marketSession');
const logger = require('../logger');

const router = express.Router();
const yahooFinance = new YahooFinance();
const candleCache = new Map();
const responseCache = new Map();
const cacheRefreshInFlight = new Map();
const FMP_NEWS_URL = 'https://financialmodelingprep.com/stable/news/stock-latest';
const DRAWINGS_STORE_PATH = path.join(__dirname, '..', 'data', 'chart-drawings.json');

// ─────────────────────────────────────────────────────────────────────────────
// Supabase DB readers
// ─────────────────────────────────────────────────────────────────────────────

async function readDailyFromDB(symbol) {
  try {
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 2);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const { rows } = await queryWithTimeout(
      `SELECT date::text AS d, open, high, low, close, volume
       FROM daily_ohlc
       WHERE symbol = $1 AND date >= $2
       ORDER BY date ASC`,
      [symbol, cutoffStr],
      { timeoutMs: 8000, label: `chart_v5.daily.${symbol}`, maxRetries: 0 },
    );
    return rows.map((r) => ({
      time: Math.floor(new Date(r.d + 'T00:00:00Z').getTime() / 1000),
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Number(r.volume),
    }));
  } catch (_err) {
    return [];
  }
}

async function readIntraday1mFromDB(symbol) {
  try {
    const cutoff = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const { rows } = await queryWithTimeout(
      `SELECT EXTRACT(EPOCH FROM "timestamp")::bigint AS ts_unix,
              open, high, low, close, volume
       FROM intraday_1m
       WHERE symbol = $1 AND "timestamp" >= $2
       ORDER BY "timestamp" ASC`,
      [symbol, cutoff],
      { timeoutMs: 8000, label: `chart_v5.intraday.${symbol}`, maxRetries: 0 },
    );
    return rows.map((r) => ({
      time: Number(r.ts_unix),
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Number(r.volume),
    }));
  } catch (_err) {
    return [];
  }
}

async function readClosedSessionDailyFallback(symbol) {
  try {
    const { rows } = await queryWithTimeout(
      `SELECT date::text AS d, open, high, low, close, volume
       FROM (
         SELECT *
         FROM daily_ohlcv
         WHERE symbol = $1
         ORDER BY date DESC
         LIMIT 30
       ) recent_daily
       ORDER BY date ASC`,
      [symbol],
      { timeoutMs: 5000, label: `chart_v5.closed_fallback.${symbol}`, maxRetries: 0 },
    );
    return rows.map((r) => ({
      time: Math.floor(new Date(r.d + 'T00:00:00Z').getTime() / 1000),
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Number(r.volume),
    }));
  } catch (_err) {
    return [];
  }
}

function hasRecentIntradayData(candles) {
  if (!Array.isArray(candles) || candles.length === 0) {
    return false;
  }

  const latestTime = Number(candles[candles.length - 1]?.time);
  if (!Number.isFinite(latestTime)) {
    return false;
  }

  return ((Date.now() / 1000) - latestTime) <= (18 * 60 * 60);
}

// ─────────────────────────────────────────────────────────────────────────────
// Aggregation helpers (mirrors intradayEnrichmentService logic)
// ─────────────────────────────────────────────────────────────────────────────

function aggregateCandlesDB(candles1m, minutes) {
  if (!Array.isArray(candles1m) || !candles1m.length || minutes <= 1) return candles1m;
  const bucketSec = minutes * 60;
  const buckets = new Map();
  for (const c of candles1m) {
    const bucket = Math.floor(c.time / bucketSec) * bucketSec;
    const ex = buckets.get(bucket);
    if (!ex) {
      buckets.set(bucket, { time: bucket, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume });
    } else {
      ex.high = Math.max(ex.high, c.high);
      ex.low = Math.min(ex.low, c.low);
      ex.close = c.close;
      ex.volume += Number.isFinite(c.volume) ? c.volume : 0;
    }
  }
  return Array.from(buckets.values()).sort((a, b) => a.time - b.time);
}

function computeVWAPDB(candles1m) {
  const out = [];
  let cumPV = 0;
  let cumVol = 0;
  let lastDate = null;
  for (const c of candles1m) {
    // Reset VWAP at start of each trading day (midnight UTC boundary)
    const date = new Date(c.time * 1000).toISOString().slice(0, 10);
    if (date !== lastDate) {
      cumPV = 0;
      cumVol = 0;
      lastDate = date;
    }
    const typical = (c.high + c.low + c.close) / 3;
    const vol = Number.isFinite(c.volume) ? c.volume : 0;
    cumPV += typical * vol;
    cumVol += vol;
    if (cumVol > 0) out.push({ time: c.time, value: cumPV / cumVol });
  }
  return out;
}

function computeORHDB(candles1m) {
  // Opening range high: first 15 bars of today's session
  if (!candles1m.length) return null;
  const today = new Date().toISOString().slice(0, 10);
  const todayBars = candles1m.filter((c) => {
    return new Date(c.time * 1000).toISOString().slice(0, 10) === today;
  });
  const window = todayBars.slice(0, Math.min(15, todayBars.length));
  return window.length ? Math.max(...window.map((c) => c.high)) : null;
}

function computeRvolDB(candles1m) {
  if (!candles1m.length) return null;
  const current = Number(candles1m[candles1m.length - 1]?.volume || 0);
  const prior = candles1m.slice(-31, -1).map((c) => Number(c.volume || 0)).filter((v) => Number.isFinite(v));
  if (!prior.length) return null;
  const avg = prior.reduce((s, v) => s + v, 0) / prior.length;
  return avg > 0 ? current / avg : null;
}

function normalizeInterval(value) {
  const raw = String(value || '1min').toLowerCase();
  if (raw === '1week') return '1week';
  if (raw === '1day') return '1day';
  if (raw === '4hour') return '4hour';
  if (raw === '1hour') return '1hour';
  if (raw === '15min') return '15min';
  if (raw === '3min') return '3min';
  if (raw === '5min') return '5min';
  return '1min';
}

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const MAX_SERIES_JUMP_RATIO = 3;
const MIN_SERIES_JUMP_RATIO = 1 / MAX_SERIES_JUMP_RATIO;

function sanitizeSeries(data, options = {}) {
  const type = options.type === 'candle' ? 'candle' : 'line';
  const allowNegative = options.allowNegative === true;
  const sorted = Array.isArray(data)
    ? [...data].sort((left, right) => Number(left?.time || 0) - Number(right?.time || 0))
    : [];
  const deduped = new Map();

  for (const row of sorted) {
    const time = Number(row?.time);
    if (!Number.isFinite(time)) {
      continue;
    }

    if (type === 'candle') {
      const open = Number(row?.open ?? row?.close);
      const high = Number(row?.high ?? row?.close);
      const low = Number(row?.low ?? row?.close);
      const close = Number(row?.close);
      const volume = Number(row?.volume ?? 0);

      if (![open, high, low, close].every(Number.isFinite) || close <= 0) {
        continue;
      }

      const normalized = {
        time,
        open,
        high: Math.max(high, open, close),
        low: Math.min(low, open, close),
        close,
        volume: Number.isFinite(volume) && volume > 0 ? volume : 0,
      };

      const previous = deduped.size > 0 ? Array.from(deduped.values())[deduped.size - 1] : null;
      const reference = Number(previous?.close);
      if (Number.isFinite(reference) && reference > 0) {
        const highRatio = normalized.high / reference;
        const lowRatio = normalized.low / reference;
        if (highRatio > MAX_SERIES_JUMP_RATIO || lowRatio < MIN_SERIES_JUMP_RATIO) {
          continue;
        }
      }

      deduped.set(time, normalized);
      continue;
    }

    const value = Number(row?.value);
    if (!Number.isFinite(value) || (!allowNegative && value <= 0)) {
      continue;
    }

    const previous = deduped.size > 0 ? Array.from(deduped.values())[deduped.size - 1] : null;
    const reference = Number(previous?.value);
    if (!allowNegative && Number.isFinite(reference) && reference > 0) {
      const ratio = value / reference;
      if (ratio > MAX_SERIES_JUMP_RATIO || ratio < MIN_SERIES_JUMP_RATIO) {
        continue;
      }
    }

    deduped.set(time, { time, value });
  }

  return Array.from(deduped.values());
}

function computeAtrPercentSeries(candles, atrSeries) {
  if (!Array.isArray(candles) || !Array.isArray(atrSeries) || !atrSeries.length) return [];
  const byTime = new Map(candles.map((c) => [c.time, c]));
  return atrSeries
    .map((point) => {
      const candle = byTime.get(point.time);
      const close = toNum(candle?.close);
      const atr = toNum(point?.value);
      if (!Number.isFinite(close) || close <= 0 || !Number.isFinite(atr)) return null;
      return { time: point.time, value: (atr / close) * 100 };
    })
    .filter(Boolean);
}

function computeMACD(candles) {
  if (!Array.isArray(candles) || candles.length < 35) {
    return { macd: [], macdSignal: [], macdHistogram: [] };
  }

  const closes = candles.map((row) => Number(row?.close)).filter((value) => Number.isFinite(value));
  if (closes.length < 35 || closes.length !== candles.length) {
    return { macd: [], macdSignal: [], macdHistogram: [] };
  }

  const ema12 = computeEMA(candles, 12);
  const ema26 = computeEMA(candles, 26);
  const map26 = new Map((Array.isArray(ema26) ? ema26 : []).map((point) => [point.time, Number(point.value)]));

  const macd = (Array.isArray(ema12) ? ema12 : [])
    .map((point) => {
      const fast = Number(point?.value);
      const slow = Number(map26.get(point?.time));
      if (!Number.isFinite(fast) || !Number.isFinite(slow)) return null;
      return { time: point.time, value: fast - slow };
    })
    .filter(Boolean);

  if (!macd.length) {
    return { macd: [], macdSignal: [], macdHistogram: [] };
  }

  const macdCandles = macd.map((point) => ({
    time: point.time,
    open: point.value,
    high: point.value,
    low: point.value,
    close: point.value,
    volume: 0,
  }));

  const macdSignal = computeEMA(macdCandles, 9);
  const signalMap = new Map((Array.isArray(macdSignal) ? macdSignal : []).map((point) => [point.time, Number(point.value)]));
  const macdHistogram = macd
    .map((point) => {
      const signal = Number(signalMap.get(point.time));
      if (!Number.isFinite(signal)) return null;
      return { time: point.time, value: Number(point.value) - signal };
    })
    .filter(Boolean);

  return { macd, macdSignal: Array.isArray(macdSignal) ? macdSignal : [], macdHistogram };
}

function emptyStrategyPayload() {
  return {
    structures: [],
    primaryStructure: null,
    score: 0,
    invalidation: null,
    structureScore: 0,
    volumeScore: 0,
    volatilityScore: 0,
    trendScore: 0,
  };
}

function getCacheTtlMs(interval) {
  if (interval === '1day' || interval === '1week') return 5 * 60 * 1000;
  if (interval === '4hour') return 60 * 1000;
  return 30 * 1000;
}

function isIntradayInterval(interval) {
  return interval === '1min' || interval === '3min' || interval === '5min' || interval === '15min' || interval === '1hour';
}

async function readDrawingsStore() {
  try {
    const raw = await fs.readFile(DRAWINGS_STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
}

async function writeDrawingsStore(store) {
  await fs.mkdir(path.dirname(DRAWINGS_STORE_PATH), { recursive: true });
  await fs.writeFile(DRAWINGS_STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
}

function normalizeEventTime(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric > 10_000_000_000 ? Math.floor(numeric / 1000) : Math.floor(numeric);
  const parsed = Date.parse(String(value || ''));
  if (!Number.isFinite(parsed)) return null;
  return Math.floor(parsed / 1000);
}

function normalizeReportDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const directMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (directMatch) return raw;
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

function toBusinessDayFromReportDate(reportDate) {
  const [year, month, day] = String(reportDate || '').split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  return { year, month, day };
}

async function fetchEventsForSymbol(symbol) {
  // ── News: DB first, FMP fallback ───────────────────────────────────────────
  let normalizedNews = [];
  try {
    const cutoffIso = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    const { rows } = await pool.query(
      `SELECT headline AS title, source, url,
              EXTRACT(EPOCH FROM published_at)::bigint AS published_unix
       FROM news_events
       WHERE symbol = $1 AND published_at >= $2
       ORDER BY published_at DESC
       LIMIT 20`,
      [symbol, cutoffIso],
    );
    normalizedNews = rows
      .map((item) => {
        const time = Number(item.published_unix);
        if (!Number.isFinite(time)) return null;
        return {
          type: 'news',
          time,
          symbol,
          title: String(item.title || '').trim() || `${symbol} headline`,
          url: item.url || null,
          source: String(item.source || 'News').trim(),
        };
      })
      .filter(Boolean);
  } catch (_err) { /* fall through to FMP */ }

  if (normalizedNews.length === 0) {
    // FMP fallback
    try {
      const fmpResult = await axios.get(FMP_NEWS_URL, {
        params: { symbols: symbol, limit: 10, apikey: process.env.FMP_API_KEY },
        timeout: 15000,
        validateStatus: () => true,
      });
      const fmpNews = fmpResult.status >= 200 && fmpResult.status < 300 && Array.isArray(fmpResult.data)
        ? fmpResult.data
        : [];
      normalizedNews = fmpNews
        .map((item) => {
          const time = normalizeEventTime(item?.publishedDate || item?.published_at || item?.date);
          if (!Number.isFinite(time)) return null;
          return {
            type: 'news',
            time,
            symbol,
            title: String(item?.title || '').trim() || `${symbol} headline`,
            url: item?.url || null,
            source: String(item?.site || item?.source || 'News').trim(),
          };
        })
        .filter(Boolean);
    } catch (_err) { /* silent */ }
  }

  // ── Earnings: DB first, Yahoo fallback ────────────────────────────────────
  let earnings = [];
  try {
    const { rows } = await pool.query(
      `SELECT report_date, eps_estimate, eps_actual, rev_estimate, rev_actual
       FROM earnings_events
       WHERE symbol = $1
       ORDER BY report_date DESC
       LIMIT 15`,
      [symbol],
    );
    earnings = rows
      .map((item) => {
        const reportDate = normalizeReportDate(item.report_date);
        if (!reportDate) return null;
        const time = toBusinessDayFromReportDate(reportDate);
        if (!time) return null;
        return {
          report_date: reportDate,
          time,
          type: 'earnings',
          symbol,
          title: `${symbol} Earnings`,
          url: null,
          epsActual: toNum(item.eps_actual),
          epsEstimate: toNum(item.eps_estimate),
          revenueActual: toNum(item.rev_actual),
          revenueEstimate: toNum(item.rev_estimate),
        };
      })
      .filter(Boolean)
      .sort((a, b) => String(a.report_date).localeCompare(String(b.report_date)));
  } catch (_err) { /* fall through to Yahoo */ }

  if (earnings.length === 0) {
    // Yahoo fallback
    try {
      const summary = await yahooFinance.quoteSummary(symbol, { modules: ['calendarEvents', 'earningsHistory'] });
      const earningsHistory = Array.isArray(summary?.earningsHistory?.history) ? summary.earningsHistory.history : [];
      const historicalEarnings = earningsHistory
        .map((item) => {
          const reportDate = normalizeReportDate(item?.quarter || item?.period || item?.date);
          if (!reportDate) return null;
          const time = toBusinessDayFromReportDate(reportDate);
          if (!time) return null;
          return {
            report_date: reportDate,
            time,
            type: 'earnings',
            symbol,
            title: `${symbol} Earnings`,
            url: null,
            epsActual: Number.isFinite(Number(item?.epsActual)) ? Number(item.epsActual) : null,
            epsEstimate: Number.isFinite(Number(item?.epsEstimate)) ? Number(item.epsEstimate) : null,
            revenueActual: Number.isFinite(Number(item?.revenueActual)) ? Number(item.revenueActual) : null,
            revenueEstimate: Number.isFinite(Number(item?.revenueEstimate)) ? Number(item.revenueEstimate) : null,
          };
        })
        .filter(Boolean);

      const earningsDate = summary?.calendarEvents?.earnings?.earningsDate?.[0] || null;
      const reportDate = normalizeReportDate(earningsDate);
      const upcomingTime = reportDate ? toBusinessDayFromReportDate(reportDate) : null;
      const upcomingEarnings = reportDate && upcomingTime
        ? [{
          report_date: reportDate,
          time: upcomingTime,
          type: 'earnings',
          symbol,
          title: `${symbol} Earnings`,
          url: null,
          epsActual: null,
          epsEstimate: Number.isFinite(Number(summary?.calendarEvents?.earnings?.earningsAverage))
            ? Number(summary.calendarEvents.earnings.earningsAverage)
            : null,
          revenueActual: null,
          revenueEstimate: Number.isFinite(Number(summary?.calendarEvents?.earnings?.revenueAverage))
            ? Number(summary.calendarEvents.earnings.revenueAverage)
            : null,
        }]
        : [];

      const earningsByTime = new Map();
      [...historicalEarnings, ...upcomingEarnings].forEach((event) => {
        earningsByTime.set(`${event.type}|${event.report_date}`, event);
      });
      earnings = Array.from(earningsByTime.values())
        .sort((a, b) => String(a.report_date).localeCompare(String(b.report_date)));
    } catch (_err) { /* silent */ }
  }

  return { earnings, news: normalizedNews };
}

function filterEventsPayloadByTimeDomain(payload, options = {}) {
  const nowUnix = Math.floor(Date.now() / 1000);
  const nowDate = new Date(nowUnix * 1000).toISOString().slice(0, 10);
  const from = Number(options?.from);
  const to = Number(options?.to);
  const hasRange = Number.isFinite(from) && Number.isFinite(to);
  const fromDate = hasRange ? new Date(from * 1000).toISOString().slice(0, 10) : null;
  const toDate = hasRange ? new Date(to * 1000).toISOString().slice(0, 10) : null;

  const earnings = Array.isArray(payload?.earnings) ? payload.earnings : [];
  const news = Array.isArray(payload?.news) ? payload.news : [];

  let events = [...earnings, ...news]
    .filter((event) => {
      if (String(event?.type) === 'earnings') {
        const reportDate = normalizeReportDate(event?.report_date);
        return Boolean(reportDate) && String(reportDate) <= nowDate;
      }
      return true;
    });

  if (hasRange) {
    events = events.filter((event) => {
      if (String(event?.type) === 'earnings') {
        const reportDate = normalizeReportDate(event?.report_date);
        return Boolean(reportDate) && String(reportDate) >= String(fromDate) && String(reportDate) <= String(toDate);
      }
      const time = Number(event?.time);
      return Number.isFinite(time) && time >= from && time <= to;
    });
  }

  return {
    earnings: events.filter((event) => String(event?.type) === 'earnings'),
    news: events.filter((event) => String(event?.type) !== 'earnings'),
  };
}

router.get('/news', async (req, res) => {
  try {
    const symbol = String(req.query.symbol || '').trim().toUpperCase();
    if (!symbol) {
      return res.status(400).json({ error: 'symbol required' });
    }

    const cutoffIso = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
    const result = await pool.query(
      `
        SELECT *
        FROM news_events
        WHERE symbol = $1
          AND published_at >= $2
        ORDER BY published_at DESC
        LIMIT 100
      `,
      [symbol, cutoffIso],
    );

    const data = Array.isArray(result?.rows) ? result.rows : [];
    console.log('[NEWS_ROUTE]', symbol, data?.length);
    return res.json(data);
  } catch (error) {
    console.error('[NEWS_ROUTE_ERROR]', error);
    return res.status(500).json({ error: 'news fetch failed' });
  }
});

router.get('/search', async (req, res) => {
  const query = String(req.query.q || '').trim();
  const rawLimit = Number.parseInt(String(req.query.limit || ''), 10);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 25) : 10;

  if (!query) return res.json([]);
  if (query.length > 64) {
    return res.status(400).json({ error: 'INVALID_QUERY', message: 'q must be 1-64 characters' });
  }

  try {
    const upperQuery = query.toUpperCase();
    const searchResult = await yahooFinance.search(query, {
      quotesCount: Math.max(limit * 3, 15),
      newsCount: 0,
      enableFuzzyQuery: false,
    });

    const isUsListedEquity = (item) => {
      const quoteType = String(item?.quoteType || '').toUpperCase();
      const symbol = String(item?.symbol || '').toUpperCase();
      const exchange = String(item?.exchange || '').toUpperCase();
      const fullExchangeName = String(item?.fullExchangeName || '').toUpperCase();
      const exchangeDisp = String(item?.exchangeDisp || '').toUpperCase();

      if (quoteType !== 'EQUITY') return false;
      if (!symbol) return false;

      if (symbol.includes('-USD') || symbol.includes('/USD') || symbol.endsWith('USD')) return false;
      if (symbol.includes('=X') || symbol.includes('^')) return false;

      const otcHints = ['OTC', 'PNK', 'PINK', 'GREY'];
      if (otcHints.some((hint) => exchange.includes(hint) || fullExchangeName.includes(hint) || exchangeDisp.includes(hint))) {
        return false;
      }

      const usExchangeCodes = new Set(['NMS', 'NGM', 'NCM', 'NAS', 'NYQ', 'ASE', 'PCX', 'BTS', 'NYS']);
      const isUsByCode = usExchangeCodes.has(exchange);
      const isUsByName = fullExchangeName.includes('NASDAQ')
        || fullExchangeName.includes('NEW YORK')
        || exchangeDisp.includes('NASDAQ')
        || exchangeDisp.includes('NYSE');

      if (!isUsByCode && !isUsByName) return false;

      if (item?.isYahooFinance === false) return false;

      return true;
    };

    const rows = Array.isArray(searchResult?.quotes) ? searchResult.quotes : [];
    const seen = new Set();

    const normalized = rows
      .filter((item) => item?.symbol)
      .filter((item) => isUsListedEquity(item))
      .map((item) => {
        const symbol = String(item.symbol || '').trim().toUpperCase();
        const name = String(item.shortname || item.longname || '').trim();
        const exchange = String(item.exchange || item.fullExchangeName || '').trim();
        const marketCap = Number(item.marketCap);
        const nameLower = name.toLowerCase();
        const queryLower = query.toLowerCase();

        if (!symbol || seen.has(symbol)) return null;
        seen.add(symbol);

        let rank = 99;
        if (symbol === upperQuery) rank = 0;
        else if (symbol.startsWith(upperQuery)) rank = 1;
        else if (nameLower.startsWith(queryLower)) rank = 2;
        else if (nameLower.includes(queryLower)) rank = 3;

        return {
          symbol,
          name,
          exchange,
          marketCap: Number.isFinite(marketCap) ? marketCap : null,
          rank,
        };
      })
      .filter(Boolean)
      .sort((left, right) => {
        if (left.rank !== right.rank) return left.rank - right.rank;
        const leftCap = Number.isFinite(Number(left.marketCap)) ? Number(left.marketCap) : 0;
        const rightCap = Number.isFinite(Number(right.marketCap)) ? Number(right.marketCap) : 0;
        if (rightCap !== leftCap) return rightCap - leftCap;
        return String(left.symbol).localeCompare(String(right.symbol));
      })
      .slice(0, limit)
      .map(({ symbol, name, exchange, marketCap }) => ({ symbol, name, exchange, marketCap }));

    return res.json(normalized);
  } catch (error) {
    logger.error('Chart search failed', {
      method: req.method,
      path: req.originalUrl,
      requestId: req.requestId,
      error: error?.message,
      stack: error?.stack,
      upstreamStatus: error?.response?.status,
    });
    return res.status(502).json({
      error: 'UPSTREAM_SEARCH_FAILED',
      message: 'Failed to fetch symbol search results from provider',
      requestId: req.requestId,
      detail: error?.message || 'Unknown upstream error',
    });
  }
});

router.get('/events', async (req, res) => {
  try {
    const symbol = String(req.query.symbol || '').trim().toUpperCase();
    if (!symbol) return res.status(400).json({ error: 'symbol is required' });
    const payload = await fetchEventsForSymbol(symbol);
    const filteredPayload = filterEventsPayloadByTimeDomain(payload, {
      from: req.query.from,
      to: req.query.to,
    });
    return res.json(filteredPayload);
  } catch (error) {
    return res.status(502).json({ error: 'Events fetch failed', detail: error?.message || 'Unknown error' });
  }
});

router.get('/drawings', async (req, res) => {
  try {
    const symbol = String(req.query.symbol || '').trim().toUpperCase();
    const timeframe = String(req.query.timeframe || '').trim();
    if (!symbol || !timeframe) {
      return res.status(400).json({ error: 'symbol and timeframe are required' });
    }

    const store = await readDrawingsStore();
    const key = `${symbol}|${timeframe}`;
    const rows = Array.isArray(store[key]) ? store[key] : [];
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ error: 'Failed to load drawings', detail: error?.message || 'Unknown error' });
  }
});

router.put('/drawings', async (req, res) => {
  try {
    const symbol = String(req.body?.symbol || '').trim().toUpperCase();
    const timeframe = String(req.body?.timeframe || '').trim();
    const drawings = Array.isArray(req.body?.drawings) ? req.body.drawings : [];

    if (!symbol || !timeframe) {
      return res.status(400).json({ error: 'symbol and timeframe are required' });
    }

    const sanitized = drawings
      .map((item, index) => ({
        id: String(item?.id || `${symbol}-${timeframe}-${index}`),
        type: String(item?.type || 'hline'),
        price: Number(item?.price),
        label: String(item?.label || '').trim() || 'Line',
      }))
      .filter((item) => Number.isFinite(item.price));

    const store = await readDrawingsStore();
    const key = `${symbol}|${timeframe}`;
    store[key] = sanitized;
    await writeDrawingsStore(store);

    return res.json({ ok: true, count: sanitized.length });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to save drawings', detail: error?.message || 'Unknown error' });
  }
});

async function loadRawPayload(symbol, interval) {
  const needsIntraday = interval !== '1day' && interval !== '1week';
  const marketSession = getMarketSession();

  // ── DB-first path ───────────────────────────────────────────────────────────
  const [dbDaily, dbIntraday1m] = await Promise.all([
    readDailyFromDB(symbol),
    needsIntraday ? readIntraday1mFromDB(symbol) : Promise.resolve([]),
  ]);

  if (dbDaily.length > 0) {
    const intradayFallback = needsIntraday && marketSession === 'CLOSED' && !hasRecentIntradayData(dbIntraday1m)
      ? await readClosedSessionDailyFallback(symbol)
      : [];
    const intradaySeries = dbIntraday1m.length > 0 ? dbIntraday1m : intradayFallback;
    const intraday1m  = sanitizeSeries(intradaySeries, { type: 'candle' });
    const intraday3m  = sanitizeSeries(aggregateCandlesDB(intraday1m, 3), { type: 'candle' });
    const intraday5m  = sanitizeSeries(aggregateCandlesDB(intraday1m, 5), { type: 'candle' });
    const intraday15m = sanitizeSeries(aggregateCandlesDB(intraday1m, 15), { type: 'candle' });
    const intraday1h  = sanitizeSeries(aggregateCandlesDB(intraday1m, 60), { type: 'candle' });
    const intraday4h  = sanitizeSeries(aggregateCandlesDB(intraday1m, 240), { type: 'candle' });
    const vwap        = sanitizeSeries(computeVWAPDB(intraday1m), { type: 'line' });
    const orh         = computeORHDB(intraday1m);
    const relativeVolume = computeRvolDB(intraday1m);
    const sessionMinute  = intraday1m.length ? Math.min(intraday1m.length, 390) : 0;

    const dailyCandles = sanitizeSeries(dbDaily, { type: 'candle' });

    // Weekly candles: aggregate daily by ISO week
    const weekly = (() => {
      const buckets = new Map();
      for (const c of dailyCandles) {
        const d = new Date(c.time * 1000);
        const day = d.getUTCDay();
        const monday = new Date(d);
        monday.setUTCDate(d.getUTCDate() - ((day + 6) % 7));
        monday.setUTCHours(0, 0, 0, 0);
        const bucket = Math.floor(monday.getTime() / 1000);
        const ex = buckets.get(bucket);
        if (!ex) {
          buckets.set(bucket, { time: bucket, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume });
        } else {
          ex.high = Math.max(ex.high, c.high);
          ex.low = Math.min(ex.low, c.low);
          ex.close = c.close;
          ex.volume += c.volume;
        }
      }
      return sanitizeSeries(Array.from(buckets.values()).sort((a, b) => a.time - b.time), { type: 'candle' });
    })();

    const rawCandles = interval === '1week'
      ? weekly
      : interval === '1day'
        ? dailyCandles
        : interval === '4hour'
          ? intraday4h
          : interval === '1hour'
            ? intraday1h
            : interval === '15min'
              ? intraday15m
              : interval === '5min'
                ? intraday5m
                : interval === '3min'
                  ? intraday3m
                  : intraday1m;

    const candles = sanitizeSeries(applyDepthPolicy(rawCandles, interval), { type: 'candle' });

    return {
      market: { dailyCandles, metrics: { avgVolume: null } },
      intraday: { intraday1m, vwap, orh, relativeVolume, sessionMinute },
      intraday1m,
      intraday3m,
      intraday5m,
      intraday15m,
      intraday1h,
      intraday4h,
      dailyCandles,
      candles,
    };
  }

  // ── FMP fallback (DB empty — pre-ingestion or symbol not in universe) ───────
  const market = await getChartMarketData(symbol, '1day', { skipIntraday: true });
  const intraday = await enrichWithIntraday(symbol);

  const intraday1m = sanitizeSeries(Array.isArray(intraday?.intraday1m) ? intraday.intraday1m : [], { type: 'candle' });
  const intraday3m = sanitizeSeries(Array.isArray(intraday?.intraday3m) ? intraday.intraday3m : [], { type: 'candle' });
  const intraday5m = sanitizeSeries(Array.isArray(intraday?.intraday5m) ? intraday.intraday5m : [], { type: 'candle' });
  const intraday15m = sanitizeSeries(Array.isArray(intraday?.intraday15m) ? intraday.intraday15m : [], { type: 'candle' });
  const intraday1h = sanitizeSeries(Array.isArray(intraday?.intraday1h) ? intraday.intraday1h : [], { type: 'candle' });
  const intraday4h = sanitizeSeries(Array.isArray(intraday?.intraday4h) ? intraday.intraday4h : [], { type: 'candle' });
  const dailyCandles = sanitizeSeries(Array.isArray(market?.dailyCandles) ? market.dailyCandles : [], { type: 'candle' });

  const rawCandles = interval === '1week'
    ? dailyCandles
    : interval === '1day'
      ? dailyCandles
      : interval === '4hour'
        ? intraday4h
        : interval === '1hour'
          ? intraday1h
          : interval === '15min'
            ? intraday15m
            : interval === '5min'
              ? intraday5m
              : interval === '3min'
                ? intraday3m
                : intraday1m;

  const candles = sanitizeSeries(applyDepthPolicy(rawCandles, interval), { type: 'candle' });

  return {
    market,
    intraday,
    intraday1m,
    intraday3m,
    intraday5m,
    intraday15m,
    intraday1h,
    intraday4h,
    dailyCandles,
    candles,
  };
}

function refreshCacheInBackground(symbol, interval, cacheKey) {
  if (cacheRefreshInFlight.has(cacheKey)) return;

  const task = (async () => {
    try {
      const payload = await loadRawPayload(symbol, interval);
      if (!Array.isArray(payload?.candles) || payload.candles.length === 0) {
        console.warn('Skipping cache write — empty candle response');
        return;
      }
      candleCache.set(cacheKey, {
        data: payload,
        timestamp: Date.now(),
      });
    } catch (_error) {
    } finally {
      cacheRefreshInFlight.delete(cacheKey);
    }
  })();

  cacheRefreshInFlight.set(cacheKey, task);
}

router.get('/chart', async (req, res) => {
  try {
    const symbol = String(req.query.symbol || '').trim().toUpperCase();
    const interval = normalizeInterval(req.query.interval);

    if (!symbol) {
      return res.status(400).json({ error: 'symbol is required' });
    }

    const cacheKey = `${symbol}_${interval}`;
    const ttlMs = getCacheTtlMs(interval);
    const cached = candleCache.get(cacheKey);
    const isFresh = Boolean(cached && (Date.now() - cached.timestamp) < ttlMs);
    const cachedResponse = responseCache.get(cacheKey);

    if (cachedResponse && (Date.now() - cachedResponse.timestamp) < ttlMs) {
      return res.json(cachedResponse.data);
    }

    let payload;
    if (isFresh) {
      payload = cached.data;
      if (isIntradayInterval(interval)) {
        refreshCacheInBackground(symbol, interval, cacheKey);
      }
    } else {
      payload = await loadRawPayload(symbol, interval);
      if (!Array.isArray(payload?.candles) || payload.candles.length === 0) {
      } else {
        candleCache.set(cacheKey, {
          data: payload,
          timestamp: Date.now(),
        });
      }
    }

    const market = payload.market;
    const intraday = payload.intraday;
    const intraday1m = payload.intraday1m;
    const intraday3m = payload.intraday3m;
    const intraday5m = payload.intraday5m;
    const intraday15m = payload.intraday15m;
    const intraday1h = payload.intraday1h;
    const intraday4h = payload.intraday4h;
    const dailyCandles = sanitizeSeries(payload.dailyCandles, { type: 'candle' });
    const candles = sanitizeSeries(payload.candles, { type: 'candle' });

    const ema9 = sanitizeSeries(computeEMA(candles, 9), { type: 'line' });
    const ema20 = sanitizeSeries(computeEMA(candles, 20), { type: 'line' });
    const ema50 = sanitizeSeries(computeEMA(candles, 50), { type: 'line' });
    const ema200 = sanitizeSeries(computeEMA(candles, 200), { type: 'line' });
    const rsi14 = computeRSI(candles, 14);
    const atr = computeATR(candles, 14);
    const atrPercentSeries = computeAtrPercentSeries(candles, atr);
    const macdBundle = computeMACD(candles);
    const safeVwap = sanitizeSeries(Array.isArray(intraday?.vwap) ? intraday.vwap : [], { type: 'line' });

    const lastCandle = candles[candles.length - 1] || null;
    const lastClose = toNum(lastCandle?.close);
    const lastVolume = toNum(lastCandle?.volume);
    const dollarVolume = Number.isFinite(lastClose) && Number.isFinite(lastVolume)
      ? (lastClose * lastVolume)
      : null;

    const structureContext = {
      symbol,
      candles,
      intradayCandles: intraday1m,
      dailyCandles,
      indicators: {
        ema9,
        ema20,
        ema50,
        ema200,
        rsi14,
        atr,
        atrPercent: atrPercentSeries,
        macd: macdBundle.macd,
        macdSignal: macdBundle.macdSignal,
        macdHistogram: macdBundle.macdHistogram,
        vwap: safeVwap,
      },
      metrics: {
        relativeVolume: toNum(intraday?.relativeVolume),
        avgVolume: toNum(market?.metrics?.avgVolume),
        currentVolume: toNum(lastVolume),
        dollarVolume,
      },
    };

    const strategy = intraday1m.length > 0 ? detectStructures(structureContext) : emptyStrategyPayload();
    const eventsPayload = await fetchEventsForSymbol(symbol);
    const events = filterEventsPayloadByTimeDomain(eventsPayload, {
      from: candles[0]?.time,
      to: candles[candles.length - 1]?.time,
    });

    const response = {
      symbol,
      interval,
      candles,
      dailyCandles: dailyCandles.slice(-260),
      indicators: {
        ema9,
        ema20,
        ema50,
        ema200,
        rsi14,
        atr,
        atrPercent: atrPercentSeries,
        macd: macdBundle.macd,
        macdSignal: macdBundle.macdSignal,
        macdHistogram: macdBundle.macdHistogram,
        vwap: safeVwap,
      },
      structures: strategy.structures,
      primaryStructure: strategy.primaryStructure,
      score: strategy.score,
      invalidation: strategy.invalidation,
      relativeVolume: toNum(intraday?.relativeVolume),
      avgVolume: toNum(market?.metrics?.avgVolume),
      currentVolume: toNum(lastVolume),
      dollarVolume,
      intraday1m,
      intraday3m,
      intraday5m,
      intraday15m,
      intraday1h,
      intraday4h,
      orh: toNum(intraday?.orh),
      sessionMinute: toNum(intraday?.sessionMinute),
      structureScore: strategy.structureScore,
      volumeScore: strategy.volumeScore,
      volatilityScore: strategy.volatilityScore,
      trendScore: strategy.trendScore,
      events,
    };

    responseCache.set(cacheKey, {
      data: response,
      timestamp: Date.now(),
    });

    return res.json(response);
  } catch (error) {
    return res.status(500).json({
      error: 'CHART_V2_ERROR',
      message: error?.message || 'Unknown error',
    });
  }
});

module.exports = router;
