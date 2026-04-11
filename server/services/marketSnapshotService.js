const { queryWithTimeout } = require('../db/pg');

let schemaReadyPromise = null;

async function ensureMarketSnapshotTable() {
  await queryWithTimeout(
    `CREATE TABLE IF NOT EXISTS market_snapshot (
       symbol TEXT PRIMARY KEY,
       price NUMERIC,
       change_percent NUMERIC,
       rvol NUMERIC,
       atr NUMERIC,
       last_updated TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    [],
    {
      timeoutMs: 10000,
      label: 'market_snapshot.ensure_table',
      maxRetries: 0,
      poolType: 'write',
    }
  );
}

async function ensureMarketSnapshotTableCached() {
  if (!schemaReadyPromise) {
    schemaReadyPromise = ensureMarketSnapshotTable().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }

  return schemaReadyPromise;
}

async function refreshMarketSnapshot(symbols) {
  const safeSymbols = Array.isArray(symbols)
    ? symbols.map((symbol) => String(symbol || '').trim().toUpperCase()).filter(Boolean)
    : [];

  if (!safeSymbols.length) {
    return { updated: 0 };
  }

  await ensureMarketSnapshotTableCached();

  const result = await queryWithTimeout(
    `WITH requested_symbols AS (
       SELECT DISTINCT UNNEST($1::text[]) AS symbol
     ), resolved AS (
       SELECT
         s.symbol,
         COALESCE(mq.price, mm.price) AS price,
         COALESCE(mq.change_percent, mm.change_percent) AS change_percent,
         COALESCE(mm.relative_volume, mq.relative_volume) AS rvol,
         mm.atr AS atr,
         GREATEST(
           COALESCE(mq.last_updated, mq.updated_at, TIMESTAMPTZ 'epoch'),
           COALESCE(mm.last_updated, mm.updated_at, TIMESTAMPTZ 'epoch'),
           NOW()
         ) AS last_updated
       FROM requested_symbols s
       LEFT JOIN market_quotes mq ON mq.symbol = s.symbol
       LEFT JOIN market_metrics mm ON mm.symbol = s.symbol
     ), upserted AS (
       INSERT INTO market_snapshot (symbol, price, change_percent, rvol, atr, last_updated)
       SELECT symbol, price, change_percent, rvol, atr, last_updated
       FROM resolved
       ON CONFLICT (symbol) DO UPDATE SET
         price = EXCLUDED.price,
         change_percent = EXCLUDED.change_percent,
         rvol = EXCLUDED.rvol,
         atr = EXCLUDED.atr,
         last_updated = EXCLUDED.last_updated
       RETURNING 1
     )
     SELECT COUNT(*)::int AS updated FROM upserted`,
    [safeSymbols],
    {
      timeoutMs: 15000,
      label: 'market_snapshot.refresh',
      maxRetries: 0,
      poolType: 'write',
    }
  );

  return { updated: Number(result.rows?.[0]?.updated || 0) };
}

module.exports = {
  ensureMarketSnapshotTable: ensureMarketSnapshotTableCached,
  refreshMarketSnapshot,
};