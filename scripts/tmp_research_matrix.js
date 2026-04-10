const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://127.0.0.1:3018';
const TICKERS = ['AAPL', 'MU', 'CRWD', 'SMCI', 'SOFI'];

async function fetchJson(endpoint) {
  const url = `${BASE_URL}${endpoint}`;
  const startedAt = Date.now();
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await response.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    throw new Error(`Non-JSON response from ${endpoint}: ${text.slice(0, 120)}`);
  }

  return {
    endpoint,
    url,
    status: response.status,
    elapsed_ms: Date.now() - startedAt,
    payload,
  };
}

function hasValue(value) {
  return value !== null && value !== undefined && String(value) !== '';
}

function summarizeResearch(response, ticker) {
  const payload = response.payload || {};
  const data = payload.data || payload;
  return {
    ticker,
    endpoint: response.endpoint,
    status: response.status,
    elapsed_ms: response.elapsed_ms,
    ok: response.status === 200,
    checks: {
      symbol_match: String(data?.profile?.symbol || data?.symbol || '').toUpperCase() === ticker,
      has_decision: Boolean(data?.decision),
      has_price: hasValue(data?.price?.price ?? data?.overview?.price),
      has_earnings_block: Boolean(data?.earnings),
      has_fundamentals_block: Boolean(data?.fundamentals),
      has_context_block: Boolean(data?.context),
      has_data_confidence: hasValue(data?.data_confidence ?? data?.dataConfidence ?? data?.meta?.data_confidence),
    },
    sample: {
      decision_confidence: data?.decision?.confidence || null,
      price: data?.price?.price ?? data?.overview?.price ?? null,
      next_earnings: data?.earnings?.next?.date || null,
      sector: data?.profile?.sector || null,
    },
  };
}

function summarizeEndpoint(response, validator) {
  const ok = response.status === 200 && validator(response.payload);
  return {
    endpoint: response.endpoint,
    status: response.status,
    elapsed_ms: response.elapsed_ms,
    ok,
  };
}

function renderMarkdown(matrix, regressions) {
  const lines = [
    '# Research Validation Matrix',
    '',
    `Generated: ${new Date().toISOString()}`,
    `Base URL: ${BASE_URL}`,
    '',
    '## Research Endpoints',
    '',
    '| Ticker | Status | Time (ms) | Symbol | Decision | Price | Earnings | Fundamentals | Context | Data Confidence |',
    '| --- | --- | ---: | --- | --- | --- | --- | --- | --- | --- |',
  ];

  for (const row of matrix) {
    lines.push(
      `| ${row.ticker} | ${row.status} | ${row.elapsed_ms} | ${row.checks.symbol_match ? 'PASS' : 'FAIL'} | ${row.checks.has_decision ? 'PASS' : 'FAIL'} | ${row.checks.has_price ? 'PASS' : 'FAIL'} | ${row.checks.has_earnings_block ? 'PASS' : 'FAIL'} | ${row.checks.has_fundamentals_block ? 'PASS' : 'FAIL'} | ${row.checks.has_context_block ? 'PASS' : 'FAIL'} | ${row.checks.has_data_confidence ? 'PASS' : 'FAIL'} |`
    );
  }

  lines.push('');
  lines.push('## Regression Endpoints');
  lines.push('');
  lines.push('| Endpoint | Status | Time (ms) | Result |');
  lines.push('| --- | --- | ---: | --- |');

  for (const row of regressions) {
    lines.push(`| ${row.endpoint} | ${row.status} | ${row.elapsed_ms} | ${row.ok ? 'PASS' : 'FAIL'} |`);
  }

  lines.push('');
  lines.push('## Samples');
  lines.push('');
  for (const row of matrix) {
    lines.push(`- ${row.ticker}: price=${row.sample.price ?? 'n/a'}, next_earnings=${row.sample.next_earnings ?? 'n/a'}, sector=${row.sample.sector ?? 'n/a'}`);
  }

  return `${lines.join('\n')}\n`;
}

async function main() {
  let lastError = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const ping = await fetchJson('/api/health');
      if (ping.status === 200) break;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
      continue;
    }
  }

  if (lastError) {
    // Continue and let actual calls fail with a clearer message if the server never came up.
  }

  const researchResponses = [];
  for (const ticker of TICKERS) {
    researchResponses.push(await fetchJson(`/api/research/${ticker}/full`));
  }
  const matrix = researchResponses.map((response, index) => summarizeResearch(response, TICKERS[index]));

  const regressionResponses = await Promise.all([
    fetchJson('/api/health'),
    fetchJson('/api/screener'),
    fetchJson('/api/intelligence/decision/AAPL'),
    fetchJson('/api/intelligence/top-opportunities?limit=5'),
    fetchJson('/api/market/overview'),
    fetchJson('/api/earnings/calendar?limit=5'),
  ]);

  const regressions = [
    summarizeEndpoint(regressionResponses[0], (payload) => ['ok', 'degraded'].includes(String(payload?.data_integrity_engine || ''))),
    summarizeEndpoint(regressionResponses[1], (payload) => Array.isArray(payload?.data)),
    summarizeEndpoint(regressionResponses[2], (payload) => Boolean(payload && typeof payload === 'object')),
    summarizeEndpoint(regressionResponses[3], (payload) => Array.isArray(payload?.data) || payload?.success === false),
    summarizeEndpoint(regressionResponses[4], (payload) => Boolean(payload && typeof payload === 'object')),
    summarizeEndpoint(regressionResponses[5], (payload) => Array.isArray(payload?.events) || Array.isArray(payload?.data) || payload?.success === false),
  ];

  const endpointValidation = {
    generated_at: new Date().toISOString(),
    base_url: BASE_URL,
    research_matrix: matrix,
    regression_endpoints: regressions,
    ok: matrix.every((row) => row.ok && Object.values(row.checks).every(Boolean)) && regressions.every((row) => row.ok),
  };

  const markdown = renderMarkdown(matrix, regressions);

  fs.writeFileSync(path.resolve(__dirname, '..', 'logs', 'endpoint_validation.json'), JSON.stringify(endpointValidation, null, 2));
  fs.writeFileSync(path.resolve(__dirname, '..', 'docs', 'research-validation-matrix.md'), markdown);

  console.log(JSON.stringify(endpointValidation, null, 2));

  if (!endpointValidation.ok) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
