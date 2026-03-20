/* eslint-disable no-console */
// @ts-nocheck

import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { Pool } from "pg";
import { fileURLToPath } from "url";
import {
  ensureCatalystLayerSchema,
  buildNewsCatalysts,
  buildIntelCatalysts,
  buildEarningsCatalysts,
  buildIpoAndSplitCatalysts,
  buildMacroNarratives,
  buildClustersAndSignals,
  buildOpportunities,
} from "../engine/catalystEngine.ts";
import { buildNarrative } from "../engine/narrativeEngine.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../server/.env") });
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: path.resolve(__dirname, "../.env") });
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL_DISABLE === "true" ? false : { rejectUnauthorized: false },
});

function ensureDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

async function runPreCatalystValidation(client: any) {
  const newsDist = await client.query(`
    WITH c AS (
      SELECT symbol, COUNT(*)::int AS n
      FROM news_articles
      WHERE symbol IS NOT NULL AND symbol <> ''
      GROUP BY symbol
    ), t AS (
      SELECT SUM(n)::int AS total, COUNT(*)::int AS symbols FROM c
    )
    SELECT
      COALESCE(t.symbols, 0) AS symbols,
      COALESCE(t.total, 0) AS total,
      COALESCE((SELECT MAX(n)::numeric / NULLIF(t.total, 0) FROM c), 0) AS top_share
    FROM t
  `);

  const earnings = await client.query(`
    SELECT
      COUNT(DISTINCT symbol)::int AS symbols,
      COUNT(*) FILTER (WHERE event_date >= NOW() - INTERVAL '7 days')::int AS recent_or_upcoming_events,
      MAX(event_date) AS max_event_date
    FROM earnings_calendar
    WHERE symbol IS NOT NULL
      AND symbol <> ''
  `);

  const newsRow = newsDist.rows[0] || { symbols: 0, top_share: 1 };
  const earningsRow = earnings.rows[0] || { symbols: 0, recent_or_upcoming_events: 0, max_event_date: null };
  const maxEventDate = earningsRow.max_event_date ? new Date(earningsRow.max_event_date) : null;
  const staleThreshold = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const isStale = !maxEventDate || Number.isNaN(maxEventDate.getTime()) || maxEventDate < staleThreshold;

  const payload = {
    generated_at: new Date().toISOString(),
    checks: {
      news_articles: {
        unique_symbols: Number(newsRow.symbols || 0),
        top_symbol_share: Number(newsRow.top_share || 0),
        pass: Number(newsRow.symbols || 0) >= 30 && Number(newsRow.top_share || 1) <= 0.3,
      },
      earnings_calendar: {
        validation_mode: "recent_or_upcoming",
        symbols: Number(earningsRow.symbols || 0),
        recent_or_upcoming_events: Number(earningsRow.recent_or_upcoming_events || 0),
        max_event_date: earningsRow.max_event_date || null,
        pass: Number(earningsRow.symbols || 0) >= 20
          && Number(earningsRow.recent_or_upcoming_events || 0) > 0
          && !isStale,
      },
    },
  };

  payload.ok = payload.checks.news_articles.pass && payload.checks.earnings_calendar.pass;
  payload.reason = [];
  if (!payload.checks.news_articles.pass) payload.reason.push("news_articles failed");
  if (!payload.checks.earnings_calendar.pass) payload.reason.push("earnings_calendar failed");

  const outputPath = path.resolve(__dirname, "../logs/pre-catalyst-check.json");
  ensureDir(outputPath);
  fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2));

  return payload;
}

async function validateStrictApis(): Promise<any> {
  const base = process.env.API_BASE || "http://localhost:3001";
  const apiKey = process.env.PROXY_API_KEY || "";
  const headers: Record<string, string> = { Accept: "application/json" };
  if (apiKey) headers["x-api-key"] = apiKey;

  const endpoints = [
    { key: "catalysts", path: "/api/catalysts" },
    { key: "signals", path: "/api/signals" },
    { key: "opportunities", path: "/api/opportunities" },
    { key: "macro", path: "/api/macro" },
  ];

  const checks: any[] = [];
  for (const endpoint of endpoints) {
    const response = await fetch(`${base}${endpoint.path}`, {
      method: "GET",
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });

    const payload = await response.json().catch(() => ({}));
    const success = payload?.success === true;
    const dataIsArray = Array.isArray(payload?.data);

    checks.push({
      endpoint: endpoint.path,
      status: response.status,
      success,
      dataIsArray,
      dataCount: dataIsArray ? payload.data.length : 0,
      pass: response.status === 200 && success && dataIsArray,
    });
  }

  const ok = checks.every((c) => c.pass);
  return { base, checks, ok };
}

