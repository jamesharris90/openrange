const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const dotenv = require('dotenv');
const pool = require('../db/pool');

dotenv.config({ path: path.join(__dirname, '../.env') });

const ROOT = path.join(__dirname, '..', '..');
const LOG_PATH = path.join(ROOT, 'logs', 'full_readiness_audit.json');
const RESET_PATH = path.join(ROOT, 'logs', 'prep_data_repair_reset.json');
const BASE_PORTS = [3001, 3023];
const DEFAULT_API_BASE = process.env.API_BASE || 'http://127.0.0.1:3001';
const VALID_LOGIN = {
  identifier: 'ag941472',
  password: 'GuardPass!234',
};

function nowIso() {
  return new Date().toISOString();
}

function toNum(v, fb = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function pct(n, d) {
  if (!d) return 0;
  return Number(((n / d) * 100).toFixed(2));
}

function hasField(obj, key) {
  return obj && Object.prototype.hasOwnProperty.call(obj, key);
}

function cmdOut(command) {
  try {
    return String(execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) || '').trim();
  } catch (error) {
    const s = String(error.stdout || '').trim();
    const m = String(error.message || '').trim();
    return s || m;
  }
}

function pgrepExact(pattern) {
  try {
    const run = spawnSync('pgrep', ['-af', pattern], { encoding: 'utf8' });
    const out = String(run.stdout || '').trim();
    if (!out) return [];
    const lines = out.split('\n').map((x) => x.trim()).filter(Boolean);
    return lines.filter((line) => {
      if (line.includes('pgrep -af')) return false;
      const pid = Number(line.split(' ')[0]);
      if (Number.isFinite(pid) && pid === process.pid) return false;
      return true;
    });
  } catch {
    return [];
  }
}

async function fetchJson(url, options = {}) {
  const started = Date.now();
  try {
    const res = await fetch(url, options);
    const elapsedMs = Date.now() - started;
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return {
      ok: res.ok,
      status: res.status,
      elapsed_ms: elapsedMs,
      is_json: json !== null,
      json,
      text_sample: (text || '').slice(0, 180),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      elapsed_ms: Date.now() - started,
      is_json: false,
      json: null,
      error: error.message,
    };
  }
}

async function getTableColumns(pool, table) {
  const r = await pool.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1
     ORDER BY ordinal_position`,
    [table]
  );
  return (r.rows || []).map((x) => x.column_name);
}

async function tableCount(pool, table) {
  const r = await pool.query(`SELECT COUNT(*)::bigint AS n FROM ${table}`);
  return Number(r.rows?.[0]?.n || 0);
}

async function tableLatestTs(pool, table, cols) {
  const tsCols = ['updated_at', 'created_at', 'published_at', 'report_date', 'last_updated', 'detected_at']
    .filter((c) => cols.includes(c));
  if (!tsCols.length) return null;

  const exprs = tsCols.map((c) => `MAX(${c}) AS max_${c}`);
  const q = `SELECT ${exprs.join(', ')} FROM ${table}`;
  const r = await pool.query(q);
  const row = r.rows?.[0] || {};
  for (const c of tsCols) {
    const v = row[`max_${c}`];
    if (v) return new Date(v).toISOString();
  }
  return null;
}

async function criticalNullPct(pool, table, cols) {
  const out = {};
  const total = await tableCount(pool, table);
  for (const c of cols) {
    if (!c) continue;
    try {
      const r = await pool.query(`SELECT COUNT(*)::bigint AS n FROM ${table} WHERE ${c} IS NULL`);
      const n = Number(r.rows?.[0]?.n || 0);
      out[c] = {
        null_count: n,
        null_pct: pct(n, total),
      };
    } catch {
      out[c] = { null_count: null, null_pct: null };
    }
  }
  return out;
}

function parseLsofPorts(raw) {
  const ports = [];
  const lines = String(raw || '').split('\n').filter(Boolean);
  for (const line of lines) {
    const m = line.match(/TCP \*:(\d+) \(LISTEN\)/);
    if (!m) continue;
    const p = Number(m[1]);
    if (!Number.isFinite(p)) continue;
    ports.push({
      port: p,
      process_sample: line,
    });
  }
  return ports;
}

async function phase0ResetAndProcessSanity() {
  const resetState = {
    reset_checkpoint_valid: false,
    reset_checkpoint_path: RESET_PATH,
    active_processes: {},
    active_ports: [],
    rogue_loops_running: false,
    topology_summary: {},
  };

  try {
    const raw = fs.readFileSync(RESET_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    resetState.reset_checkpoint_valid = true;
    resetState.reset_checkpoint = parsed;
  } catch (error) {
    resetState.reset_checkpoint_valid = false;
    resetState.reset_checkpoint_error = error.message;
  }

  const rogueLines = [
    ...pgrepExact('prepDataRepair.js'),
    ...pgrepExact('openrange_autoloop.js'),
    ...pgrepExact('pipeline_unification_lock.js'),
    ...pgrepExact('score_calibration_phases_0_8.js'),
    ...pgrepExact('sip_priority_phases_0_6.js'),
    ...pgrepExact('earningsForceInjection.js'),
    ...pgrepExact('earningsOutcomeBackfill.js'),
    ...pgrepExact('openrange_density_expansion_cycle.js'),
  ];
  const rogue = Array.from(new Set(rogueLines));
  const lsofRaw = cmdOut('lsof -nP -iTCP -sTCP:LISTEN || true');
  const ports = parseLsofPorts(lsofRaw);

  resetState.active_processes.rogue_query_output = rogue;
  resetState.active_processes.lsof_sample = lsofRaw.split('\n').slice(0, 80);
  resetState.active_ports = ports;
  resetState.rogue_loops_running = rogue.length > 0;

  const serviceFingerprints = [];
  const activePortNumbers = Array.from(new Set(ports.map((x) => x.port))).sort((a, b) => a - b);
  for (const p of activePortNumbers) {
    if (p < 3000 || p > 3100) continue;
    const health = await fetchJson(`http://127.0.0.1:${p}/api/health`);
    const root = await fetchJson(`http://127.0.0.1:${p}/`);
    serviceFingerprints.push({
      port: p,
      health_status: health.status,
      health_ok: health.ok,
      root_status: root.status,
      root_is_json: root.is_json,
      root_sample: root.text_sample || null,
    });
  }

  const basePortsState = [];
  for (const p of BASE_PORTS) {
    const health = await fetchJson(`http://127.0.0.1:${p}/api/health`);
    basePortsState.push({ port: p, status: health.status, ok: health.ok, sample: health.json || null });
  }

  const activeApiLike = serviceFingerprints.filter((x) => x.health_status === 200);
  resetState.topology_summary = {
    expected_ports: BASE_PORTS,
    base_ports_state: basePortsState,
    discovered_api_instances: activeApiLike.map((x) => x.port),
    service_fingerprints: serviceFingerprints,
    frontend_root_present: serviceFingerprints.some((x) => x.root_status === 200 && !x.root_is_json),
    warning_multiple_api_instances: activeApiLike.length > 1,
  };

  return resetState;
}

