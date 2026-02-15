const axios = require('axios');
const YahooFinance = require('yahoo-finance2').default;
const yahoo = require('../providers/yahooProvider');
const polygon = require('../providers/polygonProvider');
const finviz = require('../providers/finvizProvider');
const finnhub = require('../providers/finnhubProvider');
const cache = require('../utils/cache');
const { POLYGON_API_KEY, FINNHUB_API_KEY } = require('../utils/config');

let lastProvider = null;
let lastFailure = null;
const failureHistory = [];
const successCounts = {};
const failureCounts = {};

const QUOTE_TTL = 30 * 1000;
const NEWS_TTL = 5 * 60 * 1000;
const GAP_TTL = 45 * 1000;
const MARKET_CTX_TTL = 5 * 60 * 1000;
const EARNINGS_TTL = 15 * 60 * 1000;
const SEARCH_TTL = 5 * 60 * 1000;
const OPTIONS_TTL = 5 * 60 * 1000;

const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

function activeQuoteProviders() {
  const list = [];
  if (POLYGON_API_KEY) list.push(polygon);
  list.push(yahoo);
  return list;
}

function recordFailure(provider, err) {
  lastFailure = { provider, error: err.message, ts: Date.now() };
  failureHistory.unshift(lastFailure);
  if (failureHistory.length > 25) failureHistory.pop();
  failureCounts[provider] = (failureCounts[provider] || 0) + 1;
}

function recordSuccess(provider) {
  successCounts[provider] = (successCounts[provider] || 0) + 1;
}

