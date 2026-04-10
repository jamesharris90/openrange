const fs = require('fs');
const path = require('path');

const { queryWithTimeout } = require('../../db/pg');
const { computeSummaryDataConfidence } = require('../../services/dataConfidenceService');
const { runNewsIngestion } = require('../../ingestion/fmp_news_ingest');
const { runPricesIngestion } = require('../../ingestion/fmp_prices_ingest');
const { backfillTechnicalIndicators } = require('../../engines/indicatorEngine');
const { runEarningsIngestionEngine } = require('../../engines/earningsIngestionEngine');

const REPORT_PATH = path.resolve(__dirname, '..', '..', '..', 'DATA_COVERAGE_REPORT.json');
const DEFAULT_REPAIR_LIMIT = 250;
const NEWS_BATCH_SIZE = 25;
const OHLC_BATCH_SIZE = 50;
const TECHNICAL_MIN_SCORE = 60;
const DEFAULT_REPAIR_STRATEGY = 'priority';
const RECENTLY_VIEWED_WINDOW_DAYS = 14;
let coverageTableReadyPromise = null;

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function calculateCoverageScore(row) {
  return (
    (row.has_news ? 30 : 0)
    + (row.has_earnings ? 30 : 0)
    + (row.has_technicals ? 40 : 0)
  );
}

function chunk(values, size) {
  const output = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
}

function chooseLatestTimestamp(currentValue, nextValue) {
  if (!currentValue) return nextValue || null;
  if (!nextValue) return currentValue || null;

  const currentTime = new Date(currentValue).getTime();
  const nextTime = new Date(nextValue).getTime();
  if (Number.isNaN(currentTime)) return nextValue;
  if (Number.isNaN(nextTime)) return currentValue;
  return nextTime > currentTime ? nextValue : currentValue;
}

function dedupeCoverageRows(rows) {
  const bySymbol = new Map();

  for (const row of rows) {
    if (!row?.symbol) continue;

    const existing = bySymbol.get(row.symbol);
    if (!existing) {
      bySymbol.set(row.symbol, { ...row });
      continue;
    }

    const merged = {
      ...existing,
      has_news: Boolean(existing.has_news || row.has_news),
      has_earnings: Boolean(existing.has_earnings || row.has_earnings),
      has_technicals: Boolean(existing.has_technicals || row.has_technicals),
      news_count: Math.max(toNumber(existing.news_count), toNumber(row.news_count)),
      earnings_count: Math.max(toNumber(existing.earnings_count), toNumber(row.earnings_count)),
      daily_row_count: Math.max(toNumber(existing.daily_row_count), toNumber(row.daily_row_count)),
      technical_count: Math.max(toNumber(existing.technical_count), toNumber(row.technical_count)),
      last_news_at: chooseLatestTimestamp(existing.last_news_at, row.last_news_at),
      last_earnings_at: chooseLatestTimestamp(existing.last_earnings_at, row.last_earnings_at),
      technical_updated_at: chooseLatestTimestamp(existing.technical_updated_at, row.technical_updated_at),
      last_daily_at: chooseLatestTimestamp(existing.last_daily_at, row.last_daily_at),
    };

    merged.coverage_score = calculateCoverageScore(merged);
    bySymbol.set(row.symbol, merged);
  }

  return Array.from(bySymbol.values());
}

function buildCoverageStatus(score) {
  if (score >= 100) return 'COMPLETE';
  if (score >= TECHNICAL_MIN_SCORE) return 'PARTIAL';
  return 'LOW';
}

async function tableExists(tableName) {
  const result = await queryWithTimeout(
    `SELECT to_regclass($1) AS name`,
    [`public.${tableName}`],
    {
      timeoutMs: 3000,
      label: `coverage.table_exists.${tableName}`,
      maxRetries: 0,
      poolType: 'read',
    }
  );

  return Boolean(result.rows?.[0]?.name);
}

