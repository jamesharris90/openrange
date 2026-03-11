async function getFetch() {
  if (typeof fetch === 'function') {
    return fetch;
  }

  const mod = await import('node-fetch');
  return mod.default;
}

async function testDiagnostics() {
  const fetchFn = await getFetch();
  const res = await fetchFn('http://localhost:3000/api/system/engine-diagnostics');
  const data = await res.json();

  console.log('ENGINE DIAGNOSTICS RESPONSE');
  console.log(JSON.stringify(data, null, 2));

  const checks = [
    data.scheduler === 'ok' || data.scheduler_health?.status === 'running',
    data.pipeline === 'ok' || data.engines?.pipeline?.status === 'ok',
    data.providers === 'ok' || data.provider_health?.status === 'ok',
    Number(data.opportunities_24h || data.performance_telemetry?.opportunities_24h || 0) > 0,
  ];

  if (checks.every(Boolean)) {
    console.log('ENGINE SYSTEM HEALTH: PASS');
  } else {
    console.log('ENGINE SYSTEM HEALTH: WARNING');
  }
}

testDiagnostics().catch((error) => {
  console.error('ENGINE SYSTEM HEALTH: WARNING');
  console.error(error.message);
  process.exit(1);
});
