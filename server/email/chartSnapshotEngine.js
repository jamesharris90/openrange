const axios = require('axios');
const { queryWithTimeout } = require('../db/pg');
const logger = require('../logger');

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toFmpChartUrl(symbol) {
  const safeSymbol = encodeURIComponent(String(symbol || '').toUpperCase());
  return `https://finviz.com/chart.ashx?t=${safeSymbol}`;
}

async function loadOhlcFromChartEngine(symbol, limit = 120) {
  const safeSymbol = String(symbol || '').toUpperCase().trim();
  if (!safeSymbol) return [];

  const { rows } = await queryWithTimeout(
    `SELECT date::text AS d, open, high, low, close, volume
     FROM daily_ohlc
     WHERE symbol = $1
     ORDER BY date DESC
     LIMIT $2`,
    [safeSymbol, limit],
    { timeoutMs: 7000, label: 'email.chart_snapshot.daily_ohlc', maxRetries: 0 }
  ).catch(() => ({ rows: [] }));

  return (rows || [])
    .slice()
    .reverse()
    .map((row) => ({
      date: row.d,
      open: toNumber(row.open),
      high: toNumber(row.high),
      low: toNumber(row.low),
      close: toNumber(row.close),
      volume: toNumber(row.volume),
    }))
    .filter((row) => Number.isFinite(row.open) && Number.isFinite(row.high) && Number.isFinite(row.low) && Number.isFinite(row.close));
}

function computeEma(values = [], period = 9) {
  if (!Array.isArray(values) || values.length < period) return [];
  const k = 2 / (period + 1);
  const out = [];
  let ema = values.slice(0, period).reduce((acc, v) => acc + v, 0) / period;

  for (let i = period - 1; i < values.length; i += 1) {
    const price = Number(values[i]);
    ema = (price * k) + (ema * (1 - k));
    out.push({ index: i, value: ema });
  }

  return out;
}

function computeVwap(candles = []) {
  let cumulativePv = 0;
  let cumulativeVol = 0;
  return candles.map((row, idx) => {
    const typical = ((row.high || 0) + (row.low || 0) + (row.close || 0)) / 3;
    const volume = Number(row.volume || 0);
    cumulativePv += typical * volume;
    cumulativeVol += volume;
    const value = cumulativeVol > 0 ? cumulativePv / cumulativeVol : null;
    return { index: idx, value };
  }).filter((row) => Number.isFinite(row.value));
}

