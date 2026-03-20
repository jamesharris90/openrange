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
  nowMinusDays,
  nowPlusDays,
} from "./_shared.ts";

const ENDPOINT = "https://financialmodelingprep.com/stable/earnings-calendar";

async function run() {
  const raw = await fetchFmp(ENDPOINT);
  writeJsonLog("logs/fmp/earnings-calendar.ingest.raw.json", raw);

  const normalized = raw.map((row: any) => ({
    symbol: String(row?.symbol || "").trim().toUpperCase(),
    event_date: toIsoDate(row?.date),
    last_updated_date: toIsoDate(row?.lastUpdated),
    eps_estimate: numberOrNull(row?.epsEstimated),
    eps_actual: numberOrNull(row?.epsActual),
    revenue_estimate: numberOrNull(row?.revenueEstimated),
    revenue_actual: numberOrNull(row?.revenueActual),
    source: "fmp",
    raw_json: row,
  }));

  const minRecent = nowMinusDays(7);
  const maxFuture = nowPlusDays(120);

  const rejected: Array<any> = [];
  const accepted = normalized.filter((row) => {
    if (!row.symbol || !row.event_date) {
      rejected.push({ reason: "missing_symbol_or_event_date", row });
      return false;
    }
    const eventDate = new Date(`${row.event_date}T00:00:00Z`);
    if (eventDate < minRecent || eventDate > maxFuture) {
      rejected.push({ reason: "freshness_out_of_range", row });
      return false;
    }
    return true;
  });

  const diversity = validateSymbolDiversity(accepted, "symbol", 10);
  if (!diversity.passed) {
    const logPath = writeRejected("ingest-earnings-batch-rejected", [
      {
        reason: "symbol_diversity_below_threshold",
        threshold: 10,
        uniqueSymbols: diversity.uniqueSymbols,
        sampleRows: accepted.slice(0, 10),
      },
    ]);
    throw new Error(`Earnings batch rejected: unique symbols ${diversity.uniqueSymbols} < 10 (logged ${logPath})`);
  }

  if (rejected.length > 0) {
    writeRejected("ingest-earnings-rows-rejected", rejected);
  }

  if (accepted.length === 0) {
    throw new Error("No earnings rows accepted after validation");
  }

  const sql = `
    INSERT INTO earnings_calendar (
      symbol,
      event_date,
      last_updated_date,
      eps_estimate,
      eps_actual,
      revenue_estimate,
      revenue_actual,
      source,
      raw_json
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb
    )
    ON CONFLICT (symbol, event_date, source)
    DO UPDATE SET
      last_updated_date = EXCLUDED.last_updated_date,
      eps_estimate = EXCLUDED.eps_estimate,
      eps_actual = EXCLUDED.eps_actual,
      revenue_estimate = EXCLUDED.revenue_estimate,
      revenue_actual = EXCLUDED.revenue_actual,
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
        row.last_updated_date,
        row.eps_estimate,
        row.eps_actual,
        row.revenue_estimate,
        row.revenue_actual,
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
  writeJsonLog("logs/data-integrity/ingest-earnings-summary.json", summary);
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
