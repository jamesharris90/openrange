/* eslint-disable no-console */
const BASE_URL = process.env.TEST_BASE_URL || 'https://openrange-backend-production.up.railway.app';

const ENDPOINTS = [
  '/api/system/health',
  '/api/metrics',
  '/api/scanner',
  '/api/premarket',
  '/api/news',
  '/api/setups',
  '/api/expected-move',
];

async function testEndpoint(path) {
  const url = `${BASE_URL}${path}`;
  const result = {
    endpoint: path,
    status: null,
    ok: false,
    jsonValid: false,
    error: null,
  };

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(10000),
    });

    result.status = response.status;
    result.ok = response.ok;

    const text = await response.text();
    try {
      JSON.parse(text);
      result.jsonValid = true;
    } catch {
      result.jsonValid = false;
      result.error = 'Invalid JSON response';
    }

    return result;
  } catch (err) {
    result.error = err.message;
    return result;
  }
}

async function run() {
  console.log(`Testing endpoints against: ${BASE_URL}`);

  const results = [];
  for (const endpoint of ENDPOINTS) {
    const result = await testEndpoint(endpoint);
    results.push(result);

    console.log(
      `${endpoint} -> status=${result.status ?? 'ERR'} ok=${result.ok} json=${result.jsonValid}${result.error ? ` error=${result.error}` : ''}`
    );
  }

  const broken = results.filter((item) => !item.ok || !item.jsonValid);

  console.log('\nSummary');
  console.log(`- total: ${results.length}`);
  console.log(`- passing: ${results.length - broken.length}`);
  console.log(`- failing: ${broken.length}`);

  if (broken.length > 0) {
    process.exitCode = 1;
  }
}

run().catch((err) => {
  console.error('Endpoint test runner failed:', err.message);
  process.exit(1);
});
