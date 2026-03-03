const axios = require('axios');

const YAHOO_API_KEY = process.env.YAHOO_API_KEY || '';
let lastYahooCall = 0;
const MIN_SPACING_MS = Number(process.env.YAHOO_MIN_SPACING_MS || 1200);

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeDateToUnixSeconds(value) {
  if (!value) return null;
  if (typeof value === 'number') return Math.floor(value);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return Math.floor(parsed.getTime() / 1000);
}

async function enforceRateLimit() {
  const now = Date.now();
  const diff = now - lastYahooCall;
  if (diff < MIN_SPACING_MS) {
    await delay(MIN_SPACING_MS - diff);
  }
  lastYahooCall = Date.now();
}

async function yahooRequest(urlPath) {
  const hosts = [
    'https://query1.finance.yahoo.com',
    'https://query2.finance.yahoo.com',
  ];

  const maxAttempts = 3;

  for (const host of hosts) {
    let attempt = 0;
    while (attempt < maxAttempts) {
      try {
        await enforceRateLimit();

        const headers = {
          'User-Agent': 'Mozilla/5.0',
        };
        if (YAHOO_API_KEY) {
          headers['x-api-key'] = YAHOO_API_KEY;
        }

        const response = await axios.get(`${host}${urlPath}`, {
          timeout: 5000,
          headers,
        });

        return response.data;
      } catch (err) {
        if (err?.response?.status === 429) {
          console.log('[YahooOptions] 429_retry:', attempt + 1);
          const backoff = 500 * Math.pow(3, attempt);
          await delay(backoff);
          attempt += 1;
          continue;
        }

        break;
      }
    }
  }

  return { _error: 'upstream_429' };
}

async function fetchOptionResult(symbol, expirationUnix) {
  const safeSymbol = String(symbol || '').trim().toUpperCase();
  if (!safeSymbol) return { result: null, optionBundle: null, underlyingPrice: null, error: 'invalid_symbol' };

  const unix = normalizeDateToUnixSeconds(expirationUnix);
  const urlPath = unix
    ? `/v7/finance/options/${encodeURIComponent(safeSymbol)}?date=${unix}`
    : `/v7/finance/options/${encodeURIComponent(safeSymbol)}`;

  const payload = await yahooRequest(urlPath);
  if (payload?._error) {
    return { result: null, optionBundle: null, underlyingPrice: null, error: payload._error };
  }

  const result = payload?.optionChain?.result?.[0] || null;
  const optionBundle = result?.options?.[0] || null;
  const underlyingPrice = toNumber(result?.quote?.regularMarketPrice);

  return {
    result,
    optionBundle,
    underlyingPrice,
    error: null,
  };
}

async function getExpirations(symbol) {
  try {
    const payload = await fetchOptionResult(symbol, null);
    if (payload.error) return [];
    const result = payload.result;
    return Array.isArray(result?.expirationDates) ? result.expirationDates : [];
  } catch (error) {
    return [];
  }
}

async function getOptionChain(symbol, expirationUnix) {
  try {
    const payload = await fetchOptionResult(symbol, expirationUnix);
    if (payload.error) return null;
    const { optionBundle, underlyingPrice } = payload;
    if (!optionBundle) return null;

    return {
      underlyingPrice,
      expiration: optionBundle.expirationDate || normalizeDateToUnixSeconds(expirationUnix) || null,
      calls: Array.isArray(optionBundle.calls) ? optionBundle.calls : [],
      puts: Array.isArray(optionBundle.puts) ? optionBundle.puts : [],
    };
  } catch (error) {
    return null;
  }
}

