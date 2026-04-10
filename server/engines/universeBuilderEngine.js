const logger = require('../logger');
const { queryWithTimeout } = require('../db/pg');

const FMP_STABLE_BASE = 'https://financialmodelingprep.com/stable';

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
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

async function ensureTradableUniverseColumns() {
  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS tradable_universe (
      symbol TEXT PRIMARY KEY,
      price NUMERIC,
      change_percent NUMERIC,
      relative_volume NUMERIC,
      volume BIGINT,
      avg_volume_30d NUMERIC,
      updated_at TIMESTAMPTZ DEFAULT now()
    )`,
    [],
    { timeoutMs: 6000, label: 'engines.universeBuilderEngine.ensure_table', maxRetries: 0 }
  );

  await queryWithTimeout(
    'ALTER TABLE tradable_universe ADD COLUMN IF NOT EXISTS source TEXT',
    [],
    { timeoutMs: 6000, label: 'engines.universeBuilderEngine.ensure_source', maxRetries: 0 }
  );
}

async function runUniverseBuilderEngine() {
  const startedAt = Date.now();
  const apiKey = process.env.FMP_API_KEY;
  if (!apiKey) throw new Error('FMP_API_KEY missing');

  await ensureTradableUniverseColumns();

  const url = `${FMP_STABLE_BASE}/batch-exchange-quote?exchange=NASDAQ&short=true&apikey=${encodeURIComponent(apiKey)}`;
  const response = await fetchJson(url, 20000);
  if (response.status !== 200) {
    throw new Error(`universe endpoint failed with status ${response.status}`);
  }
  if (!Array.isArray(response.body)) {
    throw new Error('universe endpoint did not return array');
  }
  if (response.body.length <= 100) {
    throw new Error(`universe endpoint returned insufficient symbols (${response.body.length})`);
  }

  const nowIso = new Date().toISOString();
  const normalized = response.body
    .map((row) => {
      const symbol = String(row?.symbol || '').trim().toUpperCase();
      const price = asNumber(row?.price);
      const change = asNumber(row?.change ?? row?.changePercentage ?? row?.changesPercentage);
      const volume = asNumber(row?.volume);
      return {
        symbol,
        price,
        change,
        volume,
        updated_at: nowIso,
        source: 'real',
      };
    })
    .filter((row) => row.symbol && row.price !== null && row.volume !== null);

  const filtered = normalized.filter((row) => row.price > 1 && row.volume > 100000);
  if (!filtered.length) {
    throw new Error('universe filter produced empty output');
  }

  const symbols = filtered.map((row) => row.symbol);
  const prices = filtered.map((row) => row.price);
  const changes = filtered.map((row) => row.change);
  const volumes = filtered.map((row) => Math.trunc(row.volume));
  const updatedAts = filtered.map((row) => row.updated_at);
  const sources = filtered.map(() => 'real');

  await queryWithTimeout(
    `INSERT INTO tradable_universe (
      symbol,
      price,
      change_percent,
      volume,
      updated_at,
      source
    )
    SELECT
      unnest($1::text[]),
      unnest($2::numeric[]),
      unnest($3::numeric[]),
      unnest($4::bigint[]),
      unnest($5::timestamptz[]),
      unnest($6::text[])
    ON CONFLICT (symbol)
    DO UPDATE SET
      price = EXCLUDED.price,
      change_percent = EXCLUDED.change_percent,
      volume = EXCLUDED.volume,
      updated_at = EXCLUDED.updated_at,
      source = EXCLUDED.source`,
    [symbols, prices, changes, volumes, updatedAts, sources],
    { timeoutMs: 20000, label: 'engines.universeBuilderEngine.upsert', maxRetries: 0 }
  );

  logger.info('[UNIVERSE BUILT]', {
    count: filtered.length,
    timestamp: nowIso,
    runtimeMs: Date.now() - startedAt,
  });
  console.log(`[UNIVERSE BUILT] count=${filtered.length} ts=${nowIso}`);

  return {
    count: filtered.length,
    timestamp: nowIso,
    runtimeMs: Date.now() - startedAt,
  };
}

module.exports = {
  runUniverseBuilderEngine,
};