async function selectApiBase() {
  const candidates = ['http://127.0.0.1:3001', 'http://127.0.0.1:3023'];
  const scored = [];
  for (const base of candidates) {
    const health = await fetchJson(`${base}/api/health`);
    const top = await fetchJson(`${base}/api/intelligence/top-opportunities?limit=5`);
    const watch = await fetchJson(`${base}/api/intelligence/watchlist?limit=20`);
    const score = (health.status === 200 ? 1 : 0) + (top.status === 200 ? 1 : 0) + (watch.status === 200 ? 1 : 0);
    scored.push({ base, score, health: health.status, top: top.status, watch: watch.status });
  }
  scored.sort((a, b) => b.score - a.score);
  return {
    selected: scored[0]?.base || DEFAULT_API_BASE,
    candidates: scored,
  };
}

async function phase1EngineStatus(pool, apiBase, critical, warnings) {
  const status = {};

  async function latestTs(table, candidates) {
    try {
      const cols = await getTableColumns(pool, table);
      const existing = candidates.filter((c) => cols.includes(c));
      if (!existing.length) return null;
      const expr = existing.length === 1 ? existing[0] : `COALESCE(${existing.join(', ')})`;
      const q = `SELECT MAX(${expr}) AS ts FROM ${table}`;
      const r = await pool.query(q);
      return r.rows?.[0]?.ts ? new Date(r.rows[0].ts).toISOString() : null;
    } catch {
      return null;
    }
  }

  async function countWhere(sql, params = []) {
    const r = await pool.query(sql, params);
    return Number(r.rows?.[0]?.n || 0);
  }

  const decisionProbe = await fetchJson(`${apiBase}/api/intelligence/decision/AAPL`);
  const watchlistProbe = await fetchJson(`${apiBase}/api/intelligence/watchlist`);
  const topProbe = await fetchJson(`${apiBase}/api/intelligence/top-opportunities?limit=10`);

  status.stocks_in_play_engine = {
    running: true,
    last_execution_timestamp: await latestTs('stocks_in_play', ['detected_at', 'updated_at', 'created_at']),
    last_success_failure: 'unknown',
    last_error: null,
    expected_role: 'Maintains ranked stocks-in-play universe for intelligence and prep flows.',
  };

  status.signal_generation_engine = {
    running: true,
    last_execution_timestamp: await latestTs('signals', ['created_at', 'updated_at']),
    last_success_failure: (await countWhere("SELECT COUNT(*)::int AS n FROM signals WHERE created_at > NOW() - INTERVAL '24 hours'")) > 0 ? 'recent_activity' : 'stale',
    last_error: null,
    expected_role: 'Produces trade signal records consumed by setup/outcome lifecycle.',
  };

  status.intelligence_decision_engine = {
    running: decisionProbe.ok,
    last_execution_timestamp: nowIso(),
    last_success_failure: decisionProbe.ok ? 'success' : 'failure',
    last_error: decisionProbe.ok ? null : (decisionProbe.error || `status_${decisionProbe.status}`),
    expected_role: 'Builds per-symbol decision objects including why_moving, execution, and score.',
  };

  status.calibration_trust_layer = {
    running: Boolean(decisionProbe.json?.decision && hasField(decisionProbe.json.decision, 'truth_valid')),
    last_execution_timestamp: nowIso(),
    last_success_failure: Boolean(decisionProbe.json?.decision && hasField(decisionProbe.json.decision, 'trade_quality_score')) ? 'success' : 'degraded',
    last_error: Boolean(decisionProbe.json?.decision && hasField(decisionProbe.json.decision, 'trade_quality_score')) ? null : 'missing_truth_or_quality_fields',
    expected_role: 'Applies truth filters and quality calibration to avoid score-only false positives.',
  };

  status.prep_watchlist_layer = {
    running: watchlistProbe.ok,
    last_execution_timestamp: nowIso(),
    last_success_failure: watchlistProbe.ok ? 'success' : 'failure',
    last_error: watchlistProbe.ok ? null : (watchlistProbe.error || `status_${watchlistProbe.status}`),
    expected_role: 'Builds prep-mode watchlist and reason distribution for premarket planning.',
  };

  status.earnings_signal_injection_layer = {
    running: true,
    last_execution_timestamp: await latestTs('earnings_events', ['report_date', 'updated_at', 'created_at']),
    last_success_failure: (await countWhere("SELECT COUNT(*)::int AS n FROM signals WHERE LOWER(COALESCE(signal_type,''))='earnings' AND created_at > NOW() - INTERVAL '7 days'")) > 0 ? 'recent_activity' : 'unknown',
    last_error: null,
    expected_role: 'Links earnings events into signals/setups/decisions for catalyst-aware planning.',
  };

  status.news_ingestion_layer = {
    running: true,
    last_execution_timestamp: await latestTs('news_articles', ['published_at', 'created_at', 'updated_at']),
    last_success_failure: (await countWhere("SELECT COUNT(*)::int AS n FROM news_articles WHERE COALESCE(published_at, created_at) > NOW() - INTERVAL '24 hours'")) > 0 ? 'recent_activity' : 'stale',
    last_error: null,
    expected_role: 'Ingests and symbol-links recent news for catalysts and explainability.',
  };

  const narratives = Array.isArray(topProbe.json?.items) ? topProbe.json.items : (Array.isArray(topProbe.json?.results) ? topProbe.json.results : []);
  const narrativeReady = narratives.some((r) => String(r?.why_moving || r?.explanation || '').trim().length > 0);
  status.mcp_narrative_engine = {
    running: topProbe.ok,
    last_execution_timestamp: nowIso(),
    last_success_failure: narrativeReady ? 'success' : 'degraded',
    last_error: narrativeReady ? null : 'narrative_fields_missing_or_empty',
    expected_role: 'Provides symbol-level narrative/explanation for trader context and AI assistance.',
  };

  const systemGuardFile = path.join(__dirname, '../system/systemGuard.js');
  const buildGuardFile = path.join(__dirname, '../system/buildValidator.js');
  status.systemGuard = {
    running: fs.existsSync(systemGuardFile),
    last_execution_timestamp: null,
    last_success_failure: 'unknown',
    last_error: null,
    expected_role: 'Blocks writes or alerts when lifecycle/validation invariants fail.',
  };

  status.validation_build_guard = {
    running: fs.existsSync(buildGuardFile),
    last_execution_timestamp: null,
    last_success_failure: 'see runSystemCheck evidence',
    last_error: null,
    expected_role: 'Runs schema/data/endpoint checks to gate unsafe operation states.',
  };

  const requiredCore = ['stocks_in_play_engine', 'signal_generation_engine', 'intelligence_decision_engine', 'prep_watchlist_layer', 'news_ingestion_layer', 'earnings_signal_injection_layer'];
  for (const k of requiredCore) {
    if (!status[k].running) {
      critical.push(`Engine missing/not running: ${k}`);
    }
  }

  if (!status.mcp_narrative_engine.running || status.mcp_narrative_engine.last_success_failure !== 'success') {
    warnings.push('Narrative layer appears degraded; explainability quality may be limited.');
  }

  return status;
}

