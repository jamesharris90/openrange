const { performance } = require('perf_hooks');

function pickPrimaryArray(data) {
  if (data && typeof data === 'object' && Array.isArray(data.data)) return data.data;
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];

  const candidates = [data.items, data.rows, data.signals, data.opportunities, data.data, data.sectors];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

async function testEndpoint(baseUrl, endpoint) {
  const startedAt = performance.now();
  const url = `${baseUrl}${endpoint}`;

  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
    });

    let json;
    try {
      json = await res.json();
    } catch (_err) {
      json = null;
    }

    const primaryArray = pickPrimaryArray(json);
    const responseType = Array.isArray(json) ? 'array' : json === null ? 'null' : typeof json;
    const contractCompliant = Boolean(json && typeof json === 'object' && Object.prototype.hasOwnProperty.call(json, 'success'));
    const contractViolation = contractCompliant ? json.success !== true : true;

    return {
      endpoint,
      url,
      ok: res.ok,
      status: res.status,
      responseTimeMs: Math.round(performance.now() - startedAt),
      responseType,
      arrayLength: Array.isArray(json) ? json.length : primaryArray.length,
      contractCompliant,
      contractViolation,
      parsedData: json,
      primaryArray,
    };
  } catch (err) {
    return {
      endpoint,
      url,
      ok: false,
      status: 'FAILED',
      responseTimeMs: Math.round(performance.now() - startedAt),
      responseType: 'error',
      arrayLength: null,
      contractCompliant: false,
      contractViolation: true,
      error: err.message,
      parsedData: null,
      primaryArray: [],
    };
  }
}

module.exports = {
  testEndpoint,
};
