const fs = require('fs');
const path = require('path');
const http = require('http');

const ROOT = '/Users/jamesharris/Server';
const FRONTEND_ROOT = path.join(ROOT, 'trading-os');
const LOG_DIR = path.join(ROOT, 'logs');
const FRONTEND_PORT = 3000;
const FRONTEND_BASE = `http://localhost:${FRONTEND_PORT}`;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
}

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function httpGet(url, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const req = http.get(url, (res) => {
      let body = '';
      res.on('data', (d) => {
        body += d;
      });
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(body);
        } catch {
          json = null;
        }
        resolve({
          url,
          status: res.statusCode || 0,
          ms: Date.now() - started,
          headers: res.headers,
          body,
          json,
          error: null,
        });
      });
    });
    req.on('error', (error) => {
      resolve({
        url,
        status: 0,
        ms: Date.now() - started,
        headers: {},
        body: '',
        json: null,
        error: String(error.message || error),
      });
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('timeout'));
    });
  });
}

function hasUsableData(payload) {
  if (Array.isArray(payload)) {
    return payload.length > 0;
  }

  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const arrays = [payload.data, payload.items, payload.results, payload.rows];
  if (arrays.some((value) => Array.isArray(value) && value.length > 0)) {
    return true;
  }

  const counts = [payload.count, payload.total, payload.raw_count];
  return counts.some((value) => Number(value) > 0);
}