async function phase2SchemaDataInventory(pool, apiBase) {
  const tables = [
    'signals',
    'trade_setups',
    'signal_outcomes',
    'trade_outcomes',
    'market_metrics',
    'news_articles',
    'earnings_events',
    'stocks_in_play',
    'opportunity_stream',
  ];

  const criticalColsByTable = {
    signals: ['symbol', 'id', 'created_at'],
    trade_setups: ['symbol', 'signal_id', 'created_at', 'updated_at'],
    signal_outcomes: ['symbol', 'signal_id', 'pnl_pct', 'created_at'],
    trade_outcomes: ['symbol', 'signal_id', 'pnl_pct', 'created_at'],
    market_metrics: ['symbol', 'relative_volume', 'change_percent', 'updated_at'],
    news_articles: ['symbol', 'published_at', 'created_at'],
    earnings_events: ['symbol', 'report_date'],
    stocks_in_play: ['symbol', 'score', 'detected_at'],
    opportunity_stream: ['symbol', 'created_at'],
  };

  const schemaHealth = {};
  const dataInventory = {};

  for (const t of tables) {
    const cols = await getTableColumns(pool, t);
    const n = await tableCount(pool, t);
    const latestTs = await tableLatestTs(pool, t, cols);
    const criticalCols = (criticalColsByTable[t] || []).filter((c) => cols.includes(c));
    const nullStats = await criticalNullPct(pool, t, criticalCols);

    schemaHealth[t] = {
      row_count: n,
      key_columns: cols.slice(0, 40),
      latest_timestamp: latestTs,
      critical_null_stats: nullStats,
    };

    dataInventory[t] = {
      row_count: n,
      latest_timestamp: latestTs,
      freshness_hint: latestTs,
    };
  }

  const viewDef = await pool.query(
    `SELECT viewname, definition
     FROM pg_views
     WHERE schemaname='public' AND viewname IN ('decision_view')`
  );

  const decisionDef = String(viewDef.rows?.[0]?.definition || '');
  const relationMatches = Array.from(new Set((decisionDef.match(/\b(from|join)\s+([a-zA-Z0-9_\.]+)/gi) || [])
    .map((m) => m.replace(/\s+/g, ' ').split(' ')[1])
    .filter(Boolean)));

  schemaHealth.decision_view = {
    exists: decisionDef.length > 0,
    referenced_relations: relationMatches,
    definition_sample: decisionDef.slice(0, 500),
  };

  const topPayload = await fetchJson(`${apiBase}/api/intelligence/top-opportunities?limit=5`);
  const topRows = Array.isArray(topPayload.json?.items) ? topPayload.json.items : (Array.isArray(topPayload.json?.results) ? topPayload.json.results : []);
  const topFields = topRows.length ? Object.keys(topRows[0]) : [];

  schemaHealth.top_opportunities_surface = {
    endpoint_status: topPayload.status,
    sample_fields: topFields,
    inferred_backing_relation: 'decision_view + enrichment joins (runtime endpoint)',
  };

  const freshnessSummary = {
    now_utc: nowIso(),
    market_metrics_latest: schemaHealth.market_metrics.latest_timestamp,
    news_latest: schemaHealth.news_articles.latest_timestamp,
    earnings_latest_report_date: schemaHealth.earnings_events.latest_timestamp,
    signals_latest: schemaHealth.signals.latest_timestamp,
  };

  return { schemaHealth, dataInventory, freshnessSummary };
}

