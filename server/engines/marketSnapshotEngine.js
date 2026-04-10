const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');

const FMP_STABLE_BASE = 'https://financialmodelingprep.com/stable';
const BATCH_SIZE = 100;

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function fetchJson(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch (_err) {
      body = null;
    }
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

async function ensureMarketMetricsColumns() {
  await queryWithTimeout(
    'ALTER TABLE market_metrics ADD COLUMN IF NOT EXISTS previous_close NUMERIC',
    [],
    { timeoutMs: 6000, label: 'engines.marketSnapshotEngine.ensure_previous_close', maxRetries: 0 }
  );
  await queryWithTimeout(
    'ALTER TABLE market_metrics ADD COLUMN IF NOT EXISTS source TEXT',
    [],
    { timeoutMs: 6000, label: 'engines.marketSnapshotEngine.ensure_source', maxRetries: 0 }
  );
}

async function runMarketSnapshotEngine() {
  const startedAt = Date.now();
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) throw new Error('FMP_API_KEY missing');

  await ensureMarketMetricsColumns();

  const universe = await queryWithTimeout(
    `SELECT symbol
     FROM tradable_universe
     WHERE source = 'real'
       AND COALESCE(price, 0) > 1
       AND COALESCE(volume, 0) > 100000
     ORDER BY symbol`,
    [],
    { timeoutMs: 10000, label: 'engines.marketSnapshotEngine.select_universe', maxRetries: 0 }
  );

  const symbols = (universe.rows || []).map((row) => String(row.symbol || '').trim().toUpperCase()).filter(Boolean);
  if (!symbols.length) {
    throw new Error('market snapshot has no universe symbols');
  }

  const batches = chunk(symbols, BATCH_SIZE);
  const nowIso = new Date().toISOString();
  const normalized = [];

  for (const batch of batches) {
    const url = `${FMP_STABLE_BASE}/batch-quote?symbols=${encodeURIComponent(batch.join(','))}&apikey=${encodeURIComponent(apiKey)}`;
    const response = await fetchJson(url, 20000);
    if (response.status !== 200) {
      throw new Error(`market snapshot batch failed with status ${response.status}`);
    }
    if (!Array.isArray(response.body)) {
      throw new Error('market snapshot batch response not array');
    }
    if (response.body.length === 0) {
      throw new Error('market snapshot batch returned empty array');
    }

    for (const row of response.body) {
      const symbol = String(row?.symbol || '').trim().toUpperCase();
      const price = asNumber(row?.price);
      const changePercent = asNumber(row?.changePercentage ?? row?.changesPercentage ?? row?.changePercent ?? row?.change);
      const volume = asNumber(row?.volume);
      const previousClose = asNumber(row?.previousClose ?? row?.previous_close);
      if (!symbol || price === null || volume === null) continue;

      normalized.push({
        symbol,
        price,
        change_percent: changePercent,
        volume: Math.trunc(volume),
        previous_close: previousClose,
        updated_at: nowIso,
        source: 'real',
      });
    }
  }

  if (!normalized.length) {
    throw new Error('market snapshot normalization produced empty output');
  }

  const symbolsArray = normalized.map((row) => row.symbol);
  const prices = normalized.map((row) => row.price);
  const changePercents = normalized.map((row) => row.change_percent);
  const volumes = normalized.map((row) => row.volume);
  const previousCloses = normalized.map((row) => row.previous_close);
  const updatedAts = normalized.map((row) => row.updated_at);
  const sources = normalized.map(() => 'real');

  await queryWithTimeout(
    `INSERT INTO market_metrics (
      symbol,
      price,
      change_percent,
      volume,
      previous_close,
      updated_at,
      source
    )
    SELECT
      unnest($1::text[]),
      unnest($2::numeric[]),
      unnest($3::numeric[]),
      unnest($4::bigint[]),
      unnest($5::numeric[]),
      unnest($6::timestamptz[]),
      unnest($7::text[])
    ON CONFLICT (symbol)
    DO UPDATE SET
      price = EXCLUDED.price,
      change_percent = EXCLUDED.change_percent,
      volume = EXCLUDED.volume,
      previous_close = EXCLUDED.previous_close,
      updated_at = EXCLUDED.updated_at,
      source = EXCLUDED.source`,
    [symbolsArray, prices, changePercents, volumes, previousCloses, updatedAts, sources],
    { timeoutMs: 25000, label: 'engines.marketSnapshotEngine.upsert_metrics', maxRetries: 0 }
  );

  logger.info('[MARKET SNAPSHOT]', {
    symbols: normalized.length,
    timestamp: nowIso,
    batches: batches.length,
    runtimeMs: Date.now() - startedAt,
  });
  console.log(`[MARKET SNAPSHOT] symbols=${normalized.length} ts=${nowIso}`);

  return {
    symbols: normalized.length,
    batches: batches.length,
    timestamp: nowIso,
    runtimeMs: Date.now() - startedAt,
  };
}

module.exports = {
  runMarketSnapshotEngine,
};
