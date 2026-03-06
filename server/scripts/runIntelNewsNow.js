#!/usr/bin/env node

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
if (!process.env.FMP_API_KEY) {
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
}

const { runIntelNewsWithFallback } = require('../services/intelNewsRunner');

(async () => {
  const startedAt = Date.now();
  try {
    const result = await runIntelNewsWithFallback();
    console.log('[runIntelNewsNow] success', {
      source: result?.source || 'unknown',
      ingested: Number(result?.ingested || 0),
      skipped: Boolean(result?.skipped),
      runtimeMs: Date.now() - startedAt,
    });
    process.exit(0);
  } catch (error) {
    console.error('[runIntelNewsNow] failed', {
      message: error?.message || 'Unknown error',
      runtimeMs: Date.now() - startedAt,
    });
    process.exit(1);
  }
})();
