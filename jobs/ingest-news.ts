/* eslint-disable no-console */
// @ts-nocheck

import {
  closePool,
  fetchFmp,
  pool,
  toIsoTimestamp,
  validateSymbolDiversity,
  writeJsonLog,
  writeRejected,
  nowMinusDays,
} from "./_shared.ts";
import { dedupeNewsRows, splitSymbols } from "../utils/dedupeNews.ts";

const STOCK_ENDPOINT = "https://financialmodelingprep.com/stable/news/stock-latest?page=0&limit=50";
const GENERAL_ENDPOINT = "https://financialmodelingprep.com/stable/news/general-latest?page=0&limit=50";

async function run() {
  const [stockRaw, generalRaw] = await Promise.all([
    fetchFmp(STOCK_ENDPOINT),
    fetchFmp(GENERAL_ENDPOINT),
  ]);

  writeJsonLog("logs/fmp/news-stock-latest.ingest.raw.json", stockRaw);
  writeJsonLog("logs/fmp/news-general-latest.ingest.raw.json", generalRaw);

  const merged = [...stockRaw, ...generalRaw];

  const { kept: dedupedArticles, rejected: dedupeRejected } = dedupeNewsRows(merged);

  const normalized = dedupedArticles.map((row: any) => ({
    symbols: splitSymbols(row?.symbol),
    published_date: toIsoTimestamp(row?.publishedDate),
    title: String(row?.title || "").trim(),
    body_text: String(row?.text || "").trim() || null,
    source: String(row?.publisher || row?.site || "fmp").trim(),
    publisher: row?.publisher ? String(row.publisher).trim() : null,
    site: row?.site ? String(row.site).trim() : null,
    url: row?.url ? String(row.url).trim() : null,
    source_url: row?.url ? String(row.url).trim() : null,
    image_url: row?.image ? String(row.image).trim() : null,
    dedupe_hash: row?.dedupe_hash ? String(row.dedupe_hash) : null,
    raw_json: row,
  }));

  const minNews = nowMinusDays(7);
  const rejected: Array<any> = [];

  const expanded: Array<any> = [];

  for (const row of normalized) {
    if (!row.published_date || !row.title) {
      rejected.push({ reason: "missing_published_date_or_title", row });
      continue;
    }

    const published = new Date(row.published_date);
    if (published < minNews) {
      rejected.push({ reason: "older_than_7_days", row });
      continue;
    }

    if (!Array.isArray(row.symbols) || row.symbols.length === 0) {
      rejected.push({ reason: "null_or_empty_symbol_routed_macro_discard", row });
      continue;
    }

    for (const symbol of row.symbols) {
      expanded.push({
        symbol,
        symbols: row.symbols,
        published_date: row.published_date,
        title: row.title,
        body_text: row.body_text,
        source: row.source,
        publisher: row.publisher,
        site: row.site,
        url: row.url,
        source_url: row.source_url,
        image_url: row.image_url,
        dedupe_hash: row.dedupe_hash,
        raw_json: row.raw_json,
      });
    }
  }

  const accepted = expanded;

  const diversity = validateSymbolDiversity(accepted, "symbol", 10);
  if (!diversity.passed) {
    const logPath = writeRejected("ingest-news-batch-rejected", [
      {
        reason: "symbol_diversity_below_threshold",
        threshold: 10,
        uniqueSymbols: diversity.uniqueSymbols,
        sampleRows: accepted.slice(0, 10),
      },
    ]);
    throw new Error(`News batch rejected: unique symbols ${diversity.uniqueSymbols} < 10 (logged ${logPath})`);
  }

  const symbolCounts = new Map<string, number>();
  for (const row of accepted) {
    const s = String(row?.symbol || "").trim().toUpperCase();
    if (!s) continue;
    symbolCounts.set(s, (symbolCounts.get(s) || 0) + 1);
  }
  const totalAccepted = accepted.length;
  const sortedCounts = Array.from(symbolCounts.entries()).sort((a, b) => b[1] - a[1]);
  const topSymbol = sortedCounts[0]?.[0] || null;
  const topCount = Number(sortedCounts[0]?.[1] || 0);
  const topShare = totalAccepted > 0 ? topCount / totalAccepted : 0;

  if (topShare > 0.4) {
    writeJsonLog("logs/data-integrity/news-bias.json", {
      generatedAt: new Date().toISOString(),
      reason: "batch_rejected_symbol_bias",
      topSymbol,
      topCount,
      totalAccepted,
      topShare,
      histogram: sortedCounts.map(([symbol, count]) => ({ symbol, count, share: totalAccepted > 0 ? count / totalAccepted : 0 })),
    });
    throw new Error(`News batch rejected by bias guard: top symbol share ${topShare.toFixed(4)} > 0.40`);
  }

  const totalRejected = [...rejected, ...dedupeRejected];
  if (totalRejected.length > 0) {
    writeRejected("ingest-news-rows-rejected", totalRejected);
  }

  if (accepted.length === 0) {
    throw new Error("No news rows accepted after validation");
  }

  const sql = `
    INSERT INTO news_articles (
      symbol,
      title,
      headline,
      body_text,
      summary,
      source,
      publisher,
      site,
      url,
      source_url,
      image_url,
      published_date,
      published_at,
      raw_payload,
      created_at,
      ingested_at,
      symbols
    ) VALUES (
      $1,$2,$2,$3,$3,$4,$5,$6,$7,$8,$9,$10::timestamptz,$11::timestamp,$12::jsonb,NOW(),NOW(),
      ARRAY[$1]
    )
    ON CONFLICT ON CONSTRAINT news_articles_symbol_published_date_title_key
    DO UPDATE SET
      symbol = EXCLUDED.symbol,
      title = EXCLUDED.title,
      headline = EXCLUDED.headline,
      body_text = EXCLUDED.body_text,
      summary = EXCLUDED.summary,
      source = EXCLUDED.source,
      publisher = EXCLUDED.publisher,
      site = EXCLUDED.site,
      url = EXCLUDED.url,
      source_url = EXCLUDED.source_url,
      image_url = EXCLUDED.image_url,
      published_date = EXCLUDED.published_date,
      published_at = EXCLUDED.published_at,
      raw_payload = EXCLUDED.raw_payload,
      symbols = EXCLUDED.symbols,
      ingested_at = NOW()
  `;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`ALTER TABLE news_articles DROP CONSTRAINT IF EXISTS news_articles_url_key`);

    for (const row of accepted) {
      await client.query(sql, [
        row.symbol,
        row.title,
        row.body_text,
        row.source,
        row.publisher,
        row.site,
        row.url,
        row.source_url,
        row.image_url,
        row.published_date,
        row.published_date,
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
    endpoints: [STOCK_ENDPOINT, GENERAL_ENDPOINT],
    fetched: merged.length,
    dedupedArticles: dedupedArticles.length,
    dedupeRejected: dedupeRejected.length,
    accepted: accepted.length,
    rejected: totalRejected.length,
    uniqueSymbols: diversity.uniqueSymbols,
    topSymbol,
    topShare,
    symbolHistogram: sortedCounts.map(([symbol, count]) => ({ symbol, count, share: totalAccepted > 0 ? count / totalAccepted : 0 })),
  };
  writeJsonLog("logs/data-integrity/ingest-news-summary.json", summary);
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