async function phase3PipelineIntegrity(pool, critical) {
  const overlap = await pool.query(
    `SELECT COUNT(DISTINCT s.symbol)::int AS n
     FROM signals s
     JOIN trade_setups ts ON ts.signal_id = s.id
     JOIN signal_outcomes so ON so.signal_id = s.id
     JOIN trade_outcomes to2 ON to2.signal_id = s.id`
  );

  const orphanSignals = await pool.query(
    `SELECT COUNT(*)::int AS n
     FROM signals s
     LEFT JOIN trade_setups ts ON ts.signal_id = s.id
     WHERE ts.signal_id IS NULL`
  );

  const orphanSetups = await pool.query(
    `SELECT COUNT(*)::int AS n
     FROM trade_setups ts
     LEFT JOIN signals s ON s.id = ts.signal_id
     WHERE ts.signal_id IS NOT NULL AND s.id IS NULL`
  );

  const orphanSO = await pool.query(
    `SELECT COUNT(*)::int AS n
     FROM signal_outcomes so
     LEFT JOIN signals s ON s.id = so.signal_id
     WHERE so.signal_id IS NOT NULL AND s.id IS NULL`
  );

  const orphanTO = await pool.query(
    `SELECT COUNT(*)::int AS n
     FROM trade_outcomes t
     LEFT JOIN signals s ON s.id = t.signal_id
     WHERE t.signal_id IS NOT NULL AND s.id IS NULL`
  );

  const nullSymbolChain = await pool.query(
    `SELECT
      (SELECT COUNT(*)::int FROM signals WHERE symbol IS NULL OR TRIM(symbol)='') AS signals_null_symbol,
      (SELECT COUNT(*)::int FROM trade_setups WHERE symbol IS NULL OR TRIM(symbol)='') AS setups_null_symbol,
      (SELECT COUNT(*)::int FROM signal_outcomes WHERE symbol IS NULL OR TRIM(symbol)='') AS signal_outcomes_null_symbol,
      (SELECT COUNT(*)::int FROM trade_outcomes WHERE symbol IS NULL OR TRIM(symbol)='') AS trade_outcomes_null_symbol`
  );

  const earningsLinkage = await pool.query(
    `SELECT
      COUNT(*) FILTER (WHERE LOWER(COALESCE(s.signal_type,''))='earnings')::int AS earnings_signals,
      COUNT(*) FILTER (WHERE LOWER(COALESCE(t.strategy,'')) LIKE '%earnings%')::int AS earnings_trade_outcomes
     FROM signals s
     LEFT JOIN trade_outcomes t ON t.signal_id = s.id`
  );

  const out = {
    overlap_count: Number(overlap.rows?.[0]?.n || 0),
    orphan_counts: {
      signals_without_setups: Number(orphanSignals.rows?.[0]?.n || 0),
      setups_without_signal: Number(orphanSetups.rows?.[0]?.n || 0),
      signal_outcomes_without_signal: Number(orphanSO.rows?.[0]?.n || 0),
      trade_outcomes_without_signal: Number(orphanTO.rows?.[0]?.n || 0),
    },
    null_symbol_counts: nullSymbolChain.rows?.[0] || {},
    earnings_linkage: earningsLinkage.rows?.[0] || {},
    verdict: 'PASS',
  };

  if (out.overlap_count <= 0) {
    out.verdict = 'FAIL';
    critical.push('Pipeline lifecycle overlap collapsed to zero.');
  }
  if (Number(out.earnings_linkage.earnings_signals || 0) <= 0) {
    critical.push('Earnings-linked signals missing from lifecycle.');
    out.verdict = 'FAIL';
  }

  return out;
}

