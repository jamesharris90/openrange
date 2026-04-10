#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.ENDPOINT_VALIDATION_BASE_URL || 'http://127.0.0.1:3007';
const LOG_PATH = path.resolve(__dirname, '../../logs/endpoint_validation.json');

const endpoints = [
  '/api/screener',
  '/api/intelligence/decision/AAPL',
  '/api/intelligence/top-opportunities',
  '/api/market/overview',
  '/api/earnings',
];

(async () => {
  const results = [];

  for (const endpoint of endpoints) {
    const url = `${BASE_URL}${endpoint}`;
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      results.push({ endpoint, url, status: response.status, ok: response.ok });
    } catch (error) {
      results.push({ endpoint, url, status: null, ok: false, error: error.message });
    }
  }

  const output = {
    phase: 'phase_4_endpoint_retest',
    base_url: BASE_URL,
    results,
    pass: results.every((result) => result.ok),
    validated_at: new Date().toISOString(),
  };

  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  fs.writeFileSync(LOG_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

  console.log(JSON.stringify(output, null, 2));

  if (!output.pass) {
    process.exitCode = 1;
  }
})();
