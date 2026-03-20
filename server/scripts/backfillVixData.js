require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { fmpFetch } = require('../services/fmpClient');
const { queryWithTimeout } = require('../db/pg');
const { normalizeSymbol, mapToProviderSymbol, mapFromProviderSymbol } = require('../utils/symbolMap');

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeQuoteRow(row, canonicalSymbol) {
  const price = toNumber(row?.price);
  const changePercent = toNumber(row?.changesPercentage ?? row?.change);
  const volumeNum = toNumber(row?.volume);
  if (!Number.isFinite(price) || !Number.isFinite(changePercent) || !Number.isFinite(volumeNum)) {
    return null;
  }

  return {
    symbol: canonicalSymbol,
    price,
    change_percent: changePercent,
    volume: Math.max(0, Math.trunc(volumeNum)),
    market_cap: Number.isFinite(toNumber(row?.marketCap)) ? Math.trunc(toNumber(row?.marketCap)) : null,
    sector: typeof row?.sector === 'string' ? row.sector : null,
  };
}

function normalizeIntradayRows(rows, canonicalSymbol) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const tsRaw = row?.date || row?.timestamp || row?.time;
      const timestamp = new Date(tsRaw).toISOString();
      const close = toNumber(row?.close ?? row?.price);
      const open = toNumber(row?.open ?? close);
      const high = toNumber(row?.high ?? close);
      const low = toNumber(row?.low ?? close);
      const volumeNum = toNumber(row?.volume);

      if (!timestamp || !Number.isFinite(close)) return null;

      return {
        symbol: canonicalSymbol,
        timestamp,
        open: Number.isFinite(open) ? open : close,
        high: Number.isFinite(high) ? high : close,
        low: Number.isFinite(low) ? low : close,
        close,
        volume: Number.isFinite(volumeNum) ? Math.max(0, Math.trunc(volumeNum)) : 0,
      };
    })
    .filter(Boolean);
}

async function upsertMarketQuote(row) {
  if (!row) return 0;

  await queryWithTimeout(
    `INSERT INTO market_quotes (symbol, price, change_percent, volume, market_cap, sector, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT(symbol)
     DO UPDATE SET
       price = EXCLUDED.price,
       change_percent = EXCLUDED.change_percent,
       volume = EXCLUDED.volume,
       market_cap = EXCLUDED.market_cap,
       sector = EXCLUDED.sector,
       updated_at = NOW()`,
    [row.symbol, row.price, row.change_percent, row.volume, row.market_cap, row.sector],
    { label: 'backfill.vix.market_quotes', timeoutMs: 12000, maxRetries: 1, retryDelayMs: 200 }
  );

  return 1;
}

async function insertIntraday(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return 0;

  const { rows: result } = await queryWithTimeout(
    `WITH payload AS (
       SELECT *
       FROM json_to_recordset($1::json) AS x(
         symbol text,
         timestamp timestamptz,
         open double precision,
         high double precision,
         low double precision,
         close double precision,
         volume bigint
       )
     ), inserted AS (
       INSERT INTO intraday_1m (symbol, timestamp, open, high, low, close, volume)
       SELECT symbol, timestamp, open, high, low, close, COALESCE(volume, 0)
       FROM payload
       ON CONFLICT (symbol, timestamp) DO NOTHING
       RETURNING 1
     )
     SELECT COUNT(*)::int AS inserted FROM inserted`,
    [JSON.stringify(rows)],
    { label: 'backfill.vix.intraday', timeoutMs: 20000, maxRetries: 1, retryDelayMs: 200 }
  );

  return Number(result?.[0]?.inserted || 0);
}

async function main() {
  const canonicalSymbol = mapFromProviderSymbol(normalizeSymbol('VIX'));
  const providerSymbol = mapToProviderSymbol(canonicalSymbol);

  const quotePayload = await fmpFetch('/quote', { symbol: providerSymbol });
  const quoteRow = normalizeQuoteRow(Array.isArray(quotePayload) ? quotePayload[0] : null, canonicalSymbol);
  const quoteUpserts = await upsertMarketQuote(quoteRow);

  const intradayPayload = await fmpFetch('/historical-chart/1min', { symbol: providerSymbol });
  const intradayRows = normalizeIntradayRows(intradayPayload, canonicalSymbol);
  const intradayInserted = await insertIntraday(intradayRows);

  console.log(JSON.stringify({
    success: true,
    canonicalSymbol,
    providerSymbol,
    quoteUpserts,
    intradayFetched: intradayRows.length,
    intradayInserted,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ success: false, error: error.message }, null, 2));
  process.exit(1);
});