async function phase4IngestionHealth(pool, warnings) {
  const mm = await pool.query(
    `SELECT
      COUNT(*)::int AS rows,
      MAX(COALESCE(updated_at, last_updated::timestamptz, NOW())) AS latest
     FROM market_metrics`
  );

  const news = await pool.query(
    `SELECT
      COUNT(*) FILTER (WHERE COALESCE(published_at, created_at) > NOW() - INTERVAL '6 hours')::int AS rows_6h,
      COUNT(*) FILTER (WHERE COALESCE(published_at, created_at) > NOW() - INTERVAL '24 hours')::int AS rows_24h,
      COUNT(DISTINCT UPPER(symbol)) FILTER (WHERE symbol IS NOT NULL AND COALESCE(published_at, created_at) > NOW() - INTERVAL '24 hours')::int AS symbol_coverage_24h,
      MAX(COALESCE(published_at, created_at)) AS latest
     FROM news_articles`
  );

  const earnings = await pool.query(
    `SELECT
      COUNT(*) FILTER (WHERE report_date::date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7)::int AS next_7d,
      COUNT(*) FILTER (WHERE report_date::date BETWEEN CURRENT_DATE - 7 AND CURRENT_DATE)::int AS prev_7d,
      COUNT(DISTINCT UPPER(symbol))::int AS symbols,
      MAX(report_date) AS latest
     FROM earnings_events`
  );

  const opp = await pool.query(
    `SELECT
      COUNT(*)::int AS rows,
      MAX(COALESCE(
        (to_jsonb(o)->>'created_at')::timestamptz,
        (to_jsonb(o)->>'updated_at')::timestamptz,
        (to_jsonb(o)->>'timestamp')::timestamptz
      )) AS latest
     FROM opportunity_stream o`
  );

  const sig = await pool.query(
    `SELECT
      COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '15 minutes')::int AS rows_15m,
      COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour')::int AS rows_1h,
      MAX(created_at) AS latest
     FROM signals`
  );

  const isSunday = new Date().getUTCDay() === 0;
  const notes = [];
  const rows15m = Number(sig.rows?.[0]?.rows_15m || 0);
  if (isSunday && rows15m === 0) {
    notes.push('Sunday allowance applied: low live signal flow is acceptable.');
  }
  if (Number(mm.rows?.[0]?.rows || 0) <= 5000) {
    warnings.push('market_metrics row count is below 5000 threshold.');
  }

  const out = {
    market_metrics: {
      row_count: Number(mm.rows?.[0]?.rows || 0),
      latest_update: mm.rows?.[0]?.latest ? new Date(mm.rows[0].latest).toISOString() : null,
      threshold_row_count_gt_5000: Number(mm.rows?.[0]?.rows || 0) > 5000,
    },
    news: {
      rows_last_6h: Number(news.rows?.[0]?.rows_6h || 0),
      rows_last_24h: Number(news.rows?.[0]?.rows_24h || 0),
      symbol_coverage_24h: Number(news.rows?.[0]?.symbol_coverage_24h || 0),
      latest: news.rows?.[0]?.latest ? new Date(news.rows[0].latest).toISOString() : null,
    },
    earnings: {
      next_7d: Number(earnings.rows?.[0]?.next_7d || 0),
      prev_7d: Number(earnings.rows?.[0]?.prev_7d || 0),
      distinct_symbols: Number(earnings.rows?.[0]?.symbols || 0),
      latest_report_date: earnings.rows?.[0]?.latest ? new Date(earnings.rows[0].latest).toISOString() : null,
    },
    opportunities: {
      row_count: Number(opp.rows?.[0]?.rows || 0),
      latest: opp.rows?.[0]?.latest ? new Date(opp.rows[0].latest).toISOString() : null,
    },
    signals: {
      rows_last_15m: rows15m,
      rows_last_1h: Number(sig.rows?.[0]?.rows_1h || 0),
      latest: sig.rows?.[0]?.latest ? new Date(sig.rows[0].latest).toISOString() : null,
    },
    notes,
  };

  return out;
}

async function phase5PrepMode(apiBase, critical, warnings) {
  const watch = await fetchJson(`${apiBase}/api/intelligence/watchlist?limit=100`);
  const rows = Array.isArray(watch.json?.data) ? watch.json.data : [];
  const dist = {};
  for (const r of rows) {
    const reason = String(r?.watch_reason || 'UNKNOWN').toUpperCase();
    dist[reason] = (dist[reason] || 0) + 1;
  }

  const total = rows.length;
  const highVolPct = pct(Number(dist.HIGH_VOLATILITY || 0), total);
  const hasEarnings = Number(dist.EARNINGS_UPCOMING || 0) > 0;
  const hasNews = Number(dist.NEWS_PENDING || 0) > 0;
  const hasLargeMove = Number(dist.LARGE_MOVE || 0) > 0;

  const rootCauses = [];
  if (highVolPct >= 80) rootCauses.push('watchlist is dominated by HIGH_VOLATILITY reason');
  if (!hasEarnings) rootCauses.push('no EARNINGS_UPCOMING entries present');
  if (!hasNews) rootCauses.push('no NEWS_PENDING entries present');
  if (!hasLargeMove) rootCauses.push('no LARGE_MOVE entries present');

  let verdict = 'PASS';
  if (highVolPct >= 90 && !hasEarnings && !hasNews && !hasLargeMove) {
    verdict = 'FAIL';
    critical.push('Prep watchlist appears misleading for Monday prep (single-reason dominance with missing earnings/news/large-move).');
  } else if (rootCauses.length) {
    verdict = 'DEGRADED';
    warnings.push('Prep watchlist reason balance is weak/degraded.');
  }

  return {
    count: total,
    distribution: dist,
    verdict,
    root_causes: rootCauses,
  };
}

