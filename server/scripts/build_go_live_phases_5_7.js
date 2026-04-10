const fs = require('fs');
const http = require('http');

function request(pathname, timeoutMs = 20000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const req = http.get(
      { host: '127.0.0.1', port: 3001, path: pathname, timeout: timeoutMs },
      (res) => {
        const chunks = [];
        res.on('data', (d) => chunks.push(d));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            json = null;
          }
          resolve({
            path: pathname,
            status: res.statusCode || 0,
            ms: Date.now() - started,
            contentType: String(res.headers['content-type'] || ''),
            text,
            json,
          });
        });
      }
    );

    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (err) =>
      resolve({ path: pathname, status: 0, ms: Date.now() - started, error: String(err), contentType: '', text: '', json: null })
    );
  });
}

function readJson(path, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

async function buildPhase5() {
  const routes = ['/', '/login', '/watchlist', '/dashboard', '/intelligence'];
  const checks = [];
  for (const r of routes) {
    checks.push(await request(r, 10000));
  }

  const pass = checks.every((c) => c.status === 200 || c.status === 301 || c.status === 302);
  const out = {
    timestamp: new Date().toISOString(),
    checks: checks.map((c) => ({
      path: c.path,
      status: c.status,
      ms: c.ms,
      contentType: c.contentType,
      error: c.error || null,
      sample: (c.text || '').slice(0, 140),
    })),
    user_can_navigate_ui: pass,
    pass,
  };

  fs.writeFileSync('/Users/jamesharris/Server/logs/go_live_phase5_navigation.json', JSON.stringify(out, null, 2));
  return out;
}

async function buildPhase6() {
  const contractChecks = [
    {
      path: '/api/market/overview',
      required: ['status', 'data'],
    },
    {
      path: '/api/intelligence/top-opportunities?limit=10',
      required: ['status', 'data'],
    },
    {
      path: '/api/earnings?limit=10',
      required: ['status'],
    },
  ];

  const results = [];
  let mismatches = 0;

  for (const test of contractChecks) {
    const resp = await request(test.path, 25000);
    const root = resp.json && typeof resp.json === 'object' ? resp.json : null;
    const missing = [];

    if (!root) {
      missing.push('root_json');
    } else {
      for (const key of test.required) {
        if (!(key in root)) missing.push(key);
      }
    }

    if (resp.status !== 200) missing.push(`status_${resp.status}`);
    if (missing.length > 0) mismatches += 1;

    results.push({
      path: test.path,
      status: resp.status,
      ms: resp.ms,
      contentType: resp.contentType,
      missing,
      sample: (resp.text || '').slice(0, 180),
      pass: missing.length === 0,
    });
  }

  const out = {
    timestamp: new Date().toISOString(),
    checks: results,
    mismatch_count: mismatches,
    pass: mismatches === 0,
  };

  fs.writeFileSync('/Users/jamesharris/Server/logs/go_live_phase6_contracts.json', JSON.stringify(out, null, 2));
  return out;
}

function buildFinal() {
  const p1 = readJson('/Users/jamesharris/Server/logs/go_live_phase1_runtime.json', {});
  const p2 = readJson('/Users/jamesharris/Server/logs/go_live_phase2_quotes.json', {});
  const p3 = readJson('/Users/jamesharris/Server/logs/go_live_phase3_entry.json', {});
  const p4 = readJson('/Users/jamesharris/Server/logs/go_live_phase4_watchlist.json', {});
  const p5 = readJson('/Users/jamesharris/Server/logs/go_live_phase5_navigation.json', {});
  const p6 = readJson('/Users/jamesharris/Server/logs/go_live_phase6_contracts.json', {});

  const gates = {
    phase1_runtime: Boolean(p1.pass),
    phase2_quotes: Boolean(p2.pass),
    phase3_entry: Boolean(p3.pass),
    phase4_watchlist: Boolean(p4.pass),
    phase5_navigation: Boolean(p5.pass),
    phase6_contracts: Boolean(p6.pass),
  };

  const overall = Object.values(gates).every(Boolean);

  const unresolved = [];
  if (!gates.phase1_runtime) unresolved.push('runtime gate failed (rogue loop detected and/or ambiguous topology)');
  if (!gates.phase4_watchlist) unresolved.push('watchlist gate failed (endpoint timeout and/or unbalanced distribution)');
  if (!gates.phase5_navigation) unresolved.push('navigation gate failed');
  if (!gates.phase6_contracts) unresolved.push('contract gate failed');

  const out = {
    timestamp: new Date().toISOString(),
    verdict: overall ? 'GO' : 'NO_GO',
    gates,
    unresolved,
    summary: overall
      ? 'All go-live remediation gates passed.'
      : 'One or more remediation gates are still failing.',
  };

  fs.writeFileSync('/Users/jamesharris/Server/logs/go_live_final.json', JSON.stringify(out, null, 2));
  return out;
}

async function main() {
  const p5 = await buildPhase5();
  const p6 = await buildPhase6();
  const fin = buildFinal();
  console.log(JSON.stringify({ phase5_pass: p5.pass, phase6_pass: p6.pass, verdict: fin.verdict }));
}

main();
