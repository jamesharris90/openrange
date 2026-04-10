const fs = require('fs');

async function callEndpoint(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return {
    url,
    status: response.status,
    body,
    raw: text,
  };
}

function hasValue(v) {
  return v !== undefined && v !== null && String(v).trim() !== '';
}

function validateRow(row) {
  return {
    symbol: hasValue(row?.symbol),
    why: hasValue(row?.why),
    how: hasValue(row?.how),
    expected_move: Number.isFinite(Number(row?.expected_move)),
  };
}

function rowPass(result) {
  return result.symbol && result.why && result.how && result.expected_move;
}

function evaluateModeRules(mode, status, body, rows) {
  const success = body?.success === true;

  if (mode === 'live') {
    const pass = status === 200
      && (
        body?.success === false
        || (success && rows.length > 5)
      );
    return {
      mode,
      pass,
      checks: {
        status_200: status === 200,
        success_false_or_count_gt_5: body?.success === false || rows.length > 5,
      },
    };
  }

  if (mode === 'recent') {
    const pass = status === 200 && success && rows.length > 0;
    return {
      mode,
      pass,
      checks: {
        status_200: status === 200,
        success_true: success,
        count_gt_0: rows.length > 0,
      },
    };
  }

  const pass = status === 200 && success && rows.length >= 10;
  return {
    mode,
    pass,
    checks: {
      status_200: status === 200,
      success_true: success,
      count_gte_10: rows.length >= 10,
    },
  };
}

async function validate(url, mode) {
  let status = 0;
  let body = null;
  let raw = '';
  let requestError = null;

  try {
    const response = await callEndpoint(url);
    status = response.status;
    body = response.body;
    raw = response.raw;
  } catch (error) {
    requestError = error.message;
  }

  const rows = Array.isArray(body?.data) ? body.data : [];
  const perRow = rows.map((row, index) => {
    const checks = validateRow(row);
    return { index, checks, pass: rowPass(checks) };
  });

  const contractChecks = {
    source_real_when_success: body?.success === true
      ? String(body?.source || '').toLowerCase() === 'real'
      : true,
    every_row_valid_when_success: body?.success === true
      ? perRow.every((r) => r.pass)
      : true,
  };

  const modeRule = evaluateModeRules(mode, status, body, rows);

  const endpointChecks = {
    ...modeRule.checks,
    ...contractChecks,
  };

  return {
    url,
    mode,
    checks: endpointChecks,
    pass: modeRule.pass && Object.values(contractChecks).every(Boolean),
    summary: {
      status,
      count: rows.length,
      source: body?.source || null,
      success: body?.success,
      request_error: requestError,
    },
    invalid_rows: perRow.filter((r) => !r.pass).slice(0, 20),
    sample_rows: rows.slice(0, 3),
    raw_preview: typeof raw === 'string' ? raw.slice(0, 300) : null,
  };
}

async function validateDataAvailability() {
  let status = 0;
  let body = null;
  let requestError = null;

  try {
    const response = await callEndpoint('http://localhost:3001/api/system/data-availability');
    status = response.status;
    body = response.body;
  } catch (error) {
    requestError = error.message;
  }

  const counts = body?.counts || {};
  const checks = {
    status_200: status === 200,
    success_true: body?.success === true,
    counts_present: Number.isFinite(Number(counts.opportunity_stream_total))
      && Number.isFinite(Number(counts.opportunity_stream_last_15m))
      && Number.isFinite(Number(counts.opportunity_stream_last_24h))
      && Number.isFinite(Number(counts.trade_setups_total)),
    last_updated_present: hasValue(body?.last_updated),
  };

  return {
    url: 'http://localhost:3001/api/system/data-availability',
    checks,
    pass: Object.values(checks).every(Boolean),
    summary: {
      status,
      request_error: requestError,
      counts,
      last_updated: body?.last_updated || null,
    },
  };
}

(async () => {
  const endpoints = [
    { url: 'http://localhost:3001/api/intelligence/top-opportunities?mode=live', mode: 'live' },
    { url: 'http://localhost:3001/api/intelligence/top-opportunities?mode=recent', mode: 'recent' },
    { url: 'http://localhost:3001/api/intelligence/top-opportunities?mode=research', mode: 'research' },
    { url: 'http://localhost:3001/api/stocks-in-play?mode=live', mode: 'live' },
    { url: 'http://localhost:3001/api/stocks-in-play?mode=recent', mode: 'recent' },
    { url: 'http://localhost:3001/api/stocks-in-play?mode=research', mode: 'research' },
  ];

  const results = [];
  for (const endpoint of endpoints) {
    results.push(await validate(endpoint.url, endpoint.mode));
  }

  const dataAvailability = await validateDataAvailability();

  const passed = results.every((r) => r.pass === true) && dataAvailability.pass;
  const byMode = {
    live: results.filter((r) => r.mode === 'live').every((r) => r.pass === true),
    recent: results.filter((r) => r.mode === 'recent').every((r) => r.pass === true),
    research: results.filter((r) => r.mode === 'research').every((r) => r.pass === true),
  };
  const contractIntegrity = results.every((r) => r.checks.source_real_when_success && r.checks.every_row_valid_when_success);
  const report = {
    generated_at: new Date().toISOString(),
    passed,
    summary: {
      live_mode: byMode.live,
      recent_mode: byMode.recent,
      research_mode: byMode.research,
      contract_integrity: contractIntegrity,
      data_availability: dataAvailability.pass,
    },
    data_availability: dataAvailability,
    results,
  };

  fs.writeFileSync('backend_contract_fix.json', JSON.stringify(report, null, 2));

  if (passed) {
    console.log('BACKEND CONTRACT FIXED — READY FOR UI');
    process.exit(0);
  }

  console.log('BACKEND CONTRACT FAILED — STOP');
  process.exit(2);
})();