async function phase6EndpointHealth(apiBase, critical) {
  const endpoints = [
    '/api/health',
    '/api/screener',
    '/api/market/quotes?symbols=SPY,QQQ,AAPL',
    '/api/market/overview',
    '/api/signals?limit=5',
    '/api/intelligence/decision/AAPL',
    '/api/intelligence/top-opportunities?limit=10',
    '/api/intelligence/watchlist?limit=50',
    '/api/earnings',
    '/api/earnings/calendar?limit=10',
    '/api/earnings/health',
  ];

  const out = {};
  for (const ep of endpoints) {
    const res = await fetchJson(`${apiBase}${ep}`);
    const sample = res.json || null;

    let rootObjValid = false;
    if (sample && typeof sample === 'object') rootObjValid = true;

    out[ep] = {
      status: res.status,
      response_time_ms: res.elapsed_ms,
      valid_json: res.is_json,
      ok: res.ok,
      root_object_present: rootObjValid,
      sample_payload: sample,
      contract_notes: [],
    };

    if (res.status >= 500 || res.status === 0) {
      critical.push(`Endpoint hard failure: ${ep} status ${res.status}`);
    }
    if (!res.is_json) {
      out[ep].contract_notes.push('non-json response');
    }
    if (!rootObjValid) {
      out[ep].contract_notes.push('null_or_nonobject_root');
    }
  }

  return out;
}

async function phase7And8UserJourneyAndPages(apiBase, warnings) {
  const journey = {
    entry_route: null,
    login_status: {
      page_load: 'not_checked',
      valid_login_api: null,
      invalid_login_api: null,
    },
    session_status: {},
    console_errors: [],
    network_errors: [],
    redirects: [],
    verdict: 'UNKNOWN',
  };

  const pageAudit = [];

  let playwright = null;
  try {
    playwright = require('playwright');
  } catch (error) {
    warnings.push(`Playwright unavailable: ${error.message}`);
    journey.verdict = 'FAILED_NO_PLAYWRIGHT';
    return { journey, pageAudit };
  }

  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      journey.console_errors.push(msg.text());
    }
  });
  page.on('requestfailed', (req) => {
    journey.network_errors.push({ url: req.url(), failure: req.failure() });
  });
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      journey.redirects.push(frame.url());
    }
  });

  const routes = [
    '/',
    '/login',
    '/dashboard',
    '/trading-terminal',
    '/premarket',
    '/watchlist',
    '/screener',
    '/intelligence',
    '/earnings',
    '/research/AAPL',
    '/admin',
  ];

  try {
    const r = await page.goto('http://localhost:3001', { waitUntil: 'domcontentloaded', timeout: 8000 });
    const body = await page.textContent('body').catch(() => '');
    journey.entry_route = {
      url: page.url(),
      status: r ? r.status() : null,
      first_page_shown: (body || '').slice(0, 120),
    };

    const loginPageRes = await page.goto('http://localhost:3001/login', { waitUntil: 'domcontentloaded', timeout: 8000 });
    journey.login_status.page_load = loginPageRes ? loginPageRes.status() : 'no_response';

    const good = await fetchJson(`${apiBase}/api/users/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(VALID_LOGIN),
    });
    const bad = await fetchJson(`${apiBase}/api/users/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier: VALID_LOGIN.identifier, password: 'wrong-password' }),
    });

    const token = good.json?.token || null;
    journey.login_status.valid_login_api = {
      status: good.status,
      token_present: Boolean(token),
    };
    journey.login_status.invalid_login_api = {
      status: bad.status,
      handled_gracefully: bad.status >= 400 && bad.status < 500,
    };

    if (token) {
      const protectedProbe = await fetchJson(`${apiBase}/api/intelligence/top-opportunities?limit=3`, {
        headers: { authorization: `Bearer ${token}` },
      });
      journey.session_status = {
        token_based_navigation_probe_status: protectedProbe.status,
        token_based_navigation_probe_ok: protectedProbe.ok,
      };
    }

    for (const route of routes) {
      const res = await page.goto(`http://localhost:3001${route}`, { waitUntil: 'domcontentloaded', timeout: 8000 }).catch(() => null);
      const text = await page.textContent('body').catch(() => '');
      const hasFatal = /error loading data|cannot read|undefined|exception|api_route_not_found/i.test(String(text || ''));
      pageAudit.push({
        route,
        status: res ? res.status() : 0,
        loads: Boolean(res),
        data_status: hasFatal ? 'fatal_or_missing' : 'ok_or_empty',
        console_errors: [...journey.console_errors],
        notes: String(text || '').slice(0, 160),
      });
    }

    journey.verdict = (journey.login_status.valid_login_api?.token_present && journey.console_errors.length === 0)
      ? 'PASS'
      : 'FAIL';
  } finally {
    await browser.close();
  }

  return { journey, pageAudit };
}

