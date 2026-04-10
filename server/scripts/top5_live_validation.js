const fs = require('fs');
const path = require('path');

const API_BASE = 'http://127.0.0.1:3001';
const LOG_DIR = path.resolve(__dirname, '../../logs');
const MASTER_REPORT = path.resolve(__dirname, '../../top5_master_validation.json');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function hasValue(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  return true;
}

function upper(v) {
  return String(v || '').trim().toUpperCase();
}

function abs(v) {
  return Math.abs(Number(v) || 0);
}

function extractRows(payload) {
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

async function fetchJson(url, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    return {
      ok: res.ok,
      status: res.status,
      ms: Date.now() - started,
      body,
      text,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      ms: Date.now() - started,
      body: null,
      text: '',
      error: String(error.message || error),
    };
  } finally {
    clearTimeout(timer);
  }
}

function executionPlanPresent(plan) {
  if (!hasValue(plan)) return false;
  if (typeof plan === 'object') {
    return Object.keys(plan).length > 0;
  }
  return hasValue(plan);
}

function catalystPoints(catalystType) {
  const c = upper(catalystType);
  if (c === 'EARNINGS' || c === 'NEWS' || c === 'GAP') return 1;
  return 0;
}

function classifyMove(changePercent) {
  const magnitude = abs(changePercent);
  if (magnitude >= 8) return 'extended';
  if (magnitude >= 3) return 'active';
  return 'early';
}

function evaluateTrade(row) {
  const cp = num(row.change_percent);
  const rv = num(row.relative_volume);
  const catalystType = hasValue(row.catalyst_type) ? String(row.catalyst_type) : null;
  const planExists = executionPlanPresent(row.execution_plan);

  const tradeabilityScore =
    catalystPoints(catalystType) +
    (rv !== null && rv >= 1.5 ? 1 : 0) +
    (planExists ? 1 : 0);

  const stocksInPlay =
    (rv !== null && rv >= 2) ||
    (cp !== null && abs(cp) >= 3) ||
    (catalystType !== null);

  const moveStatus = classifyMove(cp);

  let verdict = 'WEAK';
  if (tradeabilityScore >= 2 && stocksInPlay === true && moveStatus !== 'extended') {
    verdict = 'TRADEABLE';
  } else if (moveStatus === 'extended') {
    verdict = 'EXHAUSTED';
  }

  return {
    tradeability_score: tradeabilityScore,
    stocks_in_play: stocksInPlay,
    move_status: moveStatus,
    verdict,
  };
}

function requiredFieldFailures(row) {
  const required = [
    'symbol',
    'final_score',
    'change_percent',
    'relative_volume',
    'catalyst_type',
    'strategy',
    'why_moving',
    'why_tradeable',
    'how_to_trade',
    'execution_plan',
  ];

  const missing = [];
  for (const key of required) {
    if (!hasValue(row[key])) missing.push(key);
  }
  return missing;
}

function tokenCandidates(value) {
  const n = num(value);
  if (n === null) return [];
  return [
    String(n),
    n.toFixed(2),
    n.toFixed(1),
    n.toFixed(0),
    `${n.toFixed(2)}%`,
    `${n.toFixed(1)}%`,
    `${n.toFixed(0)}%`,
  ];
}