async function run() {
  const client = await pool.connect();
  const reportPath = path.resolve(__dirname, "../logs/intelligence/catalyst-build-report.json");

  try {
    const precheck = await runPreCatalystValidation(client);
    if (!precheck.ok) {
      console.error("[BLOCKED] Step 0 failed. See logs/pre-catalyst-check.json");
      process.exitCode = 2;
      return;
    }

    await client.query("BEGIN");

    await ensureCatalystLayerSchema(client);

    await client.query(`TRUNCATE TABLE catalyst_events, catalyst_clusters, signals, opportunities, macro_narratives RESTART IDENTITY`);

    const newsCount = await buildNewsCatalysts(client);
    const intelCount = await buildIntelCatalysts(client);
    const earningsCount = await buildEarningsCatalysts(client);
    const ipoSplit = await buildIpoAndSplitCatalysts(client);
    const macroCount = await buildMacroNarratives(client);
    const clusterSignal = await buildClustersAndSignals(client);
    const opportunitiesResult = await buildOpportunities(client);
    const opportunitiesCount = typeof opportunitiesResult === "number"
      ? opportunitiesResult
      : Number(opportunitiesResult?.count || 0);

    const catalystsBefore = Number(newsCount || 0)
      + Number(intelCount || 0)
      + Number(earningsCount || 0)
      + Number(ipoSplit?.ipo || 0)
      + Number(ipoSplit?.split || 0);
    const clusterFilter = clusterSignal?.filterImpact?.clusters || {
      before: Number(clusterSignal?.clusters || 0),
      after: Number(clusterSignal?.clusters || 0),
      rejections: {},
    };
    const signalFilter = clusterSignal?.filterImpact?.signals || {
      before: Number(clusterSignal?.clusters || 0),
      after: Number(clusterSignal?.signals || 0),
      rejections: {},
    };
    const opportunityFilter = opportunitiesResult?.filterImpact?.opportunities || {
      before: Number(clusterSignal?.signals || 0),
      after: opportunitiesCount,
      rejections: {},
    };

    const duplicateAndNullChecks = await client.query(`
      SELECT
        (SELECT COUNT(*)::int
         FROM (
           SELECT source_table, source_id, symbol, COUNT(*)::int AS c
           FROM catalyst_events
           WHERE source_table IS NOT NULL AND source_id IS NOT NULL AND symbol IS NOT NULL
           GROUP BY source_table, source_id, symbol
           HAVING COUNT(*) > 1
         ) d) AS duplicate_catalyst_rows,
        (SELECT COUNT(*)::int FROM catalyst_events WHERE symbol IS NULL OR symbol = '') AS null_symbol_catalysts
    `);

    const validation = await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM catalyst_events WHERE source_table IN ('news_articles', 'intel_news', 'earnings_calendar', 'ipo_calendar', 'stock_splits')) AS catalyst_count,
        (SELECT COUNT(*)::int FROM catalyst_clusters) AS cluster_count,
        (SELECT COUNT(*)::int FROM signals) AS signal_count,
        (SELECT COUNT(*)::int FROM opportunities WHERE signal_ids IS NOT NULL AND array_length(signal_ids,1) > 0) AS opportunities_count,
        (SELECT COUNT(*)::int FROM signals WHERE catalyst_ids IS NULL OR array_length(catalyst_ids,1) = 0) AS invalid_signals,
        (SELECT COUNT(*)::int FROM opportunities WHERE signal_ids IS NULL OR array_length(signal_ids,1) = 0) AS invalid_opportunities
    `);

    const v = validation.rows[0];
    const dq = duplicateAndNullChecks.rows[0] || { duplicate_catalyst_rows: 0, null_symbol_catalysts: 0 };
    const blockers: string[] = [];
    if (Number(v.catalyst_count || 0) <= 20) blockers.push("catalyst_events count <= 20");
    if (Number(v.cluster_count || 0) <= 10) blockers.push("catalyst_clusters count <= 10");
    if (Number(v.invalid_signals || 0) > 0) blockers.push("signals missing catalyst_ids");
    if (Number(v.invalid_opportunities || 0) > 0) blockers.push("opportunities missing signal_ids");
    if (Number(dq.duplicate_catalyst_rows || 0) > 0) blockers.push("duplicate catalyst rows detected");
    if (Number(dq.null_symbol_catalysts || 0) > 0) blockers.push("null/empty symbol catalyst rows detected");
    if (Number(v.signal_count || 0) > 30) blockers.push("signals count > 30");
    if (Number(v.signal_count || 0) < 5) blockers.push("signals count < 5");
    if (Number(v.opportunities_count || 0) > 6) blockers.push("opportunities count > 6");

    if (blockers.length) {
      throw new Error(`Blocking validation failed: ${blockers.join('; ')}`);
    }

    const sampleCatalysts = await client.query(`
      SELECT event_uuid AS id, symbol, catalyst_type, headline, source_table, source_id, event_time, strength_score, sentiment_score
      FROM catalyst_events
      WHERE source_table IN ('news_articles', 'intel_news', 'earnings_calendar', 'ipo_calendar', 'stock_splits')
      ORDER BY event_time DESC NULLS LAST
      LIMIT 3
    `);

    const sampleSignals = await client.query(`
      SELECT id, symbol, signal_type, score, confidence, catalyst_ids
      FROM signals
      ORDER BY created_at DESC
      LIMIT 2
    `);

    const sampleOpportunities = await client.query(`
      SELECT id, symbol, strategy, entry, stop_loss, take_profit, expected_move_percent, confidence, signal_ids
      FROM opportunities
      WHERE signal_ids IS NOT NULL AND array_length(signal_ids,1) > 0
      ORDER BY updated_at DESC NULLS LAST, created_at DESC
      LIMIT 2
    `);

    let narrativeExample = "";
    if (sampleOpportunities.rows.length > 0 && sampleSignals.rows.length > 0) {
      const op = sampleOpportunities.rows[0];
      const sig = sampleSignals.rows[0];
      const catalystRows = await client.query(
        `SELECT headline
         FROM catalyst_events
         WHERE event_uuid = ANY($1::uuid[])
         ORDER BY CASE WHEN source_table = 'intel_news' THEN 0 ELSE 1 END, event_time DESC NULLS LAST
         LIMIT 3`,
        [sig.catalyst_ids || []]
      );
      narrativeExample = buildNarrative({
        symbol: op.symbol,
        signal_type: sig.signal_type,
        expected_move_percent: Number(op.expected_move_percent || 0),
        catalyst_headlines: catalystRows.rows.map((r) => r.headline),
        score: Number(sig.score || 0),
        confidence: Number(sig.confidence || 0),
      });
    }

    const distribution = await client.query(`
      WITH c AS (
        SELECT symbol, COUNT(*)::int AS n
        FROM catalyst_events
        WHERE symbol IS NOT NULL AND symbol <> ''
        GROUP BY symbol
      ), t AS (
        SELECT COALESCE(SUM(n),0)::int AS total, COALESCE(COUNT(*),0)::int AS unique_symbols FROM c
      )
      SELECT
        t.unique_symbols,
        t.total,
        COALESCE((SELECT symbol FROM c ORDER BY n DESC, symbol ASC LIMIT 1), NULL) AS top_symbol,
        COALESCE((SELECT n FROM c ORDER BY n DESC, symbol ASC LIMIT 1), 0)::int AS top_symbol_count,
        COALESCE((SELECT (n::numeric / NULLIF(t.total, 0)) FROM c ORDER BY n DESC, symbol ASC LIMIT 1), 0)::float8 AS top_symbol_share
      FROM t
    `);
    const dist = distribution.rows[0] || {
      unique_symbols: 0,
      top_symbol: null,
      top_symbol_count: 0,
      top_symbol_share: 0,
    };

    const report = {
      generated_at: new Date().toISOString(),
      precheck,
      step_counts: {
        news_catalysts: newsCount,
        intel_catalysts: intelCount,
        earnings_catalysts: earningsCount,
        ipo_catalysts: ipoSplit.ipo,
        split_catalysts: ipoSplit.split,
        macro_narratives: macroCount,
        clusters: clusterSignal.clusters,
        signals: clusterSignal.signals,
        opportunities: opportunitiesCount,
      },
      final_counts: {
        catalyst_count: Number(v.catalyst_count || 0),
        cluster_count: Number(v.cluster_count || 0),
        signal_count: Number(v.signal_count || 0),
        opportunities_count: Number(v.opportunities_count || 0),
      },
      integrity: {
        invalid_signals: Number(v.invalid_signals || 0),
        invalid_opportunities: Number(v.invalid_opportunities || 0),
        duplicate_catalyst_rows: Number(dq.duplicate_catalyst_rows || 0),
        null_symbol_catalysts: Number(dq.null_symbol_catalysts || 0),
      },
      distribution_check: {
        symbol_diversity: Number(dist.unique_symbols || 0),
        top_symbol: dist.top_symbol || null,
        top_symbol_count: Number(dist.top_symbol_count || 0),
        top_symbol_share: Number(dist.top_symbol_share || 0),
      },
      samples: {
        catalysts: sampleCatalysts.rows,
        signals: sampleSignals.rows,
        opportunities: sampleOpportunities.rows,
      },
      narrative_example: narrativeExample,
      ok: true,
    };

    const filterImpact = {
      generated_at: new Date().toISOString(),
      before_after: {
        catalysts: {
          before: catalystsBefore,
          after: Number(v.catalyst_count || 0),
        },
        clusters: {
          before: Number(clusterFilter.before || 0),
          after: Number(clusterFilter.after || 0),
        },
        signals: {
          before: Number(signalFilter.before || 0),
          after: Number(signalFilter.after || 0),
        },
        opportunities: {
          before: Number(opportunityFilter.before || 0),
          after: Number(opportunityFilter.after || 0),
        },
      },
      rejection_reasons: {
        clusters: clusterFilter.rejections || {},
        signals: signalFilter.rejections || {},
        opportunities: opportunityFilter.rejections || {},
      },
    };

    const filterImpactPath = path.resolve(__dirname, "../logs/filter-impact.json");
    ensureDir(filterImpactPath);
    fs.writeFileSync(filterImpactPath, JSON.stringify(filterImpact, null, 2));
    report.filter_impact = filterImpact;

    const eliteMetricsRows = await client.query(`
      SELECT symbol, confidence, expected_move_percent, score
      FROM opportunities
      WHERE signal_ids IS NOT NULL AND array_length(signal_ids,1) > 0
      ORDER BY confidence DESC NULLS LAST
    `);

    const eliteMetricsData = eliteMetricsRows.rows || [];
    const avgConfidence = eliteMetricsData.length
      ? eliteMetricsData.reduce((a, b) => a + Number(b.confidence || 0), 0) / eliteMetricsData.length
      : 0;
    const avgExpectedMove = eliteMetricsData.length
      ? eliteMetricsData.reduce((a, b) => a + Number(b.expected_move_percent || 0), 0) / eliteMetricsData.length
      : 0;

    const convictionRanked = eliteMetricsData
      .map((r) => {
        const confidence = Number(r.confidence || 0);
        const clusterScore = Number(r.score || 0);
        const expectedMove = Number(r.expected_move_percent || 0);
        const convictionScore = confidence * 0.5 + clusterScore * 0.3 + (expectedMove / 10) * 0.2;
        return {
          symbol: r.symbol,
          conviction_score: Number(convictionScore.toFixed(6)),
          confidence,
          cluster_score: Number((clusterScore * 100).toFixed(6)),
          expected_move_percent: expectedMove,
        };
      })
      .sort((a, b) => b.conviction_score - a.conviction_score)
      .slice(0, 3);

    const eliteMetrics = {
      generated_at: new Date().toISOString(),
      avg_confidence: Number(avgConfidence.toFixed(6)),
      avg_expected_move_percent: Number(avgExpectedMove.toFixed(6)),
      top_3_conviction_scores: convictionRanked,
    };

    const eliteMetricsPath = path.resolve(__dirname, "../logs/elite-metrics.json");
    ensureDir(eliteMetricsPath);
    fs.writeFileSync(eliteMetricsPath, JSON.stringify(eliteMetrics, null, 2));
    report.elite_metrics = eliteMetrics;

    ensureDir(reportPath);
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    await client.query("COMMIT");

    const apiValidation = await validateStrictApis();
    if (!apiValidation.ok) {
      throw new Error(`API validation failed: ${JSON.stringify(apiValidation.checks)}`);
    }

    report.api_validation = apiValidation;
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    console.log(JSON.stringify(report, null, 2));
  } catch (error: any) {
    try {
      await client.query("ROLLBACK");
    } catch (_rollbackError) {
      // no-op
    }

    const failure = {
      generated_at: new Date().toISOString(),
      ok: false,
      error: error?.message || String(error),
    };
    ensureDir(reportPath);
    fs.writeFileSync(reportPath, JSON.stringify(failure, null, 2));
    console.error(error?.stack || error?.message || error);
    process.exitCode = 2;
  } finally {
    client.release();
    await pool.end();
  }
}

run();