async function getRecentlyViewedSymbols() {
  const [hasUserWatchlists, hasDynamicWatchlist] = await Promise.all([
    tableExists('user_watchlists'),
    tableExists('dynamic_watchlist'),
  ]);

  const unions = [];
  if (hasUserWatchlists) {
    unions.push(`
      SELECT UPPER(symbol) AS symbol, MAX(added_at) AS touched_at
      FROM user_watchlists
      WHERE symbol IS NOT NULL
        AND symbol <> ''
        AND added_at >= NOW() - INTERVAL '${RECENTLY_VIEWED_WINDOW_DAYS} days'
      GROUP BY UPPER(symbol)
    `);
  }

  if (hasDynamicWatchlist) {
    unions.push(`
      SELECT UPPER(symbol) AS symbol, MAX(updated_at) AS touched_at
      FROM dynamic_watchlist
      WHERE symbol IS NOT NULL
        AND symbol <> ''
        AND updated_at >= NOW() - INTERVAL '${RECENTLY_VIEWED_WINDOW_DAYS} days'
      GROUP BY UPPER(symbol)
    `);
  }

  if (unions.length === 0) {
    return new Set();
  }

  const result = await queryWithTimeout(
    `SELECT symbol
     FROM (
       ${unions.join('\nUNION ALL\n')}
     ) recent_symbols
     GROUP BY symbol`,
    [],
    {
      timeoutMs: 8000,
      label: 'coverage.recently_viewed',
      maxRetries: 0,
      poolType: 'read',
    }
  );

  return new Set((result.rows || []).map((row) => String(row.symbol || '').trim().toUpperCase()).filter(Boolean));
}

async function getPriorityInputs(symbols) {
  const normalizedSymbols = Array.from(new Set((symbols || [])
    .map((symbol) => String(symbol || '').trim().toUpperCase())
    .filter(Boolean)));

  if (normalizedSymbols.length === 0) {
    return new Map();
  }

  const result = await queryWithTimeout(
    `SELECT requested.symbol,
            COALESCE(mm.volume, 0)::numeric AS volume,
            COALESCE((to_jsonb(mm)->>'market_cap')::numeric, q.market_cap::numeric, 0)::numeric AS market_cap
     FROM unnest($1::text[]) AS requested(symbol)
     LEFT JOIN market_metrics mm ON UPPER(mm.symbol) = requested.symbol
     LEFT JOIN market_quotes q ON UPPER(q.symbol) = requested.symbol`,
    [normalizedSymbols],
    {
      timeoutMs: 10000,
      label: 'coverage.priority_inputs',
      maxRetries: 0,
      poolType: 'read',
    }
  );

  return new Map((result.rows || []).map((row) => [
    String(row.symbol || '').trim().toUpperCase(),
    {
      volume: toNumber(row.volume),
      market_cap: toNumber(row.market_cap),
    },
  ]));
}

function rankByVolume(rows) {
  const ranked = [...rows].sort((left, right) => {
    if (toNumber(left.volume) !== toNumber(right.volume)) {
      return toNumber(right.volume) - toNumber(left.volume);
    }
    if (toNumber(left.market_cap) !== toNumber(right.market_cap)) {
      return toNumber(right.market_cap) - toNumber(left.market_cap);
    }
    return String(left.symbol || '').localeCompare(String(right.symbol || ''));
  });

  const denominator = Math.max(1, ranked.length - 1);
  return new Map(ranked.map((row, index) => {
    const percentile = ranked.length === 1
      ? 100
      : Number((((ranked.length - 1 - index) / denominator) * 100).toFixed(2));
    return [row.symbol, percentile];
  }));
}

async function attachPriorityScores(rows) {
  const symbols = rows.map((row) => row.symbol).filter(Boolean);
  const [priorityInputs, recentlyViewedSymbols] = await Promise.all([
    getPriorityInputs(symbols),
    getRecentlyViewedSymbols(),
  ]);
  const volumeRanks = rankByVolume(rows.map((row) => ({
    symbol: row.symbol,
    volume: priorityInputs.get(row.symbol)?.volume || 0,
    market_cap: priorityInputs.get(row.symbol)?.market_cap || 0,
  })));

  return rows.map((row) => {
    const input = priorityInputs.get(row.symbol) || { volume: 0, market_cap: 0 };
    const volumeRank = toNumber(volumeRanks.get(row.symbol));
    const recentlyViewed = recentlyViewedSymbols.has(row.symbol);
    return {
      ...row,
      volume: input.volume,
      market_cap: input.market_cap,
      volume_rank: volumeRank,
      recently_viewed: recentlyViewed,
      priority_score: Number(((100 - toNumber(row.coverage_score)) + (volumeRank * 0.5) + (recentlyViewed ? 50 : 0)).toFixed(2)),
    };
  });
}