function normalizeWhitespace(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function includesAny(text, candidates) {
  const lower = text.toLowerCase();
  return candidates.some((c) => lower.includes(String(c).toLowerCase()));
}

async function validateUi(top5) {
  const result = {
    timestamp: new Date().toISOString(),
    pages_visited: [],
    page_errors: [],
    symbols: [],
    ui_failures: 0,
    pass: false,
    blockers: [],
  };

  let playwright;
  try {
    playwright = require('playwright');
  } catch (error) {
    result.blockers.push(`playwright_not_available: ${String(error.message || error)}`);
    for (const row of top5) {
      result.symbols.push({
        symbol: row.symbol,
        visible_on_site: false,
        page_location: '',
        data_match: false,
        intelligence_visible: false,
        ui_quality: 'broken',
        failure_reasons: ['UI automation unavailable'],
      });
    }
    result.ui_failures = top5.length;
    result.pass = false;
    return result;
  }

  const urls = [
    { key: 'homepage', url: 'http://localhost:3001' },
    { key: 'premarket', url: 'http://localhost:3001/dashboard' },
    { key: 'top_opportunities', url: 'http://localhost:3001/intelligence' },
    { key: 'earnings', url: 'http://localhost:3001/earnings' },
    { key: 'research', url: 'http://localhost:3001/research' },
    { key: 'homepage_app', url: 'http://localhost:3000' },
    { key: 'premarket_app', url: 'http://localhost:3000/dashboard' },
    { key: 'top_opportunities_app', url: 'http://localhost:3000/intelligence' },
    { key: 'earnings_app', url: 'http://localhost:3000/earnings' },
    { key: 'research_app', url: 'http://localhost:3000/research' },
  ];

  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push({ type: 'console', text: msg.text() });
    }
  });
  page.on('pageerror', (err) => {
    consoleErrors.push({ type: 'pageerror', text: String(err.message || err) });
  });

  const snapshots = [];

  for (const entry of urls) {
    let status = 0;
    let finalUrl = entry.url;
    let ok = false;
    let error = null;

    try {
      const res = await page.goto(entry.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      status = res ? res.status() : 0;
      finalUrl = page.url();
      ok = status > 0;
      await page.waitForTimeout(600);

      const bodyText = await page.evaluate(() => {
        const el = document.body;
        return el ? (el.innerText || '') : '';
      });

      snapshots.push({
        key: entry.key,
        url: entry.url,
        final_url: finalUrl,
        status,
        ok,
        body_text: normalizeWhitespace(bodyText),
        has_undefined: /\bundefined\b/i.test(String(bodyText || '')),
      });
    } catch (e) {
      error = String(e.message || e);
      snapshots.push({
        key: entry.key,
        url: entry.url,
        final_url: finalUrl,
        status,
        ok,
        body_text: '',
        has_undefined: false,
        error,
      });
    }

    result.pages_visited.push({ key: entry.key, url: entry.url, final_url: finalUrl, status, ok, error });
  }

  result.page_errors = consoleErrors;

  for (const row of top5) {
    const symbol = String(row.symbol || '').toUpperCase();
    const failureReasons = [];
    const locations = [];
    let visible = false;

    let numericMatch = false;
    let textMatch = false;
    let intelligenceVisible = false;

    for (const snap of snapshots) {
      if (!snap.body_text) continue;

      const hasSymbol = new RegExp(`\\b${symbol}\\b`, 'i').test(snap.body_text);
      if (!hasSymbol) continue;

      visible = true;
      locations.push(snap.key);

      const scoreTokens = tokenCandidates(row.final_score);
      const changeTokens = tokenCandidates(row.change_percent);
      const strategy = normalizeWhitespace(row.strategy || '');
      const catalyst = normalizeWhitespace(row.catalyst_type || '');

      const foundScore = includesAny(snap.body_text, scoreTokens);
      const foundChange = includesAny(snap.body_text, changeTokens);
      const foundStrategy = strategy.length > 0 && includesAny(snap.body_text, [strategy]);
      const foundCatalyst = catalyst.length > 0 && includesAny(snap.body_text, [catalyst]);

      if (foundScore && foundChange) numericMatch = true;
      if (foundStrategy && foundCatalyst) textMatch = true;

      const whyMoving = normalizeWhitespace(row.why_moving || '');
      const whyTradeable = normalizeWhitespace(row.why_tradeable || '');
      const plan = row.execution_plan;
      const planTokens = [];
      if (plan && typeof plan === 'object') {
        if (hasValue(plan.entry)) planTokens.push(String(plan.entry));
        if (hasValue(plan.stop)) planTokens.push(String(plan.stop));
        if (hasValue(plan.target)) planTokens.push(String(plan.target));
      }

      const hasWhyMoving = whyMoving.length > 8 && includesAny(snap.body_text, [whyMoving.slice(0, 20), whyMoving.slice(0, 30)]);
      const hasWhyTradeable = whyTradeable.length > 8 && includesAny(snap.body_text, [whyTradeable.slice(0, 20), whyTradeable.slice(0, 30)]);
      const hasPlan = planTokens.length > 0 && includesAny(snap.body_text, planTokens.map((x) => normalizeWhitespace(x).slice(0, 20)));

      if (hasWhyMoving && hasWhyTradeable && hasPlan) {
        intelligenceVisible = true;
      }
    }

    const dataMatch = numericMatch && textMatch;

    if (!visible) failureReasons.push('symbol_not_visible');
    if (!dataMatch) failureReasons.push('ui_api_data_mismatch');
    if (!intelligenceVisible) failureReasons.push('intelligence_not_visible');

    const undefinedOnSymbolPages = snapshots.some((s) => locations.includes(s.key) && s.has_undefined);
    if (undefinedOnSymbolPages) failureReasons.push('undefined_rendered');

    const hasConsoleError = consoleErrors.length > 0;
    if (hasConsoleError) failureReasons.push('console_errors_present');

    const uiQuality =
      failureReasons.length === 0
        ? 'good'
        : (visible || dataMatch || intelligenceVisible ? 'partial' : 'broken');

    result.symbols.push({
      symbol,
      visible_on_site: visible,
      page_location: locations.join(', '),
      data_match: dataMatch,
      intelligence_visible: intelligenceVisible,
      ui_quality: uiQuality,
      failure_reasons: failureReasons,
    });
  }

  await context.close();
  await browser.close();

  result.ui_failures = result.symbols.filter((s) => {
    return !s.visible_on_site || !s.data_match || !s.intelligence_visible || s.ui_quality === 'broken';
  }).length;
  result.pass = result.ui_failures === 0;

  return result;
}

