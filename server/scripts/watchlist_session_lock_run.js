const fs = require('fs');
const path = require('path');
const http = require('http');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { pool } = require('../db/pg');

const ROOT = '/Users/jamesharris/Server';
const LOG_DIR = path.join(ROOT, 'logs');

function writeJson(name, data) {
  fs.writeFileSync(path.join(LOG_DIR, name), JSON.stringify(data, null, 2));
}

async function scalarCount(sql) {
  const result = await pool.query(sql);
  return Number(result.rows?.[0]?.count || 0);
}

function getNySession() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
  }).formatToParts(now);

  const get = (type) => parts.find((p) => p.type === type)?.value;
  const weekday = String(get('weekday') || '').toLowerCase();
  const hour = Number(get('hour') || 0);
  const isWeekend = weekday === 'sat' || weekday === 'sun';
  const isMarketOpen = !isWeekend && hour >= 9 && hour < 16;

  return {
    now_utc: now.toISOString(),
    timezone: 'America/New_York',
    ny_weekday: weekday,
    ny_hour: hour,
    weekend: isWeekend,
    market_open: isMarketOpen,
  };
}

async function phase0Baseline(session) {
  const baseline = {
    timestamp: new Date().toISOString(),
    session,
    counts: {
      stocks_in_play: await scalarCount('SELECT COUNT(*)::int AS count FROM stocks_in_play'),
      stocks_in_play_filtered: await scalarCount('SELECT COUNT(*)::int AS count FROM stocks_in_play_filtered'),
      signals_recent: await scalarCount("SELECT COUNT(*)::int AS count FROM signals WHERE created_at > NOW() - INTERVAL '1 hour'"),
      decision_view: await scalarCount('SELECT COUNT(*)::int AS count FROM decision_view'),
    },
    checks: {},
  };

  baseline.checks.stocks_in_play_nonzero = baseline.counts.stocks_in_play > 0;
  baseline.checks.decision_view_nonzero = baseline.counts.decision_view > 0;
  baseline.checks.signals_recent_rule = session.market_open ? baseline.counts.signals_recent > 5 : true;
  baseline.checks.signals_recent_expected_offsession = !session.market_open && baseline.counts.signals_recent === 0;
  baseline.checks.filtered_nonzero = baseline.counts.stocks_in_play_filtered > 0;

  baseline.verdict = baseline.checks.stocks_in_play_nonzero && baseline.checks.decision_view_nonzero && baseline.checks.signals_recent_rule
    ? 'PASS'
    : 'FAIL';

  writeJson('watchlist_baseline.json', baseline);

  if (!baseline.checks.stocks_in_play_nonzero || !baseline.checks.decision_view_nonzero || !baseline.checks.signals_recent_rule) {
    throw new Error('Phase 0 failed: critical baseline validation failed');
  }

  return baseline;
}

