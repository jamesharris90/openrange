const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../server/.env') });
const { queryWithTimeout, pool } = require('../server/db/pg');

const ROOT = path.join(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'logs');

function ensureLogDir() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function writeJson(fileName, payload) {
  ensureLogDir();
  const outPath = path.join(LOG_DIR, fileName);
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  return outPath;
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function avg(rows, key) {
  if (!rows.length) return 0;
  return Number((rows.reduce((s, r) => s + num(r[key], 0), 0) / rows.length).toFixed(4));
}

async function getTableColumns(tableName) {
  const res = await queryWithTimeout(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1
     ORDER BY ordinal_position`,
    [tableName],
    { timeoutMs: 10000, label: `elite.cols.${tableName}`, maxRetries: 0 }
  );
  return new Set((res.rows || []).map((r) => r.column_name));
}

async function fetchTopFromDecisionView(limit) {
  const cols = await getTableColumns('decision_view');

  const hasTrend = cols.has('trend_alignment');
  const hasQuality = cols.has('quality_score');
  const hasSip = cols.has('sip_score');

  const sql = `
    SELECT
      symbol,
      COALESCE(final_score, 0)::numeric AS final_score,
      COALESCE(relative_volume, 0)::numeric AS relative_volume,
      COALESCE(gap_percent, 0)::numeric AS gap_percent,
      ${hasTrend ? 'COALESCE(trend_alignment, false)' : 'false'} AS trend_alignment,
      ${hasQuality ? 'COALESCE(quality_score, 0)::numeric' : '0::numeric'} AS quality_score,
      ${hasSip ? 'COALESCE(sip_score, 0)::numeric' : '0::numeric'} AS sip_score
    FROM decision_view
    ORDER BY final_score DESC NULLS LAST
    LIMIT ${Number(limit)}
  `;

  const res = await queryWithTimeout(sql, [], {
    timeoutMs: 30000,
    label: `elite.top.${limit}`,
    maxRetries: 0,
  });

  return (res.rows || []).map((r, i) => ({
    rank: i + 1,
    symbol: r.symbol,
    final_score: num(r.final_score, 0),
    relative_volume: num(r.relative_volume, 0),
    gap_percent: num(r.gap_percent, 0),
    trend_alignment: Boolean(r.trend_alignment),
    quality_score: num(r.quality_score, 0),
    sip_score: num(r.sip_score, 0),
  }));
}

function analyzeTop10(rows) {
  const top10 = rows.slice(0, 10);
  const rank1 = top10[0]?.final_score ?? 0;
  const rank10 = top10[9]?.final_score ?? 0;
  const rank1QualityAware = top10[0] ? (num(top10[0].final_score, 0) + (num(top10[0].quality_score, 0) * 0.5)) : 0;
  const rank10QualityAware = top10[9] ? (num(top10[9].final_score, 0) + (num(top10[9].quality_score, 0) * 0.5)) : 0;

  const validCount = top10.filter((r) => {
    const gapClean = r.gap_percent >= 2 && r.gap_percent <= 15;
    return r.relative_volume >= 2 || gapClean || r.trend_alignment;
  }).length;

  return {
    count: top10.length,
    avg_relative_volume: avg(top10, 'relative_volume'),
    avg_gap_percent: avg(top10, 'gap_percent'),
    trend_alignment_count: top10.filter((r) => r.trend_alignment).length,
    low_rvol_count: top10.filter((r) => r.relative_volume < 2).length,
    extreme_gap_count: top10.filter((r) => r.gap_percent > 15).length,
    clean_gap_count: top10.filter((r) => r.gap_percent >= 3 && r.gap_percent <= 15).length,
    valid_percent: top10.length ? Number(((validCount / top10.length) * 100).toFixed(2)) : 0,
    score_spread_rank1_to_rank10: Number((rank1 - rank10).toFixed(4)),
    quality_aware_spread_rank1_to_rank10: Number((rank1QualityAware - rank10QualityAware).toFixed(4)),
  };
}

async function applyEliteQualityLayer() {
  const sourceTable = `decision_view_elite_source_${Date.now()}`;

  await queryWithTimeout(
    `CREATE TABLE ${sourceTable} AS
     SELECT * FROM decision_view`,
    [],
    { timeoutMs: 30000, label: 'elite.source.create', maxRetries: 0 }
  );

  const coreCols = await getTableColumns(sourceTable);
  const mmCols = await getTableColumns('market_metrics');

  const coreHasTrend = coreCols.has('trend_alignment');
  const coreHasSpread = coreCols.has('spread') || coreCols.has('bid_ask_spread') || coreCols.has('avg_spread');
  const coreSpreadCol = coreCols.has('spread') ? 'spread' : (coreCols.has('bid_ask_spread') ? 'bid_ask_spread' : (coreCols.has('avg_spread') ? 'avg_spread' : null));
  const coreHasThreshold = coreCols.has('threshold');

  let trendExpr = 'false';
  if (coreHasTrend) {
    trendExpr = 'COALESCE(c.trend_alignment, false)';
  } else if (mmCols.has('price') && mmCols.has('ema_9') && mmCols.has('ema_20')) {
    trendExpr = '(COALESCE(mm.price, 0) > COALESCE(mm.ema_9, 0) AND COALESCE(mm.ema_9, 0) > COALESCE(mm.ema_20, 0))';
  } else if (mmCols.has('price') && mmCols.has('sma_20') && mmCols.has('sma_50')) {
    trendExpr = '(COALESCE(mm.price, 0) > COALESCE(mm.sma_20, 0) AND COALESCE(mm.sma_20, 0) > COALESCE(mm.sma_50, 0))';
  } else {
    trendExpr = '(COALESCE(c.relative_volume, 0) >= 2 AND COALESCE(c.gap_percent, 0) BETWEEN 0 AND 12)';
  }

  const spreadExpr = coreHasSpread && coreSpreadCol ? `COALESCE(c.${coreSpreadCol}, 999)` : '999';
  const thresholdExpr = coreHasThreshold ? 'COALESCE(c.threshold, 0.03)' : '0.03';

  const selectList = [];
  for (const col of coreCols) {
    if (col === 'final_score') {
      selectList.push(`CASE
        WHEN b.max_score = b.min_score THEN 50
        ELSE POWER(
          GREATEST(
            0,
            LEAST(1, ((i.elite_new_final_score - b.min_score) / NULLIF((b.max_score - b.min_score), 0)))
          ),
          2.2
        ) * 100
      END::numeric AS final_score`);
      continue;
    }

    if (col === 'quality_score') {
      selectList.push('i.quality_score_calc::numeric AS quality_score');
      continue;
    }

    if (col === 'new_final_score') {
      selectList.push('i.elite_new_final_score::numeric AS new_final_score');
      continue;
    }

    if (col === 'trend_alignment') {
      selectList.push('i.trend_alignment_calc::boolean AS trend_alignment');
      continue;
    }

    selectList.push(`i.${col}`);
  }

  if (!coreCols.has('quality_score')) selectList.push('i.quality_score_calc::numeric AS quality_score');
  if (!coreCols.has('new_final_score')) selectList.push('i.elite_new_final_score::numeric AS new_final_score');
  if (!coreCols.has('trend_alignment')) selectList.push('i.trend_alignment_calc::boolean AS trend_alignment');

  const viewSql = `
    CREATE OR REPLACE VIEW decision_view AS
    WITH latest_mm AS (
      SELECT DISTINCT ON (UPPER(m.symbol))
        UPPER(m.symbol) AS symbol_key,
        m.*
      FROM market_metrics m
      WHERE m.symbol IS NOT NULL
      ORDER BY UPPER(m.symbol), COALESCE(m.updated_at, m.last_updated, NOW()) DESC
    ),
    base AS (
      SELECT
        c.*,
        (${trendExpr})::boolean AS trend_alignment_calc,
        (${spreadExpr})::numeric AS spread_value,
        (${thresholdExpr})::numeric AS threshold_value
      FROM ${sourceTable} c
      LEFT JOIN latest_mm mm ON mm.symbol_key = c.symbol
    ),
    q1 AS (
      SELECT
        base.*,
        (
          CASE
            WHEN COALESCE(base.relative_volume, 0) >= 5 THEN 20
            WHEN COALESCE(base.relative_volume, 0) >= 3 THEN 15
            WHEN COALESCE(base.relative_volume, 0) >= 2 THEN 10
            ELSE 0
          END
          + CASE
            WHEN COALESCE(base.relative_volume, 0) >= 20 THEN 10
            WHEN COALESCE(base.relative_volume, 0) >= 10 THEN 5
            ELSE 0
          END
          + CASE
            WHEN COALESCE(base.gap_percent, 0) BETWEEN 3 AND 10 THEN 15
            WHEN COALESCE(base.gap_percent, 0) > 10 THEN 10
            ELSE 0
          END
          + CASE
            WHEN COALESCE(base.trend_alignment_calc, false) THEN 15
            ELSE 0
          END
          + CASE
            WHEN COALESCE(base.spread_value, 999) < COALESCE(base.threshold_value, 0.03) THEN 10
            ELSE 0
          END
        )::numeric AS quality_pre_penalty
      FROM base
    ),
    q2 AS (
      SELECT
        q1.*,
        (
          q1.quality_pre_penalty
          + CASE
            WHEN COALESCE(q1.gap_percent, 0) > 15 AND COALESCE(q1.relative_volume, 0) < 2 THEN -15
            ELSE 0
          END
          + CASE
            WHEN COALESCE(q1.relative_volume, 0) < 1.5 AND ABS(COALESCE(q1.gap_percent, 0)) < 2 THEN -10
            ELSE 0
          END
        )::numeric AS quality_score_calc
      FROM q1
    ),
    i AS (
      SELECT
        q2.*,
        ((COALESCE(q2.final_score, 0) * 0.7) + (COALESCE(q2.quality_score_calc, 0) * 0.5))::numeric AS elite_new_final_score
      FROM q2
    ),
    b AS (
      SELECT
        COALESCE(MIN(i.elite_new_final_score), 0)::numeric AS min_score,
        COALESCE(MAX(i.elite_new_final_score), 0)::numeric AS max_score
      FROM i
    )
    SELECT
      ${selectList.join(',\n      ')}
    FROM i
    CROSS JOIN b
  `;

  await queryWithTimeout(viewSql, [], {
    timeoutMs: 120000,
    label: 'elite.apply.view',
    maxRetries: 0,
  });
}

async function main() {
  const baselineTop15 = await fetchTopFromDecisionView(15);
  const baselineTop10 = analyzeTop10(baselineTop15);

  writeJson('elite_precheck.json', {
    ts: new Date().toISOString(),
    top15: baselineTop15.map((r) => ({
      symbol: r.symbol,
      final_score: r.final_score,
      relative_volume: r.relative_volume,
      gap_percent: r.gap_percent,
    })),
    top10_metrics: baselineTop10,
  });

  await applyEliteQualityLayer();

  const postTop15 = await fetchTopFromDecisionView(15);
  const postTop10 = analyzeTop10(postTop15);

  const checks = {
    valid_percent_gte_70: postTop10.valid_percent >= 70,
    score_spread_improved: postTop10.quality_aware_spread_rank1_to_rank10 > baselineTop10.quality_aware_spread_rank1_to_rank10,
    avg_rvol_improved: postTop10.avg_relative_volume >= baselineTop10.avg_relative_volume,
    low_rvol_not_increased: postTop10.low_rvol_count <= baselineTop10.low_rvol_count,
    extreme_gap_not_dominant: postTop10.extreme_gap_count <= 2 && postTop10.extreme_gap_count <= baselineTop10.extreme_gap_count,
    trend_alignment_present: postTop10.trend_alignment_count >= 1,
  };

  const pass = Object.values(checks).every(Boolean);

  writeJson('elite_postcheck.json', {
    ts: new Date().toISOString(),
    top15: postTop15,
    baseline_top10_metrics: baselineTop10,
    post_top10_metrics: postTop10,
    checks,
    verdict: pass ? 'PASS' : 'FAIL',
  });

  if (!pass) {
    console.log('ELITE FILTER: INACTIVE');
    console.log(JSON.stringify({ verdict: 'FAIL', checks }, null, 2));
    process.exit(1);
  }

  console.log('ELITE FILTER: ACTIVE');
  console.log(JSON.stringify({
    verdict: 'PASS',
    baseline_spread: baselineTop10.score_spread_rank1_to_rank10,
    post_spread: postTop10.score_spread_rank1_to_rank10,
    post_valid_percent: postTop10.valid_percent,
    outputs: {
      precheck: 'logs/elite_precheck.json',
      postcheck: 'logs/elite_postcheck.json',
    },
  }, null, 2));
}

main()
  .catch((err) => {
    writeJson('elite_postcheck.json', {
      ts: new Date().toISOString(),
      verdict: 'FAIL',
      error: err.message,
    });
    console.error('[ELITE_FILTER_FAILED]', err.message);
    process.exit(1);
  })
  .finally(async () => {
    try {
      await pool.end();
    } catch {}
  });