async function main() {
  ensureDir(LOG_DIR);

  const notes = [];

  // PHASE 1
  const topRes = await fetchJson(`${API_BASE}/api/intelligence/top-opportunities?limit=5`, 25000);
  const rows = extractRows(topRes.body);
  const top5 = rows.slice(0, 5).map((r) => ({
    symbol: r?.symbol ?? null,
    final_score: r?.final_score ?? null,
    change_percent: r?.change_percent ?? null,
    relative_volume: r?.relative_volume ?? null,
    catalyst_type: r?.catalyst_type ?? null,
    strategy: r?.strategy ?? null,
    why_moving: r?.why_moving ?? null,
    why_tradeable: r?.why_tradeable ?? null,
    how_to_trade: r?.how_to_trade ?? null,
    execution_plan: r?.execution_plan ?? null,
  }));

  const missingBySymbol = top5.map((r) => ({ symbol: r.symbol, missing_fields: requiredFieldFailures(r) }));
  const anyMissing = missingBySymbol.some((x) => x.missing_fields.length > 0);

  const top5Raw = {
    timestamp: new Date().toISOString(),
    endpoint: '/api/intelligence/top-opportunities?limit=5',
    status: topRes.status,
    latency_ms: topRes.ms,
    count: top5.length,
    pass: topRes.status === 200 && top5.length >= 5 && !anyMissing,
    missing_fields: missingBySymbol,
    data: top5,
  };

  writeJson(path.join(LOG_DIR, 'top5_raw.json'), top5Raw);

  if (top5.length < 5) {
    notes.push(`FAIL: top opportunities returned ${top5.length} rows (<5)`);
  }
  if (anyMissing) {
    notes.push('FAIL: required fields missing in top5 payload');
  }

  // PHASE 2 + 3
  const tradeRows = top5.map((row) => {
    const computed = evaluateTrade(row);
    return {
      symbol: row.symbol,
      final_score: row.final_score,
      change_percent: row.change_percent,
      relative_volume: row.relative_volume,
      catalyst_type: row.catalyst_type,
      strategy: row.strategy,
      tradeability_score: computed.tradeability_score,
      stocks_in_play: computed.stocks_in_play,
      move_status: computed.move_status,
      verdict: computed.verdict,
      why_moving: row.why_moving,
      why_tradeable: row.why_tradeable,
      how_to_trade: row.how_to_trade,
      execution_plan: row.execution_plan,
      missing_fields: requiredFieldFailures(row),
    };
  });

  const tradeSummary = {
    timestamp: new Date().toISOString(),
    total: tradeRows.length,
    tradeable_count: tradeRows.filter((r) => r.verdict === 'TRADEABLE').length,
    exhausted_count: tradeRows.filter((r) => r.verdict === 'EXHAUSTED').length,
    weak_count: tradeRows.filter((r) => r.verdict === 'WEAK').length,
    pass: tradeRows.length >= 5 && tradeRows.every((r) => r.missing_fields.length === 0),
    data: tradeRows,
  };

  writeJson(path.join(LOG_DIR, 'top5_trade_truth_report.json'), tradeSummary);

  // PHASE 4 + 5
  const ui = await validateUi(top5);
  writeJson(path.join(LOG_DIR, 'top5_ui_validation.json'), ui);

  // PHASE 6
  const uiFailures = Number(ui.ui_failures || 0);
  const finalVerdict =
    tradeSummary.tradeable_count >= 2 &&
    uiFailures === 0 &&
    top5Raw.pass &&
    tradeSummary.pass
      ? 'TRADING SYSTEM VALID'
      : 'SYSTEM MISLEADING OR INCOMPLETE';

  if (finalVerdict !== 'TRADING SYSTEM VALID') {
    if (!top5Raw.pass) notes.push('FAIL: top5 raw feed contract failed');
    if (!tradeSummary.pass) notes.push('FAIL: trader-level validation contains missing required fields');
    if (tradeSummary.tradeable_count < 2) notes.push(`FAIL: tradeable_count=${tradeSummary.tradeable_count} (<2)`);
    if (uiFailures > 0) notes.push(`FAIL: ui_failures=${uiFailures}`);
  }

  const master = {
    timestamp: new Date().toISOString(),
    trade_summary: {
      total: tradeSummary.total,
      tradeable_count: tradeSummary.tradeable_count,
      exhausted_count: tradeSummary.exhausted_count,
      weak_count: tradeSummary.weak_count,
      source_status: top5Raw.status,
      source_latency_ms: top5Raw.latency_ms,
      source_count: top5Raw.count,
      source_pass: top5Raw.pass,
    },
    ui_summary: {
      pages_visited: ui.pages_visited,
      ui_failures: uiFailures,
      symbols: ui.symbols,
      page_errors: ui.page_errors,
      pass: ui.pass,
    },
    final_verdict: finalVerdict,
    notes,
  };

  writeJson(MASTER_REPORT, master);

  console.log('TOP 5 TRADE VALIDATION COMPLETE');
  console.log(`VERDICT: ${finalVerdict}`);
  if (finalVerdict !== 'TRADING SYSTEM VALID') {
    console.log('WARNING — SYSTEM MAY BE MISLEADING TRADES');
  }
}

main().catch((error) => {
  const fallback = {
    timestamp: new Date().toISOString(),
    final_verdict: 'SYSTEM MISLEADING OR INCOMPLETE',
    notes: [`fatal_error: ${String(error.message || error)}`],
  };
  writeJson(MASTER_REPORT, fallback);
  console.log('TOP 5 TRADE VALIDATION COMPLETE');
  console.log('VERDICT: SYSTEM MISLEADING OR INCOMPLETE');
  console.log('WARNING — SYSTEM MAY BE MISLEADING TRADES');
  console.error(error);
  process.exit(1);
});
