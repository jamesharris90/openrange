const fs = require('fs');

async function getJson(url) {
  const res = await fetch(url);
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  return { status: res.status, body, raw: text };
}

function rowsFromBody(body) {
  if (!body || typeof body !== 'object') return [];
  if (Array.isArray(body)) return body;
  if (Array.isArray(body.data)) return body.data;
  if (Array.isArray(body.rows)) return body.rows;
  if (Array.isArray(body.opportunities)) return body.opportunities;
  return [];
}

function responseSource(body) {
  if (!body || typeof body !== 'object') return null;
  return body.source || body.dataSource || null;
}

function hasValue(v) {
  return v !== undefined && v !== null && String(v).trim() !== '';
}

async function validateEndpoint(url) {
  const { status, body, raw } = await getJson(url);
  const rows = rowsFromBody(body);
  const source = responseSource(body);

  const requiredFields = ['symbol', 'why', 'how', 'confidence', 'expected_move'];
  const fieldFailures = rows
    .map((row, idx) => ({
      index: idx,
      missing: requiredFields.filter((f) => !hasValue(row && row[f]))
    }))
    .filter((x) => x.missing.length > 0);

  const checks = {
    status_200: status === 200,
    count_gt_5: rows.length > 5,
    response_source_real: String(source || '').toLowerCase() === 'real',
    every_row_source_real: rows.length > 0 && rows.every((r) => String((r && r.source) || '').toLowerCase() === 'real'),
    required_fields_present: fieldFailures.length === 0
  };

  return {
    url,
    checks,
    summary: {
      status,
      count: rows.length,
      response_source: source
    },
    missing_fields: fieldFailures.slice(0, 50),
    sample_rows: rows.slice(0, 3),
    raw_preview: typeof raw === 'string' ? raw.slice(0, 300) : null
  };
}

(async () => {
  const endpoints = [
    'http://localhost:3001/api/intelligence/top-opportunities?limit=5',
    'http://localhost:3001/api/stocks-in-play'
  ];

  const results = [];
  for (const url of endpoints) {
    results.push(await validateEndpoint(url));
  }

  const passed = results.every((r) => Object.values(r.checks).every(Boolean));
  const report = {
    generated_at: new Date().toISOString(),
    phase: 'PHASE_0_HARD_GATE',
    passed,
    results
  };

  if (!passed) {
    fs.writeFileSync('ui_phase0_block.json', JSON.stringify(report, null, 2));
    console.log('PHASE0_BLOCK ui_phase0_block.json');
    process.exit(2);
  }

  fs.writeFileSync('ui_phase0_pass.json', JSON.stringify(report, null, 2));
  console.log('PHASE0_PASS ui_phase0_pass.json');
})();