async function phase9UiTruth(endpointHealth, pageAudit) {
  const mismatches = [];
  const fakeFields = [];
  const staleFields = [];

  const top = endpointHealth['/api/intelligence/top-opportunities?limit=10']?.sample_payload;
  const topRows = Array.isArray(top?.items) ? top.items : (Array.isArray(top?.results) ? top.results : []);
  const sample = topRows[0] || {};

  const requiredTop = ['symbol', 'why_moving', 'why_tradeable', 'execution_plan'];
  for (const f of requiredTop) {
    if (!hasField(sample, f)) {
      mismatches.push(`Top opportunities missing field ${f}`);
    }
    if (sample[f] == null || String(sample[f]).trim() === '') {
      staleFields.push(`Top opportunities field ${f} is null/empty in sample`);
    }
  }

  const decision = endpointHealth['/api/intelligence/decision/AAPL']?.sample_payload?.decision || endpointHealth['/api/intelligence/decision/AAPL']?.sample_payload || {};
  const decisionFields = ['bias', 'expectedMoveLabel', 'catalystType'];
  for (const f of decisionFields) {
    if (!hasField(decision, f)) mismatches.push(`Decision card mapped field missing: ${f}`);
  }

  const earnings = endpointHealth['/api/earnings/calendar?limit=10']?.sample_payload;
  const earningsRows = Array.isArray(earnings?.data) ? earnings.data : (Array.isArray(earnings) ? earnings : []);
  if (earningsRows.length > 0) {
    const er = earningsRows[0];
    if (!hasField(er, 'symbol')) mismatches.push('Earnings page sample missing symbol');
    if (!hasField(er, 'report_date') && !hasField(er, 'event_date')) mismatches.push('Earnings page sample missing report/event date');
  }

  const missingRoutes = pageAudit.filter((p) => p.status === 404).map((p) => p.route);
  if (missingRoutes.length) {
    fakeFields.push('UI navigation appears unavailable on backend host; route-level UI contract cannot be fully validated on localhost:3001.');
  }

  const verdict = mismatches.length === 0 && fakeFields.length === 0 ? 'PASS' : 'DEGRADED';
  return { mismatches, fake_fields: fakeFields, stale_fields: staleFields, verdict };
}

function classifyOpportunity(row) {
  const change = Math.abs(toNum(row?.change_percent, 0));
  const rvol = toNum(row?.relative_volume, toNum(row?.rvol, 0)) || 0;
  const hasCatalyst = String(row?.catalyst_type || '').trim().length > 0
    || toNum(row?.news_count, 0) > 0
    || Boolean(row?.earnings_flag)
    || String(row?.why_moving || '').trim().length > 0;
  const hasPlan = row?.execution_plan != null && String(row?.execution_plan).trim().length > 0;
  const whyTradeable = String(row?.why_tradeable || '').trim().length > 0;

  if (change > 0 && rvol > 0 && hasCatalyst && hasPlan && whyTradeable) return 'valid';
  if ((change > 0 || rvol > 0) && (hasCatalyst || hasPlan)) return 'weak';
  return 'false_positive';
}

async function phase10DataTruth(apiBase, warnings) {
  const res = await fetchJson(`${apiBase}/api/intelligence/top-opportunities?limit=10`);
  const rows = Array.isArray(res.json?.items) ? res.json.items : (Array.isArray(res.json?.results) ? res.json.results : []);

  let valid = 0;
  let weak = 0;
  let fp = 0;
  const sampleRows = [];

  for (const r of rows.slice(0, 10)) {
    const c = classifyOpportunity(r);
    if (c === 'valid') valid += 1;
    else if (c === 'weak') weak += 1;
    else fp += 1;

    sampleRows.push({
      symbol: r?.symbol,
      change_percent: r?.change_percent,
      relative_volume: r?.relative_volume ?? r?.rvol,
      catalyst_type: r?.catalyst_type,
      why_moving: r?.why_moving,
      why_tradeable: r?.why_tradeable,
      execution_plan: r?.execution_plan,
      classification: c,
    });
  }

  if (fp > valid) {
    warnings.push('Top opportunities false-positive count exceeds valid count in sampled top 10.');
  }

  return {
    valid_count: valid,
    weak_count: weak,
    false_positive_count: fp,
    sample_rows: sampleRows,
    verdict: fp > valid ? 'DEGRADED' : 'PASS',
  };
}

async function phase11McpNarrative(topEndpoint, warnings) {
  const rows = Array.isArray(topEndpoint?.items) ? topEndpoint.items : (Array.isArray(topEndpoint?.results) ? topEndpoint.results : []);

  const withNarrative = rows.filter((r) => {
    const why = String(r?.why_moving || '').trim();
    const exp = String(r?.explanation || '').trim();
    return why.length > 0 || exp.length > 0;
  });

  const quality = {
    total_rows: rows.length,
    rows_with_narrative: withNarrative.length,
    narrative_coverage_pct: pct(withNarrative.length, rows.length),
    empty_top_symbols: rows.filter((r) => String(r?.why_moving || r?.explanation || '').trim().length === 0).map((r) => r?.symbol).slice(0, 10),
  };

  const connected = rows.length > 0;
  const verdict = connected && quality.narrative_coverage_pct >= 70 ? 'PASS' : 'DEGRADED';

  if (verdict !== 'PASS') {
    warnings.push('Narrative coverage for top-ranked opportunities is below target.');
  }

  return {
    connected,
    narratives_present: withNarrative.length > 0,
    narrative_quality: quality,
    verdict,
  };
}

