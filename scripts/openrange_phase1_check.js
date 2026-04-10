const dotenv = require('../server/node_modules/dotenv');

dotenv.config({ path: 'server/.env' });

async function main() {
  const base = process.env.API_BASE || 'http://127.0.0.1:3001';
  const headers = { Accept: 'application/json' };

  if (process.env.PROXY_API_KEY) {
    headers['x-api-key'] = process.env.PROXY_API_KEY;
  }

  const paths = [
    '/api/health',
    '/api/screener',
    '/api/market/overview',
    '/api/market/quotes?symbols=SPY,QQQ',
    '/api/intelligence/decision/AAPL',
  ];

  const endpointResults = [];
  for (const path of paths) {
    try {
      const res = await fetch(base + path, { headers });
      const body = await res.json().catch(() => null);
      endpointResults.push({
        path,
        status: res.status,
        ok: res.status === 200,
        hasBody: Boolean(body),
      });
    } catch (error) {
      endpointResults.push({
        path,
        status: 0,
        ok: false,
        error: error.message,
      });
    }
  }

  let login;
  try {
    const res = await fetch(base + '/api/users/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://localhost:3000',
      },
      body: JSON.stringify({
        identifier: 'ag941472',
        password: 'GuardPass!234',
      }),
    });
    const body = await res.json().catch(() => null);
    login = {
      status: res.status,
      ok: res.status === 200 && Boolean(body?.token),
      tokenPresent: Boolean(body?.token),
    };
  } catch (error) {
    login = {
      status: 0,
      ok: false,
      error: error.message,
    };
  }

  const allEndpointsOk = endpointResults.every((r) => r.ok);
  const phase1Pass = allEndpointsOk && login.ok;

  console.log(
    JSON.stringify(
      {
        base,
        phase1Pass,
        endpointResults,
        login,
      },
      null,
      2
    )
  );

  process.exit(phase1Pass ? 0 : 1);
}

main().catch((error) => {
  console.error(JSON.stringify({ fatal: error.message }, null, 2));
  process.exit(1);
});
