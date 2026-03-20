/* eslint-disable no-console */
// @ts-nocheck

import {
  bigintOrNull,
  closePool,
  fetchFmp,
  numberOrNull,
  pool,
  toIsoDate,
  validateSymbolDiversity,
  writeJsonLog,
  writeRejected,
} from "./_shared.ts";

const ENDPOINT = "https://financialmodelingprep.com/stable/ipos-calendar";

async function run() {
  const raw = await fetchFmp(ENDPOINT);
  writeJsonLog("logs/fmp/ipos-calendar.ingest.raw.json", raw);

  const normalized = raw.map((row: any) => ({
    symbol: String(row?.symbol || "").trim().toUpperCase(),
    event_date: toIsoDate(row?.date),
    company: row?.company ? String(row.company).trim() : null,
    exchange: row?.exchange ? String(row.exchange).trim() : null,
    actions: row?.actions ? String(row.actions).trim() : null,
    price_range: row?.priceRange ? String(row.priceRange).trim() : null,
    shares: bigintOrNull(row?.shares),
    market_cap: numberOrNull(row?.marketCap),
    source: "fmp",
    raw_json: row,
  }));

  const rejected: Array<any> = [];
  const accepted = normalized.filter((row) => {
    if (!row.symbol || !row.event_date) {
      rejected.push({ reason: "missing_symbol_or_event_date", row });
      return false;
    }
    return true;
  });

  const diversity = validateSymbolDiversity(accepted, "symbol", 10);
  if (!diversity.passed) {
    const logPath = writeRejected("ingest-ipos-batch-rejected", [
      {
        reason: "symbol_diversity_below_threshold",
        threshold: 10,
        uniqueSymbols: diversity.uniqueSymbols,
        sampleRows: accepted.slice(0, 10),
      },
    ]);
    throw new Error(`IPO batch rejected: unique symbols ${diversity.uniqueSymbols} < 10 (logged ${logPath})`);
  }

  if (rejected.length > 0) {
    writeRejected("ingest-ipos-rows-rejected", rejected);
  }

  if (accepted.length === 0) {
    throw new Error("No IPO rows accepted after validation");
  }

  const sql = `
    INSERT INTO ipo_calendar (
      symbol,
      event_date,
      company,
      exchange,
      actions,
      price_range,
      shares,
      market_cap,
      source,
      raw_json
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb
    )
    ON CONFLICT (symbol, event_date, actions)
    DO UPDATE SET
      company = EXCLUDED.company,
      exchange = EXCLUDED.exchange,
      price_range = EXCLUDED.price_range,
      shares = EXCLUDED.shares,
      market_cap = EXCLUDED.market_cap,
      raw_json = EXCLUDED.raw_json,
      ingested_at = NOW()
  `;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const row of accepted) {
      await client.query(sql, [
        row.symbol,
        row.event_date,
        row.company,
        row.exchange,
        row.actions,
        row.price_range,
        row.shares,
        row.market_cap,
        row.source,
        JSON.stringify(row.raw_json),
      ]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const summary = {
    success: true,
    endpoint: ENDPOINT,
    fetched: raw.length,
    accepted: accepted.length,
    rejected: rejected.length,
    uniqueSymbols: diversity.uniqueSymbols,
  };
  writeJsonLog("logs/data-integrity/ingest-ipos-summary.json", summary);
  console.log(JSON.stringify(summary, null, 2));
}

run()
  .catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
