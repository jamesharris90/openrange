const axios = require('axios');

const FINVIZ_QUOTE_URL = 'https://finviz.com/quote.ashx';
const EXTERNAL_TIMEOUT_MS = 12000;

function stripHtml(value) {
  return String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function parseMagnitudeNumber(value) {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return null;

  const match = raw.match(/^(-?[0-9]+(?:\.[0-9]+)?)([KMB])?$/);
  if (!match) {
    const fallback = Number(raw.replace(/,/g, ''));
    return Number.isFinite(fallback) ? fallback : null;
  }

  const base = Number(match[1]);
  const suffix = match[2] || '';
  if (!Number.isFinite(base)) return null;

  const multiplier = suffix === 'K'
    ? 1e3
    : suffix === 'M'
      ? 1e6
      : suffix === 'B'
        ? 1e9
        : 1;

  return base * multiplier;
}

function normalizeDateKey(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const parsed = Date.parse(raw);
  if (Number.isFinite(parsed)) {
    return new Date(parsed).toISOString().slice(0, 10);
  }

  const alt = raw.match(/^([A-Z][a-z]{2})\s+(\d{1,2})(?:\s+'?(\d{2,4}))?$/);
  if (!alt) return null;

  const month = alt[1];
  const day = alt[2].padStart(2, '0');
  const yearRaw = alt[3];
  const nowYear = new Date().getUTCFullYear();
  const year = yearRaw
    ? String(yearRaw).length === 2 ? `20${yearRaw}` : yearRaw
    : String(nowYear);
  const composed = `${month} ${day} ${year}`;
  const composedParsed = Date.parse(composed);
  if (!Number.isFinite(composedParsed)) return null;
  return new Date(composedParsed).toISOString().slice(0, 10);
}

async function fetchSymbolAuditData(symbol) {
  const normalizedSymbol = String(symbol || '').trim().toUpperCase();
  if (!normalizedSymbol) {
    return {
      provider: 'finviz',
      available: false,
      symbol: null,
      error: 'symbol_required',
    };
  }

  try {
    const response = await axios.get(FINVIZ_QUOTE_URL, {
      params: { t: normalizedSymbol },
      timeout: EXTERNAL_TIMEOUT_MS,
      validateStatus: () => true,
      headers: {
        'User-Agent': 'Mozilla/5.0 OpenRange Truth Audit Bot',
      },
      responseType: 'text',
    });

    if (response.status !== 200) {
      return {
        provider: 'finviz',
        available: false,
        symbol: normalizedSymbol,
        error: `http_${response.status}`,
      };
    }

    const html = String(response.data || '');
    const text = stripHtml(html);
    const earningsMatch = html.match(/>Earnings<\/td><td[^>]*>(.*?)<\/td>/i);
    const earningsText = stripHtml(earningsMatch?.[1] || '');
    const earningsDate = earningsText.match(/([A-Z][a-z]{2}\s+\d{1,2}(?:\s+'?\d{2,4})?)/);
    const priceMatch = html.match(/"last_price":"?([0-9]+(?:\.[0-9]+)?)"?/i)
      || html.match(/quote-price[^>]*>\s*([0-9]+(?:\.[0-9]+)?)/i)
      || text.match(/Price\s+([0-9]+(?:\.[0-9]+)?)/i);
    const changeMatch = text.match(/Change\s+(-?[0-9]+(?:\.[0-9]+)?)%/i);
    const volumeMatch = text.match(/Volume\s+([0-9.,]+(?:[KMB])?)/i);
    const newsRows = html.match(/<table[^>]+id="news-table"[\s\S]*?<\/table>/i)?.[0]?.match(/<tr[\s\S]*?<\/tr>/gi) || [];

    return {
      provider: 'finviz',
      available: true,
      symbol: normalizedSymbol,
      price: toNumber(priceMatch?.[1]),
      change_percent: toNumber(changeMatch?.[1]),
      volume: parseMagnitudeNumber(String(volumeMatch?.[1] || '').replace(/,/g, '')),
      earnings_date: normalizeDateKey(earningsDate?.[1] || null),
      news_count: newsRows.length,
      raw_earnings: earningsText || null,
    };
  } catch (error) {
    return {
      provider: 'finviz',
      available: false,
      symbol: normalizedSymbol,
      error: error.message || 'request_failed',
    };
  }
}

module.exports = {
  fetchSymbolAuditData,
};