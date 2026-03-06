const fs = require('fs');
const path = require('path');
const { performance } = require('perf_hooks');

require('dotenv').config({ path: path.resolve(__dirname, '..', 'server', '.env') });
const { pool } = require(path.resolve(__dirname, '..', 'server', 'db', 'pg'));

const base = 'http://localhost:3000';
const frontendBase = 'http://localhost:5173';

async function hit(endpoint, options = {}) {
  const url = `${base}${endpoint}`;
  const started = performance.now();
  try {
    const headers = {
      ...(process.env.PROXY_API_KEY ? { 'x-api-key': process.env.PROXY_API_KEY } : {}),
      ...(process.env.ACCEPTANCE_JWT ? { Authorization: `Bearer ${process.env.ACCEPTANCE_JWT}` } : {}),
      ...(options.headers || {}),
    };
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers,
      body: options.body,
    });
    const elapsed = Number((performance.now() - started).toFixed(2));
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return {
      endpoint,
      ok: response.ok,
      status: response.status,
      time_ms: elapsed,
      is_json: json !== null,
      bytes: Buffer.byteLength(text || ''),
      body: json,
      body_preview: text.slice(0, 260),
    };
  } catch (error) {
    const elapsed = Number((performance.now() - started).toFixed(2));
    return {
      endpoint,
      ok: false,
      status: null,
      time_ms: elapsed,
      is_json: false,
      bytes: 0,
      error: error.message,
    };
  }
}

async function frontendHit(route) {
  const url = `${frontendBase}${route}`;
  const started = performance.now();
  try {
    const response = await fetch(url);
    const elapsed = Number((performance.now() - started).toFixed(2));
    const text = await response.text();
    return {
      route,
      status: response.status,
      ok: response.ok,
      time_ms: elapsed,
      has_html: /<html|<div id=\"root\"|<!doctype html>/i.test(text),
      has_loading_word: /loading/i.test(text),
      bytes: Buffer.byteLength(text || ''),
    };
  } catch (error) {
    const elapsed = Number((performance.now() - started).toFixed(2));
    return { route, ok: false, status: null, time_ms: elapsed, error: error.message };
  }
}

function getFirstItem(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (Array.isArray(payload)) return payload[0] || null;
  for (const key of ['rows', 'items', 'signals', 'earnings', 'sectors', 'indices', 'tickers']) {
    if (Array.isArray(payload[key])) return payload[key][0] || null;
  }
  return payload;
}

function hasField(obj, key) {
  return obj && Object.prototype.hasOwnProperty.call(obj, key);
}

