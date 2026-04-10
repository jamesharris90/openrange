const fs = require('fs');
const path = require('path');

const RUN_DURATION_MINUTES = 30;
const INTERVAL_SECONDS = 60;

const TOTAL_SNAPSHOTS = RUN_DURATION_MINUTES;
const PORT_CANDIDATES = [3001, 3011, 3023, 3016];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeSession(rawSession, rawMode) {
  const session = String(rawSession || '').toUpperCase();
  const mode = String(rawMode || '').toUpperCase();

  if (session === 'AFTER_HOURS' || session === 'WEEKEND' || session === 'DEAD_ZONE') {
    return 'DEAD_ZONE';
  }

  if (session === 'PREMARKET' || session === 'PRE_MARKET') {
    return 'PRE_MARKET';
  }

  if (session === 'OPENING_DRIVE' || session === 'PRE_MARKET_RAMP') {
    return 'PRE_MARKET_RAMP';
  }

  if (
    session === 'MARKET_OPEN' ||
    session === 'REGULAR_HOURS' ||
    session === 'CLOSING_FLOW' ||
    (mode === 'LIVE' && !session)
  ) {
    return 'MARKET_OPEN';
  }

  return session || 'UNKNOWN';
}

function extractRows(payload) {
  if (!payload || typeof payload !== 'object') return [];
  if (Array.isArray(payload.results)) return payload.results;
  if (Array.isArray(payload.data)) return payload.data;
  if (Array.isArray(payload.items)) return payload.items;
  return [];
}

async function fetchJson(url) {
  const started = Date.now();
  const res = await fetch(url);
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return {
    status: res.status,
    ok: res.ok,
    latency_ms: Date.now() - started,
    body,
  };
}

async function detectBaseUrl() {
  for (const port of PORT_CANDIDATES) {
    const base = `http://localhost:${port}`;
    try {
      const health = await fetchJson(`${base}/api/health`);
      if (!health.ok) continue;
      const top = await fetchJson(`${base}/api/intelligence/top-opportunities?limit=10`);
      if (top.ok) return base;
    } catch {
      // try next port
    }
  }
  throw new Error('No live API base found on candidate ports');
}

function ratioTradeable(rows) {
  if (!rows.length) return 0;
  const t = rows.filter((r) => Boolean(r.tradeable)).length;
  return t / rows.length;
}

function evaluateRules(snapshots) {
  let sessionCorrect = true;
  let tradeGatingCorrect = true;

  let earlyFalseTrades = 0;
  let missedOpportunities = 0;

  for (const snap of snapshots) {
    const rows = snap.rows || [];
    if (!rows.length) continue;

    const session = snap.session_normalized;
    const modeSet = new Set(rows.map((r) => String(r.mode || '').toUpperCase()));

    if (session === 'DEAD_ZONE') {
      const tradeableCount = rows.filter((r) => Boolean(r.tradeable)).length;
      if (tradeableCount > 0) {
        tradeGatingCorrect = false;
        earlyFalseTrades += tradeableCount;
      }
      if (!modeSet.has('PREP_ONLY') && !modeSet.has('PREP')) {
        sessionCorrect = false;
      }
    }

    if (session === 'PRE_MARKET') {
      const tradeableRatio = ratioTradeable(rows);
      if (tradeableRatio >= 0.3) {
        tradeGatingCorrect = false;
        earlyFalseTrades += rows.filter((r) => Boolean(r.tradeable)).length;
      }
      if (!modeSet.has('WATCHLIST') && !modeSet.has('PREP')) {
        sessionCorrect = false;
      }
    }

    if (session === 'MARKET_OPEN') {
      const top5 = rows.slice(0, Math.min(5, rows.length));
      const tradeableTop = top5.filter((r) => Boolean(r.tradeable)).length;
      if (tradeableTop === 0 && top5.length > 0) {
        tradeGatingCorrect = false;
        missedOpportunities += top5.length;
      }
    }
  }

  const rampSnapshots = snapshots.filter((s) => s.session_normalized === 'PRE_MARKET_RAMP');
  if (rampSnapshots.length >= 2) {
    const first = rampSnapshots[0];
    const last = rampSnapshots[rampSnapshots.length - 1];

    const firstTradeable = (first.rows || []).filter((r) => Boolean(r.tradeable)).length;
    const lastTradeable = (last.rows || []).filter((r) => Boolean(r.tradeable)).length;
    if (lastTradeable < firstTradeable) {
      tradeGatingCorrect = false;
    }

    const firstSymbols = new Set((first.rows || []).map((r) => String(r.symbol || '').toUpperCase()).filter(Boolean));
    const lastSymbols = new Set((last.rows || []).map((r) => String(r.symbol || '').toUpperCase()).filter(Boolean));

    let newSymbols = 0;
    for (const symbol of lastSymbols) {
      if (!firstSymbols.has(symbol)) newSymbols += 1;
    }
    if (newSymbols === 0) {
      sessionCorrect = false;
    }
  }

  return {
    session_correct: sessionCorrect,
    trade_gating_correct: tradeGatingCorrect,
    early_false_trades: earlyFalseTrades,
    missed_opportunities: missedOpportunities,
    verdict: sessionCorrect && tradeGatingCorrect ? 'PASS' : 'FAIL',
  };
}

