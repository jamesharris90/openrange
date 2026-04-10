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
  const target = path.join(LOG_DIR, fileName);
  fs.writeFileSync(target, JSON.stringify(payload, null, 2));
  return target;
}

async function tableColumns(tableName) {
  const result = await queryWithTimeout(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1
     ORDER BY ordinal_position`,
    [tableName],
    { timeoutMs: 10000, label: `cols.${tableName}`, maxRetries: 0 }
  );
  return (result.rows || []).map((r) => r.column_name);
}

async function phase3SessionLogic() {
  await queryWithTimeout(
    `DROP TABLE IF EXISTS tmp_latest_volume_accel`,
    [],
    { timeoutMs: 10000, label: 'phase3.tmp.drop', maxRetries: 0 }
  );

  await queryWithTimeout(
    `CREATE TEMP TABLE tmp_latest_volume_accel AS
     SELECT DISTINCT ON (UPPER(symbol))
       UPPER(symbol) AS symbol,
       COALESCE((volume / NULLIF(avg_volume_30d / 78.0, 0)), 0)::numeric AS volume_acceleration
     FROM market_metrics
     WHERE symbol IS NOT NULL
     ORDER BY UPPER(symbol), COALESCE(updated_at, last_updated, NOW()) DESC`,
    [],
    { timeoutMs: 30000, label: 'phase3.tmp.create', maxRetries: 0 }
  );

  await queryWithTimeout(
    `CREATE INDEX IF NOT EXISTS idx_tmp_latest_volume_accel_symbol ON tmp_latest_volume_accel(symbol)`,
    [],
    { timeoutMs: 10000, label: 'phase3.tmp.index', maxRetries: 0 }
  );

  await queryWithTimeout(
    `UPDATE signals s
     SET session_phase = CASE
       WHEN ((EXTRACT(HOUR FROM (COALESCE(s.created_at, NOW()) AT TIME ZONE 'Europe/London')) * 60)
           + EXTRACT(MINUTE FROM (COALESCE(s.created_at, NOW()) AT TIME ZONE 'Europe/London'))) < 780
         THEN 'premarket_early'
       WHEN ((EXTRACT(HOUR FROM (COALESCE(s.created_at, NOW()) AT TIME ZONE 'Europe/London')) * 60)
           + EXTRACT(MINUTE FROM (COALESCE(s.created_at, NOW()) AT TIME ZONE 'Europe/London'))) < 870
         THEN 'premarket_peak'
       WHEN ((EXTRACT(HOUR FROM (COALESCE(s.created_at, NOW()) AT TIME ZONE 'Europe/London')) * 60)
           + EXTRACT(MINUTE FROM (COALESCE(s.created_at, NOW()) AT TIME ZONE 'Europe/London'))) < 930
         THEN 'market_open'
       ELSE 'intraday'
     END,
     volume_acceleration = COALESCE(tmp.volume_acceleration, 0)
     FROM tmp_latest_volume_accel tmp
     WHERE tmp.symbol = UPPER(s.symbol)`,
    [],
    { timeoutMs: 180000, label: 'phase3.update.signals', maxRetries: 0 }
  );

  await queryWithTimeout(
    `UPDATE signals
     SET volume_acceleration = COALESCE(volume_acceleration, 0)
     WHERE volume_acceleration IS NULL`,
    [],
    { timeoutMs: 30000, label: 'phase3.fill.signals.null_volume_accel', maxRetries: 0 }
  );

  await queryWithTimeout(
    `UPDATE stocks_in_play sip
     SET session_phase = CASE
       WHEN ((EXTRACT(HOUR FROM (COALESCE(sip.detected_at, NOW()) AT TIME ZONE 'Europe/London')) * 60)
           + EXTRACT(MINUTE FROM (COALESCE(sip.detected_at, NOW()) AT TIME ZONE 'Europe/London'))) < 780
         THEN 'premarket_early'
       WHEN ((EXTRACT(HOUR FROM (COALESCE(sip.detected_at, NOW()) AT TIME ZONE 'Europe/London')) * 60)
           + EXTRACT(MINUTE FROM (COALESCE(sip.detected_at, NOW()) AT TIME ZONE 'Europe/London'))) < 870
         THEN 'premarket_peak'
       WHEN ((EXTRACT(HOUR FROM (COALESCE(sip.detected_at, NOW()) AT TIME ZONE 'Europe/London')) * 60)
           + EXTRACT(MINUTE FROM (COALESCE(sip.detected_at, NOW()) AT TIME ZONE 'Europe/London'))) < 930
         THEN 'market_open'
       ELSE 'intraday'
     END,
     volume_acceleration = COALESCE(tmp.volume_acceleration, 0)
     FROM tmp_latest_volume_accel tmp
     WHERE tmp.symbol = UPPER(sip.symbol)`,
    [],
    { timeoutMs: 180000, label: 'phase3.update.stocks_in_play', maxRetries: 0 }
  );

  await queryWithTimeout(
    `UPDATE stocks_in_play
     SET volume_acceleration = COALESCE(volume_acceleration, 0)
     WHERE volume_acceleration IS NULL`,
    [],
    { timeoutMs: 30000, label: 'phase3.fill.stocks_in_play.null_volume_accel', maxRetries: 0 }
  );

  const sampleSignals = await queryWithTimeout(
    `SELECT symbol, session_phase, volume_acceleration
     FROM signals
     WHERE symbol IS NOT NULL
     ORDER BY created_at DESC
     LIMIT 10`,
    [],
    { timeoutMs: 10000, label: 'phase3.sample.signals', maxRetries: 0 }
  );

  const sampleSip = await queryWithTimeout(
    `SELECT symbol, session_phase, volume_acceleration
     FROM stocks_in_play
     WHERE symbol IS NOT NULL
     ORDER BY detected_at DESC
     LIMIT 10`,
    [],
    { timeoutMs: 10000, label: 'phase3.sample.stocks_in_play', maxRetries: 0 }
  );

  const badSignals = (sampleSignals.rows || []).filter((r) => r.session_phase == null || r.volume_acceleration == null).length;
  const badSip = (sampleSip.rows || []).filter((r) => r.session_phase == null || r.volume_acceleration == null).length;

  const out = {
    ts: new Date().toISOString(),
    sampled_signals: (sampleSignals.rows || []).length,
    sampled_stocks_in_play: (sampleSip.rows || []).length,
    bad_signals: badSignals,
    bad_stocks_in_play: badSip,
    pass: (sampleSignals.rows || []).length === 10 && (sampleSip.rows || []).length === 10 && badSignals === 0 && badSip === 0,
  };

  writeJson('intelligence_phase3_session_logic.json', out);
  if (!out.pass) throw new Error('PHASE_3_FAILED_SAMPLE_POPULATION');
  return out;
}

async function phase4NewsIntegration() {
  const cols = await tableColumns('news_articles');
  if (cols.length === 0) throw new Error('PHASE_4_FAILED_NEWS_TABLE_MISSING');

  const timeCol = cols.includes('published_at') ? 'published_at' : (cols.includes('created_at') ? 'created_at' : null);
  if (!timeCol) throw new Error('PHASE_4_FAILED_NEWS_TIME_COLUMN_MISSING');

  await queryWithTimeout(
    `WITH news_score AS (
       SELECT
         UPPER(symbol) AS symbol,
         MAX(
           CASE
             WHEN ${timeCol} >= NOW() - interval '2 hours' THEN 2
             WHEN ${timeCol} >= NOW() - interval '6 hours' THEN 1
             ELSE 0
           END
         )::numeric AS score
       FROM news_articles
       WHERE symbol IS NOT NULL
       GROUP BY UPPER(symbol)
     )
     UPDATE signals s
     SET priority_score = COALESCE(s.priority_score, 0) + COALESCE(ns.score, 0)
     FROM news_score ns
     WHERE UPPER(s.symbol) = ns.symbol`,
    [],
    { timeoutMs: 45000, label: 'phase4.update.priority_with_news', maxRetries: 0 }
  );

  const randomSymbols = await queryWithTimeout(
    `SELECT symbol
     FROM (
       SELECT DISTINCT UPPER(symbol) AS symbol
       FROM signals
       WHERE symbol IS NOT NULL
     ) t
     ORDER BY random()
     LIMIT 10`,
    [],
    { timeoutMs: 10000, label: 'phase4.random_symbols', maxRetries: 0 }
  );

  const symbols = (randomSymbols.rows || []).map((r) => r.symbol);
  const sample = symbols.length === 0
    ? { rows: [] }
    : await queryWithTimeout(
      `SELECT UPPER(s.symbol) AS symbol, s.priority_score
       FROM signals s
       WHERE UPPER(s.symbol) = ANY($1::text[])
       ORDER BY s.priority_score DESC NULLS LAST`,
      [symbols],
      { timeoutMs: 10000, label: 'phase4.sample_scores', maxRetries: 0 }
    );

  const out = {
    ts: new Date().toISOString(),
    news_time_column: timeCol,
    sampled_symbols: symbols.length,
    sample: sample.rows || [],
    pass: symbols.length > 0,
  };

  writeJson('intelligence_phase4_news.json', out);
  if (!out.pass) throw new Error('PHASE_4_FAILED_SAMPLE_EMPTY');
  return out;
}

async function phase5EarningsEngine() {
  const cols = await tableColumns('earnings_events');
  if (cols.length === 0) throw new Error('PHASE_5_FAILED_EARNINGS_TABLE_MISSING');

  const symbolCol = cols.includes('symbol') ? 'symbol' : null;
  const dateCol = cols.includes('report_date') ? 'report_date' : (cols.includes('earnings_date') ? 'earnings_date' : null);
  if (!symbolCol || !dateCol) throw new Error('PHASE_5_FAILED_REQUIRED_COLUMNS_MISSING');

  await queryWithTimeout(
    `DROP TABLE IF EXISTS earnings_calendar`,
    [],
    { timeoutMs: 10000, label: 'phase5.drop.table.earnings_calendar', maxRetries: 0 }
  );

  await queryWithTimeout(
    `DROP MATERIALIZED VIEW IF EXISTS earnings_calendar`,
    [],
    { timeoutMs: 10000, label: 'phase5.drop.matview.earnings_calendar', maxRetries: 0 }
  );

  await queryWithTimeout(
    `DROP VIEW IF EXISTS earnings_calendar`,
    [],
    { timeoutMs: 10000, label: 'phase5.drop.view.earnings_calendar', maxRetries: 0 }
  );

  await queryWithTimeout(
    `CREATE OR REPLACE VIEW earnings_calendar AS
     SELECT
       ${symbolCol} AS symbol,
       ${dateCol}::date AS report_date,
       CASE
         WHEN ${dateCol}::date = CURRENT_DATE THEN 'today'
         WHEN ${dateCol}::date = CURRENT_DATE + 1 THEN 'tomorrow'
         ELSE 'upcoming'
       END AS timing
     FROM earnings_events
     WHERE ${symbolCol} IS NOT NULL`,
    [],
    { timeoutMs: 20000, label: 'phase5.create.earnings_calendar', maxRetries: 0 }
  );

  await queryWithTimeout(
    `UPDATE signals s
     SET priority_score = COALESCE(s.priority_score, 0) + 2
     FROM earnings_calendar ec
     WHERE UPPER(s.symbol) = UPPER(ec.symbol)
       AND ec.report_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 3`,
    [],
    { timeoutMs: 30000, label: 'phase5.update.priority_with_earnings', maxRetries: 0 }
  );

  const sample = await queryWithTimeout(
    `SELECT ec.symbol, ec.report_date, ec.timing,
            MAX(s.priority_score) AS priority_score
     FROM earnings_calendar ec
     LEFT JOIN signals s ON UPPER(s.symbol) = UPPER(ec.symbol)
     WHERE ec.report_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 3
     GROUP BY ec.symbol, ec.report_date, ec.timing
     ORDER BY ec.report_date ASC
     LIMIT 10`,
    [],
    { timeoutMs: 10000, label: 'phase5.sample.earnings', maxRetries: 0 }
  );

  const out = {
    ts: new Date().toISOString(),
    symbol_column: symbolCol,
    date_column: dateCol,
    sampled_rows: (sample.rows || []).length,
    sample: sample.rows || [],
    pass: true,
  };

  writeJson('intelligence_phase5_earnings.json', out);
  return out;
}

async function phase6LearningLayer() {
  await queryWithTimeout(
    `DROP TABLE IF EXISTS symbol_learning_metrics`,
    [],
    { timeoutMs: 10000, label: 'phase6.drop.table.symbol_learning_metrics', maxRetries: 0 }
  );

  await queryWithTimeout(
    `DROP MATERIALIZED VIEW IF EXISTS symbol_learning_metrics`,
    [],
    { timeoutMs: 10000, label: 'phase6.drop.matview.symbol_learning_metrics', maxRetries: 0 }
  );

  await queryWithTimeout(
    `DROP VIEW IF EXISTS symbol_learning_metrics`,
    [],
    { timeoutMs: 10000, label: 'phase6.drop.view.symbol_learning_metrics', maxRetries: 0 }
  );

  await queryWithTimeout(
    `CREATE OR REPLACE VIEW symbol_learning_metrics AS
     SELECT
       UPPER(symbol) AS symbol,
       AVG(CASE WHEN COALESCE(pnl_pct, 0) > 0 THEN 1 ELSE 0 END)::numeric AS win_rate,
       AVG(COALESCE(pnl_pct, 0))::numeric AS avg_return
     FROM trade_outcomes
     WHERE symbol IS NOT NULL
     GROUP BY UPPER(symbol)`,
    [],
    { timeoutMs: 20000, label: 'phase6.create.learning_view', maxRetries: 0 }
  );

  await queryWithTimeout(
    `UPDATE signals s
     SET priority_score = COALESCE(s.priority_score, 0) + (COALESCE(lm.win_rate, 0) * 2)
     FROM symbol_learning_metrics lm
     WHERE UPPER(s.symbol) = lm.symbol`,
    [],
    { timeoutMs: 30000, label: 'phase6.update.priority_with_learning', maxRetries: 0 }
  );

  const top = await queryWithTimeout(
    `SELECT s.symbol, s.priority_score, lm.win_rate, lm.avg_return
     FROM signals s
     LEFT JOIN symbol_learning_metrics lm ON UPPER(s.symbol) = lm.symbol
     WHERE s.symbol IS NOT NULL
     ORDER BY s.priority_score DESC NULLS LAST
     LIMIT 10`,
    [],
    { timeoutMs: 10000, label: 'phase6.sample.top', maxRetries: 0 }
  );

  const out = {
    ts: new Date().toISOString(),
    top_symbols: top.rows || [],
    pass: (top.rows || []).length > 0,
  };

  writeJson('intelligence_phase6_learning.json', out);
  if (!out.pass) throw new Error('PHASE_6_FAILED_NO_TOP_SYMBOLS');
  return out;
}

async function phase7DataQuality() {
  const cols = await tableColumns('market_metrics');
  const hasRelVol = cols.includes('relative_volume');
  const hasVolume = cols.includes('volume');
  const hasAvgVol = cols.includes('avg_volume_30d');
  const hasGap = cols.includes('gap_percent');

  if (hasRelVol && hasVolume && hasAvgVol) {
    await queryWithTimeout(
      `UPDATE market_metrics
       SET relative_volume = (volume / NULLIF(avg_volume_30d, 0))
       WHERE relative_volume IS NULL
         AND volume IS NOT NULL
         AND avg_volume_30d IS NOT NULL
         AND avg_volume_30d > 0`,
      [],
      { timeoutMs: 30000, label: 'phase7.fill.relative_volume', maxRetries: 0 }
    );
  }

  const nullStats = await queryWithTimeout(
    `SELECT
       COUNT(*) FILTER (WHERE relative_volume IS NULL)::int AS relative_volume_nulls,
       COUNT(*) FILTER (WHERE gap_percent IS NULL)::int AS gap_percent_nulls,
       COUNT(*) FILTER (WHERE avg_volume_30d IS NULL)::int AS avg_volume_30d_nulls,
       COUNT(*)::int AS total_rows
     FROM market_metrics`,
    [],
    { timeoutMs: 10000, label: 'phase7.null_stats', maxRetries: 0 }
  );

  const badNan = await queryWithTimeout(
    `SELECT COUNT(*)::int AS n
     FROM market_metrics
     WHERE relative_volume::text = 'NaN'
        OR gap_percent::text = 'NaN'
        OR avg_volume_30d::text = 'NaN'`,
    [],
    { timeoutMs: 10000, label: 'phase7.nan_check', maxRetries: 0 }
  );

  const out = {
    ts: new Date().toISOString(),
    has_columns: {
      relative_volume: hasRelVol,
      volume: hasVolume,
      avg_volume_30d: hasAvgVol,
      gap_percent: hasGap,
    },
    null_stats: nullStats.rows?.[0] || null,
    nan_rows: Number(badNan.rows?.[0]?.n || 0),
    pass: Number(badNan.rows?.[0]?.n || 0) === 0,
  };

  writeJson('intelligence_phase7_data_quality.json', out);
  if (!out.pass) throw new Error('PHASE_7_FAILED_NAN_DETECTED');
  return out;
}

async function phase8DecisionFeedValidation() {
  const base = process.env.API_BASE || 'http://127.0.0.1:3001';
  const headers = { Accept: 'application/json' };
  if (process.env.PROXY_API_KEY) headers['x-api-key'] = process.env.PROXY_API_KEY;

  const response = await fetch(`${base}/api/intelligence/top-opportunities?limit=20`, { headers });
  const payload = await response.json().catch(() => ({}));

  const items = Array.isArray(payload?.items) ? payload.items : [];
  const withScore = items.filter((r) => Number.isFinite(Number(r?.decision_score)));
  const out = {
    ts: new Date().toISOString(),
    status: response.status,
    total_items: items.length,
    scored_items: withScore.length,
    pass: response.status === 200 && withScore.length >= 10,
  };

  writeJson('intelligence_phase8_decision_feed.json', out);
  if (!out.pass) throw new Error('PHASE_8_FAILED_DECISION_FEED');
  return out;
}

async function phase9FinalValidation() {
  const lifecycle = await queryWithTimeout(
    `SELECT COUNT(DISTINCT s.symbol)::int AS n
     FROM signals s
     JOIN trade_setups ts ON s.id = ts.signal_id
     JOIN signal_outcomes so ON s.id = so.signal_id`,
    [],
    { timeoutMs: 15000, label: 'phase9.lifecycle', maxRetries: 0 }
  );

  const signalsRecent = await queryWithTimeout(
    `SELECT COUNT(*)::int AS n
     FROM signals
     WHERE created_at > NOW() - interval '15 minutes'`,
    [],
    { timeoutMs: 10000, label: 'phase9.signals_recent', maxRetries: 0 }
  );

  const filteredCount = await queryWithTimeout(
    `SELECT COUNT(*)::int AS n FROM stocks_in_play_filtered`,
    [],
    { timeoutMs: 10000, label: 'phase9.filtered_count', maxRetries: 0 }
  );

  const base = process.env.API_BASE || 'http://127.0.0.1:3001';
  const headers = { Accept: 'application/json' };
  if (process.env.PROXY_API_KEY) headers['x-api-key'] = process.env.PROXY_API_KEY;
  const decisionRes = await fetch(`${base}/api/intelligence/top-opportunities?limit=20`, { headers });
  const decisionPayload = await decisionRes.json().catch(() => ({}));
  const decisionCount = Number.isFinite(Number(decisionPayload?.non_null_scores))
    ? Number(decisionPayload.non_null_scores)
    : (Array.isArray(decisionPayload?.items)
      ? decisionPayload.items.filter((r) => Number.isFinite(Number(r?.decision_score))).length
      : 0);

  const out = {
    ts: new Date().toISOString(),
    lifecycle_overlap: Number(lifecycle.rows?.[0]?.n || 0),
    signals_recent: Number(signalsRecent.rows?.[0]?.n || 0),
    stocks_in_play_filtered_count: Number(filteredCount.rows?.[0]?.n || 0),
    decision_coverage: decisionCount,
    pass:
      Number(lifecycle.rows?.[0]?.n || 0) > 50
      && Number(signalsRecent.rows?.[0]?.n || 0) > 5
      && Number(filteredCount.rows?.[0]?.n || 0) >= 10
      && Number(filteredCount.rows?.[0]?.n || 0) <= 50
      && decisionCount >= 10,
  };

  writeJson('intelligence_postcheck.json', out);
  if (!out.pass) throw new Error('PHASE_9_FAILED_FINAL_VALIDATION');
  return out;
}

async function main() {
  const report = { started_at: new Date().toISOString(), phases: [] };

  const p3 = await phase3SessionLogic();
  report.phases.push({ phase: 'PHASE_3', result: p3 });

  const p4 = await phase4NewsIntegration();
  report.phases.push({ phase: 'PHASE_4', result: p4 });

  const p5 = await phase5EarningsEngine();
  report.phases.push({ phase: 'PHASE_5', result: p5 });

  const p6 = await phase6LearningLayer();
  report.phases.push({ phase: 'PHASE_6', result: p6 });

  const p7 = await phase7DataQuality();
  report.phases.push({ phase: 'PHASE_7', result: p7 });

  const p8 = await phase8DecisionFeedValidation();
  report.phases.push({ phase: 'PHASE_8', result: p8 });

  const p9 = await phase9FinalValidation();
  report.phases.push({ phase: 'PHASE_9', result: p9 });

  report.completed_at = new Date().toISOString();
  writeJson('intelligence_upgrade_report.json', report);

  console.log(JSON.stringify({ ok: true, final: p9 }, null, 2));
}

main()
  .catch((error) => {
    const fail = {
      ts: new Date().toISOString(),
      error: error.message,
    };
    writeJson('intelligence_upgrade_failed.json', fail);
    console.error('[INTELLIGENCE_UPGRADE_FAILED]', error.message);
    process.exit(1);
  })
  .finally(async () => {
    try { await pool.end(); } catch {}
  });