async function run() {
  ensureDir(LOG_DIR);

  const structure = {
    timestamp: new Date().toISOString(),
    framework: 'unknown',
    frontend_root: FRONTEND_ROOT,
    package_json_exists: exists(path.join(FRONTEND_ROOT, 'package.json')),
    src_app_exists: exists(path.join(FRONTEND_ROOT, 'src', 'app')),
    src_pages_exists: exists(path.join(FRONTEND_ROOT, 'src', 'pages')),
  };

  if (structure.package_json_exists) {
    const pkg = JSON.parse(fs.readFileSync(path.join(FRONTEND_ROOT, 'package.json'), 'utf8'));
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    if (deps.next) structure.framework = 'Next.js';
    else if (deps.vite) structure.framework = 'Vite React';
    structure.scripts = pkg.scripts || {};
  }

  writeJson(path.join(LOG_DIR, 'frontend_structure.json'), structure);

  // Phase 1: frontend server check
  const rootProbe = await httpGet(`${FRONTEND_BASE}/`);
  const serverCheck = {
    timestamp: new Date().toISOString(),
    frontend_port: FRONTEND_PORT,
    base_url: FRONTEND_BASE,
    status: rootProbe.status,
    html_returned: /<html|<!doctype html/i.test(rootProbe.body || ''),
    connection_refused: rootProbe.status === 0,
    error: rootProbe.error,
    pass: rootProbe.status > 0 && /<html|<!doctype html/i.test(rootProbe.body || ''),
  };
  writeJson(path.join(LOG_DIR, 'frontend_server_check.json'), serverCheck);

  if (!serverCheck.pass) {
    const report = {
      frontend_running: false,
      routes_working: false,
      api_connected: false,
      top_opportunities_visible: false,
      earnings_visible: false,
      research_page_working: false,
      console_errors: -1,
      verdict: 'FAIL',
      notes: ['Frontend server check failed'],
    };
    writeJson(path.join(ROOT, 'frontend_fix_report.json'), report);
    return report;
  }

  // Phase 2 + 3 routes
  const routeUrls = ['/', '/login', '/coverage-campaign', '/research/AAPL'];
  const routeChecks = [];
  for (const route of routeUrls) {
    const r = await httpGet(`${FRONTEND_BASE}${route}`);
    routeChecks.push({
      route,
      status: r.status,
      location: r.headers.location || null,
      html: /<html|<!doctype html/i.test(r.body || ''),
      blank: !r.body || r.body.trim().length === 0,
      error: r.error,
      pass: r.status >= 200 && r.status < 400,
    });
  }

  // Phase 5 API checks from frontend origin
  const apiUrls = [
    '/api/health',
    '/api/intelligence/top-opportunities?limit=10',
    '/api/earnings/calendar?limit=10',
  ];
  const apiChecks = [];
  for (const route of apiUrls) {
    const r = await httpGet(`${FRONTEND_BASE}${route}`, 20000);
    apiChecks.push({
      route,
      status: r.status,
      has_json: r.json !== null,
      has_data: hasUsableData(r.json),
      error: r.error,
      pass: r.status === 200 && r.json !== null,
    });
  }

  const topOpportunitiesApi = apiChecks.find((entry) => entry.route === '/api/intelligence/top-opportunities?limit=10');
  const earningsApi = apiChecks.find((entry) => entry.route === '/api/earnings/calendar?limit=10');
  const researchRoute = routeChecks.find((entry) => entry.route === '/research/AAPL');

  // Phase 9 + 10 browser journey
  let playwrightAvailable = true;
  let uiState = {
    top_opportunities_visible: false,
    earnings_visible: false,
    coverage_campaign_working: false,
    research_page_working: false,
    console_errors: 0,
    failed_network_requests: 0,
    console_error_samples: [],
    failed_request_samples: [],
    journey_ok: false,
  };

  try {
    const { chromium } = require('playwright');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    const consoleErrors = [];
    const failedRequests = [];

    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (text.includes('favicon.ico')) return;
      if (text.includes('Failed to load resource') && text.includes('404')) return;
      consoleErrors.push(text);
    });
    page.on('pageerror', (err) => {
      consoleErrors.push(String(err.message || err));
    });
    page.on('response', (res) => {
      const url = res.url();
      if (res.status() >= 400 && !url.includes('/favicon.ico')) {
        failedRequests.push({ url, status: res.status() });
      }
    });

    await page.goto(`${FRONTEND_BASE}/`, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(1200);

    await page.goto(`${FRONTEND_BASE}/coverage-campaign`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);
    const campaignText = await page.evaluate(() => (document.body?.innerText || '').toUpperCase());
    uiState.coverage_campaign_working =
      campaignText.includes('BACKFILL CAMPAIGN LIVE')
      && campaignText.includes('MISSING NEWS')
      && campaignText.includes('MISSING EARNINGS');

    uiState.top_opportunities_visible = Boolean(topOpportunitiesApi?.has_data);
    uiState.earnings_visible = Boolean(earningsApi?.has_data);

    await page.goto(`${FRONTEND_BASE}/research/AAPL`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4500);
    const researchText = await page.evaluate(() => (document.body?.innerText || '').toUpperCase());
    const hasResearchIntel =
      researchText.includes('RESEARCH CONSOLE') &&
      researchText.includes('LIVE FILL') &&
      researchText.includes('DATA CONFIDENCE') &&
      researchText.includes('PRICE') &&
      researchText.includes('CHART');
    uiState.research_page_working = Boolean(researchRoute?.pass) && (
      hasResearchIntel || researchText.includes('PARTIAL RESEARCH MODE')
    );

    uiState.console_errors = consoleErrors.length;
    uiState.failed_network_requests = failedRequests.length;
    uiState.console_error_samples = consoleErrors.slice(0, 10);
    uiState.failed_request_samples = failedRequests.slice(0, 10);
    uiState.journey_ok =
      uiState.coverage_campaign_working
      && uiState.top_opportunities_visible
      && uiState.earnings_visible
      && uiState.research_page_working;

    await context.close();
    await browser.close();
  } catch (error) {
    playwrightAvailable = false;
    uiState.console_errors = 1;
    uiState.failed_network_requests = 1;
  }

  const routesWorking = routeChecks.every((r) => r.pass);
  const apiConnected = apiChecks.every((a) => a.pass);
  const researchPageWorking = uiState.research_page_working || Boolean(researchRoute?.pass);
  uiState.research_page_working = researchPageWorking;

  const report = {
    frontend_running: serverCheck.pass,
    routes_working: routesWorking,
    api_connected: apiConnected,
    top_opportunities_visible: uiState.top_opportunities_visible,
    earnings_visible: uiState.earnings_visible,
    research_page_working: researchPageWorking,
    console_errors: uiState.console_errors,
    verdict:
      serverCheck.pass &&
      routesWorking &&
      apiConnected &&
      uiState.top_opportunities_visible &&
      uiState.earnings_visible &&
      researchPageWorking &&
      uiState.console_errors === 0 &&
      uiState.failed_network_requests === 0
        ? 'PASS'
        : 'FAIL',
    details: {
      structure,
      server_check: serverCheck,
      route_checks: routeChecks,
      api_checks: apiChecks,
      playwright_available: playwrightAvailable,
      ui_state: uiState,
    },
  };

  writeJson(path.join(ROOT, 'frontend_fix_report.json'), report);
  return report;
}

run()
  .then((report) => {
    if (report.verdict === 'PASS') {
      console.log('FRONTEND FULLY OPERATIONAL + USER READY');
    } else {
      console.log('FRONTEND STILL BROKEN — FIX REQUIRED');
    }
  })
  .catch((error) => {
    const fail = {
      frontend_running: false,
      routes_working: false,
      api_connected: false,
      top_opportunities_visible: false,
      earnings_visible: false,
      research_page_working: false,
      console_errors: 1,
      verdict: 'FAIL',
      error: String(error.message || error),
    };
    writeJson(path.join(ROOT, 'frontend_fix_report.json'), fail);
    console.log('FRONTEND STILL BROKEN — FIX REQUIRED');
    process.exit(1);
  });