async function run() {
  const baseUrl = await detectBaseUrl();
  const snapshots = [];

  for (let i = 0; i < TOTAL_SNAPSHOTS; i += 1) {
    const nowIso = new Date().toISOString();
    let response;
    try {
      response = await fetchJson(`${baseUrl}/api/intelligence/top-opportunities?limit=10`);
    } catch (error) {
      snapshots.push({
        timestamp: nowIso,
        error: error.message,
        session: null,
        session_normalized: 'UNKNOWN',
        rows: [],
      });
      if (i < TOTAL_SNAPSHOTS - 1) await sleep(INTERVAL_SECONDS * 1000);
      continue;
    }

    const rows = extractRows(response.body).map((row) => ({
      timestamp: nowIso,
      symbol: row?.symbol || null,
      session: row?.session || null,
      mode: row?.mode || null,
      tradeable: Boolean(row?.tradeable),
      final_score: Number.isFinite(Number(row?.final_score)) ? Number(row.final_score) : null,
      relative_volume: Number.isFinite(Number(row?.relative_volume)) ? Number(row.relative_volume) : null,
    }));

    const sessionRaw = rows[0]?.session || null;
    const modeRaw = rows[0]?.mode || null;

    snapshots.push({
      timestamp: nowIso,
      status: response.status,
      session: sessionRaw,
      session_normalized: normalizeSession(sessionRaw, modeRaw),
      rows,
    });

    if (i < TOTAL_SNAPSHOTS - 1) await sleep(INTERVAL_SECONDS * 1000);
  }

  const report = evaluateRules(snapshots);

  const outDirRoot = path.join(process.cwd(), 'logs');
  const outDirServer = path.join(process.cwd(), 'server', 'logs');
  const timeseries = {
    generated_at: new Date().toISOString(),
    run_duration_minutes: RUN_DURATION_MINUTES,
    interval_seconds: INTERVAL_SECONDS,
    base_url: baseUrl,
    snapshots,
  };

  fs.mkdirSync(outDirRoot, { recursive: true });
  fs.mkdirSync(outDirServer, { recursive: true });

  const timeseriesRoot = path.join(outDirRoot, 'session_drift_timeseries.json');
  const timeseriesServer = path.join(outDirServer, 'session_drift_timeseries.json');
  const reportRoot = path.join(process.cwd(), 'session_drift_report.json');
  const reportServer = path.join(outDirServer, 'session_drift_report.json');

  fs.writeFileSync(timeseriesRoot, JSON.stringify(timeseries, null, 2));
  fs.writeFileSync(timeseriesServer, JSON.stringify(timeseries, null, 2));
  fs.writeFileSync(reportRoot, JSON.stringify(report, null, 2));
  fs.writeFileSync(reportServer, JSON.stringify(report, null, 2));

  console.log(JSON.stringify({
    ok: true,
    base_url: baseUrl,
    snapshots_collected: snapshots.length,
    report,
    outputs: {
      report_root: reportRoot,
      report_server: reportServer,
      timeseries_root: timeseriesRoot,
      timeseries_server: timeseriesServer,
    },
  }, null, 2));
}

run().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