async function ensureCoverageTable() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS data_coverage (
       symbol TEXT PRIMARY KEY,
       has_news BOOLEAN NOT NULL DEFAULT FALSE,
       has_earnings BOOLEAN NOT NULL DEFAULT FALSE,
       has_technicals BOOLEAN NOT NULL DEFAULT FALSE,
       news_count INTEGER NOT NULL DEFAULT 0,
       earnings_count INTEGER NOT NULL DEFAULT 0,
       last_news_at TIMESTAMPTZ,
       last_earnings_at TIMESTAMPTZ,
       coverage_score INTEGER NOT NULL DEFAULT 0,
       last_checked TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_data_coverage_score ON data_coverage (coverage_score ASC, symbol ASC)`,
    `CREATE INDEX IF NOT EXISTS idx_data_coverage_checked ON data_coverage (last_checked DESC)`
  ];

  for (const statement of statements) {
    await queryWithTimeout(statement, [], {
      timeoutMs: 15000,
      label: 'coverage.ensure_table',
      maxRetries: 0,
      poolType: 'write',
    });
  }
}

async function ensureCoverageTableReady() {
  if (!coverageTableReadyPromise) {
    coverageTableReadyPromise = ensureCoverageTable().catch((error) => {
      coverageTableReadyPromise = null;
      throw error;
    });
  }

  return coverageTableReadyPromise;
}

async function buildCoverageRows() {
  const result = await queryWithTimeout(
    `WITH symbol_universe AS (
       SELECT DISTINCT UPPER(symbol) AS symbol FROM ticker_universe WHERE symbol IS NOT NULL AND symbol <> ''
       UNION
       SELECT DISTINCT UPPER(symbol) AS symbol FROM market_quotes WHERE symbol IS NOT NULL AND symbol <> ''
       UNION
       SELECT DISTINCT UPPER(symbol) AS symbol FROM market_metrics WHERE symbol IS NOT NULL AND symbol <> ''
       UNION
       SELECT DISTINCT UPPER(symbol) AS symbol FROM daily_ohlc WHERE symbol IS NOT NULL AND symbol <> ''
       UNION
       SELECT DISTINCT UPPER(symbol) AS symbol FROM technical_indicators WHERE symbol IS NOT NULL AND symbol <> ''
       UNION
       SELECT DISTINCT UPPER(symbol) AS symbol FROM earnings_history WHERE symbol IS NOT NULL AND symbol <> ''
       UNION
       SELECT DISTINCT UPPER(NULLIF((to_jsonb(na)->>'symbol'), '')) AS symbol
       FROM news_articles na
       WHERE NULLIF((to_jsonb(na)->>'symbol'), '') IS NOT NULL
       UNION
       SELECT DISTINCT UPPER(NULLIF(sym.value, '')) AS symbol
       FROM news_articles na
       CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(to_jsonb(na)->'symbols', '[]'::jsonb)) AS sym(value)
       WHERE NULLIF(sym.value, '') IS NOT NULL
     ),
     news_expanded AS (
       SELECT DISTINCT
              UPPER(NULLIF(expanded.symbol, '')) AS symbol,
              expanded.dedupe_key,
              expanded.published_at
       FROM (
         SELECT
           COALESCE(NULLIF(to_jsonb(na)->>'symbol', ''), '') AS symbol,
           COALESCE((to_jsonb(na)->>'published_at')::timestamptz, (to_jsonb(na)->>'created_at')::timestamptz) AS published_at,
           COALESCE(NULLIF(to_jsonb(na)->>'url', ''), md5(COALESCE(to_jsonb(na)->>'headline', '') || '|' || COALESCE(to_jsonb(na)->>'published_at', '') || '|' || COALESCE(to_jsonb(na)->>'created_at', ''))) AS dedupe_key
         FROM news_articles na

         UNION ALL

         SELECT
           COALESCE(NULLIF(sym.value, ''), '') AS symbol,
           COALESCE((to_jsonb(na)->>'published_at')::timestamptz, (to_jsonb(na)->>'created_at')::timestamptz) AS published_at,
           COALESCE(NULLIF(to_jsonb(na)->>'url', ''), md5(COALESCE(to_jsonb(na)->>'headline', '') || '|' || COALESCE(to_jsonb(na)->>'published_at', '') || '|' || COALESCE(to_jsonb(na)->>'created_at', ''))) AS dedupe_key
         FROM news_articles na
         CROSS JOIN LATERAL jsonb_array_elements_text(COALESCE(to_jsonb(na)->'symbols', '[]'::jsonb)) AS sym(value)
       ) expanded
       WHERE NULLIF(expanded.symbol, '') IS NOT NULL
     ),
     news AS (
       SELECT symbol,
              COUNT(DISTINCT dedupe_key)::int AS news_count,
              MAX(published_at) AS last_news_at
       FROM news_expanded
       GROUP BY symbol
     ),
     earnings AS (
       SELECT UPPER(symbol) AS symbol,
              COUNT(*)::int AS earnings_count,
              MAX(report_date)::timestamptz AS last_earnings_at
       FROM earnings_history
       GROUP BY UPPER(symbol)
     ),
     technicals AS (
       SELECT UPPER(symbol) AS symbol,
              COUNT(*)::int AS technical_count,
              MAX(updated_at) AS technical_updated_at
       FROM technical_indicators
       GROUP BY UPPER(symbol)
     ),
     daily AS (
       SELECT UPPER(symbol) AS symbol,
              COUNT(*)::int AS daily_row_count,
              MAX(date)::timestamptz AS last_daily_at
       FROM daily_ohlc
       GROUP BY UPPER(symbol)
     )
     SELECT su.symbol,
            COALESCE(n.news_count, 0) AS news_count,
            n.last_news_at,
            COALESCE(e.earnings_count, 0) AS earnings_count,
            e.last_earnings_at,
            COALESCE(t.technical_count, 0) AS technical_count,
            t.technical_updated_at,
            COALESCE(d.daily_row_count, 0) AS daily_row_count,
            d.last_daily_at
     FROM symbol_universe su
     LEFT JOIN news n ON n.symbol = su.symbol
     LEFT JOIN earnings e ON e.symbol = su.symbol
     LEFT JOIN technicals t ON t.symbol = su.symbol
     LEFT JOIN daily d ON d.symbol = su.symbol
     ORDER BY su.symbol ASC`,
    [],
    {
      timeoutMs: 30000,
      label: 'coverage.build_rows',
      maxRetries: 0,
      poolType: 'read',
    }
  );

  const rows = (result.rows || []).map((row) => {
    const newsCount = toNumber(row.news_count);
    const earningsCount = toNumber(row.earnings_count);
    const technicalCount = toNumber(row.technical_count);
    const dailyRowCount = toNumber(row.daily_row_count);
    const nextRow = {
      symbol: String(row.symbol || '').trim().toUpperCase(),
      has_news: newsCount > 0,
      has_earnings: earningsCount > 0,
      has_technicals: technicalCount > 0,
      news_count: newsCount,
      earnings_count: earningsCount,
      last_news_at: row.last_news_at || null,
      last_earnings_at: row.last_earnings_at || null,
      daily_row_count: dailyRowCount,
      technical_count: technicalCount,
      technical_updated_at: row.technical_updated_at || null,
      last_daily_at: row.last_daily_at || null,
    };

    return {
      ...nextRow,
      coverage_score: calculateCoverageScore(nextRow),
    };
  }).filter((row) => row.symbol);

  return dedupeCoverageRows(rows);
}

async function upsertCoverageRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return 0;
  }

  const payload = JSON.stringify(rows);
  await queryWithTimeout(
    `INSERT INTO data_coverage (
       symbol,
       has_news,
       has_earnings,
       has_technicals,
       news_count,
       earnings_count,
       last_news_at,
       last_earnings_at,
       coverage_score,
       last_checked
     )
     SELECT symbol,
            has_news,
            has_earnings,
            has_technicals,
            news_count,
            earnings_count,
            last_news_at,
            last_earnings_at,
            coverage_score,
            NOW()
     FROM jsonb_to_recordset($1::jsonb) AS x(
       symbol text,
       has_news boolean,
       has_earnings boolean,
       has_technicals boolean,
       news_count integer,
       earnings_count integer,
       last_news_at timestamptz,
       last_earnings_at timestamptz,
       coverage_score integer
     )
     ON CONFLICT (symbol) DO UPDATE
     SET has_news = EXCLUDED.has_news,
         has_earnings = EXCLUDED.has_earnings,
         has_technicals = EXCLUDED.has_technicals,
         news_count = EXCLUDED.news_count,
         earnings_count = EXCLUDED.earnings_count,
         last_news_at = EXCLUDED.last_news_at,
         last_earnings_at = EXCLUDED.last_earnings_at,
         coverage_score = EXCLUDED.coverage_score,
         last_checked = NOW()`,
    [payload],
    {
      timeoutMs: 30000,
      label: 'coverage.upsert_rows',
      maxRetries: 0,
      poolType: 'write',
    }
  );

  return rows.length;
}

async function getCoverageStatusBySymbols(symbols) {
  if (!Array.isArray(symbols) || symbols.length === 0) {
    return new Map();
  }

  await ensureCoverageTableReady();

  const normalizedSymbols = symbols
    .map((symbol) => String(symbol || '').trim().toUpperCase())
    .filter(Boolean);

  if (normalizedSymbols.length === 0) {
    return new Map();
  }

  const result = await queryWithTimeout(
    `SELECT symbol,
            has_news,
            has_earnings,
            has_technicals,
            news_count,
            earnings_count,
            last_news_at,
            last_earnings_at,
            coverage_score,
            last_checked
     FROM data_coverage
     WHERE symbol = ANY($1::text[])`,
    [normalizedSymbols],
    {
      timeoutMs: 15000,
      label: 'coverage.fetch_status_by_symbols',
      maxRetries: 0,
      poolType: 'read',
    }
  );

  return new Map((result.rows || []).map((row) => [String(row.symbol || '').trim().toUpperCase(), row]));
}

async function selectPriorityRepairCandidates(rows, options = {}) {
  const repairLimit = Math.max(1, Number(options.limit) || Number(options.repairLimitPerCategory) || DEFAULT_REPAIR_LIMIT);
  const prioritized = await attachPriorityScores(rows.filter((row) => row.symbol && (!row.has_news || !row.has_earnings || !row.has_technicals)));

  return prioritized
    .sort((left, right) => {
      if (toNumber(left.priority_score) !== toNumber(right.priority_score)) {
        return toNumber(right.priority_score) - toNumber(left.priority_score);
      }
      if (toNumber(left.volume) !== toNumber(right.volume)) {
        return toNumber(right.volume) - toNumber(left.volume);
      }
      if (toNumber(left.market_cap) !== toNumber(right.market_cap)) {
        return toNumber(right.market_cap) - toNumber(left.market_cap);
      }
      return String(left.symbol || '').localeCompare(String(right.symbol || ''));
    })
    .slice(0, repairLimit)
    .map((row) => ({
      ...row,
      actions: [
        ...(!row.has_news ? ['news_ingestion'] : []),
        ...(!row.has_earnings ? ['earnings_backfill'] : []),
        ...(!row.has_technicals ? ['ohlc_backfill', 'technical_backfill'] : []),
      ],
    }));
}

function buildMissingFields(row) {
  return [
    ...(!row.has_news ? ['news'] : []),
    ...(!row.has_earnings ? ['earnings'] : []),
    ...(!row.has_technicals ? ['technicals'] : []),
  ];
}

function buildCoverageDataConfidence(row) {
  return computeSummaryDataConfidence({
    coverage: {
      coverage_score: toNumber(row.coverage_score),
      has_news: Boolean(row.has_news),
      has_earnings: Boolean(row.has_earnings),
      has_technicals: Boolean(row.has_technicals),
    },
    priceUpdatedAt: row.last_checked,
    dailyUpdatedAt: row.last_news_at || row.last_earnings_at,
    stale: false,
    sources: [
      'coverage_engine',
      row.has_news ? 'news' : null,
      row.has_earnings ? 'earnings' : null,
      row.has_technicals ? 'technicals' : null,
    ],
  });
}

async function getPriorityPreview(options = {}) {
  await ensureCoverageTable();
  const existing = await queryWithTimeout(
    `SELECT symbol,
            has_news,
            has_earnings,
            has_technicals,
            news_count,
            earnings_count,
            last_news_at,
            last_earnings_at,
            coverage_score,
            last_checked
     FROM data_coverage
     ORDER BY symbol ASC`,
    [],
    {
      timeoutMs: 20000,
      label: 'coverage.priority_preview',
      maxRetries: 0,
      poolType: 'read',
    }
  );

  const limit = Math.max(1, Number(options.limit) || 50);
  const prioritized = await attachPriorityScores((existing.rows || []).filter((row) => row.symbol));

  return prioritized
    .map((row) => {
      const confidencePayload = buildCoverageDataConfidence(row);
      return {
        symbol: row.symbol,
        priority_score: row.priority_score,
        coverage_score: toNumber(row.coverage_score),
        data_confidence: confidencePayload.data_confidence,
        volume: toNumber(row.volume),
        missing_fields: buildMissingFields(row),
      };
    })
    .sort((left, right) => {
      if (toNumber(left.priority_score) !== toNumber(right.priority_score)) {
        return toNumber(right.priority_score) - toNumber(left.priority_score);
      }
      if (toNumber(left.volume) !== toNumber(right.volume)) {
        return toNumber(right.volume) - toNumber(left.volume);
      }
      return String(left.symbol || '').localeCompare(String(right.symbol || ''));
    })
    .slice(0, limit);
}

async function runRepairQueue(candidates, options = {}) {
  const actions = {
    news_ingestion: {
      enqueued: 0,
      processed: 0,
      batches: 0,
      stats: null,
    },
    earnings_backfill: {
      enqueued: 0,
      processed: 0,
      stats: null,
    },
    ohlc_backfill: {
      enqueued: 0,
      processed: 0,
      batches: 0,
      stats: null,
    },
    technical_backfill: {
      enqueued: 0,
      processed: 0,
      stats: null,
    },
  };

  const newsSymbols = candidates.filter((row) => !row.has_news).map((row) => row.symbol);
  const earningsSymbols = candidates.filter((row) => !row.has_earnings).map((row) => row.symbol);
  const ohlcSymbols = candidates.filter((row) => !row.has_technicals).map((row) => row.symbol);
  const technicalSymbols = Array.from(new Set(ohlcSymbols));

  actions.news_ingestion.enqueued = newsSymbols.length;
  actions.earnings_backfill.enqueued = earningsSymbols.length;
  actions.ohlc_backfill.enqueued = ohlcSymbols.length;
  actions.technical_backfill.enqueued = technicalSymbols.length;

  if (newsSymbols.length > 0) {
    const newsBatches = chunk(newsSymbols, NEWS_BATCH_SIZE);
    let aggregate = { attempted: 0, inserted: 0, deduped: 0, byProvider: {} };
    for (const batch of newsBatches) {
      const stats = await runNewsIngestion(batch);
      aggregate = {
        attempted: aggregate.attempted + toNumber(stats?.attempted),
        inserted: aggregate.inserted + toNumber(stats?.inserted),
        deduped: aggregate.deduped + toNumber(stats?.deduped),
        byProvider: Object.keys({ ...(aggregate.byProvider || {}), ...(stats?.byProvider || {}) }).reduce((accumulator, key) => {
          accumulator[key] = toNumber(aggregate.byProvider?.[key]) + toNumber(stats?.byProvider?.[key]);
          return accumulator;
        }, {}),
      };
    }
    actions.news_ingestion.processed = newsSymbols.length;
    actions.news_ingestion.batches = newsBatches.length;
    actions.news_ingestion.stats = aggregate;
  }

  if (earningsSymbols.length > 0) {
    actions.earnings_backfill.processed = earningsSymbols.length;
    actions.earnings_backfill.stats = await runEarningsIngestionEngine({
      symbols: earningsSymbols,
    });
  }

  if (ohlcSymbols.length > 0) {
    const ohlcBatches = chunk(ohlcSymbols, OHLC_BATCH_SIZE);
    let inserted = 0;
    for (const batch of ohlcBatches) {
      const stats = await runPricesIngestion(batch);
      inserted += toNumber(stats?.inserted);
    }
    actions.ohlc_backfill.processed = ohlcSymbols.length;
    actions.ohlc_backfill.batches = ohlcBatches.length;
    actions.ohlc_backfill.stats = {
      inserted,
    };
  }

  if (technicalSymbols.length > 0) {
    actions.technical_backfill.processed = technicalSymbols.length;
    actions.technical_backfill.stats = await backfillTechnicalIndicators({
      symbols: technicalSymbols,
      batchSize: 25,
    });
  }

  return actions;
}

function summarizeCoverageMetrics(rows) {
  const total = rows.length || 1;
  const fullCoverage = rows.filter((row) => row.coverage_score >= 100).length;
  const partialCoverage = rows.filter((row) => row.coverage_score >= TECHNICAL_MIN_SCORE && row.coverage_score < 100).length;
  const lowCoverage = rows.filter((row) => row.coverage_score < TECHNICAL_MIN_SCORE).length;
  const averageCoverage = rows.reduce((sum, row) => sum + toNumber(row.coverage_score), 0) / total;

  return {
    average_coverage_pct: Number(averageCoverage.toFixed(2)),
    full_coverage_pct: Number(((fullCoverage / total) * 100).toFixed(2)),
    partial_coverage_pct: Number(((partialCoverage / total) * 100).toFixed(2)),
    low_coverage_pct: Number(((lowCoverage / total) * 100).toFixed(2)),
  };
}

function buildRepairSummary(candidates, beforeRows, afterRows, repairActions, options = {}) {
  const beforeMap = new Map(beforeRows.map((row) => [row.symbol, row]));
  const afterMap = new Map(afterRows.map((row) => [row.symbol, row]));
  const before = summarizeCoverageMetrics(beforeRows);
  const after = summarizeCoverageMetrics(afterRows);
  const symbolsRepaired = candidates.map((candidate) => {
    const afterRow = afterMap.get(candidate.symbol);
    return {
      symbol: candidate.symbol,
      priority_score: candidate.priority_score,
      volume_rank: candidate.volume_rank,
      volume: candidate.volume,
      market_cap: candidate.market_cap,
      recently_viewed: candidate.recently_viewed,
      before_coverage_score: toNumber(beforeMap.get(candidate.symbol)?.coverage_score),
      after_coverage_score: toNumber(afterRow?.coverage_score),
      actions: candidate.actions,
    };
  });

  return {
    strategy: options.strategy || DEFAULT_REPAIR_STRATEGY,
    limit: Math.max(1, Number(options.limit) || Number(options.repairLimitPerCategory) || DEFAULT_REPAIR_LIMIT),
    selected_count: candidates.length,
    symbols_repaired: symbolsRepaired,
    coverage_delta_pct: Number((after.average_coverage_pct - before.average_coverage_pct).toFixed(2)),
    before,
    after,
    input_sources: {
      volume: 'market_metrics.volume',
      market_cap: 'market_metrics.market_cap if available, else market_quotes.market_cap',
      recently_viewed: `user_watchlists.added_at or dynamic_watchlist.updated_at within ${RECENTLY_VIEWED_WINDOW_DAYS} days`,
    },
    repair_queue: repairActions,
  };
}

function buildCoverageReport(rows, durationMs, details = {}) {
  const reportDetails = details || {};
  const total = rows.length || 1;
  const fullCoverage = rows.filter((row) => row.coverage_score >= 100).length;
  const partialCoverage = rows.filter((row) => row.coverage_score >= TECHNICAL_MIN_SCORE && row.coverage_score < 100).length;
  const lowCoverage = rows.filter((row) => row.coverage_score < TECHNICAL_MIN_SCORE).length;
  const missingNews = rows.filter((row) => !row.has_news).length;
  const missingEarnings = rows.filter((row) => !row.has_earnings).length;
  const missingTechnicals = rows.filter((row) => !row.has_technicals).length;
  const averageCoverage = rows.reduce((sum, row) => sum + toNumber(row.coverage_score), 0) / total;
  const worstSymbols = [...rows]
    .sort((left, right) => {
      if (left.coverage_score !== right.coverage_score) {
        return left.coverage_score - right.coverage_score;
      }
      return String(left.symbol || '').localeCompare(String(right.symbol || ''));
    })
    .slice(0, 25)
    .map((row) => ({
      symbol: row.symbol,
      coverage_score: row.coverage_score,
      status: buildCoverageStatus(row.coverage_score),
      has_news: row.has_news,
      has_earnings: row.has_earnings,
      has_technicals: row.has_technicals,
      news_count: row.news_count,
      earnings_count: row.earnings_count,
      last_news_at: row.last_news_at,
      last_earnings_at: row.last_earnings_at,
    }));

  return {
    generated_at: new Date().toISOString(),
    total_symbols: rows.length,
    average_coverage_pct: Number(averageCoverage.toFixed(2)),
    full_coverage_pct: Number(((fullCoverage / total) * 100).toFixed(2)),
    partial_coverage_pct: Number(((partialCoverage / total) * 100).toFixed(2)),
    low_coverage_pct: Number(((lowCoverage / total) * 100).toFixed(2)),
    counts: {
      full: fullCoverage,
      partial: partialCoverage,
      low: lowCoverage,
    },
    missing_counts: {
      news: missingNews,
      earnings: missingEarnings,
      technicals: missingTechnicals,
    },
    repair_queue: reportDetails.repairActions || null,
    repair_summary: reportDetails.repairSummary || null,
    worst_symbols: worstSymbols,
    duration_ms: durationMs,
  };
}

async function getCoverageOverview(options = {}) {
  await ensureCoverageTable();

  const shouldRefresh = Boolean(options.refresh);
  const existing = await queryWithTimeout(
    `SELECT symbol,
            has_news,
            has_earnings,
            has_technicals,
            news_count,
            earnings_count,
            last_news_at,
            last_earnings_at,
            coverage_score,
            last_checked
     FROM data_coverage
     ORDER BY symbol ASC`,
    [],
    {
      timeoutMs: 20000,
      label: 'coverage.overview',
      maxRetries: 0,
      poolType: 'read',
    }
  );

  const rows = existing.rows || [];
  if (shouldRefresh || rows.length === 0) {
    return runCoverageEngine({
      performRepair: Boolean(options.performRepair),
      repairLimitPerCategory: options.repairLimitPerCategory,
      writeReport: false,
    });
  }

  return buildCoverageReport(rows, 0, {});
}

async function runCoverageEngine(options = {}) {
  const startedAt = Date.now();
  const strategy = options.strategy || DEFAULT_REPAIR_STRATEGY;
  await ensureCoverageTable();
  const beforeRows = await buildCoverageRows();
  let rows = beforeRows;
  await upsertCoverageRows(rows);

  let repairActions = null;
  let repairSummary = null;
  if (options.performRepair !== false) {
    const candidates = strategy === 'priority'
      ? await selectPriorityRepairCandidates(rows, options)
      : await selectPriorityRepairCandidates(rows, options);
    repairActions = await runRepairQueue(candidates, options);
    const repairedWorkPerformed = Object.values(repairActions).some((entry) => toNumber(entry?.processed) > 0);
    if (repairedWorkPerformed) {
      rows = await buildCoverageRows();
      await upsertCoverageRows(rows);
    }
    repairSummary = buildRepairSummary(candidates, beforeRows, rows, repairActions, { ...options, strategy });
  }

  const report = buildCoverageReport(rows, Date.now() - startedAt, { repairActions, repairSummary });
  if (options.writeReport !== false) {
    fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  return report;
}

async function runCoverageRepair(options = {}) {
  return runCoverageEngine({
    performRepair: true,
    writeReport: options.writeReport !== false,
    strategy: options.strategy || DEFAULT_REPAIR_STRATEGY,
    limit: options.limit,
  });
}

async function main() {
  const report = await runCoverageEngine();
  console.log(JSON.stringify(report, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  buildCoverageReport,
  buildRepairSummary,
  calculateCoverageScore,
  dedupeCoverageRows,
  ensureCoverageTable,
  buildCoverageRows,
  getCoverageOverview,
  getPriorityPreview,
  getPriorityInputs,
  getRecentlyViewedSymbols,
  attachPriorityScores,
  selectPriorityRepairCandidates,
  upsertCoverageRows,
  getCoverageStatusBySymbols,
  runCoverageRepair,
  runCoverageEngine,
};