async function getStocksInPlaySchema() {
  const result = await pool.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'stocks_in_play'`
  );
  return new Set((result.rows || []).map((r) => String(r.column_name || '').toLowerCase()));
}

function buildSchemaAdaptiveFilterSql(schemaFields, gapThreshold, atrThreshold) {
  const hasRelativeVolume = schemaFields.has('relative_volume');
  const hasRvol = schemaFields.has('rvol');
  const hasGap = schemaFields.has('gap_percent');
  const hasCatalyst = schemaFields.has('catalyst');
  const hasAtr = schemaFields.has('atr_percent');
  const hasScore = schemaFields.has('score');

  const liveClauses = [];
  const premarketClauses = [];

  if (hasRelativeVolume && hasRvol) {
    liveClauses.push('COALESCE(s.relative_volume, s.rvol, 0) >= 1.5');
  } else if (hasRelativeVolume) {
    liveClauses.push('COALESCE(s.relative_volume, 0) >= 1.5');
  } else if (hasRvol) {
    liveClauses.push('COALESCE(s.rvol, 0) >= 1.5');
  }

  if (hasGap) {
    liveClauses.push(`s.gap_percent >= ${gapThreshold}`);
    premarketClauses.push(`s.gap_percent >= ${gapThreshold}`);
  }

  if (hasCatalyst) {
    liveClauses.push('s.catalyst IS NOT NULL');
  }

  if (hasAtr) {
    premarketClauses.push(`s.atr_percent >= ${atrThreshold}`);
  }

  premarketClauses.push(`COALESCE(
        m.price,
        NULL
      ) IS NOT NULL`);

  if (liveClauses.length === 0) {
    liveClauses.push('TRUE');
  }

  if (premarketClauses.length === 0) {
    premarketClauses.push('TRUE');
  }

  const orderBy = hasScore ? 'ORDER BY s.score DESC' : 'ORDER BY s.detected_at DESC';

  return `
CREATE OR REPLACE VIEW stocks_in_play_filtered AS
SELECT
  s.id,
  s.symbol,
  s.gap_percent,
  s.rvol,
  s.catalyst,
  s.score,
  s.detected_at,
  s.session_phase,
  s.volume_acceleration,
  s.priority_score,
  s.catalyst_score,
  m.price AS price,
  COALESCE(m.relative_volume, s.rvol, NULL) AS relative_volume,
  m.avg_volume_30d AS avg_volume_30d,
  ROW_NUMBER() OVER (${orderBy} NULLS LAST, s.detected_at DESC NULLS LAST) AS rn
FROM stocks_in_play s
LEFT JOIN (
  SELECT
    UPPER(mm.symbol) AS symbol_key,
    MAX(COALESCE(
      (to_jsonb(mm)->>'price')::numeric,
      (to_jsonb(mm)->>'last')::numeric,
      (to_jsonb(mm)->>'close')::numeric,
      NULL
    )) AS price,
    MAX(COALESCE(
      (to_jsonb(mm)->>'relative_volume')::numeric,
      (to_jsonb(mm)->>'rvol')::numeric,
      NULL
    )) AS relative_volume,
    MAX(COALESCE(
      (to_jsonb(mm)->>'avg_volume_30d')::numeric,
      (to_jsonb(mm)->>'avg_volume')::numeric,
      NULL
    )) AS avg_volume_30d
  FROM market_metrics mm
  WHERE mm.symbol IS NOT NULL
    AND TRIM(mm.symbol) <> ''
  GROUP BY UPPER(mm.symbol)
) m
  ON m.symbol_key = UPPER(s.symbol)
WHERE
(
  (
    CURRENT_TIME >= '14:30'
    AND (
      ${liveClauses.join('\n      OR ')}
    )
  )
  OR
  (
    CURRENT_TIME < '14:30'
    AND (
      ${premarketClauses.join('\n      OR ')}
    )
  )
)
AND COALESCE(
  m.price,
  0
) > 1
${orderBy} NULLS LAST, s.detected_at DESC NULLS LAST
LIMIT 30;`;
}

async function createFilteredView(schemaFields, gapThreshold, atrThreshold) {
  const sql = buildSchemaAdaptiveFilterSql(schemaFields, gapThreshold, atrThreshold);
  await pool.query(sql);
}

async function phase1FilterFix() {
  const requiredFields = ['symbol', 'gap_percent', 'rvol', 'score', 'catalyst'];
  const optionalFields = ['relative_volume', 'atr_percent', 'price'];
  const schemaFields = await getStocksInPlaySchema();
  const missingRequired = requiredFields.filter((f) => !schemaFields.has(f));
  const missingOptional = optionalFields.filter((f) => !schemaFields.has(f));

  const attempts = [];

  if (missingRequired.length > 0) {
    const out = {
      timestamp: new Date().toISOString(),
      required_fields: requiredFields,
      optional_fields: optionalFields,
      missing_required_fields: missingRequired,
      missing_optional_fields: missingOptional,
      attempts,
      verdict: 'FAIL',
      reason: 'stocks_in_play schema missing required core fields',
    };
    writeJson('watchlist_filter_validation.json', out);
    throw new Error(`Phase 1 failed: missing required stocks_in_play fields: ${missingRequired.join(', ')}`);
  }

  const thresholds = [
    { gap: 1, atr: 2, label: 'base' },
    { gap: 0.5, atr: 1, label: 'relaxed_1' },
  ];

  let finalCount = 0;
  let applied = thresholds[0];

  for (const t of thresholds) {
    await createFilteredView(schemaFields, t.gap, t.atr);
    const count = await scalarCount('SELECT COUNT(*)::int AS count FROM stocks_in_play_filtered');
    attempts.push({ label: t.label, gap_threshold: t.gap, atr_threshold: t.atr, filtered_count: count });
    finalCount = count;
    applied = t;
    if (count >= 10 && count <= 50) break;
    if (count > 50) break;
  }

  const pass = finalCount >= 10 && finalCount <= 50;
  const out = {
    timestamp: new Date().toISOString(),
    required_fields: requiredFields,
    optional_fields: optionalFields,
    missing_required_fields: [],
    missing_optional_fields: missingOptional,
    attempts,
    applied_thresholds: applied,
    filtered_count: finalCount,
    verdict: pass ? 'PASS' : 'FAIL',
  };

  writeJson('watchlist_filter_validation.json', out);

  if (!pass) {
    throw new Error(`Phase 1 failed: stocks_in_play_filtered count ${finalCount} is outside [10,50]`);
  }

  return out;
}

function httpJson(pathname, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const started = Date.now();
    let done = false;
    const req = http.get({ host: '127.0.0.1', port: 3001, path: pathname, timeout: timeoutMs }, (res) => {
      let body = '';
      res.on('data', (d) => {
        body += d;
      });
      res.on('end', () => {
        if (done) return;
        done = true;
        let json = null;
        try {
          json = JSON.parse(body);
        } catch {
          json = null;
        }
        resolve({ status: res.statusCode || 0, ms: Date.now() - started, timeout: false, json, body });
      });
    });

    req.on('timeout', () => {
      if (done) return;
      done = true;
      req.destroy(new Error('timeout'));
      resolve({ status: 0, ms: Date.now() - started, timeout: true, json: null, body: '' });
    });

    req.on('error', (error) => {
      if (done) return;
      done = true;
      resolve({ status: 0, ms: Date.now() - started, timeout: true, error: String(error), json: null, body: '' });
    });
  });
}

async function phase2EndpointValidation() {
  const runs = [];
  for (let i = 1; i <= 3; i += 1) {
    const result = await httpJson('/api/intelligence/watchlist?limit=30', 4000);
    const rows = Array.isArray(result.json?.data) ? result.json.data : [];
    runs.push({
      run: i,
      status: result.status,
      response_time_ms: result.ms,
      count: rows.length,
      timeout: result.timeout,
      fallback_used: rows.some((r) => String(r?.source || '').toLowerCase() === 'market_metrics_fallback'),
      sample_symbols: rows.slice(0, 5).map((r) => r?.symbol).filter(Boolean),
    });
  }

  const pass = runs.every((r) => r.status === 200 && r.response_time_ms < 2000 && r.count >= 10 && r.timeout === false);
  const out = {
    timestamp: new Date().toISOString(),
    runs,
    verdict: pass ? 'PASS' : 'FAIL',
  };

  writeJson('watchlist_endpoint_validation.json', out);

  if (!pass) {
    throw new Error('Phase 2 failed: endpoint validation requirements not met');
  }

  return out;
}

async function phase3DataFlow(session) {
  const sampleResult = await pool.query('SELECT DISTINCT symbol FROM stocks_in_play_filtered WHERE symbol IS NOT NULL LIMIT 10');
  const sampleSymbols = (sampleResult.rows || []).map((r) => String(r.symbol || '').trim().toUpperCase()).filter(Boolean);

  let overlapSignals = 0;
  let overlapSetups = 0;
  let overlapOutcomes = 0;

  if (sampleSymbols.length > 0) {
    const overlapSignalsQ = await pool.query(
      'SELECT COUNT(DISTINCT symbol)::int AS count FROM signals WHERE symbol = ANY($1::text[])',
      [sampleSymbols]
    );
    overlapSignals = Number(overlapSignalsQ.rows?.[0]?.count || 0);

    const overlapSetupsQ = await pool.query(
      'SELECT COUNT(DISTINCT symbol)::int AS count FROM trade_setups WHERE symbol = ANY($1::text[])',
      [sampleSymbols]
    );
    overlapSetups = Number(overlapSetupsQ.rows?.[0]?.count || 0);

    const overlapOutcomesQ = await pool.query(
      `SELECT COUNT(DISTINCT symbol)::int AS count FROM (
         SELECT symbol FROM signal_outcomes
         UNION ALL
         SELECT symbol FROM trade_outcomes
       ) x
       WHERE symbol = ANY($1::text[])`,
      [sampleSymbols]
    );
    overlapOutcomes = Number(overlapOutcomesQ.rows?.[0]?.count || 0);
  }

  const sampleSize = sampleSymbols.length;
  const overlapPctSignals = sampleSize > 0 ? Number(((overlapSignals / sampleSize) * 100).toFixed(2)) : 0;
  const signalsRulePass = session.market_open ? overlapPctSignals >= 30 : true;

  const out = {
    timestamp: new Date().toISOString(),
    session,
    sample_symbols: sampleSymbols,
    sample_size: sampleSize,
    overlap: {
      signals: overlapSignals,
      trade_setups: overlapSetups,
      outcomes: overlapOutcomes,
      signals_percent: overlapPctSignals,
    },
    signals_rule_pass: signalsRulePass,
    verdict: signalsRulePass ? 'PASS' : 'WARN',
  };

  writeJson('watchlist_dataflow_validation.json', out);

  if (!signalsRulePass) {
    throw new Error('Phase 3 failed: market-open overlap below 30%');
  }

  return out;
}

async function phase4Final() {
  const result = await httpJson('/api/intelligence/watchlist?limit=30', 4000);
  const rows = Array.isArray(result.json?.data) ? result.json.data : [];

  const realistic = rows.every((r) => {
    const symbol = String(r?.symbol || '').trim().toUpperCase();
    return /^[A-Z.]{1,8}$/.test(symbol);
  });

  const out = {
    timestamp: new Date().toISOString(),
    status: result.status,
    response_time_ms: result.ms,
    timeout: result.timeout,
    watchlist_count: rows.length,
    realistic_symbols: realistic,
    sample_symbols: rows.slice(0, 10).map((r) => r?.symbol).filter(Boolean),
    verdict: result.status === 200 && !result.timeout && rows.length > 0 && realistic ? 'PASS' : 'FAIL',
  };

  writeJson('watchlist_final_validation.json', out);

  if (out.verdict !== 'PASS') {
    throw new Error('Phase 4 failed: final watchlist validation failed');
  }

  return out;
}

async function main() {
  const session = getNySession();
  let baseline = null;
  let filter = null;
  let endpoint = null;
  let dataflow = null;
  let finalCheck = null;

  try {
    baseline = await phase0Baseline(session);
    filter = await phase1FilterFix();
    endpoint = await phase2EndpointValidation();
    dataflow = await phase3DataFlow(session);
    finalCheck = await phase4Final();

    const report = {
      session: {
        market_open: session.market_open,
        weekend: session.weekend,
      },
      baseline,
      filtered_count: Number(filter.filtered_count || 0),
      signals_recent: Number(baseline.counts?.signals_recent || 0),
      watchlist_count: Number(finalCheck.watchlist_count || 0),
      response_time_ms: Number(finalCheck.response_time_ms || 0),
      fallback_used: Boolean((endpoint.runs || []).some((r) => r.fallback_used)),
      timeouts: (endpoint.runs || []).filter((r) => r.timeout).length,
      verdict: 'PASS',
    };

    writeJson('watchlist_fix_report.json', report);
    console.log(JSON.stringify(report));
  } catch (error) {
    const report = {
      session: {
        market_open: session.market_open,
        weekend: session.weekend,
      },
      baseline,
      filtered_count: Number(filter?.filtered_count || 0),
      signals_recent: Number(baseline?.counts?.signals_recent || 0),
      watchlist_count: Number(finalCheck?.watchlist_count || 0),
      response_time_ms: Number(finalCheck?.response_time_ms || 0),
      fallback_used: Boolean(endpoint && (endpoint.runs || []).some((r) => r.fallback_used)),
      timeouts: endpoint ? (endpoint.runs || []).filter((r) => r.timeout).length : 0,
      verdict: 'FAIL',
      error: String(error.message || error),
    };
    writeJson('watchlist_fix_report.json', report);
    console.error(error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