function renderSvg(symbol, candles) {
  const width = 1200;
  const height = 700;
  const pad = { top: 40, right: 40, bottom: 40, left: 70 };

  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const minPrice = Math.min(...lows);
  const maxPrice = Math.max(...highs);
  const priceRange = maxPrice - minPrice || 1;

  const plotWidth = width - pad.left - pad.right;
  const plotHeight = height - pad.top - pad.bottom;
  const candleWidth = Math.max(3, Math.floor(plotWidth / Math.max(candles.length, 1) * 0.7));

  const xFor = (i) => pad.left + ((i + 0.5) / candles.length) * plotWidth;
  const yFor = (price) => pad.top + ((maxPrice - price) / priceRange) * plotHeight;

  const candlesSvg = candles.map((candle, i) => {
    const x = xFor(i);
    const openY = yFor(candle.open);
    const closeY = yFor(candle.close);
    const highY = yFor(candle.high);
    const lowY = yFor(candle.low);
    const up = candle.close >= candle.open;
    const color = up ? '#16a34a' : '#dc2626';
    const bodyY = Math.min(openY, closeY);
    const bodyH = Math.max(1, Math.abs(closeY - openY));
    return `<g>
      <line x1="${x}" y1="${highY}" x2="${x}" y2="${lowY}" stroke="${color}" stroke-width="2" />
      <rect x="${x - candleWidth / 2}" y="${bodyY}" width="${candleWidth}" height="${bodyH}" fill="${color}" />
    </g>`;
  }).join('');

  const closes = candles.map((c) => c.close);
  const ema9 = computeEma(closes, 9);
  const ema20 = computeEma(closes, 20);
  const vwap = computeVwap(candles);

  const linePath = (points, color) => {
    if (!points.length) return '';
    const path = points.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${xFor(p.index)} ${yFor(p.value)}`).join(' ');
    return `<path d="${path}" fill="none" stroke="${color}" stroke-width="2.5" />`;
  };

  const grid = Array.from({ length: 6 }).map((_, idx) => {
    const y = pad.top + (idx / 5) * plotHeight;
    return `<line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" stroke="#334155" stroke-width="1" opacity="0.5" />`;
  }).join('');

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body { margin: 0; background: #020617; color: #e2e8f0; font-family: Arial, sans-serif; }
    .title { font-size: 28px; font-weight: 700; }
    .subtitle { font-size: 14px; fill: #93c5fd; }
  </style>
</head>
<body>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect x="0" y="0" width="${width}" height="${height}" fill="#020617" />
  <text x="${pad.left}" y="28" class="title" fill="#e2e8f0">${symbol} Candlestick Snapshot</text>
  <text x="${pad.left}" y="48" class="subtitle">Indicators: VWAP (cyan), EMA 9 (amber), EMA 20 (purple)</text>
  ${grid}
  ${candlesSvg}
  ${linePath(vwap, '#06b6d4')}
  ${linePath(ema9, '#f59e0b')}
  ${linePath(ema20, '#a855f7')}
</svg>
</body>
</html>`;
}

async function renderWithPuppeteer(html) {
  let puppeteer = null;
  try {
    puppeteer = require('puppeteer');
  } catch (_error) {
    return null;
  }

  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 700, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const imageBuffer = await page.screenshot({ type: 'png', fullPage: true });
    return imageBuffer;
  } finally {
    await browser.close();
  }
}

async function fetchFallbackImageBuffer(symbol) {
  const imageUrl = toFmpChartUrl(symbol);
  const response = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 10000, validateStatus: () => true });
  if (response.status >= 200 && response.status < 300 && response.data) {
    return Buffer.from(response.data);
  }
  return null;
}

async function generateChartSnapshot(symbol) {
  const safeSymbol = String(symbol || '').toUpperCase().trim();
  if (!safeSymbol) {
    return {
      symbol: '',
      imageBuffer: null,
      imageUrl: null,
      source: 'invalid_symbol',
    };
  }

  const fallbackUrl = toFmpChartUrl(safeSymbol);

  try {
    const candles = await loadOhlcFromChartEngine(safeSymbol, 120);
    if (candles.length < 20) {
      const fallbackBuffer = await fetchFallbackImageBuffer(safeSymbol).catch(() => null);
      return {
        symbol: safeSymbol,
        imageBuffer: fallbackBuffer,
        imageUrl: fallbackUrl,
        source: 'finviz_fallback_sparse_ohlc',
      };
    }

    const html = renderSvg(safeSymbol, candles);
    const imageBuffer = await renderWithPuppeteer(html);

    if (!imageBuffer) {
      const fallbackBuffer = await fetchFallbackImageBuffer(safeSymbol).catch(() => null);
      return {
        symbol: safeSymbol,
        imageBuffer: fallbackBuffer,
        imageUrl: fallbackUrl,
        source: 'finviz_fallback_no_puppeteer',
      };
    }

    return {
      symbol: safeSymbol,
      imageBuffer,
      imageUrl: fallbackUrl,
      source: 'puppeteer_svg_chart',
    };
  } catch (error) {
    logger.warn('[EMAIL_CHART] snapshot generation failed', {
      symbol: safeSymbol,
      message: error.message,
    });

    const fallbackBuffer = await fetchFallbackImageBuffer(safeSymbol).catch(() => null);
    return {
      symbol: safeSymbol,
      imageBuffer: fallbackBuffer,
      imageUrl: fallbackUrl,
      source: 'finviz_fallback_error',
      error: error.message,
    };
  }
}

module.exports = {
  generateChartSnapshot,
};
