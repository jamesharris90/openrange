const endpoints = [
  '/api/screener?limit=5',
  '/api/intelligence/decision/AAPL',
  '/api/intelligence/top-opportunities?limit=5',
  '/api/market/overview',
  '/api/earnings',
];

async function main() {
  const base = 'https://openrangetrading.co.uk';
  const results = [];

  for (const endpoint of endpoints) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(base + endpoint, {
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
      const text = await response.text();
      let body = null;

      try {
        body = JSON.parse(text);
      } catch (_error) {
        body = null;
      }

      results.push({
        endpoint,
        status: response.status,
        ok: response.ok,
        runtime_ms: Date.now() - startedAt,
        keys: body && typeof body === 'object' && !Array.isArray(body)
          ? Object.keys(body).slice(0, 12)
          : [],
        data_length: Array.isArray(body?.data) ? body.data.length : null,
        success: body?.success ?? body?.ok ?? null,
      });
    } catch (error) {
      results.push({
        endpoint,
        ok: false,
        error: error.message,
        runtime_ms: Date.now() - startedAt,
      });
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});