(async () => {
  const report = {
    generated_at: new Date().toISOString(),
    step1_health: null,
    step2_counts: null,
    step3_core_apis: [],
    step4_screener: [],
    step5_strategy: [],
    step6_earnings: [],
    step7_expected_move: null,
    step8_intel_news: [],
    step9_sector: [],
    step10_trend: null,
    step11_perf_flags: [],
    step12_frontend_routes: {
      declared_in_app: {},
      http_checks: [],
    },
    step13_invalid_endpoint: null,
    step14_scheduler: null,
    validations: {},
    notes: [],
  };

  try {
    report.step1_health = await hit('/api/system/health');

    const q = async (sql) => (await pool.query(sql)).rows[0].count;
    const counts = {
      market_quotes: Number(await q('SELECT COUNT(*)::int AS count FROM market_quotes')),
      market_metrics: Number(await q('SELECT COUNT(*)::int AS count FROM market_metrics')),
      tradable_universe: Number(await q('SELECT COUNT(*)::int AS count FROM tradable_universe')),
      strategy_signals: Number(await q('SELECT COUNT(*)::int AS count FROM strategy_signals')),
    };
    const approx = (a, b) => {
      if (a === 0 && b === 0) return true;
      const max = Math.max(a, b, 1);
      return Math.abs(a - b) / max <= 0.1;
    };
    report.step2_counts = {
      ...counts,
      validations: {
        metrics_approx_quotes: approx(counts.market_metrics, counts.market_quotes),
        universe_approx_metrics: approx(counts.tradable_universe, counts.market_metrics),
        signals_gt_zero: counts.strategy_signals > 0,
      }
    };

    for (const ep of ['/api/market/quotes?limit=5','/api/market/movers','/api/market/sectors','/api/market/indices','/api/market/tickers']) {
      report.step3_core_apis.push(await hit(ep));
    }

    for (const ep of ['/api/screener/full','/api/screener/full?gap_min=5','/api/screener/full?rvol_min=2']) {
      report.step4_screener.push(await hit(ep));
    }

    for (const ep of ['/api/signals','/api/signals/AAPL']) {
      report.step5_strategy.push(await hit(ep));
    }

    for (const ep of ['/api/earnings/today','/api/earnings/week']) {
      report.step6_earnings.push(await hit(ep));
    }

    report.step7_expected_move = await hit('/api/expected-move');

    for (const ep of ['/api/intelligence/news','/api/intelligence/news?hours=6']) {
      report.step8_intel_news.push(await hit(ep));
    }

    for (const ep of ['/api/market/sectors','/api/sector/Technology']) {
      report.step9_sector.push(await hit(ep));
    }

    report.step10_trend = await hit('/api/chart/trend/AAPL');

    const perfTargets = [
      ...report.step3_core_apis.filter(r => r.endpoint.includes('/api/market/quotes')),
      ...report.step5_strategy.filter(r => r.endpoint === '/api/signals'),
      ...report.step4_screener.filter(r => r.endpoint === '/api/screener/full'),
      ...report.step8_intel_news.filter(r => r.endpoint === '/api/intelligence/news'),
    ];
    report.step11_perf_flags = perfTargets.filter(r => r.time_ms > 700).map(r => ({ endpoint: r.endpoint, time_ms: r.time_ms }));

    const appPath = path.resolve(__dirname, '..', 'client', 'src', 'App.jsx');
    const appText = fs.readFileSync(appPath, 'utf8');
    const requiredRoutes = ['/screener','/earnings-calendar','/expected-move','/intelligence-inbox','/sector-heatmap','/charts'];
    for (const route of requiredRoutes) {
      report.step12_frontend_routes.declared_in_app[route] = appText.includes(`path=\"${route}\"`) || appText.includes(`path='${route}'`);
      report.step12_frontend_routes.http_checks.push(await frontendHit(route));
    }

    report.step13_invalid_endpoint = await hit('/api/invalid/test');

    if (report.step1_health?.body) {
      const body = report.step1_health.body;
      report.step14_scheduler = {
        alert_scheduler: body.scheduler || null,
        engine_scheduler: body.engine_scheduler || null,
      };
    }

    const quoteResp = report.step3_core_apis.find(x => x.endpoint.startsWith('/api/market/quotes'));
    report.validations.core_quotes_non_empty = Array.isArray(quoteResp?.body?.rows) && quoteResp.body.rows.length > 0;

    const screenerBase = report.step4_screener.find(x => x.endpoint === '/api/screener/full');
    const screenerGap = report.step4_screener.find(x => x.endpoint === '/api/screener/full?gap_min=5');
    const screenerRvol = report.step4_screener.find(x => x.endpoint === '/api/screener/full?rvol_min=2');
    const screenerBaseCount = Array.isArray(screenerBase?.body?.rows) ? screenerBase.body.rows.length : 0;
    const screenerGapCount = Array.isArray(screenerGap?.body?.rows) ? screenerGap.body.rows.length : 0;
    const screenerRvolCount = Array.isArray(screenerRvol?.body?.rows) ? screenerRvol.body.rows.length : 0;
    report.validations.screener_counts = { base: screenerBaseCount, gap_min_5: screenerGapCount, rvol_min_2: screenerRvolCount };
    report.validations.screener_filter_changes_count = screenerBaseCount !== screenerGapCount || screenerBaseCount !== screenerRvolCount;

    const signalsSample = getFirstItem(report.step5_strategy.find(x => x.endpoint === '/api/signals')?.body);
    report.validations.signals_required_fields = signalsSample && ['strategy','score','class','gap_percent','relative_volume'].every(k => hasField(signalsSample, k));

    const earningsSample = getFirstItem(report.step6_earnings.find(x => x.endpoint === '/api/earnings/week')?.body);
    report.validations.earnings_required_fields = earningsSample && ['symbol','date','eps_estimate','sector'].every(k => hasField(earningsSample, k));

    const expectedSample = getFirstItem(report.step7_expected_move?.body);
    report.validations.expected_move_required_fields = expectedSample && ['price','expected_move','earnings_date'].every(k => hasField(expectedSample, k));

    const newsSample = getFirstItem(report.step8_intel_news.find(x => x.endpoint === '/api/intelligence/news')?.body);
    report.validations.news_required_fields = newsSample && ['symbol','headline','source'].every(k => hasField(newsSample, k));
    report.validations.news_timestamp_present = Boolean(newsSample && (hasField(newsSample, 'published_at') || hasField(newsSample, 'timestamp') || hasField(newsSample, 'updated_at')));

    const sectorSample = getFirstItem(report.step9_sector.find(x => x.endpoint === '/api/market/sectors')?.body);
    report.validations.sector_fields = sectorSample && ['sector','avg_change','leaders'].every(k => hasField(sectorSample, k));

    const trendSample = report.step10_trend?.body;
    report.validations.trend_fields = trendSample && ['trend','support','resistance','channel'].every(k => hasField(trendSample, k));

    report.validations.invalid_endpoint_success_false = report.step13_invalid_endpoint?.is_json && report.step13_invalid_endpoint?.body?.success === false;

  } catch (fatal) {
    report.notes.push(`Fatal harness error: ${fatal.message}`);
  } finally {
    try { await pool.end(); } catch {}
  }

  const outPath = path.resolve(__dirname, '..', 'SYSTEM_ACCEPTANCE_RAW.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(JSON.stringify({
    output: outPath,
    health_status: report.step1_health?.body?.status || null,
    db_counts: report.step2_counts,
    perf_flags: report.step11_perf_flags,
    invalid_endpoint: {
      status: report.step13_invalid_endpoint?.status,
      is_json: report.step13_invalid_endpoint?.is_json,
      success_field: report.step13_invalid_endpoint?.body?.success,
    },
  }, null, 2));
})();