async function getATMContract(symbol) {
  const chain = await getOptionChain(symbol, null);
  if (!chain || !Array.isArray(chain.calls) || chain.calls.length === 0) {
    return null;
  }

  const underlyingPrice = toNumber(chain.underlyingPrice);
  if (underlyingPrice == null) return null;

  const sortedCalls = chain.calls
    .filter((call) => toNumber(call?.strike) != null)
    .filter((call) => {
      const iv = toNumber(call?.impliedVolatility);
      const oi = toNumber(call?.openInterest);
      return iv != null && iv > 0 && oi != null && oi > 0;
    })
    .sort((a, b) => Math.abs(a.strike - underlyingPrice) - Math.abs(b.strike - underlyingPrice));

  const atm = sortedCalls[0];
  if (!atm) {
    console.log('[YahooOptions] null_reason:', 'iv_null');
    return { null_reason: 'iv_null' };
  }

  return {
    strike: toNumber(atm.strike),
    impliedVolatility: toNumber(atm.impliedVolatility),
    expiration: chain.expiration,
    bid: toNumber(atm.bid),
    ask: toNumber(atm.ask),
    openInterest: toNumber(atm.openInterest),
  };
}

async function getExpectedMove(symbol, earningsDate) {
  try {
    const basePayload = await fetchOptionResult(symbol, null);
    if (basePayload.error === 'upstream_429') {
      console.log('[YahooOptions] null_reason:', 'upstream_429');
      return { data: null, reason: 'upstream_429' };
    }

    const expirations = Array.isArray(basePayload.result?.expirationDates)
      ? basePayload.result.expirationDates
      : [];

    if (!Array.isArray(expirations) || expirations.length === 0) {
      console.log('[YahooOptions] null_reason:', 'expiration_not_found');
      return { data: null, reason: 'expiration_not_found' };
    }

    const earningsUnix = normalizeDateToUnixSeconds(earningsDate);
    const nowUnix = Math.floor(Date.now() / 1000);
    const baseUnix = earningsUnix || nowUnix;
    const selectedExpiration = expirations.find((exp) => Number(exp) > baseUnix);

    if (!selectedExpiration) {
      console.log('[YahooOptions] null_reason:', 'expiration_not_found');
      return { data: null, reason: 'expiration_not_found' };
    }

    const chainPayload = await fetchOptionResult(symbol, selectedExpiration);
    if (chainPayload.error === 'upstream_429') {
      console.log('[YahooOptions] null_reason:', 'upstream_429');
      return { data: null, reason: 'upstream_429' };
    }

    const chain = {
      underlyingPrice: chainPayload.underlyingPrice,
      calls: Array.isArray(chainPayload.optionBundle?.calls) ? chainPayload.optionBundle.calls : [],
      expiration: chainPayload.optionBundle?.expirationDate || Number(selectedExpiration),
    };

    if (!chain) return { data: null, reason: 'chain_unavailable' };

    const underlyingPrice = toNumber(chain.underlyingPrice);
    const calls = Array.isArray(chain.calls) ? chain.calls : [];
    if (underlyingPrice == null || calls.length === 0) {
      return { data: null, reason: 'chain_incomplete' };
    }

    const atm = calls
      .filter((call) => toNumber(call?.strike) != null)
      .filter((call) => {
        const iv = toNumber(call?.impliedVolatility);
        const oi = toNumber(call?.openInterest);
        return iv != null && iv > 0 && oi != null && oi > 0;
      })
      .sort((a, b) => Math.abs(a.strike - underlyingPrice) - Math.abs(b.strike - underlyingPrice))[0];

    const iv = toNumber(atm?.impliedVolatility);
    if (iv == null) {
      console.log('[YahooOptions] null_reason:', 'iv_null');
      return { data: null, reason: 'iv_null' };
    }

    const daysToExpiryRaw = (Number(selectedExpiration) - nowUnix) / 86400;
    const daysToExpiry = Math.max(daysToExpiryRaw, 0);
    const expectedMovePct = iv * Math.sqrt(Math.max(daysToExpiry, 1) / 365);
    const expectedMoveDollar = underlyingPrice * expectedMovePct;

    return {
      data: {
        symbol: String(symbol || '').trim().toUpperCase(),
        atmIV: iv,
        expectedMovePct,
        expectedMoveDollar,
        expiration: Number(selectedExpiration),
        daysToExpiry,
      },
      reason: null,
    };
  } catch (error) {
    return { data: null, reason: 'provider_error', detail: error.message };
  }
}

module.exports = {
  getExpirations,
  getOptionChain,
  getATMContract,
  getExpectedMove,
};