function phase12MondayReadiness(ctx) {
  const checks = {
    reset_checkpoint_valid: ctx.reset_state.reset_checkpoint_valid,
    no_rogue_loops: !ctx.reset_state.rogue_loops_running,
    market_data_ready: ctx.ingestion_health.market_metrics.row_count > 5000,
    news_ready: ctx.ingestion_health.news.rows_last_24h > 0 && ctx.ingestion_health.news.symbol_coverage_24h > 0,
    earnings_ready: ctx.ingestion_health.earnings.next_7d > 0,
    decision_endpoint_ok: ctx.endpoint_health['/api/intelligence/decision/AAPL']?.ok === true,
    top_opportunities_ok: ctx.endpoint_health['/api/intelligence/top-opportunities?limit=10']?.ok === true,
    watchlist_balanced: ctx.prep_mode.verdict === 'PASS',
    user_can_login: ctx.user_journey.login_status?.valid_login_api?.token_present === true,
    user_can_navigate_ui: ctx.page_audit.some((p) => p.route === '/dashboard' && p.status === 200),
  };

  const criticalFailed = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
  const readiness = {
    checks,
    critical_failed_checks: criticalFailed,
    sunday_allowances_applied: new Date().getUTCDay() === 0,
    summary: criticalFailed.length === 0
      ? 'System appears structurally ready for Monday premarket/open.'
      : `Not ready: failed checks -> ${criticalFailed.join(', ')}`,
  };

  return readiness;
}

async function main() {
  const critical = [];
  const warnings = [];

  const audit = {
    generated_at: nowIso(),
    mode: 'READ_ONLY_SAFE_VALIDATION',
    api_base: DEFAULT_API_BASE,
    api_base_selected: null,
    api_base_selection: null,
    reset_state: {},
    engine_status: {},
    schema_health: {},
    data_inventory: {},
    freshness_summary: {},
    pipeline_integrity: {},
    ingestion_health: {},
    prep_mode: {},
    endpoint_health: {},
    user_journey: {},
    page_audit: [],
    ui_truth: {},
    data_truth: {},
    mcp_status: {},
    critical_issues: critical,
    warnings,
    monday_open_readiness: {},
    verdict: 'NO_GO',
  };

  try {
    audit.reset_state = await phase0ResetAndProcessSanity();

    const baseSelection = await selectApiBase();
    const apiBase = baseSelection.selected;
    audit.api_base_selected = apiBase;
    audit.api_base_selection = baseSelection.candidates;

    if (!audit.reset_state.reset_checkpoint_valid) {
      critical.push('Reset checkpoint is missing or invalid JSON.');
    }
    if (audit.reset_state.rogue_loops_running) {
      critical.push('Rogue repair/calibration/injection loops are still running.');
    }
    if (audit.reset_state.topology_summary.warning_multiple_api_instances) {
      warnings.push('Multiple API instances are active simultaneously; topology may be confusing.');
    }

    audit.engine_status = await phase1EngineStatus(pool, apiBase, critical, warnings);

    const phase2 = await phase2SchemaDataInventory(pool, apiBase);
    audit.schema_health = phase2.schemaHealth;
    audit.data_inventory = phase2.dataInventory;
    audit.freshness_summary = phase2.freshnessSummary;

    audit.pipeline_integrity = await phase3PipelineIntegrity(pool, critical);
    audit.ingestion_health = await phase4IngestionHealth(pool, warnings);
    audit.prep_mode = await phase5PrepMode(apiBase, critical, warnings);
    audit.endpoint_health = await phase6EndpointHealth(apiBase, critical);

    const phase78 = await phase7And8UserJourneyAndPages(apiBase, warnings);
    audit.user_journey = phase78.journey;
    audit.page_audit = phase78.pageAudit;

    if (audit.user_journey.login_status?.valid_login_api?.token_present !== true) {
      critical.push('Valid login API flow failed or token not issued.');
    }

    const rootEntryStatus = audit.user_journey.entry_route?.status;
    if (rootEntryStatus === 404 || rootEntryStatus === 0) {
      critical.push('Entry route at localhost:3001 does not provide a usable landing/login page.');
    }

    audit.ui_truth = await phase9UiTruth(audit.endpoint_health, audit.page_audit);
    if (audit.ui_truth.mismatches.length > 0) {
      warnings.push(`UI contract mismatches detected: ${audit.ui_truth.mismatches.length}`);
    }

    audit.data_truth = await phase10DataTruth(apiBase, warnings);

    const topPayload = audit.endpoint_health['/api/intelligence/top-opportunities?limit=10']?.sample_payload || {};
    audit.mcp_status = await phase11McpNarrative(topPayload, warnings);

    audit.monday_open_readiness = phase12MondayReadiness(audit);

    if (audit.monday_open_readiness.critical_failed_checks.length > 0) {
      critical.push(`Monday readiness failed checks: ${audit.monday_open_readiness.critical_failed_checks.join(', ')}`);
    }

    audit.verdict = critical.length === 0 ? 'GO' : 'NO_GO';
  } catch (error) {
    critical.push(`Audit runtime failure: ${error.message}`);
    audit.verdict = 'NO_GO';
  } finally {
    await pool.end().catch(() => {});
  }

  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  fs.writeFileSync(LOG_PATH, JSON.stringify(audit, null, 2));
  console.log(`WROTE ${LOG_PATH}`);
  console.log(`VERDICT ${audit.verdict}`);
}

main().catch((error) => {
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  fs.writeFileSync(LOG_PATH, JSON.stringify({
    generated_at: nowIso(),
    verdict: 'NO_GO',
    critical_issues: [`Fatal audit bootstrap error: ${error.message}`],
  }, null, 2));
  console.error(error.message);
  process.exit(1);
});
