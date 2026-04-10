const fs = require('fs');
const http = require('http');

function getJson(pathname, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const started = Date.now();
    let done = false;

    const req = http.get(
      {
        host: '127.0.0.1',
        port: 3001,
        path: pathname,
        timeout: timeoutMs,
      },
      (res) => {
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
          resolve({ status: res.statusCode || 0, ms: Date.now() - started, json, body });
        });
      }
    );

    req.on('timeout', () => {
      if (done) return;
      done = true;
      req.destroy(new Error('timeout'));
      resolve({ status: 0, ms: Date.now() - started, json: null, body: '' });
    });

    req.on('error', () => {
      if (done) return;
      done = true;
      resolve({ status: 0, ms: Date.now() - started, json: null, body: '' });
    });
  });
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function hasText(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function validateRow(row) {
  const catalyst = row.catalyst ?? row.why_moving ?? row.catalyst_type ?? null;
  const catalystPresent = hasText(catalyst);

  const catalystStr = String(catalyst || '').toUpperCase();
  const earningsOrNewsDriver =
    catalystStr.includes('EARN') ||
    catalystStr.includes('NEWS') ||
    hasText(row.news_headline) ||
    hasText(row.news_summary) ||
    Boolean(row.has_earnings_soon) ||
    Boolean(row.earnings_upcoming);

  const changePercent =
    toNum(row.change_percent) ??
    toNum(row.daily_change_percent) ??
    toNum(row.price_change_percent) ??
    toNum(row.percent_change) ??
    toNum(row.changePct);
  const actuallyMoving = changePercent !== null && Math.abs(changePercent) >= 0.5;

  const rvol =
    toNum(row.relative_volume) ??
    toNum(row.rvol) ??
    toNum(row.relativeVolume);
  const liquidity = toNum(row.volume) ?? toNum(row.avg_volume_30d) ?? toNum(row.avg_volume);
  const liquidityAndRvolValid = (rvol !== null && rvol >= 1) || (liquidity !== null && liquidity > 0);

  const plan = row.execution_plan;
  const executionPlanRealistic =
    plan && typeof plan === 'object' &&
    hasText(plan.entry) &&
    hasText(plan.stop) &&
    hasText(plan.target);

  const checks = {
    catalyst_present: catalystPresent,
    earnings_or_news_driver: earningsOrNewsDriver,
    actually_moving: actuallyMoving,
    liquidity_rvol_valid: liquidityAndRvolValid,
    execution_plan_realistic: executionPlanRealistic,
  };

  let classification = 'false_positive';
  if (
    checks.catalyst_present &&
    checks.earnings_or_news_driver &&
    checks.actually_moving &&
    checks.liquidity_rvol_valid &&
    checks.execution_plan_realistic
  ) {
    classification = 'valid';
  } else if (
    checks.catalyst_present &&
    checks.execution_plan_realistic &&
    (checks.actually_moving || checks.liquidity_rvol_valid)
  ) {
    classification = 'weak';
  }

  return {
    symbol: String(row.symbol || '').toUpperCase(),
    classification,
    checks,
    metrics: {
      change_percent: changePercent,
      relative_volume: rvol,
      liquidity,
      catalyst: catalyst || null,
      strategy: row.strategy || null,
    },
  };
}

async function main() {
  const result = await getJson('/api/intelligence/top-opportunities?limit=20', 90000);

  const rows = Array.isArray(result.json?.data)
    ? result.json.data
    : (Array.isArray(result.json?.results) ? result.json.results : []);

  const top20 = rows.slice(0, 20);
  const evaluations = top20.map(validateRow);

  const summary = {
    timestamp: new Date().toISOString(),
    endpoint_status: result.status,
    endpoint_latency_ms: result.ms,
    total: evaluations.length,
    counts: {
      valid: evaluations.filter((e) => e.classification === 'valid').length,
      weak: evaluations.filter((e) => e.classification === 'weak').length,
      false_positive: evaluations.filter((e) => e.classification === 'false_positive').length,
    },
  };

  const out = {
    summary,
    opportunities: evaluations,
  };

  fs.writeFileSync('/Users/jamesharris/Server/logs/top20_opportunities_validation.json', JSON.stringify(out, null, 2));
  console.log(JSON.stringify(summary));

  if (result.status !== 200) {
    process.exitCode = 1;
  }
}

main();