async function getQuotes(symbols = []) {
  const list = Array.isArray(symbols) ? symbols : String(symbols).split(',');
  const key = `svc:quotes:${list.sort().join(',')}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const providers = activeQuoteProviders();
  let lastErr;
  for (const p of providers) {
    try {
      const quotes = await p.getQuotes(list);
      lastProvider = p.name;
      recordSuccess(p.name);
      cache.set(key, quotes, QUOTE_TTL);
      return quotes;
    } catch (err) {
      lastErr = err;
      recordFailure(p.name, err);
      continue;
    }
  }
  throw lastErr || new Error('No provider available');
}

async function getNews(symbol) {
  const key = `svc:news:${symbol}`;
  const cached = cache.get(key);
  if (cached) return cached;
  try {
    const news = await finnhub.getNews(symbol);
    recordSuccess('finnhub');
    cache.set(key, news, NEWS_TTL);
    return news;
  } catch (err) {
    recordFailure('finnhub', err);
    throw err;
  }
}

async function getMarketNews() {
  const key = 'svc:marketNews';
  const cached = cache.get(key);
  if (cached) return cached;
  try {
    const news = await finnhub.getMarketNews();
    recordSuccess('finnhub');
    cache.set(key, news, NEWS_TTL);
    return news;
  } catch (err) {
    recordFailure('finnhub', err);
    throw err;
  }
}

async function getGappers() {
  const key = 'svc:gappers';
  const cached = cache.get(key);
  if (cached) return cached;
  try {
    const tickers = await finviz.fetchGappers();
    recordSuccess('finviz');
    const quotes = await getQuotes(tickers);
    // merge
    const map = new Map();
    quotes.forEach(q => map.set(q.symbol, q));
    const gappers = tickers.map(sym => ({ symbol: sym, ...(map.get(sym) || {}) }));
    cache.set(key, gappers, GAP_TTL);
    return gappers;
  } catch (err) {
    recordFailure('finviz', err);
    throw err;
  }
}

async function getHistorical(symbol, timeframe = { interval: '1d', range: '1mo' }) {
  const providers = activeQuoteProviders();
  let lastErr;
  for (const p of providers) {
    try {
      if (p.getHistorical) {
        const data = await p.getHistorical(symbol, timeframe);
        lastProvider = p.name;
        recordSuccess(p.name);
        return data;
      }
    } catch (err) {
      lastErr = err;
      recordFailure(p.name, err);
      continue;
    }
  }
  throw lastErr || new Error('No provider available');
}

async function getOptions(ticker, dateParam) {
  const key = `svc:options:${ticker}:${dateParam || 'nearest'}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const queryOptions = {};
  if (dateParam) queryOptions.date = new Date(parseInt(dateParam, 10) * 1000);

  const loadOptions = async (optionsDate) => {
    if (optionsDate) queryOptions.date = optionsDate;
    return yahooFinance.options(ticker, queryOptions);
  };

  let result = await loadOptions(queryOptions.date);
  if (!result) throw new Error('No options data');

  if (!dateParam && result.expirationDates?.length > 1) {
    const firstExpiry = result.options?.[0]?.expirationDate;
    if (firstExpiry) {
      const exMs = firstExpiry instanceof Date ? firstExpiry.getTime() : firstExpiry * 1000;
      const dte = Math.ceil((exMs - Date.now()) / 86400000);
      if (dte <= 0) {
        const nextExpiry = result.expirationDates[1];
        if (nextExpiry) {
          const nextDate = nextExpiry instanceof Date ? nextExpiry : new Date(nextExpiry * 1000);
          result = await loadOptions(nextDate);
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

  const allStrikes = [...new Set([...calls.map(c => c.strike), ...puts.map(p => p.strike)])].sort((a, b) => a - b);
  const atmStrike = allStrikes.length
    ? allStrikes.reduce((best, s) => Math.abs(s - price) < Math.abs(best - price) ? s : best, allStrikes[0])
    : price;
  const atmCall = calls.find(c => c.strike === atmStrike);
  const atmPut = puts.find(p => p.strike === atmStrike);

  const ivValues = [atmCall?.impliedVolatility, atmPut?.impliedVolatility].filter(v => v != null);
  const avgIV = ivValues.length ? +(ivValues.reduce((a, b) => a + b, 0) / ivValues.length).toFixed(4) : null;

  const earningsDateRaw = quote.earningsTimestamp || null;
  const earningsDateStr = earningsDateRaw ? (earningsDateRaw instanceof Date ? earningsDateRaw.toISOString().split('T')[0] : new Date(earningsDateRaw * 1000).toISOString().split('T')[0]) : null;
  const earningsMs = earningsDateRaw instanceof Date ? earningsDateRaw.getTime() : (earningsDateRaw ? earningsDateRaw * 1000 : null);
  const earningsInDays = earningsMs ? Math.ceil((earningsMs - Date.now()) / 86400000) : null;

  const expiryMs = expirationDate instanceof Date ? expirationDate.getTime() : (expirationDate ? expirationDate * 1000 : 0);
  const expiryStr = expiryMs ? new Date(expiryMs).toISOString().split('T')[0] : null;
  const daysToExpiry = expiryMs ? Math.max(0, Math.ceil((expiryMs - Date.now()) / 86400000)) : 0;

  const callBidAsk = atmCall ? ((atmCall.bid || 0) + (atmCall.ask || 0)) / 2 : 0;
  const callMid = callBidAsk > 0 ? callBidAsk : (atmCall?.lastPrice || 0);
  const putBidAsk = atmPut ? ((atmPut.bid || 0) + (atmPut.ask || 0)) / 2 : 0;
  const putMid = putBidAsk > 0 ? putBidAsk : (atmPut?.lastPrice || 0);
  const straddleMid = +(callMid + putMid).toFixed(2);

  const ivExpectedMove = avgIV && price ? +(price * avgIV * Math.sqrt(Math.max(daysToExpiry, 1) / 365)).toFixed(2) : 0;
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
    putsCount: puts.length,
  };

  cache.set(key, data, OPTIONS_TTL);
  recordSuccess('yahoo');
  return data;
}

async function getMarketContext() {
  const key = 'svc:marketContext';
  const cached = cache.get(key);
  if (cached) return cached;

  const tickers = ['SPY', 'QQQ', '^VIX', 'DX-Y.NYB'];
  const quotes = await yahoo.getQuotes(tickers);
  const quoteMap = new Map(quotes.map(q => [q.symbol, q]));

  const indices = tickers.map(sym => {
    const q = quoteMap.get(sym) || {};
    return {
      ticker: sym,
      name: q.shortName || sym,
      price: q.price || 0,
      change: q.change != null ? q.change : 0,
      changePercent: q.changePercent != null ? q.changePercent : 0,
    };
  });

  const fetchTech = async (sym) => {
    try {
      const hist = await yahoo.getHistorical(sym, { interval: '1d', range: '1y' });
      const bars = (hist.quotes || []).filter(q => q.close != null && q.high != null && q.low != null);
      if (bars.length < 20) return null;
      const closes = bars.map(b => b.close);
      const price = closes[closes.length - 1];
      const sma = (arr, p) => (arr.length >= p ? +(arr.slice(-p).reduce((a, b) => a + b, 0) / p).toFixed(2) : null);
      const sma9 = sma(closes, 9);
      const sma20 = sma(closes, 20);
      const sma50 = sma(closes, 50);
      return {
        price,
        sma9,
        sma20,
        sma50,
        aboveSMA9: sma9 != null ? price > sma9 : null,
        aboveSMA20: sma20 != null ? price > sma20 : null,
        aboveSMA50: sma50 != null ? price > sma50 : null,
      };
    } catch (err) {
      lastFailure = { provider: 'yahoo', error: err.message, ts: Date.now() };
      return null;
    }
  };

  const [spyTech, qqqTech] = await Promise.all([
    fetchTech('SPY'),
    fetchTech('QQQ'),
  ]);

  const spy = spyTech || {};
  const qqq = qqqTech || {};
  const vixObj = indices.find(i => (i.ticker || '').includes('VIX')) || {};
  const spyIdx = indices.find(i => i.ticker === 'SPY') || {};

  let bull = 0;
  let bear = 0;
  const reasons = [];
  if (spy.aboveSMA20) { bull++; reasons.push('SPY > 20-SMA'); } else if (spy.aboveSMA20 === false) { bear++; reasons.push('SPY < 20-SMA'); }
  if (spy.aboveSMA50) { bull++; reasons.push('SPY > 50-SMA'); } else if (spy.aboveSMA50 === false) { bear++; reasons.push('SPY < 50-SMA'); }
  if (qqq.aboveSMA20) bull++; else if (qqq.aboveSMA20 === false) bear++;
  if (qqq.aboveSMA50) bull++; else if (qqq.aboveSMA50 === false) bear++;
  if (vixObj.price > 25) { bear += 2; reasons.push(`VIX elevated (${vixObj.price.toFixed(1)})`); }
  else if (vixObj.price > 20) { bear++; reasons.push(`VIX cautious (${vixObj.price.toFixed(1)})`); }
  else if (vixObj.price < 15) { bull++; reasons.push(`VIX low (${vixObj.price.toFixed(1)})`); }
  if (spyIdx.changePercent > 0.5) { bull++; reasons.push('SPY up today'); }
  else if (spyIdx.changePercent < -0.5) { bear++; reasons.push('SPY down today'); }

  const bias = bull >= bear + 2 ? 'bullish' : bear >= bull + 2 ? 'bearish' : 'neutral';
  const data = { indices, technicals: { SPY: spyTech || {}, QQQ: qqqTech || {} }, bias, biasReasons: reasons, timestamp: Date.now() };
  cache.set(key, data, MARKET_CTX_TTL);
  recordSuccess('yahoo');
  return data;
}

async function searchSymbols(query) {
  const q = (query || '').trim();
  if (!q || q.length < 2) return [];
  const key = `svc:search:${q.toLowerCase()}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const result = await yahooFinance.search(q, { quotesCount: 10, newsCount: 0 });
  const quotes = (result.quotes || [])
    .filter(r => r.quoteType === 'EQUITY' && r.symbol)
    .slice(0, 10)
    .map(r => ({
      symbol: r.symbol,
      name: r.shortname || r.longname || '',
      exchange: r.exchange || '',
    }));
  cache.set(key, quotes, SEARCH_TTL);
  return quotes;
}

function toDateStr(d) {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString().split('T')[0];
  if (typeof d === 'number') return new Date(d > 1e10 ? d : d * 1000).toISOString().split('T')[0];
  return String(d);
}

async function getEarningsCalendar({ from, to }) {
  if (!FINNHUB_API_KEY) throw new Error('FINNHUB_API_KEY not set');
  const start = from || new Date().toISOString().split('T')[0];
  const end = to || start;
  const key = `earnings:${start}:${end}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const url = `https://finnhub.io/api/v1/calendar/earnings?from=${start}&to=${end}&token=${FINNHUB_API_KEY}`;
  const fhRes = await axios.get(url, { timeout: 15000 });
  const calendar = fhRes.data?.earningsCalendar || [];

  const uniqueSymbols = [...new Set(calendar.map(e => e.symbol).filter(Boolean))];
  const quoteMap = {};
  const batchSize = 10;
  for (let i = 0; i < uniqueSymbols.length; i += batchSize) {
    const batch = uniqueSymbols.slice(i, i + batchSize);
    const results = await Promise.allSettled(batch.map(async (ticker) => {
      const qKey = `earningsQuote:${ticker}`;
      const cachedQuote = cache.get(qKey);
      if (cachedQuote) return { ticker, ...cachedQuote };
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
        cache.set(qKey, data, EARNINGS_TTL);
        return { ticker, ...data };
      } catch {
        return { ticker };
      }
    }));
    results.forEach(r => { if (r.status === 'fulfilled') quoteMap[r.value.ticker] = r.value; });
  }

  const seen = new Set();
  const deduped = calendar.filter(e => {
    const k = `${e.symbol}:${e.date}`;
    if (seen.has(k)) return false;
    seen.add(k);
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

  const filtered = deduped.filter(e => isUsUkSymbol(e.symbol, quoteMap[e.symbol] || {}));

  const earnings = filtered.map(e => {
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

  const beatsMap = {};
  const beatSymbols = [...new Set(earnings.map(e => e.symbol).filter(Boolean))].slice(0, 150);
  for (let i = 0; i < beatSymbols.length; i += batchSize) {
    const batch = beatSymbols.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(sym =>
        axios.get(`https://finnhub.io/api/v1/stock/earnings?symbol=${sym}&limit=4&token=${FINNHUB_API_KEY}`, { timeout: 8000 })
          .then(r => {
            const hist = r.data || [];
            const beats = hist.filter(h => h.actual != null && h.estimate != null && h.actual > h.estimate).length;
            return { sym, beats, total: hist.filter(h => h.actual != null && h.estimate != null).length };
          })
      )
    );
    results.forEach(r => { if (r.status === 'fulfilled') beatsMap[r.value.sym] = r.value; });
  }
  earnings.forEach(e => {
    const b = beatsMap[e.symbol];
    e.beatsInLast4 = b ? b.beats : null;
  });

  const needYahoo = [...new Set(earnings
    .filter(e => e.symbol && (e.surprisePercent == null || e.epsActual == null || e.epsEstimate == null || e.beatsInLast4 == null))
    .map(e => e.symbol)
  )].slice(0, 300);

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
        // swallow
      }
    }
  }

  const data = { earnings, from: start, to: end };
  cache.set(key, data, EARNINGS_TTL);
  return data;
}

async function getEarningsResearch(ticker) {
  const key = `earningsResearch:${ticker}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const now = new Date();
  const oneYearAgo = new Date(now); oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const today = now.toISOString().split('T')[0];
  const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0];

  const [summaryResult, optionsResult, chartResult, newsResult] = await Promise.allSettled([
    yahooFinance.quoteSummary(ticker, {
      modules: ['price', 'summaryProfile', 'defaultKeyStatistics', 'financialData',
        'earnings', 'calendarEvents', 'recommendationTrend',
        'majorHoldersBreakdown', 'insiderTransactions', 'upgradeDowngradeHistory']
    }),
    yahooFinance.options(ticker),
    yahooFinance.chart(ticker, { period1: oneYearAgo, period2: now, interval: '1d' }),
    FINNHUB_API_KEY
      ? axios.get(`https://finnhub.io/api/v1/company-news?symbol=${ticker}&from=${twoWeeksAgo}&to=${today}&token=${FINNHUB_API_KEY}`, { timeout: 8000 }).then(r => r.data)
      : Promise.resolve([]),
  ]);

  const summary = summaryResult.status === 'fulfilled' ? summaryResult.value : {};
  const optionsRaw = optionsResult.status === 'fulfilled' ? optionsResult.value : null;
  const chartRaw = chartResult.status === 'fulfilled' ? chartResult.value : null;
  const newsItems = newsResult.status === 'fulfilled' ? (newsResult.value || []) : [];

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
    recentInsiderTxns: (insiderTxns || []).slice(0, 5).map(t => ({
      name: t.filerName || '',
      relation: t.filerRelation || '',
      type: t.transactionText || '',
      shares: t.shares ?? null,
      value: t.value ?? null,
      date: toDateStr(t.startDate),
    })),
  };

  const currentMonth = (recTrend.trend || []).find(t => t.period === '0m') || {};
  const prevMonth = (recTrend.trend || []).find(t => t.period === '-1m') || {};
  const cutoff90d = Date.now() - 90 * 86400000;
  const recentUpgrades = (upgradeHistory || []).filter(u => {
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

  const news = (Array.isArray(newsItems) ? newsItems : []).slice(0, 10).map(n => ({
    headline: n.headline || '',
    source: n.source || '',
    url: n.url || '',
    datetime: n.datetime || 0,
    category: n.category || '',
    summary: (n.summary || '').slice(0, 200),
  }));

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

    const computeRSI = (arr, period = 14) => {
      if (arr.length < period + 1) return null;
      const recent = arr.slice(-(period + 1));
      let gains = 0; let losses = 0;
      for (let i = 1; i < recent.length; i++) {
        const diff = recent[i] - recent[i - 1];
        if (diff > 0) gains += diff; else losses -= diff;
      }
      const avgGain = gains / period;
      const avgLoss = losses / period;
      if (avgLoss === 0) return 100;
      return +(100 - 100 / (1 + avgGain / avgLoss)).toFixed(2);
    };

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

  const computeSetupScore = () => {
    const b = {};

    let et = 10;
    quarterlyEarnings.slice(0, 4).forEach(q => { if (q.beat === true) et += 3; else if (q.beat === false) et -= 3; });
    b.earningsTrack = Math.max(0, Math.min(20, et));

    let emScore = 7;
    if (expectedMove.available) {
      if (expectedMove.expectedMovePercent > 0 && expectedMove.expectedMovePercent < 15) emScore += 4;
      if (expectedMove.avgIV && expectedMove.avgIV < 1.0) emScore += 2;
      if (expectedMove.straddle > 0) emScore += 2;
    }
    b.expectedMove = Math.max(0, Math.min(15, emScore));

    let liq = 5;
    if (company.avgVolume > 2e6) liq += 5;
    else if (company.avgVolume > 500e3) liq += 3;
    else if (company.avgVolume && company.avgVolume < 200e3) liq -= 3;
    if (company.floatShares && company.floatShares < 50e6) liq += 2;
    if (company.marketCap && company.marketCap > 1e9) liq += 3;
    else if (company.marketCap && company.marketCap > 300e6) liq += 1;
    b.liquidity = Math.max(0, Math.min(15, liq));

    let si = 3;
    if (company.shortPercentOfFloat > 20) si += 5;
    else if (company.shortPercentOfFloat > 10) si += 3;
    else if (company.shortPercentOfFloat > 5) si += 1;
    b.shortInterest = Math.max(0, Math.min(10, si));

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

    let tech = 7;
    if (technicals.available) {
      if (technicals.trend === 'bullish') tech += 4;
      else if (technicals.trend === 'bearish') tech -= 2;
      if (technicals.rsi && technicals.rsi > 30 && technicals.rsi < 70) tech += 2;
      if (technicals.distHigh52w && technicals.distHigh52w > -10) tech += 2;
    }
    b.technicals = Math.max(0, Math.min(15, tech));

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
    ticker,
    price: currentPrice,
    name: company.name,
    earnings,
    expectedMove,
    company,
    sentiment,
    news,
    technicals,
    setupScore,
  };

  cache.set(key, data, EARNINGS_TTL);
  return data;
}

module.exports = {
  getQuotes,
  getNews,
  getGappers,
  getHistorical,
  getMarketContext,
  searchSymbols,
  getOptions,
  getMarketNews,
  getEarningsCalendar,
  getEarningsResearch,
  getProviderStatus: () => ({
    lastProvider,
    lastFailure,
    failureHistory,
    successCounts,
    failureCounts,
  }),
};
