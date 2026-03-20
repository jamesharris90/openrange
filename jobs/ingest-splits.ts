/* eslint-disable no-console */
// @ts-nocheck

import {
  closePool,
  fetchFmp,
  numberOrNull,
  pool,
  toIsoDate,
  validateSymbolDiversity,
  writeJsonLog,
  writeRejected,
} from "./_shared.ts";

const ENDPOINT = "https://financialmodelingprep.com/stable/splits-calendar";

async function run() {
  const raw = await fetchFmp(ENDPOINT);
  writeJsonLog("logs/fmp/splits-calendar.ingest.raw.json", raw);

  const normalized = raw.map((row: any) => ({
    symbol: String(row?.symbol || "").trim().toUpperCase(),
    event_date: toIsoDate(row?.date),
    numerator: numberOrNull(row?.numerator),
    denominator: numberOrNull(row?.denominator),
    split_type: row?.splitType ? String(row.splitType).trim() : null,
    source: "fmp",
    raw_json: row,
  }));

  const rejected: Array<any> = [];
  const accepted = normalized.filter((row) => {
    if (!row.symbol || !row.event_date) {
      rejected.push({ reason: "missing_symbol_or_event_date", row });
      return false;
    }
    if (!Number.isFinite(row.numerator) || !Number.isFinite(row.denominator)) {
      rejected.push({ reason: "missing_ratio", row });
      return false;
    }
    return true;
  });

  const diversity = validateSymbolDiversity(accepted, "symbol", 10);
  if (!diversity.passed) {
    const logPath = writeRejected("ingest-splits-batch-rejected", [
      {
        reason: "symbol_diversity_below_threshold",
        threshold: 10,
        uniqueSymbols: diversity.uniqueSymbols,
        sampleRows: accepted.slice(0, 10),
      },
    ]);
    throw new Error(`Splits batch rejected: unique symbols ${diversity.uniqueSymbols} < 10 (logged ${logPath})`);
  }

  if (rejected.length > 0) {
    writeRejected("ingest-splits-rows-rejected", rejected);
  }

  if (accepted.length === 0) {
    throw new Error("No split rows accepted after validation");
  }

  const sql = `
    INSERT INTO stock_splits (
      symbol,
      event_date,
      numerator,
      denominator,
      split_type,
      source,
      raw_json
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7::jsonb
    )
    ON CONFLICT (symbol, event_date, numerator, denominator)
    DO UPDATE SET
      split_type = EXCLUDED.split_type,
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
        Math.trunc(Number(row.numerator)),
        Math.trunc(Number(row.denominator)),
        row.split_type,
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
  writeJsonLog("logs/data-integrity/ingest-splits-summary.json", summary);
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
