const fs = require('fs');
const path = require('path');
const http = require('http');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const { pool } = require('../db/pg');

const LOG_DIR = '/Users/jamesharris/Server/logs';

function writeJson(fileName, data) {
  fs.writeFileSync(path.join(LOG_DIR, fileName), JSON.stringify(data, null, 2));
}

function getJson(pathname, timeoutMs = 30000) {
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

function countNull(items, key) {
  let nulls = 0;
  for (const item of items || []) {
    if (item == null || item[key] == null) nulls += 1;
  }
  return nulls;
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function hasText(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function validateTopRow(row) {
  const checks = {
    change_percent_present: row?.change_percent != null && Number.isFinite(Number(row.change_percent)),
    catalyst_present: hasText(row?.catalyst_type) || hasText(row?.why_moving),
    earnings_news_present:
      String(row?.catalyst_type || '').toUpperCase().includes('EARN') ||
      String(row?.why_moving || '').toUpperCase().includes('EARN') ||
      String(row?.why_moving || '').toUpperCase().includes('NEWS') ||
      Boolean(row?.earnings_flag),
    liquidity_present: (toNum(row?.volume) || 0) > 0 || (toNum(row?.relative_volume) || 0) >= 1,
    execution_plan_present:
      row?.execution_plan &&
      hasText(row.execution_plan.entry) &&
      hasText(row.execution_plan.stop) &&
      hasText(row.execution_plan.target),
  };

  const passCount = Object.values(checks).filter(Boolean).length;

  let classification = 'false_positive';
  if (passCount >= 4 && checks.change_percent_present && checks.execution_plan_present) {
    classification = 'valid';
  } else if (passCount >= 2) {
    classification = 'weak';
  }

  return {
    symbol: String(row?.symbol || '').toUpperCase(),
    classification,
    checks,
    change_percent: toNum(row?.change_percent),
    relative_volume: toNum(row?.relative_volume),
    strategy: row?.strategy || null,
  };
}

async function phase0Trace() {
  const dbResult = await pool.query(
    `SELECT symbol, price, change_percent, avg_volume_30d
     FROM market_metrics
     LIMIT 20`
  );
  const dbRows = dbResult.rows || [];

  const quotes = await getJson('/api/market/quotes?symbols=SPY,QQQ,AAPL', 20000);
  const top = await getJson('/api/intelligence/top-opportunities?limit=20', 90000);

  const quoteRows = Array.isArray(quotes.json?.data) ? quotes.json.data : [];
  const topRows = Array.isArray(top.json?.data) ? top.json.data : [];

  const trace = {
    timestamp: new Date().toISOString(),
    db: {
      row_count: dbRows.length,
      sample: dbRows,
      change_percent_nulls: countNull(dbRows, 'change_percent'),
    },
    quotes_api: {
      status: quotes.status,
      latency_ms: quotes.ms,
      row_count: quoteRows.length,
      sample: quoteRows,
      change_percent_nulls: countNull(quoteRows, 'change_percent'),
    },
    intelligence_top_opportunities: {
      status: top.status,
      latency_ms: top.ms,
      row_count: topRows.length,
      sample: topRows,
      change_percent_nulls: countNull(topRows, 'change_percent'),
    },
  };

  writeJson('change_percent_trace.json', trace);
  return trace;
}

async function phase1QuotesValidation() {
  const quotes = await getJson('/api/market/quotes?symbols=SPY,QQQ,AAPL', 20000);
  const rows = Array.isArray(quotes.json?.data) ? quotes.json.data : [];

  const out = {
    timestamp: new Date().toISOString(),
    status: quotes.status,
    latency_ms: quotes.ms,
    count: rows.length,
    change_percent_nulls: countNull(rows, 'change_percent'),
    sample: rows,
    pass: quotes.status === 200 && rows.length >= 3 && countNull(rows, 'change_percent') === 0,
  };

  writeJson('change_percent_quotes_validation.json', out);
  if (!out.pass) throw new Error('Phase 1 failed: quotes change_percent contract invalid');
  return out;
}

async function phase2IntelligenceValidation() {
  const top = await getJson('/api/intelligence/top-opportunities?limit=20', 90000);
  const rows = Array.isArray(top.json?.data) ? top.json.data : [];

  const out = {
    timestamp: new Date().toISOString(),
    status: top.status,
    latency_ms: top.ms,
    count: rows.length,
    change_percent_nulls: countNull(rows, 'change_percent'),
    pass: top.status === 200 && rows.length > 0 && countNull(rows, 'change_percent') === 0,
  };

  writeJson('change_percent_intelligence_validation.json', out);
  if (!out.pass) throw new Error('Phase 2 failed: intelligence change_percent nulls remain');
  return out;
}

async function phase3Performance() {
  const runs = [];
  for (let i = 1; i <= 3; i += 1) {
    const top = await getJson('/api/intelligence/top-opportunities?limit=20', 15000);
    const rows = Array.isArray(top.json?.data) ? top.json.data : [];
    runs.push({ run: i, status: top.status, response_time_ms: top.ms, count: rows.length, timeout: top.timeout });
  }

  const pass = runs.every((r) => r.status === 200 && r.response_time_ms < 2000 && r.count >= 10 && !r.timeout);
  const out = { timestamp: new Date().toISOString(), runs, pass };
  writeJson('top_opportunities_performance.json', out);
  if (!pass) throw new Error('Phase 3 failed: top opportunities performance requirement not met');
  return out;
}

async function phase4Quality() {
  const top = await getJson('/api/intelligence/top-opportunities?limit=20', 15000);
  const rows = Array.isArray(top.json?.data) ? top.json.data : [];
  const top20 = rows.slice(0, 20);

  const evaluations = top20.map(validateTopRow);
  const valid = evaluations.filter((e) => e.classification === 'valid').length;
  const weak = evaluations.filter((e) => e.classification === 'weak').length;
  const falsePositive = evaluations.filter((e) => e.classification === 'false_positive').length;

  const total = evaluations.length;
  const validPercent = total > 0 ? Number(((valid / total) * 100).toFixed(2)) : 0;
  const falsePositivePercent = total > 0 ? Number(((falsePositive / total) * 100).toFixed(2)) : 0;

  const out = {
    timestamp: new Date().toISOString(),
    total,
    counts: { valid, weak, false_positive: falsePositive },
    valid_percent: validPercent,
    false_positive_percent: falsePositivePercent,
    pass: validPercent >= 40 && falsePositivePercent <= 30,
    opportunities: evaluations,
  };

  writeJson('top20_validation_post_fix.json', out);
  if (!out.pass) throw new Error('Phase 4 failed: signal quality thresholds not met');
  return out;
}

async function phase5SystemValidation(trace, perf) {
  const watch = await getJson('/api/intelligence/watchlist?limit=30', 5000);
  const decision = await getJson('/api/intelligence/decision/AAPL', 5000);
  const quote = await getJson('/api/market/quotes?symbols=SPY,QQQ,AAPL', 20000);

  const watchRows = Array.isArray(watch.json?.data) ? watch.json.data : [];
  const quoteRows = Array.isArray(quote.json?.data) ? quote.json.data : [];
  const latencies = (perf.runs || []).map((r) => r.response_time_ms);
  const latencyMs = latencies.length > 0 ? Math.max(...latencies) : 0;

  const out = {
    timestamp: new Date().toISOString(),
    checks: {
      change_percent_never_null: trace.db.change_percent_nulls === 0 && trace.quotes_api.change_percent_nulls === 0 && trace.intelligence_top_opportunities.change_percent_nulls === 0,
      top_latency_under_2s: latencyMs < 2000,
      watchlist_stable: watch.status === 200 && watchRows.length > 0 && !watch.timeout,
      decision_endpoint_valid: decision.status === 200,
      quotes_status_valid: quote.status === 200 && countNull(quoteRows, 'change_percent') === 0,
    },
  };

  return { out, latencyMs };
}

async function main() {
  let trace = null;
  let perf = null;
  let quality = null;

  try {
    trace = await phase0Trace();
    if (trace.db.change_percent_nulls > 0 || trace.quotes_api.change_percent_nulls > 0 || trace.intelligence_top_opportunities.change_percent_nulls > 0) {
      // Continue: fix path expected by mission.
    }

    await phase1QuotesValidation();
    await phase2IntelligenceValidation();
    perf = await phase3Performance();
    quality = await phase4Quality();

    const phase5 = await phase5SystemValidation(trace, perf);

    const report = {
      change_percent_fixed: true,
      latency_ms: phase5.latencyMs,
      top_opportunities_count: perf.runs?.[perf.runs.length - 1]?.count || 0,
      valid_percent: quality.valid_percent,
      false_positive_percent: quality.false_positive_percent,
      verdict:
        phase5.out.checks.change_percent_never_null &&
        phase5.out.checks.top_latency_under_2s &&
        quality.valid_percent >= 40
          ? 'PASS'
          : 'FAIL',
      phase5_checks: phase5.out.checks,
    };

    writeJson('core_fix_report.json', report);

    if (report.verdict !== 'PASS') {
      throw new Error('Phase 5 failed: final system criteria not met');
    }

    console.log(JSON.stringify(report));
  } catch (error) {
    const fallback = {
      change_percent_fixed: Boolean(trace && trace.db?.change_percent_nulls === 0),
      latency_ms: Number(perf?.runs?.[perf.runs.length - 1]?.response_time_ms || 0),
      top_opportunities_count: Number(perf?.runs?.[perf.runs.length - 1]?.count || 0),
      valid_percent: Number(quality?.valid_percent || 0),
      false_positive_percent: Number(quality?.false_positive_percent || 0),
      verdict: 'FAIL',
      error: String(error.message || error),
    };
    writeJson('core_fix_report.json', fallback);
    console.error(error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
